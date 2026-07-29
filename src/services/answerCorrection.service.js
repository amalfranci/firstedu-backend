/**
 * Independent answer verification + in-place answer/explanation correction.
 *
 * SOLVER-TRUTH MODE (AI_QB_SOLVER_TRUTH=1, default):
 *   Independent Solver is the ONLY source of truth. Generator answer/explanation
 *   are ignored. Solver returns answerIndex + solveSteps → FINAL_ANSWER →
 *   explanation is derived from those steps (no second reasoning chain).
 *
 * LEGACY MODE (AI_QB_SOLVER_TRUTH=0):
 *   1. Blind re-solve (stem + options only).
 *   2. Fix in place only on medium/high disagreement or audit flags.
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
import { runTasksWithConcurrency } from "./aiQuestionCountInference.service.js";
import {
    isSolverTruthEnabled,
    normalizeSolverConfidence,
    confidenceIsActionable,
    shouldDoubleSolve,
    getAnswerConfidenceFloor,
    getSolverTruthConcurrency,
    rebuildExplanationFromVerifiedSolution,
} from "./solverTruth.service.js";

/** Default ON — set AI_QB_ANSWER_CORRECTION=0 to disable (restores prior behaviour). */
export const isAnswerCorrectionEnabled = () => {
    const flag = process.env.AI_QB_ANSWER_CORRECTION;
    if (flag === "0" || flag === "false") return false;
    return true;
};

/** Questions per independent-solve LLM call. Legacy batching; solver-truth uses 1. */
const SOLVE_BATCH_SIZE = Number(process.env.AI_QB_ANSWER_CORRECTION_BATCH || 10);
const SOLVE_CONCURRENCY = Math.max(
    1,
    Number(process.env.AI_QB_ANSWER_CORRECTION_CONCURRENCY || 3)
);

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
    requireSolveSteps = false,
    structuredTruthSchema = false,
} = {}) => {
    const blocks = questions
        .map((entry, i) => {
            const opts = optionTexts(entry.question)
                .map((t, oi) => `   ${letter(oi)}) ${t}`)
                .join("\n");
            return `#${i + 1}\n${String(entry.question.questionText || "").trim()}\n${opts}`;
        })
        .join("\n\n");

    if (structuredTruthSchema || requireSolveSteps) {
        return `You are an expert ${examProfile} examiner. Independently solve each question from scratch.

**Topic:** ${topic || "(not set)"}

You are deliberately NOT shown any answer key or prior explanation — do not guess what was intended.

${buildExamSolveThenWriteBlock()}

For EACH question return ONE JSON object with this exact schema:
- \`index\`: question number
- \`final_answer\`: option letter only — "A" | "B" | "C" | "D"
- \`answerConfidence\`: 0.0–1.0 how sure the option letter is correct
- \`reasoningConfidence\`: 0.0–1.0 how sure the derivation is free of arithmetic/logic errors
- \`steps\`: array of 3–8 short derivation steps (same reasoning chain as explanation)
- \`explanation\`: clean student-facing prose of THOSE SAME steps (not a re-derivation). Must end by stating the chosen option letter (e.g. "Therefore, the correct answer is C. FINAL_ANSWER: C").

HARD RULES:
- \`explanation\` and \`steps\` must be the SAME reasoning chain — never invent a second solution.
- \`final_answer\` is the ONLY answer — do not bury a different letter in the explanation.
- If no option matches, set \`final_answer\` to "" and \`answerConfidence\` ≤ 0.3.

**Questions:**
${blocks}

Return ONLY a valid JSON array:
[{"index":1,"final_answer":"C","answerConfidence":0.96,"reasoningConfidence":0.88,"steps":["…","…"],"explanation":"… Therefore, the correct answer is C. FINAL_ANSWER: C"}]`;
    }

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

        const steps = Array.isArray(row?.steps)
            ? row.steps.map(String).map((s) => s.trim()).filter(Boolean)
            : Array.isArray(row?.solveSteps)
              ? row.solveSteps.map(String).map((s) => s.trim()).filter(Boolean)
              : [];

        let finalLetter = String(row?.final_answer || row?.finalAnswer || "")
            .trim()
            .toUpperCase();
        if (!/^[A-D]$/.test(finalLetter) && Number.isFinite(Number(row?.answerIndex))) {
            const ai = Number(row.answerIndex);
            if (ai >= 0 && ai <= 3) finalLetter = letter(ai);
        }

        const answerConfidence = normalizeSolverConfidence(
            row?.answerConfidence ?? row?.confidence ?? 0.5
        );
        const reasoningConfidence = normalizeSolverConfidence(
            row?.reasoningConfidence ?? row?.answerConfidence ?? row?.confidence ?? 0.5
        );

        out.set(idx - 1, {
            final_answer: /^[A-D]$/.test(finalLetter) ? finalLetter : "",
            answerIndex: /^[A-D]$/.test(finalLetter)
                ? finalLetter.charCodeAt(0) - 65
                : Number.isFinite(Number(row?.answerIndex))
                  ? Number(row.answerIndex)
                  : -1,
            value: String(row?.value ?? "").trim(),
            confidence:
                answerConfidence >= 0.85
                    ? "high"
                    : answerConfidence >= 0.55
                      ? "medium"
                      : "low",
            answerConfidence,
            reasoningConfidence,
            solveSteps: steps,
            explanation: String(row?.explanation || "").trim(),
        });
    }
    return out;
};

const pickBetterSolve = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const score = (x) =>
        (x.answerConfidence || 0) * 0.6 + (x.reasoningConfidence || 0) * 0.4;
    return score(a) >= score(b) ? a : b;
};

/**
 * Apply Independent Solver structured JSON as the sole source of truth.
 * Generator answer/explanation are ignored. correctAnswer = final_answer only.
 */
const applySolverAsSourceOfTruth = ({ questions, entries, solved }) => {
    let next = questions;
    let fixedCount = 0;
    let disagreementCount = 0;
    const unfixableRefs = [];
    const report = [];
    const floor = getAnswerConfidenceFloor();

    entries.forEach((entry, i) => {
        const cur = getAtRef(next, entry.ref) || entry.question;
        const opts = optionTexts(cur);
        const priorMarked = markedIndexOf(cur);
        const check = solved.get(i);

        if (!check || !check.final_answer) {
            unfixableRefs.push({
                ref: entry.ref,
                reason: "independent solver returned no final_answer",
            });
            report.push({
                ref: entry.ref,
                status: "unfixable",
                reason: "missing_final_answer",
                stage: "solver_truth",
            });
            next = setAtRef(next, entry.ref, {
                ...cur,
                _answerChecked: true,
                _solverTruthApplied: false,
            });
            return;
        }

        const correctIndex = check.final_answer.charCodeAt(0) - 65;
        if (correctIndex < 0 || correctIndex >= opts.length) {
            unfixableRefs.push({
                ref: entry.ref,
                reason: "final_answer not in option set",
            });
            next = setAtRef(next, entry.ref, {
                ...cur,
                _answerChecked: true,
                _solverTruthApplied: false,
            });
            return;
        }

        if (!confidenceIsActionable(check.answerConfidence, floor)) {
            unfixableRefs.push({
                ref: entry.ref,
                reason: `answerConfidence ${check.answerConfidence} < ${floor}`,
            });
            report.push({
                ref: entry.ref,
                status: "unfixable",
                reason: "low_answer_confidence",
                answerConfidence: check.answerConfidence,
                stage: "solver_truth",
            });
            next = setAtRef(next, entry.ref, {
                ...cur,
                _answerChecked: true,
                _solverTruthApplied: false,
                _verification: {
                    ...(cur._verification || {}),
                    answerConfidence: check.answerConfidence,
                    reasoningConfidence: check.reasoningConfidence,
                    status: "stripped",
                    ruleFailures: [
                        ...((cur._verification?.ruleFailures) || []),
                        "low_answer_confidence",
                    ],
                },
            });
            return;
        }

        const stepsRaw =
            check.solveSteps?.length >= 2
                ? check.solveSteps
                : check.explanation
                  ? [check.explanation]
                  : [];

        if (!stepsRaw.length && !check.explanation) {
            unfixableRefs.push({ ref: entry.ref, reason: "empty_solution" });
            next = setAtRef(next, entry.ref, {
                ...cur,
                _answerChecked: true,
                _solverTruthApplied: false,
            });
            return;
        }

        const correctLetter = check.final_answer;
        const markedText = opts[correctIndex];
        const steps = (stepsRaw.length
            ? syncSolveStepsToMarkedAnswer(stepsRaw, markedText)
            : stepsRaw
        ).map((s, si, arr) =>
            si === arr.length - 1
                ? `${String(s || "")
                      .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                      .trim()} FINAL_ANSWER: ${correctLetter}`
                : s
        );

        // Prefer solver's explanation if present; else derive from steps (same chain).
        let explanation = String(check.explanation || "").trim();
        if (!explanation && stepsRaw.length) {
            explanation = lockExplanationToMarkedOption(stepsRaw, markedText, {
                correctLetter,
            });
        }

        let updated = {
            ...cur,
            correctIndex,
            correctAnswer: correctLetter,
            final_answer: correctLetter,
            explanation,
            _solveSteps: steps.length ? steps : stepsRaw,
            answerConfidence: check.answerConfidence,
            reasoningConfidence: check.reasoningConfidence,
            _answerChecked: true,
            _solverTruthApplied: true,
            _generatorCorrectIndex:
                priorMarked >= 0 ? priorMarked : cur._generatorCorrectIndex,
            _verification: {
                ...(cur._verification || {}),
                status:
                    priorMarked >= 0 && priorMarked !== correctIndex
                        ? "fixed"
                        : "passed",
                answerConfidence: check.answerConfidence,
                reasoningConfidence: check.reasoningConfidence,
                explanationOk: true,
                sourceOfTruth: "independent_solver",
                solverValue: check.value || null,
            },
        };

        // Ensure explanation concludes with final_answer (repair only — never change answer).
        updated = rebuildExplanationFromVerifiedSolution(updated);

        if (priorMarked >= 0 && priorMarked !== correctIndex) disagreementCount++;
        fixedCount++;
        next = setAtRef(next, entry.ref, updated);

        report.push({
            ref: entry.ref,
            status:
                priorMarked >= 0 && priorMarked !== correctIndex
                    ? "fixed"
                    : "passed",
            from: priorMarked >= 0 ? letter(priorMarked) : "(ignored)",
            to: correctLetter,
            answerConfidence: check.answerConfidence,
            reasoningConfidence: check.reasoningConfidence,
            stage: "solver_truth",
        });
    });

    pipelineTrace("SOLVER_TRUTH_APPLIED", {
        checked: entries.length,
        applied: fixedCount,
        disagreements: disagreementCount,
        unfixable: unfixableRefs.length,
        confidenceFloor: floor,
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
    {
        topic = "",
        bankName = "",
        examProfile = "competitive",
        subject = "",
        sectionName = "",
        difficulty = "",
    } = {},
    { callLlm, callLlmSecondary = null } = {}
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

    const solverTruth = isSolverTruthEnabled();

    const entries = flattenQuestionBankForCorrectnessAudit(questions)
        .map((e) => ({ ref: e.ref, question: getAtRef(questions, e.ref) }))
        .filter((e) => {
            if (!e.question || !isCorrectable(e.question)) return false;
            if (solverTruth) return !e.question._solverTruthApplied;
            return !e.question._answerChecked;
        });
    if (!entries.length) return noop;

    // ── 1. Independent re-solve (stem + options only) ──────────────────────────
    const solved = new Map();

    if (solverTruth) {
        // One question per call, parallel workers — avoids batch anchoring & cuts latency.
        const concurrency = getSolverTruthConcurrency();
        await runTasksWithConcurrency(
            entries.map((entry, globalIdx) => async () => {
                const batch = [entry];
                const prompt = buildIndependentSolvePrompt({
                    questions: batch,
                    topic: topic || bankName,
                    examProfile,
                    structuredTruthSchema: true,
                });
                try {
                    const raw = await callLlm(prompt);
                    const parsed = parseIndependentSolveResponse(raw, 1);
                    let primary = parsed.get(0) || null;

                    const needDouble = shouldDoubleSolve({
                        difficulty:
                            difficulty ||
                            entry.question?.difficulty ||
                            entry.question?.difficultyTier ||
                            "",
                        subject,
                        sectionName,
                        question: entry.question,
                    });

                    if (needDouble) {
                        const secondaryFn =
                            typeof callLlmSecondary === "function"
                                ? callLlmSecondary
                                : callLlm;
                        try {
                            const raw2 = await secondaryFn(prompt);
                            const parsed2 = parseIndependentSolveResponse(raw2, 1);
                            const secondary = parsed2.get(0) || null;
                            if (
                                primary?.final_answer &&
                                secondary?.final_answer &&
                                primary.final_answer !== secondary.final_answer
                            ) {
                                pipelineTrace("SOLVER_DOUBLE_DISAGREE", {
                                    a: primary.final_answer,
                                    b: secondary.final_answer,
                                    stem: String(
                                        entry.question?.questionText || ""
                                    ).slice(0, 80),
                                });
                                // Disagreement → leave unsolved so question regenerates.
                                solved.set(globalIdx, null);
                                return;
                            }
                            primary = pickBetterSolve(primary, secondary);
                            pipelineTrace("SOLVER_DOUBLE_AGREE", {
                                final_answer: primary?.final_answer,
                                answerConfidence: primary?.answerConfidence,
                            });
                        } catch (err) {
                            pipelineTrace("SOLVER_DOUBLE_SECONDARY_FAILED", {
                                error: err?.message || String(err),
                            });
                        }
                    }

                    if (primary) solved.set(globalIdx, primary);
                } catch (err) {
                    pipelineTrace("ANSWER_CORRECTION_SOLVE_FAILED", {
                        error: err?.message || String(err),
                        batchSize: 1,
                    });
                }
            }),
            concurrency
        );

        return applySolverAsSourceOfTruth({
            questions,
            entries,
            solved,
        });
    }

    const solveBatches = chunk(entries, SOLVE_BATCH_SIZE);
    await runTasksWithConcurrency(
        solveBatches.map((batch) => async () => {
            try {
                const raw = await callLlm(
                    buildIndependentSolvePrompt({
                        questions: batch,
                        topic: topic || bankName,
                        examProfile,
                        requireSolveSteps: false,
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
        }),
        SOLVE_CONCURRENCY
    );

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

    // ── 3. Fix in place (parallel LLM calls, sequential apply) ────────────────
    let fixedCount = 0;
    const unfixableRefs = [];
    const report = [];

    const fixBatches = chunk(fixSet, SOLVE_BATCH_SIZE);
    const fixParsedByBatch = await runTasksWithConcurrency(
        fixBatches.map((batch, batchIndex) => async () => {
            try {
                const raw = await callLlm(
                    buildAnswerExplanationFixPrompt({
                        entries: batch,
                        topic: topic || bankName,
                        examProfile,
                    })
                );
                return {
                    batchIndex,
                    batch,
                    parsed: parseAnswerFixResponse(raw, batch.length),
                    error: null,
                };
            } catch (err) {
                pipelineTrace("ANSWER_CORRECTION_FIX_FAILED", {
                    error: err?.message || String(err),
                    batchSize: batch.length,
                });
                return { batchIndex, batch, parsed: null, error: err };
            }
        }),
        SOLVE_CONCURRENCY
    );

    for (const { batch, parsed, error } of fixParsedByBatch) {
        if (error || !parsed) {
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
            const correctLetter = letter(fix.correctIndex);
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
                : fix.explanation || entry.question.explanation;

            const updated = {
                ...(getAtRef(next, entry.ref) || entry.question),
                correctIndex: fix.correctIndex,
                correctAnswer: correctLetter,
                explanation,
                ...(steps.length ? { _solveSteps: steps } : {}),
                _verification: {
                    ...((getAtRef(next, entry.ref) || entry.question)?._verification ||
                        {}),
                    status: "fixed",
                    answerConfidence:
                        entry.reasons?.some((r) => /Independent re-solve/i.test(r))
                            ? "medium"
                            : "high",
                    explanationOk: true,
                },
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
