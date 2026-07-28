/**
 * Phase C — Question Blueprint Planner.
 * Produces structured per-slot plans that generation fills 1:1.
 */

import {
    allocateDifficultyMix,
    buildDifficultyTierSlots,
} from "./difficultyMix.service.js";
import {
    getKindCompositionCounts,
    normalizeQuestionKind,
} from "./conceptArchetypePlanner.service.js";

const BLOOMS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];

const ESTIMATED_TIME = {
    easy: 2,
    medium: 3,
    hard: 4.5,
};

const normalizeDifficulty = (d, fallback = "hard") => {
    const v = String(d || fallback).toLowerCase().trim();
    if (v === "easy" || v === "medium" || v === "hard") return v;
    return fallback;
};

const normalizeBlooms = (raw, difficulty = "hard") => {
    const s = String(raw || "").trim();
    const hit = BLOOMS.find((b) => b.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
    if (difficulty === "easy") return "Understand";
    if (difficulty === "medium") return "Apply";
    return "Analyze";
};

const normalizeType = (raw = "single") => {
    const v = String(raw || "single").toLowerCase();
    if (v === "multiple" || v === "true_false" || v === "connected") return v;
    return "single";
};

/**
 * Enrich existing slotPlans into full blueprints (deterministic — no LLM).
 */
export const enrichSlotPlansToBlueprints = (
    slotPlans = [],
    {
        topic = "",
        bankDifficulty = "hard",
        examProfile = "competitive",
        examCalibrated = false,
        catSection = null,
        subject = "",
    } = {}
) => {
    const n = Math.max(0, slotPlans.length);
    if (!n) return [];

    const mixOpts = { examProfile, examCalibrated };
    const tiers = buildDifficultyTierSlots(n, bankDifficulty, mixOpts);
    const kinds = getKindCompositionCounts({
        examProfile,
        subject,
        catSection,
        count: n,
    });

    // Assign kinds in order when slot lacks questionKind
    const kindQueue = [
        ...Array(kinds.theory || 0).fill("theory"),
        ...Array(kinds.direct || 0).fill("direct"),
        ...Array(kinds.multi_concept || 0).fill("multi_concept"),
    ];
    while (kindQueue.length < n) kindQueue.push("multi_concept");

    return slotPlans.map((plan, i) => {
        const difficulty = normalizeDifficulty(
            plan.difficulty || tiers[i] || bankDifficulty,
            bankDifficulty
        );
        const questionKind = normalizeQuestionKind(
            plan.questionKind || kindQueue[i] || "multi_concept"
        );
        const concept =
            plan.label ||
            String(plan.conceptSlot || "").replace(/_/g, " ") ||
            `Concept ${i + 1}`;
        return {
            topic: String(plan.topic || topic || "").trim() || topic,
            concept,
            conceptSlot: plan.conceptSlot || `slot_${i + 1}`,
            difficulty,
            type: normalizeType(plan.type),
            estimatedTime:
                Number(plan.estimatedTime) ||
                ESTIMATED_TIME[difficulty] ||
                4,
            blooms: normalizeBlooms(plan.blooms, difficulty),
            questionKind,
            label: concept,
            blueprint: plan.blueprint || {
                pattern: "",
                required: "",
                banned: "",
                stemHint: "",
            },
            index: i,
        };
    });
};

/**
 * Convert blueprints back to presetSteering shape (backward compatible).
 */
export const blueprintsToPresetSteering = (blueprints = [], source = "blueprint") => {
    const slotPlans = blueprints.map((b) => ({
        conceptSlot: b.conceptSlot,
        label: b.label || b.concept,
        questionKind: b.questionKind || "multi_concept",
        difficulty: b.difficulty,
        type: b.type || "single",
        estimatedTime: b.estimatedTime,
        blooms: b.blooms,
        topic: b.topic,
        blueprint: b.blueprint || {},
    }));
    return {
        conceptSlots: slotPlans.map((p) => p.conceptSlot),
        slotPlans,
        blueprints,
        source,
    };
};

/**
 * Build authoritative exam blueprint distribution (subject × difficulty).
 * Never leave distribution to the free model.
 */
export const buildExamBlueprintDistribution = ({
    totalSlots = 10,
    bankDifficulty = "hard",
    examProfile = "competitive",
    examCalibrated = false,
    subjects = [],
} = {}) => {
    const n = Math.max(1, Number(totalSlots) || 10);
    const mix = allocateDifficultyMix(n, bankDifficulty, {
        examProfile,
        examCalibrated,
    });

    const subjectList = Array.isArray(subjects) && subjects.length
        ? subjects
        : [{ id: "general", label: "General", count: n }];

    const subjectCounts = subjectList.map((s) => ({
        id: s.id || s.label,
        label: s.label || s.id,
        count: Math.max(0, Number(s.count) || 0),
    }));
    const assigned = subjectCounts.reduce((a, s) => a + s.count, 0);
    if (assigned !== n && subjectCounts.length) {
        // Normalize to totalSlots
        let remaining = n;
        subjectCounts.forEach((s, i) => {
            if (i === subjectCounts.length - 1) {
                s.count = remaining;
            } else {
                s.count = Math.max(
                    1,
                    Math.round((s.count / Math.max(1, assigned)) * n)
                );
                remaining -= s.count;
            }
        });
        if (remaining !== 0 && subjectCounts.length) {
            subjectCounts[subjectCounts.length - 1].count = Math.max(
                0,
                subjectCounts[subjectCounts.length - 1].count + remaining
            );
        }
    }

    return {
        totalSlots: n,
        subjects: Object.fromEntries(
            subjectCounts.map((s) => [s.label || s.id, s.count])
        ),
        difficulty: {
            Easy: mix.easy || 0,
            Medium: mix.medium || 0,
            Hard: mix.hard || 0,
        },
        mix,
    };
};

/**
 * Coverage checker: expected blueprint slots vs generated questions.
 */
export const checkBlueprintCoverage = (
    blueprints = [],
    questions = [],
    { examDistribution = null } = {}
) => {
    const expectedByConcept = new Map();
    for (const b of blueprints) {
        const key = String(b.conceptSlot || b.concept || "").toLowerCase();
        if (!key) continue;
        expectedByConcept.set(key, (expectedByConcept.get(key) || 0) + 1);
    }

    const generatedByConcept = new Map();
    for (const q of questions) {
        const key = String(
            q._conceptSlot || q.conceptSlot || q._blueprint?.conceptSlot || ""
        ).toLowerCase();
        if (!key) continue;
        generatedByConcept.set(key, (generatedByConcept.get(key) || 0) + 1);
    }

    const missing = [];
    const surplus = [];
    for (const [key, expected] of expectedByConcept) {
        const got = generatedByConcept.get(key) || 0;
        if (got < expected) {
            missing.push({ conceptSlot: key, expected, generated: got });
        } else if (got > expected) {
            surplus.push({ conceptSlot: key, expected, generated: got });
        }
    }

    const difficultyExpected = examDistribution?.difficulty || null;
    const difficultyGenerated = { Easy: 0, Medium: 0, Hard: 0 };
    for (const q of questions) {
        const d = String(
            q.difficulty || q.difficultyTier || q._blueprint?.difficulty || ""
        ).toLowerCase();
        if (d === "easy") difficultyGenerated.Easy += 1;
        else if (d === "medium") difficultyGenerated.Medium += 1;
        else if (d === "hard") difficultyGenerated.Hard += 1;
    }

    const difficultyGaps = [];
    if (difficultyExpected) {
        for (const tier of ["Easy", "Medium", "Hard"]) {
            const exp = Number(difficultyExpected[tier] || 0);
            const got = difficultyGenerated[tier] || 0;
            if (got < exp) {
                difficultyGaps.push({ tier, expected: exp, generated: got });
            }
        }
    }

    const ok = missing.length === 0 && difficultyGaps.length === 0;
    return {
        ok,
        expectedCount: blueprints.length,
        generatedCount: questions.length,
        missing,
        surplus,
        difficultyGaps,
        difficultyGenerated,
    };
};

/**
 * Prompt block: compact planner output fed into generation (Phase C3).
 */
export const buildBlueprintGenerationBlock = (blueprints = []) => {
    if (!blueprints.length) return "";
    const rows = blueprints.map((b, i) => {
        return `${i + 1}. topic="${b.topic}" concept="${b.concept}" difficulty=${b.difficulty} type=${b.questionKind} blooms=${b.blooms} time≈${b.estimatedTime}min slot=${b.conceptSlot}`;
    });
    return `
**QUESTION BLUEPRINT (AUTHORITATIVE — generate exactly one question per row, in order):**
${rows.join("\n")}
Do NOT invent extra slots. Do NOT skip slots. Match each row's difficulty, blooms level, and concept.
`;
};

export const isBlueprintPlannerEnabled = () => {
    const flag = process.env.AI_QB_BLUEPRINT_PLANNER;
    if (flag === "0" || flag === "false") return false;
    return true; // default ON for Phase C
};
