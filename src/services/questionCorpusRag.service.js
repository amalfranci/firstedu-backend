/**
 * Question-corpus RAG: retrieves similar previously-confirmed questions
 * (AiQuestion collection) as style/pattern exemplars for the skeleton
 * generation prompt. Never a topic/content source. When generationMode is
 * question_rag, a retrieval miss aborts generation (no silent ungrounded
 * fallback) — callers must have a matching confirmed/reference corpus.
 *
 * IMPORTANT: AiQuestion.subject/.topic are NOT reliably populated by the save
 * path (verified live against production data — 0 of 2028 documents have
 * either field set), so they cannot be used as a query filter. The topic that
 * actually IS populated lives one level up, on AiQuestionBank.generationTopic
 * / .name. Subject/section hard-filter uses AiQuestion.sectionIndex matched
 * against AiQuestionBank.sections[].name.
 */

import AiQuestion from "../models/AiQuestion.js";
import AiQuestionBank from "../models/AiQuestionBank.js";
import QuestionEmbeddingCache from "../models/QuestionEmbeddingCache.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { getEmbedding, getEmbeddingsBatch, cosineSimilarity } from "./embedding.service.js";
import { resolveGeminiEmbeddingModel } from "./geminiEmbeddingModels.js";
import { detectExamProfile } from "./examDifficultyCalibration.js";

const MAX_CANDIDATES = Math.min(
    800,
    Math.max(10, Number(process.env.AI_QB_QUESTION_RAG_MAX_CANDIDATES || 400))
);
const DEFAULT_K = Math.min(
    20,
    Math.max(1, Number(process.env.AI_QB_QUESTION_RAG_K || 8))
);
const MAX_MATCHING_BANKS = 50;
const SNIPPET_CHARS = 160;

/** Sticky subject RAG: only use explained past/reference questions. */
const requireNonEmptyExplanation = () =>
    process.env.AI_QB_RAG_REQUIRE_EXPLANATION !== "0" &&
    process.env.AI_QB_RAG_REQUIRE_EXPLANATION !== "false";

/** When section/subject is known, do not fall open to other subjects. */
const sectionFilterFailClosed = () =>
    process.env.AI_QB_RAG_SECTION_FAIL_OPEN !== "1" &&
    process.env.AI_QB_RAG_SECTION_FAIL_OPEN !== "true";

const hasNonEmptyExplanation = (q) =>
    Boolean(String(q?.explanation || "").trim());

/** Cosine threshold above which a generated question is treated as a near-copy. */
export const RAG_COPY_THRESHOLD = Math.min(
    0.99,
    Math.max(0.8, Number(process.env.AI_QB_QUESTION_RAG_COPY_THRESHOLD || 0.93))
);

/** Named exams only — not generic "competitive"/"board", which would over-match. */
const EXAM_PROFILE_RAG_FALLBACK = new Set([
    "jee_main",
    "jee_advanced",
    "neet",
    "cat",
    "clat",
    "upsc",
    "banking",
]);

const emptyRetrieval = (reason = "empty_query") => ({
    retrievedQuestionContextBlock: "",
    exemplarStems: [],
    exemplarSnippets: [],
    corpusTexts: [],
    ragMeta: {
        hit: false,
        reason,
        matchedBanks: 0,
        candidateCount: 0,
        returned: 0,
        sectionFiltered: false,
        queryText: "",
        rejectedNearCopies: 0,
    },
});

/**
 * Collapse UI vs ingest naming so prefix/exam matching works across:
 * - separators: `›` (UI) vs `>` (ingest scripts) vs `-`
 * - aliases: "JEE Mains" / "JEE-Mains" / "JEE Main"
 */
export const normalizeTopicKey = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/[›>/|]+/g, " > ")
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\bjee\s*mains?\b/g, "jee main")
        .replace(/\bjee\s*adv(?:anced)?\b/g, "jee advanced")
        .replace(/\s*>\s*/g, " > ")
        .replace(/\s+/g, " ")
        .trim();

/** Normalize Physics / Chem / Maths / Mathematics labels for section matching. */
export const normalizeSectionLabel = (s) => {
    const n = String(s || "")
        .toLowerCase()
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!n) return "";
    if (/^maths?(?:ematics)?$/.test(n) || n === "math") return "mathematics";
    if (/^phys(?:ics)?$/.test(n)) return "physics";
    if (/^chem(?:istry)?$/.test(n)) return "chemistry";
    if (/^bio(?:logy)?$/.test(n)) return "biology";
    return n;
};

/**
 * Bidirectional prefix match on normalized keys: covers a specific query
 * matching a broader reference bank ("...JEE Main > Physics" vs "...JEE Main")
 * and the reverse (broad query vs a more specific historical bank).
 */
export const isPrefixMatch = (fieldValue, queryValue) => {
    const a = normalizeTopicKey(fieldValue);
    const b = normalizeTopicKey(queryValue);
    if (!a || !b) return false;
    return (
        a === b ||
        a.startsWith(`${b} >`) ||
        b.startsWith(`${a} >`) ||
        a.startsWith(b) ||
        b.startsWith(a)
    );
};

export const bankMatchesQuery = (bank, { topic, bankName, queryProfile }) => {
    const topicQ = topic?.trim();
    const nameQ = bankName?.trim();
    if (topicQ && isPrefixMatch(bank.generationTopic, topicQ)) return true;
    if (topicQ && isPrefixMatch(bank.name, topicQ)) return true;
    if (nameQ && isPrefixMatch(bank.generationTopic, nameQ)) return true;
    if (nameQ && isPrefixMatch(bank.name, nameQ)) return true;

    if (EXAM_PROFILE_RAG_FALLBACK.has(queryProfile)) {
        const bankProfile = detectExamProfile({
            topic: bank.generationTopic || "",
            bankName: bank.name || "",
        });
        if (bankProfile === queryProfile) return true;
    }
    return false;
};

/** Resolve sectionIndex on a bank for a requested section/subject label. */
export const resolveBankSectionIndex = (bank, sectionOrSubject) => {
    const target = normalizeSectionLabel(sectionOrSubject);
    if (!target || !Array.isArray(bank?.sections) || !bank.sections.length) {
        return null;
    }
    const idx = bank.sections.findIndex((s) => {
        const name = normalizeSectionLabel(s?.name);
        if (!name) return false;
        return name === target || name.includes(target) || target.includes(name);
    });
    return idx >= 0 ? idx : null;
};

/**
 * Hard-filter candidates by bank sectionIndex when section/subject is known.
 * Falls back to the unfiltered pool if the filter would empty the set (fail-open).
 */
export const filterCandidatesBySection = (
    candidates,
    banksById,
    { sectionName = "", subject = "" } = {}
) => {
    const label = sectionName?.trim() || subject?.trim();
    if (!label || !candidates?.length) {
        return { filtered: candidates || [], sectionFiltered: false, fellBack: false };
    }

    const allowed = new Set();
    for (const [id, bank] of banksById.entries()) {
        const idx = resolveBankSectionIndex(bank, label);
        if (idx != null) allowed.add(`${id}:${idx}`);
    }
    if (!allowed.size) {
        return { filtered: candidates, sectionFiltered: false, fellBack: false };
    }

    const filtered = candidates.filter((c) => {
        if (c.sectionIndex == null) return false;
        return allowed.has(`${String(c.aiQuestionBank)}:${c.sectionIndex}`);
    });

    if (!filtered.length) {
        // Sticky subject: Physics gen must not silently use Chem/Math exemplars.
        if (sectionFilterFailClosed()) {
            return { filtered: [], sectionFiltered: true, fellBack: false };
        }
        return { filtered: candidates, sectionFiltered: false, fellBack: true };
    }
    return { filtered, sectionFiltered: true, fellBack: false };
};

const findMatchingBanks = async ({ topic, bankName, subject = "", sectionName = "" }) => {
    if (!topic?.trim() && !bankName?.trim()) return [];

    const banks = await AiQuestionBank.find({})
        .select("_id generationTopic name sections")
        .lean();
    const queryProfile = detectExamProfile({ topic, bankName, subject, sectionName });
    return banks
        .filter((b) => bankMatchesQuery(b, { topic, bankName, queryProfile }))
        .slice(0, MAX_MATCHING_BANKS);
};

const questionExemplarText = (q) => {
    const opts = (q.options || []).map((o) => String(o?.text || "").trim()).filter(Boolean);
    return [q.questionText, ...opts].join("\n");
};

const markedOptionLetter = (q) => {
    const idx = (q.options || []).findIndex((o) => o?.isCorrect);
    return idx >= 0 ? String.fromCharCode(65 + idx) : null;
};

const formatExemplarBlock = (candidates) => {
    const metadataOnly =
        process.env.AI_QB_RAG_METADATA_ONLY === "1" ||
        process.env.AI_QB_RAG_METADATA_ONLY === "true";

    return candidates
        .map((q, i) => {
            const opts = (q.options || [])
                .map((o, j) =>
                    String(o?.text || "").trim()
                        ? `${String.fromCharCode(65 + j)}. ${String(o?.text || "").trim()}`
                        : null
                )
                .filter(Boolean);
            const letter = markedOptionLetter(q);
            const difficulty =
                q.difficulty || q.difficultyTier || q.overallDifficulty || "";
            const concept =
                q.conceptSlot || q._conceptSlot || q.topic || q.subject || "";
            const solvingLength = String(q.explanation || "")
                .split(/(?:Step\s*\d+)/i)
                .filter(Boolean).length;

            if (metadataOnly) {
                return [
                    `Exemplar ${i + 1} (style metadata — do NOT copy content):`,
                    concept ? `Concept: ${concept}` : "",
                    difficulty ? `Difficulty example: ${difficulty}` : "",
                    q.bloomLevel || q.bloom ? `Bloom level: ${q.bloomLevel || q.bloom}` : "",
                    `Distractor pattern: ${opts.length} options; near-miss / adjacent-concept traps preferred`,
                    solvingLength > 1
                        ? `Expected solving length: ~${solvingLength} steps`
                        : "Expected solving length: short",
                    q.timeEstimate
                        ? `Time estimate example: ${q.timeEstimate}`
                        : "",
                    `Common mistakes to target in distractors: sign error, unit slip, adjacent formula, incomplete condition`,
                    `Formula constraint: keep exam-legal relations for this concept only`,
                    q._id ? `Prior question id: ${q._id}` : "",
                    `Stem texture: ${stemSnippet(q.questionText)}`,
                    String(q.explanation || "").trim()
                        ? `Explanation texture: ${stemSnippet(q.explanation)}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n");
            }

            return [
                `Exemplar ${i + 1}:`,
                `Question: ${q.questionText}`,
                opts.join("\n"),
                letter ? `Correct: ${letter}` : "",
                difficulty ? `Difficulty: ${difficulty}` : "",
                concept ? `Concept: ${concept}` : "",
                String(q.explanation || "").trim()
                    ? `Explanation texture: ${stemSnippet(q.explanation)}`
                    : "",
            ]
                .filter(Boolean)
                .join("\n");
        })
        .join("\n\n");
};
const stemSnippet = (text) => {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length <= SNIPPET_CHARS ? s : `${s.slice(0, SNIPPET_CHARS - 1)}…`;
};

const buildRetrievalQueryText = ({
    topic = "",
    subject = "",
    sectionName = "",
    conceptHints = [],
} = {}) => {
    const hints = (conceptHints || [])
        .map((h) => String(h || "").trim())
        .filter(Boolean)
        .slice(0, 8);
    return [topic, subject, sectionName, ...hints].filter(Boolean).join(" — ");
};

/**
 * Lazily embed+cache any candidates missing a cached embedding at the
 * currently-resolved model, batched in one call. Upsert avoids races when
 * concurrent requests embed the same question simultaneously.
 */
const ensureEmbeddings = async (candidates, model) => {
    const ids = candidates.map((c) => c._id);
    const cached = await QuestionEmbeddingCache.find({
        questionId: { $in: ids },
        embeddingModel: model,
    }).lean();
    const cachedById = new Map(cached.map((c) => [String(c.questionId), c.embedding]));

    const missing = candidates.filter((c) => !cachedById.has(String(c._id)));
    if (missing.length) {
        const texts = missing.map(questionExemplarText);
        const vectors = await getEmbeddingsBatch(texts, { taskType: "RETRIEVAL_DOCUMENT" });
        await Promise.all(
            missing.map((c, i) =>
                QuestionEmbeddingCache.findOneAndUpdate(
                    { questionId: c._id },
                    { questionId: c._id, embedding: vectors[i], embeddingModel: model },
                    { upsert: true, new: true }
                ).catch(() => null)
            )
        );
        missing.forEach((c, i) => cachedById.set(String(c._id), vectors[i]));
    }

    return cachedById;
};

/**
 * Drop generated questions whose embedding is too close to any corpus exemplar.
 * Fail-open: on embed errors, keep all questions.
 *
 * @returns {Promise<{ kept: object[], rejected: object[], rejectedNearCopies: number }>}
 */
export const rejectNearCorpusDuplicates = async (
    questions = [],
    {
        corpusTexts = [],
        threshold = RAG_COPY_THRESHOLD,
    } = {}
) => {
    const list = Array.isArray(questions) ? questions : [];
    const corpus = (corpusTexts || []).map((t) => String(t || "").trim()).filter(Boolean);
    if (!list.length || !corpus.length) {
        return { kept: list, rejected: [], rejectedNearCopies: 0 };
    }

    try {
        const genTexts = list.map((q) => questionExemplarText(q));
        const [genVectors, corpusVectors] = await Promise.all([
            getEmbeddingsBatch(genTexts, { taskType: "RETRIEVAL_DOCUMENT" }),
            getEmbeddingsBatch(corpus, { taskType: "RETRIEVAL_DOCUMENT" }),
        ]);

        const kept = [];
        const rejected = [];
        list.forEach((q, i) => {
            const gv = genVectors[i] || [];
            let maxScore = 0;
            let matchedStem = "";
            corpusVectors.forEach((cv, j) => {
                const score = cosineSimilarity(gv, cv || []);
                if (score > maxScore) {
                    maxScore = score;
                    matchedStem = corpus[j];
                }
            });
            if (maxScore >= threshold) {
                rejected.push({
                    question: q,
                    maxScore,
                    matchedStem: stemSnippet(matchedStem),
                });
            } else {
                kept.push(q);
            }
        });

        if (rejected.length) {
            pipelineTrace("QUESTION_RAG_NEAR_COPY_REJECTED", {
                rejected: rejected.length,
                kept: kept.length,
                threshold,
                scores: rejected.map((r) => Number(r.maxScore.toFixed(3))),
            });
        }

        return {
            kept,
            rejected,
            rejectedNearCopies: rejected.length,
        };
    } catch (err) {
        pipelineTrace("QUESTION_RAG_NEAR_COPY_CHECK_FAILED", {
            error: err?.message || String(err),
        });
        return { kept: list, rejected: [], rejectedNearCopies: 0 };
    }
};

/**
 * @returns {Promise<{
 *   retrievedQuestionContextBlock: string,
 *   exemplarStems: string[],
 *   exemplarSnippets: string[],
 *   corpusTexts: string[],
 *   ragMeta: object
 * }>}
 */
export const retrieveSimilarConfirmedQuestions = async ({
    topic = "",
    bankName = "",
    subject = "",
    sectionName = "",
    conceptHints = [],
    difficulty = "",
    k = DEFAULT_K,
} = {}) => {
    if (!topic?.trim() && !bankName?.trim()) return emptyRetrieval("empty_query");

    try {
        const matchedBanks = await findMatchingBanks({
            topic,
            bankName,
            subject,
            sectionName,
        });
        if (!matchedBanks.length) {
            pipelineTrace("QUESTION_RAG_RETRIEVAL_EMPTY", {
                topic,
                bankName,
                subject,
                sectionName,
                normalizedTopic: normalizeTopicKey(topic),
                queryProfile: detectExamProfile({
                    topic,
                    bankName,
                    subject,
                    sectionName,
                }),
                reason: "no_matching_bank",
            });
            return emptyRetrieval("no_matching_bank");
        }

        const bankIds = matchedBanks.map((b) => b._id);
        const banksById = new Map(matchedBanks.map((b) => [String(b._id), b]));

        const explainedOnly = requireNonEmptyExplanation();
        const findFilter = {
            aiQuestionBank: { $in: bankIds },
            isActive: true,
            questionType: "single",
            ...(explainedOnly
                ? {
                      explanation: {
                          $exists: true,
                          $type: "string",
                          $ne: "",
                      },
                  }
                : {}),
        };

        let candidates = await AiQuestion.find(findFilter)
            .limit(MAX_CANDIDATES)
            .lean();

        if (explainedOnly) {
            const beforeExpl = candidates.length;
            candidates = candidates.filter(hasNonEmptyExplanation);
            if (beforeExpl !== candidates.length) {
                pipelineTrace("QUESTION_RAG_EMPTY_EXPLANATION_STRIPPED", {
                    before: beforeExpl,
                    after: candidates.length,
                });
            }
        }

        if (!candidates.length) {
            pipelineTrace("QUESTION_RAG_RETRIEVAL_EMPTY", {
                topic,
                bankName,
                subject,
                sectionName,
                reason: explainedOnly
                    ? "no_explained_questions"
                    : "no_matching_questions",
            });
            return emptyRetrieval(
                explainedOnly ? "no_explained_questions" : "no_matching_questions"
            );
        }

        const {
            filtered,
            sectionFiltered,
            fellBack,
        } = filterCandidatesBySection(candidates, banksById, {
            sectionName,
            subject,
        });
        if (fellBack) {
            pipelineTrace("QUESTION_RAG_SECTION_FILTER_FALLBACK", {
                sectionName,
                subject,
                before: candidates.length,
            });
        }
        if (!filtered.length && (sectionName || subject)) {
            pipelineTrace("QUESTION_RAG_RETRIEVAL_EMPTY", {
                topic,
                bankName,
                subject,
                sectionName,
                reason: "section_filter_empty",
                beforeSection: candidates.length,
            });
            return emptyRetrieval("section_filter_empty");
        }
        candidates = filtered;

        // Phase C2: prefer candidates matching requested difficulty tier when set.
        const wantTier = String(difficulty || "").toLowerCase().trim();
        if (wantTier === "easy" || wantTier === "medium" || wantTier === "hard") {
            const tierMatched = candidates.filter((c) => {
                const d = String(
                    c.difficulty || c.difficultyTier || ""
                ).toLowerCase();
                return d === wantTier;
            });
            if (tierMatched.length >= Math.min(4, k)) {
                candidates = tierMatched;
            }
        }

        const model = resolveGeminiEmbeddingModel();
        const embeddingsById = await ensureEmbeddings(candidates, model);
        const queryText = buildRetrievalQueryText({
            topic,
            subject,
            sectionName,
            conceptHints: difficulty
                ? [...(conceptHints || []), `${difficulty}-tier`]
                : conceptHints,
        });
        const queryVector = await getEmbedding(queryText, { taskType: "RETRIEVAL_QUERY" });

        const rankedScored = candidates
            .map((c) => ({
                question: c,
                score: cosineSimilarity(queryVector, embeddingsById.get(String(c._id)) || []),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);

        const ranked = rankedScored.map((r) => r.question);
        const exemplarStems = ranked.map((q) => q.questionText).filter(Boolean);
        const corpusTexts = ranked.map(questionExemplarText).filter(Boolean);
        const exemplarSnippets = exemplarStems.map(stemSnippet);

        const ragMeta = {
            hit: ranked.length > 0,
            reason: ranked.length ? "ok" : "no_ranked_results",
            matchedBanks: matchedBanks.length,
            candidateCount: candidates.length,
            returned: ranked.length,
            sectionFiltered,
            queryText,
            rejectedNearCopies: 0,
            topScores: rankedScored.map((r) => Number(r.score.toFixed(3))),
        };

        pipelineTrace("QUESTION_RAG_RETRIEVAL_DONE", {
            topic,
            subject,
            sectionName,
            matchedBanks: ragMeta.matchedBanks,
            candidateCount: ragMeta.candidateCount,
            returned: ragMeta.returned,
            sectionFiltered,
            queryHints: (conceptHints || []).length,
        });

        return {
            retrievedQuestionContextBlock: formatExemplarBlock(ranked),
            exemplarStems,
            exemplarSnippets,
            corpusTexts,
            ragMeta,
        };
    } catch (err) {
        pipelineTrace("QUESTION_RAG_RETRIEVAL_FAILED", {
            topic,
            subject,
            sectionName,
            error: err?.message || String(err),
        });
        return emptyRetrieval("retrieval_failed");
    }
};

export const mergeRagMeta = (acc, next) => {
    if (!next) return acc || null;
    if (!acc) return { ...next };
    return {
        hit: Boolean(acc.hit || next.hit),
        reason: acc.hit ? acc.reason : next.reason,
        matchedBanks: Math.max(acc.matchedBanks || 0, next.matchedBanks || 0),
        candidateCount: (acc.candidateCount || 0) + (next.candidateCount || 0),
        returned: (acc.returned || 0) + (next.returned || 0),
        sectionFiltered: Boolean(acc.sectionFiltered || next.sectionFiltered),
        queryText: acc.queryText || next.queryText || "",
        rejectedNearCopies:
            (acc.rejectedNearCopies || 0) + (next.rejectedNearCopies || 0),
        exemplarSnippets: [
            ...(acc.exemplarSnippets || []),
            ...(next.exemplarSnippets || []),
        ].slice(0, 12),
        topScores: [...(acc.topScores || []), ...(next.topScores || [])].slice(0, 12),
    };
};
