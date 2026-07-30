/**
 * Orchestrates independent verification stages used by finalize:
 * solver → explanation verifier → rule failures → verification report.
 */

import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import {
    isAnswerCorrectionEnabled,
    runAnswerCorrectnessPass,
} from "./answerCorrection.service.js";
import {
    isExplanationVerifierEnabled,
    runExplanationVerifierPass,
} from "./explanationVerifier.service.js";
import { flattenQuestionBankForCorrectnessAudit } from "./correctnessPreAudit.service.js";
import {
    isSolverTruthEnabled,
    runRuleEngineRejects,
    runRuleBasedConsistencyCheck,
    attachComplexityMetadata,
} from "./solverTruth.service.js";

/** Drop top-level (or connected sub) questions listed in unfixableRefs. */
export const dropQuestionsByRefs = (questions = [], unfixableRefs = []) => {
    if (!unfixableRefs?.length) {
        return { questions, droppedCount: 0, droppedByType: {} };
    }
    const flawedTop = new Set();
    const flawedSubs = new Map();
    for (const item of unfixableRefs) {
        const ref = item.ref || item;
        const topIndex = ref.topIndex;
        const subIndex = ref.subIndex;
        if (!Number.isFinite(topIndex)) continue;
        if (subIndex != null) {
            if (!flawedSubs.has(topIndex)) flawedSubs.set(topIndex, new Set());
            flawedSubs.get(topIndex).add(subIndex);
        } else {
            flawedTop.add(topIndex);
        }
    }

    const droppedByType = { single: 0, multiple: 0, true_false: 0, connected: 0 };
    const next = [];
    for (let topIndex = 0; topIndex < questions.length; topIndex++) {
        const q = questions[topIndex];
        const type = String(q?.questionType || "single").toLowerCase();
        if (flawedTop.has(topIndex)) {
            droppedByType[type] = (droppedByType[type] || 0) + 1;
            continue;
        }
        if (type === "connected" && flawedSubs.get(topIndex)?.size) {
            const bad = flawedSubs.get(topIndex);
            const subQuestions = (q.subQuestions || []).filter(
                (_, i) => !bad.has(i)
            );
            if (!subQuestions.length) {
                droppedByType.connected += 1;
                continue;
            }
            next.push({ ...q, subQuestions });
        } else {
            next.push(q);
        }
    }
    const droppedCount = questions.length - next.length;
    return { questions: next, droppedCount, droppedByType };
};

export const attachVerificationStatus = (
    questions = [],
    {
        fixedRefs = [],
        strippedRefs = [],
        solverReport = [],
        explanationReport = [],
        difficultyScores = new Map(),
    } = {}
) => {
    const fixedKeys = new Set(
        fixedRefs.map((r) => `${r.topIndex}:${r.subIndex ?? "-"}`)
    );
    const strippedKeys = new Set(
        strippedRefs.map((r) => `${r.topIndex}:${r.subIndex ?? "-"}`)
    );
    const solverByRef = new Map(
        (solverReport || []).map((r) => [
            `${r.ref?.topIndex}:${r.ref?.subIndex ?? "-"}`,
            r,
        ])
    );
    const explByRef = new Map(
        (explanationReport || []).map((r) => [
            `${r.ref?.topIndex}:${r.ref?.subIndex ?? "-"}`,
            r,
        ])
    );

    const stamp = (q, topIndex, subIndex = null) => {
        const key = `${topIndex}:${subIndex ?? "-"}`;
        const solver = solverByRef.get(key);
        const expl = explByRef.get(key);
        const status = strippedKeys.has(key)
            ? "stripped"
            : fixedKeys.has(key) || solver?.status === "fixed"
              ? "fixed"
              : "passed";
        return {
            ...q,
            _verification: {
                ...(q._verification || {}),
                answerConfidence:
                    solver?.confidence ||
                    q._verification?.answerConfidence ||
                    null,
                difficultyScore:
                    difficultyScores.get(key) ??
                    q._verification?.difficultyScore ??
                    null,
                explanationOk:
                    expl?.ok ??
                    q._verification?.explanationOk ??
                    (status !== "stripped"),
                ruleFailures: q._verification?.ruleFailures || [],
                status,
            },
        };
    };

    return questions.map((q, topIndex) => {
        if (String(q?.questionType || "").toLowerCase() === "connected") {
            return {
                ...stamp(q, topIndex),
                subQuestions: (q.subQuestions || []).map((sub, subIndex) =>
                    stamp(sub, topIndex, subIndex)
                ),
            };
        }
        return stamp(q, topIndex);
    });
};

/**
 * Answer + explanation consistency + final rule engine.
 * Run AFTER SymPy (ideal order: solver → sympy → answer/expl → difficulty → rules).
 */
export const runPostSymbolicTruthGates = (questions = []) => {
    if (!isSolverTruthEnabled()) {
        return {
            questions,
            consistencyUnfixable: [],
            ruleUnfixable: [],
            repairedCount: 0,
        };
    }
    const consistency = runRuleBasedConsistencyCheck(questions);
    let next = attachComplexityMetadata(consistency.questions || questions);
    const rules = runRuleEngineRejects(next);
    pipelineTrace("FINALIZE_POST_SYMBOLIC_TRUTH_GATES", {
        explanationRepaired: consistency.repairedCount || 0,
        consistencyRejected: (consistency.unfixableRefs || []).length,
        ruleRejected: (rules.unfixableRefs || []).length,
    });
    return {
        questions: next,
        consistencyUnfixable: consistency.unfixableRefs || [],
        ruleUnfixable: rules.unfixableRefs || [],
        repairedCount: consistency.repairedCount || 0,
    };
};

export const runIndependentVerificationPipeline = async (
    questions = [],
    {
        topic = "",
        bankName = "",
        examProfile = "competitive",
        subject = "",
        sectionName = "",
        difficulty = "",
        callLlm,
        callLlmSecondary = null,
        skipExplanationVerifier = false,
        /** When true, defer consistency+rule engine until after SymPy (recommended). */
        deferTruthGates = true,
    } = {}
) => {
    const empty = {
        questions,
        checkedCount: 0,
        disagreementCount: 0,
        fixedCount: 0,
        unfixableRefs: [],
        explanationFixedCount: 0,
        report: [],
        explanationReport: [],
        verificationStats: {
            passed: questions.length,
            fixed: 0,
            regenerated: 0,
            stripped: 0,
        },
    };
    if (!questions?.length || typeof callLlm !== "function") return empty;

    let next = questions;
    let solverResult = {
        checkedCount: 0,
        disagreementCount: 0,
        fixedCount: 0,
        unfixableRefs: [],
        report: [],
    };

    if (isAnswerCorrectionEnabled()) {
        solverResult = await runAnswerCorrectnessPass(
            next,
            { topic, bankName, examProfile, subject, sectionName, difficulty },
            { callLlm, callLlmSecondary }
        );
        next = solverResult.questions || next;
        pipelineTrace("FINALIZE_INDEPENDENT_SOLVER", {
            checked: solverResult.checkedCount,
            disagreements: solverResult.disagreementCount,
            fixed: solverResult.fixedCount,
            unfixable: solverResult.unfixableRefs?.length || 0,
            solverTruth: isSolverTruthEnabled(),
        });
    }

    let explanationResult = {
        fixedCount: 0,
        unfixableRefs: [],
        report: [],
    };
    const skipExpl =
        skipExplanationVerifier ||
        isSolverTruthEnabled() ||
        !isExplanationVerifierEnabled();
    if (!skipExpl) {
        explanationResult = await runExplanationVerifierPass(
            next,
            { topic, bankName, examProfile },
            { callLlm }
        );
        next = explanationResult.questions || next;
        pipelineTrace("FINALIZE_EXPLANATION_VERIFIER", {
            fixed: explanationResult.fixedCount,
            unfixable: explanationResult.unfixableRefs?.length || 0,
        });
    } else if (isSolverTruthEnabled()) {
        pipelineTrace("FINALIZE_EXPLANATION_FROM_SOLVER", {
            note: "explanation from solver JSON; final_answer is source of truth",
        });
    }

    let consistencyUnfixable = [];
    let ruleUnsolvable = [];
    if (isSolverTruthEnabled() && !deferTruthGates) {
        const gates = runPostSymbolicTruthGates(next);
        next = gates.questions;
        consistencyUnfixable = gates.consistencyUnfixable;
        ruleUnsolvable = gates.ruleUnfixable;
        pipelineTrace("FINALIZE_SOLVER_TRUTH_GATES", {
            explanationRepaired: gates.repairedCount || 0,
            consistencyRejected: consistencyUnfixable.length,
            ruleRejected: ruleUnsolvable.length,
            deferred: false,
        });
    } else if (isSolverTruthEnabled() && deferTruthGates) {
        pipelineTrace("FINALIZE_SOLVER_TRUTH_GATES_DEFERRED", {
            note: "consistency + rule engine run after SymPy / difficulty",
        });
    }

    const allUnfixable = [
        ...(solverResult.unfixableRefs || []),
        ...(explanationResult.unfixableRefs || []),
        ...consistencyUnfixable,
        ...ruleUnsolvable,
    ];
    const dropped = dropQuestionsByRefs(next, allUnfixable);
    next = dropped.questions;

    const fixedRefs = (solverResult.report || [])
        .filter((r) => r.status === "fixed" || r.status === "passed")
        .map((r) => r.ref);
    next = attachVerificationStatus(next, {
        fixedRefs,
        solverReport: solverResult.report,
        explanationReport: explanationResult.report,
    });

    const flatCount = flattenQuestionBankForCorrectnessAudit(next).length;
    return {
        questions: next,
        checkedCount: solverResult.checkedCount || 0,
        disagreementCount: solverResult.disagreementCount || 0,
        fixedCount:
            (solverResult.fixedCount || 0) +
            (explanationResult.fixedCount || 0),
        unfixableRefs: allUnfixable,
        droppedCount: dropped.droppedCount,
        droppedByType: dropped.droppedByType,
        report: solverResult.report || [],
        explanationReport: explanationResult.report || [],
        verificationStats: {
            passed: Math.max(0, flatCount - (solverResult.fixedCount || 0)),
            fixed:
                (solverResult.fixedCount || 0) +
                (explanationResult.fixedCount || 0),
            regenerated: 0,
            stripped: dropped.droppedCount,
        },
    };
};
