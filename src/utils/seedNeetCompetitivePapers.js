import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import NeetCompetitivePaper from "../models/NeetCompetitivePaper.js";
import NeetCompetitiveQuestion from "../models/NeetCompetitiveQuestion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUBJECT_SECTION_INDEX = {
  physics: 0,
  chemistry: 1,
  botany: 2,
  zoology: 3,
};

const candidateDirs = () => [
  path.resolve(process.cwd(), "files/neet-competitive-papers"),
  path.resolve(__dirname, "../../files/neet-competitive-papers"),
  path.resolve(process.cwd(), "../NEET EXAM-JSON -FILE"),
  path.resolve(__dirname, "../../../NEET EXAM-JSON -FILE"),
];

const listJson = (dir) => {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".json") && /neet.*paper/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const resolveDir = () => candidateDirs().find((d) => listJson(d).length) || null;

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  if (key.startsWith("bot")) return "Botany";
  if (key.startsWith("zoo")) return "Zoology";
  return String(raw || "").trim() || "Physics";
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

export const seedNeetCompetitivePapers = async ({ replace = true } = {}) => {
  const sourceDir = resolveDir();
  if (!sourceDir) {
    console.warn("NEET JSON folder not found.");
    return { seeded: false, reason: "source_missing" };
  }

  const files = listJson(sourceDir);
  const results = [];

  if (replace) {
    const incoming = files.map((f, i) => {
      const n = String(f).match(/paper\s*[-_]?(\d+)/i);
      return n ? `NEET-Paper${n[1]}` : `NEET-Paper${i + 1}`;
    });
    const stale = await NeetCompetitivePaper.find({
      paperKey: { $nin: incoming },
    }).select("_id");
    if (stale.length) {
      const ids = stale.map((p) => p._id);
      await NeetCompetitiveQuestion.deleteMany({ paper: { $in: ids } });
      await NeetCompetitivePaper.deleteMany({ _id: { $in: ids } });
    }
    await NeetCompetitiveQuestion.deleteMany({ paperKey: { $in: incoming } });
  }

  for (const [index, fileName] of files.entries()) {
    const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), "utf8"));
    const match = String(fileName).match(/paper\s*[-_]?(\d+)/i);
    const paperKey =
      raw.paper_id && String(raw.paper_id).startsWith("NEET")
        ? String(raw.paper_id)
        : match
          ? `NEET-Paper${match[1]}`
          : `NEET-Paper${index + 1}`;
    const title = String(raw.title || "").trim() || `NEET Paper ${index + 1}`;
    const preview = buildQuestions(null, paperKey, raw.subjects || {});

    const paper = await NeetCompetitivePaper.findOneAndUpdate(
      { paperKey },
      {
        $set: {
          paperKey,
          sourcePaperId: raw.paper_id || paperKey,
          title,
          description: `${title} — Physics, Chemistry, Botany and Zoology.`,
          examType: "neet",
          pillar: "Competitive",
          subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
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
      await NeetCompetitiveQuestion.deleteMany({ paper: paper._id });
    }
    const docs = buildQuestions(paper._id, paperKey, raw.subjects || {});
    if (docs.length) await NeetCompetitiveQuestion.insertMany(docs);
    results.push({ paperKey, paperId: paper._id, questions: docs.length });
    console.log(`Seeded ${paperKey}: ${docs.length} questions`);
  }

  return { seeded: true, sourceDir, papers: results };
};

export default seedNeetCompetitivePapers;
