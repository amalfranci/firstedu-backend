import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getAiPoweredTestExamTopics } from "../services/aiPoweredTestExamTopics.service.js";

/**
 * GET /admin/ai-powered-test/exam-topics
 * Seeded syllabus topics for the currently selected exam (AI Powered Test).
 * Query: examType, exam, subject, categoryPath, categoryPaths
 */
export const listAiPoweredTestExamTopics = asyncHandler(async (req, res) => {
  const payload = await getAiPoweredTestExamTopics({
    examType: req.query.examType,
    exam: req.query.exam,
    subject: req.query.subject,
    paper: req.query.paper,
    paperNumber: req.query.paperNumber,
    categoryPath: req.query.categoryPath,
    categoryPaths: req.query.categoryPaths ?? req.query["categoryPaths[]"],
  });

  return res.status(200).json(
    ApiResponse.success(
      payload,
      payload.examType
        ? payload.hasSeededTopics
          ? "Seeded exam topics fetched successfully"
          : "No seeded topics for this exam"
        : "Select an exam to load seeded topics",
      {
        examType: payload.examType,
        subject: payload.subject,
        topicCount: payload.topics.length,
        subjectCount: payload.subjects.length,
      }
    )
  );
});
