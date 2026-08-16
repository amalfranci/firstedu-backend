import Question from "../models/UpscCompetitiveQuestion.js";
import { createCompetitiveGenerator } from "../utils/competitiveExamFactory.js";

const SUBJECTS = [
  "History",
  "Indian Polity and Governance",
  "Geography",
  "Economic and Social Development",
  "Environment and Ecology",
  "General Science",
  "Current Affairs",
];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("histor") || key.includes("culture") || key.includes("art")) return SUBJECTS[0];
  if (key.includes("polit") || key.includes("governance") || key.includes("constitution")) return SUBJECTS[1];
  if (key.includes("geograph")) return SUBJECTS[2];
  if (key.includes("econom") || key.includes("social development")) return SUBJECTS[3];
  if (key.includes("environment") || key.includes("ecolog") || key.includes("biodivers")) return SUBJECTS[4];
  if (key.includes("science") || key.includes("technolog")) return SUBJECTS[5];
  if (key.includes("current")) return SUBJECTS[6];
  return SUBJECTS[6];
};

export const generateUpscQuestionSet = createCompetitiveGenerator({
  Question,
  examType: "upsc",
  examLabel: "UPSC Prelims GS Paper I",
  counts: {
    History: 15,
    "Indian Polity and Governance": 15,
    Geography: 14,
    "Economic and Social Development": 14,
    "Environment and Ecology": 14,
    "General Science": 10,
    "Current Affairs": 18,
  },
  durationMinutes: 120,
  marksPerQuestion: 2,
  negativeMarks: 0.66,
  normalizeSubject,
});

export default { generateUpscQuestionSet };
