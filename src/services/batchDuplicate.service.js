/**
 * Within-batch duplicate detection WITHOUT an LLM.
 * LaTeX-normalized stem hash + embedding cosine (~93% default) + exact option-set match.
 * Keep the first occurrence, drop the rest (solve once).
 */

import { createHash } from "crypto";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { getEmbeddingsBatch, cosineSimilarity } from "./embedding.service.js";

const DEFAULT_THRESHOLD = Math.min(
    0.99,
    Math.max(
        0.8,
        Number(process.env.AI_QB_BATCH_DUPLICATE_THRESHOLD || 0.93)
    )
);

/** Normalize LaTeX / math markup before hashing so x vs y and $x$ vs \(x\) collide less falsely, more truly. */
export const normalizeLatexStem = (text = "") => {
    let s = String(text || "");
    // Unify math delimiters → spaces around content kept
    s = s
        .replace(/\$\$([\s\S]*?)\$\$/g, " $1 ")
        .replace(/\$([^$]+)\$/g, " $1 ")
        .replace(/\\\(([\s\S]*?)\\\)/g, " $1 ")
        .replace(/\\\[([\s\S]*?)\\\]/g, " $1 ")
        .replace(/\\begin\{[^}]+\}/g, " ")
        .replace(/\\end\{[^}]+\}/g, " ");
    // Common latex commands → plain
    s = s
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
        .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
        .replace(/\\mathrm\{([^}]+)\}/g, "$1")
        .replace(/\\text\{([^}]+)\}/g, "$1")
        .replace(/\\left|\\right/g, "")
        .replace(/\\[,;!:]/g, " ")
        .replace(/\\([a-zA-Z]+)/g, " $1 ");
    // Variable-name soft-normalize: collapse single-letter identifiers to "VAR"
    // only inside dense math-ish runs is too aggressive — instead unify whitespace/case.
    s = s
        .toLowerCase()
        .replace(/[^a-z0-9\s.+*/=()-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return s;
};

const normStem = normalizeLatexStem;

const optionSetSignature = (q) => {
    const opts = (q?.options || [])
        .map((o) =>
            normalizeLatexStem(typeof o === "object" ? o?.text : o)
        )
        .filter(Boolean)
        .sort();
    if (opts.length < 2) return null;
    return opts.join("|");
};

export const stemContentHash = (text = "") => {
    const n = normalizeLatexStem(text);
    if (!n || n.length < 12) return null;
    return createHash("sha256").update(n).digest("hex").slice(0, 24);
};

/**
 * @returns {Promise<{ questions: object[], kept: number, dropped: number, reasons: object[] }>}
 */
export const dedupeBatchByHashAndEmbedding = async (
    questions = [],
    { threshold = DEFAULT_THRESHOLD } = {}
) => {
    const list = Array.isArray(questions) ? questions : [];
    if (list.length < 2) {
        return { questions: list, kept: list.length, dropped: 0, reasons: [] };
    }

    const stems = list.map((q) =>
        normalizeLatexStem(q?.questionText || q?.stem || "")
    );
    const hashes = stems.map((s) =>
        s.length >= 12 ? stemContentHash(s) : null
    );
    const optionSigs = list.map((q) => optionSetSignature(q));
    const keep = new Array(list.length).fill(true);
    const reasons = [];

    // Exact / hash duplicates first (no embedding cost).
    const seenHash = new Map();
    const seenOptionStem = new Map();
    for (let i = 0; i < list.length; i++) {
        const h = hashes[i];
        const optSig = optionSigs[i];
        // Same options + near-identical normalized stem → duplicate
        if (h && optSig) {
            const key = `${h}::${optSig}`;
            if (seenOptionStem.has(key)) {
                keep[i] = false;
                reasons.push({
                    index: i,
                    duplicateOf: seenOptionStem.get(key),
                    method: "hash+options",
                    score: 1,
                });
                continue;
            }
            seenOptionStem.set(key, i);
        }
        if (!h) continue;
        if (seenHash.has(h)) {
            keep[i] = false;
            reasons.push({
                index: i,
                duplicateOf: seenHash.get(h),
                method: "hash",
                score: 1,
            });
        } else {
            seenHash.set(h, i);
        }
    }

    // Embedding cosine for remaining pairs (use LaTeX-normalized text).
    try {
        const embedTexts = list.map((q, i) =>
            keep[i]
                ? normalizeLatexStem(q?.questionText || "") || `q-${i}`
                : ""
        );
        const activeIdx = embedTexts
            .map((t, i) => (t && keep[i] ? i : -1))
            .filter((i) => i >= 0);

        if (activeIdx.length >= 2) {
            const vectors = await getEmbeddingsBatch(
                activeIdx.map((i) => embedTexts[i]),
                { taskType: "RETRIEVAL_DOCUMENT" }
            );
            const byIndex = new Map();
            activeIdx.forEach((qi, vi) => byIndex.set(qi, vectors[vi] || []));

            for (let a = 0; a < activeIdx.length; a++) {
                const i = activeIdx[a];
                if (!keep[i]) continue;
                for (let b = a + 1; b < activeIdx.length; b++) {
                    const j = activeIdx[b];
                    if (!keep[j]) continue;
                    const score = cosineSimilarity(
                        byIndex.get(i) || [],
                        byIndex.get(j) || []
                    );
                    // Boost if option sets are identical
                    const sameOpts =
                        optionSigs[i] &&
                        optionSigs[j] &&
                        optionSigs[i] === optionSigs[j];
                    const effectiveThreshold = sameOpts
                        ? Math.min(threshold, 0.9)
                        : threshold;
                    if (score >= effectiveThreshold) {
                        keep[j] = false;
                        reasons.push({
                            index: j,
                            duplicateOf: i,
                            method: sameOpts
                                ? "embedding+options"
                                : "embedding",
                            score: Number(score.toFixed(4)),
                        });
                    }
                }
            }
        }
    } catch (err) {
        pipelineTrace("BATCH_DUPLICATE_EMBED_FAILED", {
            error: err?.message || String(err),
            note: "hash-only dedupe applied; fail-open on embeddings",
        });
    }

    const next = list.filter((_, i) => keep[i]);
    const dropped = list.length - next.length;
    if (dropped > 0) {
        pipelineTrace("BATCH_DUPLICATE_DEDUPED", {
            kept: next.length,
            dropped,
            threshold,
            reasons: reasons.slice(0, 12),
        });
    }

    return { questions: next, kept: next.length, dropped, reasons };
};
