/**
 * Generate a NEET UG Prelims-style paper via Gemini.
 * Physics / Chemistry / Botany / Zoology — 45 single MCQs each (180 total).
 *
 * Output:
 *   temp/neet-prelims/{physics,chemistry,botany,zoology}.txt
 *   temp/neet-prelims/NEET_Prelims_Full_Paper.txt   (combined)
 *
 * Usage:
 *   node scripts/generate-neet-prelims-paper.mjs
 *   node scripts/generate-neet-prelims-paper.mjs --subject physics
 */
import dotenv from "dotenv";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

dotenv.config();
process.env.EXAM_REFERENCE_RESEARCH_ENABLED = "0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_ROOT = join(__dirname, "..", "temp");
const OUT_DIR = join(TEMP_ROOT, "neet-prelims");

const EXAM = {
    id: "neet-prelims",
    label: "NEET UG Prelims",
    count: 45,
    difficulty: "hard",
    subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
};

const slug = (s) =>
    String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

const topicFor = (subject) =>
    `Competitive › Medical › NEET › ${subject}`;

const toCategoryPath = (topic) =>
    topic
        .split("›")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(">");

function formatQuestion(q, index) {
    const lines = [];
    lines.push(`Question ${index + 1}`);
    lines.push(`Type: ${q.questionType || "single"}`);
    lines.push(`Stem: ${q.questionText}`);
    const opts = q.options || [];
    const letters = ["A", "B", "C", "D"];
    opts.forEach((opt, i) => {
        if (String(opt || "").trim()) {
            lines.push(`  ${letters[i]}. ${opt}`);
        }
    });
    const correct =
        q.correctIndex != null ? letters[q.correctIndex] : "?";
    lines.push(`Correct: ${correct}`);
    lines.push(`Explanation: ${q.explanation || ""}`);
    lines.push("");
    return lines.join("\n");
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
    const args = process.argv.slice(2);
    let subjectFilter = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--subject" && args[i + 1]) {
            subjectFilter = slug(args[++i]);
        }
    }
    return { subjectFilter };
}

async function callGenerate(
    generateQuestionBankSuggestions,
    subject,
    singleCount,
    excludeQuestionTexts,
    { continuation = false } = {}
) {
    const topic = topicFor(subject);
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            return await generateQuestionBankSuggestions({
                topic,
                bankName: `${EXAM.label} — ${subject}`,
                difficulty: EXAM.difficulty,
                singleCount,
                multipleCount: 0,
                trueFalseCount: 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
                excludeQuestionTexts,
                categoryPaths: [toCategoryPath(topic)],
                sectionName: subject,
                subject,
                generationProvider: "gemini",
                generationMode: "default",
                inferCountsIfMissing: false,
                maxSelectableSlots: EXAM.count,
                generateIntent: "initial",
                topicRelevanceEvaluated: false,
                topicRelevanceRegenerated: false,
                hasGeneratedQuestions: continuation,
                allowContinuation: continuation,
            });
        } catch (err) {
            lastErr = err;
            const wait = 5000 * attempt;
            console.warn(
                `  Attempt ${attempt} failed: ${err.message}. Waiting ${wait / 1000}s...`
            );
            await sleep(wait);
        }
    }
    throw lastErr;
}

async function generateSubject(subject, generateQuestionBankSuggestions) {
    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, `${slug(subject)}.txt`);
    const topic = topicFor(subject);

    const header = [
        `${EXAM.label} — ${subject}`,
        "=".repeat(60),
        `Topic: ${topic}`,
        `Category path: ${toCategoryPath(topic)}`,
        `Section: ${subject}`,
        `Target: ${EXAM.count} single-answer MCQs`,
        `Difficulty: ${EXAM.difficulty}`,
        `Provider: Gemini`,
        `RUN: ${new Date().toISOString()}`,
        "",
        "—".repeat(60),
        "",
    ].join("\n");
    writeFileSync(outPath, header, "utf8");

    const started = Date.now();
    const allQuestions = [];
    const excludeQuestionTexts = [];
    let round = 0;
    const maxRounds = 8;

    while (allQuestions.length < EXAM.count && round < maxRounds) {
        round += 1;
        const need = EXAM.count - allQuestions.length;
        const batchSize = Math.min(need, 10);
        const continuation = allQuestions.length > 0;

        console.log(
            `  ${subject} round ${round}: requesting ${batchSize} (${allQuestions.length}/${EXAM.count})`
        );

        const result = await callGenerate(
            generateQuestionBankSuggestions,
            subject,
            batchSize,
            excludeQuestionTexts,
            { continuation }
        );

        const batch = result?.questions ?? result ?? [];
        for (const q of batch) {
            if (!q?.questionText) continue;
            if (excludeQuestionTexts.includes(q.questionText)) continue;
            allQuestions.push(q);
            excludeQuestionTexts.push(q.questionText);
            if (allQuestions.length >= EXAM.count) break;
        }
    }

    const questions = allQuestions.slice(0, EXAM.count);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const meta = [
        `Subject: ${subject}`,
        `Received: ${questions.length} / ${EXAM.count} questions (${round} generate call(s))`,
        `Elapsed: ${elapsed}s`,
        "",
    ].join("\n");
    appendFileSync(outPath, meta, "utf8");
    appendFileSync(
        outPath,
        questions.map((q, i) => formatQuestion(q, i)).join("\n"),
        "utf8"
    );

    console.log(
        `  ✓ ${questions.length}/${EXAM.count} ${subject} → ${outPath} (${elapsed}s)`
    );
    return questions;
}

function writeCombinedPaper(bySubject) {
    const combinedPath = join(OUT_DIR, "NEET_Prelims_Full_Paper.txt");
    const lines = [
        "NEET UG Prelims — Full Question Paper",
        "=".repeat(72),
        `Generated: ${new Date().toISOString()}`,
        "Sections: Physics (45), Chemistry (45), Botany (45), Zoology (45)",
        `Total: ${Object.values(bySubject).reduce((n, qs) => n + qs.length, 0)} questions`,
        "",
    ];

    let globalIndex = 0;
    for (const subject of EXAM.subjects) {
        const qs = bySubject[subject] || [];
        lines.push("");
        lines.push("#".repeat(72));
        lines.push(`SECTION: ${subject.toUpperCase()} (${qs.length} questions)`);
        lines.push("#".repeat(72));
        lines.push("");
        for (const q of qs) {
            globalIndex += 1;
            lines.push(formatQuestion(q, globalIndex - 1));
        }
    }

    writeFileSync(combinedPath, lines.join("\n"), "utf8");
    console.log(`\nCombined paper → ${combinedPath}`);
    return combinedPath;
}

async function main() {
    const { subjectFilter } = parseArgs();

    if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY not set. Check firstedu-backend/.env");
        process.exit(1);
    }

    const { generateQuestionBankSuggestions } = await import(
        "../src/services/aiQuestion.service.js"
    );

    console.log(
        `${EXAM.label}: ${EXAM.count} MCQs × ${EXAM.subjects.length} sections\n`
    );

    const bySubject = {};
    for (const subject of EXAM.subjects) {
        if (subjectFilter && slug(subject) !== subjectFilter) continue;
        console.log(`\n[${subject}]`);
        bySubject[subject] = await generateSubject(
            subject,
            generateQuestionBankSuggestions
        );
    }

    if (!subjectFilter) {
        writeCombinedPaper(bySubject);
    } else if (existsSync(join(OUT_DIR, "physics.txt"))) {
        // Single-subject run: skip combined unless all four exist
        console.log("Single-subject run complete (combined paper skipped).");
    }

    const total = Object.values(bySubject).reduce((n, qs) => n + qs.length, 0);
    console.log(`\nDone. ${total} questions generated.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
