/**
 * JEE Main — Hard Mathematics, full-syllabus (concentrated hard) generation pipeline.
 *
 * Generates N hard single-correct MCQs across ALL official JEE Main Mathematics
 * units (14), using the FULL production pipeline (planner → solve-first
 * generation → dual audits → independent-solver verification → quality
 * evaluation → targeted regeneration → chapter audit). Hardness is steered by
 * files/ncert-reference/mathematics/jee-ncert-chapter-reference.json
 * (hard_archetypes / banned_easy_templates / hard_techniques per chapter).
 * Dual-solver accuracy path is unchanged.
 *
 * Providers (per requirement — Claude stays disabled, see generationProvider.service.js):
 *   Generation : Gemini            (AI_QB_ALLOWED_PROVIDERS default: openai,gemini)
 *   Verification/Answer key : OpenAI o-series dual solvers
 *   Evaluation : OpenAI
 *
 * NCERT grounding: ncertChapterReference.service.js → writer + solver prompts.
 *
 * Usage:
 *   node scripts/generate-jee-hard-curated-maths.mjs
 *   node scripts/generate-jee-hard-curated-maths.mjs --count=10
 *   node scripts/generate-jee-hard-curated-maths.mjs --verify-model=gpt-5 --solver-timeout-ms=90000
 *   JEE_GEN_VERIFY_MODEL=gpt-5-mini JEE_GEN_SOLVER_TIMEOUT_MS=60000 node scripts/generate-jee-hard-curated-maths.mjs
 *
 * Output: temp/jee-main-hard-<count>-curated-maths/<timestamp>/
 *   questions.txt, questions.json, evaluation.json, topic-plan.json,
 *   chapter-audit.json, summary.json, transcript.txt, phases.jsonl
 */

import dotenv from "dotenv";
import dns from "dns";
import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI / config
// ---------------------------------------------------------------------------
const argv = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = /^--([^=]+)=(.*)$/.exec(a);
        return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
    })
);

const REQUESTED_COUNT = Number(argv.count || process.env.JEE_GEN_COUNT || 10);
const DIFFICULTY = String(argv.difficulty || "hard").toLowerCase();
const SUBJECT = "Mathematics";
const GENERATION_PROVIDER = "gemini";
const EVALUATION_PROVIDER = "openai";
const MAX_ROUNDS = 10;
const MAX_EVAL_ATTEMPTS = 3;

// Independent-solver / answer-verification model. Empirically, both "gpt-5"
// and "gpt-5-mini" reason far past the 45-60s solver timeout on hard JEE math
// (every question paid a guaranteed timeout before falling back), so the
// proven-fast o-series reasoning model is the default here — same model the
// rest of this codebase defaults to (OPENAI_SOLVER_MODEL in .env). Pass
// --verify-model=gpt-5 or gpt-5-mini to opt back in once that account/tier is
// fast enough, ideally with a much larger --solver-timeout-ms.
const VERIFY_MODEL = String(
    argv["verify-model"] || process.env.JEE_GEN_VERIFY_MODEL || "o4-mini"
).trim();
// Solver/tiebreak timeout in ms — 60s gives headroom over the .env default
// (45s) without paying a huge tax when the model above is genuinely stuck.
const SOLVER_TIMEOUT_MS = Number(
    argv["solver-timeout-ms"] || process.env.JEE_GEN_SOLVER_TIMEOUT_MS || 60000
);
const FALLBACK_MODEL =
    VERIFY_MODEL === "o4-mini"
        ? "o3-mini"
        : VERIFY_MODEL.endsWith("-mini")
          ? "o4-mini"
          : `${VERIFY_MODEL}-mini`;
process.env.AI_QB_SOLVER_PROVIDER = "openai";
process.env.AI_QB_SOLVER_PROVIDER_B = "openai";
process.env.AI_QB_DIFFICULTY_JUDGE_PROVIDER = "openai";
process.env.AI_QB_AUDIT_PROVIDER = "openai";
process.env.OPENAI_SOLVER_MODEL = VERIFY_MODEL;
process.env.OPENAI_SOLVER_MODEL_B = VERIFY_MODEL;
process.env.OPENAI_AUDIT_MODEL = VERIFY_MODEL;
process.env.OPENAI_DIFFICULTY_JUDGE_MODEL = VERIFY_MODEL;
process.env.OPENAI_CORRECTNESS_AUDIT_MODEL = VERIFY_MODEL;
process.env.OPENAI_SOLVER_FALLBACK_CHAIN = `${FALLBACK_MODEL},o4-mini,o3-mini`;
process.env.OPENAI_SOLVER_TIMEOUT_MS = String(SOLVER_TIMEOUT_MS);
process.env.OPENAI_TIEBREAKER_TIMEOUT_MS = String(SOLVER_TIMEOUT_MS);

// The .env default (30s, 2 attempts) is tuned for short calls; the solve-first
// skeleton call for a "hard" JEE chunk (with repair loops) can legitimately
// take longer under load and was hitting "This operation was aborted" (an
// AbortController timeout) repeatedly during count-guarantee top-up waves,
// which — with no retry left in this script — used to crash the whole run.
process.env.GEMINI_REQUEST_TIMEOUT_MS = String(
    argv["gemini-timeout-ms"] || process.env.JEE_GEN_GEMINI_TIMEOUT_MS || 60000
);
process.env.GEMINI_QB_MAX_ATTEMPTS = String(
    process.env.JEE_GEN_GEMINI_MAX_ATTEMPTS || 3
);

// Concentrated hard: 100% multi_concept slots + multi-heavy composition.
// Accuracy path (dual solvers / NCERT formulas) stays strict — same as questions-only.
if (process.env.AI_QB_FORCE_ALL_MULTI == null) {
    process.env.AI_QB_FORCE_ALL_MULTI = "1";
}
if (process.env.AI_QB_HARD_MULTI_HEAVY == null) {
    process.env.AI_QB_HARD_MULTI_HEAVY = "1";
}
if (process.env.AI_QB_VETERAN_DIFFICULTY == null) {
    process.env.AI_QB_VETERAN_DIFFICULTY = "1";
}
if (process.env.AI_QB_DIFFICULTY_SELF_AUDIT == null) {
    process.env.AI_QB_DIFFICULTY_SELF_AUDIT = "1";
}
// Dual-solver answer lock — keep 10/10 accuracy / explanation behavior.
if (process.env.AI_QB_SOLVER_TRUTH == null) process.env.AI_QB_SOLVER_TRUTH = "1";
if (process.env.AI_QB_BLIND_SOLVER == null) process.env.AI_QB_BLIND_SOLVER = "1";
if (process.env.AI_QB_STRICT_ANSWER_CORRECTNESS == null) {
    process.env.AI_QB_STRICT_ANSWER_CORRECTNESS = "1";
}
if (process.env.AI_QB_DOUBLE_SOLVE == null) process.env.AI_QB_DOUBLE_SOLVE = "1";
if (process.env.AI_QB_DOUBLE_SOLVE_HARD_MATH_ONLY == null) {
    process.env.AI_QB_DOUBLE_SOLVE_HARD_MATH_ONLY = "1";
}
if (process.env.AI_QB_REQUIRE_DOUBLE_SOLVE == null) {
    process.env.AI_QB_REQUIRE_DOUBLE_SOLVE = "1";
}
if (process.env.AI_QB_STAGE_A_DROP_UNVERIFIED == null) {
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "1";
}
if (process.env.AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE == null) {
    process.env.AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE = "1";
}
if (process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR == null) {
    process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR = "0.9";
}
if (process.env.AI_QB_SOLVER_KEEP_PRIMARY_ON_DISAGREE == null) {
    process.env.AI_QB_SOLVER_KEEP_PRIMARY_ON_DISAGREE = "0";
}

const {
    planQuestionBankTopics,
    generateQuestionBankSuggestions,
    validateQuestionTopicRelevance,
} = await import("../src/services/aiQuestion.service.js");
const {
    getOfficialSyllabusUnits,
    matchOfficialSyllabusUnit,
    isJeeMainOfficialSyllabusAvailable,
} = await import("../src/services/jeeMainOfficialSyllabus.service.js");
const {
    isNcertChapterReferenceAvailable,
    listNcertChapterLabels,
    inferNcertChaptersFromSlots,
} = await import("../src/services/ncertChapterReference.service.js");
const { logConfirmedQuestionsToFile } = await import(
    "../src/services/confirmedQuestionsLogger.service.js"
);
const { GENERATE_INTENTS, TOPIC_RELEVANCE_PASS_SCORE } = await import(
    "../src/services/topicRelevanceValidation.service.js"
);

// ---------------------------------------------------------------------------
// GOLDEN STAGE default = same 5 curated chapters as 2026-08-01_08-16-14.
// Use --all-units for full 14 official Maths units.
// ---------------------------------------------------------------------------
const ALL_UNIT_TITLES = [
    "SETS, RELATIONS AND FUNCTIONS",
    "COMPLEX NUMBERS AND QUADRATIC EQUATIONS",
    "MATRICES AND DETERMINANTS",
    "PERMUTATIONS AND COMBINATIONS",
    "BINOMIAL THEOREM AND ITS SIMPLE APPLICATIONS",
    "SEQUENCE AND SERIES",
    "LIMIT, CONTINUITY AND DIFFERENTIABILITY",
    "INTEGRAL CALCULUS",
    "DIFFERENTIAL EQUATIONS",
    "CO-ORDINATE GEOMETRY",
    "THREE DIMENSIONAL GEOMETRY",
    "VECTOR ALGEBRA",
    "STATISTICS AND PROBABILITY",
    "TRIGONOMETRY",
];
const CURATED_FIVE_TITLES = [
    "CO-ORDINATE GEOMETRY",
    "LIMIT, CONTINUITY AND DIFFERENTIABILITY",
    "INTEGRAL CALCULUS",
    "MATRICES AND DETERMINANTS",
    "DIFFERENTIAL EQUATIONS",
];
const USE_ALL_UNITS =
    argv["all-units"] === true ||
    argv["all-units"] === "1" ||
    process.env.JEE_GEN_ALL_UNITS === "1";
const TARGET_CHAPTER_TITLES = USE_ALL_UNITS
    ? ALL_UNIT_TITLES
    : CURATED_FIVE_TITLES;
const DISPLAY_LABEL = {
    "SETS, RELATIONS AND FUNCTIONS": "Sets, Relations and Functions",
    "COMPLEX NUMBERS AND QUADRATIC EQUATIONS":
        "Complex Numbers and Quadratic Equations",
    "MATRICES AND DETERMINANTS": "Matrices and Determinants",
    "PERMUTATIONS AND COMBINATIONS": "Permutations and Combinations",
    "BINOMIAL THEOREM AND ITS SIMPLE APPLICATIONS": "Binomial Theorem",
    "SEQUENCE AND SERIES": "Sequence and Series",
    "LIMIT, CONTINUITY AND DIFFERENTIABILITY":
        "Limit, Continuity and Differentiability",
    "INTEGRAL CALCULUS": "Integral Calculus",
    "DIFFERENTIAL EQUATIONS": "Differential Equations",
    "CO-ORDINATE GEOMETRY": "Co-ordinate Geometry",
    "THREE DIMENSIONAL GEOMETRY": "Three Dimensional Geometry",
    "VECTOR ALGEBRA": "Vector Algebra",
    "STATISTICS AND PROBABILITY": "Statistics and Probability",
    "TRIGONOMETRY": "Trigonometry",
};
const CHAPTER_LABELS = TARGET_CHAPTER_TITLES.map((t) => DISPLAY_LABEL[t]);

const toTitleCase = (s = "") =>
    String(s)
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());

const TOPIC = USE_ALL_UNITS
    ? `Competitive › Engineering › JEE Mains › Mathematics · Concentrated hard (all units): ${CHAPTER_LABELS.join(", ")}`
    : `Competitive › Engineering › JEE Mains › Mathematics · Curated hard chapters: ${CHAPTER_LABELS.join(", ")}`;
const BANK_NAME = TOPIC;
const CATEGORY_PATHS = ["JEE Main > Mathematics"];

const allMathUnits = getOfficialSyllabusUnits(SUBJECT);
const EXCLUDED_TOPICS = allMathUnits
    .filter((u) => !TARGET_CHAPTER_TITLES.includes(String(u.title).toUpperCase()))
    .map((u) => toTitleCase(u.title));

// ---------------------------------------------------------------------------
// Phase logger — console + transcript.txt (human) + phases.jsonl (machine)
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
    const detailLines = details.map((d) => `[${at}] (+${secs}s)   · ${d}`).join("\n");
    emit(
        { type: "phase_start", id, title, details, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s) ${RULE}\n[${at}] (+${secs}s) PHASE ${id} START — ${title}\n[${at}] (+${secs}s) ${RULE}` +
            (detailLines ? `\n${detailLines}` : "")
    );
};

const phaseStep = (id, message, extra = null) => {
    const at = nowIso();
    const secs = (elapsed() / 1000).toFixed(1);
    emit(
        { type: "phase_step", id, message, extra, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s)   →   ${message}`
    );
};

const phaseEnd = (id, status, extra = null) => {
    const tookMs = Date.now() - (phaseStarts[id] || Date.now());
    const at = nowIso();
    const secs = (elapsed() / 1000).toFixed(1);
    const extraLines = extra
        ? Object.entries(extra)
              .map(
                  ([k, v]) =>
                      `[${at}] (+${secs}s)   · ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
              )
              .join("\n")
        : "";
    emit(
        { type: "phase_end", id, status, tookMs, extra, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s) PHASE ${id} END — ${status === "ok" ? "✓ OK" : "✗ FAIL"} (${(tookMs / 1000).toFixed(1)}s)` +
            (extraLines ? `\n${extraLines}` : "")
    );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Significant (length > 3) lowercase word tokens, alpha-only. */
const normTokens = (s = "") =>
    new Set(
        String(s)
            .toLowerCase()
            .replace(/[^a-z\s]+/g, " ")
            .split(/\s+/)
            .filter((t) => t.length > 3)
    );

const isSubsetOf = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));

/** Fuzzy-match a free-text chapter name (official-syllabus title, NCERT label,
 * whatever) against the full Maths unit display labels via token overlap —
 * tolerates naming drift ("Coordinate Geometry" vs "Co-ordinate Geometry",
 * "Limit Continuity Differentiability" vs "Limit, Continuity and Differentiability"). */
const chapterLabelFromFuzzy = (text = "") => {
    const tokens = normTokens(text);
    if (!tokens.size) return null;
    for (const label of CHAPTER_LABELS) {
        const labelTokens = normTokens(label);
        if (isSubsetOf(labelTokens, tokens) || isSubsetOf(tokens, labelTokens)) {
            return label;
        }
    }
    return null;
};

/** Best-known chapter for a generated question. Cascades through three
 * signals, most authoritative first:
 *   1. The pipeline's own deterministic-audit match (_verification.matchedSyllabusUnit)
 *   2. NCERT concept/formula-vocabulary inference (inferNcertChaptersFromSlots) —
 *      the same matcher the writer/solver prompts use, so it's the most
 *      reliable for slot labels that don't share words with the chapter title
 *      (e.g. "Adjoint and Inverse identity application" → Matrices and Determinants).
 *   3. Official-syllabus title/content matching as a last resort.
 * Returns one of CHAPTER_LABELS, or null when nothing matches (flagged, not dropped). */
const resolveChapterLabel = (q = {}) => {
    const fromVerification = String(q?._verification?.matchedSyllabusUnit || "").trim();
    if (fromVerification) {
        const hit = chapterLabelFromFuzzy(fromVerification);
        if (hit) return hit;
    }
    const ncertHits = inferNcertChaptersFromSlots([
        {
            label: q?._blueprint?.label || "",
            conceptSlot: q?._conceptSlot || "",
            description: q?.questionText || "",
            blueprint: q?._blueprint?.blueprint,
        },
    ]);
    if (ncertHits[0]?.label) {
        const hit = chapterLabelFromFuzzy(ncertHits[0].label);
        if (hit) return hit;
    }
    const guessSeed = q?._blueprint?.label || q?._conceptSlot || q?.questionText || "";
    const guess = matchOfficialSyllabusUnit(SUBJECT, guessSeed);
    if (guess?.title) {
        const hit = chapterLabelFromFuzzy(guess.title);
        if (hit) return hit;
    }
    return null;
};

const formatQuestionLine = (q, number) => {
    const letters = ["A", "B", "C", "D"];
    const correct =
        q.correctIndex != null ? letters[q.correctIndex] : q.correctAnswer || "?";
    const chapterLabel = resolveChapterLabel(q) || "UNMATCHED";
    const stem = String(q.questionText || "").slice(0, 90).replace(/\s+/g, " ");
    return `Q${number} [${q.questionType || "single"}/${q.difficulty || DIFFICULTY}/${q._conceptSlot || "?"}] chapter=${chapterLabel} ${stem}… → ${correct}`;
};

const formatQuestionBlock = (q, index) => {
    const lines = [];
    const letters = ["A", "B", "C", "D"];
    lines.push(`Question ${index + 1}`);
    lines.push(`Type: ${q.questionType || "single"}`);
    lines.push(`Chapter: ${resolveChapterLabel(q) || "UNMATCHED"}`);
    lines.push(`Stem: ${q.questionText}`);
    (q.options || []).forEach((opt, i) => {
        if (String(opt || "").trim()) lines.push(`  ${letters[i]}. ${opt}`);
    });
    const correct = q.correctIndex != null ? letters[q.correctIndex] : q.correctAnswer || "?";
    lines.push(`Correct: ${correct}`);
    lines.push(`Explanation: ${q.explanation || ""}`);
    lines.push("");
    return lines.join("\n");
};

/** One generation round — tries question_rag first, auto-falls back to
 * default mode on failure/empty result. Each mode gets its own retry-with-
 * backoff loop for transient provider errors (timeouts / aborted requests)
 * so a single flaky call doesn't crash the whole multi-round pipeline. Only
 * throws after every mode × attempt combination is exhausted. */
async function runGenerationRound({
    remaining,
    excludeQuestionTexts,
    presetSteering,
    phaseId,
    preferredMode,
    maxAttemptsPerMode = 3,
}) {
    const modesToTry =
        preferredMode === "default" ? ["default"] : ["question_rag", "default"];
    let lastError = null;
    for (const mode of modesToTry) {
        for (let attempt = 1; attempt <= maxAttemptsPerMode; attempt++) {
            try {
                const result = await generateQuestionBankSuggestions({
                    topic: TOPIC,
                    bankName: BANK_NAME,
                    difficulty: DIFFICULTY,
                    singleCount: remaining,
                    categoryPaths: CATEGORY_PATHS,
                    subject: SUBJECT,
                    generationProvider: GENERATION_PROVIDER,
                    generationMode: mode,
                    excludeQuestionTexts,
                    maxSelectableSlots: remaining,
                    presetSteering: presetSteering || null,
                    deferValidation: false,
                });
                const produced = result?.questions || [];
                if (produced.length) return { result, modeUsed: mode };
                phaseStep(
                    phaseId,
                    `mode=${mode} attempt ${attempt}/${maxAttemptsPerMode} produced 0 questions`
                );
                lastError = null;
                break; // 0 questions isn't an error — move to the next mode, don't burn retries on it.
            } catch (err) {
                lastError = err;
                phaseStep(
                    phaseId,
                    `mode=${mode} attempt ${attempt}/${maxAttemptsPerMode} threw: ${err?.message || err}`
                );
                if (attempt < maxAttemptsPerMode) {
                    const wait = 5000 * attempt;
                    phaseStep(phaseId, `Retrying in ${(wait / 1000).toFixed(0)}s…`);
                    await sleep(wait);
                }
            }
        }
    }
    if (lastError) throw lastError;
    return {
        result: { questions: [], pipelineSummary: {}, blueprintCoverage: {} },
        modeUsed: modesToTry.at(-1),
    };
}

async function connectMongo() {
    if (String(process.env.MONGODB_URI || "").startsWith("mongodb+srv://")) {
        dns.setServers(["8.8.8.8", "1.1.1.1"]);
    }
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function main() {
    console.log(`\n=== JEE Main Hard Mathematics — Curated Chapter Generation ===`);
    console.log(`Chapters : ${CHAPTER_LABELS.join(" | ")}`);
    console.log(`Count    : ${REQUESTED_COUNT} (${DIFFICULTY})`);
    console.log(`Providers: generation=${GENERATION_PROVIDER} evaluation=${EVALUATION_PROVIDER} verify-model=${VERIFY_MODEL} solver-timeout=${SOLVER_TIMEOUT_MS}ms fallback=${FALLBACK_MODEL}\n`);

    // Phase 0 — Connect MongoDB ------------------------------------------------
    phaseStart("0", "Connect MongoDB", [
        "Required for RAG exemplar lookup and question-bank reads",
        `URI dbName=${process.env.DB_NAME}`,
    ]);
    phaseStep("0", "Opening mongoose connection…");
    await connectMongo();
    phaseEnd("0", "ok", { message: "MongoDB connected" });

    phaseStep(
        "0",
        `NCERT chapter reference ${isNcertChapterReferenceAvailable() ? "loaded" : "MISSING"} — chapters: ${listNcertChapterLabels().join(", ") || "none"}`
    );
    phaseStep(
        "0",
        `Official JEE syllabus reference ${isJeeMainOfficialSyllabusAvailable() ? "loaded" : "MISSING"}`
    );

    let allQuestions = [];
    let planResult = null;
    let evaluation = null;
    let evaluationFailed = false;
    let evaluationError = null;

    try {
        // Phase 1 — Plan topics (chapter lock) ---------------------------------
        phaseStart("1", "Plan Mathematics topics — all 14 units (concentrated hard)", [
            `Ask planner for ${REQUESTED_COUNT} hard JEE Main Mathematics topic slots`,
            `Units in scope: ${CHAPTER_LABELS.join(", ")}`,
            "Builds archetype steering (FORCE_ALL_MULTI + hard_archetypes from NCERT ref)",
            `adminExcludeTopics: ${EXCLUDED_TOPICS.length} non-math unit(s) excluded`,
            "No questions authored in this phase",
        ]);
        phaseStep("1", "Calling planQuestionBankTopics (with adminExcludeTopics chapter lock)…");
        const planStarted = Date.now();
        planResult = await planQuestionBankTopics({
            topic: TOPIC,
            bankName: BANK_NAME,
            difficulty: DIFFICULTY,
            singleCount: REQUESTED_COUNT,
            categoryPaths: CATEGORY_PATHS,
            subject: SUBJECT,
            generationProvider: GENERATION_PROVIDER,
            adminExcludeTopics: EXCLUDED_TOPICS,
        });
        phaseStep("1", `Planner returned in ${((Date.now() - planStarted) / 1000).toFixed(1)}s`);
        const slots = planResult?.steering?.slotPlans || [];
        phaseStep("1", `Source=${planResult?.steering?.source || "?"} · slots=${slots.length} · model-reported-excluded=${(planResult?.excludedTopics || []).length}`);
        slots.forEach((slot, i) => {
            const ncertHits = inferNcertChaptersFromSlots([slot]);
            const chapterLabel =
                (ncertHits[0]?.label && chapterLabelFromFuzzy(ncertHits[0].label)) ||
                (matchOfficialSyllabusUnit(SUBJECT, slot.label || slot.conceptSlot || "")?.title &&
                    chapterLabelFromFuzzy(
                        matchOfficialSyllabusUnit(SUBJECT, slot.label || slot.conceptSlot || "").title
                    )) ||
                "UNMATCHED";
            phaseStep(
                "1",
                `Slot ${String(i + 1).padStart(2, " ")} [${slot.questionKind || "?"}] chapter=${chapterLabel} ${slot.label || slot.conceptSlot}`
            );
        });
        if (planResult?.excludedTopics?.length) {
            phaseStep("1", `Planner's own reported exclusions (${planResult.excludedTopics.length}):`);
            planResult.excludedTopics.forEach((t) =>
                phaseStep("1", `  ✗ ${typeof t === "string" ? t : t?.label || JSON.stringify(t)}`)
            );
        }
        phaseEnd("1", "ok", {
            slots: slots.length,
            adminExcluded: EXCLUDED_TOPICS.length,
            source: planResult?.steering?.source,
        });

        // Phase 2 — Generate (full pipeline, chapter-locked, round loop) ------
        phaseStart("2", "Generate Mathematics questions (full pipeline, chapter-locked)", [
            `Target ${REQUESTED_COUNT} hard single-correct MCQs — Mathematics, all 14 units (concentrated hard)`,
            "Prefer generationMode=question_rag (exemplar-grounded)",
            "On RAG failure/empty → auto-switch to generationMode=default",
            "Each round runs full finalize: blueprint → audit → independent-solver (GPT-5) → sympy → explanation → count guarantee",
            `Max rounds: ${MAX_ROUNDS}`,
        ]);

        let excludeQuestionTexts = [];
        let mode = "question_rag";
        let round = 0;
        while (allQuestions.length < REQUESTED_COUNT && round < MAX_ROUNDS) {
            round += 1;
            const remaining = REQUESTED_COUNT - allQuestions.length;
            const useSteering = round === 1;
            phaseStep(
                "2",
                `ROUND ${round}/${MAX_ROUNDS} — request ${remaining} · have ${allQuestions.length}/${REQUESTED_COUNT} · mode=${mode}`
            );
            phaseStep(
                "2",
                `Intent=initial · excludeStems=${excludeQuestionTexts.length} · steering=${useSteering ? "yes" : "no"} · chapterLock=on`
            );
            phaseStep("2", "Calling generateQuestionBankSuggestions (deferValidation=false, chapterLock via adminExcludeTopics-derived plan)…");

            const roundStarted = Date.now();
            let result;
            try {
                ({ result, modeUsed: mode } = await runGenerationRound({
                    remaining,
                    excludeQuestionTexts,
                    presetSteering: useSteering ? planResult.steering : null,
                    phaseId: "2",
                    preferredMode: mode,
                }));
            } catch (err) {
                phaseStep(
                    "2",
                    `Round ${round} FAILED after exhausting retries: ${err?.message || err} — stopping generation with ${allQuestions.length}/${REQUESTED_COUNT} so far (never silently dropping what was already produced)`
                );
                break;
            }

            const produced = result?.questions || [];
            const singleProduced = produced.filter((q) => (q.questionType || "single") === "single").length;
            phaseStep(
                "2",
                `Round ${round} done in ${((Date.now() - roundStarted) / 1000).toFixed(1)}s — produced ${produced.length} (single=${singleProduced} multiple=${produced.length - singleProduced})`
            );
            const ps = result?.pipelineSummary || {};
            phaseStep(
                "2",
                `Finalize stats: correctness=${ps.correctnessScore ?? "?"} style=${ps.styleScore ?? "?"} stripped=${ps.strippedCount ?? 0} output=${ps.outputCount ?? produced.length}`
            );
            if (ps.verification) {
                phaseStep(
                    "2",
                    `Verification: passed=${ps.verification.passed ?? 0} fixed=${ps.verification.fixed ?? 0} regenerated=${ps.verification.regenerated ?? 0} stripped=${ps.verification.stripped ?? 0}`
                );
            }
            phaseStep("2", `Count guarantee: targetSingle=${remaining} overflowMax=${process.env.AI_QB_COUNT_OVERFLOW_MAX || 3}`);
            const bc = result?.blueprintCoverage || {};
            phaseStep("2", `Blueprint coverage: ok=${bc.ok ?? "?"} expected=${bc.expectedCount ?? "?"} generated=${bc.generatedCount ?? produced.length}`);

            produced.forEach((q, i) => {
                phaseStep("2", formatQuestionLine(q, allQuestions.length + i + 1));
                if (q.questionText) excludeQuestionTexts.push(q.questionText);
            });
            allQuestions.push(...produced);
            phaseStep("2", `Running total: ${allQuestions.length}/${REQUESTED_COUNT}`);
        }

        phaseEnd("2", allQuestions.length >= REQUESTED_COUNT ? "ok" : "partial", {
            produced: allQuestions.length,
            target: REQUESTED_COUNT,
            generationMode: mode,
            rounds: round,
        });

        // Phase 3 — Evaluate quality ------------------------------------------
        phaseStart("3", "Evaluate quality", [
            `Provider=${EVALUATION_PROVIDER}`,
            "Scores: overall / topicRelevance / correctness / difficultyMatch / style",
            `Pass threshold overall ≥ ${TOPIC_RELEVANCE_PASS_SCORE}`,
            "Subject scope: Mathematics, all 14 official JEE Main units (concentrated hard)",
        ]);
        for (let attempt = 1; attempt <= MAX_EVAL_ATTEMPTS; attempt++) {
            phaseStep("3", `Evaluating ${allQuestions.length} question(s)… (attempt ${attempt}/${MAX_EVAL_ATTEMPTS})`);
            try {
                const t0 = Date.now();
                evaluation = await validateQuestionTopicRelevance({
                    topic: TOPIC,
                    bankName: BANK_NAME,
                    subject: SUBJECT,
                    difficulty: DIFFICULTY,
                    questions: allQuestions,
                    evaluationProvider: EVALUATION_PROVIDER,
                    categoryPaths: CATEGORY_PATHS,
                    singleCount: allQuestions.length,
                });
                phaseStep("3", `Evaluation finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
                break;
            } catch (err) {
                evaluationError = err?.message || String(err);
                phaseStep("3", `Evaluation attempt ${attempt} failed: ${evaluationError}`);
                if (attempt < MAX_EVAL_ATTEMPTS) await sleep(3000 * attempt);
            }
        }
        if (!evaluation) {
            evaluationFailed = true;
            phaseEnd("3", "error", { evaluationError });
        } else {
            phaseStep(
                "3",
                `Scores → overall=${evaluation.overallScore} topic=${evaluation.topicRelevanceScore} correctness=${evaluation.correctnessScore} difficulty=${evaluation.difficultyMatchScore} style=${evaluation.styleScore}`
            );
            phaseStep("3", `Verdict: ${evaluation.verdict}`);
            phaseStep("3", `Confirmed issues: ${evaluation.confirmedIssues?.length || 0}`);
            (evaluation.confirmedIssues || []).slice(0, 25).forEach((issue) => {
                phaseStep(
                    "3",
                    `Issue Q${issue.questionNumber} [${issue.category || issue.type || "issue"}] ${issue.issue || issue.description || ""}`
                );
            });
            phaseEnd("3", "ok", {
                overallScore: evaluation.overallScore,
                issueCount: evaluation.confirmedIssues?.length || 0,
                pass: evaluation.overallScore >= TOPIC_RELEVANCE_PASS_SCORE,
            });
        }

        // Phase 4 — Regenerate failed questions (targeted, evaluation_regen) --
        phaseStart("4", "Regenerate failed questions", [
            "Only runs when overallScore is below the pass threshold",
            "Targets exactly the flagged question numbers via generateIntent=evaluation_regen",
        ]);
        const needsRegen =
            evaluation &&
            evaluation.overallScore < TOPIC_RELEVANCE_PASS_SCORE &&
            Array.isArray(evaluation.flawedQuestionNumbers) &&
            evaluation.flawedQuestionNumbers.length > 0;
        if (!needsRegen) {
            phaseStep("4", "Skipped — score OK or no confirmed issues");
            phaseEnd("4", "ok", {
                skipped: true,
                evaluationFailed,
                overallScore: evaluation?.overallScore ?? null,
            });
        } else {
            const flawed = evaluation.flawedQuestionNumbers;
            phaseStep("4", `Attempting targeted regeneration for ${flawed.length} flagged question(s): ${flawed.join(", ")}`);
            try {
                const regenResult = await generateQuestionBankSuggestions({
                    topic: TOPIC,
                    bankName: BANK_NAME,
                    difficulty: DIFFICULTY,
                    singleCount: flawed.length,
                    categoryPaths: CATEGORY_PATHS,
                    subject: SUBJECT,
                    generationProvider: GENERATION_PROVIDER,
                    generationMode: mode,
                    generateIntent: GENERATE_INTENTS.EVALUATION_REGEN,
                    topicRelevanceEvaluated: true,
                    topicRelevanceRegenerated: false,
                    topicRelevanceFeedback: evaluation,
                    excludeQuestionTexts,
                    maxSelectableSlots: flawed.length,
                    deferValidation: false,
                });
                const replacements = regenResult?.questions || [];
                let replaced = 0;
                flawed.forEach((num, idx) => {
                    if (replacements[idx] && allQuestions[num - 1]) {
                        allQuestions[num - 1] = replacements[idx];
                        replaced += 1;
                    }
                });
                phaseStep("4", `Replaced ${replaced}/${flawed.length} flagged question(s)`);
                phaseEnd("4", "ok", { attempted: flawed.length, replaced });
            } catch (err) {
                phaseStep("4", `Regeneration failed: ${err?.message || err} — keeping original questions`);
                phaseEnd("4", "error", { attempted: flawed.length, replaced: 0 });
            }
        }

        // Phase 4b — Count top-up ----------------------------------------------
        phaseStart("4b", "Count top-up to requested total", [
            "Runs additional generation rounds only if the count dropped below target",
        ]);
        if (allQuestions.length >= REQUESTED_COUNT) {
            phaseStep("4b", `Skipped — already at ${allQuestions.length}/${REQUESTED_COUNT}`);
            phaseEnd("4b", "ok", { skipped: true, finalCount: allQuestions.length });
        } else {
            let topUpRound = 0;
            const excludeQuestionTextsTopUp = allQuestions.map((q) => q.questionText).filter(Boolean);
            while (allQuestions.length < REQUESTED_COUNT && topUpRound < MAX_ROUNDS) {
                topUpRound += 1;
                const remaining = REQUESTED_COUNT - allQuestions.length;
                phaseStep("4b", `TOP-UP ROUND ${topUpRound} — request ${remaining} · have ${allQuestions.length}/${REQUESTED_COUNT}`);
                let result;
                try {
                    ({ result, modeUsed: mode } = await runGenerationRound({
                        remaining,
                        excludeQuestionTexts: excludeQuestionTextsTopUp,
                        presetSteering: null,
                        phaseId: "4b",
                        preferredMode: mode,
                    }));
                } catch (err) {
                    phaseStep("4b", `Top-up round ${topUpRound} FAILED after exhausting retries: ${err?.message || err} — stopping top-up with ${allQuestions.length}/${REQUESTED_COUNT}`);
                    break;
                }
                const produced = result?.questions || [];
                produced.forEach((q, i) => {
                    phaseStep("4b", formatQuestionLine(q, allQuestions.length + i + 1));
                    if (q.questionText) excludeQuestionTextsTopUp.push(q.questionText);
                });
                allQuestions.push(...produced);
                if (!produced.length) break;
            }
            phaseEnd("4b", allQuestions.length >= REQUESTED_COUNT ? "ok" : "partial", {
                finalCount: allQuestions.length,
            });
        }

        // Phase 5 — Chapter-distribution audit ----------------------------------
        phaseStart("5", "Chapter-distribution audit", [
            "Verifies every final question maps to one of the 14 official Mathematics units",
            "Flags (never silently drops) anything unmatched — for manual review",
        ]);
        const distribution = Object.fromEntries(CHAPTER_LABELS.map((l) => [l, 0]));
        const unmatchedStems = [];
        allQuestions.forEach((q) => {
            const label = resolveChapterLabel(q);
            if (label) {
                distribution[label] += 1;
            } else {
                unmatchedStems.push(String(q.questionText || "").slice(0, 140));
            }
        });
        Object.entries(distribution).forEach(([label, count]) =>
            phaseStep("5", `  ${label}: ${count} question(s)`)
        );
        const restrictionHeld = unmatchedStems.length === 0;
        if (restrictionHeld) {
            phaseStep("5", "→ ✓ All questions resolve cleanly to one of the 14 official units");
        } else {
            phaseStep("5", `→ ✗ ${unmatchedStems.length} question(s) did NOT match a locked chapter — flagged, not dropped`);
            unmatchedStems.forEach((s) => phaseStep("5", `  ⚠ ${s}…`));
        }
        const chapterAudit = {
            totalQuestions: allQuestions.length,
            distribution,
            unmatchedCount: unmatchedStems.length,
            unmatchedStems,
            restrictionHeld,
        };
        phaseEnd("5", "ok", { distribution, unmatchedCount: unmatchedStems.length, restrictionHeld });

        // Phase 6 — Save artifacts ----------------------------------------------
        phaseStart("6", "Save artifacts", [
            `Writing files into temp/jee-main-${DIFFICULTY}-${REQUESTED_COUNT}-curated-maths/<timestamp>`,
            "questions.txt / questions.json / evaluation.json / topic-plan.json / chapter-audit.json / summary.json / transcript.txt / phases.jsonl",
        ]);
        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .replace("T", "_")
            .slice(0, 19);
        const runFolder = `jee-main-${DIFFICULTY}-${REQUESTED_COUNT}-curated-maths`;
        const outDir = join(ROOT_DIR, "temp", runFolder, timestamp);
        mkdirSync(outDir, { recursive: true });

        const files = {
            transcript: join(outDir, "transcript.txt"),
            phasesJsonl: join(outDir, "phases.jsonl"),
            questionsTxt: join(outDir, "questions.txt"),
            questionsJson: join(outDir, "questions.json"),
            evaluationJson: join(outDir, "evaluation.json"),
            topicPlanJson: join(outDir, "topic-plan.json"),
            chapterAuditJson: join(outDir, "chapter-audit.json"),
            summaryJson: join(outDir, "summary.json"),
        };

        phaseStep("6", "Writing questions.txt + questions.json + chapter-audit.json…");
        const header = [
            "JEE Main — Hard Mathematics (Curated Chapters) — AI Generated Questions",
            "=".repeat(74),
            `Chapters: ${CHAPTER_LABELS.join(", ")}`,
            `Difficulty: ${DIFFICULTY}`,
            `Count: ${allQuestions.length} single-answer MCQs`,
            `Generation provider: ${GENERATION_PROVIDER} · Evaluation provider: ${EVALUATION_PROVIDER} · Verify model: ${VERIFY_MODEL}`,
            `Generated: ${new Date().toISOString()}`,
            `Elapsed: ${(elapsed() / 1000).toFixed(1)}s`,
            "",
        ].join("\n");
        const body = allQuestions.map((q, i) => formatQuestionBlock(q, i)).join("\n");
        writeFileSync(files.questionsTxt, header + body, "utf8");
        writeFileSync(files.questionsJson, JSON.stringify(allQuestions, null, 2), "utf8");
        writeFileSync(files.chapterAuditJson, JSON.stringify(chapterAudit, null, 2), "utf8");
        writeFileSync(files.topicPlanJson, JSON.stringify(planResult, null, 2), "utf8");
        writeFileSync(
            files.evaluationJson,
            JSON.stringify(evaluation || { evaluationFailed: true, evaluationError }, null, 2),
            "utf8"
        );
        phaseStep("6", "Primary artifacts written");

        phaseStep("6", "Also writing confirmed-questions log…");
        try {
            const logPath = await logConfirmedQuestionsToFile({
                topic: TOPIC,
                bankName: BANK_NAME,
                questions: allQuestions,
            });
            phaseStep("6", `Confirmed-questions log: ${JSON.stringify(logPath)}`);
        } catch (err) {
            phaseStep("6", `Confirmed-questions log skipped: ${err?.message || err}`);
        }

        const summary = {
            success: allQuestions.length >= REQUESTED_COUNT && restrictionHeld,
            exam: "jee_main",
            difficulty: DIFFICULTY,
            subject: SUBJECT,
            restrictToChapters: CHAPTER_LABELS,
            requestedCount: REQUESTED_COUNT,
            finalCount: allQuestions.length,
            topic: TOPIC,
            generationProvider: GENERATION_PROVIDER,
            evaluationProvider: EVALUATION_PROVIDER,
            verifyModel: VERIFY_MODEL,
            solverTimeoutMs: SOLVER_TIMEOUT_MS,
            solverFallbackModel: FALLBACK_MODEL,
            generationMode: mode,
            evaluationFailed,
            evaluationError,
            overallScore: evaluation?.overallScore ?? null,
            correctnessScore: evaluation?.correctnessScore ?? null,
            difficultyMatchScore: evaluation?.difficultyMatchScore ?? null,
            types: {
                single: allQuestions.filter((q) => (q.questionType || "single") === "single").length,
                multiple: allQuestions.filter((q) => q.questionType === "multiple").length,
                true_false: allQuestions.filter((q) => q.questionType === "true_false").length,
            },
            conceptSlots: allQuestions.map((q) => q._conceptSlot).filter(Boolean),
            chapterAudit,
            elapsedMs: elapsed(),
            outDir,
            files,
        };
        writeFileSync(files.summaryJson, JSON.stringify(summary, null, 2), "utf8");
        writeFileSync(files.transcript, transcriptLines.join("\n\n"), "utf8");
        writeFileSync(files.phasesJsonl, jsonlLines.join("\n") + "\n", "utf8");
        phaseEnd("6", "ok", { folder: outDir, finalCount: allQuestions.length, elapsedMs: elapsed() });

        console.log(`\n${RULE}`);
        console.log("PIPELINE COMPLETE");
        console.log(RULE);
        console.log(`Result : ${allQuestions.length}/${REQUESTED_COUNT} hard JEE Main Mathematics question(s) — all units concentrated hard`);
        console.log(`Mode   : ${mode}`);
        console.log(`Score  : overall=${evaluation?.overallScore ?? "n/a"}`);
        console.log(`Chapter lock: ${restrictionHeld ? "HELD ✓ (all questions matched)" : `BROKEN ✗ (${unmatchedStems.length} unmatched)`}`);
        console.log(`Folder : ${outDir}`);
        console.log(`Elapsed: ${(elapsed() / 1000).toFixed(1)}s\n`);

        return summary;
    } finally {
        await mongoose.disconnect().catch(() => {});
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("\nPIPELINE FAILED:", err?.stack || err);
        try {
            const outDir = join(ROOT_DIR, "temp", "jee-main-hard-curated-maths-FAILED-" + Date.now());
            mkdirSync(outDir, { recursive: true });
            writeFileSync(join(outDir, "transcript.txt"), transcriptLines.join("\n\n"), "utf8");
            writeFileSync(join(outDir, "phases.jsonl"), jsonlLines.join("\n") + "\n", "utf8");
            console.error(`Partial logs saved to ${outDir}`);
        } catch {
            /* best effort */
        }
        process.exit(1);
    });
