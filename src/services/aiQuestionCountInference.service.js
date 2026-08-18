import { detectExamProfile, detectCatSection } from "./examDifficultyCalibration.js";
import { resolveGenerationSubject } from "./subjectDetection.js";
import { buildExamCountStyleHint } from "./examPromptContext.service.js";
import { parseCategoryScope } from "./subjectDetection.js";
import { countSelectableSlots } from "./difficultyMix.service.js";

/** Max API items in a single LLM generation CALL (chunk ceiling). */
export const MAX_API_ITEMS_PER_REQUEST = 30;

/**
 * Max TOTAL API items for one "generate" request. The requested total is split
 * into chunks of ≤ MAX_API_ITEMS_PER_REQUEST and generated across multiple LLM
 * calls, so the total is NOT limited to a single call's size. Previously the
 * per-call ceiling (30) was wrongly reused as the total clamp, capping a 45-slot
 * request at 30 — this decouples them. Configurable via AI_QB_MAX_TOTAL_API_ITEMS.
 */
export const MAX_TOTAL_API_ITEMS = Math.max(
    MAX_API_ITEMS_PER_REQUEST,
    Math.min(300, Math.max(1, Number(process.env.AI_QB_MAX_TOTAL_API_ITEMS ?? 100)))
);

/** Max API items per LLM generation call (mirrors frontend `splitAiSuggestionCountsIntoChunks`). */
export const QB_GENERATION_CHUNK_SIZE = Math.min(
    MAX_API_ITEMS_PER_REQUEST,
    Math.max(
        1,
        Number(
            process.env.AI_QB_GENERATION_CHUNK_SIZE ??
                process.env.GEMINI_QB_GENERATION_CHUNK_SIZE ??
                10
        )
    )
);

/** API items = standalones + passage parents (not sub-questions). */
export const countApiItemsFromQuestionCounts = ({
    singleCount = 0,
    multipleCount = 0,
    trueFalseCount = 0,
    passageCount = 0,
    connectedCount = 0,
} = {}) => {
    const passage = passageCount || connectedCount || 0;
    return (
        (singleCount || 0) +
        (multipleCount || 0) +
        (trueFalseCount || 0) +
        passage
    );
};

/**
 * Split requested counts into chunks of at most `chunkSize` API items
 * (each standalone question or passage parent counts as one API item).
 */
export const splitQuestionBankCountsIntoChunks = (
    counts = {},
    chunkSize = QB_GENERATION_CHUNK_SIZE
) => {
    const size = Math.max(1, Math.min(MAX_API_ITEMS_PER_REQUEST, chunkSize));
    const normalized = {
        // Totals are clamped to the TOTAL ceiling, not the per-call one — the
        // loop below splits them into chunks of `size` (≤ per-call ceiling).
        singleCount: clampInt(counts.singleCount, 0, MAX_TOTAL_API_ITEMS),
        multipleCount: clampInt(counts.multipleCount, 0, MAX_TOTAL_API_ITEMS),
        trueFalseCount: clampInt(counts.trueFalseCount, 0, MAX_TOTAL_API_ITEMS),
        passageCount: clampInt(
            counts.passageCount ?? counts.connectedCount,
            0,
            MAX_TOTAL_API_ITEMS
        ),
        passageSingleCount: clampInt(
            counts.passageSingleCount,
            0,
            MAX_API_ITEMS_PER_REQUEST
        ),
        passageMultipleCount: clampInt(
            counts.passageMultipleCount,
            0,
            MAX_API_ITEMS_PER_REQUEST
        ),
        passageTrueFalseCount: clampInt(
            counts.passageTrueFalseCount,
            0,
            MAX_API_ITEMS_PER_REQUEST
        ),
    };

    const apiItemCount = countApiItemsFromQuestionCounts(normalized);
    if (apiItemCount <= 0) return [];
    if (apiItemCount <= size) return [normalized];

    const remaining = { ...normalized };
    const chunks = [];

    while (countApiItemsFromQuestionCounts(remaining) > 0) {
        const chunk = {
            singleCount: 0,
            multipleCount: 0,
            trueFalseCount: 0,
            passageCount: 0,
            passageSingleCount: remaining.passageSingleCount,
            passageMultipleCount: remaining.passageMultipleCount,
            passageTrueFalseCount: remaining.passageTrueFalseCount,
        };
        let slots = size;

        for (const key of ["singleCount", "multipleCount", "trueFalseCount"]) {
            if (slots <= 0) break;
            const take = Math.min(remaining[key], slots);
            if (take > 0) {
                chunk[key] = take;
                remaining[key] -= take;
                slots -= take;
            }
        }

        if (slots > 0 && remaining.passageCount > 0) {
            const takePassages = Math.min(remaining.passageCount, slots);
            if (takePassages > 0) {
                chunk.passageCount = takePassages;
                remaining.passageCount -= takePassages;
                slots -= takePassages;
            }
        }

        if (countApiItemsFromQuestionCounts(chunk) <= 0) break;
        chunks.push(chunk);
    }

    return chunks;
};

/** Pre-compute difficulty-tier slot offset for each chunk (for parallel generation). */
export const computeChunkTierOffsets = (chunks = []) => {
    const offsets = [];
    let acc = 0;
    for (const chunk of chunks) {
        offsets.push(acc);
        acc += countSelectableSlots(chunk);
    }
    return offsets;
};

export const isParallelChunkGenerationEnabled = () =>
    process.env.AI_QB_PARALLEL_CHUNK_GENERATION !== "0";

/** Max concurrent LLM chunk calls — keep low to reduce Gemini 503 rate limits. */
export const QB_PARALLEL_CHUNK_CONCURRENCY = Math.max(
    1,
    Math.min(
        6,
        Number(process.env.AI_QB_PARALLEL_CHUNK_CONCURRENCY ?? 2)
    )
);

/**
 * Run async task factories with a concurrency cap; results preserve task order.
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
export const runTasksWithConcurrency = async (tasks = [], concurrency = 2) => {
    const list = Array.isArray(tasks) ? tasks : [];
    if (!list.length) return [];
    const limit = Math.max(1, Math.min(concurrency, list.length));
    const results = new Array(list.length);
    let cursor = 0;

    const worker = async () => {
        while (cursor < list.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await list[index]();
        }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
};

export const isQuestionBankCountsMissing = ({
    singleCount = 0,
    multipleCount = 0,
    trueFalseCount = 0,
    passageCount = 0,
    connectedCount = 0,
    passageSingleCount = 0,
    passageMultipleCount = 0,
    passageTrueFalseCount = 0,
} = {}) => {
    const resolvedPassageCount = passageCount || connectedCount || 0;
    const standaloneTotal = singleCount + multipleCount + trueFalseCount;
    const passageSubTotal =
        passageSingleCount + passageMultipleCount + passageTrueFalseCount;
    const apiItemTotal = standaloneTotal + resolvedPassageCount;
    const selectableTotal = standaloneTotal + resolvedPassageCount * passageSubTotal;
    return apiItemTotal < 1 && selectableTotal < 1;
};

const clampInt = (n, min, max) =>
    Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

export const getCountInferenceContext = ({
    topic,
    bankName = "",
    difficulty = "medium",
    sectionName = "",
    subject = "",
    categoryPaths = [],
    maxSelectableSlots = 0,
} = {}) => {
    const resolvedSubject = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });
    const examProfile = detectExamProfile({
        bankName,
        topic,
        subject: resolvedSubject.id || subject,
        sectionName,
        categoryPaths,
    });
    const catSection = detectCatSection({ topic, bankName, sectionName, categoryPaths });
    const maxApiItems = MAX_TOTAL_API_ITEMS;
    const slotTarget = Math.max(
        1,
        Math.min(
            maxApiItems,
            Number(maxSelectableSlots) > 0 ? Number(maxSelectableSlots) : 10
        )
    );
    return {
        resolvedSubject,
        examProfile,
        catSection,
        maxApiItems,
        maxSelectableSlots: slotTarget,
        difficulty,
    };
};

export const countSelectableFromPlan = (plan) => {
    const passageSub =
        (plan.passageSingleCount || 0) +
        (plan.passageMultipleCount || 0) +
        (plan.passageTrueFalseCount || 0);
    return (
        (plan.singleCount || 0) +
        (plan.multipleCount || 0) +
        (plan.trueFalseCount || 0) +
        (plan.passageCount || 0) * passageSub
    );
};

/** Realistic one-batch sizes by exam/topic — paired with maxSelectableSlots in the prompt. */
const buildTopicRealisticCountHint = (hintKey, maxSelectableSlots) => {
    const n = Math.max(1, Number(maxSelectableSlots) || 10);
    const byProfile = {
        cat_varc: `CAT VARC: ~65% Reading Comprehension via passages (4 sub-Q each) + ~35% VA singles (Para Jumbles, Odd Sentence Out, Para Summary). Total selectable = ${n}. NOT grammar/vocabulary/GMAT items.`,
        cat_qa: `CAT QA: ${n} standalone single-choice MCQs.`,
        cat_dilr: `CAT DILR: ${n} selectable questions via linked set(s) and/or standalone singles.`,
        cat_general: `CAT practice batch: ${n} selectable questions (passages/sets if VARC/DILR; otherwise standalone singles).`,
        jee_main: `JEE Main topic drill: ${n} single-choice MCQs.`,
        jee_advanced: `JEE Advanced topic drill: ${n} questions (mostly single-choice; multi-correct only if the topic needs it).`,
        neet: `NEET topic drill: ${n} single-choice MCQs.`,
        board: `School board topic test: ${n} questions.`,
        competitive: `Competitive exam topic drill: ${n} single-choice MCQs.`,
    };
    return byProfile[hintKey] || byProfile.competitive;
};

export const buildCountPlanGuidanceBlock = ({
    topic,
    bankName = "",
    difficulty = "medium",
    sectionName = "",
    subject = "",
    categoryPaths = [],
    examProfile,
    catSection,
    maxApiItems,
    maxSelectableSlots = 10,
} = {}) => {
    const slotTarget = Math.max(
        1,
        Math.min(maxApiItems, Number(maxSelectableSlots) || 10)
    );
    const hintKey = catSection || examProfile;
    const { trail } = parseCategoryScope(
        categoryPaths?.length ? categoryPaths : []
    );
    const resolved = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths: categoryPaths || [],
        subject,
    });
    const examNote = buildExamCountStyleHint({
        examProfile,
        catSection,
        topic,
        bankName,
        sectionName,
        categoryPaths: categoryPaths || [],
        categoryTrail: trail,
        subjectLabel: resolved.label,
    });
    const countHint = buildTopicRealisticCountHint(hintKey, slotTarget);

    return `**COUNT PLANNING (no counts were sent — you decide from topic, exam, and empty bank slots):**
Topic: ${topic}
${bankName ? `Bank: ${bankName}\n` : ""}${subject ? `Subject: ${subject}\n` : ""}${sectionName ? `Section: ${sectionName}\n` : ""}Difficulty: ${difficulty}
Exam profile: ${examProfile}${catSection ? ` (${catSection})` : ""}

**How many questions to generate:**
- This section has **${slotTarget} empty question slot(s)** in the bank — your plan must yield **${slotTarget} selectable questions** (standalone + passage sub-questions).
- Base the mix on exam style and topic scope, but **do not under-fill** — counts like 6–8 are too low when ${slotTarget} slots are available.
- Do NOT output a full official exam section in one call (e.g. CAT VARC ~24, CAT QA ~22, full JEE paper).
- Target for this profile: ${countHint}
- Hard ceiling: API items (standalone + passages) ≤ ${maxApiItems}; selectable questions ≤ ${slotTarget}
- Question style: ${examNote}

Plan rules:
- Integers ≥ 0; at least 1 selectable question
- **Hard-first + syllabus breadth:** prioritize exam-difficult micro-topics (~70%) while spanning distinct syllabus units (~30%) — not one chapter only
- **Standalone questions must be single-choice MCQs only** (multipleCount = 0, trueFalseCount = 0)
- Reading passages only when the topic needs them (e.g. CAT VARC); passage sub-questions single-choice only (passageMultipleCount = 0, passageTrueFalseCount = 0)
- If passageCount > 0, passageSingleCount ≥ 1 per passage
- If passageCount = 0, all passage sub-counts must be 0
- In "plan.rationale", briefly say why this count fits the topic and exam`;
};

/** Fallback when AI omits or invalidates plan — fill available bank slots for exam profile. */
export const suggestRealisticDefaultPlan = ({
    catSection = null,
    examProfile = "competitive",
    maxApiItems,
    maxSelectableSlots = 10,
} = {}) => {
    const key = catSection || examProfile || "competitive";
    const slotTarget = Math.max(
        1,
        Math.min(maxApiItems, Number(maxSelectableSlots) || 10)
    );

    const rawByProfile = {
        cat_varc: {
            passageCount: slotTarget >= 8 ? 2 : 1,
            passageSingleCount: Math.ceil(slotTarget / (slotTarget >= 8 ? 2 : 1)),
        },
        cat_qa: { singleCount: slotTarget },
        cat_dilr: {
            passageCount: 1,
            passageSingleCount: slotTarget,
        },
        cat_general: { singleCount: slotTarget },
        jee_main: { singleCount: slotTarget },
        jee_advanced: { singleCount: slotTarget },
        neet: { singleCount: slotTarget },
        board: { singleCount: slotTarget },
        competitive: { singleCount: slotTarget },
    };

    const raw = rawByProfile[key] || rawByProfile.competitive;
    const plan = normalizeInferredPlan(raw, maxApiItems, {
        maxSelectableSlots: slotTarget,
    });

    if (!plan.rationale) {
        plan.rationale = `Default ${countSelectableFromPlan(plan)}-question batch for ${key.replace(/_/g, " ")}.`;
    }
    return plan;
};

/** Normalize plan object from a combined generate response. */
export const normalizeInferredPlan = (
    plan,
    maxApiItems,
    { singleChoiceOnly = true, maxSelectableSlots = 0 } = {}
) => {
    const parsed = plan && typeof plan === "object" ? plan : {};
    let singleCount = clampInt(parsed.singleCount, 0, maxApiItems);
    let multipleCount = clampInt(parsed.multipleCount, 0, maxApiItems);
    let trueFalseCount = clampInt(parsed.trueFalseCount, 0, maxApiItems);
    let passageCount = clampInt(parsed.passageCount, 0, 10);
    let passageSingleCount = clampInt(parsed.passageSingleCount, 0, 30);
    let passageMultipleCount = clampInt(parsed.passageMultipleCount, 0, 30);
    let passageTrueFalseCount = clampInt(parsed.passageTrueFalseCount, 0, 30);

    if (singleChoiceOnly) {
        singleCount += multipleCount + trueFalseCount;
        multipleCount = 0;
        trueFalseCount = 0;
        passageSingleCount += passageMultipleCount + passageTrueFalseCount;
        passageMultipleCount = 0;
        passageTrueFalseCount = 0;
    }

    const passageSubTotal =
        passageSingleCount + passageMultipleCount + passageTrueFalseCount;

    if (passageCount > 0 && passageSubTotal < 1) {
        passageSingleCount = 2;
    }
    if (passageCount === 0) {
        passageSingleCount = 0;
        passageMultipleCount = 0;
        passageTrueFalseCount = 0;
    }

    let apiItemTotal = singleCount + multipleCount + trueFalseCount + passageCount;

    if (apiItemTotal < 1) {
        const slotTarget = Math.max(
            1,
            Math.min(
                maxApiItems,
                Number(maxSelectableSlots) > 0 ? Number(maxSelectableSlots) : 10
            )
        );
        singleCount = Math.min(slotTarget, maxApiItems);
        apiItemTotal = singleCount;
    }

    const slotTarget = Math.max(
        0,
        Math.min(maxApiItems, Number(maxSelectableSlots) || 0)
    );
    if (slotTarget > 0 && singleChoiceOnly) {
        let selectable = countSelectableFromPlan({
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
        });
        if (selectable < slotTarget) {
            if (passageCount === 0) {
                singleCount = Math.min(slotTarget, maxApiItems);
            } else {
                const deficit = slotTarget - selectable;
                const roomForStandalone =
                    singleCount + passageCount + deficit <= maxApiItems;
                if (roomForStandalone) {
                    singleCount += deficit;
                } else {
                    passageSingleCount += Math.ceil(deficit / passageCount);
                }
            }
            apiItemTotal =
                singleCount + multipleCount + trueFalseCount + passageCount;
        }
    }

    while (apiItemTotal > maxApiItems) {
        if (passageCount > 0) {
            passageCount -= 1;
        } else if (trueFalseCount > 0) {
            trueFalseCount -= 1;
        } else if (multipleCount > 0) {
            multipleCount -= 1;
        } else if (singleCount > 1) {
            singleCount -= 1;
        } else {
            break;
        }
        apiItemTotal = singleCount + multipleCount + trueFalseCount + passageCount;
    }

    const rationale = String(parsed.rationale || "").trim();

    return {
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
        rationale,
        apiItemTotal:
            singleCount + multipleCount + trueFalseCount + passageCount,
    };
};
