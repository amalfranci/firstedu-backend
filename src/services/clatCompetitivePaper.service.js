import { ApiError } from "../utils/ApiError.js";
import { generateUniqueCompetitivePaper } from "../utils/uniquePaperPicker.js";
import ClatCompetitiveQuestion from "../models/ClatCompetitiveQuestion.js";

const FULL_SET_COUNTS = {
  "English Language": 24,
  "Current Affairs including General Knowledge": 30,
  "Legal Reasoning": 30,
  "Logical Reasoning": 24,
  "Quantitative Techniques": 12,
};
const SUBJECT_ORDER = Object.keys(FULL_SET_COUNTS);

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("english")) return "English Language";
  if (key.includes("current") || key.includes("general knowledge")) {
    return "Current Affairs including General Knowledge";
  }
  if (key.includes("legal")) return "Legal Reasoning";
  if (key.includes("logical")) return "Logical Reasoning";
  if (key.includes("quant")) return "Quantitative Techniques";
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
  negativeMarks: question.negativeMarks ?? 0.25,
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

export const generateClatQuestionSet = async (
  excludeQuestionIds = [],
  options = {}
) =>
  generateUniqueCompetitivePaper({
    loadQuestions: () => ClatCompetitiveQuestion.find({ isActive: true }).lean(),
    examType: "clat",
    examLabel: "CLAT",
    counts: FULL_SET_COUNTS,
    durationMinutes: 120,
    marksPerQuestion: 1,
    negativeMarks: 0.25,
    normalizeSubject,
    excludeQuestionIds,
    subject: options.subject,
    count: options.count,
    typeCounts: options.typeCounts,
    allowedTypes: options.allowedTypes,
    mapQuestion,
  });

export default { generateClatQuestionSet };
