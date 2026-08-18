/**
 * Ingests real JEE Main past papers (files/jee-mains/*.txt, JSON despite the
 * extension) into the DB as REFERENCE-ONLY AiQuestion/AiQuestionBank records
 * for question-corpus RAG (questionCorpusRag.service.js) to retrieve from.
 *
 * These are curated real papers, not AI-generated — explanations are
 * deliberately left empty (not present in the source) rather than fabricated.
 * Bypasses aiQuestionBank.service.js's createAiQuestionBankWithQuestions
 * (which requires non-empty explanation) via direct model writes, since that
 * validation is designed for admin-reviewed AI content, not this case.
 *
 * Each source file becomes ONE AiQuestionBank with 3 sections (Physics/
 * Chemistry/Maths, split evenly by question_number — JEE Main's fixed
 * section order and size). generationTopic is deliberately set to
 * "Competitive > Engineering > JEE Main" (no subject suffix) so it prefix-
 * matches retrieval queries for any of the three subjects.
 *
 * Only "single_choice" questions are ingested — "integer_or_numerical"
 * questions have no options, which doesn't match the always-4-option MCQ
 * format the generator actually produces, so they'd be a format-mismatched
 * (and unhelpful) RAG exemplar.
 *
 * RUN (from firstedu-backend): node scripts/ingest-jee-mains-reference-papers.mjs
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

const { default: AiQuestionBank } = await import("../src/models/AiQuestionBank.js");
const { default: AiQuestion } = await import("../src/models/AiQuestion.js");
const { default: Admin } = await import("../src/models/Admin.js");

const SOURCE_DIR = path.join(BACKEND_ROOT, "files", "jee-mains");
const GENERATION_TOPIC = "Competitive > Engineering > JEE Main";
const SECTION_NAMES = ["Physics", "Chemistry", "Maths"];

const admin = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
if (!admin) throw new Error(`No admin found for ADMIN_EMAIL="${process.env.ADMIN_EMAIL}".`);

// ── JSON repair for source files (raw LaTeX backslashes aren't valid JSON escapes) ──
const stripFences = (text) =>
    text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

const fixInvalidJsonEscapes = (text) => {
    let out = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== "\\") {
            inString = !inString;
            out += ch;
            continue;
        }
        if (inString && ch === "\\") {
            const next = text[i + 1];
            if (next && "\"\\/bfnrtu".includes(next)) {
                out += ch + next;
                i++;
            } else {
                out += "\\\\";
            }
            continue;
        }
        out += ch;
    }
    return out;
};

const cleanText = (s) =>
    String(s || "")
        .replace(/\[cite:\s*\d+\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();

const cleanOption = (s) => cleanText(s).replace(/^\(\d+\)\s*/, "");

const parseAnswerIndex = (answer) => {
    const m = String(answer || "").match(/\((\d+)\)/);
    return m ? Number(m[1]) - 1 : -1;
};

const files = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".txt"));
console.log(`Found ${files.length} source paper(s).`);

let banksCreated = 0;
let questionsCreated = 0;
let numericSkipped = 0;

for (const file of files) {
    const raw = fs.readFileSync(path.join(SOURCE_DIR, file), "utf8");
    let data;
    try {
        data = JSON.parse(fixInvalidJsonEscapes(stripFences(raw)));
    } catch (err) {
        console.error(`SKIP ${file}: failed to parse — ${err.message}`);
        continue;
    }

    const allQuestions = data.questions || [];
    const sectionSize = Math.round(allQuestions.length / 3);

    const perSection = [[], [], []]; // Physics, Chemistry, Maths
    for (const q of allQuestions) {
        const sectionIdx = Math.min(2, Math.floor((q.question_number - 1) / sectionSize));
        if (q.type !== "single_choice") {
            numericSkipped++;
            continue;
        }
        const correctIdx = parseAnswerIndex(q.answer);
        const options = (q.options || []).map((o, i) => ({
            text: cleanOption(o),
            isCorrect: i === correctIdx,
        }));
        if (correctIdx < 0 || !options[correctIdx] || options.length < 2) {
            console.warn(`  ! ${file} Q${q.question_number}: unresolvable answer/options, skipped`);
            continue;
        }
        perSection[sectionIdx].push({
            questionText: cleanText(q.text),
            questionType: "single",
            options,
            correctAnswer: options[correctIdx].text,
            // AiQuestion.explanation is schema-required (non-empty) — this is a clear
            // placeholder, not a fabricated derivation. Not shown to the LLM: the RAG
            // exemplar formatter (questionCorpusRag.service.js) only ever renders
            // question text + options + marked answer, never explanation.
            explanation: "[No explanation provided in source paper]",
            marks: 1,
            negativeMarks: 1,
        });
    }

    const totalIngestable = perSection.reduce((s, arr) => s + arr.length, 0);
    if (!totalIngestable) {
        console.warn(`SKIP ${file}: no ingestible single_choice questions.`);
        continue;
    }

    const bank = await AiQuestionBank.create({
        name: cleanText(data.title) || file,
        categories: [],
        overallDifficulty: "hard",
        useSectionWise: true,
        negativeMarks: 1,
        sections: SECTION_NAMES.map((name, i) => ({
            id: i + 1,
            name,
            count: perSection[i].length,
            difficulty: "hard",
        })).filter((s) => s.count > 0),
        aiProvider: "reference",
        generationTopic: GENERATION_TOPIC,
        questionCount: totalIngestable,
        createdBy: admin._id,
    });

    const docs = [];
    let orderInBank = 0;
    SECTION_NAMES.forEach((_, sectionIdx) => {
        if (!perSection[sectionIdx].length) return;
        for (const q of perSection[sectionIdx]) {
            docs.push({
                ...q,
                aiQuestionBank: bank._id,
                orderInBank: orderInBank++,
                sectionIndex: sectionIdx,
                createdBy: admin._id,
                isActive: true,
            });
        }
    });
    await AiQuestion.insertMany(docs);

    banksCreated++;
    questionsCreated += docs.length;
    console.log(
        `+ ${bank.name}: ${docs.length} questions (Physics ${perSection[0].length}, Chemistry ${perSection[1].length}, Maths ${perSection[2].length}) -> bank ${bank._id}`
    );
}

console.log(
    `\nDone. ${banksCreated} bank(s) created, ${questionsCreated} question(s) ingested, ${numericSkipped} numerical-type question(s) skipped (no options — format-incompatible with generator MCQ output).`
);
process.exit(0);
