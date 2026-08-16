import Paper, { SscCglTier2CompetitiveQuestion } from "../models/SscCglTier2CompetitivePaper.js";
import { createCompetitiveSeed } from "./competitiveExamFactory.js";

export const seedSscCglTier2CompetitivePapers = createCompetitiveSeed({
  Paper,
  Question: SscCglTier2CompetitiveQuestion,
  examType: "ssc_cgl_tier2",
  paperKeyPrefix: "SSC-CGL-T2-Paper",
  subjects: [
    "Mathematical Abilities",
    "Reasoning and General Intelligence",
    "English Language and Comprehension",
    "General Awareness",
    "Computer Knowledge",
  ],
  durationMinutes: 135,
  marksPerQuestion: 3,
  negativeMarks: 1,
  description: (title) => `${title} — Maths, Reasoning, English, GA and Computer.`,
  sourceDirs: ["files/ssc-cgl-tier2-competitive-papers"],
  fileFilter: /ssc-cgl-t2-paper/i,
});

export default seedSscCglTier2CompetitivePapers;
