/**
 * JEE Advanced — Hard Mathematics — 6 NON-SINGLE questions only.
 *
 * Skips single-correct. Produces exactly 6 hard items by default as:
 *   multi-correct × 3  +  integer/numerical × 2  +  match-list × 1
 *
 * Stages (quality-first, same stack as Main/Advanced singles where applicable):
 *   0) Mongo + load jee_advanced/ pack (syllabus, NCERT hard context, scoring)
 *   1) Plan HIGH advanced_relevance multi_concept slots
 *   2) Generate by type (Gemini hard model)
 *   3) Answer lock: o4-mini always; o3-mini ONLY when selective criteria fire
 *      --dual-mode=selective|always|never
 *   4) Trust grades + integer recompute on weak/high-risk locks
 *   5) Fill until 6 locked (or fill-round cap)
 *   6) Insight-first explanations ONLY on final kept items
 *   7) Save artifacts
 *
 * Usage (YOU run this — do not auto-run in CI unless intended):
 *   cd firstedu-backend
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --count=6
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --multi=3 --integer=2 --match=1
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --keep-unverified
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --dual-mode=selective
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --dual-mode=always
 *   node scripts/generate-jee-advanced-hard-maths-6-nonsingle.mjs --dual-mode=never
 *
 * Output:
 *   temp/jee-advanced-hard-6-nonsingle-maths/<timestamp>/
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = /^--([^=]+)=(.*)$/.exec(a);
        return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
    })
);

const TOTAL =
    Number(argv.count || process.env.JEE_ADV_NS_COUNT || 6) || 6;
// Default Advanced non-single mix for 6 Q (skip single entirely)
let MULTI_N = Number(argv.multi ?? 3);
let INTEGER_N = Number(argv.integer ?? 2);
let MATCH_N = Number(argv.match ?? 1);
// Normalize so multi+integer+match === TOTAL
{
    const sum = MULTI_N + INTEGER_N + MATCH_N;
    if (sum !== TOTAL && sum > 0) {
        // scale proportionally then fix remainder on multi
        const scale = TOTAL / sum;
        MULTI_N = Math.max(0, Math.round(MULTI_N * scale));
        INTEGER_N = Math.max(0, Math.round(INTEGER_N * scale));
        MATCH_N = Math.max(0, TOTAL - MULTI_N - INTEGER_N);
    } else if (sum === 0) {
        MULTI_N = Math.min(3, TOTAL);
        INTEGER_N = Math.min(2, Math.max(0, TOTAL - MULTI_N));
        MATCH_N = Math.max(0, TOTAL - MULTI_N - INTEGER_N);
    }
}

const DIFFICULTY = "hard";
const SUBJECT = "Mathematics";
const GENERATION_PROVIDER = String(
    argv.provider || process.env.JEE_ADV_GEN_PROVIDER || "gemini"
)
    .trim()
    .toLowerCase();

// ---------------------------------------------------------------------------
// Quality env lock (Advanced hard + dual solvers)
// ---------------------------------------------------------------------------
// Advanced hard: do not inherit Main .env fail-fast timeouts (30s / 60s).
process.env.GEMINI_REQUEST_TIMEOUT_MS = String(
    argv["gemini-timeout-ms"] ||
        process.env.JEE_ADV_GEMINI_TIMEOUT_MS ||
        240000
);
process.env.GEMINI_QB_MAX_ATTEMPTS = "3";
process.env.GEMINI_HARD_TEXT_MODEL = String(
    argv["gemini-model"] ||
        process.env.GEMINI_HARD_TEXT_MODEL ||
        "gemini-3.5-flash"
).trim();

process.env.AI_QB_DEFER_VALIDATION = "1";
process.env.EXAM_REFERENCE_RESEARCH_ENABLED = "0";
process.env.AI_QB_DIFFICULTY_CALIBRATION = "0";
process.env.AI_QB_DISTRACTOR_PASS = "0";
process.env.AI_QB_CURATED_MATH_SLOTS_ONLY = "1";
process.env.AI_QB_STAGE_A_ANSWER_LOCK = "1";
process.env.AI_QB_STAGE_A_DROP_UNVERIFIED =
    argv["keep-unverified"] || argv.keepUnverified ? "0" : "1";

const VERIFY_MODEL = String(
    argv["verify-model"] || process.env.OPENAI_SOLVER_MODEL || "o4-mini"
).trim();
// Secondary solver (only used when selective dual criteria fire)
const SECONDARY_SOLVER = String(
    argv["verify-model-b"] ||
        process.env.JEE_ADV_VERIFY_MODEL_B ||
        process.env.OPENAI_SOLVER_MODEL_B ||
        "o3-mini"
).trim();
// dual-mode: selective (default) | always | never
// selective = A always; B only when criteria say risk is high (keeps speed)
const DUAL_MODE = String(
    argv["dual-mode"] || process.env.JEE_ADV_DUAL_MODE || "selective"
)
    .trim()
    .toLowerCase();
const CONF_FLOOR_SKIP_B = Number(
    argv["dual-conf-floor"] || process.env.JEE_ADV_DUAL_CONF_FLOOR || 0.9
);
process.env.AI_QB_SOLVER_PROVIDER = "openai";
process.env.AI_QB_SOLVER_PROVIDER_B = "openai";
process.env.OPENAI_SOLVER_MODEL = VERIFY_MODEL;
process.env.OPENAI_SOLVER_MODEL_B =
    DUAL_MODE === "never" ? VERIFY_MODEL : SECONDARY_SOLVER;
const SOLVER_TIMEOUT_MS = Number(
    argv["solver-timeout-ms"] ||
        process.env.JEE_ADV_SOLVER_TIMEOUT_MS ||
        150000
);
process.env.OPENAI_SOLVER_TIMEOUT_MS = String(SOLVER_TIMEOUT_MS);
process.env.OPENAI_TIEBREAKER_TIMEOUT_MS = String(SOLVER_TIMEOUT_MS);
process.env.AI_QB_SOLVER_TRUTH = "1";
process.env.AI_QB_BLIND_SOLVER = "1";
process.env.AI_QB_DIFFICULTY_SELF_AUDIT = "1";
process.env.AI_QB_HARD_MULTI_HEAVY = "1";
process.env.AI_QB_FORCE_ALL_MULTI = "1";
process.env.AI_QB_VETERAN_DIFFICULTY = "1";
// Hardness gate ≥70
process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN = String(
    argv["min-difficulty"] || process.env.JEE_ADV_SKELETON_MIN || 70
);
process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR = String(
    argv["last-attempt-floor"] || process.env.JEE_ADV_LAST_ATTEMPT_FLOOR || 65
);
process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR = String(
    process.env.JEE_ADV_RELAXED_FLOOR || 65
);
// Selective dual: pipeline dual flags only when B runs; else primary lock
process.env.AI_QB_STRICT_ANSWER_CORRECTNESS =
    DUAL_MODE === "always" ? "1" : "0";
process.env.AI_QB_DOUBLE_SOLVE = DUAL_MODE === "never" ? "0" : "1";
process.env.AI_QB_REQUIRE_DOUBLE_SOLVE = DUAL_MODE === "always" ? "1" : "0";
process.env.AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE =
    DUAL_MODE === "always" ? "1" : "0";
process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR = "0.85";
process.env.AI_QB_SOLVER_KEEP_PRIMARY_ON_DISAGREE =
    DUAL_MODE === "never" ? "1" : "0";

const KEEP_UNVERIFIED = process.env.AI_QB_STAGE_A_DROP_UNVERIFIED === "0";
const FILL_ROUNDS = Number(argv["fill-rounds"] || 4);
const MAX_RETRIES = Number(argv["max-retries"] || 2);
// Insight-first solutions ONLY on final kept items (not every regen).
// Default ON to raise explanation quality without hurting generation hardness.
// Disable with --expand-explanations=0
const EXPAND_EXPLANATIONS =
    argv["expand-explanations"] === "0" || argv["expand-explanations"] === false
        ? false
        : argv["expand-explanations"] === "1" ||
          argv["expand-explanations"] === true ||
          process.env.JEE_ADV_EXPAND_EXPLANATIONS !== "0";
// After first OpenAI 429, skip OpenAI for the rest of the run (was burning 45–150s
// waits × 2 models × every question with zero success).
const OPENAI_ATTEMPTS = Number(
    argv["openai-attempts"] || process.env.JEE_ADV_SOLVER_OPENAI_ATTEMPTS || 1
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- run telemetry (console + token discipline) ----
const stats = {
    geminiGenCalls: 0,
    geminiSolverCalls: 0,
    geminiExpandCalls: 0,
    openaiCalls: 0,
    openai429: 0,
    openaiSkippedCircuit: 0,
    dualLocked: 0,
    dualDropped: 0,
    solverBCalls: 0,
    solverBSkipped: 0,
    latexFixed: 0,
    highRiskForced: 0,
    recomputeOk: 0,
    recomputeFail: 0,
    phaseMs: {},
};

/** Production trust grade — never call A+generator "full dual production". */
const computeTrustGrade = (q = {}) => {
    const mode = String(q._lockMode || "");
    const type = String(q._advancedType || q.questionType || "").toLowerCase();
    const stem = String(q.questionText || "");
    const highRisk =
        type === "integer" ||
        type === "match" ||
        /differenti|\\frac\{dy\}\{dx\}|dy\/dx|area of the region|infinitely many solutions|tr\(|trace|adj\(/i.test(
            stem
        );

    if (/dual\(/i.test(mode) && q._doubleSolverAgree) {
        return {
            grade: "production_dual",
            badge: "DUAL-OPENAI",
            productionReady: true,
            needsReview: highRisk, // still recommend skim on long chains
            reason: "true A+B independent solvers",
        };
    }
    if (
        (mode === "A+gemini-B" || /A\+gemini-B/i.test(mode)) &&
        q._doubleSolverAgree
    ) {
        const recomputed = q._recomputeOk === true;
        return {
            grade: recomputed ? "cross_provider_recomputed" : "cross_provider",
            badge: recomputed ? "A+GEMINI-B+RECOMPUTE" : "A+GEMINI-B",
            // Independent A+B + recompute ≈ production when OpenAI dual unavailable
            productionReady: recomputed || (!highRisk && q._doubleSolverAgree),
            needsReview: highRisk && !recomputed,
            reason: recomputed
                ? "independent Gemini B + third-pass recompute match"
                : "independent Gemini B (OpenAI rate-limited)",
        };
    }
    if (mode === "A+generator" || /generator/i.test(mode)) {
        return {
            grade: "provisional",
            badge: "PROVISIONAL",
            productionReady: false,
            needsReview: true,
            reason: "generator-as-B is disabled for production; should not appear",
        };
    }
    if (/A-only/i.test(mode)) {
        return {
            grade: "primary_only",
            badge: "A-ONLY",
            productionReady: !highRisk && type === "multiple",
            needsReview: highRisk || type !== "multiple",
            reason: "low-risk A-only skip of B",
        };
    }
    return {
        grade: "unknown",
        badge: "REVIEW",
        productionReady: false,
        needsReview: true,
        reason: mode || "no lock mode",
    };
};

const isHighRiskStem = (q = {}) => {
    const type = String(q._advancedType || q.questionType || "").toLowerCase();
    const stem = String(q.questionText || "");
    if (type === "integer" || type === "match") return true;
    return /differenti|\\frac\{dy\}\{dx\}|dy\/dx|area of the region|infinitely many solutions|P\^3|trace of|adj\(/i.test(
        stem
    );
};
let openaiCircuitOpen = false; // true after rate-limit — stop hammering OpenAI
const markPhase = (name, ms) => {
    stats.phaseMs[name] = (stats.phaseMs[name] || 0) + ms;
};
const timed = async (label, fn) => {
    const t0 = Date.now();
    console.log(`\n⏱  START  ${label}`);
    try {
        const out = await fn();
        const ms = Date.now() - t0;
        markPhase(label, ms);
        console.log(`⏱  END    ${label}  (${(ms / 1000).toFixed(1)}s)`);
        return out;
    } catch (err) {
        const ms = Date.now() - t0;
        markPhase(label, ms);
        console.log(
            `⏱  FAIL   ${label}  (${(ms / 1000).toFixed(1)}s) — ${err?.message || err}`
        );
        throw err;
    }
};
const printTokenBudget = () => {
    console.log("\n── Token / API budget (this run) ──");
    console.log(
        `  Gemini GENERATE : ${stats.geminiGenCalls}  |  SOLVE : ${stats.geminiSolverCalls}  |  EXPAND : ${stats.geminiExpandCalls}`
    );
    console.log(
        `  OpenAI calls    : ${stats.openaiCalls}  |  429s : ${stats.openai429}  |  skipped(circuit) : ${stats.openaiSkippedCircuit}`
    );
    console.log(
        `  Dual locked     : ${stats.dualLocked}  |  dropped : ${stats.dualDropped}`
    );
    console.log(
        `  Solver B (o3)   : called ${stats.solverBCalls}  |  skipped ${stats.solverBSkipped}  |  dual-mode=${DUAL_MODE}`
    );
    console.log(
        `  High-risk force : ${stats.highRiskForced}  |  recompute OK ${stats.recomputeOk} / fail ${stats.recomputeFail}`
    );
    console.log(`  LaTeX repaired  : ${stats.latexFixed}`);
    const phases = Object.entries(stats.phaseMs)
        .map(([k, v]) => `    ${k}: ${(v / 1000).toFixed(1)}s`)
        .join("\n");
    if (phases) console.log(`  Phase times:\n${phases}`);
};

// ---------------------------------------------------------------------------
// Imports (after env lock so modules see correct flags)
// ---------------------------------------------------------------------------
const {
    planQuestionBankTopics,
    generateQuestionBankSuggestions,
} = await import("../src/services/aiQuestion.service.js");
const {
    isJeeAdvancedMathsDataAvailable,
    getJeeAdvancedMathTopics,
    getHighRelevanceAdvancedTopics,
    buildJeeAdvancedNcertWriterBlock,
    buildJeeAdvancedSyllabusWriterBlock,
    buildJeeAdvancedHardArchetypePlanBlock,
    buildJeeAdvancedDesignQualityBlock,
    inferJeeAdvancedTopicsFromSlots,
    hydrateJeeAdvancedMathsScoringFromDb,
} = await import("../src/services/jeeAdvancedMaths.service.js");
const {
    callOpenAIReasoningJson,
    buildOpenAIChatBody,
    extractOpenAIChatText,
    getOpenAISolverTimeoutMs,
} = await import("../src/services/openaiReasoningChat.service.js");

/** Short retry only — NO multi-minute 429 backoff (that wasted 10–20 min last run). */
const callWithRetries = async (fn, { maxAttempts = 2 } = {}) => {
    let lastErr;
    for (let i = 1; i <= maxAttempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const status = err?.response?.status || err?.status;
            const msg = String(err?.message || err || "");
            const rateLimited =
                status === 429 ||
                /429|rate.?limit|too many requests|quota/i.test(msg);
            if (rateLimited) {
                stats.openai429 += 1;
                openaiCircuitOpen = true;
                console.warn(
                    `[openai] 429 rate-limit — OPEN circuit (skip OpenAI for rest of run)`
                );
                throw err;
            }
            const transient =
                /timeout|ECONNRESET|ENOTFOUND|503|502|504|aborterror/i.test(msg);
            if (i >= maxAttempts || !transient) throw lastErr;
            const waitMs = Math.min(8_000, 2_000 * i);
            console.warn(
                `[retry] ${i}/${maxAttempts} ${msg.slice(0, 60)} — wait ${waitMs / 1000}s`
            );
            await sleep(waitMs);
        }
    }
    throw lastErr;
};

const callGeminiSolverJsonText = async (prompt) => {
    if (!geminiClient) throw new Error("GEMINI_API_KEY missing for solver fallback");
    stats.geminiSolverCalls += 1;
    console.log(
        `  [gemini-solver] call #${stats.geminiSolverCalls} (token-cost: solver)`
    );
    const model =
        process.env.GEMINI_SOLVER_MODEL ||
        process.env.GEMINI_HARD_TEXT_MODEL ||
        "gemini-3.5-flash";
    const result = await geminiClient.models.generateContent({
        model,
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `${prompt}\n\nReturn ONLY valid compact JSON. No markdown. No LaTeX linebreaks inside strings use \\\\n.`,
                    },
                ],
            },
        ],
        config: {
            temperature: 0,
            responseMimeType: "application/json",
        },
    });
    const text = String(result.text || "").trim();
    if (!text) throw new Error("Gemini solver returned empty");
    return text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
};

/** Prefer OpenAI; on circuit/429 use Gemini once (never dual-Gemini — wastes tokens). */
const callSolverJson = async (model, prompt, { allowGemini = true } = {}) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && !openaiCircuitOpen) {
        try {
            stats.openaiCalls += 1;
            console.log(`  [openai] ${model} call #${stats.openaiCalls}`);
            return await callOpenAIReasoningJson({
                apiKey,
                prompt,
                model,
                reasoningEffort: "medium",
                callWithRetries: (fn) =>
                    callWithRetries(fn, { maxAttempts: OPENAI_ATTEMPTS }),
                toError: (e) => e,
            });
        } catch (err) {
            const status = err?.response?.status;
            const msg = String(err?.message || err || "");
            if (status === 429 || /429|rate.?limit/i.test(msg)) {
                openaiCircuitOpen = true;
            }
            console.warn(
                `  [openai] ${model} failed (${status || msg.slice(0, 50)}) ${allowGemini ? "→ try Gemini once" : ""}`
            );
        }
    } else if (openaiCircuitOpen) {
        stats.openaiSkippedCircuit += 1;
        console.log(
            `  [openai] SKIP ${model} (circuit open after 429) — Gemini once if allowed`
        );
    }
    if (!allowGemini) {
        throw new Error("OpenAI unavailable and Gemini fallback disabled");
    }
    return callGeminiSolverJsonText(prompt);
};

// ---------------------------------------------------------------------------
// Topic lock — HIGH advanced_relevance only
// ---------------------------------------------------------------------------
if (!isJeeAdvancedMathsDataAvailable()) {
    console.error(
        "FATAL: jee_advanced/ pack incomplete (need maths_syllabus.json + maths_ncert_context.json)"
    );
    process.exit(1);
}

const highTopics = getHighRelevanceAdvancedTopics();
const allTopics = getJeeAdvancedMathTopics();
const TARGET_TOPICS = highTopics.length ? highTopics : allTopics;
const CHAPTER_LABELS = TARGET_TOPICS.map((t) => t.chapter);
const TARGET_IDS = new Set(TARGET_TOPICS.map((t) => t.topicId));
const EXCLUDED_TOPICS = allTopics
    .filter((t) => !TARGET_IDS.has(t.topicId))
    .map((t) => `${t.topicId} ${t.chapter}`);

// MUST include "JEE Advanced" so examProfile = jee_advanced
const TOPIC = `Competitive › Engineering › JEE Advanced › Mathematics · Hard non-single (multi/integer/match) HIGH topics: ${CHAPTER_LABELS.join(", ")}`;
const BANK_NAME = TOPIC;
const CATEGORY_PATHS = ["JEE Advanced > Mathematics"];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const RUN_STARTED = Date.now();
const jsonlLines = [];
const transcriptLines = [];
const phaseStarts = {};
const RULE = "═".repeat(78);
const nowIso = () => new Date().toISOString();
const elapsed = () => Date.now() - RUN_STARTED;

const emit = (obj, human) => {
    jsonlLines.push(JSON.stringify(obj));
    transcriptLines.push(human);
    console.log(human);
};
const phaseStart = (id, title, details = []) => {
    phaseStarts[id] = Date.now();
    const at = nowIso();
    const secs = (elapsed() / 1000).toFixed(1);
    emit(
        { type: "phase_start", id, title, details, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s) ${RULE}\n[${at}] (+${secs}s) PHASE ${id} START — ${title}\n[${at}] (+${secs}s) ${RULE}` +
            (details.length
                ? "\n" +
                  details.map((d) => `[${at}] (+${secs}s)   · ${d}`).join("\n")
                : "")
    );
};
const phaseStep = (id, message) => {
    const at = nowIso();
    const secs = (elapsed() / 1000).toFixed(1);
    emit(
        { type: "phase_step", id, message, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s)   →   ${message}`
    );
};
const phaseEnd = (id, status, extra = null) => {
    const tookMs = Date.now() - (phaseStarts[id] || Date.now());
    const at = nowIso();
    const secs = (elapsed() / 1000).toFixed(1);
    emit(
        {
            type: "phase_end",
            id,
            status,
            tookMs,
            extra,
            at,
            elapsedMs: elapsed(),
        },
        `[${at}] (+${secs}s) PHASE ${id} END — ${status === "ok" ? "✓ OK" : status === "partial" ? "◐ PARTIAL" : "✗ FAIL"} (${(tookMs / 1000).toFixed(1)}s)`
    );
};

// ---------------------------------------------------------------------------
// Gemini hard writer (integer + match)
// ---------------------------------------------------------------------------
const geminiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
              timeout: Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 150000),
          },
      })
    : null;

const callGeminiJson = async (prompt, { kind = "generate" } = {}) => {
    if (!geminiClient) throw new Error("GEMINI_API_KEY missing");
    const model = process.env.GEMINI_HARD_TEXT_MODEL || "gemini-3.5-flash";
    const maxAttempts = Number(process.env.JEE_ADV_GEMINI_JSON_ATTEMPTS || 5);
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        stats.geminiGenCalls += 1;
        console.log(
            `  [gemini-${kind}] call #${stats.geminiGenCalls} attempt ${attempt}/${maxAttempts}`
        );
        try {
            const result = await geminiClient.models.generateContent({
                model,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                },
            });
            const text = String(result.text || "").trim();
            if (!text) throw new Error("Gemini returned empty text");
            if (/"status"\s*:\s*"UNAVAILABLE"|code"\s*:\s*503/.test(text)) {
                throw new Error(text.slice(0, 200));
            }
            const cleaned = text
                .replace(/^```json\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();
            return parseJsonLoose(cleaned);
        } catch (err) {
            lastErr = err;
            const msg = String(err?.message || err || "");
            const transient =
                /503|UNAVAILABLE|high demand|429|rate.?limit|timeout|ECONNRESET|fetch failed/i.test(
                    msg
                );
            if (!transient || attempt >= maxAttempts) throw err;
            const waitMs = Math.min(90_000, 8_000 * attempt);
            console.warn(
                `  [gemini] transient ${msg.slice(0, 80)} — wait ${Math.round(waitMs / 1000)}s`
            );
            await sleep(waitMs);
        }
    }
    throw lastErr;
};

const parseJsonLoose = (raw) => {
    if (raw && typeof raw === "object") return raw;
    let s = String(raw || "").trim();
    const tryParse = (t) => JSON.parse(t);
    try {
        return tryParse(s);
    } catch {
        /* continue */
    }
    // Extract outermost JSON blob
    const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
        s = m[0];
        try {
            return tryParse(s);
        } catch {
            /* fix common model JSON bugs */
        }
    }
    // Unescape bad LaTeX-ish backslashes that break JSON (\\x → \\\\x except valid escapes)
    const fixed = s.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    try {
        return tryParse(fixed);
    } catch (err) {
        throw new Error(
            `Could not parse JSON: ${err?.message || err} @ ${s.slice(0, 80)}…`
        );
    }
};

/**
 * Decide whether to call Solver B (secondary). Keeps runs fast: A always,
 * B only when risk criteria fire (or dual-mode=always).
 *
 * Criteria (selective):
 *  1) questionType is integer (long algebra — highest error risk)
 *  2) questionType is match (arrangement easy to mis-key)
 *  3) primary confidence < CONF_FLOOR_SKIP_B (default 0.9)
 *  4) multi with ≥3 correct letters (wide key space)
 *  5) generator provisional key disagrees with primary A
 *  6) stem very long (>900 chars) — multi-step density
 */
const shouldCallSolverB = ({
    questionType = "",
    primaryConfidence = 1,
    primaryKey = null,
    generatorKey = null,
    multiLetterCount = 0,
    stemLen = 0,
} = {}) => {
    if (DUAL_MODE === "never") {
        return { run: false, reason: "dual-mode=never" };
    }
    if (DUAL_MODE === "always") {
        return { run: true, reason: "dual-mode=always" };
    }
    // selective
    const type = String(questionType || "").toLowerCase();
    // Always dual-check high-risk types (keeps current hard quality bar for keys)
    if (type === "integer" || type === "numerical") {
        stats.highRiskForced += 1;
        return { run: true, reason: "type=integer (high algebra risk — force B)" };
    }
    if (type === "match") {
        stats.highRiskForced += 1;
        return { run: true, reason: "type=match (force B)" };
    }
    if (type === "de_risk" || type === "high_risk") {
        stats.highRiskForced += 1;
        return { run: true, reason: "high-risk stem (DE/area/long chain — force B)" };
    }
    if (Number(primaryConfidence) < CONF_FLOOR_SKIP_B) {
        return {
            run: true,
            reason: `primary conf ${primaryConfidence} < ${CONF_FLOOR_SKIP_B}`,
        };
    }
    if (multiLetterCount >= 3) {
        return { run: true, reason: `multi key width ${multiLetterCount}≥3` };
    }
    if (
        generatorKey != null &&
        primaryKey != null &&
        String(generatorKey) !== "" &&
        String(primaryKey) !== "" &&
        String(generatorKey).replace(/\s/g, "") !==
            String(primaryKey).replace(/\s/g, "")
    ) {
        return {
            run: true,
            reason: `generator≠primary (${generatorKey} vs ${primaryKey})`,
        };
    }
    if (stemLen > 900) {
        return { run: true, reason: `long stem ${stemLen}>900` };
    }
    return { run: false, reason: "low-risk — skip B (save time)" };
};

const extractPrimaryMeta = (aObj) => {
    if (!aObj || typeof aObj !== "object") {
        return { confidence: 0.5, keyHint: null };
    }
    const confidence = Number(aObj.confidence) || 0.5;
    const keyHint =
        aObj.correct_letters ??
        aObj.final_answer ??
        aObj.answer ??
        aObj.value ??
        aObj.letters ??
        null;
    return { confidence, keyHint };
};

/**
 * Primary always (o4-mini). Secondary B only when shouldCallSolverB says so.
 * Modes: selective (default) | always | never
 */
const dualCallSolvers = async (
    prompt,
    {
        generatorKey = null,
        questionType = "",
        stemLen = 0,
        multiLetterCount = 0,
        forceB = false,
    } = {}
) => {
    // --- Primary A ---
    let a;
    let aProvider = "openai";
    if (!openaiCircuitOpen) {
        console.log(`  [lock-A] primary=${VERIFY_MODEL}`);
        const aRaw = await callSolverJson(VERIFY_MODEL, prompt, {
            allowGemini: true,
        });
        a = parseJsonLoose(aRaw);
    } else {
        aProvider = "gemini";
        console.log(`  [lock-A] primary=gemini (OpenAI circuit open)`);
        const aRaw = await callSolverJson("gemini", prompt, {
            allowGemini: true,
        });
        a = parseJsonLoose(aRaw);
    }

    const { confidence, keyHint } = extractPrimaryMeta(a);
    // normalizeMultiLetters is defined later — use local multi key normalize here
    const asMultiKey = (raw) => {
        if (raw == null) return null;
        if (Array.isArray(raw)) {
            const letters = [
                ...new Set(
                    raw
                        .map((x) =>
                            String(x).trim().toUpperCase().replace(/[^A-D]/g, "")
                        )
                        .filter((s) => /^[A-D]$/.test(s))
                ),
            ].sort();
            return letters.length ? letters.join(",") : null;
        }
        const letters = [
            ...new Set(
                String(raw)
                    .toUpperCase()
                    .split(/[^A-D]+/)
                    .map((s) => s.replace(/[^A-D]/g, "").slice(0, 1))
                    .filter((s) => /^[A-D]$/.test(s))
            ),
        ].sort();
        return letters.length ? letters.join(",") : null;
    };
    const isMulti =
        questionType === "multiple" || questionType === "multi";
    const primaryKeyNorm = isMulti
        ? asMultiKey(keyHint)
        : keyHint != null
          ? String(keyHint)
          : null;
    const genKeyNorm = isMulti
        ? asMultiKey(generatorKey)
        : generatorKey != null
          ? String(generatorKey)
          : null;

    const decision = forceB
        ? { run: true, reason: "forceB" }
        : shouldCallSolverB({
              questionType,
              primaryConfidence: confidence,
              primaryKey: primaryKeyNorm,
              generatorKey: genKeyNorm,
              multiLetterCount:
                  multiLetterCount ||
                  (primaryKeyNorm ? primaryKeyNorm.split(",").length : 0),
              stemLen,
          });

    if (!decision.run) {
        stats.solverBSkipped += 1;
        console.log(`  [lock-B] SKIP — ${decision.reason}`);
        // Single-A lock: clone A as B so agree path ships (documented single-lock)
        return {
            a,
            b: a,
            mode: `A-only(${aProvider})`,
            ranB: false,
            skipReason: decision.reason,
        };
    }

    // --- Secondary B ---
    stats.solverBCalls += 1;
    console.log(
        `  [lock-B] CALL secondary=${SECONDARY_SOLVER} — ${decision.reason}`
    );
    if (openaiCircuitOpen) {
        // CORRECTNESS: never use generator as B for production-grade locks.
        // Always independent Gemini B (second solve). Generator is only a hint log.
        console.log(
            `  [lock-B] independent Gemini B (OpenAI circuit — NOT generator; correctness)`
        );
        if (genKeyNorm != null) {
            console.log(`  [lock-B] generator key on file: ${genKeyNorm} (not used as vote)`);
        }
        const bRaw = await callSolverJson("gemini", prompt, {
            allowGemini: true,
        });
        return {
            a,
            b: parseJsonLoose(bRaw),
            mode: "A+gemini-B",
            ranB: true,
            skipReason: null,
            generatorKeyHint: genKeyNorm,
        };
    }

    try {
        const bRaw = await callSolverJson(SECONDARY_SOLVER, prompt, {
            allowGemini: true,
        });
        return {
            a,
            b: parseJsonLoose(bRaw),
            mode: `dual(${VERIFY_MODEL}+${SECONDARY_SOLVER})`,
            ranB: true,
            skipReason: null,
        };
    } catch (err) {
        console.warn(
            `  [lock-B] secondary failed: ${err?.message || err} — fall back A-only`
        );
        stats.solverBSkipped += 1;
        return {
            a,
            b: a,
            mode: "A-only(secondary-failed)",
            ranB: false,
            skipReason: "secondary-failed",
        };
    }
};

// ---------------------------------------------------------------------------
// LaTeX repair — models break JSON + produce raw/broken TeX
// ---------------------------------------------------------------------------
const LATEX_JSON_HINT = `
**LaTeX / JSON rules (mandatory):**
- Inside JSON strings use DOUBLE backslash for TeX: \\\\frac{a}{b}, \\\\sqrt{2}, \\\\begin{pmatrix}
- Prefer inline math as $...$ (single dollars). Avoid raw unescaped \\\\ commands outside math.
- Never put real newlines inside a JSON string; use \\\\n if needed.
- Every \\\\frac must have two braced args: \\\\frac{num}{den}
- Balance braces { } and $ delimiters.
`;

const repairLatexString = (input) => {
    if (input == null) return input;
    let s = String(input);
    const before = s;

    // Normalize common broken patterns from models
    // 1) Unescaped TeX in plain text that broke from JSON: single \frac → keep as TeX if already in $
    // 2) \frac without braces: \frac a b → \frac{a}{b} (simple tokens only)
    s = s.replace(
        /\\frac\s+([^\s{}\\]+)\s+([^\s{}\\]+)/g,
        "\\frac{$1}{$2}"
    );
    // 3) Double-escaped that should be single for display (\\\\frac → \frac) when not in JSON
    // Only collapse excessive backslashes before known TeX commands
    s = s.replace(
        /\\{2,}(frac|sqrt|begin|end|left|right|cdot|times|leq|geq|neq|infty|alpha|beta|lambda|mu|pi|theta|phi|omega|sum|prod|int|partial|nabla|mathbb|mathrm|mathbf|text|overline|underline|hat|bar|vec|dot|ddot|pmatrix|bmatrix|vmatrix|matrix|aligned|cases)/g,
        "\\$1"
    );
    // 4) Fix \$ that was meant to be $
    s = s.replace(/\\\$/g, "$");
    // 5) Ensure \begin{...}...\end{...} often wrapped — if naked pmatrix, leave (common in stems)
    // 6) Strip accidental markdown fences
    s = s.replace(/```(?:latex|tex|math)?/gi, "").replace(/```/g, "");
    // 7) Broken \frac{ with missing close — best effort leave; count braces
    // 8) Replace unicode minus with ASCII hyphen-minus in math-ish contexts
    s = s.replace(/\u2212/g, "-");

    if (s !== before) stats.latexFixed += 1;
    return s;
};

const repairLatexDeep = (value) => {
    if (value == null) return value;
    if (typeof value === "string") return repairLatexString(value);
    if (Array.isArray(value)) return value.map(repairLatexDeep);
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (
                /text|option|explanation|list|step|stem|chapter|display|answer/i.test(
                    k
                ) ||
                typeof v === "string" ||
                Array.isArray(v)
            ) {
                out[k] = repairLatexDeep(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return value;
};

const sanitizeGeneratedQuestion = (q) => {
    const fixed = repairLatexDeep(q);
    return {
        ...fixed,
        questionText: repairLatexString(fixed.questionText || ""),
        explanation: repairLatexString(fixed.explanation || ""),
        options: Array.isArray(fixed.options)
            ? fixed.options.map((o) =>
                  repairLatexString(
                      typeof o === "string" ? o : o?.text || String(o || "")
                  )
              )
            : fixed.options,
        listI: Array.isArray(fixed.listI)
            ? fixed.listI.map(repairLatexString)
            : fixed.listI,
        listII: Array.isArray(fixed.listII)
            ? fixed.listII.map(repairLatexString)
            : fixed.listII,
        _solveSteps: Array.isArray(fixed._solveSteps || fixed.solveSteps)
            ? (fixed._solveSteps || fixed.solveSteps).map(repairLatexString)
            : fixed._solveSteps,
    };
};

// ---------------------------------------------------------------------------
// Dual-lock helpers for integer + match
// ---------------------------------------------------------------------------
const dualSolveNumeric = async (stem, generatorAnswer = null) => {
    const prompt = `You are an independent JEE Advanced Mathematics solver.
Solve the following INTEGER / NUMERICAL answer question.
Return ONLY JSON:
{"final_answer": <integer or exact numeric>, "confidence": 0.0-1.0, "brief_steps": ["step"]}

STEM:
${stem}`;

    const pickValue = (obj) => {
        if (!obj) return { value: null, confidence: 0, raw: null };
        if (obj?._fromGenerator) {
            const v = Number(obj.key);
            return {
                value: Number.isFinite(v) ? v : null,
                confidence: 0.7,
                raw: obj,
            };
        }
        const v = Number(obj?.final_answer ?? obj?.value ?? obj?.answer);
        return {
            value: Number.isFinite(v) ? v : null,
            confidence: Number(obj?.confidence) || 0.5,
            raw: obj,
        };
    };

    const { a: aObj, b: bObj, mode, ranB } = await dualCallSolvers(prompt, {
        generatorKey: generatorAnswer,
        questionType: "integer",
        stemLen: String(stem || "").length,
    });
    const a = pickValue(aObj);
    const b = pickValue(bObj);
    const agree =
        a.value != null &&
        b.value != null &&
        Math.abs(a.value - b.value) < 1e-6;
    console.log(
        `  [lock-integer] mode=${mode} A=${a.value} B=${b.value} ranB=${ranB} agree=${agree}`
    );
    return { a, b, agree, value: agree ? a.value : null, mode, ranB };
};

const dualSolveMatch = async (stem, listI, listII, options) => {
    const prompt = `You are an independent JEE Advanced Mathematics solver.
Solve this MATCH THE FOLLOWING question. Pick the correct matching arrangement option letter (A/B/C/D).
Return ONLY JSON:
{"final_answer": "A"|"B"|"C"|"D", "confidence": 0.0-1.0, "brief_steps": ["..."]}

STEM:
${stem}

List-I:
${(listI || []).map((x, i) => `${i + 1}. ${x}`).join("\n")}

List-II:
${(listII || []).map((x, i) => `${String.fromCharCode(80 + i)}. ${x}`).join("\n")}

Options (arrangements):
${(options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")}
`;

    const pickLetter = (obj) => {
        if (!obj) return { letter: null, confidence: 0, raw: null };
        if (obj?._fromGenerator) {
            const letter = String(obj.key || "")
                .trim()
                .toUpperCase()
                .slice(0, 1);
            return {
                letter: /^[A-D]$/.test(letter) ? letter : null,
                confidence: 0.7,
                raw: obj,
            };
        }
        const letter = String(obj?.final_answer || obj?.answer || "")
            .trim()
            .toUpperCase()
            .slice(0, 1);
        return {
            letter: /^[A-D]$/.test(letter) ? letter : null,
            confidence: Number(obj?.confidence) || 0.5,
            raw: obj,
        };
    };

    const { a: aObj, b: bObj, mode, ranB } = await dualCallSolvers(prompt, {
        generatorKey: null,
        questionType: "match",
        stemLen: String(stem || "").length,
    });
    const a = pickLetter(aObj);
    const b = pickLetter(bObj);
    const agree = Boolean(a.letter && b.letter && a.letter === b.letter);
    console.log(
        `  [lock-match] mode=${mode} A=${a.letter} B=${b.letter} ranB=${ranB} agree=${agree}`
    );
    return { a, b, agree, letter: agree ? a.letter : null, mode, ranB };
};

/** Normalize multi-correct key to sorted unique letters e.g. "A,C". */
const normalizeMultiLetters = (raw) => {
    if (raw == null) return null;
    let letters = [];
    if (Array.isArray(raw)) {
        letters = raw.map((x) => String(x).trim().toUpperCase());
    } else {
        letters = String(raw)
            .toUpperCase()
            .split(/[^A-D]+/)
            .filter(Boolean);
    }
    letters = [
        ...new Set(
            letters
                .map((s) => s.replace(/[^A-D]/g, "").slice(0, 1))
                .filter((s) => /^[A-D]$/.test(s))
        ),
    ].sort();
    return letters.length ? letters.join(",") : null;
};

/**
 * Dual-lock multi-correct (Stage A runAnswerCorrectnessPass only re-keys *single*).
 * Both solvers must return the same set of correct option letters.
 */
const dualSolveMulti = async (stem, options = [], generatorKey = null) => {
    const optBlock = (options || [])
        .map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)
        .join("\n");
    const prompt = `You are an independent JEE Advanced Mathematics solver.
This is a MULTI-CORRECT MCQ: one or more options may be correct.
Solve from scratch and list EVERY correct option letter.

Return ONLY JSON:
{"correct_letters": ["A","C"], "confidence": 0.0-1.0, "brief_steps": ["step"]}

Rules:
- Include only letters that are definitely correct
- Sort letters ascending (A before B before C before D)
- At least one letter required

STEM:
${stem}

OPTIONS:
${optBlock}
`;

    const pickKey = (obj) => {
        if (!obj) return { key: null, confidence: 0, raw: null };
        if (obj?._fromGenerator) {
            return {
                key: normalizeMultiLetters(obj.key),
                confidence: 0.7,
                raw: obj,
            };
        }
        const key = normalizeMultiLetters(
            obj?.correct_letters ??
                obj?.final_answer ??
                obj?.answer ??
                obj?.letters
        );
        return {
            key,
            confidence: Number(obj?.confidence) || 0.5,
            raw: obj,
        };
    };

    const { a: aObj, b: bObj, mode, ranB } = await dualCallSolvers(prompt, {
        generatorKey,
        questionType: "multiple",
        stemLen: String(stem || "").length,
        multiLetterCount: generatorKey
            ? String(generatorKey).split(",").filter(Boolean).length
            : 0,
    });
    const a = pickKey(aObj);
    const b = pickKey(bObj);
    const agree = Boolean(a.key && b.key && a.key === b.key);
    console.log(
        `  [lock-multi] mode=${mode} A=${a.key} B=${b.key} ranB=${ranB} agree=${agree}`
    );
    return { a, b, agree, key: agree ? a.key : null, mode, ranB };
};

const lettersToCorrectIndices = (key) => {
    if (!key) return [];
    return String(key)
        .split(",")
        .map((L) => L.charCodeAt(0) - 65)
        .filter((i) => i >= 0 && i < 4);
};

// ---------------------------------------------------------------------------
// Type-specific generators
// ---------------------------------------------------------------------------
const buildAdvContextBlock = (slots = []) =>
    [
        buildJeeAdvancedSyllabusWriterBlock({
            subject: SUBJECT,
            examProfile: "jee_advanced",
        }),
        buildJeeAdvancedDesignQualityBlock({
            subject: SUBJECT,
            examProfile: "jee_advanced",
        }),
        buildJeeAdvancedHardArchetypePlanBlock({
            subject: SUBJECT,
            examProfile: "jee_advanced",
        }),
        buildJeeAdvancedNcertWriterBlock({
            subject: SUBJECT,
            examProfile: "jee_advanced",
            slots,
        }),
    ]
        .filter(Boolean)
        .join("\n");

/**
 * After dual-lock: rewrite explanation to full Advanced derivation so key is
 * fixed but solution text hits paper-setter bar (not "standard formula…").
 */
/**
 * Insight-first solution rewrite — ONLY for final kept items (not mid-regen).
 * Preserves locked key; improves educational value without changing hardness.
 */
const expandExplanation = async (q) => {
    if (!EXPAND_EXPLANATIONS) return q;
    stats.geminiExpandCalls += 1;
    console.log(
        `  [expand] insight-first solution #${stats.geminiExpandCalls} (locked finals only)`
    );
    const type = String(q._advancedType || q.questionType || "").toLowerCase();
    const opts = (q.options || []).map(
        (o, i) =>
            `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : o?.text || o}`
    );
    const lockedKey =
        q.correctAnswer ??
        q.answerDisplay ??
        (q.correctIndices
            ? q.correctIndices.map((i) => String.fromCharCode(65 + i)).join(",")
            : q.correctIndex != null
              ? String.fromCharCode(65 + q.correctIndex)
              : "?");

    const typeRules =
        type === "multiple" || type === "multi"
            ? `MULTI-CORRECT structure:
1) Insight (why this approach)
2) Shared core derivation once
3) Then judge EACH option A–D TRUE/FALSE from that core (not isolated checklists)
4) End: "Therefore correct option(s): ${lockedKey}"`
            : type === "match"
              ? `MATCH structure:
1) Insight
2) Solve EACH List-I item with a short derivation (cite key theorem if used, e.g. rank(A)=n-1 ⇒ rank(adj A)=1)
3) Assemble arrangement → ${lockedKey}`
              : type === "integer"
                ? `INTEGER structure:
1) Insight (why the method works — e.g. "condition on coin first" / "u=xy because…")
2) Setup
3) Compressed algebra (skip routine arithmetic expansion)
4) Last line exactly: FINAL_ANSWER: ${lockedKey}`
                : `Insight first, then derivation. End with locked key ${lockedKey}.`;

    const prompt = `You are writing an official-style JEE Advanced solution (IIT coaching quality).
The answer key is ALREADY LOCKED — NEVER change the final answer.

LOCKED KEY: ${lockedKey}
${typeRules}

MANDATORY format:
- Start with a line: **Insight:** … (1–2 sentences: why the method works)
- Then derivation (prefer short key steps; compress routine algebra)
- State important theorems explicitly when used (e.g. adj rank theorem)
- If a geometric/symmetry alternate is short, add **Alternate:** in 2–3 lines
- Do NOT open with "To judge Option A" — open with the insight
- BANNED: "using the standard formula", "obviously", "clearly" without proof

STEM:
${q.questionText}

${opts.length ? `OPTIONS:\n${opts.join("\n")}` : ""}
${q.listI?.length ? `List-I:\n${q.listI.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : ""}
${q.listII?.length ? `List-II:\n${q.listII.map((x, i) => `${String.fromCharCode(80 + i)}. ${x}`).join("\n")}` : ""}

Prior notes (may be incomplete — rewrite insight-first):
${JSON.stringify(q._dualA || q._solveSteps || q.explanation || "").slice(0, 1000)}

${LATEX_JSON_HINT}

Return ONLY JSON:
{"insight": "one or two sentences", "explanation": "full solution starting with Insight", "solveSteps": ["...", "..."]}`;

    try {
        const parsed = await callGeminiJson(prompt, { kind: "expand" });
        let explanation = String(
            parsed?.explanation || (parsed?.solveSteps || []).join("\n") || ""
        ).trim();
        const insight = String(parsed?.insight || "").trim();
        if (insight && !/^\*\*Insight:\*\*/i.test(explanation)) {
            explanation = `**Insight:** ${insight}\n\n${explanation}`;
        }
        explanation = repairLatexString(explanation);
        if (explanation.length < 180) return q;
        return {
            ...q,
            explanation,
            _insight: insight || q._insight,
            _solveSteps: Array.isArray(parsed?.solveSteps)
                ? parsed.solveSteps.map(repairLatexString)
                : q._solveSteps,
            _explanationExpanded: true,
        };
    } catch (err) {
        phaseStep(
            "3",
            `explanation expand failed (keeping prior): ${err?.message || err}`
        );
        return q;
    }
};

/** Independent recompute for integer — mandatory for ship-grade correctness. */
const recomputeIntegerIndependent = async (q) => {
    const stem = String(q.questionText || "");
    const locked = Number(q.correctAnswer ?? q.finalAnswer);
    if (!Number.isFinite(locked)) return q;
    const prompt = `Independent JEE Advanced solver. Solve ONLY this integer problem from scratch.
Return ONLY JSON: {"final_answer": <number>, "confidence": 0.0-1.0, "brief_steps": ["..."]}
Do not see any claimed answer. STEM:
${stem}`;
    try {
        const raw = await callSolverJson("gemini", prompt, {
            allowGemini: true,
        });
        const obj = parseJsonLoose(raw);
        const v = Number(obj.final_answer ?? obj.value ?? obj.answer);
        if (!Number.isFinite(v)) return q;
        if (Math.abs(v - locked) < 1e-6) {
            stats.recomputeOk += 1;
            console.log(
                `  [recompute] integer OK key=${locked} independent=${v}`
            );
            return {
                ...q,
                _recomputeOk: true,
                _recomputeValue: v,
                _lockMode: `${q._lockMode}+recompute`,
                _answerCorrectnessGuaranteed: true,
            };
        }
        stats.recomputeFail += 1;
        console.warn(
            `  [recompute] MISMATCH locked=${locked} independent=${v} — DROP path`
        );
        return {
            ...q,
            _recomputeOk: false,
            _recomputeValue: v,
            _recomputeMismatch: true,
            _answerCorrectnessGuaranteed: false,
        };
    } catch (err) {
        console.warn(`  [recompute] failed: ${err?.message || err}`);
        return {
            ...q,
            _recomputeOk: false,
            _answerCorrectnessGuaranteed: false,
            _needsReview: true,
        };
    }
};

/** Independent multi letter-set recompute (correctness toward 92–100% ship). */
const recomputeMultiIndependent = async (q) => {
    const stem = String(q.questionText || "");
    const opts = (q.options || []).map((o, i) =>
        `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : o?.text || o}`
    );
    const locked = normalizeMultiLetters(q.correctAnswer);
    if (!locked) return q;
    const prompt = `Independent JEE Advanced multi-correct solver. Judge EVERY option TRUE/FALSE from scratch.
Return ONLY JSON: {"correct_letters": ["A","C"], "confidence": 0.0-1.0}
STEM:
${stem}
OPTIONS:
${opts.join("\n")}`;
    try {
        const raw = await callSolverJson("gemini", prompt, {
            allowGemini: true,
        });
        const obj = parseJsonLoose(raw);
        const got = normalizeMultiLetters(
            obj.correct_letters ?? obj.final_answer ?? obj.answer
        );
        if (got && got === locked) {
            stats.recomputeOk += 1;
            console.log(`  [recompute] multi OK key=${locked}`);
            return {
                ...q,
                _recomputeOk: true,
                _recomputeValue: got,
                _lockMode: `${q._lockMode}+recompute`,
                _answerCorrectnessGuaranteed: true,
            };
        }
        stats.recomputeFail += 1;
        console.warn(
            `  [recompute] multi MISMATCH locked=${locked} independent=${got}`
        );
        return {
            ...q,
            _recomputeOk: false,
            _recomputeValue: got,
            _recomputeMismatch: true,
            _answerCorrectnessGuaranteed: false,
        };
    } catch (err) {
        console.warn(`  [recompute] multi failed: ${err?.message || err}`);
        return { ...q, _recomputeOk: false, _needsReview: true };
    }
};

const stampTrust = (q) => {
    const trust = computeTrustGrade(q);
    // High-risk provisional never production-ready
    if (isHighRiskStem(q) && trust.grade === "provisional") {
        trust.productionReady = false;
        trust.needsReview = true;
        trust.badge = "PROVISIONAL-HIGH-RISK";
    }
    if (q._recomputeMismatch) {
        trust.productionReady = false;
        trust.needsReview = true;
        trust.badge = "RECOMPUTE-MISMATCH";
        trust.grade = "failed_recompute";
        trust.reason = `independent recompute ${q._recomputeValue} ≠ locked ${q.correctAnswer}`;
    } else if (q._recomputeOk && trust.grade === "provisional") {
        trust.grade = "provisional_recomputed";
        trust.badge = "PROVISIONAL+RECOMPUTE";
        trust.productionReady = false; // still not dual-openai, but stronger
        trust.needsReview = true;
        trust.reason = "generator B + independent recompute match";
    }
    return {
        ...q,
        _trustGrade: trust.grade,
        _trustBadge: trust.badge,
        _productionReady: trust.productionReady,
        _needsReview: trust.needsReview,
        _trustReason: trust.reason,
    };
};

/** Target ~9.2 Advanced hard (not 9.5+ over-stacked). */
const DEPTH_GOVERNOR = `
**DEPTH GOVERNOR — target authentic Advanced hard (~9.2), NOT olympiad mega-stack:**
- Each question: **2 major techniques** (max 3). Reject mental drafts with 4+ independent engines.
- BAD (too hard / hard to verify): focal chord + tangents + normals + diameter circle + locus + area all at once.
- GOOD: focal chord + one locus property; OR matrix rank + consistency; OR Bayes + one series/state idea.
- Solve path should be dual-checkable in one focused derivation (favor correctness).
- Prefer clean intermediate results; avoid chains where one algebra slip invalidates four options.
- Stay HARD (multi_concept, non-Main) but **controlled** hardness.
`;

/** Diversity: prefer mixed chapters; limit Apollonius/locus-transform clustering. */
const DIVERSITY_HINT = `
**ARCHETYPE DIVERSITY (keep ~9.2 Advanced quality; avoid AI pattern smell):**
- In one pack of 6, at most ONE pure "Apollonius → Möbius/inversion → optimize" chain.
- Prefer distinct first observations: algebraic (rank/consistency), probabilistic (Bayes/states), DE/area, 3D, complex rotation/arg, conic tangent — not three complex loci.
- Multi options: ≥2 options share the SAME intermediate (coupled).
- Do NOT telegraph every tool when avoidable.
- Diversity is structure mix — do NOT reduce to Main drills.
${DEPTH_GOVERNOR}
`;

const diversifySlotPlans = (slots = [], accepted = []) => {
    const used = new Set(
        accepted
            .map((q) =>
                String(q._conceptSlot || q.conceptSlot || "").toLowerCase()
            )
            .filter(Boolean)
    );
    const apolloniusRe =
        /apollonius|locus.*invers|m[oö]bius|w\s*=\s*1\/z|circle.*transform/i;
    let apCount = accepted.filter((q) =>
        apolloniusRe.test(String(q.questionText || ""))
    ).length;

    const scored = (slots || []).map((s, i) => {
        const key = String(s.conceptSlot || s.label || s.chapter || "").toLowerCase();
        let score = 0;
        if (used.has(key)) score -= 5;
        if (/complex|locus|apollonius|invers/i.test(key)) {
            score -= apCount >= 1 ? 3 : 0;
        }
        if (/probab|bayes|urn|matrix|rank|diff|integral|vector|3d|conic|parabola/i.test(key)) {
            score += 2;
        }
        // Prefer unused topic ids from HIGH pack rotation
        score += (i % 3 === 0 ? 0.1 : 0);
        return { s, score, i };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.map((x) => x.s);
};

const generateIntegerBatch = async (count, slots = [], exclude = []) => {
    if (count <= 0) return [];
    const ctx = buildAdvContextBlock(slots);
    const slotLines = (slots || [])
        .slice(0, count)
        .map(
            (s, i) =>
                `${i + 1}. ${s.conceptSlot || s.label || s.chapter || "hard multi_concept"}`
        )
        .join("\n");
    const excludeBlock = exclude.length
        ? `Do NOT repeat these stems:\n${exclude
              .slice(0, 20)
              .map((t, i) => `${i + 1}. ${String(t).slice(0, 160)}`)
              .join("\n")}`
        : "";

    const prompt = `You are a senior JEE Advanced Mathematics paper setter (IIT Advanced depth — NOT JEE Main drills).

Generate exactly ${count} HARD INTEGER / NUMERICAL answer questions (answer is an integer or short exact number; NO options).

${LATEX_JSON_HINT}
${DIVERSITY_HINT}

${ctx}

**Assigned hard slots (one question per line):**
${slotLines || `Generate ${count} distinct multi-concept hard Advanced problems.`}

${excludeBlock}

**HARDNESS RULES (mandatory — controlled Advanced ~9.2):**
- multi_concept: fuse **2 techniques** (max 3); avoid 4+ idea mega-stacks
- Prefer hard_archetypes; NEVER use banned_easy_templates as main ask
- Single clear numerical ask; integer answer; dual-solvable in one focused chain
- Veteran Advanced caliber — NOT Main, NOT olympiad-overstack
- FIRST STEP non-obvious; then one clean computation path
- Prefer intermediate results that sympy/independent solver can recheck

Return ONLY JSON:
{
  "questions": [
    {
      "questionType": "integer",
      "conceptSlot": "...",
      "chapter": "...",
      "questionText": "full stem with all data",
      "finalAnswer": 42,
      "answerDisplay": "42",
      "solveSteps": ["step1", "step2", "step3", "step4", "step5", "step6", "step7", "step8 concluding with finalAnswer"],
      "explanation": "full multi-paragraph derivation ending with the integer answer",
      "insightOneLiner": "the non-obvious observation that unlocks the problem",
      "difficultySelfScore": 85
    }
  ]
}`;

    const parsed = await callGeminiJson(prompt);
    const list = Array.isArray(parsed?.questions)
        ? parsed.questions
        : Array.isArray(parsed)
          ? parsed
          : [];
    return list
        .filter((q) => q?.questionText)
        .map((q) =>
            sanitizeGeneratedQuestion({
                questionType: "integer",
                questionText: String(q.questionText || "").trim(),
                options: [],
                correctIndex: null,
                correctAnswer: q.finalAnswer ?? q.answerDisplay,
                explanation: String(
                    q.explanation || (q.solveSteps || []).join(" ")
                ),
                _solveSteps: q.solveSteps || [],
                _conceptSlot: q.conceptSlot || "",
                _chapter: q.chapter || "",
                _advancedType: "integer",
                _generatorFinalAnswer: q.finalAnswer ?? q.answerDisplay,
                difficultyTier: "hard",
                _questionKind: "multi_concept",
            })
        );
};

const generateMatchBatch = async (count, slots = [], exclude = []) => {
    if (count <= 0) return [];
    const ctx = buildAdvContextBlock(slots);
    const slotLines = (slots || [])
        .slice(0, count)
        .map(
            (s, i) =>
                `${i + 1}. ${s.conceptSlot || s.label || s.chapter || "hard multi_concept"}`
        )
        .join("\n");
    const excludeBlock = exclude.length
        ? `Do NOT repeat these stems:\n${exclude
              .slice(0, 20)
              .map((t, i) => `${i + 1}. ${String(t).slice(0, 160)}`)
              .join("\n")}`
        : "";

    const prompt = `You are a senior JEE Advanced Mathematics paper setter (IIT Advanced match-list depth).

Generate exactly ${count} HARD MATCH THE FOLLOWING questions.
Each has List-I (4 entries), List-II (4–5 entries), and 4 options A–D where each option is a full matching arrangement (e.g. "1-P, 2-Q, 3-R, 4-S").

${LATEX_JSON_HINT}
${DIVERSITY_HINT}

${ctx}

**Assigned hard slots:**
${slotLines || `Generate ${count} distinct Advanced match-list problems.`}

${excludeBlock}

**HARDNESS RULES:**
- multi_concept fusion; not trivial one-to-one definition matching
- Prefer hard_archetypes from Advanced pack
- Exactly one correct arrangement option
- Each List-I item must itself be Advanced-depth (not a definition recall)
- Prefer mild interdependence (shared setup / shared parameter / common locus) when natural
- explanation MUST solve EVERY List-I row fully, then assemble the matching — never only state "option A"

Return ONLY JSON:
{
  "questions": [
    {
      "questionType": "match",
      "conceptSlot": "...",
      "chapter": "...",
      "questionText": "Match List-I with List-II and select the correct option.",
      "listI": ["...", "...", "...", "..."],
      "listII": ["...", "...", "...", "..."],
      "options": [
        "1-P, 2-Q, 3-R, 4-S",
        "1-Q, 2-P, 3-S, 4-R",
        "1-P, 2-R, 3-Q, 4-S",
        "1-S, 2-Q, 3-P, 4-R"
      ],
      "correctAnswer": "A",
      "solveSteps": ["1→...", "2→...", "3→...", "4→...", "assembly→ correct option"],
      "explanation": "full per-item derivations + final arrangement",
      "difficultySelfScore": 85
    }
  ]
}`;

    const parsed = await callGeminiJson(prompt);
    const list = Array.isArray(parsed?.questions)
        ? parsed.questions
        : Array.isArray(parsed)
          ? parsed
          : [];
    return list
        .filter((q) => q?.questionText && Array.isArray(q.options))
        .map((q) => {
            const letter = String(q.correctAnswer || "A")
                .trim()
                .toUpperCase()
                .slice(0, 1);
            const correctIndex = Math.max(0, letter.charCodeAt(0) - 65);
            return sanitizeGeneratedQuestion({
                questionType: "match",
                questionText: String(q.questionText || "").trim(),
                listI: q.listI || [],
                listII: q.listII || [],
                options: (q.options || []).map(String),
                correctIndex,
                correctAnswer: letter,
                explanation: String(
                    q.explanation || (q.solveSteps || []).join(" ")
                ),
                _solveSteps: q.solveSteps || [],
                _conceptSlot: q.conceptSlot || "",
                _chapter: q.chapter || "",
                _advancedType: "match",
                difficultyTier: "hard",
                _questionKind: "multi_concept",
            });
        });
};

const generateMultiBatch = async (count, steering, excludeTexts = []) => {
    // Custom Gemini multi-correct (NOT one-shot QB path — that path produced
    // Main-level drills: commuting matrices, pure dy/dx pickers).
    if (count <= 0) return [];
    const slots = steering?.slotPlans || [];
    const ctx = buildAdvContextBlock(slots);
    const slotLines = (slots || [])
        .slice(0, count)
        .map(
            (s, i) =>
                `${i + 1}. ${s.conceptSlot || s.label || s.chapter || "hard multi_concept"}`
        )
        .join("\n");
    const excludeBlock = excludeTexts?.length
        ? `Do NOT repeat these stems:\n${excludeTexts
              .slice(0, 20)
              .map((t, i) => `${i + 1}. ${String(t).slice(0, 160)}`)
              .join("\n")}`
        : "";

    const prompt = `You are a senior JEE Advanced Mathematics paper setter (IIT Advanced multi-correct depth — NOT JEE Main).

Generate exactly ${count} HARD MULTI-CORRECT MCQs (one or more of A–D may be correct).

${LATEX_JSON_HINT}
${DIVERSITY_HINT}

${ctx}

**Assigned hard slots:**
${slotLines || `Generate ${count} distinct multi-concept hard Advanced multi-correct problems.`}

${excludeBlock}

**HARDNESS / DESIGN (controlled Advanced ~9.2 — correctable hard):**
- Hidden insight / non-obvious first step.
- Fuse **2 techniques** (max 3). Do NOT pack 4 major constructions into one multi.
- BANNED as main ask: pure commuting-matrix entry match; pure dy/dx picker; sole inversion center/radius recall.
- Prefer one core derivation that judges all options (coupled options).
- Prefer 2 correct options when natural (not always A,B,C) — wider keys raise dual-error risk.
- difficultySelfScore target 78–88 (hard Advanced, not olympiad 95+).
- Self-reject if stem needs more than 3 major ideas to solve.

Return ONLY JSON:
{
  "questions": [
    {
      "questionType": "multiple",
      "conceptSlot": "...",
      "chapter": "...",
      "questionText": "stem ending with 'which of the following is/are correct?' style",
      "options": ["...", "...", "...", "..."],
      "correctLetters": ["A", "C"],
      "solveSteps": ["...", "...", "...", "...", "..."],
      "explanation": "full derivation; judge every option TRUE/FALSE with reason",
      "insightOneLiner": "the non-obvious unlock",
      "difficultySelfScore": 85
    }
  ]
}`;

    const parsed = await callGeminiJson(prompt);
    const list = Array.isArray(parsed?.questions)
        ? parsed.questions
        : Array.isArray(parsed)
          ? parsed
          : [];
    return list
        .filter((q) => q?.questionText && Array.isArray(q.options) && q.options.length >= 4)
        .filter((q) => Number(q.difficultySelfScore || 0) >= 70)
        .map((q) => {
            const letters = normalizeMultiLetters(
                q.correctLetters || q.correct_letters || q.correctAnswer
            );
            const indices = lettersToCorrectIndices(letters);
            return sanitizeGeneratedQuestion({
                questionType: "multiple",
                questionText: String(q.questionText || "").trim(),
                options: (q.options || []).map(String),
                correctIndices: indices,
                correctIndex: indices[0] ?? 0,
                correctAnswer: letters || "",
                explanation: String(
                    q.explanation || (q.solveSteps || []).join(" ")
                ),
                _solveSteps: q.solveSteps || [],
                _conceptSlot: q.conceptSlot || "",
                _chapter: q.chapter || "",
                _advancedType: "multiple",
                _insight: q.insightOneLiner || "",
                difficultyTier: "hard",
                _questionKind: "multi_concept",
                _generatorDifficultySelfScore:
                    Number(q.difficultySelfScore) || null,
            });
        });
};

const lockMulti = async (questions) => {
    // Cannot use runStageAAnswerLock: answerCorrection only re-keys *single*.
    // Strict dual-agree would drop every multi-correct item (live: 4 raw → 0 kept).
    const out = [];
    for (const q of questions || []) {
        try {
            const opts = (q.options || []).map((o) =>
                typeof o === "string" ? o : o?.text || String(o || "")
            );
            if (opts.filter((t) => String(t).trim()).length < 2) {
                phaseStep(
                    "3",
                    `DROP multi (bad options): ${String(q.questionText).slice(0, 60)}…`
                );
                continue;
            }
            phaseStep(
                "3",
                `multi dual-lock: ${String(q.questionText).slice(0, 70)}…`
            );
            const genKey = normalizeMultiLetters(
                q.correctAnswer || q.correctLetters || q.correctIndices
            );
            const dual = await dualSolveMulti(q.questionText, opts, genKey);
            if (dual.agree && dual.key) {
                const indices = lettersToCorrectIndices(dual.key);
                let locked = stampTrust({
                    ...q,
                    questionType: "multiple",
                    correctIndices: indices,
                    correctIndex: indices[0] ?? q.correctIndex,
                    correctAnswer: dual.key,
                    answerDisplay: dual.key,
                    _doubleSolverAgree: true,
                    _stageAAnswerLocked: true,
                    _solverTruthApplied: true,
                    _answerCorrectnessGuaranteed: !/generator/i.test(
                        String(dual.mode || "")
                    ),
                    _dualA: dual.a?.key,
                    _dualB: dual.b?.key,
                    _lockMode: dual.mode,
                    _ranB: dual.ranB,
                });
                // Third-pass letter-set recompute for ship-grade correctness
                locked = stampTrust(await recomputeMultiIndependent(locked));
                stats.dualLocked += 1;
                phaseStep(
                    "3",
                    `multi LOCKED key=${dual.key} mode=${dual.mode} trust=${locked._trustBadge}`
                );
                if (locked._recomputeMismatch && !KEEP_UNVERIFIED) {
                    stats.dualDropped += 1;
                    phaseStep(
                        "3",
                        `DROP multi (recompute mismatch ${locked._recomputeValue}≠${dual.key})`
                    );
                } else {
                    out.push(locked);
                }
            } else if (KEEP_UNVERIFIED) {
                stats.dualDropped += 1;
                out.push({
                    ...q,
                    _doubleSolverAgree: false,
                    _stageAAnswerLocked: false,
                    _dualA: dual.a?.key,
                    _dualB: dual.b?.key,
                });
            } else {
                stats.dualDropped += 1;
                phaseStep(
                    "3",
                    `DROP multi (dual disagree): A=${dual.a?.key} B=${dual.b?.key} · ${String(q.questionText).slice(0, 50)}…`
                );
            }
        } catch (err) {
            phaseStep("3", `multi dual-lock error: ${err?.message || err}`);
            if (KEEP_UNVERIFIED) out.push(q);
        }
    }
    return out;
};

const lockInteger = async (questions) => {
    const out = [];
    for (const q of questions) {
        try {
            const dual = await dualSolveNumeric(
                q.questionText,
                q.correctAnswer ?? q._generatorFinalAnswer ?? q.finalAnswer
            );
            if (dual.agree && dual.value != null) {
                let locked = stampTrust({
                    ...q,
                    correctAnswer: dual.value,
                    finalAnswer: dual.value,
                    answerDisplay: String(dual.value),
                    _doubleSolverAgree: true,
                    _stageAAnswerLocked: true,
                    _solverTruthApplied: true,
                    _answerCorrectnessGuaranteed: !/generator/i.test(
                        String(dual.mode || "")
                    ),
                    _dualA: dual.a?.value,
                    _dualB: dual.b?.value,
                    _lockMode: dual.mode,
                    _ranB: dual.ranB,
                });
                // Always third-pass recompute for integers (correctness 92–100%)
                locked = stampTrust(await recomputeIntegerIndependent(locked));
                stats.dualLocked += 1;
                phaseStep(
                    "3",
                    `integer LOCKED ${dual.value} mode=${dual.mode} trust=${locked._trustBadge}`
                );
                if (locked._recomputeMismatch && !KEEP_UNVERIFIED) {
                    stats.dualDropped += 1;
                    phaseStep(
                        "3",
                        `DROP integer (recompute mismatch ${locked._recomputeValue}≠${dual.value})`
                    );
                } else {
                    out.push(locked);
                }
            } else if (KEEP_UNVERIFIED) {
                stats.dualDropped += 1;
                out.push({
                    ...q,
                    _doubleSolverAgree: false,
                    _stageAAnswerLocked: false,
                    _dualA: dual.a?.value,
                    _dualB: dual.b?.value,
                });
            } else {
                stats.dualDropped += 1;
                phaseStep(
                    "3",
                    `DROP integer (dual disagree): A=${dual.a?.value} B=${dual.b?.value} · ${String(q.questionText).slice(0, 60)}…`
                );
            }
        } catch (err) {
            phaseStep("3", `integer dual-lock error: ${err?.message || err}`);
            if (KEEP_UNVERIFIED) out.push(q);
        }
    }
    return out;
};

const lockMatch = async (questions) => {
    const out = [];
    for (const q of questions) {
        try {
            const dual = await dualSolveMatch(
                q.questionText,
                q.listI,
                q.listII,
                q.options
            );
            if (dual.agree && dual.letter) {
                const idx = dual.letter.charCodeAt(0) - 65;
                const locked = stampTrust({
                    ...q,
                    correctAnswer: dual.letter,
                    correctIndex: idx,
                    _doubleSolverAgree: true,
                    _stageAAnswerLocked: true,
                    _solverTruthApplied: true,
                    _answerCorrectnessGuaranteed: !/generator/i.test(
                        String(dual.mode || "")
                    ),
                    _dualA: dual.a?.letter,
                    _dualB: dual.b?.letter,
                    _lockMode: dual.mode,
                    _ranB: dual.ranB,
                });
                stats.dualLocked += 1;
                phaseStep(
                    "3",
                    `match LOCKED ${dual.letter} mode=${dual.mode} trust=${locked._trustBadge}`
                );
                out.push(locked);
            } else if (KEEP_UNVERIFIED) {
                stats.dualDropped += 1;
                out.push({
                    ...q,
                    _doubleSolverAgree: false,
                    _stageAAnswerLocked: false,
                    _dualA: dual.a?.letter,
                    _dualB: dual.b?.letter,
                });
            } else {
                phaseStep(
                    "3",
                    `DROP match (dual disagree): A=${dual.a?.letter} B=${dual.b?.letter} · ${String(q.questionText).slice(0, 60)}…`
                );
            }
        } catch (err) {
            phaseStep("3", `match dual-lock error: ${err?.message || err}`);
            if (KEEP_UNVERIFIED) out.push(q);
        }
    }
    return out;
};

const isLocked = (q) =>
    q?._answerCorrectnessGuaranteed ||
    q?._doubleSolverAgree ||
    q?._stageAAnswerLocked ||
    q?._solverTruthApplied;

const stemKey = (q) =>
    String(q?.questionText || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .slice(0, 160);

const attachChapters = (questions = []) =>
    questions.map((q) => {
        const hits = inferJeeAdvancedTopicsFromSlots([
            {
                chapter: q._chapter || q.chapter || "",
                conceptSlot: q._conceptSlot || q.conceptSlot || "",
                description: String(q.questionText || "").slice(0, 400),
            },
        ]);
        if (!hits[0]) return q;
        return {
            ...q,
            _chapter: hits[0].chapter,
            chapter: hits[0].chapter,
            _topicId: hits[0].topicId,
            topicId: hits[0].topicId,
        };
    });

const formatBlock = (q, i) => {
    const letters = ["A", "B", "C", "D"];
    const trust = q._trustBadge || (isLocked(q) ? "LOCKED" : "UNVERIFIED");
    const lines = [
        `Q${i + 1}. type=${q.questionType || q._advancedType} · ${q._topicId || ""} ${q._chapter || ""} · trust=${trust}${q._needsReview ? " · NEEDS_REVIEW" : ""}${q._productionReady ? " · PROD_OK" : ""}`,
        `Slot: ${q._conceptSlot || q.conceptSlot || "?"} · lockMode=${q._lockMode || "?"}`,
        String(q.questionText || "").trim(),
        "",
    ];
    if (q.listI?.length) {
        lines.push("List-I:");
        q.listI.forEach((x, j) => lines.push(`  ${j + 1}. ${x}`));
        lines.push("List-II:");
        (q.listII || []).forEach((x, j) =>
            lines.push(`  ${String.fromCharCode(80 + j)}. ${x}`)
        );
        lines.push("");
    }
    if (q.options?.length) {
        q.options.forEach((o, j) => lines.push(`  ${letters[j]}. ${o}`));
    } else {
        lines.push("(no options — integer/numerical)");
    }
    const lock = isLocked(q) ? "DUAL-LOCK" : "UNVERIFIED";
    lines.push(
        `Correct: ${q.correctAnswer ?? (q.correctIndex != null ? letters[q.correctIndex] : "?")}  [${lock}]`
    );
    lines.push(`Explanation: ${String(q.explanation || "").slice(0, 800)}`);
    lines.push("");
    return lines.join("\n");
};

async function connectMongo() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.warn("MONGODB_URI missing — archetype history may be limited");
        return;
    }
    await mongoose.connect(uri, {
        dbName: process.env.DB_NAME || undefined,
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.log("\n" + RULE);
    console.log(
        "JEE ADVANCED — Hard Maths — 6 NON-SINGLE (multi / integer / match)"
    );
    console.log(RULE);
    console.log(`Target   : ${TOTAL} questions TOTAL (single SKIPPED)`);
    console.log(
        `Sections : multi=${MULTI_N} · integer=${INTEGER_N} · match=${MATCH_N}  (sum=${MULTI_N + INTEGER_N + MATCH_N})`
    );
    console.log(
        `Topics   : HIGH relevance (${TARGET_TOPICS.length}) → ${TARGET_TOPICS.map((t) => t.topicId).join(", ")}`
    );
    console.log(
        `Provider : ${GENERATION_PROVIDER} / ${process.env.GEMINI_HARD_TEXT_MODEL}`
    );
    console.log(
        `Solvers  : A=${VERIFY_MODEL} · B=${SECONDARY_SOLVER} (dual-mode=${DUAL_MODE}) · drop-unverified=${!KEEP_UNVERIFIED}`
    );
    if (DUAL_MODE === "selective") {
        console.log(
            `Dual B if : integer|match always · conf<${CONF_FLOOR_SKIP_B} · multi≥3 letters · gen≠A · stem>900`
        );
    }
    console.log(
        `Timeouts : gemini=${process.env.GEMINI_REQUEST_TIMEOUT_MS}ms · solver=${process.env.OPENAI_SOLVER_TIMEOUT_MS}ms`
    );
    console.log(
        `Hard bar : skeletonMin=${process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN} · lastAttempt=${process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR} · targetAuth≈9.2 (depth cap 2–3 ideas)`
    );
    console.log(
        `Quality  : expandLockedFinals=${EXPAND_EXPLANATIONS ? "ON (insight-first)" : "OFF"} · trustGrades=ON · recompute=integer+multi · no-generator-B · diversity=ON`
    );
    console.log(
        `Speed    : openaiAttempts=${OPENAI_ATTEMPTS} · genRetries=${MAX_RETRIES} · fillRounds=${FILL_ROUNDS}`
    );
    console.log(
        `Token policy: exact counts · OpenAI circuit on 429 · expand ONLY final kept items · force B on integer/match`
    );
    console.log("");
    console.log("Section plan (console per section during fill):");
    console.log(`  [SECTION multi  ] target ${MULTI_N}`);
    console.log(`  [SECTION integer] target ${INTEGER_N}`);
    console.log(`  [SECTION match  ] target ${MATCH_N}`);
    console.log("");

    phaseStart("0", "Mongo + Advanced data pack", [
        "Load jee_advanced/ syllabus + NCERT hard context + scoring",
        "Connect Mongo for archetype history",
    ]);
    await connectMongo();
    const hydrated = await hydrateJeeAdvancedMathsScoringFromDb();
    phaseStep(
        "0",
        hydrated
            ? "Scoring hydrated from ExamSyllabusPack (Mongo)"
            : "Scoring from file pack (Mongo pack missing)"
    );
    phaseEnd("0", "ok", {
        topics: allTopics.length,
        high: highTopics.length,
        dataOk: true,
        scoringSource: hydrated ? "exam_syllabus_pack" : "file",
    });

    let planResult = null;
    const accepted = [];
    const seen = new Set();
    let failed = false;
    let failError = null;

    try {
        phaseStart("1", "Plan HIGH Advanced multi_concept slots", [
            `Plan ${TOTAL} hard slots inside HIGH-relevance chapters`,
            `Exclude ${EXCLUDED_TOPICS.length} lower-relevance topics`,
        ]);
        planResult = await planQuestionBankTopics({
            topic: TOPIC,
            bankName: BANK_NAME,
            difficulty: DIFFICULTY,
            singleCount: TOTAL, // slot count only — generation still non-single
            categoryPaths: CATEGORY_PATHS,
            subject: SUBJECT,
            generationProvider: GENERATION_PROVIDER,
            adminExcludeTopics: EXCLUDED_TOPICS,
        });
        const slots = planResult?.steering?.slotPlans || [];
        slots.forEach((s, i) => {
            const hits = inferJeeAdvancedTopicsFromSlots([s]);
            phaseStep(
                "1",
                `Slot ${i + 1}: ${hits[0]?.topicId || "?"} ${hits[0]?.chapter || s.label || s.conceptSlot}`
            );
        });
        phaseEnd("1", "ok", {
            slots: slots.length,
            source: planResult?.steering?.source,
        });

        phaseStart("2+3", "Generate non-single types + selective lock + fill", [
            "Hard generation (quality bar kept) → A always, B on risk",
            "Trust grades + integer recompute on weak locks",
            "NO single-correct items accepted",
            `Fill rounds max ${FILL_ROUNDS}`,
        ]);

        const need = () => ({
            multi: Math.max(
                0,
                MULTI_N -
                    accepted.filter((q) => q._advancedType === "multiple")
                        .length
            ),
            integer: Math.max(
                0,
                INTEGER_N -
                    accepted.filter((q) => q._advancedType === "integer").length
            ),
            match: Math.max(
                0,
                MATCH_N -
                    accepted.filter((q) => q._advancedType === "match").length
            ),
        });

        let fillRound = 0;
        while (accepted.length < TOTAL && fillRound < FILL_ROUNDS) {
            fillRound += 1;
            const n = need();
            const stillNeed = n.multi + n.integer + n.match;
            if (stillNeed <= 0) break;

            phaseStep(
                "2+3",
                `Fill ${fillRound}/${FILL_ROUNDS}: need multi=${n.multi} integer=${n.integer} match=${n.match} (have ${accepted.length}/${TOTAL})`
            );

            // Replan after first round for diversity
            let steering = planResult?.steering || null;
            if (fillRound > 1) {
                try {
                    const replan = await planQuestionBankTopics({
                        topic: TOPIC,
                        bankName: BANK_NAME,
                        difficulty: DIFFICULTY,
                        singleCount: stillNeed + 2,
                        categoryPaths: CATEGORY_PATHS,
                        subject: SUBJECT,
                        generationProvider: GENERATION_PROVIDER,
                        adminExcludeTopics: EXCLUDED_TOPICS,
                    });
                    if (replan?.steering) {
                        planResult = replan;
                        steering = replan.steering;
                    }
                } catch {
                    /* keep prior */
                }
            }
            const slotPlans = diversifySlotPlans(
                steering?.slotPlans || [],
                accepted
            );
            const excludeTexts = [
                ...seen,
                ...accepted.map((q) => q.questionText).filter(Boolean),
            ];

            // Diversity-aware steering for this fill (keeps hard bar)
            if (steering) {
                steering = {
                    ...steering,
                    slotPlans: slotPlans,
                };
            }

            // --- MULTI ---
            if (n.multi > 0) {
                const ask = n.multi; // exact need — no +1 waste tokens
                console.log(
                    `\n>>> [SECTION multi] need ${n.multi}/${MULTI_N} · request ${ask} (exact)`
                );
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        const raw = await timed(
                            `multi.generate×${ask} attempt${attempt}`,
                            () =>
                                generateMultiBatch(
                                    ask,
                                    steering,
                                    excludeTexts
                                )
                        );
                        phaseStep(
                            "2+3",
                            `multi: raw=${raw.length} → dual lock (stop early when section full)…`
                        );
                        // Only lock what we still need
                        const stillNeed =
                            MULTI_N -
                            accepted.filter((x) => x._advancedType === "multiple")
                                .length;
                        const locked = await timed(
                            `multi.dualLock×${Math.min(raw.length, stillNeed)}`,
                            () => lockMulti(raw.slice(0, stillNeed))
                        );
                        let added = 0;
                        for (const q of locked) {
                            if (
                                accepted.filter(
                                    (x) => x._advancedType === "multiple"
                                ).length >= MULTI_N
                            )
                                break;
                            if (String(q.questionType).toLowerCase() === "single")
                                continue;
                            if (!KEEP_UNVERIFIED && !isLocked(q)) continue;
                            const k = stemKey(q);
                            if (!k || seen.has(k)) continue;
                            seen.add(k);
                            accepted.push({
                                ...q,
                                _advancedType: "multiple",
                                questionType: "multiple",
                            });
                            added += 1;
                        }
                        phaseStep(
                            "2+3",
                            `multi: locked kept +${added} (multi total ${accepted.filter((x) => x._advancedType === "multiple").length}/${MULTI_N})`
                        );
                        break;
                    } catch (err) {
                        phaseStep(
                            "2+3",
                            `multi attempt ${attempt} failed: ${err?.message || err}`
                        );
                        if (attempt < MAX_RETRIES) await sleep(6000 * attempt);
                    }
                }
            }

            // --- INTEGER ---
            if (n.integer > 0) {
                const ask = n.integer;
                console.log(
                    `\n>>> [SECTION integer] need ${n.integer}/${INTEGER_N} · request ${ask} (exact)`
                );
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        const raw = await timed(
                            `integer.generate×${ask} attempt${attempt}`,
                            () =>
                                generateIntegerBatch(
                                    ask,
                                    slotPlans,
                                    excludeTexts
                                )
                        );
                        const stillNeed =
                            INTEGER_N -
                            accepted.filter((x) => x._advancedType === "integer")
                                .length;
                        phaseStep(
                            "2+3",
                            `integer: raw=${raw.length} → dual lock need=${stillNeed}…`
                        );
                        const locked = await timed(
                            `integer.dualLock×${Math.min(raw.length, stillNeed)}`,
                            () => lockInteger(raw.slice(0, stillNeed))
                        );
                        let added = 0;
                        for (const q of locked) {
                            if (
                                accepted.filter(
                                    (x) => x._advancedType === "integer"
                                ).length >= INTEGER_N
                            )
                                break;
                            if (!KEEP_UNVERIFIED && !isLocked(q)) continue;
                            const k = stemKey(q);
                            if (!k || seen.has(k)) continue;
                            seen.add(k);
                            accepted.push(q);
                            added += 1;
                        }
                        phaseStep(
                            "2+3",
                            `integer: kept +${added} (integer total ${accepted.filter((x) => x._advancedType === "integer").length}/${INTEGER_N})`
                        );
                        break;
                    } catch (err) {
                        phaseStep(
                            "2+3",
                            `integer attempt ${attempt} failed: ${err?.message || err}`
                        );
                        if (attempt < MAX_RETRIES) await sleep(6000 * attempt);
                    }
                }
            }

            // --- MATCH ---
            if (n.match > 0) {
                const ask = n.match;
                console.log(
                    `\n>>> [SECTION match] need ${n.match}/${MATCH_N} · request ${ask} (exact)`
                );
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        const raw = await timed(
                            `match.generate×${ask} attempt${attempt}`,
                            () =>
                                generateMatchBatch(
                                    ask,
                                    slotPlans,
                                    excludeTexts
                                )
                        );
                        const stillNeed =
                            MATCH_N -
                            accepted.filter((x) => x._advancedType === "match")
                                .length;
                        phaseStep(
                            "2+3",
                            `match: raw=${raw.length} → dual lock need=${stillNeed}…`
                        );
                        const locked = await timed(
                            `match.dualLock×${Math.min(raw.length, stillNeed)}`,
                            () => lockMatch(raw.slice(0, stillNeed))
                        );
                        let added = 0;
                        for (const q of locked) {
                            if (
                                accepted.filter(
                                    (x) => x._advancedType === "match"
                                ).length >= MATCH_N
                            )
                                break;
                            if (!KEEP_UNVERIFIED && !isLocked(q)) continue;
                            const k = stemKey(q);
                            if (!k || seen.has(k)) continue;
                            seen.add(k);
                            accepted.push(q);
                            added += 1;
                        }
                        phaseStep(
                            "2+3",
                            `match: kept +${added} (match total ${accepted.filter((x) => x._advancedType === "match").length}/${MATCH_N})`
                        );
                        break;
                    } catch (err) {
                        phaseStep(
                            "2+3",
                            `match attempt ${attempt} failed: ${err?.message || err}`
                        );
                        if (attempt < MAX_RETRIES) await sleep(6000 * attempt);
                    }
                }
            }

            const multiHave = accepted.filter(
                (x) => x._advancedType === "multiple"
            ).length;
            const intHave = accepted.filter(
                (x) => x._advancedType === "integer"
            ).length;
            const matchHave = accepted.filter(
                (x) => x._advancedType === "match"
            ).length;
            console.log(
                `\n<<< Fill ${fillRound} section tally: multi ${multiHave}/${MULTI_N} · integer ${intHave}/${INTEGER_N} · match ${matchHave}/${MATCH_N} · TOTAL ${accepted.length}/${TOTAL}`
            );
            phaseStep(
                "2+3",
                `After fill ${fillRound}: multi=${multiHave}/${MULTI_N} integer=${intHave}/${INTEGER_N} match=${matchHave}/${MATCH_N} total=${accepted.length}/${TOTAL}`
            );
        }

        phaseEnd(
            "2+3",
            accepted.length >= TOTAL ? "ok" : "partial",
            {
                produced: accepted.length,
                target: TOTAL,
                multi: accepted.filter((q) => q._advancedType === "multiple")
                    .length,
                integer: accepted.filter((q) => q._advancedType === "integer")
                    .length,
                match: accepted.filter((q) => q._advancedType === "match")
                    .length,
            }
        );

        // Phase 4: insight-first solutions ONLY for kept items (preserve hard quality; fix explanations)
        if (EXPAND_EXPLANATIONS && accepted.length) {
            phaseStart("4", "Insight-first solutions (locked finals only)", [
                `${accepted.length} kept items — expand explanations without changing keys`,
            ]);
            for (let i = 0; i < accepted.length; i++) {
                phaseStep(
                    "4",
                    `Expand Q${i + 1}/${accepted.length} [${accepted[i]._advancedType}] trust=${accepted[i]._trustBadge || "?"}`
                );
                accepted[i] = stampTrust(
                    await expandExplanation(accepted[i])
                );
            }
            phaseEnd("4", "ok", {
                expanded: stats.geminiExpandCalls,
                productionReady: accepted.filter((q) => q._productionReady)
                    .length,
                needsReview: accepted.filter((q) => q._needsReview).length,
            });
        }

        console.log(
            `\nDONE — ${accepted.length}/${TOTAL} non-single hard Advanced Maths (dual-locked where required).\n`
        );
    } catch (err) {
        failed = true;
        failError = err;
        console.error("FAILED:", err);
        phaseStep("2+3", `FAILED: ${err?.message || err}`);
    }

    // -----------------------------------------------------------------------
    // Save
    // -----------------------------------------------------------------------
    const questions = attachChapters(accepted).slice(0, TOTAL);
    const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
    const outDir = join(
        ROOT_DIR,
        "temp",
        `jee-advanced-hard-${TOTAL}-nonsingle-maths`,
        ts
    );
    mkdirSync(outDir, { recursive: true });

    writeFileSync(
        join(outDir, "questions.json"),
        JSON.stringify(questions, null, 2),
        "utf8"
    );
    writeFileSync(
        join(outDir, "questions.txt"),
        questions.map((q, i) => formatBlock(q, i)).join("\n"),
        "utf8"
    );
    writeFileSync(
        join(outDir, "topic-plan.json"),
        JSON.stringify(planResult || {}, null, 2),
        "utf8"
    );
    writeFileSync(
        join(outDir, "transcript.txt"),
        transcriptLines.join("\n"),
        "utf8"
    );
    writeFileSync(join(outDir, "phases.jsonl"), jsonlLines.join("\n"), "utf8");
    writeFileSync(
        join(outDir, "summary.json"),
        JSON.stringify(
            {
                exam: "JEE Advanced",
                subject: "Mathematics",
                mode: "non_single_only",
                skipSingle: true,
                requested: {
                    total: TOTAL,
                    multi: MULTI_N,
                    integer: INTEGER_N,
                    match: MATCH_N,
                },
                produced: {
                    total: questions.length,
                    multi: questions.filter((q) => q._advancedType === "multiple")
                        .length,
                    integer: questions.filter(
                        (q) => q._advancedType === "integer"
                    ).length,
                    match: questions.filter((q) => q._advancedType === "match")
                        .length,
                    dualLocked: questions.filter(isLocked).length,
                    productionReady: questions.filter((q) => q._productionReady)
                        .length,
                    needsReview: questions.filter((q) => q._needsReview)
                        .length,
                    insightExpanded: questions.filter(
                        (q) => q._explanationExpanded
                    ).length,
                },
                trustGrades: questions.map((q, i) => ({
                    q: i + 1,
                    type: q._advancedType,
                    badge: q._trustBadge,
                    grade: q._trustGrade,
                    mode: q._lockMode,
                    productionReady: q._productionReady,
                    needsReview: q._needsReview,
                    recomputeOk: q._recomputeOk ?? null,
                })),
                stages: [
                    "0_mongo_advanced_pack",
                    "1_plan_high_relevance_slots",
                    "2_generate_multi_integer_match",
                    "3_selective_lock_trust_grades",
                    "4_fill_until_count",
                    "5_insight_first_solutions_locked_only",
                    "6_save_artifacts",
                ],
                hardBar: {
                    skeletonMin: Number(
                        process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN
                    ),
                    forceMultiConcept: true,
                    dualMode: DUAL_MODE,
                    targetAuthenticity: 9.2,
                    depthGovernor: "2-3 major techniques max",
                    diversityHint: true,
                    insightFirstExplanations: EXPAND_EXPLANATIONS,
                    integerRecompute: true,
                    multiRecompute: true,
                    noGeneratorAsB: true,
                },
                models: {
                    writer: process.env.GEMINI_HARD_TEXT_MODEL,
                    solverA: VERIFY_MODEL,
                    solverB: SECONDARY_SOLVER,
                    dualMode: DUAL_MODE,
                    primarySolver: VERIFY_MODEL,
                },
                topics: TARGET_TOPICS.map((t) => ({
                    topicId: t.topicId,
                    chapter: t.chapter,
                })),
                dataRoot: "jee_advanced/",
                failed,
                failError: failError
                    ? String(failError?.message || failError)
                    : null,
                elapsedMs: elapsed(),
                outDir,
            },
            null,
            2
        ),
        "utf8"
    );

    printTokenBudget();
    console.log(`\nSaved to: ${outDir}`);
    console.log(
        `  multi=${questions.filter((q) => q._advancedType === "multiple").length}  integer=${questions.filter((q) => q._advancedType === "integer").length}  match=${questions.filter((q) => q._advancedType === "match").length}  dual-locked=${questions.filter(isLocked).length}`
    );

    if (failed && !questions.length) throw failError;
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("SCRIPT FAILED:", err);
        process.exit(1);
    })
    .finally(() => {
        mongoose.connection?.close?.().catch(() => {});
    });
