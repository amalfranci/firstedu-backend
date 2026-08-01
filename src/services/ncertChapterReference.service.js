/**
 * NCERT Class 11 & 12 chapter reference (Mathematics) — file-backed.
 *
 * Authoritative source for what a chapter may legitimately test: concepts,
 * formulas, standard results, allowed solving methods, common traps and the
 * explicit out-of-NCERT constraints. Prefer this over model memory when
 * writing or solving a question for one of these chapters.
 *
 * Data: files/ncert-reference/mathematics/jee-ncert-chapter-reference.json
 *
 * Why this exists: hard JEE Mathematics questions were being generated with
 * methods outside NCERT scope (L'Hôpital, Leibniz rule, pole-polar) and with
 * answers derived from half-remembered formulas. Feeding the chapter's real
 * formula/method inventory into both the writer and the solver prompt keeps
 * generation in scope and gives the answer gate a fixed reference to check
 * against.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = join(
    __dirname,
    "..",
    "..",
    "files",
    "ncert-reference",
    "mathematics",
    "jee-ncert-chapter-reference.json"
);

let cached = null;

export const loadNcertChapterReference = (filePath = DEFAULT_PATH) => {
    if (cached && cached.path === filePath) return cached.data;
    if (!existsSync(filePath)) {
        cached = { path: filePath, data: null };
        return null;
    }
    try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        cached = { path: filePath, data };
        return data;
    } catch {
        cached = { path: filePath, data: null };
        return null;
    }
};

export const isNcertChapterReferenceAvailable = () =>
    Boolean(loadNcertChapterReference());

const normalizeForMatch = (text = "") =>
    String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/** Strip the leading "1_" ordering prefix and underscores from a JSON key. */
const keyToLabel = (key = "") =>
    String(key || "")
        .replace(/^\d+_/, "")
        .replace(/_/g, " ")
        .trim();

/** All chapter entries as { key, label, data }, skipping the top-level note. */
export const getNcertChapters = () => {
    const data = loadNcertChapterReference();
    if (!data) return [];
    return Object.entries(data)
        .filter(([k, v]) => k !== "note" && v && typeof v === "object")
        .map(([key, value]) => ({
            key,
            label: keyToLabel(key),
            data: value,
        }));
};

/**
 * Token-overlap match of a chapter name against the reference keys.
 * Tolerates the naming drift between the planner ("Co-ordinate geometry",
 * "Limit, continuity and differentiability") and the JSON keys
 * ("1_Coordinate_Geometry", "2_Limit_Continuity_Differentiability").
 */
export const matchNcertChapter = (chapterName = "") => {
    const chapters = getNcertChapters();
    if (!chapters.length) return null;

    // "co-ordinate" / "coordinate" must collapse to the same token.
    const needle = normalizeForMatch(chapterName).replace(/\bco ordinate\b/g, "coordinate");
    if (!needle) return null;
    const needleTokens = needle.split(" ").filter((t) => t.length > 2);
    if (!needleTokens.length) return null;

    let best = null;
    let bestScore = 0;
    for (const ch of chapters) {
        const hay = normalizeForMatch(ch.label).replace(/\bco ordinate\b/g, "coordinate");
        const hayTokens = hay.split(" ").filter((t) => t.length > 2);
        if (!hayTokens.length) continue;

        if (hay === needle) return ch;

        // Score by shared tokens relative to the shorter side, so
        // "Limit, continuity and differentiability" still matches
        // "Limit_Continuity_Differentiability" despite the dropped "and".
        const shared = hayTokens.filter((t) =>
            needleTokens.some((n) => n === t || n.startsWith(t) || t.startsWith(n))
        ).length;
        const score = shared / Math.min(hayTokens.length, needleTokens.length);
        if (score > bestScore) {
            bestScore = score;
            best = ch;
        }
    }
    return bestScore >= 0.6 ? best : null;
};

/** Canonical reference label for a loosely-named chapter (null when unmatched). */
export const canonicalNcertChapterLabel = (chapterName = "") =>
    matchNcertChapter(chapterName)?.label || null;

const bullets = (items = [], max = 0) => {
    const list = (Array.isArray(items) ? items : []).map(String).filter(Boolean);
    const shown = max > 0 ? list.slice(0, max) : list;
    return shown.map((s) => `  - ${s}`).join("\n");
};

const chapterSection = (
    ch,
    {
        includeDifficultyPatterns = false,
        includeHardMandate = true,
    } = {}
) => {
    const d = ch.data || {};
    const parts = [`### ${ch.label}${d.ncert_source ? ` — ${d.ncert_source}` : ""}`];

    if (d.concepts?.length) {
        parts.push(`**In-scope concepts:**\n${bullets(d.concepts)}`);
    }
    if (d.formulas?.length) {
        parts.push(`**Formulas you may use (exact NCERT statements):**\n${bullets(d.formulas)}`);
    }
    if (d.standard_results?.length) {
        parts.push(`**Standard results:**\n${bullets(d.standard_results)}`);
    }
    if (d.allowed_methods?.length) {
        parts.push(`**ALLOWED solving methods (use nothing else):**\n${bullets(d.allowed_methods)}`);
    }
    if (d.constraints?.length) {
        parts.push(
            `**OUT OF NCERT SCOPE — must NOT be required to solve the question:**\n${bullets(
                d.constraints
            )}`
        );
    }
    if (d.common_traps?.length) {
        parts.push(
            `**Known error modes (these are the mistakes a careless solver makes — do NOT commit them yourself, but DO use them to build distractors):**\n${bullets(
                d.common_traps
            )}`
        );
    }
    if (d.jee_patterns?.length) {
        parts.push(`**Authentic JEE question patterns for this chapter:**\n${bullets(d.jee_patterns)}`);
    }
    // Hard-bank steering (file-backed): prefer these archetypes; never ship banned easy templates as the main ask.
    if (includeHardMandate) {
        if (d.target_difficulty) {
            parts.push(
                `**Target difficulty for hard banks:** ${d.target_difficulty}` +
                    (d.min_solve_techniques
                        ? ` (fuse ≥${d.min_solve_techniques} techniques)`
                        : "")
            );
        }
        if (d.hard_archetypes?.length) {
            parts.push(
                `**HARD ARCHETYPES — prefer one of these as the main ask (concentrated hard):**\n${bullets(
                    d.hard_archetypes
                )}`
            );
        }
        if (d.hard_techniques?.length) {
            parts.push(
                `**Hard techniques that must appear in the solve path:**\n${bullets(d.hard_techniques)}`
            );
        }
        if (d.banned_easy_templates?.length) {
            parts.push(
                `**BANNED EASY TEMPLATES — must NOT be the main ask for hard difficulty:**\n${bullets(
                    d.banned_easy_templates
                )}`
            );
        }
    }
    if (includeDifficultyPatterns && d.difficulty_patterns?.length) {
        parts.push(`**Observed JEE difficulty profile:**\n${bullets(d.difficulty_patterns)}`);
    }
    return parts.join("\n");
};

/**
 * Resolve requested chapter names to reference entries.
 * @returns {{ matched: object[], unmatched: string[] }}
 */
export const resolveNcertChapters = (chapters = []) => {
    const requested = (Array.isArray(chapters) ? chapters : [chapters])
        .map((c) => String(c || "").trim())
        .filter(Boolean);

    const matched = [];
    const unmatched = [];
    const seen = new Set();

    for (const name of requested) {
        const hit = matchNcertChapter(name);
        if (!hit) {
            unmatched.push(name);
            continue;
        }
        if (seen.has(hit.key)) continue;
        seen.add(hit.key);
        matched.push(hit);
    }
    return { matched, unmatched };
};

const isMathSubject = (subject = "") =>
    /math|algebra|calculus/i.test(String(subject || ""));

/** Content words only — drop the filler that every slot label shares. */
const STOP_TOKENS = new Set([
    "the", "and", "for", "with", "using", "via", "from", "into", "its",
    "application", "applications", "problem", "problems", "question", "questions",
    "based", "type", "direct", "theory", "multi", "concept", "hard", "medium",
    "easy", "value", "values", "find", "given", "involving", "properties",
    "property", "identity", "standard", "general", "form", "forms", "method",
    "methods", "rule", "rules", "combined", "complex", "simple",
]);

const contentTokens = (text = "") =>
    normalizeForMatch(text)
        .split(" ")
        .filter((t) => t.length > 3 && !STOP_TOKENS.has(t));

/**
 * Infer which NCERT chapters a batch touches, from the planner's concept-slot
 * labels / slot ids — matching against each chapter's own concept and formula
 * inventory rather than its title.
 *
 * A slot label like "Adjoint and Inverse identity application" shares no title
 * tokens with "Matrices and Determinants", but matches its concept entry
 * "Adjoint of a matrix, inverse via adjoint" strongly. Title matching alone
 * would miss almost every slot.
 *
 * @param {Array<string|object>} slots concept-slot strings, or objects with
 *   { chapter?, label?, conceptSlot?, description?, blueprint? }
 * @returns {object[]} matched chapter entries, most-referenced first
 */
export const inferNcertChaptersFromSlots = (slots = []) => {
    const chapters = getNcertChapters();
    if (!chapters.length) return [];

    // Pre-index each chapter's concept/formula/pattern/hard-archetype vocabulary once.
    const index = chapters.map((ch) => {
        const d = ch.data || {};
        const vocab = new Set();
        for (const list of [
            d.concepts,
            d.formulas,
            d.standard_results,
            d.jee_patterns,
            d.hard_archetypes,
            d.hard_techniques,
        ]) {
            for (const item of Array.isArray(list) ? list : []) {
                for (const t of contentTokens(item)) vocab.add(t);
            }
        }
        for (const t of contentTokens(ch.label)) vocab.add(t);
        return { chapter: ch, vocab };
    });

    const hits = new Map();
    const bump = (key, chapter, by = 1) => {
        const cur = hits.get(key) || { chapter, score: 0 };
        cur.score += by;
        hits.set(key, cur);
    };

    for (const slot of Array.isArray(slots) ? slots : []) {
        if (!slot) continue;

        // An explicit chapter on the slot is authoritative — trust it outright.
        const explicit =
            typeof slot === "object" ? String(slot.chapter || "").trim() : "";
        if (explicit) {
            const direct = matchNcertChapter(explicit);
            if (direct) {
                bump(direct.key, direct, 10);
                continue;
            }
        }

        const text =
            typeof slot === "string"
                ? slot
                : [
                      slot.label,
                      slot.conceptSlot,
                      slot.description,
                      slot.blueprint?.pattern,
                      slot.blueprint?.required,
                  ]
                      .filter(Boolean)
                      .join(" ");

        const tokens = contentTokens(text);
        if (!tokens.length) continue;

        let best = null;
        let bestScore = 0;
        for (const { chapter, vocab } of index) {
            const overlap = tokens.filter((t) => vocab.has(t)).length;
            if (overlap > bestScore) {
                bestScore = overlap;
                best = chapter;
            }
        }
        // Require ≥2 distinct concept-vocabulary hits so a single generic word
        // ("curve", "function") can't drag in an unrelated chapter.
        if (best && bestScore >= 2) bump(best.key, best, bestScore);
    }

    return [...hits.values()]
        .sort((a, b) => b.score - a.score)
        .map((h) => h.chapter);
};

/**
 * Writer-facing block: full concept/formula/method inventory for the chapters
 * being generated. Injected into the solve-first skeleton prompt.
 *
 * Returns "" when the subject is not Mathematics, no chapters were requested,
 * or the reference file is missing — never throws, never blocks generation.
 */
export const buildNcertChapterReferenceBlock = ({
    chapters = [],
    subject = "",
    includeDifficultyPatterns = true,
    includeHardMandate = true,
} = {}) => {
    if (subject && !isMathSubject(subject)) return "";
    const { matched } = resolveNcertChapters(chapters);
    if (!matched.length) return "";

    const data = loadNcertChapterReference();
    const note = String(data?.note || "").trim();

    return `
**NCERT CLASS 11 & 12 CHAPTER REFERENCE — AUTHORITATIVE (file-backed, not model memory):**
${note ? `${note}\n` : ""}
This is the complete legitimate inventory for the chapters in this batch. Rules, in priority order:
1. Every question MUST be solvable end-to-end using ONLY the concepts, formulas, standard results and allowed methods listed for its chapter.
2. If a technique appears under "OUT OF NCERT SCOPE" for that chapter, the question must NOT require it. (You may still write a question an out-of-scope shortcut happens to solve faster — but an NCERT-only path must exist and must be the one in your solution.)
3. Quote formulas in the exact form given below. Do not substitute a remembered variant — a mis-recalled formula is the single largest source of wrong answers in this pipeline.
4. Build distractors from the listed error modes, so each wrong option is what a real aspirant gets from a specific identifiable slip — never a random perturbation of the key.
5. **CONCENTRATED HARD (accuracy unchanged):** Hard difficulty comes from **fusing ≥2 listed concepts / hard_techniques**, multi-stage algebra, parameters, case splits, and the chapter's **HARD ARCHETYPES** — NOT from out-of-NCERT methods and NOT from length alone. If a chapter lists **BANNED EASY TEMPLATES**, those must never be the main ask on hard banks. Prefer hard_archetypes over generic textbook drills. Keep the correct NCERT solve path and trap-based distractors (accuracy + explanation quality must stay high).

${matched
    .map((ch) =>
        chapterSection(ch, { includeDifficultyPatterns, includeHardMandate })
    )
    .join("\n\n")}
`;
};

/**
 * Solver-facing block: compact method/formula lock for the independent answer
 * gate, so the solver re-derives with the same in-scope toolkit the writer had.
 */
export const buildNcertSolverReferenceBlock = ({
    chapters = [],
    subject = "",
} = {}) => {
    if (subject && !isMathSubject(subject)) return "";
    const { matched } = resolveNcertChapters(chapters);
    if (!matched.length) return "";

    const sections = matched.map((ch) => {
        const d = ch.data || {};
        const lines = [`### ${ch.label}`];
        if (d.formulas?.length) {
            lines.push(`Formulas:\n${bullets(d.formulas)}`);
        }
        if (d.standard_results?.length) {
            lines.push(`Standard results:\n${bullets(d.standard_results)}`);
        }
        if (d.allowed_methods?.length) {
            lines.push(`Allowed methods:\n${bullets(d.allowed_methods)}`);
        }
        if (d.common_traps?.length) {
            lines.push(`Traps to avoid while solving:\n${bullets(d.common_traps)}`);
        }
        return lines.join("\n");
    });

    return `
**NCERT REFERENCE FOR RE-DERIVATION (authoritative — use these exact formulas):**
Solve using only the methods below. If your derivation needs a formula that is not listed, you have mis-identified the concept — re-read the stem and restart. Verify your final numeric/symbolic answer against the listed "traps to avoid" before committing.

${sections.join("\n\n")}
`;
};

/** Chapter labels present in the reference file (for CLI help / validation). */
export const listNcertChapterLabels = () => getNcertChapters().map((c) => c.label);

/**
 * Compact hard-archetype steering block for planners / batch briefs.
 * Lists each chapter's hard_archetypes + banned_easy_templates so the
 * planner picks multi-step hard slots (not textbook easy drills).
 */
export const buildNcertHardArchetypePlanBlock = ({
    chapters = [],
    subject = "",
} = {}) => {
    if (subject && !isMathSubject(subject)) return "";
    let matched = resolveNcertChapters(chapters).matched;
    if (!matched.length) {
        // Full-syllabus hard banks: steer from every chapter in the file.
        matched = getNcertChapters();
    }
    if (!matched.length) return "";

    const sections = matched.map((ch) => {
        const d = ch.data || {};
        const lines = [`### ${ch.label} (target: ${d.target_difficulty || "hard"})`];
        if (d.hard_archetypes?.length) {
            lines.push(`Prefer hard archetypes:\n${bullets(d.hard_archetypes)}`);
        }
        if (d.banned_easy_templates?.length) {
            lines.push(
                `Do NOT plan slots whose main ask is:\n${bullets(d.banned_easy_templates)}`
            );
        }
        if (d.hard_techniques?.length) {
            lines.push(`Required techniques (≥2 fused):\n${bullets(d.hard_techniques)}`);
        }
        return lines.join("\n");
    });

    return `
**NCERT HARD ARCHETYPE PLAN (file-backed — concentrated hard JEE Main Maths):**
Every planned slot for hard banks MUST map to a hard_archetype below (or an equally multi-step fusion). Never plan banned easy templates as the main ask. Keep NCERT-only methods so dual solvers can still re-derive a unique correct answer with trap-based distractors.

${sections.join("\n\n")}
`;
};
