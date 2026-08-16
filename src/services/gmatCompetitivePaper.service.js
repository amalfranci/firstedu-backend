import { ApiError } from "../utils/ApiError.js";
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

export const generateGmatQuestionSet = async (excludeQuestionIds = []) => {
  const excluded = new Set((excludeQuestionIds || []).map((id) => String(id)));
  const all = await GmatCompetitiveQuestion.find({ isActive: true }).lean();
  if (!all.length) {
    throw new ApiError(400, "No GMAT questions are stored in the database.");
  }

  let unused = all.filter((q) => !excluded.has(String(q._id)));
  let groups = groupBySubject(unused);
  let remainingSets = possibleSetsFromCounts(countBySubject(groups));

  if (remainingSets < 1) {
    unused = all;
    groups = groupBySubject(unused);
    remainingSets = possibleSetsFromCounts(countBySubject(groups));
  }

  if (remainingSets < 1) {
    throw new ApiError(
      400,
      "Not enough GMAT questions to build a full paper (21 Quant + 23 Verbal + 20 Data Insights)."
    );
  }

  const picked = [];
  SUBJECT_ORDER.forEach((subject) => {
    shuffle(groups[subject])
      .slice(0, FULL_SET_COUNTS[subject])
      .forEach((question, index) => {
        picked.push({
          ...mapQuestion(question),
          subject,
          displayNumber: picked.length + 1,
          subjectNumber: index + 1,
        });
      });
  });

  return {
    exam: "GMAT",
    examType: "gmat",
    title: "GMAT Combined Paper",
    durationMinutes: 135,
    totalQuestions: picked.length,
    totalMarks: picked.reduce((sum, q) => sum + (q.marks || 1), 0),
    pattern: FULL_SET_COUNTS,
    sections: SUBJECT_ORDER.map((subject) => ({
      subject,
      count: FULL_SET_COUNTS[subject],
      questions: picked.filter((q) => q.subject === subject),
    })),
    questions: picked,
  };
};

export default { generateGmatQuestionSet };
