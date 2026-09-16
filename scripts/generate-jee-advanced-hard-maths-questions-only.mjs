/**
 * JEE Advanced — Hard Mathematics, STAGE A only (+ dual-solver answer lock).
 *
 * QUALITY-FIRST path using file pack in `jee_advanced/`:
 *   - maths_syllabus.json              M01–M19 official Advanced topics
 *   - maths_ncert_context.json         formulas / hard_archetypes / banned easy
 *   - maths_scoring.json               advanced_relevance (prefer HIGH)
 *   - maths_question_type_quotas.json  bank type×difficulty quotas (reference)
 *   - jee_advanced_pattern_totals.json paper section pattern (reference)
 *
 * Default:
 *   - HIGH advanced_relevance topics only (10 topics)
 *   - gemini-3.5-flash hard generation
 *   - o4-mini + o3-mini dual independent solvers (drop if disagree)
 *   - force multi_concept · skeleton difficulty floor (≥70; yield-friendly vs Main 80)
 *   - deferValidation=true (no Stage B full finalize)
 *
 * Usage:
 *   node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=10
 *   node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=6 --all-topics
 *   node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=10 --provider=gemini --gemini-model=gemini-3.5-flash
 *   node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=5 --keep-unverified
 *   node scripts/generate-jee-advanced-hard-maths-questions-only.mjs --count=1 --solver-timeout-ms=180000 --gemini-timeout-ms=300000
 *
 * Timeouts (Advanced defaults; Main .env 30s/60s are intentionally ignored):
 *   gemini  240s  (JEE_ADV_GEMINI_TIMEOUT_MS / --gemini-timeout-ms)
 *   solver  150s  (JEE_ADV_SOLVER_TIMEOUT_MS / --solver-timeout-ms)
 *
 * Output: temp/jee-advanced-hard-<count>-maths-questions-only/<timestamp>/
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

const argv = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const m = /^--([^=]+)=(.*)$/.exec(a);
        return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
    })
);

const REQUESTED_COUNT = Number(argv.count || process.env.JEE_ADV_GEN_COUNT || 10);
const DIFFICULTY = String(argv.difficulty || "hard").toLowerCase();
const SUBJECT = "Mathematics";
const GENERATION_PROVIDER = String(
    argv.provider || process.env.JEE_ADV_GEN_PROVIDER || "gemini"
)
    .trim()
    .toLowerCase();

// Hard model + longer timeout (Advanced multi-concept stems are heavier than Main).
// Live 2026-08-04: 150s still hit Gemini "This operation was aborted" on
// solve-first regen waves; 240s matches observed ~80–150s+ hard skeleton calls.
// Do NOT inherit .env GEMINI_REQUEST_TIMEOUT_MS=30000 (Main fail-fast).
process.env.GEMINI_REQUEST_TIMEOUT_MS = String(
    argv["gemini-timeout-ms"] ||
        process.env.JEE_ADV_GEMINI_TIMEOUT_MS ||
        240000
);
process.env.GEMINI_QB_MAX_ATTEMPTS = String(
    process.env.JEE_ADV_GEMINI_MAX_ATTEMPTS ||
        process.env.JEE_GEN_GEMINI_MAX_ATTEMPTS ||
        3
);
process.env.GEMINI_HARD_TEXT_MODEL = String(
    argv["gemini-model"] ||
        process.env.JEE_ADV_GEMINI_HARD_MODEL ||
        process.env.GEMINI_HARD_TEXT_MODEL ||
        "gemini-3.5-flash"
).trim();

// Lean Stage A — quality lock stack
process.env.AI_QB_DEFER_VALIDATION = "1";
process.env.EXAM_REFERENCE_RESEARCH_ENABLED =
    process.env.EXAM_REFERENCE_RESEARCH_ENABLED || "0";
process.env.AI_QB_DIFFICULTY_CALIBRATION =
    process.env.AI_QB_DIFFICULTY_CALIBRATION || "0";
process.env.AI_QB_DISTRACTOR_PASS =
    argv["distractor-pass"] === "1" || argv["distractor-pass"] === true
        ? "1"
        : "0";
process.env.AI_QB_CURATED_MATH_SLOTS_ONLY =
    argv["all-topics"] || process.env.JEE_ADV_ALL_TOPICS === "1"
        ? process.env.AI_QB_CURATED_MATH_SLOTS_ONLY || "0"
        : "1";

process.env.AI_QB_STAGE_A_ANSWER_LOCK = "1";
if (argv["keep-unverified"] || argv.keepUnverified) {
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "0";
} else {
    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED = "1";
}

const VERIFY_MODEL = String(
    argv["verify-model"] ||
        process.env.JEE_ADV_VERIFY_MODEL ||
        process.env.OPENAI_SOLVER_MODEL ||
        "o4-mini"
).trim();
process.env.AI_QB_SOLVER_PROVIDER = "openai";
process.env.AI_QB_SOLVER_PROVIDER_B = "openai";
process.env.OPENAI_SOLVER_MODEL = VERIFY_MODEL;
const rawSecondary = String(
    argv["verify-model-b"] ||
        process.env.JEE_ADV_VERIFY_MODEL_B ||
        process.env.OPENAI_SOLVER_MODEL_B ||
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
// Dual-lock on hard Advanced multi-concept routinely exceeds Main's 60s solver
// budget (live: all 3 items dropped as unfixable after o4-mini 60s timeouts).
// Prefer Advanced-specific env / CLI; do NOT inherit OPENAI_SOLVER_TIMEOUT_MS=60000.
const SOLVER_TIMEOUT_MS = Number(
    argv["solver-timeout-ms"] ||
        process.env.JEE_ADV_SOLVER_TIMEOUT_MS ||
        150000
);
process.env.OPENAI_SOLVER_TIMEOUT_MS = String(SOLVER_TIMEOUT_MS);
process.env.OPENAI_TIEBREAKER_TIMEOUT_MS = String(
    argv["tiebreaker-timeout-ms"] ||
        process.env.JEE_ADV_TIEBREAKER_TIMEOUT_MS ||
        SOLVER_TIMEOUT_MS
);

process.env.AI_QB_SOLVER_TRUTH = "1";
process.env.AI_QB_BLIND_SOLVER = "1";
process.env.AI_QB_DIFFICULTY_SELF_AUDIT = "1";
process.env.AI_QB_HARD_MULTI_HEAVY = "1";
process.env.AI_QB_FORCE_ALL_MULTI =
    argv["all-multi"] === "0" || argv["all-multi"] === false ? "0" : "1";
// Hardness gate: keep skeletons scoring ≥ this (0–100). Accuracy still comes
// from dual-lock, not this floor. 70 admits borderline multi-concept items that
// Main's 80 bar was wiping (live: 72–78 scores rejected → empty batches / aborts).
// Force Advanced floors — do NOT inherit .env Main values (80/72).
process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN = String(
    argv["min-difficulty"] ||
        process.env.JEE_ADV_SKELETON_MIN ||
        70
);
process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR = String(
    argv["last-attempt-floor"] ||
        process.env.JEE_ADV_LAST_ATTEMPT_FLOOR ||
        65
);
process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR = String(
    process.env.JEE_ADV_RELAXED_FLOOR ||
        process.env.AI_QB_SKELETON_SELF_AUDIT_RELAXED_FLOOR ||
        65
);
process.env.AI_QB_VETERAN_DIFFICULTY = "1";

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
    process.env.OPENAI_SOLVER_MODEL_B = SECONDARY_SOLVER;
    process.env.AI_QB_SOLVER_KEEP_PRIMARY_ON_DISAGREE = "0";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_GENERATION_RETRIES = Number(
    argv["max-retries"] || process.env.JEE_ADV_MAX_RETRIES || 3
);

const { planQuestionBankTopics, generateQuestionBankSuggestions } =
    await import("../src/services/aiQuestion.service.js");
const {
    isJeeAdvancedMathsDataAvailable,
    getJeeAdvancedMathTopics,
    getHighRelevanceAdvancedTopics,
    getMediumPlusAdvancedTopics,
    getAdvancedPaperTypeCounts,
    loadJeeAdvancedPattern,
    inferJeeAdvancedTopicsFromSlots,
    hydrateJeeAdvancedMathsScoringFromDb,
} = await import("../src/services/jeeAdvancedMaths.service.js");

// ---------------------------------------------------------------------------
// Topic lock — HIGH advanced_relevance by default
// ---------------------------------------------------------------------------
if (!isJeeAdvancedMathsDataAvailable()) {
    console.error(
        "FATAL: jee_advanced/ data pack missing or incomplete. Need maths_syllabus.json + maths_ncert_context.json"
    );
    process.exit(1);
}

const USE_ALL_TOPICS =
    argv["all-topics"] === true ||
    argv["all-topics"] === "1" ||
    process.env.JEE_ADV_ALL_TOPICS === "1";
const USE_MEDIUM_PLUS =
    argv["medium-plus"] === true ||
    argv["medium-plus"] === "1" ||
    process.env.JEE_ADV_MEDIUM_PLUS === "1";

const allTopics = getJeeAdvancedMathTopics();
const highTopics = getHighRelevanceAdvancedTopics();
const mediumPlus = getMediumPlusAdvancedTopics();

const TARGET_TOPICS = USE_ALL_TOPICS
    ? allTopics
    : USE_MEDIUM_PLUS
      ? mediumPlus.length
          ? mediumPlus
          : allTopics
      : highTopics.length
        ? highTopics
        : mediumPlus.length
          ? mediumPlus
          : allTopics;

const CHAPTER_LABELS = TARGET_TOPICS.map((t) => t.chapter);
const TARGET_IDS = new Set(TARGET_TOPICS.map((t) => t.topicId));
const EXCLUDED_TOPICS = allTopics
    .filter((t) => !TARGET_IDS.has(t.topicId))
    .map((t) => `${t.topicId} ${t.chapter}`);

// Must contain "JEE Advanced" so detectExamProfile → jee_advanced
const TOPIC = USE_ALL_TOPICS
    ? `Competitive › Engineering › JEE Advanced › Mathematics · Hard all topics: ${CHAPTER_LABELS.join(", ")}`
    : `Competitive › Engineering › JEE Advanced › Mathematics · Hard high-relevance topics: ${CHAPTER_LABELS.join(", ")}`;
const BANK_NAME = TOPIC;
const CATEGORY_PATHS = ["JEE Advanced > Mathematics"];

// ---------------------------------------------------------------------------
// Phase logger
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
    const detailLines = details
        .map((d) => `[${at}] (+${secs}s)   · ${d}`)
        .join("\n");
    emit(
        { type: "phase_start", id, title, details, at, elapsedMs: elapsed() },
        `[${at}] (+${secs}s) ${RULE}\n[${at}] (+${secs}s) PHASE ${id} START — ${title}\n[${at}] (+${secs}s) ${RULE}` +
            (detailLines ? `\n${detailLines}` : "")
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
    const extraLines = extra
        ? Object.entries(extra)
              .map(
                  ([k, v]) =>
                      `[${at}] (+${secs}s)   · ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
              )
              .join("\n")
        : "";
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
        `[${at}] (+${secs}s) PHASE ${id} END — ${status === "ok" ? "✓ OK" : "✗ FAIL"} (${(tookMs / 1000).toFixed(1)}s)` +
            (extraLines ? `\n${extraLines}` : "")
    );
};

const formatQuestionBlock = (q, i) => {
    const letters = ["A", "B", "C", "D"];
    const lines = [
        `Q${i + 1}. [${q._conceptSlot || q.conceptSlot || "?"}] ${q._chapter || q.chapter || ""}`,
        `Type: ${q.questionType || "single"}`,
        String(q.questionText || "").trim(),
        "",
    ];
    (q.options || []).forEach((opt, j) => {
        if (String(opt || "").trim()) {
            lines.push(`  ${letters[j]}. ${opt}`);
        }
    });
    const correct =
        q.correctIndex != null && q.correctIndex >= 0
            ? letters[q.correctIndex]
            : "?";
    lines.push(`Correct: ${correct}`);
    if (q._doubleSolverAgree) lines.push("Lock: dual-solver-agree");
    else if (q._stageAAnswerLocked) lines.push("Lock: stage-a");
    lines.push(`Explanation: ${String(q.explanation || "").slice(0, 600)}`);
    lines.push("");
    return lines.join("\n");
};

const formatQuestionLine = (q, n) => {
    const lock =
        q._answerCorrectnessGuaranteed || q._doubleSolverAgree
            ? "DUAL-LOCK"
            : q._stageAAnswerLocked
              ? "STAGE-A"
              : "PROVISIONAL";
    return `Q${String(n).padStart(2, "0")} [${lock}] ${(q.questionText || "").slice(0, 100).replace(/\s+/g, " ")}…`;
};

const attachChapterLabels = (questions = []) =>
    (questions || []).map((q) => {
        const slots = [
            {
                chapter: q._chapter || q.chapter || "",
                conceptSlot: q._conceptSlot || q.conceptSlot || "",
                label: q._conceptLabel || "",
                description: String(q.questionText || "").slice(0, 400),
            },
        ];
        const inferred = inferJeeAdvancedTopicsFromSlots(slots);
        const hit = inferred[0];
        if (!hit) return q;
        return {
            ...q,
            _chapter: hit.chapter,
            chapter: hit.chapter,
            _topicId: hit.topicId,
            topicId: hit.topicId,
        };
    });

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

async function main() {
    const paperMix = getAdvancedPaperTypeCounts({ paper: 1 });
    const pattern = loadJeeAdvancedPattern();

    console.log("\n" + RULE);
    console.log("JEE ADVANCED — Hard Mathematics (Stage A + dual answer lock)");
    console.log(RULE);
    console.log(
        `Topics   : ${USE_ALL_TOPICS ? "ALL M01–M19" : USE_MEDIUM_PLUS ? "medium+high" : "HIGH relevance only"} (${TARGET_TOPICS.length})`
    );
    console.log(
        `          ${TARGET_TOPICS.map((t) => t.topicId).join(", ")}`
    );
    console.log(`Count    : ${REQUESTED_COUNT} (${DIFFICULTY})`);
    console.log(
        `Provider : ${GENERATION_PROVIDER} hard-model=${process.env.GEMINI_HARD_TEXT_MODEL}`
    );
    console.log(
        `Solvers  : primary=${VERIFY_MODEL} · secondary=${SECONDARY_SOLVER} · dual-agree required`
    );
    console.log(
        `Timeouts : gemini=${process.env.GEMINI_REQUEST_TIMEOUT_MS}ms · solver=${process.env.OPENAI_SOLVER_TIMEOUT_MS}ms`
    );
    console.log(
        `Strict correctness: ${process.env.AI_QB_STRICT_ANSWER_CORRECTNESS === "1" ? "ON" : "OFF"} · drop-unverified=${process.env.AI_QB_STAGE_A_DROP_UNVERIFIED}`
    );
    console.log(
        `Difficulty floors: skeletonMin=${process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN} · lastAttempt=${process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR}`
    );
    console.log(
        `Paper ref (subj×P1): single ${paperMix.single} · multi ${paperMix.multi} · integer ${paperMix.integer} · match ${paperMix.match}`
    );
    console.log(
        `Data     : jee_advanced/ (${pattern?.data_provenance || "pattern file"})\n`
    );

    phaseStart("0", "Connect MongoDB + load Advanced pack", [
        "Archetype history + Advanced M01–M19 file pack",
        `Topics available: ${allTopics.length} · high: ${highTopics.length}`,
    ]);
    phaseStep("0", "Opening mongoose connection…");
    await connectMongo();
    const hydrated = await hydrateJeeAdvancedMathsScoringFromDb();
    phaseStep(
        "0",
        hydrated
            ? "Scoring hydrated from ExamSyllabusPack (Mongo)"
            : "Scoring from file pack (Mongo pack missing — run seed-exam-syllabus-pack)"
    );
    phaseEnd("0", "ok", {
        topics: allTopics.length,
        targetTopics: TARGET_TOPICS.length,
        dataOk: true,
        scoringSource: hydrated ? "exam_syllabus_pack" : "file",
    });

    let questions = [];
    let planResult = null;
    let failed = false;
    let failError = null;

    try {
        phaseStart(
            "1",
            USE_ALL_TOPICS
                ? "Plan JEE Advanced Mathematics topics — all M01–M19"
                : "Plan JEE Advanced Mathematics topics — HIGH relevance only",
            [
                `Ask planner for ${REQUESTED_COUNT} hard Advanced multi_concept slots`,
                `Chapter lock: ${CHAPTER_LABELS.join(", ")}`,
                `Excluded: ${EXCLUDED_TOPICS.length} lower-relevance / out-of-lock topic(s)`,
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
        phaseStep(
            "1",
            `Source=${planResult?.steering?.source || "?"} · slots=${slots.length}`
        );
        slots.forEach((slot, i) => {
            const hits = inferJeeAdvancedTopicsFromSlots([slot]);
            const chapterLabel = hits[0]
                ? `${hits[0].topicId} ${hits[0].chapter}`
                : "UNMATCHED";
            phaseStep(
                "1",
                `Slot ${String(i + 1).padStart(2, " ")} [${slot.questionKind || "?"}] ${chapterLabel} · ${slot.label || slot.conceptSlot}`
            );
        });
        phaseEnd("1", "ok", {
            slots: slots.length,
            source: planResult?.steering?.source,
        });

        phaseStart("2", "Create Advanced hard questions — Stage A + dual lock", [
            `Target ${REQUESTED_COUNT} hard single-correct Advanced MCQs`,
            `Hard generation model: ${process.env.GEMINI_HARD_TEXT_MODEL}`,
            `Stage A answer lock: ${VERIFY_MODEL} + ${SECONDARY_SOLVER}`,
            "deferValidation=true — full Stage B finalize skipped",
            process.env.AI_QB_STAGE_A_DROP_UNVERIFIED === "1"
                ? "Unverified keys DROPPED"
                : "Unverified keys KEPT as provisional",
        ]);
        phaseStep(
            "2",
            "Fill loop ON — generate until dual-verified count (or max fill rounds)…"
        );

        const genStarted = Date.now();
        const FILL_ROUNDS = Number(
            argv["fill-rounds"] || process.env.JEE_ADV_FILL_ROUNDS || 6
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
            const batchAsk = Math.min(
                10,
                Math.max(need + 2, need === 1 ? 3 : need + 1)
            );
            phaseStep(
                "2",
                `Fill round ${fillRound}/${FILL_ROUNDS}: need ${need} more → requesting ${batchAsk}…`
            );

            let result = null;
            for (let attempt = 1; attempt <= MAX_GENERATION_RETRIES; attempt++) {
                try {
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
                            ...questions
                                .map((q) => q.questionText)
                                .filter(Boolean),
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
                phaseStep(
                    "2",
                    `Fill round ${fillRound} failed: ${lastGenError?.message || lastGenError}`
                );
                if (questions.length === 0 && fillRound >= FILL_ROUNDS) {
                    throw lastGenError;
                }
                continue;
            }

            const batch = result?.questions || [];
            let added = 0;
            for (const q of batch) {
                if (questions.length >= REQUESTED_COUNT) break;
                const key = stemKey(q);
                if (!key || seenStems.has(key)) continue;
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
        phaseEnd(
            "2",
            questions.length >= REQUESTED_COUNT ? "ok" : "partial",
            {
                produced: questions.length,
                target: REQUESTED_COUNT,
                fillRounds: fillRound,
            }
        );

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

    const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
    const outDir = join(
        ROOT_DIR,
        "temp",
        `jee-advanced-${DIFFICULTY}-${REQUESTED_COUNT}-maths-questions-only`,
        ts
    );
    mkdirSync(outDir, { recursive: true });

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
    writeFileSync(
        join(outDir, "advanced-data-snapshot.json"),
        JSON.stringify(
            {
                targetTopics: TARGET_TOPICS.map((t) => ({
                    topicId: t.topicId,
                    chapter: t.chapter,
                    advanced_relevance: t.scoring?.advanced_relevance,
                    hard_archetypes: t.ncert?.hard_archetypes || [],
                })),
                paperPatternP1: paperMix,
                patternProvenance: pattern?.data_provenance || null,
            },
            null,
            2
        ),
        "utf8"
    );
    writeFileSync(join(outDir, "transcript.txt"), transcriptLines.join("\n"), "utf8");
    writeFileSync(join(outDir, "phases.jsonl"), jsonlLines.join("\n"), "utf8");
    writeFileSync(
        join(outDir, "summary.json"),
        JSON.stringify(
            {
                exam: "JEE Advanced",
                subject: "Mathematics",
                stage: "stage_a_plus_answer_lock",
                qualityFirst: true,
                topicMode: USE_ALL_TOPICS
                    ? "all_m01_m19"
                    : USE_MEDIUM_PLUS
                      ? "medium_plus_high"
                      : "high_relevance_only",
                stageBSkipped: [
                    "full_finalize_quality_eval",
                    "sympy_finalize_strip",
                    "difficulty_rejudge_after_verify",
                    "multi_round_regeneration",
                    "full_paper_multi_integer_match_mix",
                ],
                stageAIncluded: [
                    "jee_advanced_file_pack",
                    "advanced_syllabus_m01_m19",
                    "advanced_hard_archetypes",
                    "hard_gemini_model",
                    "dual_solver_strict_agree",
                    "higher_skeleton_difficulty_floor",
                ],
                dataRoot: "jee_advanced/",
                hardGeminiModel: process.env.GEMINI_HARD_TEXT_MODEL,
                verifyModel: VERIFY_MODEL,
                verifyModelB: SECONDARY_SOLVER,
                geminiTimeoutMs: Number(
                    process.env.GEMINI_REQUEST_TIMEOUT_MS || 240000
                ),
                solverTimeoutMs: Number(
                    process.env.OPENAI_SOLVER_TIMEOUT_MS || 150000
                ),
                skeletonDifficultyMin: Number(
                    process.env.AI_QB_SKELETON_DIFFICULTY_SELF_AUDIT_MIN || 70
                ),
                lastAttemptFloor: Number(
                    process.env.AI_QB_SKELETON_SELF_AUDIT_LAST_ATTEMPT_FLOOR || 65
                ),
                dropUnverified:
                    process.env.AI_QB_STAGE_A_DROP_UNVERIFIED === "1",
                lockedCount: questions.filter(
                    (q) => q._stageAAnswerLocked || q._solverTruthApplied
                ).length,
                dualLockedCount: questions.filter(
                    (q) =>
                        q._doubleSolverAgree || q._answerCorrectnessGuaranteed
                ).length,
                chapters: CHAPTER_LABELS,
                topicIds: TARGET_TOPICS.map((t) => t.topicId),
                requestedCount: REQUESTED_COUNT,
                producedCount: questions.length,
                difficulty: DIFFICULTY,
                generationProvider: GENERATION_PROVIDER,
                paperPatternReference: paperMix,
                nextSteps: [
                    "Stabilize dual-lock yield on HIGH topics",
                    "Add multi-correct / integer generation with type-specific locks",
                    "Wire match-list when dual-lock quality is stable",
                ],
                failed,
                failError: failError
                    ? String(failError?.message || failError)
                    : null,
                elapsedMs: elapsed(),
                outDir,
                note: "Quality-first Advanced Stage A: high-relevance topics, dual o4/o3 lock, Advanced NCERT/hard archetype pack. Full paper type mix deferred until single hard accuracy is solid.",
            },
            null,
            2
        ),
        "utf8"
    );

    console.log(`\nSaved to: ${outDir}`);
    console.log(
        ` - questions.json (${questions.length} question(s); ${
            questions.filter(
                (q) => q._stageAAnswerLocked || q._solverTruthApplied
            ).length
        } Stage-A answer-locked)`
    );
    console.log(
        ` - questions.txt, topic-plan.json, advanced-data-snapshot.json, transcript.txt, phases.jsonl, summary.json`
    );

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
