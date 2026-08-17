import { ApiError } from "../utils/ApiError.js";
import { generateUniqueCompetitivePaper } from "../utils/uniquePaperPicker.js";
import NeetCompetitiveQuestion from "../models/NeetCompetitiveQuestion.js";

const FULL_SET_COUNTS = {
  Physics: 45,
  Chemistry: 45,
  Botany: 45,
  Zoology: 45,
};
const SUBJECT_ORDER = ["Physics", "Chemistry", "Botany", "Zoology"];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  if (key.startsWith("bot")) return "Botany";
  if (key.startsWith("zoo")) return "Zoology";
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
  marks: question.marks ?? 4,
  negativeMarks: question.negativeMarks ?? 1,
});

const groupBySubject = (questions = []) => {
  const groups = { Physics: [], Chemistry: [], Botany: [], Zoology: [] };
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

export const generateNeetQuestionSet = async (
  excludeQuestionIds = [],
  options = {}
) =>
  generateUniqueCompetitivePaper({
    loadQuestions: () => NeetCompetitiveQuestion.find({ isActive: true }).lean(),
    examType: "neet",
    examLabel: "NEET",
    counts: FULL_SET_COUNTS,
    durationMinutes: 180,
    marksPerQuestion: 4,
    negativeMarks: 1,
    normalizeSubject,
    excludeQuestionIds,
    subject: options.subject,
    count: options.count,
    typeCounts: options.typeCounts,
    allowedTypes: options.allowedTypes,
    mapQuestion,
  });

export default { generateNeetQuestionSet };
