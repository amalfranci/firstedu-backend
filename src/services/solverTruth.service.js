/**
 * Solver-as-source-of-truth helpers (low-latency design).
 *
 * Source of truth = Solver JSON.final_answer (never extracted from explanation).
 * Explanation must conclude with final_answer; mismatch → rebuild explanation only.
 */

import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import {
    lockExplanationToMarkedOption,
    syncSolveStepsToMarkedAnswer,
} from "./questionSolveFirst.service.js";

/** Default ON — set AI_QB_SOLVER_TRUTH=0 for legacy disagreement-only correction. */
export const isSolverTruthEnabled = () => {
    const flag = process.env.AI_QB_SOLVER_TRUTH;
    if (flag === "0" || flag === "false") return false;
    return true;
};

export const getSolverTruthMaxRetries = () =>
    Math.max(1, Math.min(5, Number(process.env.AI_QB_SOLVER_TRUTH_MAX_RETRIES || 3)));

export const getSolverTruthConcurrency = () =>
    Math.max(1, Math.min(8, Number(process.env.AI_QB_SOLVER_TRUTH_CONCURRENCY || 5)));

/** Auto-reject / regen when answerConfidence below this (default 0.75). */
export const getAnswerConfidenceFloor = () =>
    Math.max(
        0,
        Math.min(1, Number(process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR || 0.75))
    );

const letter = (i) => String.fromCharCode(65 + Number(i));

export const optionTextsOf = (q) =>
    (q?.options || []).map((o) =>
        typeof o === "object" && o !== null ? String(o.text ?? "") : String(o ?? "")
    );

/** Marked letter from correctIndex / correctAnswer / final_answer — NEVER from explanation. */
export const markedLetterOf = (q) => {
    if (Number.isFinite(Number(q?.correctIndex))) {
        return letter(Number(q.correctIndex));
    }
    const m = String(q?.correctAnswer || q?.final_answer || "").trim().toUpperCase();
    if (/^[A-D]/.test(m)) return m.charAt(0);
    return "";
};

export const normalizeSolverConfidence = (raw) => {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.max(0, Math.min(1, raw));
    }
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "high") return 0.92;
    if (s === "medium") return 0.72;
    if (s === "low") return 0.35;
    const n = Number(s);
    if (Number.isFinite(n)) {
        return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
    }
    return 0.5;
};

export const confidenceIsActionable = (raw, floor = getAnswerConfidenceFloor()) =>
    normalizeSolverConfidence(raw) >= floor;

/**
 * Strict answer-correctness mode (AI_QB_STRICT_ANSWER_CORRECTNESS=1):
 * - dual independent solvers required for hard math
 * - secondary failure / disagreement → DROP (never ship single-solver keys)
 * - higher confidence floor
 * This is the only practical path toward ~100% shipped-key correctness with LLMs.
 */
export const isStrictAnswerCorrectnessEnabled = () => {
    const flag = process.env.AI_QB_STRICT_ANSWER_CORRECTNESS;
    return flag === "1" || flag === "true";
};

/** When ON, secondary solver failure or missing answer is a hard drop (not soft keep-primary). */
export const isDoubleSolveRequired = () => {
    if (isStrictAnswerCorrectnessEnabled()) return true;
    const flag = process.env.AI_QB_REQUIRE_DOUBLE_SOLVE;
    return flag === "1" || flag === "true";
};

export const shouldDoubleSolve = ({
    difficulty = "",
    subject = "",
    sectionName = "",
    question = null,
} = {}) => {
    // Explicit off — unless strict mode forces dual consensus for hard math.
    if (
        process.env.AI_QB_DOUBLE_SOLVE === "0" ||
        process.env.AI_QB_DOUBLE_SOLVE === "false"
    ) {
        if (!isStrictAnswerCorrectnessEnabled()) return false;
        // strict mode still double-solves hard math even if DOUBLE_SOLVE=0
    } else if (
        process.env.AI_QB_DOUBLE_SOLVE !== "1" &&
        process.env.AI_QB_DOUBLE_SOLVE !== "true" &&
        !isStrictAnswerCorrectnessEnabled()
    ) {
        // Default when unset: enable only for hard math (safer than off).
        // Explicit "0" handled above.
    }

    const diff = String(
        difficulty || question?.difficulty || question?.difficultyTier || ""
    ).toLowerCase();
    const subj = `${subject || ""} ${sectionName || ""} ${question?.subject || ""}`.toLowerCase();
    const isHard = diff === "hard" || diff.includes("hard");
    const isMath = /math|algebra|calculus|mathematics/.test(subj);

    // Strict: always dual-solve hard math (and all math if STRICT_ALL_MATH=1).
    if (isStrictAnswerCorrectnessEnabled()) {
        if (process.env.AI_QB_STRICT_ALL_MATH === "1") return isMath;
        return isHard && isMath;
    }

    if (process.env.AI_QB_DOUBLE_SOLVE === "0") return false;

    // Budget path: double-solve only Hard Mathematics by default.
    if (
        process.env.AI_QB_DOUBLE_SOLVE_HARD_MATH_ONLY === "0" ||
        process.env.AI_QB_DOUBLE_SOLVE_HARD_MATH_ONLY === "false"
    ) {
        return isHard || isMath;
    }
    if (!isHard) return false;
    return isMath;
};

/** Confidence floor — higher under strict mode (default 0.9 vs 0.75). */
export const getStrictAnswerConfidenceFloor = () =>
    Math.max(
        getAnswerConfidenceFloor(),
        Number(process.env.AI_QB_STRICT_ANSWER_CONFIDENCE_FLOOR || 0.9)
    );

export const shouldSkipSymbolicVerify = (q = {}, { subject = "", sectionName = "" } = {}) => {
    const kind = String(q?.questionKind || q?._questionKind || "").toLowerCase();
    if (kind === "theory") return true;
    const blob = [q?.questionText, q?.explanation, q?.conceptSlot, subject, sectionName]
        .map((x) => String(x || ""))
        .join(" ")
        .toLowerCase();
    if (
        /assertion[\s-]*reason|organic\s+chemistry|conceptual\s+only|match\s+the\s+column/.test(
            blob
        )
    ) {
        return true;
    }
    const subj = `${subject || ""} ${sectionName || ""} ${q?.subject || ""}`.toLowerCase();
    const isMath = /math|algebra|calculus|mathematics/.test(subj);
    const isPhysics = /\bphysics\b/.test(subj);
    const isChem = /\bchem/.test(subj);
    // SymPy: Mathematics + numerical Physics / Physical Chemistry only.
    if (!isMath && !isPhysics && !isChem) return true;
    if (!isMath && (isPhysics || isChem)) {
        // Conceptual / qualitative stems — skip symbolic.
        const stem = String(q?.questionText || "");
        if (!/\d/.test(stem)) return true;
    }
    return false;
};

/** Consistency check only — never sets the answer from explanation text. */
export const explanationConcludesWithFinalAnswer = (explanation = "", finalAnswerLetter = "") => {
    const want = String(finalAnswerLetter || "").trim().toUpperCase().charAt(0);
    if (!/^[A-D]$/.test(want)) return false;
    const text = String(explanation || "").trim();
    if (!text) return false;
    const tail = text.slice(-320);
    return [
        new RegExp(`FINAL_ANSWER\\s*:\\s*${want}\\b`, "i"),
        new RegExp(
            `(?:hence|therefore|thus|so),?\\s+(?:the\\s+)?(?:correct\\s+)?answer\\s+is\\s*\\(?${want}\\)?`,
            "i"
        ),
        new RegExp(`(?:correct\\s+option|answer)\\s*(?:is|=|:)\\s*\\(?${want}\\)?`, "i"),
        new RegExp(`\\(${want}\\)\\s*\\.?\\s*$`, "i"),
    ].some((re) => re.test(tail));
};

export const rebuildExplanationFromVerifiedSolution = (q) => {
    // Prefer the shared rewriter (strips meta, locks FINAL_ANSWER, never re-solves).
    try {
        // Lazy require-style import avoided — keep logic inline-compatible with rewrite.
        const opts = optionTextsOf(q);
        const finalLetter = markedLetterOf(q);
        const idx = finalLetter ? finalLetter.charCodeAt(0) - 65 : -1;
        if (idx < 0 || idx >= opts.length) return q;
        const stepsRaw = Array.isArray(q._solveSteps)
            ? q._solveSteps.map(String).filter((s) => s.trim())
            : [];
        if (!stepsRaw.length) return q;
        const markedText = opts[idx];
        const steps = syncSolveStepsToMarkedAnswer(stepsRaw, markedText).map((s, si, arr) =>
            si === arr.length - 1
                ? `${String(s || "").replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim()} FINAL_ANSWER: ${finalLetter}`
                : s
        );
        let explanation = lockExplanationToMarkedOption(stepsRaw, markedText, {
            correctLetter: finalLetter,
        });
        // Strip draft/meta self-correction language before publish.
        explanation = String(explanation || "")
            .replace(/\b(?:re-?evaluat(?:ing|e|ion)?|actually|instead|however|upon reconsideration|wait|correction)\b[^.]*\./gi, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!/FINAL_ANSWER\s*:/i.test(explanation)) {
            explanation = `${explanation} Therefore, the correct answer is ${finalLetter}. FINAL_ANSWER: ${finalLetter}`;
        }
        return {
            ...q,
            explanation,
            _solveSteps: steps,
            correctAnswer: finalLetter,
            correctIndex: idx,
            _verification: {
                ...(q._verification || {}),
                explanationOk: true,
                explanationRepaired: true,
                sourceOfTruth: "independent_solver",
            },
        };
    } catch {
        return q;
    }
};

/**
 * correctAnswer = final_answer (already set).
 * Explanation must conclude with final_answer → else rebuild explanation only.
 */
export const runRuleBasedConsistencyCheck = (questions = []) => {
    let repairedCount = 0;
    const unfixableRefs = [];
    const report = [];

    const next = questions.map((q, topIndex) => {
        const type = String(q?.questionType || "single").toLowerCase();
        if (type === "connected") {
            const subs = (q.subQuestions || []).map((sub, subIndex) => {
                const finalLetter = markedLetterOf(sub);
                if (!finalLetter) {
                    unfixableRefs.push({ ref: { topIndex, subIndex }, reason: "missing_final_answer" });
                    return sub;
                }
                if (!explanationConcludesWithFinalAnswer(sub?.explanation, finalLetter)) {
                    repairedCount++;
                    report.push({
                        ref: { topIndex, subIndex },
                        status: "explanation_regenerated",
                        final_answer: finalLetter,
                        stage: "consistency_rule",
                    });
                    return rebuildExplanationFromVerifiedSolution(sub);
                }
                return sub;
            });
            return { ...q, subQuestions: subs };
        }
        if (type !== "single") return q;

        const finalLetter = markedLetterOf(q);
        if (!finalLetter) {
            unfixableRefs.push({ ref: { topIndex }, reason: "missing_final_answer" });
            report.push({
                ref: { topIndex },
                status: "rejected",
                reason: "missing_final_answer",
                stage: "consistency_rule",
            });
            return q;
        }

        if (!explanationConcludesWithFinalAnswer(q.explanation, finalLetter)) {
            repairedCount++;
            report.push({
                ref: { topIndex },
                status: "explanation_regenerated",
                final_answer: finalLetter,
                stage: "consistency_rule",
            });
            return rebuildExplanationFromVerifiedSolution(q);
        }

        report.push({
            ref: { topIndex },
            status: "passed",
            final_answer: finalLetter,
            stage: "consistency_rule",
        });
        return q;
    });

    pipelineTrace("CONSISTENCY_RULE_DONE", {
        repaired: repairedCount,
        rejected: unfixableRefs.length,
        note: "final_answer is source of truth; explanation repaired only",
    });
    return { questions: next, repairedCount, unfixableRefs, report };
};

export const runRuleEngineRejects = (questions = []) => {
    const unfixableRefs = [];
    const report = [];
    const push = (ref, reason) => {
        unfixableRefs.push({ ref, reason });
        report.push({ ref, status: "rejected", reason, stage: "rule_engine" });
    };

    const walk = (q, ref) => {
        if (!q) {
            push(ref, "missing_question");
            return;
        }
        const type = String(q.questionType || "single").toLowerCase();
        if (type === "connected") {
            (q.subQuestions || []).forEach((sub, subIndex) =>
                walk(sub, { topIndex: ref.topIndex, subIndex })
            );
            if (!String(q.passage || "").trim()) push(ref, "empty_passage");
            return;
        }
        if (type !== "single") return;

        const opts = optionTextsOf(q);
        if (opts.length < 2 || opts.length > 6) {
            push(ref, "invalid_option_count");
            return;
        }
        const normalized = opts.map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (normalized.length !== opts.length) {
            push(ref, "empty_option");
            return;
        }
        if (new Set(normalized).size !== normalized.length) {
            push(ref, "duplicate_options");
            return;
        }
        if (!String(q.questionText || "").trim()) {
            push(ref, "empty_stem");
            return;
        }
        if (!String(q.explanation || "").trim()) {
            push(ref, "missing_explanation");
            return;
        }
        const marked = markedLetterOf(q);
        if (!marked || marked.charCodeAt(0) - 65 >= opts.length) {
            push(ref, "final_answer_not_in_options");
            return;
        }
        const steps = Array.isArray(q._solveSteps)
            ? q._solveSteps.map(String).filter((s) => s.trim())
            : [];
        if (!steps.length && !/step\s*\d/i.test(String(q.explanation || ""))) {
            push(ref, "empty_solution");
            return;
        }
        if (!explanationConcludesWithFinalAnswer(q.explanation, marked)) {
            push(ref, "explanation_does_not_conclude_with_final_answer");
            return;
        }
        const ansConf = normalizeSolverConfidence(
            q._verification?.answerConfidence ?? q.answerConfidence
        );
        if (ansConf < getAnswerConfidenceFloor()) {
            push(ref, `answer_confidence_below_floor (${ansConf})`);
            return;
        }
        if (q._verification?.symbolicOk === false) {
            push(ref, "sympy_numeric_failed");
            return;
        }
        if (q._verification?.conceptCoverageOk === false) {
            push(ref, "concept_coverage_failed");
            return;
        }
        if (q._verification?.formulaOk === false) {
            push(ref, "formula_validation_failed");
            return;
        }
        if (q._verification?.distractorOk === false) {
            push(ref, "distractor_quality_failed");
        }
    };

    questions.forEach((q, topIndex) => walk(q, { topIndex }));
    pipelineTrace("RULE_ENGINE_DONE", {
        rejected: unfixableRefs.length,
        reasons: report.map((r) => r.reason).slice(0, 20),
    });
    return { unfixableRefs, report };
};

export const bumpRegenAttempt = (q, reason = "") => {
    const max = getSolverTruthMaxRetries();
    const attempts = (Number(q?._regenAttempts) || 0) + 1;
    const exhausted = attempts >= max;
    return {
        ...q,
        _regenAttempts: attempts,
        _verification: {
            ...(q._verification || {}),
            lastFailStage: reason || q?._verification?.lastFailStage || null,
            regenAttempts: attempts,
            needsManualReview: exhausted,
            status: exhausted ? "needs_manual_review" : q?._verification?.status,
        },
    };
};

export const isNeedsManualReview = (q) =>
    Boolean(
        q?._verification?.needsManualReview ||
            q?._validationStatus === "needs_manual_review" ||
            (Number(q?._regenAttempts) || 0) >= getSolverTruthMaxRetries()
    );

export const runConsistencyJudge = (questions = []) => {
    const result = runRuleBasedConsistencyCheck(questions);
    return {
        unfixableRefs: result.unfixableRefs,
        report: result.report,
        correctnessScore: null,
        questions: result.questions,
        repairedCount: result.repairedCount,
    };
};

export const computeComplexityScore = (q = {}) => {
    const steps = Array.isArray(q._solveSteps)
        ? q._solveSteps.map(String).filter((s) => s.trim())
        : [];
    const explanation = String(q.explanation || "");
    const stem = String(q.questionText || "");
    const conceptSlot = String(q._conceptSlot || q.conceptSlot || "");
    const conceptCount = Math.max(
        1,
        conceptSlot.split(/[+&,/]| and /i).filter((p) => p.trim().length > 2).length
    );
    const reasoningDepth = Math.min(1, steps.length / 6);
    const calcHits = (explanation + stem).match(
        /[=∫∑√]|sin|cos|tan|log|ln|deriv|integr|matrix|det\b/gi
    );
    const calculationDepth = Math.min(1, (calcHits?.length || 0) / 8);
    const formulaCount = Math.min(
        1,
        ((explanation + stem).match(/\b(?:formula|equation|using)\b/gi)?.length || 0) / 4
    );
    const branches = Math.min(
        1,
        ((stem + explanation).match(/\b(?:case|if|when|either|otherwise)\b/gi)?.length || 0) / 5
    );
    const score = Math.max(
        0,
        Math.min(
            1,
            conceptCount * 0.12 +
                reasoningDepth * 0.28 +
                calculationDepth * 0.25 +
                formulaCount * 0.15 +
                branches * 0.2
        )
    );
    const timeEstimateMin = Number(
        (1.2 + score * 4.5 + Math.max(0, steps.length - 2) * 0.35).toFixed(1)
    );
    return {
        complexityScore: Number(score.toFixed(2)),
        conceptCount,
        reasoningDepth: Number(reasoningDepth.toFixed(2)),
        calculationDepth: Number(calculationDepth.toFixed(2)),
        formulaCount: Number(formulaCount.toFixed(2)),
        caseAnalysis: Number(branches.toFixed(2)),
        timeEstimate: `${timeEstimateMin} minutes`,
        timeEstimateMinutes: timeEstimateMin,
    };
};

export const attachComplexityMetadata = (questions = []) =>
    (questions || []).map((q) => {
        if (String(q?.questionType || "single").toLowerCase() !== "single") return q;
        const meta = computeComplexityScore(q);
        return {
            ...q,
            complexityScore: meta.complexityScore,
            timeEstimate: q.timeEstimate || meta.timeEstimate,
            _complexity: meta,
            _verification: {
                ...(q._verification || {}),
                complexityScore: meta.complexityScore,
                timeEstimate: q.timeEstimate || meta.timeEstimate,
            },
        };
    });
