import { createCompetitiveModels } from "../utils/competitiveExamFactory.js";

const { Paper, Question } = createCompetitiveModels({
  paperModel: "CatCompetitivePaper",
  questionModel: "CatCompetitiveQuestion",
  examType: "cat",
  subjects: [
    "Verbal Ability and Reading Comprehension",
    "Data Interpretation and Logical Reasoning",
    "Quantitative Ability",
  ],
  durationMinutes: 120,
  marksPerQuestion: 3,
  negativeMarks: 1,
});

export { Question as CatCompetitiveQuestion };
export default Paper;
