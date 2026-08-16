import Question from "../models/CatCompetitiveQuestion.js";
import { createCompetitiveGenerator } from "../utils/competitiveExamFactory.js";

const SUBJECTS = [
  "Verbal Ability and Reading Comprehension",
  "Data Interpretation and Logical Reasoning",
  "Quantitative Ability",
];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("varc") || key.includes("verbal") || key.includes("reading")) return SUBJECTS[0];
  if (key.includes("dilr") || key.includes("data") || key.includes("logical")) return SUBJECTS[1];
  if (key.includes("quant")) return SUBJECTS[2];
  return SUBJECTS[2];
};

export const generateCatQuestionSet = createCompetitiveGenerator({
  Question,
  examType: "cat",
  examLabel: "CAT",
  counts: {
    [SUBJECTS[0]]: 24,
    [SUBJECTS[1]]: 22,
    [SUBJECTS[2]]: 22,
  },
  durationMinutes: 120,
  marksPerQuestion: 3,
  negativeMarks: 1,
  normalizeSubject,
});

export default { generateCatQuestionSet };
