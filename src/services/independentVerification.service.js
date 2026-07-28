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
 * Run independent solver (+ optional explanation verifier) on a bank.
 */
export const runIndependentVerificationPipeline = async (
    questions = [],
    {
        topic = "",
        bankName = "",
        examProfile = "competitive",
        callLlm,
        skipExplanationVerifier = false,
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
            { topic, bankName, examProfile },
            { callLlm }
        );
        next = solverResult.questions || next;
        pipelineTrace("FINALIZE_INDEPENDENT_SOLVER", {
            checked: solverResult.checkedCount,
            disagreements: solverResult.disagreementCount,
            fixed: solverResult.fixedCount,
            unfixable: solverResult.unfixableRefs?.length || 0,
        });
    }

    let explanationResult = {
        fixedCount: 0,
        unfixableRefs: [],
        report: [],
    };
    if (!skipExplanationVerifier && isExplanationVerifierEnabled()) {
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
    }

    const allUnfixable = [
        ...(solverResult.unfixableRefs || []),
        ...(explanationResult.unfixableRefs || []),
    ];
    const dropped = dropQuestionsByRefs(next, allUnfixable);
    next = dropped.questions;

    const fixedRefs = (solverResult.report || [])
        .filter((r) => r.status === "fixed")
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
            passed: Math.max(
                0,
                flatCount - (solverResult.fixedCount || 0)
            ),
            fixed:
                (solverResult.fixedCount || 0) +
                (explanationResult.fixedCount || 0),
            regenerated: 0,
            stripped: dropped.droppedCount,
        },
    };
};
