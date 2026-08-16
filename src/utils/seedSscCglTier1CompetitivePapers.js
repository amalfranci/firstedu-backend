import Paper, { SscCglTier1CompetitiveQuestion } from "../models/SscCglTier1CompetitivePaper.js";
import { createCompetitiveSeed } from "./competitiveExamFactory.js";

export const seedSscCglTier1CompetitivePapers = createCompetitiveSeed({
  Paper,
  Question: SscCglTier1CompetitiveQuestion,
  examType: "ssc_cgl_tier1",
  paperKeyPrefix: "SSC-CGL-T1-Paper",
  subjects: [
    "General Intelligence and Reasoning",
    "General Awareness",
    "Quantitative Aptitude",
    "English Comprehension",
  ],
  durationMinutes: 60,
  marksPerQuestion: 2,
  negativeMarks: 0.5,
  description: (title) => `${title} — Reasoning, GA, Quant and English.`,
  sourceDirs: ["files/ssc-cgl-tier1-competitive-papers"],
  fileFilter: /ssc-cgl-t1-paper/i,
});

export default seedSscCglTier1CompetitivePapers;
