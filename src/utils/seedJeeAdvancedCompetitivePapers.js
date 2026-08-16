import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JeeAdvancedCompetitivePaper from "../models/JeeAdvancedCompetitivePaper.js";
import JeeAdvancedCompetitiveQuestion from "../models/JeeAdvancedCompetitiveQuestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUBJECT_SECTION_INDEX = {
  mathematics: 0,
  maths: 0,
  math: 0,
  physics: 1,
  chemistry: 2,
};

const candidateDirs = () => [
  path.resolve(process.cwd(), "files/jee-advanced-competitive-papers"),
  path.resolve(__dirname, "../../files/jee-advanced-competitive-papers"),
  path.resolve(process.cwd(), "../JEE MAIN ADVANCE"),
  path.resolve(__dirname, "../../../JEE MAIN ADVANCE"),
];

const listJson = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".json") && /advanced|advance/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const resolveDir = () => candidateDirs().find((d) => listJson(d).length) || null;

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  return String(raw || "").trim() || "Mathematics";
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
        topic: String(item.topic || "").trim(),
        questionType: correctKeys.length > 1 ? "multiple" : "single",
        options,
        correctAnswer: correctKeys.length > 1 ? correctKeys : correctText,
        explanation: String(item.explanation || "").trim(),
        marks: 4,
        negativeMarks: 1,
        difficulty: "hard",
        sectionIndex,
        orderInPaper: order,
        isActive: true,
      });
      order += 1;
    }
  }
  return docs;
};

export const seedJeeAdvancedCompetitivePapers = async ({ replace = true } = {}) => {
  const sourceDir = resolveDir();
  if (!sourceDir) {
    console.warn("JEE Advanced JSON folder not found.");
    return { seeded: false, reason: "source_missing" };
  }

  const files = listJson(sourceDir);
  const results = [];

  if (replace) {
    const incoming = files.map((f, i) => {
      const n = String(f).match(/paper\s*[-_]?(\d+)/i);
      return n ? `JEE-ADVANCED-Paper${n[1]}` : `JEE-ADVANCED-Paper${i + 1}`;
    });
    const stale = await JeeAdvancedCompetitivePaper.find({
      paperKey: { $nin: incoming },
    }).select("_id");
    if (stale.length) {
      const ids = stale.map((p) => p._id);
      await JeeAdvancedCompetitiveQuestion.deleteMany({ paper: { $in: ids } });
      await JeeAdvancedCompetitivePaper.deleteMany({ _id: { $in: ids } });
    }
    await JeeAdvancedCompetitiveQuestion.deleteMany({
      paperKey: { $in: incoming },
    });
  }

  for (const [index, fileName] of files.entries()) {
    const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), "utf8"));
    const match = String(fileName).match(/paper\s*[-_]?(\d+)/i);
    const paperKey =
      raw.paper_id && String(raw.paper_id).includes("ADVANCED")
        ? String(raw.paper_id)
        : match
          ? `JEE-ADVANCED-Paper${match[1]}`
          : `JEE-ADVANCED-Paper${index + 1}`;
    const title = String(raw.title || "").trim() || `JEE Advanced Paper ${index + 1}`;
    const preview = buildQuestions(null, paperKey, raw.subjects || {});

    const paper = await JeeAdvancedCompetitivePaper.findOneAndUpdate(
      { paperKey },
      {
        $set: {
          paperKey,
          sourcePaperId: raw.paper_id || paperKey,
          title,
          description: `${title} — Mathematics, Physics and Chemistry.`,
          examType: "jee_advanced",
          pillar: "Competitive",
          subjects: ["Mathematics", "Physics", "Chemistry"],
          durationMinutes: 180,
          totalQuestions: preview.length,
          totalMarks: preview.length * 4,
          marksPerQuestion: 4,
          negativeMarks: 1,
          sourceFile: fileName,
          isPublished: true,
          isActive: true,
          sortOrder: index + 1,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (replace) {
      await JeeAdvancedCompetitiveQuestion.deleteMany({ paper: paper._id });
    }
    const docs = buildQuestions(paper._id, paperKey, raw.subjects || {});
    if (docs.length) await JeeAdvancedCompetitiveQuestion.insertMany(docs);
    results.push({ paperKey, paperId: paper._id, questions: docs.length });
    console.log(`Seeded ${paperKey}: ${docs.length} questions`);
  }

  return { seeded: true, sourceDir, papers: results };
};

export default seedJeeAdvancedCompetitivePapers;
