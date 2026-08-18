/**
 * Generates a JEE Main paper (Physics + Chemistry + Maths, 25 singles each)
 * using generationMode "question_rag" — each subject retrieves style/pattern
 * exemplars from previously-confirmed questions before generating, then all
 * three sections are saved as one multi-section bank.
 *
 * Modeled on scripts/testing-flow.mjs's bootstrap; calls the same service
 * functions the admin frontend / controllers use, so behaviour matches
 * production exactly.
 *
 * RUN (from the firstedu-backend folder):
 *     node scripts/generate-jee-mains-rag-paper.mjs
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
process.chdir(BACKEND_ROOT);
dotenv.config({ path: path.join(BACKEND_ROOT, ".env") });

const connectDB = (await import("../src/config/db.js")).default;
const svc = (await import("../src/services/aiQuestion.service.js")).default;
const { createAiQuestionBankWithQuestions } = await import(
    "../src/services/aiQuestionBank.service.js"
);
const { default: Admin } = await import("../src/models/Admin.js");

// ============================================================================
// CONFIG
// ============================================================================
const QUESTIONS_PER_SUBJECT = 25;
const DIFFICULTY = "hard";
const SUBJECTS = [
    { label: "Physics", topic: "Competitive > Engineering > JEE Main > Physics" },
    { label: "Chemistry", topic: "Competitive > Engineering > JEE Main > Chemistry" },
    { label: "Maths", topic: "Competitive > Engineering > JEE Main > Maths" },
];
const BANK_NAME = `JEE Main - RAG Paper - ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
// ============================================================================

const toBankQuestion = (q, subjectLabel) => {
    const rawOptions = Array.isArray(q.options) ? q.options : [];
    const correctIdx = Number.isFinite(Number(q.correctIndex))
        ? Number(q.correctIndex)
        : -1;
    const options = rawOptions.map((o, i) => ({
        text: String(typeof o === "object" && o !== null ? o.text : o),
        isCorrect: i === correctIdx,
    }));
    return {
        questionText: q.questionText,
        questionType: "single",
        options,
        correctAnswer: options[correctIdx]?.text ?? "",
        explanation: q.explanation || "",
        subject: subjectLabel,
        difficulty: q.difficulty || q.difficultyTier || DIFFICULTY,
        marks: 1,
        negativeMarks: 1,
    };
};

const run = async () => {
    console.log("Connecting to DB…");
    await connectDB();

    const admin = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    if (!admin) {
        throw new Error(
            `No admin found for ADMIN_EMAIL="${process.env.ADMIN_EMAIL}" — cannot set createdBy.`
        );
    }

    const sections = [];
    const allQuestions = [];
    const summary = [];

    for (let i = 0; i < SUBJECTS.length; i++) {
        const s = SUBJECTS[i];
        console.log(
            `\n=== ${s.label}: requesting ${QUESTIONS_PER_SUBJECT} singles via question_rag ===`
        );
        let got = [];
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
            got = Array.isArray(res?.questions) ? res.questions : [];
        } catch (err) {
            console.error(`  ✗ ${s.label} generation failed: ${err?.message || err}`);
        }

        console.log(`  → produced ${got.length}/${QUESTIONS_PER_SUBJECT}`);
        if (got.length < QUESTIONS_PER_SUBJECT) {
            console.warn(
                `  ⚠ ${s.label} short by ${QUESTIONS_PER_SUBJECT - got.length} — check pipeline trace for QUESTION_RAG_RETRIEVAL_EMPTY/_FAILED (no matching prior bank/questions to ground on is expected if this is the first JEE Main ${s.label} bank).`
            );
        }

        summary.push({ subject: s.label, requested: QUESTIONS_PER_SUBJECT, produced: got.length });
        sections.push({ id: i + 1, name: s.label, count: got.length, difficulty: DIFFICULTY });
        got.forEach((q) => allQuestions.push(toBankQuestion(q, s.label)));
    }

    if (!allQuestions.length) {
        console.error("\nNo questions were generated for any subject — aborting save.");
        process.exit(1);
    }

    console.log("\n=== Saving bank ===");
    const { bank } = await createAiQuestionBankWithQuestions(
        {
            name: BANK_NAME,
            categories: [],
            overallDifficulty: DIFFICULTY,
            useSectionWise: true,
            negativeMarks: 1,
            sections: sections.filter((s) => s.count > 0),
            aiProvider: "gemini",
            generationTopic: "Competitive > Engineering > JEE Main",
            questions: allQuestions,
        },
        admin._id
    );

    console.log(`\n✓ Bank created: ${bank?._id} ("${bank?.name}")`);
    console.log("Summary:", JSON.stringify(summary, null, 2));
    process.exit(0);
};

run().catch((err) => {
    console.error("\nFATAL:", err?.message || err);
    console.error(err?.stack);
    process.exit(1);
});
