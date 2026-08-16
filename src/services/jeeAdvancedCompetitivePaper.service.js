import { ApiError } from "../utils/ApiError.js";
import JeeAdvancedCompetitiveQuestion from "../models/JeeAdvancedCompetitiveQuestion.js";

const FULL_SET_COUNTS = {
  Mathematics: 18,
  Physics: 18,
  Chemistry: 18,
};
const SUBJECT_ORDER = ["Mathematics", "Physics", "Chemistry"];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
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
  const groups = { Mathematics: [], Physics: [], Chemistry: [] };
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

export const generateJeeAdvancedQuestionSet = async (excludeQuestionIds = []) => {
  const excluded = new Set((excludeQuestionIds || []).map((id) => String(id)));
  const all = await JeeAdvancedCompetitiveQuestion.find({ isActive: true }).lean();
  if (!all.length) {
    throw new ApiError(400, "No JEE Advanced questions are stored in the database.");
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
      "Not enough JEE Advanced questions to build a full paper (18 Maths + 18 Physics + 18 Chemistry)."
    );
  }

  const picked = [];
  SUBJECT_ORDER.forEach((subject) => {
    shuffle(groups[subject]).slice(0, FULL_SET_COUNTS[subject]).forEach((question, index) => {
      picked.push({
        ...mapQuestion(question),
        subject,
        displayNumber: picked.length + 1,
        subjectNumber: index + 1,
      });
    });
  });

  return {
    exam: "JEE Advanced",
    examType: "jee_advanced",
    title: "JEE Advanced Combined Paper",
    durationMinutes: 180,
    totalQuestions: picked.length,
    totalMarks: picked.reduce((sum, q) => sum + (q.marks || 4), 0),
    pattern: FULL_SET_COUNTS,
    sections: SUBJECT_ORDER.map((subject) => ({
      subject,
      count: FULL_SET_COUNTS[subject],
      questions: picked.filter((q) => q.subject === subject),
    })),
    questions: picked,
  };
};

export default { generateJeeAdvancedQuestionSet };
