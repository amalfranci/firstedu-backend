import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { attachAiPoweredTestExamContext } from "../middleware/aiPoweredTestExamContext.middleware.js";
import { listAiPoweredTestExamTopics } from "../controllers/aiPoweredTestExamTopics.controller.js";
import { getAiPoweredTestExamBlueprintController } from "../controllers/aiPoweredTestExamBlueprint.controller.js";
import {
  planQuestionBankTopics,
  generateQuestionBankSuggestions,
  getQuestionBankGenerationJobStatus,
  getQuestionBankBackgroundValidation,
  getPipelineEventsStatus,
  validateQuestionTopicRelevance,
  applyAnswerCorrection,
  logConfirmedQuestions,
} from "../controllers/aiQuestion.controller.js";
import {
  startExamQuestionJob,
  getExamQuestionJob,
  getExamQuestionJobStatus,
  resumeExamQuestionJob,
} from "../controllers/aiPoweredTest.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * AI Powered Test — one router for the admin bank-building flow, in the order
 * the screen uses it:
 *
 *   exam & subject  → GET  /exam-blueprint, GET /exam-topics
 *   plan chapters   → POST /topic-plan
 *   generate        → POST /questions        (async job)
 *                     GET  /questions/jobs/:jobId
 *                     GET  /questions/:generationId/status
 *                     POST /questions/jobs/:jobId/resume
 *                     GET  /questions/jobs/:jobId/validation
 *                     GET  /pipeline-events/:workflowLogKey
 *   review          → POST /topic-relevance
 *                     POST /answer-correction
 *   add to bank     → POST /confirmed-questions
 *
 * Mounted at /admin/ai-powered-test. Every write route runs through
 * attachAiPoweredTestExamContext so the selected paper — not the client —
 * decides difficulty and which question formats are in play.
 */
const router = Router();

router.use(verifyJWT);

router.get("/exam-topics", listAiPoweredTestExamTopics);
router.get("/exam-blueprint", getAiPoweredTestExamBlueprintController);

router.post("/topic-plan", attachAiPoweredTestExamContext, planQuestionBankTopics);

/**
 * JEE Advanced paper wizard posts `{ config: { typeCounts, totalQuestions, ... } }`.
 * Legacy AiSuggestionModal posts a flat body (`topic`, `singleCount`, …).
 */
const isAdvancedPaperStartBody = (body = {}) => {
  const config = body?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  if (config.typeCounts && typeof config.typeCounts === "object") return true;
  const total = Number(config.totalQuestions) || 0;
  const examType = String(config.examType || "").toLowerCase();
  if (total > 0 && (examType.includes("jee") || config.paper != null)) {
    return true;
  }
  return false;
};

const startQuestionsDispatcher = asyncHandler(async (req, res, next) => {
  if (isAdvancedPaperStartBody(req.body)) {
    return startExamQuestionJob(req, res, next);
  }
  return generateQuestionBankSuggestions(req, res, next);
});

router.post(
  "/questions",
  attachAiPoweredTestExamContext,
  startQuestionsDispatcher
);

const isPaperJobId = (jobId) =>
  String(jobId || "")
    .trim()
    .toLowerCase()
    .startsWith("apt-");

const getJobDispatcher = asyncHandler(async (req, res, next) => {
  if (isPaperJobId(req.params.jobId)) {
    return getExamQuestionJob(req, res, next);
  }
  return getQuestionBankGenerationJobStatus(req, res, next);
});

router.get("/questions/jobs/:jobId", getJobDispatcher);
router.post("/questions/jobs/:jobId/resume", resumeExamQuestionJob);
router.get(
  "/questions/:generationId/status",
  getExamQuestionJobStatus
);
router.get(
  "/questions/jobs/:jobId/validation",
  getQuestionBankBackgroundValidation
);
router.get("/pipeline-events/:workflowLogKey", getPipelineEventsStatus);

router.post(
  "/topic-relevance",
  attachAiPoweredTestExamContext,
  validateQuestionTopicRelevance
);
router.post("/answer-correction", applyAnswerCorrection);
router.post("/confirmed-questions", logConfirmedQuestions);

export default router;
