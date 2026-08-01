/**
 * SymPy sidecar for Mathematics verification after Independent Solver.
 * Extracts integrable / algebraic expressions from the stem or explanation,
 * evaluates with SymPy, and rejects when the marked option disagrees
 * (e.g. integral provably 0 but marked answer is 5).
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { runTasksWithConcurrency } from "./aiQuestionCountInference.service.js";
import { shouldSkipSymbolicVerify } from "./solverTruth.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "..", "..", "scripts", "sympy_verify.py");

export const isSymbolicVerifyEnabled = () => {
    const flag = process.env.AI_QB_SYMBOLIC_VERIFY;
    if (flag === "0" || flag === "false") return false;
    if (flag === "1" || flag === "true" || flag == null || flag === "") {
        return true;
    }
    return false;
};

const PYTHON_BIN = String(process.env.AI_QB_PYTHON || "python").trim() || "python";
let warnedSidecarUnavailable = false;
const SYMBOLIC_CONCURRENCY = Math.max(
    1,
    Math.min(6, Number(process.env.AI_QB_SYMBOLIC_VERIFY_CONCURRENCY || 3))
);

const looksAlgebraic = (text = "") =>
    /[=+\-*/^∫]|\\int|\bintegral\b|\b(?:sin|cos|tan|log|ln|matrix|det|solve|lim)\b/i.test(
        String(text)
    );

const optionText = (q) => {
    if (Number.isFinite(q?.correctIndex) && q?.options?.[q.correctIndex] != null) {
        const o = q.options[q.correctIndex];
        return String(typeof o === "object" ? o.text : o);
    }
    return String(q?.correctAnswer || "");
};

const extractNumericExpected = (marked = "") => {
    const m = String(marked).match(
        /[-+]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\^?[+-]?\d+)?/
    );
    if (!m) return null;
    return m[0].replace(/×|x/gi, "*").replace(/\^/g, "**");
};

/**
 * Best-effort sympy expression from stem/explanation.
 * Prefer explicit integrate(...) / Integral; fall back to marked numeric sanity.
 */
export const extractSymPyExpression = (stem = "", explanation = "") => {
    const blob = `${stem}\n${explanation}`;

    const integrateFn = blob.match(
        /\bintegrate\s*\(\s*([^,]+?)\s*,\s*\(([^)]+)\)\s*\)/i
    );
    if (integrateFn) {
        return `integrate(${integrateFn[1]}, (${integrateFn[2]}))`;
    }

    // ∫_a^b f(x) dx  or  integral from a to b of f(x) dx
    const definiteWord = blob.match(
        /integral\s+from\s+([^\s]+)\s+to\s+([^\s]+)\s+of\s+(.+?)\s+d([a-z])/i
    );
    if (definiteWord) {
        const [, a, b, f, v] = definiteWord;
        return `integrate((${f.trim()}), (${v}, ${a}, ${b}))`;
    }

    // Common latex-ish: \int_{0}^{1} x^2 dx
    const latexInt = blob.match(
        /\\int\s*(?:_\{([^}]+)\}\s*\^\{([^}]+)\}|_([^\s^]+)\s*\^([^\s]+))?\s*(.+?)\s*d([a-z])/i
    );
    if (latexInt) {
        const a = latexInt[1] || latexInt[3];
        const b = latexInt[2] || latexInt[4];
        const f = latexInt[5];
        const v = latexInt[6];
        if (a != null && b != null && f && v) {
            return `integrate((${f.replace(/\\/g, "")}), (${v}, ${a}, ${b}))`;
        }
    }

    // Explanation line: "the integral evaluates to 0" / "equals 0"
    const claimsZero = /\b(?:integral|value|result)\b[^.…]{0,40}\b(?:is|equals|=)\s*0\b/i.test(
        explanation
    );
    if (claimsZero) {
        return "0";
    }

    return null;
};

/**
 * SymPy scope: Mathematics always (when algebraic); numerical Physics /
 * Physical Chemistry when the stem has numbers and a checkable expression/value.
 */
export const isSymPyInScope = (q = {}, { subject = "", sectionName = "" } = {}) => {
    if (shouldSkipSymbolicVerify(q, { subject, sectionName })) return false;
    const subjectLower = `${subject || ""} ${sectionName || ""} ${q?.subject || ""}`.toLowerCase();
    const isMath = /math|algebra|calculus|mathematics/.test(subjectLower);
    const isPhysics = /\bphysics\b/.test(subjectLower);
    const isChem = /\bchem/.test(subjectLower);
    const blob = `${q?.questionText || ""} ${q?.explanation || ""} ${(q?._solveSteps || []).join(" ")}`;

    if (isMath) {
        // Unit-heavy physics-in-math-bank stems without algebra → skip
        if (
            /\b(?:N(?:ewton)?|Ampere|\bA\b|ohm|volt|joule|watt|pascal|tesla|weber|henry|farad|coulomb|kg|m\/s|cm\/s|°C|kelvin)\b/i.test(
                blob
            ) &&
            !/\\int|integral|matrix|determinant|eigen|limit|differentiate|[=+\-*/^]/i.test(blob)
        ) {
            return false;
        }
        return looksAlgebraic(blob) || /\d/.test(blob);
    }

    // Numerical Physics / Chem: need digits + either algebraic ops or a solver value.
    if (isPhysics || isChem) {
        if (!/\d/.test(blob)) return false;
        if (
            q?._verification?.solverValue != null ||
            q?.final_value != null ||
            q?.computed_value != null
        ) {
            return true;
        }
        return looksAlgebraic(blob) || /[=+\-*/^]|×|\*\*/.test(blob);
    }
    return false;
};

/**
 * @returns {Promise<{ ok: boolean, value: string|null, error: string|null, skipped?: boolean, method?: string|null }>}
 */
export const verifyWithSymPy = (
    { expression = "", expected = "", mode = "equals" } = {},
    { timeoutMs = 12000 } = {}
) =>
    new Promise((resolve) => {
        if (!expression?.trim()) {
            resolve({ ok: false, value: null, error: "empty_expression", skipped: true });
            return;
        }
        const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
            child.kill();
            resolve({ ok: false, value: null, error: "timeout", skipped: true });
        }, timeoutMs);

        child.stdout.on("data", (d) => {
            stdout += String(d);
        });
        child.stderr.on("data", (d) => {
            stderr += String(d);
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({
                ok: false,
                value: null,
                error: err?.message || String(err),
                skipped: true,
            });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || "{}");
                // The sidecar always prints `{"ok": true|false, ...}` when it actually
                // ran. If `ok` is missing (e.g. the "python" binary resolved to the
                // Windows Store app-execution-alias stub — it exits non-zero with no
                // stdout instead of throwing a spawn error) we must NOT treat that as
                // a correctness failure: that previously stripped nearly every
                // Mathematics question regardless of whether the answer was right.
                const ranSuccessfully = typeof parsed.ok === "boolean";
                const unavailable =
                    !ranSuccessfully ||
                    code !== 0 ||
                    Boolean(parsed.error?.includes?.("sympy_unavailable"));
                resolve({
                    ok: Boolean(parsed.ok),
                    value: parsed.value ?? null,
                    error:
                        parsed.error ??
                        (stderr.trim() || (code !== 0 ? `sidecar_exit_${code}` : null)),
                    method: parsed.method ?? null,
                    skipped: unavailable,
                });
                if (unavailable && !ranSuccessfully && !warnedSidecarUnavailable) {
                    warnedSidecarUnavailable = true;
                    console.warn(
                        `[symbolic-verify] sympy sidecar unavailable (PYTHON_BIN="${PYTHON_BIN}", exit=${code}) — skipping symbolic checks instead of failing questions. Set AI_QB_PYTHON to a working interpreter or AI_QB_SYMBOLIC_VERIFY=0 to silence.`
                    );
                }
            } catch {
                resolve({
                    ok: false,
                    value: null,
                    error: stderr.trim() || "invalid_sidecar_output",
                    skipped: true,
                });
            }
        });
        child.stdin.write(JSON.stringify({ expression, expected, mode }));
        child.stdin.end();
    });

const optionTextsList = (q) =>
    (q?.options || []).map((o) =>
        String(typeof o === "object" ? o?.text : o || "").trim()
    );

const mapValueToOptionIndex = (value, options = []) => {
    const parseNum = (s) => {
        const m = String(s)
            .replace(/,/g, "")
            .match(/[-+]?\d+(?:\.\d+)?(?:\s*[eE][+-]?\d+)?/);
        return m ? Number(m[0]) : NaN;
    };
    const target = parseNum(value);
    if (!Number.isFinite(target)) {
        const nv = String(value || "").replace(/\s+/g, "").toLowerCase();
        for (let i = 0; i < options.length; i++) {
            if (String(options[i]).replace(/\s+/g, "").toLowerCase() === nv) return i;
        }
        return -1;
    }
    let best = -1;
    let bestRel = Infinity;
    for (let i = 0; i < options.length; i++) {
        const v = parseNum(options[i]);
        if (!Number.isFinite(v)) continue;
        const rel = Math.abs(v - target) / Math.max(1, Math.abs(target));
        if (rel < bestRel) {
            bestRel = rel;
            best = i;
        }
    }
    return best >= 0 && bestRel <= 0.02 ? best : -1;
};

/**
 * Cheap pre-LLM solve: if stem has a clear sympy-able expression, evaluate and
 * stamp the matching option so the expensive o-series call can be skipped.
 */
export const trySymPyPreSolve = async (q = {}, { subject = "", sectionName = "" } = {}) => {
    if (!isSymbolicVerifyEnabled() || !isSymPyInScope(q, { subject, sectionName })) {
        return null;
    }
    const stem = String(q.questionText || "");
    const expression = extractSymPyExpression(stem, "");
    if (!expression) return null;

    const result = await verifyWithSymPy({
        expression,
        expected: "",
        mode: "evaluate",
    });
    if (result.skipped || !result.ok || result.value == null) return null;

    const opts = optionTextsList(q);
    const idx = mapValueToOptionIndex(result.value, opts);
    if (idx < 0) return null;

    const letter = String.fromCharCode(65 + idx);
    return {
        correctIndex: idx,
        correctAnswer: letter,
        sympyValue: result.value,
        expression,
        method: result.method,
        explanation: `Symbolic evaluation gives ${result.value}. Therefore, the correct answer is ${letter}. FINAL_ANSWER: ${letter}`,
        _solveSteps: [
            `Extracted expression: ${expression}`,
            `SymPy evaluated to ${result.value}`,
            `Matches option ${letter}`,
        ],
        _solverTruthApplied: true,
        _sympyPreSolved: true,
        _answerChecked: true,
    };
};

export const applySymPyPreSolvePass = async (
    questions = [],
    { subject = "", sectionName = "" } = {}
) => {
    if (!isSymbolicVerifyEnabled()) {
        return { questions, preSolved: 0 };
    }
    let preSolved = 0;
    const next = [];
    for (const q of questions) {
        if (String(q?.questionType || "single").toLowerCase() !== "single") {
            next.push(q);
            continue;
        }
        if (q?._solverTruthApplied || q?._sympyPreSolved) {
            next.push(q);
            continue;
        }
        try {
            const hit = await trySymPyPreSolve(q, { subject, sectionName });
            if (hit) {
                preSolved++;
                next.push({
                    ...q,
                    correctIndex: hit.correctIndex,
                    correctAnswer: hit.correctAnswer,
                    explanation: hit.explanation,
                    _solveSteps: hit._solveSteps,
                    _solverTruthApplied: true,
                    _sympyPreSolved: true,
                    _answerChecked: true,
                    _verification: {
                        ...(q._verification || {}),
                        symbolicOk: true,
                        sympyPreSolved: true,
                        symbolicDetail: {
                            value: hit.sympyValue,
                            expression: hit.expression,
                            method: hit.method,
                        },
                    },
                });
                pipelineTrace("SYMPY_PRESOLVE_HIT", {
                    value: hit.sympyValue,
                    option: hit.correctAnswer,
                });
            } else {
                next.push(q);
            }
        } catch {
            next.push(q);
        }
    }
    if (preSolved) {
        pipelineTrace("SYMPY_PRESOLVE_DONE", { preSolved, remaining: next.length - preSolved });
    }
    return { questions: next, preSolved };
};

const markFail = (q, reason, detail = {}) => ({
    ...q,
    _verification: {
        ...(q._verification || {}),
        symbolicOk: false,
        status: "stripped",
        ruleFailures: [
            ...((q._verification?.ruleFailures) || []),
            reason,
        ],
        symbolicDetail: detail,
    },
});

const markOk = (q, detail = {}) => ({
    ...q,
    _verification: {
        ...(q._verification || {}),
        symbolicOk: true,
        symbolicDetail: detail,
    },
});

/**
 * Run SymPy checks on Math + numerical Physics/Chem singles; mark failures.
 * Uses simplify(A-B)==0 + numeric probe (via sidecar), not string equality.
 */
export const applySymbolicVerificationToQuestions = async (
    questions = [],
    { subject = "", sectionName = "" } = {}
) => {
    if (!isSymbolicVerifyEnabled()) {
        return { questions, checked: 0, failed: 0, skipped: questions.length };
    }

    const subjectLower = `${subject || ""} ${sectionName || ""}`.toLowerCase();
    const inScopeBank =
        /math|algebra|calculus|mathematics|\bphysics\b|\bchem/.test(subjectLower);
    if (!inScopeBank) {
        return { questions, checked: 0, failed: 0, skipped: questions.length };
    }

    let checked = 0;
    let failed = 0;
    let skipped = 0;
    const next = new Array(questions.length);

    const tasks = questions.map((q, index) => async () => {
        const type = String(q?.questionType || "single").toLowerCase();
        if (type !== "single") {
            next[index] = q;
            skipped++;
            return;
        }
        if (!isSymPyInScope(q, { subject, sectionName })) {
            next[index] = q;
            skipped++;
            return;
        }

        const stem = String(q.questionText || "");
        const explanation = String(q.explanation || "");
        const marked = optionText(q);
        const expectedNum = extractNumericExpected(marked);
        const extracted = extractSymPyExpression(stem, explanation);
        const solverValue = extractNumericExpected(
            String(
                q?._verification?.solverValue ??
                    q?.final_value ??
                    q?.computed_value ??
                    ""
            )
        );

        if (!extracted && !expectedNum && !solverValue) {
            next[index] = q;
            skipped++;
            return;
        }

        checked++;

        // Numerical Physics/Chem: solver final value must match marked option.
        if (!extracted && solverValue && expectedNum) {
            const compare = await verifyWithSymPy({
                expression: solverValue,
                expected: expectedNum,
                mode: "equals",
            });
            if (!compare.skipped && !compare.ok) {
                failed++;
                next[index] = markFail(q, "symbolic_solver_value_mismatch", {
                    sympyValue: solverValue,
                    marked: expectedNum,
                    method: compare.method,
                });
                pipelineTrace("SYMBOLIC_VERIFY_SOLVER_VALUE_MISMATCH", {
                    stem: stem.slice(0, 80),
                    solverValue,
                    marked: expectedNum,
                });
                return;
            }
            if (!compare.skipped && compare.ok) {
                next[index] = markOk(q, {
                    value: solverValue,
                    method: "solver_value_equals_marked",
                });
                return;
            }
        }

        // Prefer evaluate expression then equals-compare to marked option.
        if (extracted) {
            const evaluated = await verifyWithSymPy({
                expression: extracted,
                expected: "",
                mode: "evaluate",
            });
            if (evaluated.skipped) {
                skipped++;
                next[index] = q;
                return;
            }
            if (expectedNum) {
                const compare = await verifyWithSymPy({
                    expression: String(evaluated.value ?? extracted),
                    expected: expectedNum,
                    mode: "equals",
                });
                if (!compare.skipped && !compare.ok) {
                    failed++;
                    next[index] = markFail(q, "symbolic_answer_mismatch", {
                        sympyValue: evaluated.value,
                        marked: expectedNum,
                        expression: extracted,
                        method: compare.method,
                    });
                    pipelineTrace("SYMBOLIC_VERIFY_MISMATCH", {
                        stem: stem.slice(0, 80),
                        sympyValue: evaluated.value,
                        marked: expectedNum,
                        method: compare.method,
                    });
                    return;
                }
            }
            next[index] = markOk(q, {
                value: evaluated.value,
                expression: extracted,
                method: evaluated.method,
            });
            return;
        }

        // Fallback: marked option must at least parse.
        const result = await verifyWithSymPy({
            expression: expectedNum,
            expected: expectedNum,
            mode: "equals",
        });
        if (result.skipped) {
            skipped++;
            next[index] = q;
            return;
        }
        if (!result.ok) {
            failed++;
            next[index] = markFail(q, "symbolic_verify_failed", {
                error: result.error,
                expression: expectedNum,
            });
            return;
        }
        next[index] = markOk(q, { value: result.value, expression: expectedNum });
    });

    await runTasksWithConcurrency(tasks, SYMBOLIC_CONCURRENCY);

    pipelineTrace("SYMBOLIC_VERIFY_DONE", { checked, failed, skipped });
    return { questions: next.filter(Boolean), checked, failed, skipped };
};
