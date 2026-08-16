import { createCompetitiveModels } from "../utils/competitiveExamFactory.js";

const { Paper, Question } = createCompetitiveModels({
  paperModel: "SscCglTier1CompetitivePaper",
  questionModel: "SscCglTier1CompetitiveQuestion",
  examType: "ssc_cgl_tier1",
  subjects: [
    "General Intelligence and Reasoning",
    "General Awareness",
    "Quantitative Aptitude",
    "English Comprehension",
  ],
  durationMinutes: 60,
  marksPerQuestion: 2,
  negativeMarks: 0.5,
});

export { Question as SscCglTier1CompetitiveQuestion };
export default Paper;
