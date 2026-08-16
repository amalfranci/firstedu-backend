import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import GmatCompetitivePaper from "../models/GmatCompetitivePaper.js";
import GmatCompetitiveQuestion from "../models/GmatCompetitiveQuestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUBJECT_SECTION_INDEX = {
  "quantitative reasoning": 0,
  "verbal reasoning": 1,
  "data insights": 2,
};

const candidateDirs = () => [
  path.resolve(process.cwd(), "files/gmat-competitive-papers"),
  path.resolve(__dirname, "../../files/gmat-competitive-papers"),
  path.resolve(process.cwd(), "../GMAT EXAM"),
  path.resolve(__dirname, "../../../GMAT EXAM"),
];

const listJson = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".json") && /gmat-paper/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const resolveDir = () => candidateDirs().find((d) => listJson(d).length) || null;

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("quant")) return "Quantitative Reasoning";
  if (key.includes("verbal")) return "Verbal Reasoning";
  if (key.includes("data") || key.includes("insight")) return "Data Insights";
  return String(raw || "").trim() || "Quantitative Reasoning";
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
        negativeMarks: 0,
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

export const seedGmatCompetitivePapers = async ({ replace = true } = {}) => {
  const sourceDir = resolveDir();
  if (!sourceDir) {
    console.warn("GMAT JSON folder not found.");
    return { seeded: false, reason: "source_missing" };
  }

  const files = listJson(sourceDir);
  const results = [];

  if (replace) {
    const incoming = files.map((f, i) => {
      const n = String(f).match(/paper\s*[-_]?(\d+)/i);
      return n ? `GMAT-Paper${n[1]}` : `GMAT-Paper${i + 1}`;
    });
    const stale = await GmatCompetitivePaper.find({
      paperKey: { $nin: incoming },
    }).select("_id");
    if (stale.length) {
      const ids = stale.map((p) => p._id);
      await GmatCompetitiveQuestion.deleteMany({ paper: { $in: ids } });
      await GmatCompetitivePaper.deleteMany({ _id: { $in: ids } });
    }
    await GmatCompetitiveQuestion.deleteMany({ paperKey: { $in: incoming } });
  }

  for (const [index, fileName] of files.entries()) {
    const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), "utf8"));
    const match = String(fileName).match(/paper\s*[-_]?(\d+)/i);
    const paperKey =
      raw.paper_id && String(raw.paper_id).startsWith("GMAT")
        ? String(raw.paper_id)
        : match
          ? `GMAT-Paper${match[1]}`
          : `GMAT-Paper${index + 1}`;
    const title = String(raw.title || "").trim() || `GMAT Paper ${index + 1}`;
    const preview = buildQuestions(null, paperKey, raw.subjects || {});

    const paper = await GmatCompetitivePaper.findOneAndUpdate(
      { paperKey },
      {
        $set: {
          paperKey,
          sourcePaperId: raw.paper_id || paperKey,
          title,
          description: `${title} — Quantitative Reasoning, Verbal Reasoning and Data Insights.`,
          examType: "gmat",
          pillar: "Competitive",
          subjects: [
            "Quantitative Reasoning",
            "Verbal Reasoning",
            "Data Insights",
          ],
          durationMinutes: 135,
          totalQuestions: preview.length,
          totalMarks: preview.length,
          marksPerQuestion: 1,
          negativeMarks: 0,
          sourceFile: fileName,
          isPublished: true,
          isActive: true,
          sortOrder: index + 1,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (replace) {
      await GmatCompetitiveQuestion.deleteMany({ paper: paper._id });
    }
    const docs = buildQuestions(paper._id, paperKey, raw.subjects || {});
    if (docs.length) await GmatCompetitiveQuestion.insertMany(docs);
    results.push({ paperKey, paperId: paper._id, questions: docs.length });
    console.log(`Seeded ${paperKey}: ${docs.length} questions`);
  }

  return { seeded: true, sourceDir, papers: results };
};

export default seedGmatCompetitivePapers;
