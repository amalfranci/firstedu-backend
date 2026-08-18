/**
 * Independent answer verification + in-place answer/explanation correction.
 *
 * WHY: the deterministic correctness audit (correctnessPreAudit.service.js) only catches
 * *internal inconsistency* — explanation says X while the key says Y. A question solved
 * WRONG but explained consistently with that wrong answer passes every check. And the only
 * existing in-place fix (reconcileQuestionWithIndependentVerify) covers just 11 hardcoded
 * solver patterns; everything else was handed to the rewrite path, which discards an
 * otherwise-good question instead of correcting its key/explanation.
 *
 * THIS PASS:
 *   1. Re-solves every question independently — the model sees ONLY the stem + options,
 *      never the marked key or the existing explanation (otherwise it just agrees).
 *   2. Fixes, IN PLACE, any item where the independent answer disagrees with the marked key
 *      or the deterministic audit flagged an explanation/key defect: corrected correctIndex
 *      + rewritten explanation/solveSteps, with the stem and options left untouched.
 *   3. Reports anything unsalvageable (no correct option, duplicate options, broken stem) as
 *      `unfixableRefs` so the caller's existing rewrite/strip path handles it.
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
    buildExamSolveThenWriteBlock,
    buildPostSolveSelfCheckBlock,
    buildExplanationOptionLockBlock,
    buildExamAnswerKeyLockBlock,
} from "./examPromptContext.service.js";

/** Default ON — set AI_QB_ANSWER_CORRECTION=0 to disable (restores prior behaviour). */
export const isAnswerCorrectionEnabled = () => {
    const flag = process.env.AI_QB_ANSWER_CORRECTION;
    if (flag === "0" || flag === "false") return false;
    return true;
};

/** Questions per independent-solve LLM call. */
const SOLVE_BATCH_SIZE = Number(process.env.AI_QB_ANSWER_CORRECTION_BATCH || 10);

/**
 * A low-confidence disagreement is usually the checker failing to solve, not a real
 * defect — re-keying on that would corrupt good questions. Only act on medium/high.
 */
const ACTIONABLE_CONFIDENCE = new Set(["high", "medium"]);

const letter = (i) => String.fromCharCode(65 + Number(i));

const getAtRef = (questions, ref) =>
    ref.subIndex != null
        ? questions[ref.topIndex]?.subQuestions?.[ref.subIndex]
        : questions[ref.topIndex];

/** Immutably write a corrected question back at its ref. */
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

/** Only single-answer items are re-keyed here; multi-correct/true-false keep their key. */
const isCorrectable = (q) => {
    const type = String(q?.questionType || "single").toLowerCase();
    if (type !== "single") return false;
    const opts = optionTexts(q);
    return opts.length >= 2 && opts.every((t) => t.trim().length > 0);
};

// ── Prompt 1: independent solve (never shows the key or explanation) ────────────
export const buildIndependentSolvePrompt = ({
    questions = [],
    topic = "",
    examProfile = "competitive",
} = {}) => {
    const blocks = questions
        .map((entry, i) => {
            const opts = optionTexts(entry.question)
                .map((t, oi) => `   ${letter(oi)}) ${t}`)
                .join("\n");
            return `#${i + 1}\n${String(entry.question.questionText || "").trim()}\n${opts}`;
        })
        .join("\n\n");

    return `You are an expert ${examProfile} examiner independently solving questions to verify an answer key.

**Topic:** ${topic || "(not set)"}

**TASK:** Solve each question below **from scratch**. You are deliberately NOT shown any
answer key or explanation — do not guess what was intended, just solve it yourself.

${buildExamSolveThenWriteBlock()}

For each question return:
- \`index\`: the question number shown
- \`answerIndex\`: 0-based index of the option YOU compute to be correct (0=A, 1=B, …)
- \`value\`: your computed final value/answer as text (with unit if any)
- \`confidence\`: "high" | "medium" | "low"
  · "high"   — you solved it fully and exactly one option matches
  · "medium" — you solved it but the match is approximate or rounding-dependent
  · "low"    — you could not solve it confidently (ambiguous stem, missing data)

If NO option matches your computed answer, set \`answerIndex\` to -1 and explain in \`value\`.

**Questions:**
${blocks}

Return ONLY a valid JSON array, one object per question, no markdown:
[{"index":1,"answerIndex":2,"value":"60 cm","confidence":"high"}]`;
};

export const parseIndependentSolveResponse = (rawText, expected = 0) => {
    const rows = parseJsonArrayFromAIText(rawText) || [];
    const out = new Map();
    for (const row of rows) {
        const idx = Number(row?.index);
        if (!Number.isInteger(idx) || idx < 1 || (expected && idx > expected)) continue;
        out.set(idx - 1, {
            answerIndex: Number.isFinite(Number(row?.answerIndex))
                ? Number(row.answerIndex)
                : -1,
            value: String(row?.value ?? "").trim(),
            confidence: String(row?.confidence || "low").toLowerCase(),
        });
    }
    return out;
};

// ── Prompt 2: fix the key + explanation in place ───────────────────────────────
export const buildAnswerExplanationFixPrompt = ({
    entries = [],
    topic = "",
    examProfile = "competitive",
} = {}) => {
    const blocks = entries
        .map((e, i) => {
            const opts = optionTexts(e.question)
                .map((t, oi) => `   ${letter(oi)}) ${t}`)
                .join("\n");
            const reasons = (e.reasons || []).map((r) => `  - ${r}`).join("\n");
            return `### Item ${i + 1}
**Stem (DO NOT CHANGE):**
${String(e.question.questionText || "").trim()}
**Options (DO NOT CHANGE):**
${opts}
**Currently marked answer:** ${e.markedIndex >= 0 ? letter(e.markedIndex) : "(none)"}
**Current explanation:** ${String(e.question.explanation || "").trim() || "(none)"}
**Detected problems:**
${reasons || "  - answer/explanation correctness in doubt"}`;
        })
        .join("\n\n");

    return `You are correcting the ANSWER KEY and EXPLANATION of ${entries.length} exam question(s).

**Topic:** ${topic || "(not set)"}

${buildExamAnswerKeyLockBlock()}
${buildExplanationOptionLockBlock({ examProfile })}
${buildPostSolveSelfCheckBlock()}

**TASK — for each item:**
1. Re-solve the question yourself from the stem.
2. Return the **corrected 0-based \`correctIndex\`** pointing at the option that matches your solve.
3. Return a rewritten **\`explanation\`** and **\`solveSteps\`** that derive exactly that option.

**HARD RULES:**
- **Never change the stem or the options.** You are fixing the key and the explanation only.
- The explanation must end at the value of the option you marked — no contradictions, no
  "wait"/"correction" meta text, no self-revision.
- If the question cannot be made correct without editing the stem or options — e.g. **no
  option matches** the true answer, options are duplicated, or the stem is missing data —
  set \`"unfixable": true\` with a short \`"reason"\`. Do NOT force a wrong key to make it pass.

${blocks}

Return ONLY a valid JSON array, one object per item in the same order, no markdown:
[{"index":1,"correctIndex":2,"explanation":"...","solveSteps":["...","..."],"unfixable":false,"reason":""}]`;
};

export const parseAnswerFixResponse = (rawText, expected = 0) => {
    const rows = parseJsonArrayFromAIText(rawText) || [];
    const out = new Map();
    rows.forEach((row, i) => {
        const idx = Number.isInteger(Number(row?.index))
            ? Number(row.index) - 1
            : i;
        if (idx < 0 || (expected && idx >= expected)) return;
        out.set(idx, {
            correctIndex: Number.isFinite(Number(row?.correctIndex))
                ? Number(row.correctIndex)
                : -1,
            explanation: String(row?.explanation ?? "").trim(),
            solveSteps: Array.isArray(row?.solveSteps)
                ? row.solveSteps.map(String).map((s) => s.trim()).filter(Boolean)
                : [],
            unfixable: row?.unfixable === true,
            reason: String(row?.reason ?? "").trim(),
        });
    });
    return out;
};

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

/**
 * Verify every question's answer independently and correct answer/explanation in place.
 *
 * @param {Array<object>} questions question-bank array (standalone + connected)
 * @param {{ topic?: string, bankName?: string, examProfile?: string }} ctx
 * @param {{ callLlm: (prompt: string) => Promise<string> }} deps
 * @returns {Promise<{questions: Array<object>, checkedCount: number, disagreementCount: number,
 *   fixedCount: number, unfixableRefs: Array<object>, report: Array<object>}>}
 */
export const runAnswerCorrectnessPass = async (
    questions = [],
    { topic = "", bankName = "", examProfile = "competitive" } = {},
    { callLlm } = {}
) => {
    const noop = {
        questions,
        checkedCount: 0,
        disagreementCount: 0,
        fixedCount: 0,
        unfixableRefs: [],
        report: [],
    };
    if (!isAnswerCorrectionEnabled() || typeof callLlm !== "function") return noop;

    // finalizeQuestionBankSuggestions runs per generation chunk AND again on the merged
    // bank, so without this guard the same questions would be re-solved several times.
    // `_answerChecked` makes the pass idempotent: each question costs one solve, once.
    const entries = flattenQuestionBankForCorrectnessAudit(questions)
        .map((e) => ({ ref: e.ref, question: getAtRef(questions, e.ref) }))
        .filter(
            (e) => e.question && isCorrectable(e.question) && !e.question._answerChecked
        );
    if (!entries.length) return noop;

    // ── 1. Independent re-solve (stem + options only) ──────────────────────────
    const solved = new Map();
    for (const batch of chunk(entries, SOLVE_BATCH_SIZE)) {
        try {
            const raw = await callLlm(
                buildIndependentSolvePrompt({
                    questions: batch,
                    topic: topic || bankName,
                    examProfile,
                })
            );
            const parsed = parseIndependentSolveResponse(raw, batch.length);
            for (const [localIdx, result] of parsed.entries()) {
                const globalIdx = entries.indexOf(batch[localIdx]);
                if (globalIdx >= 0) solved.set(globalIdx, result);
            }
        } catch (err) {
            pipelineTrace("ANSWER_CORRECTION_SOLVE_FAILED", {
                error: err?.message || String(err),
                batchSize: batch.length,
            });
        }
    }

    // Mark everything we solved as checked so later finalize passes (per-chunk AND the
    // merged-bank pass) skip it. Done here, before the early return below, so it applies
    // whether or not any fix turns out to be needed.
    let next = questions;
    entries.forEach((entry) => {
        const cur = getAtRef(next, entry.ref);
        if (cur && !cur._answerChecked) {
            next = setAtRef(next, entry.ref, { ...cur, _answerChecked: true });
        }
    });

    // ── 2. Build the fix set: independent disagreement ∪ deterministic-audit flags ──
    const auditIssuesByNumber = new Map();
    const flat = flattenQuestionBankForCorrectnessAudit(questions);
    const audit = runDeterministicCorrectnessAudit(flat.map((e) => e.auditItem));
    for (const issue of audit.confirmedIssues || []) {
        const n = Number(issue.questionNumber);
        if (!Number.isFinite(n)) continue;
        if (!auditIssuesByNumber.has(n)) auditIssuesByNumber.set(n, []);
        auditIssuesByNumber.get(n).push(issue.issue);
    }
    // flat[] is 1-indexed by questionNumber in the same order as it was built
    const refKey = (ref) => `${ref.topIndex}:${ref.subIndex ?? "-"}`;
    const auditReasonsByRef = new Map();
    flat.forEach((e, i) => {
        const reasons = auditIssuesByNumber.get(i + 1);
        if (reasons?.length) auditReasonsByRef.set(refKey(e.ref), reasons);
    });

    const fixSet = [];
    let disagreementCount = 0;
    entries.forEach((entry, i) => {
        const reasons = [...(auditReasonsByRef.get(refKey(entry.ref)) || [])];
        const marked = markedIndexOf(entry.question);
        const check = solved.get(i);
        if (
            check &&
            ACTIONABLE_CONFIDENCE.has(check.confidence) &&
            check.answerIndex !== marked
        ) {
            disagreementCount++;
            reasons.push(
                check.answerIndex >= 0
                    ? `Independent re-solve computed ${check.value || letter(check.answerIndex)} → option ${letter(check.answerIndex)}, but ${marked >= 0 ? letter(marked) : "(none)"} is marked.`
                    : `Independent re-solve found NO option matching the computed answer (${check.value}).`
            );
        }
        if (reasons.length) {
            fixSet.push({ ...entry, markedIndex: marked, reasons });
        }
    });

    pipelineTrace("ANSWER_CORRECTION_CHECK", {
        checked: entries.length,
        disagreements: disagreementCount,
        auditFlagged: auditReasonsByRef.size,
        toFix: fixSet.length,
    });

    if (!fixSet.length) {
        return { ...noop, questions: next, checkedCount: entries.length };
    }

    // ── 3. Fix in place ───────────────────────────────────────────────────────
    let fixedCount = 0;
    const unfixableRefs = [];
    const report = [];

    for (const batch of chunk(fixSet, SOLVE_BATCH_SIZE)) {
        let parsed;
        try {
            const raw = await callLlm(
                buildAnswerExplanationFixPrompt({
                    entries: batch,
                    topic: topic || bankName,
                    examProfile,
                })
            );
            parsed = parseAnswerFixResponse(raw, batch.length);
        } catch (err) {
            pipelineTrace("ANSWER_CORRECTION_FIX_FAILED", {
                error: err?.message || String(err),
                batchSize: batch.length,
            });
            batch.forEach((e) =>
                unfixableRefs.push({ ref: e.ref, reason: "fix call failed" })
            );
            continue;
        }

        batch.forEach((entry, i) => {
            const fix = parsed.get(i);
            const opts = optionTexts(entry.question);
            if (!fix || fix.unfixable || fix.correctIndex < 0 || fix.correctIndex >= opts.length) {
                unfixableRefs.push({
                    ref: entry.ref,
                    reason: fix?.reason || "no valid correction returned",
                });
                report.push({
                    ref: entry.ref,
                    status: "unfixable",
                    reason: fix?.reason || "no valid correction returned",
                    reasons: entry.reasons,
                });
                return;
            }

            const markedText = opts[fix.correctIndex];
            // Build the explanation from the RAW steps — lockExplanationToMarkedOption adds
            // the "Therefore, the correct answer is …" closing itself. Feeding it the synced
            // steps (which already carry that closing) would duplicate it.
            const steps = fix.solveSteps.length
                ? syncSolveStepsToMarkedAnswer(fix.solveSteps, markedText)
                : [];
            const explanation = fix.solveSteps.length
                ? lockExplanationToMarkedOption(fix.solveSteps, markedText)
                : fix.explanation || entry.question.explanation;

            // Spread from the CURRENT version at this ref, not the entry snapshot taken
            // before stamping — otherwise the fix would wipe the _answerChecked flag.
            const updated = {
                ...(getAtRef(next, entry.ref) || entry.question),
                correctIndex: fix.correctIndex,
                correctAnswer: letter(fix.correctIndex),
                explanation,
                ...(steps.length ? { _solveSteps: steps } : {}),
            };
            next = setAtRef(next, entry.ref, updated);
            fixedCount++;
            report.push({
                ref: entry.ref,
                status: "fixed",
                from: entry.markedIndex >= 0 ? letter(entry.markedIndex) : "(none)",
                to: letter(fix.correctIndex),
                reasons: entry.reasons,
            });
        });
    }

    // ── 4. Re-audit: did the fixes actually land? ─────────────────────────────
    // Only questions we ATTEMPTED to fix are re-judged here, and only against
    // answer/explanation defects. Pre-existing style issues on untouched questions are
    // the caller's strip/repair path's business, not ours — flagging those as unfixable
    // would wrongly send good questions to be rewritten.
    // Use the audit's own factual/style split: `factualIssues` are answer-key and
    // explanation defects (ours to fix); `styleIssues` are distractor/wording problems
    // that this pass deliberately does not touch, since fixing them would mean editing
    // the options — out of scope here and the strip/repair path's job.
    const after = runDeterministicCorrectnessAudit(
        flattenQuestionBankForCorrectnessAudit(next).map((e) => e.auditItem)
    );
    const remainingByRef = new Map();
    const afterFlat = flattenQuestionBankForCorrectnessAudit(next);
    for (const iss of after.factualIssues || []) {
        const i = Number(iss.questionNumber) - 1;
        const e = afterFlat[i];
        if (!e) continue;
        if (!remainingByRef.has(refKey(e.ref))) remainingByRef.set(refKey(e.ref), []);
        remainingByRef.get(refKey(e.ref)).push(iss.issue);
    }
    for (const row of report) {
        if (row.status !== "fixed") continue;
        const remaining = remainingByRef.get(refKey(row.ref));
        if (!remaining?.length) continue;
        row.status = "unfixable";
        row.reason = `still fails after fix: ${remaining[0]}`;
        fixedCount -= 1;
        if (!unfixableRefs.some((u) => refKey(u.ref) === refKey(row.ref))) {
            unfixableRefs.push({ ref: row.ref, reason: row.reason });
        }
    }

    pipelineTrace("ANSWER_CORRECTION_RESULT", {
        checked: entries.length,
        disagreements: disagreementCount,
        fixed: fixedCount,
        unfixable: unfixableRefs.length,
        correctnessScoreAfter: after.correctnessScore,
    });

    return {
        questions: next,
        checkedCount: entries.length,
        disagreementCount,
        fixedCount,
        unfixableRefs,
        report,
    };
};

export default {
    isAnswerCorrectionEnabled,
    buildIndependentSolvePrompt,
    parseIndependentSolveResponse,
    buildAnswerExplanationFixPrompt,
    parseAnswerFixResponse,
    runAnswerCorrectnessPass,
};
