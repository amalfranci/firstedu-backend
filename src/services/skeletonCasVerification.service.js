/**
 * Deterministic (non-LLM) CAS re-derivation of a solve-first SKELETON's
 * claimed answer — the "root cause 1" fix from the correctness review:
 *
 *   hardQuestionMandate.service.js   -> checks STRUCTURE (steps, concepts)
 *   difficultySelfAudit.service.js   -> checks an LLM's OPINION of hardness
 *   this file                        -> checks the ACTUAL NUMBER, via SymPy
 *
 * Neither of the first two ever recomputes the math, which is how wrong
 * answer keys were shipping while both gates passed them. This module sits
 * between skeleton parsing and the difficulty self-audit (see the call site
 * in aiQuestion.service.js, right after parseSolveFirstSkeletons()) — a
 * skeleton whose claimed answer provably disagrees with an independent
 * SymPy re-derivation is hard-rejected here, before it burns an LLM
 * self-audit call or reaches hardQuestionMandate.
 *
 * Requires the generator to additionally emit `archetype` + `givens` on
 * each skeleton (see buildCasVerificationContractBlock() in
 * questionSolveFirst.service.js) — this is a small prompt-contract addition,
 * not a rewrite. Skeletons that don't declare a recognized archetype come
 * back `verified: null` (not machine-checkable) and are treated as a NO-OP,
 * never a false reject — same fail-open policy used for the finalize-stage
 * sympy sidecar in symbolicVerify.service.js, and for the same reason: this
 * machine doesn't have a real `python` on PATH (it resolves to the Windows
 * Store app-execution-alias stub), so treating "sidecar unavailable" as a
 * rejection would silently strip every hard-tier skeleton.
 */

import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "..", "..", "scripts", "verify_answer.py");

// Reuse the same interpreter override as the finalize-stage sympy sidecar
// (symbolicVerify.service.js) so one env var configures both.
const PYTHON_BIN = String(process.env.AI_QB_PYTHON || "python").trim() || "python";
const VERIFY_TIMEOUT_MS = Math.max(
    1000,
    Number(process.env.AI_QB_SKELETON_CAS_VERIFY_TIMEOUT_MS || 8000)
);

/** Default ON — set AI_QB_SKELETON_CAS_VERIFY=0 to disable this stage-A gate. */
export const isSkeletonCasVerificationEnabled = () => {
    const flag = process.env.AI_QB_SKELETON_CAS_VERIFY;
    if (flag === "0" || flag === "false") return false;
    return true;
};

/** Archetypes the CAS can currently re-derive — keep in sync with scripts/verify_answer.py. */
export const KNOWN_CAS_ARCHETYPES = [
    "area_between_curves",
    "limit_evaluation",
    "definite_integral",
    "derivative_at_point",
    "circle_radius",
    "matrix_det_or_inverse",
    "linear_ode_value",
];

let warnedSidecarUnavailable = false;

/**
 * Prompt-contract addition for buildSolveFirstSkeletonPrompt(): asks the
 * generator to ALSO emit machine-readable `archetype` + `givens` alongside
 * the existing prose stem, whenever the problem matches one of the CAS's
 * known patterns. This is additive — omitting/nulling it on an unmatched
 * problem is explicitly fine and causes no penalty; the CAS just skips it.
 */
export const buildCasVerificationContractBlock = () => `
**MACHINE-CHECKABLE ANSWER CONTRACT (in addition to finalAnswer/solveSteps):**
When a skeleton's problem matches ONE of the patterns below, ALSO emit \`archetype\`
(exact key) and \`givens\` (the raw inputs, as parseable expressions/numbers — NOT the
final answer) so an independent SymPy check can re-derive \`finalAnswer.value\` from
your \`givens\` alone. If the problem doesn't cleanly match any of these, omit both
fields — that is expected and not penalized.

| archetype | givens shape |
|---|---|
| \`area_between_curves\` | \`{"f_expr":"x**2","g_expr":"x","lower":"0","upper":"1","auto_bounds":false}\` (set \`auto_bounds:true\` to solve f=g for the bounds instead of stating them) |
| \`limit_evaluation\` | \`{"expr":"sin(3*x)/x","point":"0","direction":"both"}\` (direction: "both"\|"+"\|"-") |
| \`definite_integral\` | \`{"expr":"sin(x)**8","lower":"0","upper":"pi/2"}\` |
| \`derivative_at_point\` | \`{"expr":"x**x","point":"1","order":1}\` |
| \`circle_radius\` | \`{"mode":"general","D":"-4","E":"6","F":"3"}\` (x²+y²+Dx+Ey+F=0) or \`{"mode":"diameter_endpoints","p1":[1,2],"p2":[3,4]}\` |
| \`matrix_det_or_inverse\` | \`{"matrix":[[1,2],[3,4]],"op":"det"}\` or \`{"matrix":[[...]], "op":"inverse_entry","entry":[0,1]}\` |
| \`linear_ode_value\` | \`{"P_expr":"1/x","Q_expr":"x","x0":"1","y0":"0","eval_at":"2"}\` for y'+P(x)y=Q(x), y(x0)=y0 |

Rules for \`givens\`: use SymPy-parseable syntax (\`**\` for power, \`pi\`, \`sin\`/\`cos\`/\`log\`,
\`sqrt\`), and every expression must be self-contained (no undefined symbols other than
\`x\`/\`y\`). This is checked by CODE before your answer is trusted — a wrong \`givens\`
that doesn't match your own stem will get the skeleton rejected, so only fill it in when
you're confident it faithfully represents the problem you wrote.`;

/**
 * Spawn the Python/SymPy sidecar for one skeleton.
 * @returns {Promise<{ verified: boolean|null, computedAnswer: number|null, claimedAnswer: number|null, delta: number|null, note: string }>}
 */
export const verifySkeletonWithCas = ({ archetype, givens, claimedAnswer } = {}) =>
    new Promise((resolve) => {
        if (!archetype || !givens) {
            resolve({
                verified: null,
                computedAnswer: null,
                claimedAnswer: claimedAnswer ?? null,
                delta: null,
                note: "no archetype/givens declared on skeleton — not machine-checkable",
            });
            return;
        }

        const child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const timer = setTimeout(() => {
            child.kill();
            finish({
                verified: null,
                computedAnswer: null,
                claimedAnswer: claimedAnswer ?? null,
                delta: null,
                note: "cas_verify_timeout — treated as unverifiable, not a hard reject",
            });
        }, VERIFY_TIMEOUT_MS);

        child.stdout.on("data", (d) => {
            stdout += String(d);
        });
        child.stderr.on("data", (d) => {
            stderr += String(d);
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            finish({
                verified: null,
                computedAnswer: null,
                claimedAnswer: claimedAnswer ?? null,
                delta: null,
                note: `cas_sidecar_spawn_failed: ${err?.message || err}`,
            });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || "{}");
                // Mirrors the symbolicVerify.service.js fix: if the sidecar didn't
                // actually run (no `verified` key at all, or non-zero exit with no
                // parseable result), that is "unavailable", NOT "answer is wrong".
                const ranSuccessfully =
                    typeof parsed.verified === "boolean" || parsed.verified === null;
                if (!ranSuccessfully || code !== 0) {
                    if (!warnedSidecarUnavailable) {
                        warnedSidecarUnavailable = true;
                        console.warn(
                            `[skeleton-cas-verify] sympy sidecar unavailable (PYTHON_BIN="${PYTHON_BIN}", exit=${code}) — skipping CAS checks instead of rejecting skeletons. Set AI_QB_PYTHON to a working interpreter or AI_QB_SKELETON_CAS_VERIFY=0 to silence.`
                        );
                    }
                    finish({
                        verified: null,
                        computedAnswer: null,
                        claimedAnswer: claimedAnswer ?? null,
                        delta: null,
                        note: `cas_sidecar_unavailable (exit=${code}): ${stderr.trim().slice(0, 200) || "no output"}`,
                    });
                    return;
                }
                finish({
                    verified: parsed.verified,
                    computedAnswer: parsed.computed_answer ?? null,
                    claimedAnswer: parsed.claimed_answer ?? claimedAnswer ?? null,
                    delta: parsed.delta ?? null,
                    note: parsed.note || "",
                });
            } catch {
                finish({
                    verified: null,
                    computedAnswer: null,
                    claimedAnswer: claimedAnswer ?? null,
                    delta: null,
                    note: `cas_sidecar_bad_output: ${stderr.trim().slice(0, 200) || "unparseable stdout"}`,
                });
            }
        });

        child.stdin.write(JSON.stringify({ archetype, givens, claimed_answer: claimedAnswer }));
        child.stdin.end();
    });

const extractClaimedAnswer = (skeleton = {}) => {
    const v = skeleton?.finalAnswer?.value;
    if (Number.isFinite(v)) return v;
    const n = Number(String(skeleton?.finalAnswer?.display ?? "").replace(/[^\d.eE+-]/g, ""));
    return Number.isFinite(n) ? n : null;
};

/**
 * Batch gate — call right after parseSolveFirstSkeletons(), before the
 * difficulty self-audit. Splits skeletons into `kept` (verified true/null —
 * i.e. correct, or not machine-checkable) and `rejected` (verified false —
 * a provable numeric mismatch). Never throws; on any sidecar problem every
 * skeleton just comes back `kept` with `verified: null`.
 */
export const filterSkeletonsByCasVerification = async (skeletons = []) => {
    if (!isSkeletonCasVerificationEnabled() || !skeletons.length) {
        return { kept: skeletons, rejected: [] };
    }

    const results = await Promise.all(
        skeletons.map((sk) =>
            verifySkeletonWithCas({
                archetype: sk?.archetype,
                givens: sk?.givens,
                claimedAnswer: extractClaimedAnswer(sk),
            })
        )
    );

    const kept = [];
    const rejected = [];
    skeletons.forEach((sk, i) => {
        const result = results[i];
        if (result.verified === false) {
            rejected.push({ skeleton: sk, result });
            pipelineTrace("SKELETON_CAS_VERIFY_REJECTED", {
                conceptSlot: sk?.conceptSlot,
                archetype: sk?.archetype,
                computedAnswer: result.computedAnswer,
                claimedAnswer: result.claimedAnswer,
                delta: result.delta,
                note: result.note,
            });
        } else {
            kept.push({ ...sk, _casVerification: result });
            if (result.verified === true) {
                pipelineTrace("SKELETON_CAS_VERIFY_OK", {
                    conceptSlot: sk?.conceptSlot,
                    archetype: sk?.archetype,
                    computedAnswer: result.computedAnswer,
                    claimedAnswer: result.claimedAnswer,
                });
            }
        }
    });

    if (rejected.length) {
        pipelineTrace("SKELETON_CAS_VERIFY_DONE", {
            checked: skeletons.length,
            rejected: rejected.length,
            kept: kept.length,
        });
    }

    return { kept, rejected };
};
