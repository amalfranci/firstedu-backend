import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getAiPoweredTestExamBlueprint } from "../services/aiPoweredTestExamBlueprint.service.js";

/**
 * GET /admin/ai-powered-test/exam-blueprint
 * Syllabus topics, exam-native hard difficulty, and paper question types
 * for the currently selected exam (AI Powered Test).
 */
export const getAiPoweredTestExamBlueprintController = asyncHandler(
  async (req, res) => {
    const payload = await getAiPoweredTestExamBlueprint({
      examType: req.query.examType,
      exam: req.query.exam,
      subject: req.query.subject,
      paper: req.query.paper,
      paperNumber: req.query.paperNumber,
      categoryPath: req.query.categoryPath,
      categoryPaths:
        req.query.categoryPaths ?? req.query["categoryPaths[]"],
    });

    return res.status(200).json(
      ApiResponse.success(
        payload,
        payload.examType
          ? "Exam generation blueprint fetched successfully"
          : "Select an exam to load syllabus, difficulty, and question types",
        {
          examType: payload.examType,
          subject: payload.subject,
          topicCount: payload.topics.length,
          questionTypeCount: payload.questionTypes.length,
          difficulty: payload.difficulty?.default || null,
        }
      )
    );
  }
);
