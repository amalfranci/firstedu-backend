/**
 * Generates a JEE Main paper (Physics + Chemistry + Maths, 25 singles each)
 * using generationMode "question_rag", grounded in the real past-paper
 * corpus ingested by scripts/ingest-jee-mains-reference-papers.mjs. Writes
 * the raw output to temp/rag/jee-mains/<file>.json — no DB save.
 *
 * RUN (from firstedu-backend): node scripts/generate-jee-mains-rag-json.mjs
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
process.chdir(BACKEND_ROOT);
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

const connectDB = (await import("../src/config/db.js")).default;
await connectDB();
const svc = (await import("../src/services/aiQuestion.service.js")).default;

const QUESTIONS_PER_SUBJECT = 25;
const DIFFICULTY = "hard";
const SUBJECTS = [
    { label: "Physics", topic: "Competitive > Engineering > JEE Main > Physics" },
    { label: "Chemistry", topic: "Competitive > Engineering > JEE Main > Chemistry" },
    { label: "Maths", topic: "Competitive > Engineering > JEE Main > Maths" },
];

const OUT_DIR = path.join(BACKEND_ROOT, "temp", "rag", "jee-mains");
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const OUT_FILE = path.join(OUT_DIR, `jee-mains-rag-${stamp}.json`);

const SUBJECT_RETRY_ATTEMPTS = 2; // covers transient network/RAG-retrieval failures, not quality regens

const generateSubject = async (s, attempt = 1) => {
    console.log(`\n=== ${s.label}: requesting ${QUESTIONS_PER_SUBJECT} singles via question_rag (attempt ${attempt}/${SUBJECT_RETRY_ATTEMPTS}) ===`);
    let questions = [];
    try {
        const res = await svc.generateQuestionBankSuggestions({
            topic: s.topic,
            bankName: s.topic,
            difficulty: DIFFICULTY,
            categoryPaths: [],
            sectionName: s.label,
            subject: s.label,
            generationProvider: "gemini",
            singleCount: QUESTIONS_PER_SUBJECT,
            multipleCount: 0,
            trueFalseCount: 0,
            passageCount: 0,
            passageSingleCount: 0,
            passageMultipleCount: 0,
            passageTrueFalseCount: 0,
            excludeQuestionTexts: [],
            generateIntent: "initial",
            topicRelevanceFeedback: null,
            topicRelevanceEvaluated: false,
            topicRelevanceRegenerated: false,
            hasGeneratedQuestions: false,
            allowContinuation: false,
            inferCountsIfMissing: false,
            maxSelectableSlots: QUESTIONS_PER_SUBJECT,
            competitiveExamPlan: null,
            deferValidation: false,
            generationMode: "question_rag",
        });
        questions = Array.isArray(res?.questions) ? res.questions : [];
    } catch (err) {
        console.error(`  ✗ ${s.label} generation failed (attempt ${attempt}): ${err?.message || err}`);
    }

    // A whole-subject failure here is almost always transient infra (network blip,
    // RAG embedding-API hiccup) rather than a quality problem — those already get
    // handled per-question inside generateQuestionBankSuggestions. Retrying the
    // whole subject is cheap relative to losing 25 questions to one bad network call.
    if (!questions.length && attempt < SUBJECT_RETRY_ATTEMPTS) {
        return generateSubject(s, attempt + 1);
    }

    console.log(`  → produced ${questions.length}/${QUESTIONS_PER_SUBJECT} (${s.label})`);

    return {
        subject: s.label,
        topic: s.topic,
        requested: QUESTIONS_PER_SUBJECT,
        produced: questions.length,
        questions: questions.map((q) => {
            const opts = Array.isArray(q.options) ? q.options : [];
            const correctIdx = Number.isFinite(Number(q.correctIndex)) ? Number(q.correctIndex) : -1;
            return {
                questionText: q.questionText,
                options: opts.map((o) => (typeof o === "object" ? o.text : o)),
                correctIndex: correctIdx,
                correctAnswer: opts[correctIdx]
                    ? (typeof opts[correctIdx] === "object" ? opts[correctIdx].text : opts[correctIdx])
                    : null,
                explanation: q.explanation || "",
                difficultyTier: q.difficulty || q.difficultyTier || null,
                conceptSlot: q._conceptSlot || null,
                questionKind: q._questionKind || null,
            };
        }),
    };
};

// Subjects share NO state (separate topic, separate exclude list) — running them
// concurrently instead of one-after-another cuts wall-clock time roughly 3x with
// no quality tradeoff, and shortens the window each subject is exposed to
// transient API failures.
const sectionsBySubject = await Promise.all(SUBJECTS.map((s) => generateSubject(s)));

const result = {
    generatedAt: new Date().toISOString(),
    generationMode: "question_rag",
    difficulty: DIFFICULTY,
    ragReference: "real past-paper corpus (files/jee-mains, ingested via ingest-jee-mains-reference-papers.mjs)",
    sections: sectionsBySubject,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");

const totalProduced = result.sections.reduce((sum, s) => sum + s.produced, 0);
console.log(`\n✓ Wrote ${totalProduced}/${QUESTIONS_PER_SUBJECT * SUBJECTS.length} questions to ${OUT_FILE}`);
process.exit(0);
