import Paper, { CatCompetitiveQuestion } from "../models/CatCompetitivePaper.js";
import { createCompetitiveSeed } from "./competitiveExamFactory.js";

export const seedCatCompetitivePapers = createCompetitiveSeed({
  Paper,
  Question: CatCompetitiveQuestion,
  examType: "cat",
  paperKeyPrefix: "CAT-Paper",
  subjects: [
    "Verbal Ability and Reading Comprehension",
    "Data Interpretation and Logical Reasoning",
    "Quantitative Ability",
  ],
  durationMinutes: 120,
  marksPerQuestion: 3,
  negativeMarks: 1,
  description: (title) => `${title} — VARC, DILR and Quantitative Ability.`,
  sourceDirs: ["files/cat-competitive-papers"],
  fileFilter: /cat-paper/i,
});

export default seedCatCompetitivePapers;
