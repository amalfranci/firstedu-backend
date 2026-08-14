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

import { parseJsonArrayFromAIText, parseJsonFlexibleFromAIText } from "../utils/aiJsonRepair.js";
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
    isDoubleSolveRequired,
    isStrictAnswerCorrectnessEnabled,
    getAnswerConfidenceFloor,
    getStrictAnswerConfidenceFloor,
    getSolverTruthConcurrency,
} from "./solverTruth.service.js";
import { rewriteExplanationFromVerifiedSteps } from "./explanationRewrite.service.js";
import {
    buildNcertSolverReferenceBlock,
    inferNcertChaptersFromSlots,
} from "./ncertChapterReference.service.js";
import {
    buildJeeAdvancedNcertSolverBlock,
    inferJeeAdvancedTopicsFromSlots,
    isJeeAdvancedMathsDataAvailable,
} from "./jeeAdvancedMaths.service.js";
import {
    buildJeeAdvancedPhysicsNcertSolverBlock,
    inferJeeAdvancedPhysicsTopicsFromSlots,
    isJeeAdvancedPhysicsDataAvailable,
} from "./jeeAdvancedPhysics.service.js";
import {
    parseNumber,
    formatValueForOption,
    buildOptionsAroundExpected,
} from "./questionNumericVerify.service.js";

/**
 * NCERT formula/method reference for the chapters these questions belong to.
 * The solver is the source of truth for the answer key, so grounding it in the
 * chapter's real formula inventory is what stops a mis-recalled formula from
 * becoming the published answer. Empty for non-Mathematics batches.
 */
const buildSolverNcertBlock = (questions = [], topic = "") => {
    try {
        const slots = (Array.isArray(questions) ? questions : [])
            .map((entry) => {
                const q = entry?.question || entry || {};
                return {
                    chapter: q._chapter || q.chapter || "",
                    conceptSlot: q._conceptSlot || q.conceptSlot || "",
                    label: q._conceptLabel || "",
                    description: String(q.questionText || "").slice(0, 400),
                };
            })
            .filter((s) => s.chapter || s.conceptSlot || s.description);
        if (!slots.length) return "";

        const hay = String(topic || "").toLowerCase();
        const looksAdvanced =
            hay.includes("jee advanced") ||
            hay.includes("jee-advance") ||
            hay.includes("iit-jee advanced") ||
            hay.includes("advanced ›") ||
            hay.includes("jee_advanced");

        // Prefer Advanced pack when topic path is Advanced Maths/Physics and data exists.
        if (looksAdvanced && isJeeAdvancedMathsDataAvailable() && /\bmath/i.test(hay)) {
            const adv = buildJeeAdvancedNcertSolverBlock({
                subject: topic,
                examProfile: "jee_advanced",
                slots,
            });
            if (adv) return adv;
            const inferred = inferJeeAdvancedTopicsFromSlots(slots);
            if (inferred.length) {
                return buildJeeAdvancedNcertSolverBlock({
                    subject: topic,
                    examProfile: "jee_advanced",
                    topics: inferred.map((t) => t.topicId),
                });
            }
        }
        if (
            looksAdvanced &&
            isJeeAdvancedPhysicsDataAvailable() &&
            /\bphysics\b/i.test(hay)
        ) {
            const adv = buildJeeAdvancedPhysicsNcertSolverBlock({
                subject: topic,
                examProfile: "jee_advanced",
                slots,
            });
            if (adv) return adv;
            const inferred = inferJeeAdvancedPhysicsTopicsFromSlots(slots);
            if (inferred.length) {
                return buildJeeAdvancedPhysicsNcertSolverBlock({
                    subject: topic,
                    examProfile: "jee_advanced",
                    topics: inferred.map((t) => t.topicId),
                });
            }
        }

        const chapters = inferNcertChaptersFromSlots(slots).map((c) => c.label);
        if (!chapters.length) return "";
        return buildNcertSolverReferenceBlock({
            chapters,
            // `topic` carries the subject path (e.g. "… › Mathematics · …"),
            // which is what gates the block to Mathematics batches.
            subject: topic,
        });
    } catch {
        return "";
    }
};

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

// ── Prompt 1: BLIND independent solve (stem only — hide options to avoid bias) ──
export const buildBlindIndependentSolvePrompt = ({
    questions = [],
    topic = "",
    examProfile = "competitive",
} = {}) => {
    const blocks = questions
        .map((entry, i) => {
            const stem = String(entry.question.questionText || "").trim();
            return `#${i + 1}\n${stem}`;
        })
        .join("\n\n");

    return `You are an expert ${examProfile} examiner. Solve each question from scratch.

**Topic:** ${topic || "(not set)"}

CRITICAL: Options are HIDDEN on purpose. Do NOT invent option letters (A/B/C/D).
Derive the pure final numerical/symbolic/textual answer only.

${buildSolverNcertBlock(questions, topic)}
${buildExamSolveThenWriteBlock()}

For EACH question return ONE JSON object:
- \`index\`: question number
- \`computed_value\`: your final answer as plain text (number, expression, or short phrase — NO option letter)
- \`answerConfidence\`: 0.0–1.0 certainty that computed_value is correct
- \`reasoningConfidence\`: 0.0–1.0 certainty the derivation is error-free
- \`steps\`: array of 3–8 short derivation steps
- \`explanation\`: student-facing prose of THOSE SAME steps. End with: "COMPUTED_ANSWER: <same as computed_value>"

HARD RULES:
- Do not mention A/B/C/D.
- \`explanation\` and \`steps\` must be the SAME reasoning chain.
- If unsolvable, set \`computed_value\` to "" and \`answerConfidence\` ≤ 0.3.

**Questions (stem only):**
${blocks}

Return ONLY a valid JSON array:
[{"index":1,"computed_value":"2.36","answerConfidence":0.94,"reasoningConfidence":0.9,"steps":["…"],"explanation":"… COMPUTED_ANSWER: 2.36"}]`;
};

/** Fast secondary step: map a blind computed_value onto MCQ options (no re-solving). */
export const buildOptionMapPrompt = ({
    computedValue = "",
    options = [],
    stem = "",
} = {}) => {
    const opts = (options || [])
        .map((t, oi) => `   ${letter(oi)}) ${t}`)
        .join("\n");
    return `Map a verified computed answer onto an option letter ONLY if it is an exact or mathematically equivalent match.

Stem (context only): ${String(stem || "").slice(0, 400)}
Computed answer: ${computedValue}
Options:
${opts}

Rules:
- If NONE of the options equal the computed answer (within ~0.5% for decimals), return {"final_answer":null,"answerConfidence":0}.
- NEVER pick the "closest" wrong option. Example: computed 2 with options 0.25/0.5/0.75/1.25 → final_answer must be null.
- Do not force a letter.

Return ONLY JSON object (not an array):
{"final_answer":"B","answerConfidence":0.95}
or {"final_answer":null,"answerConfidence":0}`;
};

/**
 * Simple number(+optional unit) only — safe to parseNumber.
 * Rejects "2π+3", "3+π/2", "(16-8√2)/3" so we never peel a leading digit
 * and map it onto a wrong option (Q3 failure: "2π+3" → parse 2 → "2 m").
 */
const isSimpleNumericLiteral = (s = "") => {
    const t = String(s || "").trim();
    if (!t) return false;
    if (/^[-+]?\d+(?:\.\d+)?(?:\s*[eE][+-]?\d+)?(?:\s*[a-zA-Z/%°μ·•.]+)?$/.test(t)) {
        return true;
    }
    if (/^[-+]?\d+\s*\/\s*\d+(?:\s*[a-zA-Z/%°μ·•.]+)?$/.test(t)) return true;
    return false;
};

/**
 * True if value is numeric or symbolic-math (not "Team 2", "sp3d2").
 * Used to disable dangerous substring option mapping for numbers.
 */
const looksPrimarilyNumeric = (s = "") => {
    const t = String(s || "").trim();
    if (!t) return false;
    if (isSimpleNumericLiteral(t)) return true;
    // Symbolic math forms — numeric intent, but NOT safe for parseNumber peel.
    if (/[0-9]/.test(t) && /[+\-*/()√ππ]|pi|sqrt/i.test(t)) {
        if (!/[a-z]{3,}/i.test(t.replace(/sqrt|pi|ln|log|sin|cos|tan|sec|csc|cot/gi, ""))) {
            return true;
        }
    }
    return false;
};

/** Safe numeric compare: only for simple literals. Symbolic forms use string norm. */
const safeParseNumber = (s = "") => {
    if (!isSimpleNumericLiteral(s)) return NaN;
    // Fractions a/b
    const frac = String(s)
        .trim()
        .match(/^([-+]?\d+)\s*\/\s*(\d+)/);
    if (frac) {
        const a = Number(frac[1]);
        const b = Number(frac[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
    }
    return parseNumber(s);
};

/**
 * Absolute tolerance for matching a computed value to an option.
 * Never wider than half the smallest gap between distinct options — that is what
 * previously allowed 2 → 1.25 or similar near-misses under a flat relative %.
 */
const optionMatchTolerance = (target, optionValues = []) => {
    const nums = (optionValues || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < nums.length; i++) {
        const d = Math.abs(nums[i] - nums[i - 1]);
        if (d > 0) minGap = Math.min(minGap, d);
    }
    const rel = Math.max(Math.abs(target) * 0.005, 1e-9);
    const absCap = Number.isFinite(minGap) && minGap < Infinity ? minGap / 2 : rel;
    return Math.min(rel, absCap);
};

/**
 * Deterministic map of computed_value → option letter.
 * Returns null when no option truly matches — never "closest wrong".
 * @returns {{ final_answer: string, answerConfidence: number } | null}
 */
export const mapComputedValueToOption = (computedValue = "", options = []) => {
    const raw = String(computedValue || "").trim();
    if (!raw || !options?.length) return null;

    const norm = (s) =>
        String(s || "")
            .toLowerCase()
            .replace(/\$/g, "")
            .replace(/\\mathrm\{([^}]+)\}/g, "$1")
            .replace(/\\text\{([^}]+)\}/g, "$1")
            .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
            .replace(/[{}\\]/g, "")
            .replace(/\s+/g, "")
            .replace(/×/g, "*")
            .replace(/,/g, "");

    const nRaw = norm(raw);
    for (let i = 0; i < options.length; i++) {
        if (norm(options[i]) === nRaw) {
            return { final_answer: letter(i), answerConfidence: 0.98 };
        }
    }

    // Fraction a/b exact string forms
    const frac = raw.match(/^([-+]?\d+)\s*\/\s*(\d+)\s*(.*)$/);
    if (frac) {
        const a = Number(frac[1]);
        const b = Number(frac[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
            const target = a / b;
            const optionNums = options.map((o) => parseNumber(o));
            const tol = optionMatchTolerance(target, optionNums);
            for (let i = 0; i < options.length; i++) {
                const v = optionNums[i];
                if (!Number.isFinite(v)) continue;
                if (Math.abs(v - target) <= tol) {
                    return {
                        final_answer: letter(i),
                        answerConfidence: 0.96,
                    };
                }
            }
        }
    }

    // Only peel numbers from SIMPLE literals. "2π+3" must not become 2.
    const target = safeParseNumber(raw);
    if (Number.isFinite(target)) {
        const optionNums = options.map((o) => safeParseNumber(o));
        const tol = optionMatchTolerance(target, optionNums);
        let best = -1;
        let bestAbs = Infinity;
        for (let i = 0; i < options.length; i++) {
            const v = optionNums[i];
            if (!Number.isFinite(v)) continue;
            const abs = Math.abs(v - target);
            if (abs < bestAbs) {
                bestAbs = abs;
                best = i;
            }
        }
        // Require BOTH tight absolute match AND relative sanity (≤1%).
        // This rejects computed=2 vs option=0.25 / 1.25 (Q2 failure mode).
        if (best >= 0 && bestAbs <= tol) {
            const bestVal = optionNums[best];
            const rel =
                Math.abs(bestVal - target) / Math.max(Math.abs(target), 1e-12);
            if (rel <= 0.01 || bestAbs <= 1e-6) {
                return {
                    final_answer: letter(best),
                    answerConfidence: bestAbs <= 1e-6 ? 0.98 : rel <= 0.005 ? 0.97 : 0.92,
                };
            }
        }
        // Simple numeric with no option match → null (caller rebuilds).
        return null;
    }

    // Symbolic computed (π, radicals, sums): only exact normalized string match.
    // Never parseNumber — that maps "2π+3" → option "2 m".
    if (looksPrimarilyNumeric(raw)) {
        return null;
    }

    // Symbolic / text only: full-token containment, never digit-substring
    // (old code mapped computed "2" → option "0.25" via "0.25".includes("2")).
    if (!looksPrimarilyNumeric(raw)) {
        for (let i = 0; i < options.length; i++) {
            const o = norm(options[i]);
            if (!o || !nRaw) continue;
            if (o === nRaw) {
                return { final_answer: letter(i), answerConfidence: 0.95 };
            }
            // Require multi-char and whole-token style match (not digit fragments).
            if (
                nRaw.length >= 3 &&
                o.length >= 3 &&
                (o.includes(nRaw) || nRaw.includes(o)) &&
                Math.abs(o.length - nRaw.length) <= 2
            ) {
                return { final_answer: letter(i), answerConfidence: 0.85 };
            }
        }
    }
    return null;
};

/**
 * When the solver's computed value is not among the generator's options,
 * rebuild a valid 4-option set around that value instead of mapping to a
 * nearest wrong distractor (the Q2 "2 → 0.25" failure).
 */
export const rebuildOptionsAroundComputedValue = (
    computedValue = "",
    existingOptions = []
) => {
    const raw = String(computedValue || "").trim();
    if (!raw) return null;

    const unitFromOpts = (existingOptions || [])
        .map((o) =>
            String(o || "")
                .replace(/^[-+]?\d+(?:\.\d+)?\s*/, "")
                .trim()
        )
        .find((u) => u && u.length <= 12);

    // Only force decimal formatting for simple number(+unit) forms.
    // Keep exact symbolic results like "(16-8√2)/3" intact — parseNumber would
    // wrongly peel off a leading "16".
    const simpleNumeric =
        /^[-+]?\d+(?:\.\d+)?(?:\s*[eE][+-]?\d+)?(?:\s*[a-zA-Z/%°μ·•.]+)?$/.test(
            raw
        );
    const n = simpleNumeric ? parseNumber(raw) : NaN;
    let display = raw;
    let unit = unitFromOpts || "";
    if (simpleNumeric && Number.isFinite(n)) {
        const unitMatch = raw.match(
            /^([-+]?\d+(?:\.\d+)?(?:\s*[eE][+-]?\d+)?)\s*(.*)$/
        );
        unit = unit || (unitMatch?.[2] || "").trim();
        display = formatValueForOption(n, unit) || String(n);
    }

    let options;
    if (Number.isFinite(n)) {
        options = buildOptionsAroundExpected(
            { display, unit, value: n },
            existingOptions
        );
    } else {
        // Symbolic exact form: keep raw as correct, synthesize simple distractors
        // from existing numeric-looking options when possible.
        const distractors = [];
        for (const opt of existingOptions || []) {
            const s = String(opt || "").trim();
            if (!s || normLoose(s) === normLoose(display)) continue;
            distractors.push(s);
            if (distractors.length >= 3) break;
        }
        while (distractors.length < 3) {
            distractors.push(`(alt ${distractors.length + 1})`);
        }
        options = [display, ...distractors.slice(0, 3)];
    }

    if (!options?.length) return null;
    const correct = options[0];
    const distractors = options.slice(1, 4);
    while (distractors.length < 3) {
        distractors.push(`${correct}′${distractors.length}`);
    }
    const insertAt =
        Math.abs(Math.floor((Number.isFinite(n) ? n : display.length) * 10) || 0) %
        4;
    const rebuilt = [...distractors.slice(0, 3)];
    rebuilt.splice(insertAt, 0, correct);
    const correctIndex = rebuilt.findIndex(
        (o) =>
            normLoose(o) === normLoose(correct) || numbersRoughlyEqual(o, correct)
    );
    if (correctIndex < 0) return null;
    return {
        options: rebuilt.slice(0, 4),
        correctIndex,
        correctLetter: letter(correctIndex),
        display: correct,
    };
};

const normLoose = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, "");

const numbersRoughlyEqual = (a, b) => {
    // Exact/normalized string match first (handles "1/2" vs "1/2", "2π+3" vs "2π + 3")
    const naStr = normLoose(a).replace(/π/g, "pi");
    const nbStr = normLoose(b).replace(/π/g, "pi");
    if (naStr && naStr === nbStr) return true;

    const na = safeParseNumber(a);
    const nb = safeParseNumber(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    const tol = Math.max(Math.abs(na) * 0.005, 1e-9);
    return Math.abs(na - nb) <= tol;
};

/**
 * Dual-solver computed-value equality — tolerant of π/pi, ^/** , spaces, and
 * simple fraction rearrangements so equivalent answers don't false-drop.
 */
const computedValuesAgree = (a = "", b = "") => {
    const normSym = (s) =>
        String(s || "")
            .toLowerCase()
            .replace(/π/g, "pi")
            .replace(/\*\*/g, "^")
            .replace(/×/g, "*")
            .replace(/\s+/g, "")
            .replace(/\{/g, "(")
            .replace(/\}/g, ")")
            .replace(/\\frac\(([^)]+),([^)]+)\)/g, "($1)/($2)")
            .replace(/\\/g, "");

    const sa = normSym(a);
    const sb = normSym(b);
    if (!sa || !sb) return false;
    if (sa === sb) return true;

    // π/4 vs 0.785… etc. — only when both are simple numerics
    if (numbersRoughlyEqual(a, b)) return true;

    // Strip outer parens and compare again
    const stripOuter = (s) => s.replace(/^\(+/, "").replace(/\)+$/, "");
    if (stripOuter(sa) === stripOuter(sb)) return true;

    // sin3 / sin(3) / cos3 / cot(1) style trig-of-number
    const normTrig = (s) =>
        s
            .replace(
                /\b(sin|cos|tan|cot|sec|csc)\(?(-?\d+(?:\.\d+)?)\)?/g,
                "$1($2)"
            )
            .replace(/\*/g, "");
    if (normTrig(sa) === normTrig(sb)) return true;

    // (5/2)e^(2x)-3/2 vs (5e^(2x)-3)/2 — normalize * placement around e^
    const flattenExp = (s) =>
        s
            .replace(/(\d)\/(\d)e\^/g, "($1/$2)*e^")
            .replace(/e\^\(?([0-9a-z+\-]+)\)?/g, "e^($1)")
            .replace(/\*\*/g, "^");
    if (flattenExp(sa) === flattenExp(sb)) return true;

    // Pure numeric peel only for simple literals (not 2π+3 style)
    const na = safeParseNumber(a);
    const nb = safeParseNumber(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
        const tol = Math.max(Math.abs(na) * 0.02, 1e-6);
        return Math.abs(na - nb) <= tol;
    }

    // Text-only answers (continuity etc.)
    if (
        /discontinu|continu|true|false|statement/i.test(sa) &&
        /discontinu|continu|true|false|statement/i.test(sb)
    ) {
        // Both mention same key outcome
        if (sa.includes("discontinu") && sb.includes("discontinu")) return true;
        if (sa.includes("continu") && sb.includes("continu") && !sa.includes("discontinu"))
            return true;
    }

    return false;
};

/**
 * Final triple-consistency gate:
 * computed solver value ↔ marked option text ↔ explanation FINAL_ANSWER letter.
 * Returns { ok, reason }.
 */
export const assertAnswerOptionExplanationConsistency = (q = {}) => {
    const opts = optionTexts(q);
    const idx = markedIndexOf(q);
    if (idx < 0 || idx >= opts.length) {
        return { ok: false, reason: "invalid_marked_index" };
    }
    const marked = opts[idx];
    const letterOut = letter(idx);
    const solverVal = String(
        q?._verification?.solverValue ?? q?.computed_value ?? ""
    ).trim();

    if (solverVal && looksPrimarilyNumeric(solverVal)) {
        // Symbolic vs simple number (e.g. "2π+3" vs "2 m") must FAIL —
        // never peel leading digits via parseNumber.
        if (!numbersRoughlyEqual(solverVal, marked)) {
            return {
                ok: false,
                reason: `solver_value_option_mismatch: computed=${solverVal} marked=${marked}`,
            };
        }
    }

    const expl = String(q.explanation || "");
    const fa = expl.match(/FINAL_ANSWER\s*:\s*([A-D])/i);
    if (fa && fa[1].toUpperCase() !== letterOut) {
        return {
            ok: false,
            reason: `explanation_final_answer_mismatch: ${fa[1]} vs ${letterOut}`,
        };
    }

    // Catch "… = 2 Therefore correct answer is 0.25" contradictions.
    // Capture the FULL marked phrase after "correct answer is", not a bare digit
    // (digit-only capture wrongly flagged "2π + 3" as claimed "2").
    const body = expl.split(/FINAL_ANSWER/i)[0] || expl;
    const thereforeChunk = body.match(
        /Therefore,?\s*the correct answer is\s+([^.]+)/i
    );
    if (thereforeChunk) {
        const claimed = thereforeChunk[1].trim();
        if (
            claimed &&
            looksPrimarilyNumeric(claimed) &&
            looksPrimarilyNumeric(marked) &&
            !numbersRoughlyEqual(claimed, marked)
        ) {
            return {
                ok: false,
                reason: `explanation_therefore_mismatches_option: therefore=${claimed} marked=${marked}`,
            };
        }
    }

    return { ok: true, reason: "" };
};

// ── Prompt (legacy): independent solve with options visible ───────────────────
export const buildIndependentSolvePrompt = ({
    questions = [],
    topic = "",
    examProfile = "competitive",
    requireSolveSteps = false,
    structuredTruthSchema = false,
    /** When true, hide options and ask for computed_value only (preferred). */
    blindStemOnly = false,
} = {}) => {
    if (blindStemOnly || (structuredTruthSchema && process.env.AI_QB_BLIND_SOLVER !== "0")) {
        return buildBlindIndependentSolvePrompt({ questions, topic, examProfile });
    }

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

${buildSolverNcertBlock(questions, topic)}
${buildExamSolveThenWriteBlock()}

For EACH question return ONE JSON object with this exact schema:
- \`index\`: question number
- \`final_answer\`: option letter only — "A" | "B" | "C" | "D"
- \`computed_value\`: your derived value before picking the letter
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
[{"index":1,"final_answer":"C","computed_value":"2.36","answerConfidence":0.96,"reasoningConfidence":0.88,"steps":["…","…"],"explanation":"… Therefore, the correct answer is C. FINAL_ANSWER: C"}]`;
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

        const computedValue = String(
            row?.computed_value ?? row?.computedValue ?? row?.value ?? ""
        ).trim();

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
            computed_value: computedValue,
            answerIndex: /^[A-D]$/.test(finalLetter)
                ? finalLetter.charCodeAt(0) - 65
                : Number.isFinite(Number(row?.answerIndex))
                  ? Number(row.answerIndex)
                  : -1,
            value: computedValue || String(row?.value ?? "").trim(),
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
 * After a blind solve, map computed_value → option letter.
 * Deterministic exact match first. If no option equals the computed value,
 * REBUILD options around that value (never map to a nearest wrong distractor —
 * that produced Q2: computed 2 → option 0.25).
 * LLM "closest match" is disabled for pure numeric answers.
 */
const resolveBlindSolveToOption = async (solve, question, callLlm) => {
    if (!solve) return null;
    if (/^[A-D]$/.test(String(solve.final_answer || ""))) {
        // Even if the solver returned a letter, verify it against computed_value
        // when present — LLMs sometimes invent a letter that contradicts their math.
        const computed = String(solve.computed_value || solve.value || "").trim();
        if (computed && looksPrimarilyNumeric(computed)) {
            const opts = optionTexts(question);
            const idx = solve.final_answer.charCodeAt(0) - 65;
            const marked = opts[idx];
            if (
                marked &&
                !numbersRoughlyEqual(computed, marked) &&
                normLoose(computed) !== normLoose(marked)
            ) {
                pipelineTrace("SOLVER_LETTER_CONTRADICTS_COMPUTED", {
                    final_answer: solve.final_answer,
                    computed,
                    marked,
                });
                // Clear the bad letter so we re-map / rebuild from computed_value.
                solve = { ...solve, final_answer: "", answerIndex: -1 };
            } else {
                return ensureExplanationEndsWithLetter(solve);
            }
        } else {
            return ensureExplanationEndsWithLetter(solve);
        }
    }
    const opts = optionTexts(question);
    const computed = String(solve.computed_value || solve.value || "").trim();
    const mapped = mapComputedValueToOption(computed, opts);
    if (mapped?.final_answer) {
        pipelineTrace("SOLVER_OPTION_MAP_DETERMINISTIC", {
            computed,
            final_answer: mapped.final_answer,
        });
        return ensureExplanationEndsWithLetter({
            ...solve,
            final_answer: mapped.final_answer,
            answerIndex: mapped.final_answer.charCodeAt(0) - 65,
            answerConfidence: Math.min(
                solve.answerConfidence ?? 0.9,
                mapped.answerConfidence
            ),
        });
    }

    // Numeric computed value not in options → rebuild options around it.
    if (computed && looksPrimarilyNumeric(computed)) {
        const rebuilt = rebuildOptionsAroundComputedValue(computed, opts);
        if (rebuilt) {
            pipelineTrace("SOLVER_OPTIONS_REBUILT_AROUND_COMPUTED", {
                computed,
                correctLetter: rebuilt.correctLetter,
                options: rebuilt.options,
            });
            return ensureExplanationEndsWithLetter({
                ...solve,
                final_answer: rebuilt.correctLetter,
                answerIndex: rebuilt.correctIndex,
                answerConfidence: Math.min(solve.answerConfidence ?? 0.92, 0.94),
                optionsRebuilt: true,
                rebuiltOptions: rebuilt.options,
            });
        }
        // Cannot rebuild safely → unfixable (do NOT nearest-map).
        pipelineTrace("SOLVER_OPTION_MAP_NO_MATCH", {
            computed,
            reason: "numeric_not_in_options_rebuild_failed",
        });
        return {
            ...solve,
            final_answer: "",
            answerIndex: -1,
            answerConfidence: Math.min(solve.answerConfidence || 0.3, 0.3),
        };
    }

    // Non-numeric only: optional LLM exact-match map (prompt forbids closest-wrong).
    const allowLlmMap =
        process.env.AI_QB_OPTION_MAP_LLM !== "0" &&
        process.env.AI_QB_OPTION_MAP_LLM !== "false";
    if (allowLlmMap && typeof callLlm === "function" && computed) {
        try {
            const raw = await callLlm(
                buildOptionMapPrompt({
                    computedValue: computed,
                    options: opts,
                    stem: question?.questionText || "",
                })
            );
            const obj = parseJsonFlexibleFromAIText(raw);
            const letterOut = String(obj?.final_answer || "")
                .trim()
                .toUpperCase();
            if (
                letterOut &&
                letterOut !== "NULL" &&
                /^[A-D]$/.test(letterOut) &&
                letterOut.charCodeAt(0) - 65 < opts.length
            ) {
                // Verify LLM pick actually matches computed when both numeric-ish.
                const pick = opts[letterOut.charCodeAt(0) - 65];
                if (
                    looksPrimarilyNumeric(computed) &&
                    looksPrimarilyNumeric(pick) &&
                    !numbersRoughlyEqual(computed, pick)
                ) {
                    pipelineTrace("SOLVER_OPTION_MAP_LLM_REJECTED_MISMATCH", {
                        computed,
                        final_answer: letterOut,
                        pick,
                    });
                } else {
                    pipelineTrace("SOLVER_OPTION_MAP_LLM", {
                        computed,
                        final_answer: letterOut,
                    });
                    return ensureExplanationEndsWithLetter({
                        ...solve,
                        final_answer: letterOut,
                        answerIndex: letterOut.charCodeAt(0) - 65,
                        answerConfidence: normalizeSolverConfidence(
                            obj?.answerConfidence ?? solve.answerConfidence ?? 0.75
                        ),
                    });
                }
            }
        } catch (err) {
            pipelineTrace("SOLVER_OPTION_MAP_FAILED", {
                error: err?.message || String(err),
            });
        }
    }

    // No option match → unsolvable (e.g. computed 2.36A but options say 51.75A).
    return {
        ...solve,
        final_answer: "",
        answerIndex: -1,
        answerConfidence: Math.min(solve.answerConfidence || 0.3, 0.3),
    };
};

const ensureExplanationEndsWithLetter = (solve) => {
    const letterOut = String(solve?.final_answer || "").toUpperCase();
    if (!/^[A-D]$/.test(letterOut)) return solve;
    let explanation = String(solve.explanation || "").trim();
    if (!/FINAL_ANSWER\s*:/i.test(explanation)) {
        explanation = `${explanation}${
            explanation ? " " : ""
        }Therefore, the correct answer is ${letterOut}. FINAL_ANSWER: ${letterOut}`;
    }
    return { ...solve, explanation };
};

/**
 * Drop trailing "Therefore/FINAL_ANSWER" noise and any last step that asserts a
 * numeric conclusion different from the locked option (prevents Q2-style
 * "sum=2 Therefore answer is 0.25").
 */
const sanitizeStepsForLockedOption = (stepsRaw = [], markedText = "") => {
    const marked = String(markedText || "").trim();
    const markedNum = parseNumber(marked);
    const cleaned = (stepsRaw || [])
        .map(String)
        .map((s) =>
            s
                .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                .replace(/\s*Therefore,\s*the correct answer is[^.]*\.?/gi, "")
                .trim()
        )
        .filter(Boolean);

    if (!cleaned.length) return cleaned;
    if (!Number.isFinite(markedNum)) return cleaned;

    // Drop trailing steps that exclusively re-assert a wrong numeric answer.
    const out = [...cleaned];
    while (out.length > 1) {
        const last = out[out.length - 1];
        const nums = [...String(last).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) =>
            Number(m[0])
        );
        if (!nums.length) break;
        const lastNum = nums[nums.length - 1];
        if (
            Number.isFinite(lastNum) &&
            Math.abs(lastNum - markedNum) >
                Math.max(Math.abs(markedNum) * 0.02, 1e-6)
        ) {
            // Keep derivation steps that contain other math; only strip pure conclusion lines.
            if (
                /\b(?:therefore|thus|hence|answer|final|correct)\b/i.test(last) ||
                nums.length === 1
            ) {
                out.pop();
                continue;
            }
        }
        break;
    }
    return out;
};

/**
 * Apply Independent Solver structured JSON as the sole source of truth.
 * Generator answer/explanation are ignored. correctAnswer = final_answer only.
 * Options may be rebuilt when the computed value was not among generator options.
 */
const applySolverAsSourceOfTruth = ({ questions, entries, solved }) => {
    let next = questions;
    let fixedCount = 0;
    let disagreementCount = 0;
    const unfixableRefs = [];
    const report = [];
    const strict = isStrictAnswerCorrectnessEnabled();
    const floor = strict
        ? getStrictAnswerConfidenceFloor()
        : getAnswerConfidenceFloor();

    entries.forEach((entry, i) => {
        const cur = getAtRef(next, entry.ref) || entry.question;
        let opts = optionTexts(cur);
        const priorMarked = markedIndexOf(cur);
        const check = solved.get(i);

        // Apply rebuilt options from blind-solve path (computed value not in original set).
        if (
            check?.optionsRebuilt &&
            Array.isArray(check.rebuiltOptions) &&
            check.rebuiltOptions.length >= 2
        ) {
            opts = check.rebuiltOptions.map(String);
            pipelineTrace("SOLVER_TRUTH_USING_REBUILT_OPTIONS", {
                computed: check.computed_value || check.value,
                options: opts,
            });
        }

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

        // Strict mode: require dual-solver consensus for calculative hard math.
        if (
            strict &&
            isDoubleSolveRequired() &&
            check._doubleSolverAgree !== true &&
            check._singleSolverOnly !== true
        ) {
            // _doubleSolverAgree must be true for items that went through dual solve.
            // If needDouble ran and agreed, flag is set; if disagree/fail, check is null (above).
            // If flag missing on a hard math item that should have dual-solved, drop.
            const kind = String(
                cur?._questionKind || cur?.questionKind || ""
            ).toLowerCase();
            if (kind !== "theory" && !check._doubleSolverAgree) {
                unfixableRefs.push({
                    ref: entry.ref,
                    reason: "strict_mode_requires_dual_solver_agree",
                });
                report.push({
                    ref: entry.ref,
                    status: "unfixable",
                    reason: "no_dual_solver_consensus",
                    stage: "solver_truth_strict",
                });
                next = setAtRef(next, entry.ref, {
                    ...cur,
                    _answerChecked: true,
                    _solverTruthApplied: false,
                    _verification: {
                        ...(cur._verification || {}),
                        status: "stripped",
                        ruleFailures: [
                            ...((cur._verification?.ruleFailures) || []),
                            "no_dual_solver_consensus",
                        ],
                    },
                });
                return;
            }
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

        const solverValue = String(
            check.computed_value || check.value || ""
        ).trim();
        const correctLetter = check.final_answer;
        const markedText = opts[correctIndex];

        // Hard pre-check: solver value must agree with marked option text.
        if (
            solverValue &&
            looksPrimarilyNumeric(solverValue) &&
            looksPrimarilyNumeric(markedText) &&
            !numbersRoughlyEqual(solverValue, markedText)
        ) {
            // Attempt one rebuild around solver value rather than shipping a wrong key.
            const rebuilt = rebuildOptionsAroundComputedValue(solverValue, opts);
            if (rebuilt) {
                opts = rebuilt.options;
                check.final_answer = rebuilt.correctLetter;
                check.answerIndex = rebuilt.correctIndex;
                check.optionsRebuilt = true;
                check.rebuiltOptions = rebuilt.options;
                pipelineTrace("SOLVER_TRUTH_REBUILD_ON_MISMATCH", {
                    solverValue,
                    priorMarked: markedText,
                    newOptions: opts,
                });
            } else {
                unfixableRefs.push({
                    ref: entry.ref,
                    reason: `solver value ${solverValue} ≠ option ${markedText}`,
                });
                report.push({
                    ref: entry.ref,
                    status: "unfixable",
                    reason: "solver_value_option_mismatch",
                    stage: "solver_truth",
                });
                next = setAtRef(next, entry.ref, {
                    ...cur,
                    _answerChecked: true,
                    _solverTruthApplied: false,
                });
                return;
            }
        }

        const lockedIndex =
            String(check.final_answer || correctLetter).charCodeAt(0) - 65;
        const lockedLetter = letter(lockedIndex);
        const lockedMarked = opts[lockedIndex];

        const stepsRaw =
            check.solveSteps?.length >= 2
                ? check.solveSteps
                : check.steps?.length >= 2
                  ? check.steps
                  : check.explanation
                    ? [check.explanation]
                    : [];

        if (!stepsRaw.length && !check.explanation) {
            // Minimal locked explanation from solver value alone.
            const minimal = {
                ...cur,
                options: opts,
                correctIndex: lockedIndex,
                correctAnswer: lockedLetter,
                final_answer: lockedLetter,
                explanation: `Verified result: ${
                    solverValue || lockedMarked
                }. Therefore, the correct answer is ${lockedMarked}. FINAL_ANSWER: ${lockedLetter}`,
                _solveSteps: [
                    `Verified result: ${solverValue || lockedMarked}. FINAL_ANSWER: ${lockedLetter}`,
                ],
                _answerChecked: true,
                _solverTruthApplied: true,
                _optionsRebuiltFromSolver: !!check.optionsRebuilt,
                _generatorCorrectIndex:
                    priorMarked >= 0 ? priorMarked : cur._generatorCorrectIndex,
                _verification: {
                    ...(cur._verification || {}),
                    status: "passed",
                    sourceOfTruth: "independent_solver",
                    solverValue: solverValue || null,
                    explanationOk: true,
                    optionsRebuilt: !!check.optionsRebuilt,
                },
            };
            const consistency = assertAnswerOptionExplanationConsistency(minimal);
            if (!consistency.ok) {
                unfixableRefs.push({ ref: entry.ref, reason: consistency.reason });
                next = setAtRef(next, entry.ref, {
                    ...cur,
                    _answerChecked: true,
                    _solverTruthApplied: false,
                });
                return;
            }
            fixedCount++;
            next = setAtRef(next, entry.ref, minimal);
            report.push({
                ref: entry.ref,
                status: "passed",
                to: lockedLetter,
                stage: "solver_truth",
            });
            return;
        }

        // Sanitize steps so we never append "Therefore answer is 0.25" after "sum=2".
        const sanitizedSteps = sanitizeStepsForLockedOption(
            stepsRaw,
            lockedMarked
        );
        const steps = syncSolveStepsToMarkedAnswer(
            sanitizedSteps,
            lockedMarked
        ).map((s, si, arr) =>
            si === arr.length - 1
                ? `${String(s || "")
                      .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                      .trim()} FINAL_ANSWER: ${lockedLetter}`
                : s
        );

        const stepsOnly = {
            ...cur,
            options: opts,
            correctIndex: lockedIndex,
            correctAnswer: lockedLetter,
            final_answer: lockedLetter,
            explanation: "",
            _solveSteps: steps.length ? steps : sanitizedSteps,
            answerConfidence: check.answerConfidence,
            reasoningConfidence: check.reasoningConfidence,
            _answerChecked: true,
            _solverTruthApplied: true,
            _doubleSolverAgree: check._doubleSolverAgree === true,
            _optionsRebuiltFromSolver: !!check.optionsRebuilt,
            _generatorCorrectIndex:
                priorMarked >= 0 ? priorMarked : cur._generatorCorrectIndex,
            _verification: {
                ...(cur._verification || {}),
                status:
                    priorMarked >= 0 && priorMarked !== lockedIndex
                        ? "fixed"
                        : "passed",
                answerConfidence: check.answerConfidence,
                reasoningConfidence: check.reasoningConfidence,
                explanationOk: false,
                sourceOfTruth: check._doubleSolverAgree
                    ? "dual_independent_solver"
                    : "independent_solver",
                solverValue: solverValue || null,
                optionsRebuilt: !!check.optionsRebuilt,
                doubleSolverAgree: check._doubleSolverAgree === true,
                strictMode: strict,
            },
        };

        let updated = rewriteExplanationFromVerifiedSteps(stepsOnly);

        // Final triple consistency: computed ↔ option ↔ explanation.
        let consistency = assertAnswerOptionExplanationConsistency(updated);
        if (!consistency.ok) {
            // Last-resort safe explanation that cannot contradict the locked value.
            const safeExpl = `Verified result: ${
                solverValue || lockedMarked
            }. Therefore, the correct answer is ${lockedMarked}. FINAL_ANSWER: ${lockedLetter}`;
            updated = {
                ...updated,
                explanation: safeExpl,
                _solveSteps: [
                    ...(sanitizedSteps || []).slice(0, 6),
                    `Verified result: ${solverValue || lockedMarked}. FINAL_ANSWER: ${lockedLetter}`,
                ],
                _verification: {
                    ...(updated._verification || {}),
                    explanationOk: true,
                    explanationSource: "safe_verified_value_lock",
                    consistencyRepair: consistency.reason,
                },
            };
            consistency = assertAnswerOptionExplanationConsistency(updated);
        }

        if (!consistency.ok) {
            unfixableRefs.push({ ref: entry.ref, reason: consistency.reason });
            report.push({
                ref: entry.ref,
                status: "unfixable",
                reason: consistency.reason,
                stage: "solver_truth_consistency",
            });
            next = setAtRef(next, entry.ref, {
                ...cur,
                _answerChecked: true,
                _solverTruthApplied: false,
                _verification: {
                    ...(cur._verification || {}),
                    status: "stripped",
                    ruleFailures: [
                        ...((cur._verification?.ruleFailures) || []),
                        "answer_option_explanation_inconsistent",
                        consistency.reason,
                    ],
                },
            });
            return;
        }

        if (priorMarked >= 0 && priorMarked !== lockedIndex) disagreementCount++;
        fixedCount++;
        next = setAtRef(next, entry.ref, updated);

        report.push({
            ref: entry.ref,
            status:
                priorMarked >= 0 && priorMarked !== lockedIndex
                    ? "fixed"
                    : "passed",
            from: priorMarked >= 0 ? letter(priorMarked) : "(ignored)",
            to: lockedLetter,
            answerConfidence: check.answerConfidence,
            reasoningConfidence: check.reasoningConfidence,
            optionsRebuilt: !!check.optionsRebuilt,
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
        // Blind solve (stem only) → map computed_value onto options (no option bias).
        const blind =
            process.env.AI_QB_BLIND_SOLVER !== "0" &&
            process.env.AI_QB_BLIND_SOLVER !== "false";
        const concurrency = getSolverTruthConcurrency();
        await runTasksWithConcurrency(
            entries.map((entry, globalIdx) => async () => {
                const batch = [entry];
                const prompt = buildIndependentSolvePrompt({
                    questions: batch,
                    topic: topic || bankName,
                    examProfile,
                    structuredTruthSchema: true,
                    blindStemOnly: blind,
                });
                try {
                    const raw = await callLlm(prompt);
                    const parsed = parseIndependentSolveResponse(raw, 1);
                    let primary = parsed.get(0) || null;

                    if (primary && blind) {
                        primary = await resolveBlindSolveToOption(
                            primary,
                            entry.question,
                            callLlm
                        );
                    }

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
                        const requireDual = isDoubleSolveRequired();
                        try {
                            const raw2 = await secondaryFn(prompt);
                            const parsed2 = parseIndependentSolveResponse(raw2, 1);
                            let secondary = parsed2.get(0) || null;
                            if (secondary && blind) {
                                secondary = await resolveBlindSolveToOption(
                                    secondary,
                                    entry.question,
                                    secondaryFn
                                );
                            }

                            const aLetter = String(
                                primary?.final_answer || ""
                            )
                                .trim()
                                .toUpperCase();
                            const bLetter = String(
                                secondary?.final_answer || ""
                            )
                                .trim()
                                .toUpperCase();
                            const aVal = String(
                                primary?.computed_value || primary?.value || ""
                            ).trim();
                            const bVal = String(
                                secondary?.computed_value ||
                                    secondary?.value ||
                                    ""
                            ).trim();

                            const lettersAgree =
                                /^[A-D]$/.test(aLetter) &&
                                aLetter === bLetter;
                            // Compare computed values with notation-tolerant equality.
                            // Letter mismatch alone is NOT a fail when both rebuilt
                            // options around the same value (π/4 as C vs A).
                            const valuesAgree =
                                !aVal || !bVal
                                    ? false
                                    : computedValuesAgree(aVal, bVal);

                            const dualOk =
                                (lettersAgree &&
                                    (!aVal || !bVal || valuesAgree)) ||
                                (valuesAgree && aVal && bVal);

                            if (!dualOk) {
                                pipelineTrace("SOLVER_DOUBLE_DISAGREE", {
                                    a: aLetter,
                                    b: bLetter,
                                    aVal,
                                    bVal,
                                    valuesAgree,
                                    lettersAgree,
                                    stem: String(
                                        entry.question?.questionText || ""
                                    ).slice(0, 80),
                                });
                                // Always drop on dual disagreement — never ship a coin-flip key.
                                solved.set(globalIdx, null);
                                return;
                            }

                            if (!secondary?.final_answer && !bVal) {
                                pipelineTrace("SOLVER_DOUBLE_SECONDARY_EMPTY", {
                                    stem: String(
                                        entry.question?.questionText || ""
                                    ).slice(0, 80),
                                });
                                if (requireDual) {
                                    solved.set(globalIdx, null);
                                    return;
                                }
                            } else {
                                // Prefer the solve that already has a letter + rebuilt options.
                                // If letters differ but values agree, keep primary's option set.
                                if (
                                    valuesAgree &&
                                    aVal &&
                                    bVal &&
                                    !lettersAgree
                                ) {
                                    primary = {
                                        ...primary,
                                        // Keep primary letter/options; stamp dual agree.
                                        _doubleSolverAgree: true,
                                        answerConfidence: Math.min(
                                            normalizeSolverConfidence(
                                                primary.answerConfidence
                                            ),
                                            normalizeSolverConfidence(
                                                secondary.answerConfidence
                                            )
                                        ),
                                    };
                                } else {
                                    primary = pickBetterSolve(
                                        primary,
                                        secondary
                                    );
                                    primary = {
                                        ...primary,
                                        _doubleSolverAgree: true,
                                        answerConfidence: Math.min(
                                            normalizeSolverConfidence(
                                                primary.answerConfidence
                                            ),
                                            normalizeSolverConfidence(
                                                secondary.answerConfidence
                                            )
                                        ),
                                    };
                                }
                                pipelineTrace("SOLVER_DOUBLE_AGREE", {
                                    final_answer: primary?.final_answer,
                                    answerConfidence: primary?.answerConfidence,
                                    computed: primary?.computed_value,
                                    lettersAgree,
                                    valuesAgree,
                                });
                            }
                        } catch (err) {
                            pipelineTrace("SOLVER_DOUBLE_SECONDARY_FAILED", {
                                error: err?.message || String(err),
                            });
                            // Strict / require-dual: secondary failure = unfixable.
                            if (requireDual) {
                                solved.set(globalIdx, null);
                                return;
                            }
                        }
                    } else if (isStrictAnswerCorrectnessEnabled()) {
                        // Strict mode but shouldDoubleSolve said no (e.g. theory):
                        // still mark single-solver for lower trust.
                        if (primary) {
                            primary = {
                                ...primary,
                                _doubleSolverAgree: false,
                                _singleSolverOnly: true,
                            };
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
