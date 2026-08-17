import { ApiError } from "../utils/ApiError.js";
import { generateUniqueCompetitivePaper } from "../utils/uniquePaperPicker.js";
import GmatCompetitiveQuestion from "../models/GmatCompetitiveQuestion.js";

const FULL_SET_COUNTS = {
  "Quantitative Reasoning": 21,
  "Verbal Reasoning": 23,
  "Data Insights": 20,
};
const SUBJECT_ORDER = Object.keys(FULL_SET_COUNTS);

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("quant")) return "Quantitative Reasoning";
  if (key.includes("verbal")) return "Verbal Reasoning";
  if (key.includes("data") || key.includes("insight")) return "Data Insights";
  return String(raw || "").trim();
};

const shuffle = (items = []) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const mapQuestion = (question) => ({
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
  })),
  explanation: question.explanation || "",
  correctAnswer: question.correctAnswer,
  marks: question.marks ?? 1,
  negativeMarks: question.negativeMarks ?? 0,
});

const groupBySubject = (questions = []) => {
  const groups = Object.fromEntries(SUBJECT_ORDER.map((s) => [s, []]));
  questions.forEach((q) => {
    const subject = normalizeSubject(q.subject);
    if (groups[subject]) groups[subject].push(q);
  });
  return groups;
};

const countBySubject = (groups) =>
  Object.fromEntries(
    SUBJECT_ORDER.map((subject) => [subject, groups[subject]?.length || 0])
  );

const possibleSetsFromCounts = (counts) =>
  Math.min(
    ...SUBJECT_ORDER.map((subject) =>
      Math.floor((counts[subject] || 0) / FULL_SET_COUNTS[subject])
    )
  );

export const generateGmatQuestionSet = async (
  excludeQuestionIds = [],
  options = {}
) =>
  generateUniqueCompetitivePaper({
    loadQuestions: () => GmatCompetitiveQuestion.find({ isActive: true }).lean(),
    examType: "gmat",
    examLabel: "GMAT",
    counts: FULL_SET_COUNTS,
    durationMinutes: 135,
    marksPerQuestion: 1,
    negativeMarks: 0,
    normalizeSubject,
    excludeQuestionIds,
    subject: options.subject,
    count: options.count,
    typeCounts: options.typeCounts,
    allowedTypes: options.allowedTypes,
    mapQuestion,
  });

export default { generateGmatQuestionSet };
