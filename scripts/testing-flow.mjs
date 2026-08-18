/**
 * Interactive CLI that drives the REAL AI question-bank flow end-to-end
 * (plan → confirm → generate → evaluate → regenerate → log), the same steps the
 * admin frontend performs, but in the terminal. It calls the same service-layer
 * functions the controller uses, so behaviour (archetype planning, question-kind
 * composition, solve-first generation, audits) matches production.
 *
 * RUN (from the firstedu-backend folder):
 *     node scripts/testing-flow.mjs
 *
 * A full transcript of every step is written to:
 *     temp/testing-flow/<timestamp>-<topic>.txt
 *
 * Edit the CONFIG block below (topic is at the top, as requested).
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ── Run everything relative to the backend root, regardless of caller cwd, so
//    the services' own cwd-relative writes (logs, temp) stay under firstedu-backend.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
process.chdir(BACKEND_ROOT);
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

// ============================================================================
// CONFIG — edit these
// ============================================================================
const CONFIG = {
    topic: "Competitive > Engineering > JEE Main > Chemistry",
    bankName: "", // blank → same as topic
    difficulty: "hard", // easy | medium | hard
    questionCount: 10, // how many standalone single questions to produce
    categoryPaths: [], // e.g. ["Competitive>Engineering>JEE Main>Chemistry"]
    sectionName: "chemistry",
    subject: "Chemistry", // blank → inferred from topic/category
    generationProvider: "gemini", // gemini | openai
    evaluationProvider: "openai", // openai | gemini
    maxGenerationRounds: 6, // safety cap while topping up to questionCount
};
// ============================================================================

const svc = (await import("../src/services/aiQuestion.service.js")).default;
const { logConfirmedQuestionsToFile } = await import(
    "../src/services/confirmedQuestionsLogger.service.js"
);

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

// ── Transcript file (temp/testing-flow) ────────────────────────────────────
const slug = (s) =>
    String(s || "topic")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
const OUT_DIR = path.join(BACKEND_ROOT, "temp", "testing-flow");
fs.mkdirSync(OUT_DIR, { recursive: true });
const TRANSCRIPT = path.join(OUT_DIR, `${stamp}-${slug(CONFIG.topic)}.txt`);

/** Print to terminal AND append to the transcript file. */
const log = (...parts) => {
    const line = parts
        .map((p) => (typeof p === "string" ? p : JSON.stringify(p, null, 2)))
        .join(" ");
    console.log(line);
    fs.appendFileSync(TRANSCRIPT, line + "\n", "utf8");
};
const rule = (ch = "─") => log(ch.repeat(76));

// ── Formatting helpers ──────────────────────────────────────────────────────
const KIND_TAG = {
    theory: "[THEORY]",
    direct: "[DIRECT]",
    multi_concept: "[MULTI ]",
};
const kindTag = (k) => KIND_TAG[k] || "[MULTI ]";

const printTopicPlan = (plan) => {
    rule("═");
    log("TOPIC PLAN");
    rule("═");
    const meta = plan.meta || {};
    log(
        `Subject: ${meta.subject || "-"}   Exam: ${meta.examProfile || "-"}   Source: ${plan.steering?.source || "-"}`
    );
    const mix = plan.kindRatio || meta.kindRatio;
    if (mix) log(`Composition mix: ${mix.label}`);
    log("");
    log(`Included topics (${(plan.includedTopics || []).length}):`);
    (plan.includedTopics || []).forEach((t, i) => {
        log(
            `  ${String(i + 1).padStart(2)}. ${kindTag(t.questionKind)} ${t.label}`
        );
        if (t.description) log(`        ↳ ${t.description}`);
    });
    if ((plan.excludedTopics || []).length) {
        log("");
        log(`Excluded topics (${plan.excludedTopics.length}):`);
        plan.excludedTopics.forEach((t) => log(`  ✗ ${t}`));
    }
    log("");
};

const printQuestions = (questions) => {
    rule("═");
    log(`GENERATED QUESTIONS (${questions.length})`);
    rule("═");
    questions.forEach((q, i) => {
        const opts = Array.isArray(q.options) ? q.options : [];
        const correct = Number.isFinite(Number(q.correctIndex))
            ? Number(q.correctIndex)
            : -1;
        const kind = q._questionKind || q.questionKind || "multi_concept";
        log(
            `\nQ${i + 1}. ${kindTag(kind)} [${q.difficulty || q.difficultyTier || "?"}] ${q._conceptSlot ? `(${q._conceptSlot})` : ""}`
        );
        log(`   ${String(q.questionText || "").trim()}`);
        opts.forEach((o, oi) => {
            const text = typeof o === "object" ? o.text : o;
            log(`     ${oi === correct ? "✓" : " "} ${String.fromCharCode(65 + oi)}) ${text}`);
        });
        if (q.explanation) log(`   Explanation: ${String(q.explanation).trim()}`);
    });
    log("");
};

const printEvaluation = (ev) => {
    rule("═");
    log("EVALUATION (validate)");
    rule("═");
    log(
        `overall=${ev.overallScore}  topicRelevance=${ev.topicRelevanceScore}  correctness=${ev.correctnessScore}  difficultyMatch=${ev.difficultyMatchScore}  style=${ev.styleScore}`
    );
    if (ev.verdict) log(`Verdict: ${ev.verdict}`);
    const issues = ev.confirmedIssues || [];
    if (issues.length) {
        log(`\nConfirmed issues (${issues.length}):`);
        issues.forEach((iss) =>
            log(`  • Q${iss.questionNumber ?? "?"} [${iss.category || iss.severity || "issue"}] ${iss.issue}`)
        );
    } else {
        log("No confirmed issues.");
    }
    if (ev.regenerationInstructions) {
        log(`\nRegeneration instructions:\n${ev.regenerationInstructions}`);
    }
    log("");
};

// ── Shared params ───────────────────────────────────────────────────────────
const bankName = CONFIG.bankName || CONFIG.topic;
const baseParams = {
    topic: CONFIG.topic,
    bankName,
    difficulty: String(CONFIG.difficulty).toLowerCase(),
    categoryPaths: CONFIG.categoryPaths,
    sectionName: CONFIG.sectionName,
    subject: CONFIG.subject,
    generationProvider: CONFIG.generationProvider,
};

const stemOf = (q) => String(q?.questionText || "").trim();

// ── Menu helper ─────────────────────────────────────────────────────────────
const menu = async (title, options) => {
    log("");
    log(title);
    options.forEach((o, i) => log(`  ${i + 1}) ${o}`));
    while (true) {
        const raw = (await ask("Choose a number: ")).trim();
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) {
            log(`> ${n} (${options[n - 1]})`);
            return n;
        }
        console.log(`Enter 1-${options.length}.`);
    }
};

// ============================================================================
// FLOW
// ============================================================================
const run = async () => {
    log(`AI GENERATION FLOW — terminal harness`);
    log(`Topic: ${CONFIG.topic}`);
    log(`Target: ${CONFIG.questionCount} single question(s) · difficulty=${CONFIG.difficulty} · provider=${CONFIG.generationProvider}`);
    log(`Transcript: ${TRANSCRIPT}`);
    log(`Started: ${new Date().toISOString()}`);

    const target = Math.max(1, Number(CONFIG.questionCount) || 10);

    // ── STEP 1: PLAN TOPICS + CONFIRM LOOP ─────────────────────────────────
    let planningFeedback = "";
    let adminExcludeTopics = [];
    let topicPlan = null;

    while (true) {
        log(`\n… Planning topics${planningFeedback ? " (re-plan with feedback)" : ""} …`);
        try {
            topicPlan = await svc.planQuestionBankTopics({
                ...baseParams,
                singleCount: target,
                multipleCount: 0,
                trueFalseCount: 0,
                connectedCount: 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
                maxSelectableSlots: target,
                competitiveExamPlan: null,
                planningFeedback,
                adminExcludeTopics,
                excludeArchetypes: [],
            });
        } catch (err) {
            log(`✗ Planning failed: ${err?.message || err}`);
            const retry = await menu("Planning failed.", ["Retry", "Abort"]);
            if (retry === 1) continue;
            return;
        }

        printTopicPlan(topicPlan);

        const choice = await menu("Is this topic plan OK?", [
            "Confirm & generate",
            "Re-plan with feedback",
            "Abort",
        ]);
        if (choice === 1) break;
        if (choice === 3) {
            log("Aborted at planning.");
            return;
        }
        planningFeedback = (await ask("Feedback (what to add/drop/change): ")).trim();
        adminExcludeTopics = topicPlan.excludedTopics || [];
    }

    const presetSteering = topicPlan.steering || null;
    log("✓ Topic plan confirmed. Generating…");

    // ── STEP 2: GENERATE UNTIL TARGET REACHED ──────────────────────────────
    let questions = [];
    for (
        let round = 1;
        questions.length < target && round <= CONFIG.maxGenerationRounds;
        round++
    ) {
        const need = target - questions.length;
        log(`\n… Generation round ${round}: requesting ${need} more (have ${questions.length}/${target}) …`);
        try {
            const res = await svc.generateQuestionBankSuggestions({
                ...baseParams,
                singleCount: need,
                multipleCount: 0,
                trueFalseCount: 0,
                connectedCount: 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
                excludeQuestionTexts: questions.map(stemOf),
                generateIntent: "initial",
                topicRelevanceFeedback: null,
                topicRelevanceEvaluated: false,
                topicRelevanceRegenerated: false,
                hasGeneratedQuestions: questions.length > 0,
                allowContinuation: round > 1,
                inferCountsIfMissing: false,
                maxSelectableSlots: target,
                competitiveExamPlan: null,
                deferValidation: false,
                generationMode: "default",
                // Use the confirmed plan on the first round; top-up rounds plan fresh slots.
                presetSteering: round === 1 ? presetSteering : null,
            });
            const got = Array.isArray(res.questions) ? res.questions : [];
            log(`  → produced ${got.length} question(s) this round`);
            questions = questions.concat(got).slice(0, target);
        } catch (err) {
            log(`✗ Generation round ${round} failed: ${err?.message || err}`);
            const cont = await menu("Generation failed.", ["Retry another round", "Stop generating"]);
            if (cont === 2) break;
        }
    }

    if (!questions.length) {
        log("No questions were generated. Exiting.");
        return;
    }
    if (questions.length < target) {
        log(`⚠ Reached ${questions.length}/${target} after ${CONFIG.maxGenerationRounds} rounds.`);
    }
    printQuestions(questions);

    // ── STEP 3: POST-GENERATION MENU (confirm / evaluate / log / save) ──────
    let lastEvaluation = null;
    while (true) {
        const choice = await menu(
            `Bank ready (${questions.length} questions). What next?`,
            [
                "Evaluate quality (validate)",
                "Verify & fix answers/explanations",
                "Regenerate failed questions (needs evaluate first)",
                "Log confirmed questions to file",
                "Show questions again",
                "Save transcript & exit",
            ]
        );

        if (choice === 1) {
            log("\n… Evaluating …");
            try {
                lastEvaluation = await svc.validateQuestionTopicRelevance({
                    ...baseParams,
                    questions,
                    difficulty: baseParams.difficulty,
                    evaluationProvider: CONFIG.evaluationProvider,
                    competitiveExamPlan: null,
                    singleCount: questions.length,
                    multipleCount: 0,
                    trueFalseCount: 0,
                    passageCount: 0,
                    passageSingleCount: 0,
                    passageMultipleCount: 0,
                    passageTrueFalseCount: 0,
                    alreadyEvaluated: false,
                });
                printEvaluation(lastEvaluation);
            } catch (err) {
                log(`✗ Evaluation failed: ${err?.message || err}`);
            }
        } else if (choice === 2) {
            log("\n… Independently re-solving every question and fixing wrong keys / explanations …");
            try {
                const fix = await svc.applyAnswerCorrectionToQuestionBank({
                    ...baseParams,
                    questions,
                    competitiveExamPlan: null,
                });
                rule("═");
                log("ANSWER / EXPLANATION CORRECTION");
                rule("═");
                log(
                    `checked=${fix.checkedCount}  disagreements=${fix.disagreementCount}  fixed=${fix.fixedCount}  unfixable=${fix.unfixableRefs.length}`
                );
                (fix.report || []).forEach((r) => {
                    const qn = (r.ref?.topIndex ?? 0) + 1;
                    if (r.status === "fixed") {
                        log(`  ✔ Q${qn}: key ${r.from} → ${r.to}, explanation rewritten`);
                    } else {
                        log(`  ✗ Q${qn}: unfixable — ${r.reason}`);
                    }
                    (r.reasons || []).forEach((why) => log(`        · ${why}`));
                });
                if (fix.fixedCount) {
                    questions = fix.questions;
                    lastEvaluation = null; // bank changed — re-evaluate for fresh scores
                    log("\nBank updated. Re-evaluate (option 1) for fresh scores.");
                    printQuestions(questions);
                } else {
                    log("No answer/explanation corrections were needed.");
                }
            } catch (err) {
                log(`✗ Answer correction failed: ${err?.message || err}`);
            }
        } else if (choice === 3) {
            if (!lastEvaluation) {
                log("Evaluate first (option 1) before regenerating.");
                continue;
            }
            const failed = deriveFailedNumbers(lastEvaluation, questions.length);
            if (!failed.length) {
                log("No failed questions to regenerate — evaluation found nothing to fix.");
                continue;
            }
            log(`\n… Regenerating ${failed.length} failed question(s): #${failed.join(", #")} …`);
            try {
                const passingStems = questions
                    .filter((_, i) => !failed.includes(i + 1))
                    .map(stemOf);
                const res = await svc.generateQuestionBankSuggestions({
                    ...baseParams,
                    singleCount: failed.length,
                    multipleCount: 0,
                    trueFalseCount: 0,
                    connectedCount: 0,
                    passageCount: 0,
                    passageSingleCount: 0,
                    passageMultipleCount: 0,
                    passageTrueFalseCount: 0,
                    excludeQuestionTexts: passingStems,
                    generateIntent: "evaluation_regen",
                    topicRelevanceFeedback: lastEvaluation,
                    topicRelevanceEvaluated: true,
                    topicRelevanceRegenerated: false,
                    hasGeneratedQuestions: true,
                    allowContinuation: true,
                    inferCountsIfMissing: false,
                    maxSelectableSlots: target,
                    competitiveExamPlan: null,
                    deferValidation: false,
                    generationMode: "default",
                    presetSteering: null,
                });
                const replacements = Array.isArray(res.questions) ? res.questions : [];
                const targetNums =
                    res.targetedRegeneration?.failedQuestionNumbers || failed;
                let swapped = 0;
                targetNums.forEach((num, i) => {
                    if (replacements[i] && questions[num - 1]) {
                        questions[num - 1] = replacements[i];
                        swapped++;
                    }
                });
                log(`  → regenerated & swapped ${swapped} question(s). Re-evaluate to confirm.`);
                lastEvaluation = null; // force re-evaluate on the merged bank
                printQuestions(questions);
            } catch (err) {
                log(`✗ Regeneration failed: ${err?.message || err}`);
            }
        } else if (choice === 4) {
            log("\n… Logging confirmed questions …");
            try {
                const res = await logConfirmedQuestionsToFile({
                    topic: CONFIG.topic,
                    bankName,
                    sectionName: CONFIG.sectionName,
                    sectionIndex: null,
                    questions,
                });
                log(`✓ Logged ${res.questionCount} question(s) → ${res.filePath}`);
            } catch (err) {
                log(`✗ Logging failed: ${err?.message || err}`);
            }
        } else if (choice === 5) {
            printQuestions(questions);
        } else if (choice === 6) {
            break;
        }
    }

    // ── FINAL DUMP ─────────────────────────────────────────────────────────
    rule("═");
    log("FINAL BANK");
    rule("═");
    printQuestions(questions);
    log(`Finished: ${new Date().toISOString()}`);
    log(`Transcript saved: ${TRANSCRIPT}`);
};

/** Failed 1-indexed question numbers from an evaluation result. */
const deriveFailedNumbers = (ev, total) => {
    const nums = new Set();
    if (Array.isArray(ev?.targetedRegeneration?.failedQuestionNumbers)) {
        ev.targetedRegeneration.failedQuestionNumbers.forEach((n) => nums.add(Number(n)));
    }
    (ev?.confirmedIssues || []).forEach((iss) => {
        const n = Number(iss.questionNumber);
        const sev = String(iss.severity || "major").toLowerCase();
        if (Number.isFinite(n) && (sev === "major" || sev === "critical")) nums.add(n);
    });
    return [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
};

try {
    await run();
} catch (err) {
    console.error("Fatal:", err);
} finally {
    rl.close();
    process.exit(0);
}
