import fs from "fs";
import path from "path";
import dotenv from "dotenv";
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

const INPUT_DIR = path.join(
  BACKEND_ROOT,
  "question paper with explanation",
  "sections-only"
);

const SEED_BANK_NAME =
  "JEE Main (Question Paper with Explanation - sections-only)";
const GENERATION_TOPIC = "Competitive > Engineering > JEE Main";
const AI_PROVIDER = "reference";

const SECTION_ORDER = [
  { label: "Physics", sectionIndex: 0 },
  { label: "Chemistry", sectionIndex: 1 },
  { label: "Mathematics", sectionIndex: 2 },
];

const BANK_SECTION_NAMES = ["Physics", "Chemistry", "Maths"];

const normalizeAnswerKey = (ans) => {
  const s = String(ans ?? "").trim();
  if (!s) return null;
  // answers are often "1","2","3","4"
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 4) return String(n);
  return s;
};

const loadAllSectionQuestions = (subject) => {
  const fileName = `ALL_${subject}.json`;
  const filePath = path.join(INPUT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing input file: ${fileName}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const questions = data?.sections?.[subject]?.questions;
  if (!Array.isArray(questions) || !questions.length) {
    console.warn(`[seed] No questions found for ${subject} in ${fileName}`);
    return [];
  }
  return questions;
};

const upsertBankIfMissing = async ({ countsBySubject }) => {
  const existing = await AiQuestionBank.findOne({
    name: SEED_BANK_NAME,
  });
  if (existing) {
    console.log(`[seed] Bank already exists: ${existing._id} (${SEED_BANK_NAME})`);
    return { bank: existing, created: false };
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const admin = await Admin.findOne({ email: adminEmail });
  if (!admin) {
    throw new Error(`No admin found for ADMIN_EMAIL="${adminEmail}"`);
  }

  const sections = SECTION_ORDER.map(({ label, sectionIndex }) => {
    const count = countsBySubject[label] || 0;
    // Required by schema: min 1
    if (count < 1) {
      throw new Error(`[seed] Missing questions for ${label} (count=${count}). Seed only when all 3 subjects have data.`);
    }
    return {
      id: sectionIndex + 1,
      name: BANK_SECTION_NAMES[sectionIndex],
      count,
      difficulty: "hard",
      timeMinutes: 0,
      negativeMarks: 1,
      contentType: "text",
    };
  });

  const bank = await AiQuestionBank.create({
    name: SEED_BANK_NAME,
    categories: [],
    overallDifficulty: "hard",
    useSectionWise: true,
    negativeMarks: 1,
    sections,
    aiProvider: AI_PROVIDER,
    generationTopic: GENERATION_TOPIC,
    questionCount: sections.reduce((s, x) => s + (x.count || 0), 0),
    createdBy: admin._id,
  });

  console.log(`[seed] Created bank: ${bank._id} with ${bank.questionCount} questions`);
  return { bank, created: true };
};

const buildOptions = (optionsObj) => {
  if (!optionsObj || typeof optionsObj !== "object") return [];
  // options keys are "1","2","3","4"
  const keys = Object.keys(optionsObj)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return keys.map((k) => String(optionsObj[String(k)] ?? ""));
};

const seedQuestionsForSubject = async ({ bankId, subjectLabel, sectionIndex, questions }) => {
  if (!questions.length) return 0;
  let orderInBank = 0;

  // Simple dedupe: if questions already exist, skip inserting new to avoid duplicates.
  const existingCount = await AiQuestion.countDocuments({
    aiQuestionBank: bankId,
    sectionIndex,
  });
  if (existingCount > 0) {
    console.log(`[seed] Skipping ${subjectLabel}: already has ${existingCount} questions`);
    return 0;
  }

  const docs = [];
  for (const q of questions) {
    const optionsTexts = buildOptions(q.options);
    if (optionsTexts.length < 2) continue; // MCQ expected

    const ansKey = normalizeAnswerKey(q.answer);
    // Determine which option is correct.
    let correctIdx = -1;
    if (ansKey && optionsTexts.length >= 4) {
      const n = Number(ansKey);
      if (Number.isFinite(n) && n >= 1 && n <= optionsTexts.length) {
        correctIdx = n - 1;
      }
    }

    // Fallback: if answer is the exact option text
    if (correctIdx < 0 && ansKey != null) {
      correctIdx = optionsTexts.findIndex((t) => String(t).trim() === String(ansKey).trim());
    }

    if (correctIdx < 0) {
      continue;
    }

    const optionDocs = optionsTexts.map((text, idx) => ({
      text: String(text || "").trim(),
      isCorrect: idx === correctIdx,
    }));

    const correctAnswer = optionDocs[correctIdx]?.text;
    const explanation = String(q.solution || q.explanation || "").trim();
    if (!explanation) continue;

    docs.push({
      questionText: String(q.question || q.question_text || "").trim(),
      questionType: "single",
      options: optionDocs,
      correctAnswer,
      explanation,
      marks: 1,
      negativeMarks: 1,
      subject: subjectLabel,
      aiQuestionBank: bankId,
      orderInBank: orderInBank++,
      sectionIndex,
      topic: "",
      difficulty: "hard",
      aiBatchNumber: null,
      tags: ["jee_main", "reference"],
      createdBy: null, // overridden below
      isActive: true,
      isParent: false,
      parentQuestionId: null,
      connectedQuestions: [],
      childQuestions: [],
      passage: undefined,
    });
  }

  if (!docs.length) {
    console.log(`[seed] No docs built for ${subjectLabel} (after validation).`);
    return 0;
  }

  // createdBy is required: reuse admin from bank doc.
  const bank = await AiQuestionBank.findById(bankId).lean();
  const createdBy = bank?.createdBy || null;
  for (const d of docs) d.createdBy = createdBy;

  await AiQuestion.insertMany(docs, { ordered: false });
  console.log(`[seed] Seeded ${subjectLabel}: inserted ${docs.length} questions`);
  return docs.length;
};

const main = async () => {
  ensureInput();
  const countsBySubject = {};
  for (const { label } of SECTION_ORDER) {
    const questions = loadAllSectionQuestions(label);
    countsBySubject[label] = questions.length;
  }

  const { bank } = await upsertBankIfMissing({ countsBySubject });

  for (const { label, sectionIndex } of SECTION_ORDER) {
    const questions = loadAllSectionQuestions(label);
    await seedQuestionsForSubject({
      bankId: bank._id,
      subjectLabel: label,
      sectionIndex,
      questions,
    });
  }

  console.log("[seed] Done.");
  process.exit(0);
};

function ensureInput() {
  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`Missing input dir: ${INPUT_DIR}`);
  }
  for (const { label } of SECTION_ORDER) {
    const f = path.join(INPUT_DIR, `ALL_${label}.json`);
    if (!fs.existsSync(f)) {
      throw new Error(`Missing required file: ${f}`);
    }
  }
}

main().catch((err) => {
  console.error("[seed] Failed:", err?.message || err);
  process.exit(1);
});

