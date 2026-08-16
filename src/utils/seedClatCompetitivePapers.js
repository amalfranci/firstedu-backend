import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ClatCompetitivePaper from "../models/ClatCompetitivePaper.js";
import ClatCompetitiveQuestion from "../models/ClatCompetitiveQuestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUBJECT_SECTION_INDEX = {
  "english language": 0,
  "current affairs including general knowledge": 1,
  "legal reasoning": 2,
  "logical reasoning": 3,
  "quantitative techniques": 4,
};

const candidateDirs = () => [
  path.resolve(process.cwd(), "files/clat-competitive-papers"),
  path.resolve(__dirname, "../../files/clat-competitive-papers"),
  path.resolve(process.cwd(), "../CLAT_EXAM"),
  path.resolve(__dirname, "../../../CLAT_EXAM"),
];

const listJson = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".json") && /clat-paper/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const resolveDir = () => candidateDirs().find((d) => listJson(d).length) || null;

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("english")) return "English Language";
  if (key.includes("current") || key.includes("general knowledge")) {
    return "Current Affairs including General Knowledge";
  }
  if (key.includes("legal")) return "Legal Reasoning";
  if (key.includes("logical")) return "Logical Reasoning";
  if (key.includes("quant")) return "Quantitative Techniques";
  return String(raw || "").trim() || "English Language";
};

const buildQuestions = (paperId, paperKey, subjects = {}) => {
  const docs = [];
  let order = 0;
  for (const [rawSubject, items] of Object.entries(subjects)) {
    if (!Array.isArray(items)) continue;
    const subject = normalizeSubject(rawSubject);
    const sectionIndex = SUBJECT_SECTION_INDEX[subject.toLowerCase()] ?? 0;
    for (const item of items) {
      const entries = Object.entries(item.options || {}).map(([key, text]) => ({
        key: String(key).toUpperCase(),
        text: String(text ?? "").trim(),
      }));
      const correctRaw = String(item.correct || "A").toUpperCase();
      const correctKeys = correctRaw.split(",").map((k) => k.trim()).filter(Boolean);
      const options = entries.map((opt) => ({
        ...opt,
        isCorrect: correctKeys.includes(opt.key),
      }));
      const correctText =
        entries.find((o) => o.key === correctKeys[0])?.text || correctKeys[0];
      docs.push({
        paper: paperId,
        paperKey,
        subject,
        questionNumber: Number(item.q) || order + 1,
        questionText: String(item.question || "").trim(),
        passage: String(item.passage || "").trim(),
        topic: String(item.topic || "").trim(),
        questionType: correctKeys.length > 1 ? "multiple" : "single",
        options,
        correctAnswer: correctKeys.length > 1 ? correctKeys : correctText,
        explanation: String(item.explanation || "").trim(),
        marks: 1,
        negativeMarks: 0.25,
        difficulty: "medium",
        sectionIndex,
        orderInPaper: order,
        isActive: true,
      });
      order += 1;
    }
  }
  return docs;
};

export const seedClatCompetitivePapers = async ({ replace = true } = {}) => {
  const sourceDir = resolveDir();
  if (!sourceDir) {
    console.warn("CLAT JSON folder not found.");
    return { seeded: false, reason: "source_missing" };
  }

  const files = listJson(sourceDir);
  const results = [];

  if (replace) {
    const incoming = files.map((f, i) => {
      const n = String(f).match(/paper\s*[-_]?(\d+)/i);
      return n ? `CLAT-Paper${n[1]}` : `CLAT-Paper${i + 1}`;
    });
    const stale = await ClatCompetitivePaper.find({
      paperKey: { $nin: incoming },
    }).select("_id");
    if (stale.length) {
      const ids = stale.map((p) => p._id);
      await ClatCompetitiveQuestion.deleteMany({ paper: { $in: ids } });
      await ClatCompetitivePaper.deleteMany({ _id: { $in: ids } });
    }
    await ClatCompetitiveQuestion.deleteMany({ paperKey: { $in: incoming } });
  }

  for (const [index, fileName] of files.entries()) {
    const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), "utf8"));
    const match = String(fileName).match(/paper\s*[-_]?(\d+)/i);
    const paperKey =
      raw.paper_id && String(raw.paper_id).startsWith("CLAT")
        ? String(raw.paper_id)
        : match
          ? `CLAT-Paper${match[1]}`
          : `CLAT-Paper${index + 1}`;
    const title = String(raw.title || "").trim() || `CLAT Paper ${index + 1}`;
    const preview = buildQuestions(null, paperKey, raw.subjects || {});

    const paper = await ClatCompetitivePaper.findOneAndUpdate(
      { paperKey },
      {
        $set: {
          paperKey,
          sourcePaperId: raw.paper_id || paperKey,
          title,
          description: `${title} — English, Current Affairs, Legal, Logical and Quantitative.`,
          examType: "clat",
          pillar: "Competitive",
          subjects: [
            "English Language",
            "Current Affairs including General Knowledge",
            "Legal Reasoning",
            "Logical Reasoning",
            "Quantitative Techniques",
          ],
          durationMinutes: 120,
          totalQuestions: preview.length,
          totalMarks: preview.length,
          marksPerQuestion: 1,
          negativeMarks: 0.25,
          sourceFile: fileName,
          isPublished: true,
          isActive: true,
          sortOrder: index + 1,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (replace) {
      await ClatCompetitiveQuestion.deleteMany({ paper: paper._id });
    }
    const docs = buildQuestions(paper._id, paperKey, raw.subjects || {});
    if (docs.length) await ClatCompetitiveQuestion.insertMany(docs);
    results.push({ paperKey, paperId: paper._id, questions: docs.length });
    console.log(`Seeded ${paperKey}: ${docs.length} questions`);
  }

  return { seeded: true, sourceDir, papers: results };
};

export default seedClatCompetitivePapers;
