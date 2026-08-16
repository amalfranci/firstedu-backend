import Question from "../models/SscCglTier2CompetitiveQuestion.js";
import { createCompetitiveGenerator } from "../utils/competitiveExamFactory.js";

const SUBJECTS = [
  "Mathematical Abilities",
  "Reasoning and General Intelligence",
  "English Language and Comprehension",
  "General Awareness",
  "Computer Knowledge",
];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("math") || key.includes("quant")) return SUBJECTS[0];
  if (key.includes("reason") || key.includes("intelligence")) return SUBJECTS[1];
  if (key.includes("english")) return SUBJECTS[2];
  if (key.includes("awareness") || key.includes("gk")) return SUBJECTS[3];
  if (key.includes("computer")) return SUBJECTS[4];
  return SUBJECTS[0];
};

export const generateSscCglTier2QuestionSet = createCompetitiveGenerator({
  Question,
  examType: "ssc_cgl_tier2",
  examLabel: "SSC CGL Tier 2",
  counts: {
    [SUBJECTS[0]]: 30,
    [SUBJECTS[1]]: 30,
    [SUBJECTS[2]]: 45,
    [SUBJECTS[3]]: 25,
    [SUBJECTS[4]]: 20,
  },
  durationMinutes: 135,
  marksPerQuestion: 3,
  negativeMarks: 1,
  normalizeSubject,
});

export default { generateSscCglTier2QuestionSet };
