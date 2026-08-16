import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Category, { Subcategory } from "../models/Category.js";
import Test from "../models/Test.js";
import JeeMainCompetitivePaper from "../models/JeeMainCompetitivePaper.js";
import JeeMainCompetitiveQuestion from "../models/JeeMainCompetitiveQuestion.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBJECT_SECTION_INDEX = {
  mathematics: 0,
  maths: 0,
  math: 0,
  physics: 1,
  chemistry: 2,
};

const candidateSourceDirs = () => {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "files", "jee-main-competitive-papers"),
    path.resolve(__dirname, "../../files/jee-main-competitive-papers"),
    path.resolve(cwd, "../JEE MAIN EXAM - PROPER - QUESTIONS SET"),
    path.resolve(__dirname, "../../../JEE MAIN EXAM - PROPER - QUESTIONS SET"),
    path.resolve(cwd, "JEE MAIN EXAM - PROPER - QUESTIONS SET"),
  ];
};

const listJsonFiles = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const resolveSourceDir = () => {
  for (const dir of candidateSourceDirs()) {
    if (listJsonFiles(dir).length) return dir;
  }
  return null;
};

const paperKeyFromFile = (fileName, raw, index) => {
  const fileMatch = String(fileName).match(/paper\s*[-_]?(\d+)/i);
  if (fileMatch) return `JEE-MAIN-Paper${fileMatch[1]}`;
  const id = String(raw?.paper_id || "").trim();
  if (id) return id;
  return `JEE-MAIN-Paper${index + 1}`;
};

const discoverPaperSpecs = (sourceDir) => {
  const files = listJsonFiles(sourceDir);
  return files.map((fileName, index) => {
    const filePath = path.join(sourceDir, fileName);
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn(`Skipping invalid JSON: ${fileName} (${error.message})`);
      return null;
    }

    const fromFile = path.basename(fileName, path.extname(fileName));
    const paperKey = paperKeyFromFile(fileName, raw, index);
    const title =
      String(raw.title || "").trim() ||
      fromFile.replace(/[_-]+/g, " ") ||
      `JEE Main Paper ${index + 1}`;

    return {
      fileName,
      paperKey,
      title,
      sortOrder: index + 1,
      raw,
    };
  }).filter(Boolean);
};

const normalizeSubject = (raw) => {
  const value = String(raw || "").trim();
  const key = value.toLowerCase();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  return value || "Mathematics";
};

const optionEntries = (options) => {
  if (!options || typeof options !== "object") return [];
  return Object.entries(options).map(([key, text]) => ({
    key: String(key).trim().toUpperCase(),
    text: String(text ?? "").trim(),
  }));
};

const buildQuestionDocs = (paperId, paperKey, subjects = {}) => {
  const docs = [];
  let orderInPaper = 0;
  for (const [rawSubject, items] of Object.entries(subjects)) {
    if (!Array.isArray(items)) continue;
    const subject = normalizeSubject(rawSubject);
    const sectionIndex =
      SUBJECT_SECTION_INDEX[subject.toLowerCase()] ??
      SUBJECT_SECTION_INDEX[rawSubject.toLowerCase()] ??
      0;

    for (const item of items) {
      const entries = optionEntries(item.options);
      const correctKey = String(item.correct || "").trim().toUpperCase();
      const correctEntry =
        entries.find((opt) => opt.key === correctKey) || entries[0];
      const options = entries.map((opt) => ({
        key: opt.key,
        text: opt.text,
        isCorrect: opt.key === correctKey,
      }));

      docs.push({
        paper: paperId,
        paperKey,
        subject,
        questionNumber: Number(item.q) || orderInPaper + 1,
        section: item.section ? String(item.section) : null,
        questionText: String(item.question || "").trim(),
        topic: String(item.topic || "").trim(),
        questionType: "single",
        options,
        correctAnswer: correctEntry?.text || correctKey,
        explanation: String(item.explanation || "").trim(),
        marks: 4,
        negativeMarks: 1,
        difficulty: "medium",
        sectionIndex,
        orderInPaper,
        isActive: true,
      });
      orderInPaper += 1;
    }
  }
  return docs;
};

const ensureJeeMainCategory = async (adminId) => {
  let competitive = await Category.findOne({
    rootType: "Competitive",
    parent: null,
  });
  if (!competitive) {
    competitive = await Category.create({
      name: "Competitive",
      parent: null,
      order: 1,
      rootType: "Competitive",
      isPredefined: true,
      isActive: true,
      status: "Public",
      createdBy: adminId,
    });
  }

  const nameRegex = /^jee\s*[-_]?\s*mains?$/i;
  const existingMatches = await Category.find({
    rootType: "Competitive",
    name: nameRegex,
  }).sort({ createdAt: 1 });

  let jeeMain =
    existingMatches.find((c) => /^jee\s*mains$/i.test(c.name)) ||
    existingMatches.find((c) => /^jee\s*main$/i.test(c.name)) ||
    existingMatches[0] ||
    null;

  if (!jeeMain) {
    jeeMain = await Subcategory.create({
      name: "JEE Main",
      parent: competitive._id,
      order: 0,
      rootType: "Competitive",
      isPredefined: false,
      isActive: true,
      status: "Public",
      isFree: true,
      price: 0,
      discountedPrice: 0,
      description:
        "Official-style JEE Main full-length papers stored in the dedicated JEE Main question table.",
      subjects: ["Mathematics", "Physics", "Chemistry"],
      createdBy: adminId,
    });
    console.log("Created Competitive > JEE Main category");
  } else {
    await Category.updateOne(
      { _id: jeeMain._id },
      {
        $set: {
          isActive: true,
          status: "Public",
          rootType: "Competitive",
        },
      }
    );
    console.log(`Using existing category: ${jeeMain.name} (${jeeMain._id})`);
  }

  return { competitive, jeeMain };
};

export const seedJeeMainCompetitivePapers = async ({ replace = true } = {}) => {
  const sourceDir = resolveSourceDir();
  if (!sourceDir) {
    console.warn(
      "JEE Main paper JSON folder not found. Skipped JEE Main competitive seed."
    );
    return { seeded: false, reason: "source_missing" };
  }

  const admin =
    (await Admin.findOne({ email: "iscorre2026@gmail.com" })) ||
    (await Admin.findOne());
  if (!admin) {
    console.warn("No admin found. Skipped JEE Main competitive seed.");
    return { seeded: false, reason: "admin_missing" };
  }

  const { jeeMain } = await ensureJeeMainCategory(admin._id);
  const paperSpecs = discoverPaperSpecs(sourceDir);
  if (!paperSpecs.length) {
    console.warn(`No JEE Main JSON papers found in ${sourceDir}`);
    return { seeded: false, reason: "no_json_files", sourceDir };
  }

  if (replace) {
    const incomingKeys = paperSpecs.map((spec) => spec.paperKey);
    const stalePapers = await JeeMainCompetitivePaper.find({
      paperKey: { $nin: incomingKeys },
    }).select("_id paperKey");
    const staleIds = stalePapers.map((p) => p._id);
    if (staleIds.length) {
      await JeeMainCompetitiveQuestion.deleteMany({ paper: { $in: staleIds } });
      await Test.deleteMany({ jeeMainPaper: { $in: staleIds } });
      await JeeMainCompetitivePaper.deleteMany({ _id: { $in: staleIds } });
      console.log(
        `Removed stale JEE Main papers: ${stalePapers.map((p) => p.paperKey).join(", ")}`
      );
    }
    await JeeMainCompetitiveQuestion.deleteMany({
      paperKey: { $in: incomingKeys },
    });
  }

  const results = [];

  for (const spec of paperSpecs) {
    const raw = spec.raw;
    const questionDocsPreview = buildQuestionDocs(
      new mongoose.Types.ObjectId(),
      spec.paperKey,
      raw.subjects || {}
    );
    const totalQuestions = questionDocsPreview.length;
    const totalMarks = totalQuestions * 4;

    const paper = await JeeMainCompetitivePaper.findOneAndUpdate(
      { paperKey: spec.paperKey },
      {
        $set: {
          paperKey: spec.paperKey,
          sourcePaperId: raw.paper_id || spec.paperKey,
          title: spec.title,
          description: `${spec.title} — Mathematics, Physics and Chemistry.`,
          examType: "jee_main",
          pillar: "Competitive",
          subjects: ["Mathematics", "Physics", "Chemistry"],
          durationMinutes: 180,
          totalQuestions,
          totalMarks,
          marksPerQuestion: 4,
          negativeMarks: 1,
          sourceFile: spec.fileName,
          isPublished: true,
          isActive: true,
          sortOrder: spec.sortOrder,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (replace) {
      await JeeMainCompetitiveQuestion.deleteMany({ paper: paper._id });
    }

    const questionDocs = buildQuestionDocs(
      paper._id,
      spec.paperKey,
      raw.subjects || {}
    );
    if (questionDocs.length) {
      await JeeMainCompetitiveQuestion.insertMany(questionDocs);
    }

    const test = await Test.findOneAndUpdate(
      { jeeMainPaper: paper._id },
      {
        $set: {
          title: spec.title,
          description: `${spec.title} fetched from the JEE Main competitive question table.`,
          jeeMainPaper: paper._id,
          questionBank: null,
          aiQuestionBank: null,
          paperSource: "jee_main_db",
          categoryId: jeeMain._id,
          applicableFor: "Competitive",
          durationMinutes: 180,
          price: 0,
          isPublished: true,
          createdBy: admin._id,
          passingPercentage: 0,
          rewardPoints: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    results.push({
      paperKey: spec.paperKey,
      paperId: paper._id,
      testId: test._id,
      questions: questionDocs.length,
    });
    console.log(
      `Seeded ${spec.paperKey}: ${questionDocs.length} questions (test ${test._id})`
    );
  }

  return { seeded: true, sourceDir, papers: results };
};

export default seedJeeMainCompetitivePapers;
