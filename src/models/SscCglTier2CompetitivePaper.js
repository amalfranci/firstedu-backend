import { createCompetitiveModels } from "../utils/competitiveExamFactory.js";

const { Paper, Question } = createCompetitiveModels({
  paperModel: "SscCglTier2CompetitivePaper",
  questionModel: "SscCglTier2CompetitiveQuestion",
  examType: "ssc_cgl_tier2",
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
});

export { Question as SscCglTier2CompetitiveQuestion };
export default Paper;
