/**
 * Explanation rewrite: NEVER re-solves.
 * Turns verified Independent Solver steps into student-facing prose.
 * Rejects draft/meta self-correction language.
 */

import { stripMetaCommentary, hasMetaCommentary } from "../utils/stripMetaCommentary.js";
import {
    lockExplanationToMarkedOption,
    syncSolveStepsToMarkedAnswer,
} from "./questionSolveFirst.service.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";

const optionTexts = (q) =>
    (q?.options || []).map((o) =>
        String(typeof o === "object" ? o?.text ?? o?.option ?? "" : o || "").trim()
    );

const markedLetter = (q) => {
    if (Number.isFinite(q?.correctIndex) && q.correctIndex >= 0) {
        return String.fromCharCode(65 + q.correctIndex);
    }
    const a = String(q?.correctAnswer || q?.final_answer || "")
        .trim()
        .toUpperCase();
    return /^[A-D]$/.test(a) ? a : "";
};

/**
 * Build explanation ONLY from verified solver steps + locked final_answer.
 * Does not call an LLM. Does not recompute arithmetic.
 */
export const rewriteExplanationFromVerifiedSteps = (q = {}) => {
    const letter = markedLetter(q);
    const opts = optionTexts(q);
    const idx = letter ? letter.charCodeAt(0) - 65 : -1;
    if (idx < 0 || idx >= opts.length) return q;

    const stepsRaw = (Array.isArray(q._solveSteps) ? q._solveSteps : [])
        .map(String)
        .map(stripMetaCommentary)
        .map((s) =>
            s
                .replace(/\b(?:actually|instead|however|upon reconsideration)\b[^.]*\./gi, "")
                .trim()
        )
        .filter((s) => s && /[A-Za-z0-9]{2,}/.test(s));

    if (!stepsRaw.length) {
        // Minimal locked explanation — still never invents a new derivation.
        const explanation = `Therefore, the correct answer is ${letter}. FINAL_ANSWER: ${letter}`;
        return {
            ...q,
            explanation,
            _verification: {
                ...(q._verification || {}),
                explanationOk: true,
                explanationSource: "verified_steps_minimal",
            },
        };
    }

    const markedText = opts[idx];
    const steps = syncSolveStepsToMarkedAnswer(stepsRaw, markedText).map(
        (s, si, arr) =>
            si === arr.length - 1
                ? `${String(s || "")
                      .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                      .trim()} FINAL_ANSWER: ${letter}`
                : s
    );
    let explanation = lockExplanationToMarkedOption(stepsRaw, markedText, {
        correctLetter: letter,
    });
    explanation = stripMetaCommentary(explanation);

    if (hasMetaCommentary(explanation)) {
        // Fail closed: strip to step list without meta phrases.
        explanation = steps
            .map((s, i) => `Step ${i + 1}: ${stripMetaCommentary(s)}`)
            .filter(Boolean)
            .join(" ");
        explanation = `${explanation} Therefore, the correct answer is ${letter}. FINAL_ANSWER: ${letter}`;
        pipelineTrace("EXPLANATION_REWRITE_STRIPPED_META", {
            stem: String(q.questionText || "").slice(0, 60),
        });
    }

    return {
        ...q,
        explanation,
        _solveSteps: steps,
        correctAnswer: letter,
        correctIndex: idx,
        final_answer: letter,
        _verification: {
            ...(q._verification || {}),
            explanationOk: true,
            explanationSource: "verified_steps_rewrite",
            sourceOfTruth: "independent_solver",
        },
    };
};

export const rewriteExplanationsForBank = (questions = []) =>
    (questions || []).map((q) => {
        if (String(q?.questionType || "").toLowerCase() === "connected") {
            return {
                ...q,
                subQuestions: (q.subQuestions || []).map((sub) =>
                    sub?._solverTruthApplied || sub?._solveSteps?.length
                        ? rewriteExplanationFromVerifiedSteps(sub)
                        : sub
                ),
            };
        }
        if (q?._solverTruthApplied || q?._solveSteps?.length) {
            return rewriteExplanationFromVerifiedSteps(q);
        }
        return q;
    });
