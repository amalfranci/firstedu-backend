import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { ApiError } from "./ApiError.js";
import { generateUniqueCompetitivePaper } from "./uniquePaperPicker.js";

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true },
    text: { type: String, required: true, trim: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

export const createCompetitiveModels = ({
  paperModel,
  questionModel,
  examType,
  subjects,
  durationMinutes,
  marksPerQuestion,
  negativeMarks,
}) => {
  const paperSchema = new mongoose.Schema(
    {
      paperKey: { type: String, required: true, unique: true, trim: true },
      sourcePaperId: { type: String, trim: true, default: "" },
      title: { type: String, required: true, trim: true },
      description: { type: String, trim: true, default: "" },
      examType: { type: String, default: examType, trim: true },
      pillar: { type: String, default: "Competitive", trim: true },
      subjects: { type: [String], default: subjects },
      durationMinutes: { type: Number, default: durationMinutes, min: 1 },
      totalQuestions: { type: Number, default: 0, min: 0 },
      totalMarks: { type: Number, default: 0, min: 0 },
      marksPerQuestion: { type: Number, default: marksPerQuestion },
      negativeMarks: { type: Number, default: negativeMarks },
      sourceFile: { type: String, trim: true, default: "" },
      isPublished: { type: Boolean, default: true },
      isActive: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true }
  );
  paperSchema.index({ examType: 1, isPublished: 1 });
  paperSchema.index({ isActive: 1, sortOrder: 1 });

  const questionSchema = new mongoose.Schema(
    {
      paper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: paperModel,
        required: true,
        index: true,
      },
      paperKey: { type: String, required: true, trim: true, index: true },
      subject: { type: String, required: true, trim: true },
      questionNumber: { type: Number, required: true, min: 1 },
      questionText: { type: String, required: true, trim: true },
      passage: { type: String, trim: true, default: "" },
      topic: { type: String, trim: true, default: "", index: true },
      questionType: {
        type: String,
        enum: ["single", "multiple", "true_false"],
        default: "single",
      },
      options: { type: [optionSchema], default: [] },
      correctAnswer: { type: mongoose.Schema.Types.Mixed, required: true },
      explanation: { type: String, trim: true, default: "" },
      marks: { type: Number, default: marksPerQuestion },
      negativeMarks: { type: Number, default: negativeMarks },
      difficulty: {
        type: String,
        enum: ["easy", "medium", "hard"],
        default: "medium",
      },
      sectionIndex: { type: Number, default: 0, min: 0 },
      orderInPaper: { type: Number, required: true, min: 0 },
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
  );
  questionSchema.index({ paper: 1, orderInPaper: 1 });
  questionSchema.index({ paperKey: 1, orderInPaper: 1 });

  const Paper =
    mongoose.models[paperModel] || mongoose.model(paperModel, paperSchema);
  const Question =
    mongoose.models[questionModel] || mongoose.model(questionModel, questionSchema);
  return { Paper, Question };
};

const shuffle = (items = []) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export const createCompetitiveSeed = ({
  Paper,
  Question,
  examType,
  paperKeyPrefix,
  subjects,
  durationMinutes,
  marksPerQuestion,
  negativeMarks,
  description,
  sourceDirs,
  fileFilter,
}) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dirs = () =>
    sourceDirs.map((d) =>
      path.isAbsolute(d) ? d : path.resolve(process.cwd(), d)
    ).concat(
      sourceDirs.map((d) => path.resolve(__dirname, "../../", d))
    );

  const listJson = (dir) => {
    if (!dir || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".json") && fileFilter.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  const resolveDir = () => dirs().find((d) => listJson(d).length) || null;

  const subjectIndex = Object.fromEntries(
    subjects.map((s, i) => [s.toLowerCase(), i])
  );

  const normalizeSubject = (raw) => {
    const key = String(raw || "").toLowerCase();
    return (
      subjects.find((s) => key === s.toLowerCase() || key.includes(s.toLowerCase().slice(0, 12))) ||
      subjects[0]
    );
  };

  const buildQuestions = (paperId, paperKey, rawSubjects = {}) => {
    const docs = [];
    let order = 0;
    for (const [rawSubject, items] of Object.entries(rawSubjects)) {
      if (!Array.isArray(items)) continue;
      const subject = normalizeSubject(rawSubject);
      const sectionIndex = subjectIndex[subject.toLowerCase()] ?? 0;
      for (const item of items) {
        const entries = Object.entries(item.options || {}).map(([key, text]) => ({
          key: String(key).toUpperCase(),
          text: String(text ?? "").trim() || "-",
        }));
        const correctRaw = String(item.correct || "A").toUpperCase();
        const correctKeys = correctRaw
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
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
          marks: marksPerQuestion,
          negativeMarks,
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

  return async ({ replace = true } = {}) => {
    const sourceDir = resolveDir();
    if (!sourceDir) {
      console.warn(`${examType} JSON folder not found.`);
      return { seeded: false, reason: "source_missing" };
    }
    const files = listJson(sourceDir);
    const results = [];
    if (replace) {
      const incoming = files.map((f, i) => {
        const n = String(f).match(/paper\s*[-_]?(\d+)/i);
        return n ? `${paperKeyPrefix}${n[1]}` : `${paperKeyPrefix}${i + 1}`;
      });
      const stale = await Paper.find({ paperKey: { $nin: incoming } }).select("_id");
      if (stale.length) {
        const ids = stale.map((p) => p._id);
        await Question.deleteMany({ paper: { $in: ids } });
        await Paper.deleteMany({ _id: { $in: ids } });
      }
      await Question.deleteMany({ paperKey: { $in: incoming } });
    }

    for (const [index, fileName] of files.entries()) {
      const raw = JSON.parse(fs.readFileSync(path.join(sourceDir, fileName), "utf8"));
      const match = String(fileName).match(/paper\s*[-_]?(\d+)/i);
      const paperKey =
        raw.paper_id && String(raw.paper_id).startsWith(paperKeyPrefix.replace(/-Paper$/, ""))
          ? String(raw.paper_id)
          : match
            ? `${paperKeyPrefix}${match[1]}`
            : `${paperKeyPrefix}${index + 1}`;
      const title = String(raw.title || "").trim() || `${paperKeyPrefix.replace(/-/g, " ")}${match?.[1] || index + 1}`;
      const preview = buildQuestions(null, paperKey, raw.subjects || {});
      const paper = await Paper.findOneAndUpdate(
        { paperKey },
        {
          $set: {
            paperKey,
            sourcePaperId: raw.paper_id || paperKey,
            title,
            description: description(title),
            examType,
            pillar: "Competitive",
            subjects,
            durationMinutes,
            totalQuestions: preview.length,
            totalMarks: preview.length * marksPerQuestion,
            marksPerQuestion,
            negativeMarks,
            sourceFile: fileName,
            isPublished: true,
            isActive: true,
            sortOrder: index + 1,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (replace) await Question.deleteMany({ paper: paper._id });
      const docs = buildQuestions(paper._id, paperKey, raw.subjects || {});
      if (docs.length) await Question.insertMany(docs);
      results.push({ paperKey, paperId: paper._id, questions: docs.length });
      console.log(`Seeded ${paperKey}: ${docs.length} questions`);
    }
    return { seeded: true, sourceDir, papers: results };
  };
};

export const createCompetitiveGenerator = ({
  Question,
  examType,
  examLabel,
  counts,
  durationMinutes,
  marksPerQuestion,
  negativeMarks,
  normalizeSubject,
}) => {
  return async (excludeQuestionIds = [], options = {}) =>
    generateUniqueCompetitivePaper({
      loadQuestions: () => Question.find({ isActive: true }).lean(),
      examType,
      examLabel,
      counts,
      durationMinutes,
      marksPerQuestion,
      negativeMarks,
      normalizeSubject,
      excludeQuestionIds,
      subject: options.subject,
      count: options.count,
      typeCounts: options.typeCounts,
      allowedTypes: options.allowedTypes,
      mapQuestion: (question) => ({
        _id: question._id,
        questionId: question._id,
        paper: question.paper,
        paperKey: question.paperKey,
        subject: question.subject,
        topic: question.topic || "",
        passage: question.passage || "",
        questionNumber: question.questionNumber,
        questionText: question.questionText,
        questionType: question.questionType || "single",
        options: (question.options || []).map((opt) => ({
          _id: opt._id,
          key: opt.key || null,
          text: opt.text,
          isCorrect: Boolean(opt.isCorrect),
        })),
        explanation: question.explanation || "",
        correctAnswer: question.correctAnswer,
        marks: question.marks ?? marksPerQuestion,
        negativeMarks: question.negativeMarks ?? negativeMarks,
        difficulty: question.difficulty || "medium",
      }),
    });
};
