/**
 * Optional SymPy sidecar for Math verification after LLM solver.
 * Gracefully no-ops when Python/SymPy is unavailable or item is non-algebraic.
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { runTasksWithConcurrency } from "./aiQuestionCountInference.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "..", "..", "scripts", "sympy_verify.py");

export const isSymbolicVerifyEnabled = () => {
    const flag = process.env.AI_QB_SYMBOLIC_VERIFY;
    if (flag === "0" || flag === "false") return false;
    // Default ON for Math — set AI_QB_SYMBOLIC_VERIFY=0 to disable.
    if (flag === "1" || flag === "true" || flag == null || flag === "") {
        return true;
    }
    return false;
};

const PYTHON_BIN = String(process.env.AI_QB_PYTHON || "python").trim() || "python";
const SYMBOLIC_CONCURRENCY = Math.max(
    1,
    Math.min(6, Number(process.env.AI_QB_SYMBOLIC_VERIFY_CONCURRENCY || 3))
);

const looksAlgebraic = (text = "") =>
    /[=+\-*/^]|\b(?:sin|cos|tan|log|ln|integral|matrix|det|solve)\b/i.test(
        String(text)
    );

/**
 * @returns {Promise<{ ok: boolean, value: string|null, error: string|null, skipped?: boolean }>}
 */
export const verifyWithSymPy = (
    { expression = "", expected = "", mode = "numeric" } = {},
    { timeoutMs = 8000 } = {}
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
        child.on("close", () => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || "{}");
                resolve({
                    ok: Boolean(parsed.ok),
                    value: parsed.value ?? null,
                    error: parsed.error ?? (stderr.trim() || null),
                    skipped: Boolean(parsed.error?.includes?.("sympy_unavailable")),
                });
            } catch {
                resolve({
                    ok: false,
                    value: null,
                    error: stderr.trim() || "invalid_sidecar_output",
                    skipped: true,
                });
            }
        });
        child.stdin.write(
            JSON.stringify({ expression, expected, mode })
        );
        child.stdin.end();
    });

/**
 * Run SymPy checks on math-looking singles; mark failures on _verification.
 */
export const applySymbolicVerificationToQuestions = async (
    questions = [],
    { subject = "", sectionName = "" } = {}
) => {
    if (!isSymbolicVerifyEnabled()) {
        return { questions, checked: 0, failed: 0, skipped: questions.length };
    }

    const subjectLower = `${subject || ""} ${sectionName || ""}`.toLowerCase();
    const isMathBank = /math|algebra|calculus|mathematics/.test(subjectLower);
    // Skip SymPy for Physics/Chemistry; only run when subject is clearly Math.
    if (!isMathBank) {
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
        const stem = String(q.questionText || "");
        const explanation = String(q.explanation || "");
        if (!looksAlgebraic(stem) && !looksAlgebraic(explanation)) {
            next[index] = q;
            skipped++;
            return;
        }

        const marked =
            Number.isFinite(q.correctIndex) && q.options?.[q.correctIndex]
                ? String(
                      typeof q.options[q.correctIndex] === "object"
                          ? q.options[q.correctIndex].text
                          : q.options[q.correctIndex]
                  )
                : String(q.correctAnswer || "");

        const exprMatch = marked.match(
            /[-+]?\d+(?:\.\d+)?(?:\s*[×x*]\s*10\^?[+-]?\d+)?/
        );
        if (!exprMatch) {
            next[index] = q;
            skipped++;
            return;
        }

        checked++;
        const normalizedExpr = exprMatch[0]
            .replace(/×|x/gi, "*")
            .replace(/\^/g, "**");
        const result = await verifyWithSymPy({
            expression: normalizedExpr,
            expected: normalizedExpr,
            mode: "numeric",
        });

        if (result.skipped) {
            skipped++;
            next[index] = q;
            return;
        }
        if (!result.ok) {
            failed++;
            next[index] = {
                ...q,
                _verification: {
                    ...(q._verification || {}),
                    symbolicOk: false,
                    status: "stripped",
                    ruleFailures: [
                        ...((q._verification?.ruleFailures) || []),
                        "symbolic_verify_failed",
                    ],
                },
            };
            pipelineTrace("SYMBOLIC_VERIFY_FAIL", {
                stem: stem.slice(0, 80),
                error: result.error,
            });
            return;
        }
        next[index] = {
            ...q,
            _verification: {
                ...(q._verification || {}),
                symbolicOk: true,
            },
        };
    });

    await runTasksWithConcurrency(tasks, SYMBOLIC_CONCURRENCY);

    pipelineTrace("SYMBOLIC_VERIFY_DONE", { checked, failed, skipped });
    return { questions: next.filter(Boolean), checked, failed, skipped };
};
