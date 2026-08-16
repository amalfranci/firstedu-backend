import Question from "../models/SscCglTier1CompetitiveQuestion.js";
import { createCompetitiveGenerator } from "../utils/competitiveExamFactory.js";

const SUBJECTS = [
  "General Intelligence and Reasoning",
  "General Awareness",
  "Quantitative Aptitude",
  "English Comprehension",
];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("reason") || key.includes("intelligence")) return SUBJECTS[0];
  if (key.includes("awareness") || key.includes("gk")) return SUBJECTS[1];
  if (key.includes("quant")) return SUBJECTS[2];
  if (key.includes("english")) return SUBJECTS[3];
  return SUBJECTS[0];
};

export const generateSscCglTier1QuestionSet = createCompetitiveGenerator({
  Question,
  examType: "ssc_cgl_tier1",
  examLabel: "SSC CGL Tier 1",
  counts: {
    [SUBJECTS[0]]: 25,
    [SUBJECTS[1]]: 25,
    [SUBJECTS[2]]: 25,
    [SUBJECTS[3]]: 25,
  },
  durationMinutes: 60,
  marksPerQuestion: 2,
  negativeMarks: 0.5,
  normalizeSubject,
});

export default { generateSscCglTier1QuestionSet };
