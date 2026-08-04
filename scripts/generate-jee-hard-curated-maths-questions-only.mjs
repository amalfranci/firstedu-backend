/**
 * JEE Main — Hard Mathematics, STAGE A only (+ dual-solver answer lock).
 *
 * GOLDEN STAGE (default) matches paper-quality reference run:
 *   temp/jee-main-hard-10-curated-maths-questions-only/2026-08-01_11-25-30
 *   (earlier lock probe: 2026-08-01_08-16-14)
 *   - 5 curated chapters (Coord Geo, LCD, Integrals, Matrices, DE)
 *   - gemini-3.5-flash generation
 *   - o4-mini + o3-mini dual independent solvers (drop if disagree)
 *   - curatedMathSlotsOnly — no swap into probability / off-lock fluff
 *   - distractor pass OFF (preserve clean exam-style options)
 *   - deferValidation=true (no Stage B full finalize)
 *
 * Stage A pipeline:
 *   plan → archetype steering → blueprint → skeleton → key realign
 *   → hard mandate / difficulty audit → dual-solver answer lock
 *
 * Stage B (only in generate-jee-hard-curated-maths.mjs):
 *   quality eval, sympy strip, multi-round regen, difficulty re-judge
 *
 * Usage:
 *   node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10
 *   node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10 --provider=gemini --gemini-model=gemini-3.5-flash
 *   node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10 --all-units
 *   node scripts/generate-jee-hard-curated-maths-questions-only.mjs --count=10 --keep-unverified
 *
 * Output: temp/jee-main-hard-<count>-curated-maths-questions-only/<timestamp>/
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
// Default gemini; use --provider=openai when Gemini credits are depleted.
const GENERATION_PROVIDER = String(
    argv.provider || process.env.JEE_GEN_PROVIDER || "gemini"
)
    .trim()
    .toLowerCase();

// Same headroom fix as the full pipeline script — the solve-first skeleton
// call for a "hard" JEE chunk can legitimately run long, and the .env default
// (30s / 2 attempts) was tripping "This operation was aborted" under load.
// Stronger hard models (3.5-flash / 2.5-flash) need more timeout than lite.
process.env.GEMINI_REQUEST_TIMEOUT_MS = String(
    argv["gemini-timeout-ms"] || process.env.JEE_GEN_GEMINI_TIMEOUT_MS || 120000
);
process.env.GEMINI_QB_MAX_ATTEMPTS = String(
    process.env.JEE_GEN_GEMINI_MAX_ATTEMPTS || 3
);

// ---------------------------------------------------------------------------
// GOLDEN STAGE lock — match 2026-08-01_11-25-30 paper quality
// (script overrides beat loose .env defaults that degrade slot fidelity)
// ---------------------------------------------------------------------------
// Stage A accuracy stack:
// 1) Hard-tier Gemini (not flash-lite) for generation
// 2) Independent dual OpenAI solvers lock the answer key
// 3) Curated chapter/slot lock — no probability / off-lock swaps
// 4) Drop items solvers could not dual-agree (unless --keep-unverified)
process.env.GEMINI_HARD_TEXT_MODEL = String(
    argv["gemini-model"] ||
        process.env.JEE_GEN_GEMINI_HARD_MODEL ||
        process.env.GEMINI_HARD_TEXT_MODEL ||
        "gemini-3.5-flash"
).trim();

// Lean Stage A path (same as 11-25-30 questions-only run)
process.env.AI_QB_DEFER_VALIDATION = "1";
process.env.EXAM_REFERENCE_RESEARCH_ENABLED =
    process.env.EXAM_REFERENCE_RESEARCH_ENABLED || "0";
process.env.AI_QB_DIFFICULTY_CALIBRATION =
    process.env.AI_QB_DIFFICULTY_CALIBRATION || "0";
// Distractor rewrite pass degrades clean JEE options (decimals / unit mix) —
// keep OFF for this paper-quality stage.
process.env.AI_QB_DISTRACTOR_PASS =
    argv["distractor-pass"] === "1" || argv["distractor-pass"] === true
        ? "1"
        : "0";
// Critical: prevent ARCHETYPE_SWAPPED into probability / off-lock fluff
// (missing this was the main quality regression vs 11-25-30).
process.env.AI_QB_CURATED_MATH_SLOTS_ONLY =
    argv["all-units"] || process.env.JEE_GEN_ALL_UNITS === "1"
        ? process.env.AI_QB_CURATED_MATH_SLOTS_ONLY || "0"
        : "1";

process.env.AI_QB_STAGE_A_ANSWER_LOCK = "1";
if (argv["keep-unverified"] || argv.keepUnverified) {
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "0";
} else {
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "1";
}
// Solver model for Stage A answer lock (same family as full-pipeline verify)
const VERIFY_MODEL = String(
    argv["verify-model"] || process.env.JEE_GEN_VERIFY_MODEL || process.env.OPENAI_SOLVER_MODEL || "o4-mini"
).trim();
process.env.AI_QB_SOLVER_PROVIDER = "openai";
process.env.AI_QB_SOLVER_PROVIDER_B = "openai";
process.env.OPENAI_SOLVER_MODEL = VERIFY_MODEL;
// Secondary MUST differ from primary (dual independence). Never keep both as o4-mini.
const rawSecondary = String(
    argv["verify-model-b"] ||
        process.env.JEE_GEN_VERIFY_MODEL_B ||
        process.env.OPENAI_SOLVER_FALLBACK_MODEL ||
        "o3-mini"
).trim();
const SECONDARY_SOLVER =
    rawSecondary && rawSecondary !== VERIFY_MODEL
        ? rawSecondary
        : VERIFY_MODEL === "o4-mini"
          ? "o3-mini"
          : "o4-mini";
process.env.OPENAI_SOLVER_MODEL_B = SECONDARY_SOLVER;
process.env.OPENAI_SOLVER_TIMEOUT_MS = String(
    argv["solver-timeout-ms"] || process.env.JEE_GEN_SOLVER_TIMEOUT_MS || 60000
);
process.env.AI_QB_SOLVER_TRUTH = "1";
process.env.AI_QB_BLIND_SOLVER = "1";
// Hardness stack — never skip difficulty judge; force multi-concept-heavy plan
process.env.AI_QB_DIFFICULTY_SELF_AUDIT = "1";
process.env.AI_QB_HARD_MULTI_HEAVY = "1";
process.env.AI_QB_FORCE_ALL_MULTI =
    argv["all-multi"] === "0" || argv["all-multi"] === false
        ? "0"
        : "1";
process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN = String(
    argv["min-difficulty"] ||
        process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN ||
        80
);
// Do NOT dump weak skeletons at last attempt (old floor 55 admitted non-paper items).
// Keep near mid-run relax floor so quality matches 11-25-30 survivors.
process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR = String(
    argv["last-attempt-floor"] ||
        process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR ||
        72
);
process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR = String(
    process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR || 72
);
process.env.AI_QB_VETERAN_DIFFICULTY = "1";

// ── 100% answer-correctness mode (default ON for this script) ──
// Dual independent solvers must agree; disagreement / low confidence → DROP.
// Never ship generator-only keys. Yield may be < requested count — intentional.
const STRICT_CORRECT =
    argv["strict-correct"] !== "0" &&
    argv["strict-correct"] !== false &&
    process.env.AI_QB_STRICT_ANSWER_CORRECTNESS !== "0";
if (STRICT_CORRECT) {
    process.env.AI_QB_STRICT_ANSWER_CORRECTNESS = "1";
    process.env.AI_QB_DOUBLE_SOLVE = "1";
    process.env.AI_QB_DOUBLE_SOLVE_HARD_MATH_ONLY = "1";
    process.env.AI_QB_REQUIRE_DOUBLE_SOLVE = "1";
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "1";
    process.env.AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE = "1";
    process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR = String(
        process.env.AI_QB_STRICT_ANSWER_CONFIDENCE_FLOOR ||
            process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR ||
            "0.9"
    );
    process.env.AI_QB_STRICT_ANSWER_CONFIDENCE_FLOOR =
        process.env.AI_QB_ANSWER_CONFIDENCE_FLOOR;
    // Keep secondary different from primary (already set above).
    process.env.OPENAI_SOLVER_MODEL_B = SECONDARY_SOLVER;
    process.env.AI_QB_SOLVER_KEEP_PRIMARY_ON_DISAGREE = "0";
}

// This script's 2 chunks (5+5) run in parallel via Promise.all inside
// generateQuestionBankSuggestions — if EITHER chunk throws (e.g. a transient
// "This operation was aborted" Gemini timeout), the whole call rejects, even
// when the other chunk already built its 5 questions successfully. Observed
// live: chunk 2/2 finished (BATCH_DONE outputCount: 5) while chunk 1/2 was
// still aborting, and the single unguarded call below turned that into a
// total 0/10 result. The full pipeline script has a per-round retry loop
// (runGenerationRound) for exactly this; this script gets a simpler
// whole-call retry since it only ever makes ONE generation call.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_GENERATION_RETRIES = Number(
    argv["max-retries"] || process.env.JEE_GEN_MAX_RETRIES || 3
);

const { planQuestionBankTopics, generateQuestionBankSuggestions } = await import(
    "../src/services/aiQuestion.service.js"
);
const { getOfficialSyllabusUnits, matchOfficialSyllabusUnit } = await import(
    "../src/services/jeeMainOfficialSyllabus.service.js"
);
const {
    isNcertChapterReferenceAvailable,
    listNcertChapterLabels,
    inferNcertChaptersFromSlots,
} = await import("../src/services/ncertChapterReference.service.js");

// ---------------------------------------------------------------------------
// GOLDEN STAGE (paper quality: 2026-08-01_11-25-30):
//   Stage A + dual answer lock · gemini-3.5-flash · o4-mini + o3-mini
//   5 curated hard chapters only (default). Use --all-units for full 14.
//   curatedMathSlotsOnly=1 · distractor pass OFF · last-attempt floor 72
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
/** Default lock = same 5 as 08-16-14 golden run (high accuracy dual-lock). */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const normTokens = (s = "") =>
    new Set(
        String(s)
            .toLowerCase()
            .replace(/[^a-z\s]+/g, " ")
            .split(/\s+/)
            .filter((t) => t.length > 3)
    );

const isSubsetOf = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));

const chapterLabelFromFuzzy = (text = "") => {
    const tokens = normTokens(text);
    if (!tokens.size) return null;
    for (const label of CHAPTER_LABELS) {
        const labelTokens = normTokens(label);
        if (isSubsetOf(labelTokens, tokens) || isSubsetOf(tokens, labelTokens)) {
            return label;
        }
    }
    // Also match against full official labels (for off-lock slots like probability).
    const ALL_LABELS = Object.values(DISPLAY_LABEL);
    for (const label of ALL_LABELS) {
        const labelTokens = normTokens(label);
        if (isSubsetOf(labelTokens, tokens) || isSubsetOf(tokens, labelTokens)) {
            return label;
        }
    }
    return null;
};

/** Concept-slot / stem keyword → official chapter (fixes UNMATCHED). */
const SLOT_CHAPTER_RULES = [
    { re: /area_bounded|definite_integral|piecewise_definite|integrat/i, ch: "Integral Calculus" },
    { re: /differential_equation|linear_first_order|integrating.?factor|de_/i, ch: "Differential Equations" },
    { re: /circle|chord|parabola|locus|coordinate|tangent|power_of_point/i, ch: "Co-ordinate Geometry" },
    { re: /limit|series_limit|continuity|differentiab|implicit|maxima|minima|derivative|piecewise_continuity/i, ch: "Limit, Continuity and Differentiability" },
    { re: /matrix|determinant|adjoint|consistency/i, ch: "Matrices and Determinants" },
    { re: /probability|bayes|permutation|combination|binomial_coeff/i, ch: "Statistics and Probability" },
    { re: /trigonometr|heron|triangle|sin|cos/i, ch: "Trigonometry" },
    { re: /vector|triple.?product/i, ch: "Vector Algebra" },
    { re: /complex|argand|modulus/i, ch: "Complex Numbers and Quadratic Equations" },
];

const resolveChapterLabel = (q = {}) => {
    if (q.chapterLabel || q._chapter || q.chapter) {
        return String(q.chapterLabel || q._chapter || q.chapter);
    }
    const slot = String(q?._conceptSlot || q?._blueprint?.conceptSlot || "");
    const stem = String(q?.questionText || "");
    const label = String(q?._blueprint?.label || "");
    const hay = `${slot} ${label} ${stem}`;

    for (const rule of SLOT_CHAPTER_RULES) {
        if (rule.re.test(hay)) return rule.ch;
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
        // NCERT keyToLabel may not match curated fuzzy — use label as-is if Maths unit.
        const raw = ncertHits[0].label;
        if (raw) return raw;
    }
    const guessSeed = q?._blueprint?.label || q?._conceptSlot || q?.questionText || "";
    const guess = matchOfficialSyllabusUnit(SUBJECT, guessSeed);
    if (guess?.title) {
        const hit = chapterLabelFromFuzzy(guess.title);
        if (hit) return hit;
        return toTitleCase(guess.title);
    }
    return null;
};

/** Persist resolved chapter on each question before save. */
const attachChapterLabels = (questions = []) =>
    questions.map((q) => {
        const ch = resolveChapterLabel(q) || "UNMATCHED";
        return {
            ...q,
            chapter: ch,
            _chapter: ch,
            chapterLabel: ch,
        };
    });

const formatQuestionLine = (q, number) => {
    const letters = ["A", "B", "C", "D"];
    const correct =
        q.correctIndex != null ? letters[q.correctIndex] : q.correctAnswer || "?";
    const chapterLabel = resolveChapterLabel(q) || "UNMATCHED";
    const stem = String(q.questionText || "").slice(0, 90).replace(/\s+/g, " ");
    const lockTag =
        q._answerCorrectnessGuaranteed || q._doubleSolverAgree
            ? "DUAL-VERIFIED correct"
            : q._stageAAnswerLocked || q._solverTruthApplied
              ? "stage-A-locked (single)"
              : q._answerProvisional
                ? "provisional/unverified"
                : "unknown";
    return `Q${number} [${q.questionType || "single"}/${q.difficulty || DIFFICULTY}/${q._conceptSlot || "?"}] chapter=${chapterLabel} ${stem}… → ${correct} (${lockTag})`;
};

const formatQuestionBlock = (q, index) => {
    const lines = [];
    const letters = ["A", "B", "C", "D"];
    lines.push(`Question ${index + 1}`);
    lines.push(`Type: ${q.questionType || "single"}`);
    lines.push(`Chapter: ${resolveChapterLabel(q) || "UNMATCHED"}`);
    lines.push(`ConceptSlot: ${q._conceptSlot || "?"}`);
    lines.push(`Stem: ${q.questionText}`);
    (q.options || []).forEach((opt, i) => {
        if (String(opt || "").trim()) lines.push(`  ${letters[i]}. ${opt}`);
    });
    const correct = q.correctIndex != null ? letters[q.correctIndex] : q.correctAnswer || "?";
    const lockTag =
        q._answerCorrectnessGuaranteed || q._doubleSolverAgree
            ? "DUAL independent solvers AGREE — answer locked"
            : q._stageAAnswerLocked || q._solverTruthApplied
              ? "stage-A answer lock (single solver)"
              : "generator-claimed / provisional";
    lines.push(`Correct (${lockTag}): ${correct}`);
    lines.push(`Explanation: ${q.explanation || ""}`);
    lines.push("");
    return lines.join("\n");
};

async function connectMongo() {
    if (String(process.env.MONGODB_URI || "").startsWith("mongodb+srv://")) {
        dns.setServers(["8.8.8.8", "1.1.1.1"]);
    }
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
}

// ---------------------------------------------------------------------------
// Main — single stage-A generation call, then stop.
// ---------------------------------------------------------------------------
async function main() {
    console.log(`\n=== JEE Main Hard Mathematics — STAGE A + STRICT ANSWER CORRECTNESS ===`);
    console.log(
        `Mode     : ${USE_ALL_UNITS ? "all 14 units" : "GOLDEN curated-5 (11-25-30 paper stage)"}`
    );
    console.log(`Chapters : ${CHAPTER_LABELS.join(" | ")}`);
    console.log(`Count    : ${REQUESTED_COUNT} (${DIFFICULTY})`);
    console.log(
        `Provider : ${GENERATION_PROVIDER} hard-model=${process.env.GEMINI_HARD_TEXT_MODEL}`
    );
    console.log(
        `Solvers  : primary=${VERIFY_MODEL} · secondary=${SECONDARY_SOLVER} · dual-agree required`
    );
    console.log(
        `Strict correctness: ${process.env.AI_QB_STRICT_ANSWER_CORRECTNESS === "1" ? "ON (ship only dual-verified keys)" : "OFF"} · drop-unverified=${process.env.AI_QB_STAGE_A_DROP_UNVERIFIED}`
    );
    console.log(
        `Paper lock: curatedMathSlotsOnly=${process.env.AI_QB_CURATED_MATH_SLOTS_ONLY} · distractorPass=${process.env.AI_QB_DISTRACTOR_PASS} · skeletonMin=${process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN} · lastAttemptFloor=${process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR}`
    );
    console.log(
        `Reference : temp/jee-main-hard-10-curated-maths-questions-only/2026-08-01_11-25-30\n`
    );

    phaseStart("0", "Connect MongoDB", [
        "Required for archetype-history reads during concept steering",
        `URI dbName=${process.env.DB_NAME}`,
    ]);
    phaseStep("0", "Opening mongoose connection…");
    await connectMongo();
    phaseEnd("0", "ok", { message: "MongoDB connected" });
    phaseStep(
        "0",
        `NCERT chapter reference ${isNcertChapterReferenceAvailable() ? "loaded" : "MISSING"} — chapters: ${listNcertChapterLabels().join(", ") || "none"}`
    );

    let questions = [];
    let planResult = null;
    let failed = false;
    let failError = null;

    try {
        // Phase 1 — Plan topics (chapter lock) ---------------------------------
        phaseStart(
            "1",
            USE_ALL_UNITS
                ? "Plan Mathematics topics — all 14 units (concentrated hard)"
                : "Plan Mathematics topics — curated chapters only (golden Stage A)",
            [
                `Ask planner for ${REQUESTED_COUNT} hard JEE Main Mathematics topic slots`,
                `Chapter lock: ${CHAPTER_LABELS.join(", ")}`,
                `adminExcludeTopics: ${EXCLUDED_TOPICS.length} other official-syllabus unit(s) excluded`,
            ]
        );
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
        const slots = planResult?.steering?.slotPlans || [];
        phaseStep("1", `Source=${planResult?.steering?.source || "?"} · slots=${slots.length}`);
        slots.forEach((slot, i) => {
            const ncertHits = inferNcertChaptersFromSlots([slot]);
            const chapterLabel =
                (ncertHits[0]?.label && chapterLabelFromFuzzy(ncertHits[0].label)) || "UNMATCHED";
            phaseStep(
                "1",
                `Slot ${String(i + 1).padStart(2, " ")} [${slot.questionKind || "?"}] chapter=${chapterLabel} ${slot.label || slot.conceptSlot}`
            );
        });
        phaseEnd("1", "ok", { slots: slots.length, source: planResult?.steering?.source });

        // Phase 2 — Question creation ONLY (deferValidation=true) -------------
        phaseStart("2", "Create questions — Stage A solve-first + answer lock", [
            `Target ${REQUESTED_COUNT} hard single-correct MCQs — Mathematics, ${USE_ALL_UNITS ? "all 14 units" : "5 curated chapters only"}`,
            `Hard generation model: ${process.env.GEMINI_HARD_TEXT_MODEL}`,
            `Stage A answer lock via OpenAI solver: ${VERIFY_MODEL}`,
            "deferValidation=true — skips FULL finalize (eval/regen loops), but Stage A answer lock still runs",
            process.env.AI_QB_STAGE_A_DROP_UNVERIFIED === "1"
                ? "Unverified keys are DROPPED (use --keep-unverified to keep them)"
                : "Unverified keys are KEPT as provisional",
        ]);
        phaseStep(
            "2",
            "Fill loop ON — keep generating until we reach target dual-verified count (or max fill rounds)…"
        );
        const genStarted = Date.now();
        const FILL_ROUNDS = Number(
            argv["fill-rounds"] || process.env.JEE_GEN_FILL_ROUNDS || 6
        );
        const stemKey = (q) =>
            String(q?.questionText || "")
                .toLowerCase()
                .replace(/\s+/g, " ")
                .slice(0, 160);
        const seenStems = new Set();
        questions = [];
        let lastGenError = null;
        let fillRound = 0;

        while (questions.length < REQUESTED_COUNT && fillRound < FILL_ROUNDS) {
            fillRound += 1;
            const need = REQUESTED_COUNT - questions.length;
            // Ask for extra headroom — strict dual-lock often yields < requested.
            const batchAsk = Math.min(10, Math.max(need + 2, need === 1 ? 3 : need + 1));
            phaseStep(
                "2",
                `Fill round ${fillRound}/${FILL_ROUNDS}: need ${need} more → requesting ${batchAsk}…`
            );

            let result = null;
            for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
                try {
                    // Fresh plan each fill round after the first to diversify slots.
                    let steering = planResult?.steering || null;
                    if (fillRound > 1) {
                        try {
                            const replan = await planQuestionBankTopics({
                                topic: TOPIC,
                                bankName: BANK_NAME,
                                difficulty: DIFFICULTY,
                                singleCount: batchAsk,
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
                            /* keep prior steering */
                        }
                    }
                    result = await generateQuestionBankSuggestions({
                        topic: TOPIC,
                        bankName: BANK_NAME,
                        difficulty: DIFFICULTY,
                        singleCount: batchAsk,
                        categoryPaths: CATEGORY_PATHS,
                        subject: SUBJECT,
                        generationProvider: GENERATION_PROVIDER,
                        generationMode: "default",
                        maxSelectableSlots: batchAsk,
                        presetSteering: steering,
                        deferValidation: true,
                        excludeQuestionTexts: [
                            ...seenStems,
                            ...questions.map((q) => q.questionText).filter(Boolean),
                        ],
                    });
                    lastGenError = null;
                    break;
                } catch (err) {
                    lastGenError = err;
                    phaseStep(
                        "2",
                        `fill ${fillRound} attempt ${attempt}/${MAX_GENERATION_RETRIES} threw: ${err?.message || err}`
                    );
                    if (attempt < MAX_GENERATION_RETRIES) {
                        const wait = 8000 * attempt;
                        phaseStep(
                            "2",
                            `Retrying in ${(wait / 1000).toFixed(0)}s…`
                        );
                        await sleep(wait);
                    }
                }
            }

            if (!result && lastGenError) {
                phaseStep("2", `Fill round ${fillRound} failed: ${lastGenError?.message || lastGenError}`);
                if (questions.length === 0 && fillRound >= FILL_ROUNDS) throw lastGenError;
                continue;
            }

            const batch = result?.questions || [];
            let added = 0;
            for (const q of batch) {
                if (questions.length >= REQUESTED_COUNT) break;
                const key = stemKey(q);
                if (!key || seenStems.has(key)) continue;
                // Prefer dual-verified; still accept stage-A locked if not strict dual-only
                const ok =
                    q._answerCorrectnessGuaranteed ||
                    q._doubleSolverAgree ||
                    q._stageAAnswerLocked ||
                    q._solverTruthApplied;
                if (!ok) continue;
                seenStems.add(key);
                questions.push(q);
                added += 1;
            }
            phaseStep(
                "2",
                `Fill round ${fillRound}: batch=${batch.length}, added=${added}, total=${questions.length}/${REQUESTED_COUNT}`
            );
        }

        if (questions.length === 0 && lastGenError) throw lastGenError;

        phaseStep(
            "2",
            `Fill complete in ${((Date.now() - genStarted) / 1000).toFixed(1)}s — produced ${questions.length}/${REQUESTED_COUNT}`
        );
        questions.forEach((q, i) => phaseStep("2", formatQuestionLine(q, i + 1)));
        phaseEnd("2", questions.length >= REQUESTED_COUNT ? "ok" : "partial", {
            produced: questions.length,
            target: REQUESTED_COUNT,
            fillRounds: fillRound,
        });

        const locked = questions.filter(
            (q) =>
                q._answerCorrectnessGuaranteed ||
                q._doubleSolverAgree ||
                q._stageAAnswerLocked ||
                q._solverTruthApplied
        ).length;
        console.log(
            `\nSTAGE A COMPLETE — ${questions.length}/${REQUESTED_COUNT} question(s); ${locked} answer-locked. Fill rounds used: ${fillRound}.\n`
        );
    } catch (err) {
        failed = true;
        failError = err;
        phaseStep("2", `FAILED: ${err?.message || err}`);
        console.error("STAGE A FAILED:", err);
    }

    // -----------------------------------------------------------------------
    // Save artifacts
    // -----------------------------------------------------------------------
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const outDir = join(
        ROOT_DIR,
        "temp",
        `jee-main-${DIFFICULTY}-${REQUESTED_COUNT}-curated-maths-questions-only`,
        ts
    );
    mkdirSync(outDir, { recursive: true });

    // Persist chapter labels so UNMATCHED / wrong chapter tags do not ship.
    questions = attachChapterLabels(questions);

    writeFileSync(
        join(outDir, "questions.json"),
        JSON.stringify(questions, null, 2),
        "utf8"
    );
    writeFileSync(
        join(outDir, "questions.txt"),
        questions.map((q, i) => formatQuestionBlock(q, i)).join("\n"),
        "utf8"
    );
    writeFileSync(
        join(outDir, "topic-plan.json"),
        JSON.stringify(planResult || {}, null, 2),
        "utf8"
    );
    writeFileSync(join(outDir, "transcript.txt"), transcriptLines.join("\n"), "utf8");
    writeFileSync(join(outDir, "phases.jsonl"), jsonlLines.join("\n"), "utf8");
    writeFileSync(
        join(outDir, "summary.json"),
        JSON.stringify(
            {
                stage: "stage_a_plus_answer_lock",
                goldenStageReference:
                    "temp/jee-main-hard-10-curated-maths-questions-only/2026-08-01_11-25-30",
                chapterMode: USE_ALL_UNITS ? "all_14_units" : "curated_five",
                stageBSkipped: [
                    "full_finalize_quality_eval",
                    "sympy_finalize_strip",
                    "difficulty_rejudge_after_verify",
                    "multi_round_regeneration",
                ],
                stageAIncluded: [
                    "hard_gemini_model",
                    "derivation_key_realign",
                    "independent_solver_answer_lock",
                    "dual_solver_strict_agree",
                    "curated_math_slots_only",
                    "distractor_pass_off",
                ],
                hardGeminiModel: process.env.GEMINI_HARD_TEXT_MODEL,
                verifyModel: VERIFY_MODEL,
                verifyModelB: SECONDARY_SOLVER,
                curatedMathSlotsOnly: process.env.AI_QB_CURATED_MATH_SLOTS_ONLY === "1",
                distractorPass: process.env.AI_QB_DISTRACTOR_PASS === "1",
                skeletonDifficultyMin: Number(
                    process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN || 80
                ),
                lastAttemptFloor: Number(
                    process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR || 72
                ),
                dropUnverified: process.env.AI_QB_STAGE_A_DROP_UNVERIFIED === "1",
                lockedCount: questions.filter(
                    (q) => q._stageAAnswerLocked || q._solverTruthApplied
                ).length,
                chapters: CHAPTER_LABELS,
                requestedCount: REQUESTED_COUNT,
                producedCount: questions.length,
                difficulty: DIFFICULTY,
                generationProvider: GENERATION_PROVIDER,
                failed,
                failError: failError ? String(failError?.message || failError) : null,
                elapsedMs: elapsed(),
                outDir,
                note: "Golden paper stage locked to 2026-08-01_11-25-30: curated slots only, dual o4/o3 agree, distractor pass OFF, last-attempt floor 72. Items with _stageAAnswerLocked=true have dual-solver keys.",
            },
            null,
            2
        ),
        "utf8"
    );

    console.log(`\nSaved to: ${outDir}`);
    console.log(
        ` - questions.json (${questions.length} question(s); ${
            questions.filter((q) => q._stageAAnswerLocked || q._solverTruthApplied).length
        } Stage-A answer-locked)`
    );
    console.log(` - questions.txt, topic-plan.json, transcript.txt, phases.jsonl, summary.json`);

    if (failed && !questions.length) {
        throw failError;
    }
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
