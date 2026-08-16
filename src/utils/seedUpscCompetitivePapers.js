import Paper, { UpscCompetitiveQuestion } from "../models/UpscCompetitivePaper.js";
import { createCompetitiveSeed } from "./competitiveExamFactory.js";

export const seedUpscCompetitivePapers = createCompetitiveSeed({
  Paper,
  Question: UpscCompetitiveQuestion,
  examType: "upsc",
  paperKeyPrefix: "UPSC-GS-Paper",
  subjects: [
    "History",
    "Indian Polity and Governance",
    "Geography",
    "Economic and Social Development",
    "Environment and Ecology",
    "General Science",
    "Current Affairs",
  ],
  durationMinutes: 120,
  marksPerQuestion: 2,
  negativeMarks: 0.66,
  description: (title) => `${title} — UPSC Prelims GS Paper I.`,
  sourceDirs: ["files/upsc-competitive-papers"],
  fileFilter: /upsc-gs-paper/i,
});

export default seedUpscCompetitivePapers;
