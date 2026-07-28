/**
 * Explanation Verifier: confirm explanation justifies the marked option.
 * Deterministic detectors first; LLM rewrite for remaining mismatches.
 */

import { parseJsonArrayFromAIText } from "../utils/aiJsonRepair.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import {
    flattenQuestionBankForCorrectnessAudit,
    runDeterministicCorrectnessAudit,
} from "./correctnessPreAudit.service.js";
import {
    lockExplanationToMarkedOption,
    syncSolveStepsToMarkedAnswer,
} from "./questionSolveFirst.service.js";
import {
    buildExplanationOptionLockBlock,
    buildExamAnswerKeyLockBlock,
    buildPostSolveSelfCheckBlock,
} from "./examPromptContext.service.js";
import { runTasksWithConcurrency } from "./aiQuestionCountInference.service.js";

/** Default ON — set AI_QB_EXPLANATION_VERIFIER=0 to disable. */
export const isExplanationVerifierEnabled = () => {
    const flag = process.env.AI_QB_EXPLANATION_VERIFIER;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const BATCH_SIZE = Math.max(
    1,
    Number(process.env.AI_QB_EXPLANATION_VERIFIER_BATCH || 8)
);
const VERIFIER_CONCURRENCY = Math.max(
    1,
    Number(process.env.AI_QB_EXPLANATION_VERIFIER_CONCURRENCY || 3)
);

const letter = (i) => String.fromCharCode(65 + Number(i));

const getAtRef = (questions, ref) =>
    ref.subIndex != null
        ? questions[ref.topIndex]?.subQuestions?.[ref.subIndex]
        : questions[ref.topIndex];

const setAtRef = (questions, ref, updated) => {
    const next = [...questions];
    if (ref.subIndex != null) {
        const parent = { ...next[ref.topIndex] };
        const subs = [...(parent.subQuestions || [])];
        subs[ref.subIndex] = updated;
        parent.subQuestions = subs;
        next[ref.topIndex] = parent;
    } else {
        next[ref.topIndex] = updated;
    }
    return next;
};

const optionTexts = (q) =>
    (q?.options || []).map((o) =>
        typeof o === "object" && o !== null ? String(o.text ?? "") : String(o ?? "")
    );

const markedIndexOf = (q) => {
    if (Number.isFinite(Number(q?.correctIndex))) return Number(q.correctIndex);
    const m = String(q?.correctAnswer || "").trim().toUpperCase();
    if (/^[A-D]/.test(m)) return m.charCodeAt(0) - 65;
    return -1;
};

const isExplanationIssue = (issue = "") =>
    /explanation|answer key|contradict|justify|therefore|final_answer|marked/i.test(
        String(issue)
    );

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

export const buildExplanationOnlyFixPrompt = ({
    entries = [],
    topic = "",
    examProfile = "competitive",
} = {}) => {
    const blocks = entries
        .map((e, i) => {
            const opts = optionTexts(e.question)
                .map((t, oi) => `   ${letter(oi)}) ${t}`)
                .join("\n");
            return `### Item ${i + 1}
**Stem (DO NOT CHANGE):**
${String(e.question.questionText || "").trim()}
**Options (DO NOT CHANGE):**
${opts}
**Marked correct answer (MUST justify this):** ${
                e.markedIndex >= 0 ? letter(e.markedIndex) : "(none)"
            } — ${optionTexts(e.question)[e.markedIndex] || ""}
**Current explanation:**
${String(e.question.explanation || "").trim() || "(none)"}
**Problems:**
${(e.reasons || []).map((r) => `  - ${r}`).join("\n") || "  - explanation may not justify marked option"}`;
        })
        .join("\n\n");

    return `You are verifying/fixing EXPLANATIONS only for ${entries.length} exam question(s).

**Topic:** ${topic || "(not set)"}
${buildExamAnswerKeyLockBlock()}
${buildExplanationOptionLockBlock({ examProfile })}
${buildPostSolveSelfCheckBlock()}

**TASK:** For each item, keep the marked answer index unchanged. Rewrite explanation + solveSteps
so they derive EXACTLY the marked option. End with FINAL_ANSWER: <letter>.

If the marked option is mathematically impossible given the stem/options, set "unfixable": true.

Return ONLY JSON array:
[{"index":1,"correctIndex":0,"explanation":"...","solveSteps":["..."],"unfixable":false}]

**Items:**
${blocks}`;
};

export const parseExplanationFixResponse = (rawText, expected = 0) => {
    const rows = parseJsonArrayFromAIText(rawText) || [];
    const out = new Map();
    for (const row of rows) {
        const idx = Number(row?.index);
        if (!Number.isInteger(idx) || idx < 1 || (expected && idx > expected)) continue;
        out.set(idx - 1, {
            correctIndex: Number.isFinite(Number(row?.correctIndex))
                ? Number(row.correctIndex)
                : -1,
            explanation: String(row?.explanation || "").trim(),
            solveSteps: Array.isArray(row?.solveSteps)
                ? row.solveSteps.map(String)
                : [],
            unfixable: Boolean(row?.unfixable),
            reason: String(row?.reason || "").trim(),
        });
    }
    return out;
};

/**
 * Deterministic explanation issues → LLM rewrite explanation only → unfixable if still bad.
 */
export const runExplanationVerifierPass = async (
    questions = [],
    { topic = "", bankName = "", examProfile = "competitive" } = {},
    { callLlm } = {}
) => {
    const noop = {
        questions,
        fixedCount: 0,
        unfixableRefs: [],
        report: [],
    };
    if (!isExplanationVerifierEnabled() || typeof callLlm !== "function") {
        return noop;
    }

    const flat = flattenQuestionBankForCorrectnessAudit(questions);
    const audit = runDeterministicCorrectnessAudit(
        flat.map((e) => e.auditItem)
    );
    const reasonsByNumber = new Map();
    for (const issue of audit.confirmedIssues || []) {
        if (!isExplanationIssue(issue.issue)) continue;
        const n = Number(issue.questionNumber);
        if (!Number.isFinite(n)) continue;
        if (!reasonsByNumber.has(n)) reasonsByNumber.set(n, []);
        reasonsByNumber.get(n).push(issue.issue);
    }

    const fixSet = [];
    flat.forEach((e, i) => {
        const reasons = reasonsByNumber.get(i + 1);
        if (!reasons?.length) return;
        const q = getAtRef(questions, e.ref);
        if (!q) return;
        const type = String(q.questionType || "single").toLowerCase();
        if (type !== "single") return;
        fixSet.push({
            ref: e.ref,
            question: q,
            markedIndex: markedIndexOf(q),
            reasons,
        });
    });

    if (!fixSet.length) {
        pipelineTrace("EXPLANATION_VERIFIER_SKIP", { reason: "no_issues" });
        return noop;
    }

    let next = questions;
    let fixedCount = 0;
    const unfixableRefs = [];
    const report = [];

    const batches = chunk(fixSet, BATCH_SIZE);
    const parsedBatches = await runTasksWithConcurrency(
        batches.map((batch) => async () => {
            try {
                const raw = await callLlm(
                    buildExplanationOnlyFixPrompt({
                        entries: batch,
                        topic: topic || bankName,
                        examProfile,
                    })
                );
                return {
                    batch,
                    parsed: parseExplanationFixResponse(raw, batch.length),
                    error: null,
                };
            } catch (err) {
                pipelineTrace("EXPLANATION_VERIFIER_FIX_FAILED", {
                    error: err?.message || String(err),
                    batchSize: batch.length,
                });
                return { batch, parsed: null, error: err };
            }
        }),
        VERIFIER_CONCURRENCY
    );

    for (const { batch, parsed, error } of parsedBatches) {
        if (error || !parsed) {
            batch.forEach((e) =>
                unfixableRefs.push({
                    ref: e.ref,
                    reason: "explanation fix failed",
                })
            );
            continue;
        }

        batch.forEach((entry, i) => {
            const fix = parsed.get(i);
            const opts = optionTexts(entry.question);
            const mustKeep = entry.markedIndex;
            if (
                !fix ||
                fix.unfixable ||
                fix.correctIndex !== mustKeep ||
                mustKeep < 0 ||
                mustKeep >= opts.length
            ) {
                unfixableRefs.push({
                    ref: entry.ref,
                    reason:
                        fix?.reason ||
                        "explanation does not justify marked option",
                });
                report.push({
                    ref: entry.ref,
                    ok: false,
                    status: "unfixable",
                    reason: fix?.reason || "explanation mismatch",
                });
                return;
            }

            const markedText = opts[mustKeep];
            const correctLetter = letter(mustKeep);
            const steps = fix.solveSteps.length
                ? syncSolveStepsToMarkedAnswer(fix.solveSteps, markedText).map(
                      (s, si, arr) =>
                          si === arr.length - 1
                              ? `${String(s || "")
                                    .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                                    .trim()} FINAL_ANSWER: ${correctLetter}`
                              : s
                  )
                : [];
            const explanation = fix.solveSteps.length
                ? lockExplanationToMarkedOption(fix.solveSteps, markedText, {
                      correctLetter,
                  })
                : fix.explanation;

            next = setAtRef(next, entry.ref, {
                ...(getAtRef(next, entry.ref) || entry.question),
                explanation,
                ...(steps.length ? { _solveSteps: steps } : {}),
                _verification: {
                    ...((getAtRef(next, entry.ref) || entry.question)
                        ?._verification || {}),
                    explanationOk: true,
                    status: "fixed",
                },
            });
            fixedCount++;
            report.push({ ref: entry.ref, ok: true, status: "fixed" });
        });
    }

    return {
        questions: next,
        fixedCount,
        unfixableRefs,
        report,
    };
};
