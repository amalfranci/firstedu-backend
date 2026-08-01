/**
 * LLM difficulty self-audit gate — rejects questions scoring below threshold
 * before finalize (4th LLM call in solve-first pipeline).
 */

import { parseJsonObjectFromAIText } from "../utils/aiJsonRepair.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { getExamLabel } from "./examPromptContext.service.js";
import { isVeteranDifficultyEnabled, isExamNativeVeteranGeneration } from "./hardQuestionMandate.service.js";
import {
    buildDifficultyAuditRubricsBlock,
    normalizeQuestionTier,
} from "./difficultyMix.service.js";
import {
    buildWeightedDifficultyRubricBlock,
    computeWeightedDifficultyScore,
    isWeightedDifficultyScoreEnabled,
} from "./weightedDifficultyScore.service.js";

// Veteran gate aligned to the audit rubric's own "clearly meets tier" line (80,
// see buildDifficultySelfAuditPrompt). A higher bar (was 85) rejected questions
// the rubric itself rates as fully tier-compliant — dropping good hard items on
// single-shot LLM scoring noise (±5-10) and forcing needless regens.
export const DIFFICULTY_SELF_AUDIT_MIN_SCORE = Number(
    process.env.AI_QB_DIFFICULTY_SELF_AUDIT_MIN ||
        (isVeteranDifficultyEnabled() ? 80 : 75)
);

/** Skeletons are rougher than built MCQs — use a lower bar; finalize uses DIFFICULTY_SELF_AUDIT_MIN_SCORE. */
export const SKELETON_DIFFICULTY_SELF_AUDIT_MIN_SCORE = Number(
    process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN ||
        (isVeteranDifficultyEnabled() ? 78 : 70)
);

/** When skeleton audit would reject most of a batch, only drop obvious drills below this floor. */
const SKELETON_SELF_AUDIT_RELAXED_FLOOR = Number(
    process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR || 72
);
/** Last attempt only — admit near-misses so Physics/STEM batches don't wipe to 0. */
const SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR = Number(
    process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR || 55
);

const SKELETON_SELF_AUDIT_RELAX_THRESHOLD = Number(
    process.env.AI_QB_SKELETON_SELF_AUDIT_RELAX_THRESHOLD || 0.5
);

export const isDifficultySelfAuditEnabled = () => {
    const flag = process.env.AI_QB_DIFFICULTY_SELF_AUDIT;
    if (flag === "0" || flag === "false") return false;
    return true;
};

/**
 * Difficulty LLM judge: default ON even for exam-native (independent verification).
 * Set AI_QB_DIFFICULTY_SELF_AUDIT=0 to disable globally.
 * Set AI_QB_DIFFICULTY_JUDGE=0 to restore legacy skip-on-exam-native behaviour.
 * Set AI_QB_DIFFICULTY_SELF_AUDIT=1 to force audit (same as judge default now).
 */
export const shouldSkipLlmDifficultySelfAudit = (difficultyResolution) => {
    const flag = process.env.AI_QB_DIFFICULTY_SELF_AUDIT;
    // Explicit off only.
    if (flag === "0" || flag === "false") return true;
    // Exam-calibrated / JEE hard MUST run the independent difficulty judge —
    // skipping it was the main reason Easy drills shipped as "Hard".
    if (
        difficultyResolution?.examCalibrated ||
        isExamNativeVeteranGeneration(difficultyResolution)
    ) {
        return false;
    }
    if (flag === "1" || flag === "true") return false;
    const judgeFlag = process.env.AI_QB_DIFFICULTY_JUDGE;
    if (judgeFlag === "0" || judgeFlag === "false") {
        return true;
    }
    return false;
};

const truncate = (text, max = 320) => {
    const s = String(text || "").trim();
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
};

const formatQuestionForAudit = (q, index) => {
    const lines = [`#${index + 1}`];
    const assignedTier =
        normalizeQuestionTier(q.difficultyTier || q.difficulty) || null;
    if (assignedTier) {
        lines.push(`Assigned difficultyTier: **${assignedTier}**`);
    }
    lines.push(`Stem: ${truncate(q.questionText, 500)}`);
    const steps = q._solveSteps || q.solveSteps;
    if (Array.isArray(steps) && steps.length) {
        lines.push(`Solve steps (${steps.length}):`);
        steps.slice(0, 5).forEach((step, i) => {
            lines.push(`  ${i + 1}. ${truncate(step, 280)}`);
        });
    } else if (q.explanation) {
        lines.push(`Explanation: ${truncate(q.explanation, 600)}`);
    }
    if (q._conceptSlot || q.conceptSlot) {
        lines.push(`Archetype: ${q._conceptSlot || q.conceptSlot}`);
    }
    if (isWeightedDifficultyScoreEnabled()) {
        const w =
            q._weightedDifficulty ||
            computeWeightedDifficultyScore(q, {
                assignedTier: q.difficultyTier || q.difficulty,
            });
        q._weightedDifficulty = w;
        lines.push(
            `Deterministic weighted difficulty: **${w.total}/100** (floor ${w.floor} for ${w.tier}; est. ~${w.estimatedTimeMinutes} min)`
        );
        lines.push(
            `  Factors: concept=${w.factors.conceptDifficulty}, #concepts=${w.factors.numberOfConcepts}, depth=${w.factors.reasoningDepth}, calc=${w.factors.calculationComplexity}, insight=${w.factors.trickinessInsight}, options=${w.factors.optionQuality}, time=${w.factors.estimatedTime}`
        );
    }
    const kind = String(q._questionKind || q.questionKind || "").toLowerCase();
    const assignedHard =
        String(q.difficultyTier || q.difficulty || "").toLowerCase() === "hard";
    if (kind === "theory") {
        lines.push(
            assignedHard
                ? "Question kind: **THEORY HARD** — score on multi-statement traps, close distractors, and non-trivial reasoning. Single-fact recall must score ≤55."
                : "Question kind: **THEORY** (conceptual — score on concept depth and close distractors, NOT computation, numeric givens, or solve-step count)"
        );
    } else if (kind === "direct") {
        lines.push(
            assignedHard
                ? "Question kind: **DIRECT but assigned HARD** — still require non-obvious application (≥3 conceptual steps or a hidden trick). Textbook 1-step plug-ins / standard identity limits / chain-rule-at-a-point MUST score ≤50."
                : "Question kind: **DIRECT** (single-formula numerical by design — a clean 1–2 step solve is correct; do NOT penalize for lacking multi-step depth or concept fusion)"
        );
    }
    return lines.join("\n");
};

export const buildDifficultySelfAuditPrompt = ({
    topic = "",
    bankName = "",
    difficulty = "hard",
    examProfile = "jee_main",
    questions = [],
} = {}) => {
    const examLabel = getExamLabel(examProfile);
    const blocks = questions.map((q, i) => formatQuestionForAudit(q, i)).join("\n\n");
    const tiersInBatch = questions
        .map(
            (q) =>
                normalizeQuestionTier(q.difficultyTier || q.difficulty) ||
                normalizeQuestionTier(difficulty)
        )
        .filter(Boolean);
    const rubricsBlock = buildDifficultyAuditRubricsBlock({
        examProfile,
        tiers: tiersInBatch.length ? tiersInBatch : ["easy", "medium", "hard"],
        hardOnly:
            tiersInBatch.length > 0 &&
            tiersInBatch.every((t) => t === "hard"),
    });

    const weightedRubric = isWeightedDifficultyScoreEnabled()
        ? buildWeightedDifficultyRubricBlock()
        : "";

    return `You are a ${examLabel} difficulty auditor. Score each question against its **assigned difficultyTier** using the **same tier criteria used during generation**.

**Topic:** ${topic || bankName}
**Bank difficulty profile:** ${difficulty} (overall paper weighting — each question is scored against its own assigned tier)

${rubricsBlock}
${weightedRubric}

**How to score each question:**
1. Read the **Assigned difficultyTier** line for that question
2. Apply the matching **tier scoring** rubric above (not a generic "hard" feel)
3. Use the provided **Solve steps** / explanation as the true step-count signal (not stem length alone)
4. When a **Deterministic weighted difficulty** line is present, treat low factor scores (concept, #concepts, depth, calc, insight, options, time) as evidence the item is below tier — do not inflate scores for long but single-formula stems
5. **80+** = clearly meets that tier's Target + REQUIRED bars
6. **65–79** = borderline for that tier
7. **Below 65** = too easy for the assigned tier (see "too easy" note for that tier)
8. **Below 50** = BANNED pattern for that tier

Penalize: meta draft text ("adjusting", "re-evaluating"), formula-only stems when tier requires fusion, duplicate template logic.

**Theory items:** questions marked **Question kind: THEORY** are conceptual by design — do NOT penalize them for lacking numeric givens, calculation, or solve steps. Score their difficulty on concept depth, subtlety of distractors, and reasoning required.

**Direct items:** questions marked **Question kind: DIRECT** are direct single-formula/single-concept numericals by design — a clean 1–2 step solve is correct. Do NOT penalize them for lacking multi-step depth or concept fusion; they are the routine items of a real paper.

**Questions:**
${blocks}

Return ONLY valid JSON:
{
  "scores": [
    {
      "questionNumber": 1,
      "difficulty": "Hard",
      "difficultyScore": 0.91,
      "reason": "one-line reason referencing assigned tier criteria + what makes it this hard"
    }
  ]
}

Rules for difficultyScore:
- Use a **0.0–1.0** scale (preferred). Legacy 0–100 integers are also accepted.
- Also return categorical \`difficulty\`: "Easy" | "Medium" | "Hard" matching your score band
  (Easy <0.45, Medium 0.45–0.74, Hard ≥0.75) calibrated to the **assigned tier**.
- \`reason\` must mention concept fusion / reasoning depth when relevant.`;
};

export const parseDifficultySelfAuditResponse = (rawText, expectedCount = 1) => {
    const parsed = parseJsonObjectFromAIText(rawText);
    const rows = Array.isArray(parsed?.scores) ? parsed.scores : [];
    const byNumber = new Map();
    for (const row of rows) {
        const n = Number(row.questionNumber);
        let score = Number(row.difficultyScore);
        if (!Number.isFinite(n) || n < 1) continue;
        if (!Number.isFinite(score)) continue;
        // Accept 0–1 or 0–100; normalize to 0–100 for existing minScore gates.
        if (score >= 0 && score <= 1) score = Math.round(score * 100);
        const label = String(row.difficulty || row.tier || "")
            .trim()
            .toLowerCase();
        byNumber.set(n, {
            questionNumber: n,
            difficultyScore: Math.max(0, Math.min(100, Math.round(score))),
            difficultyLabel: /hard|medium|easy/.test(label)
                ? label.charAt(0).toUpperCase() + label.slice(1)
                : score >= 75
                  ? "Hard"
                  : score >= 45
                    ? "Medium"
                    : "Easy",
            reason: String(row.reason || "").trim(),
        });
    }
    const scores = [];
    for (let i = 1; i <= expectedCount; i++) {
        scores.push(
            byNumber.get(i) || {
                questionNumber: i,
                difficultyScore: 0,
                difficultyLabel: "Easy",
                reason: "not scored",
            }
        );
    }
    return scores;
};

/**
 * Drop questions below minScore. Returns kept list aligned to input order.
 */
export const applyDifficultySelfAuditGate = async (
    questions = [],
    {
        topic = "",
        bankName = "",
        difficulty = "hard",
        examProfile = "jee_main",
        minScore = DIFFICULTY_SELF_AUDIT_MIN_SCORE,
    },
    { callLlm } = {}
) => {
    const singles = (questions || []).filter(
        (q) =>
            String(q?.questionType || "single").toLowerCase() === "single" &&
            String(q?.questionText || "").trim()
    );
    if (!singles.length || !isDifficultySelfAuditEnabled() || typeof callLlm !== "function") {
        return { questions, rejected: [], rejectedCount: 0, scores: [] };
    }

    try {
        const prompt = buildDifficultySelfAuditPrompt({
            topic,
            bankName,
            difficulty,
            examProfile,
            questions: singles,
        });
        const rawText = await callLlm(prompt);
        const scores = parseDifficultySelfAuditResponse(rawText, singles.length);
        const rejectedNumbers = new Set(
            scores
                .filter((s) => s.difficultyScore < minScore)
                .map((s) => s.questionNumber)
        );
        const rejected = [];
        const keptSingles = [];
        singles.forEach((q, i) => {
            const num = i + 1;
            const row = scores[i];
            if (rejectedNumbers.has(num)) {
                rejected.push({
                    questionNumber: num,
                    question: q,
                    difficultyScore: row?.difficultyScore,
                    difficultyLabel: row?.difficultyLabel,
                    reason: row?.reason,
                    stem: truncate(q.questionText, 120),
                });
            } else {
                keptSingles.push({
                    ...q,
                    _verification: {
                        ...(q._verification || {}),
                        difficultyScore: row?.difficultyScore ?? null,
                        difficultyLabel: row?.difficultyLabel || null,
                        difficultyReason: row?.reason || null,
                    },
                    timeEstimate:
                        q.timeEstimate ||
                        q._verification?.timeEstimate ||
                        undefined,
                });
            }
        });

        const nonSingles = (questions || []).filter(
            (q) => String(q?.questionType || "single").toLowerCase() !== "single"
        );
        pipelineTrace("DIFFICULTY_SELF_AUDIT", {
            inputCount: singles.length,
            rejectedCount: rejected.length,
            minScore,
            rejected: rejected.slice(0, 8).map((r) => `Q${r.questionNumber}:${r.difficultyScore}`),
        });

        return {
            questions: [...keptSingles, ...nonSingles],
            rejected,
            rejectedCount: rejected.length,
            scores,
        };
    } catch (err) {
        pipelineTrace("DIFFICULTY_SELF_AUDIT_FAILED", {
            error: err?.message || String(err),
        });
        return { questions, rejected: [], rejectedCount: 0, scores: [] };
    }
};

/**
 * Audit skeleton solveSteps before MCQ build — rejects weak skeletons early.
 */
export const applySkeletonDifficultySelfAuditGate = async (
    skeletons = [],
    ctx = {},
    { callLlm } = {}
) => {
    const list = Array.isArray(skeletons) ? skeletons : [];
    if (!list.length || !isDifficultySelfAuditEnabled() || typeof callLlm !== "function") {
        return {
            skeletons: list,
            keptIndices: list.map((_, i) => i),
            rejected: [],
            rejectedCount: 0,
            scores: [],
        };
    }

    const kindBySlot = ctx.kindBySlot || {};
    const asAuditItems = list.map((sk, i) => ({
        questionText: String(sk.stem || sk.questionStem || sk.questionText || "").trim(),
        _solveSteps: sk.solveSteps || sk._solveSteps || [],
        _conceptSlot: sk.conceptSlot,
        _questionKind:
            ctx.kindSlots?.[i] ||
            sk.questionKind ||
            kindBySlot[String(sk.conceptSlot || "").trim()] ||
            "calculative",
        difficultyTier:
            ctx.tierSlots?.[i] ||
            sk.difficultyTier ||
            ctx.difficulty,
    }));

    const result = await applyDifficultySelfAuditGate(asAuditItems, ctx, { callLlm });
    const minScore = ctx.minScore ?? SKELETON_DIFFICULTY_SELF_AUDIT_MIN_SCORE;
    let effectiveMin = minScore;
    const scoredCount = result.scores.filter((s) => s.reason !== "not scored").length;
    const wouldReject = result.scores.filter(
        (s, i) => i < asAuditItems.length && s.difficultyScore < minScore
    ).length;
    const rejectRatio =
        asAuditItems.length > 0 ? wouldReject / asAuditItems.length : 0;
    if (
        asAuditItems.length >= 3 &&
        rejectRatio >= SKELETON_SELF_AUDIT_RELAX_THRESHOLD
    ) {
        if (ctx.isLastAttempt) {
            // Last-resort safety net only — regenerating further isn't possible,
            // so admit near-bar skeletons rather than return nothing. On any
            // earlier attempt, leave the bar intact and let the caller's retry
            // loop regenerate the deficit at full quality instead.
            // Use a lower floor than mid-run relax (72) — flash-lite Physics often
            // scores 55–75 and previously wiped the whole batch at the 72 bar.
            effectiveMin = Math.min(
                minScore,
                SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR,
                SKELETON_SELF_AUDIT_RELAXED_FLOOR
            );
            pipelineTrace("SKELETON_SELF_AUDIT_RELAXED", {
                inputCount: asAuditItems.length,
                wouldReject,
                rejectRatio: Math.round(rejectRatio * 100),
                minScore,
                effectiveMin,
                scoredCount,
                lastAttempt: true,
            });
        } else {
            pipelineTrace("SKELETON_SELF_AUDIT_RELAX_SKIPPED", {
                inputCount: asAuditItems.length,
                wouldReject,
                rejectRatio: Math.round(rejectRatio * 100),
                minScore,
                scoredCount,
                reason: "not_last_attempt",
            });
        }
    }

    const kept = [];
    const keptIndices = [];
    const rejected = [];
    let auditIdx = 0;
    for (let i = 0; i < list.length; i++) {
        const sk = list[i];
        const hasStem = String(sk.stem || sk.questionStem || sk.questionText || "").trim();
        if (!hasStem) continue;
        const row = result.scores[auditIdx];
        auditIdx += 1;
        if (row && row.difficultyScore < effectiveMin) {
            rejected.push({
                index: i + 1,
                skeletonIndex: i,
                skeleton: sk,
                conceptSlot: sk.conceptSlot,
                difficultyScore: row.difficultyScore,
                reason: row.reason,
            });
        } else {
            kept.push(sk);
            keptIndices.push(i);
        }
    }

    if (rejected.length) {
        pipelineTrace("SKELETON_DIFFICULTY_SELF_AUDIT", {
            inputCount: list.length,
            kept: kept.length,
            rejected: rejected.length,
        });
    }

    // Absolute last resort: if every skeleton is below the (already relaxed) floor on
    // the final attempt, keep the highest-scoring ones so generation is not empty.
    if (ctx.isLastAttempt && kept.length === 0 && rejected.length > 0) {
        const ranked = [...rejected].sort(
            (a, b) => (b.difficultyScore || 0) - (a.difficultyScore || 0)
        );
        const salvageCount = Math.max(1, Math.ceil(list.length / 2));
        const salvage = ranked.slice(0, salvageCount);
        for (const row of salvage) {
            kept.push(row.skeleton);
            keptIndices.push(row.skeletonIndex);
        }
        const salvagedIndexes = new Set(salvage.map((r) => r.skeletonIndex));
        const stillRejected = rejected.filter(
            (r) => !salvagedIndexes.has(r.skeletonIndex)
        );
        rejected.length = 0;
        rejected.push(...stillRejected);
        pipelineTrace("SKELETON_SELF_AUDIT_LAST_ATTEMPT_SALVAGE", {
            salvaged: salvage.length,
            scores: salvage.map((r) => r.difficultyScore),
        });
    }

    return {
        skeletons: kept,
        keptIndices,
        rejected,
        rejectedCount: rejected.length,
        scores: result.scores,
    };
};

export default {
    DIFFICULTY_SELF_AUDIT_MIN_SCORE,
    SKELETON_DIFFICULTY_SELF_AUDIT_MIN_SCORE,
    isDifficultySelfAuditEnabled,
    shouldSkipLlmDifficultySelfAudit,
    buildDifficultySelfAuditPrompt,
    parseDifficultySelfAuditResponse,
    applyDifficultySelfAuditGate,
    applySkeletonDifficultySelfAuditGate,
};
