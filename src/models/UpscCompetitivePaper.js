import { createCompetitiveModels } from "../utils/competitiveExamFactory.js";

const { Paper, Question } = createCompetitiveModels({
  paperModel: "UpscCompetitivePaper",
  questionModel: "UpscCompetitiveQuestion",
  examType: "upsc",
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
});

export { Question as UpscCompetitiveQuestion };
export default Paper;
