import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import examBlueprintService from "../services/examBlueprint.service.js";
import {
  planPipelineSlots,
  generatePipelineQuestions,
  dualLockPipelineQuestions,
  expandPipelineQuestions,
  startAdvancedPaperJob,
  resumeAdvancedPaperJob,
} from "../services/aiPoweredTestPipeline.service.js";
import { getGenerationJob } from "../services/questionBankGenerationJobStore.js";

/**
 * GET /admin/ai-powered-test/exam-blueprint
 */
export const getExamBlueprint = asyncHandler(async (req, res) => {
  const blueprint = await examBlueprintService.getExamBlueprint(req.query);
  return res
    .status(200)
    .json(ApiResponse.success(blueprint, "Exam blueprint fetched successfully"));
});

/**
 * GET /admin/ai-powered-test/exam-topics
 */
export const getExamTopics = asyncHandler(async (req, res) => {
  const blueprint = await examBlueprintService.getExamBlueprint(req.query);
  return res
    .status(200)
    .json(ApiResponse.success(blueprint, "Exam topics fetched successfully"));
});

/**
 * POST /admin/ai-powered-test/topic-plan
 * Phase 1 — slot plan from wizard config (no LLM).
 */
export const planExamTopics = asyncHandler(async (req, res) => {
  const plan = planPipelineSlots(req.body?.config || req.body || {});
  return res
    .status(200)
    .json(ApiResponse.success(plan, "Topic slots planned"));
});

/**
 * POST /admin/ai-powered-test/questions/generate
 * GENERATE only — Gemini hard writer → raw JSON questions.
 */
export const generateExamQuestions = asyncHandler(async (req, res) => {
  const questions = await generatePipelineQuestions(req.body || {});
  return res
    .status(200)
    .json(ApiResponse.success({ questions }, "Gemini generate complete"));
});

/**
 * POST /admin/ai-powered-test/questions/dual-lock
 * GPT-5.6 Luna deep verify (solve + option check + key check) on raw questions.
 */
export const dualLockExamQuestions = asyncHandler(async (req, res) => {
  const questions = req.body?.questions;
  if (!Array.isArray(questions) || !questions.length) {
    throw new ApiError(400, "questions[] is required");
  }
  const result = await dualLockPipelineQuestions(questions);
  return res
    .status(200)
    .json(ApiResponse.success(result, "Luna verify complete"));
});

/**
 * POST /admin/ai-powered-test/questions/expand
 * Phase 4 — expand explanations with LOCKED KEY (Gemini).
 */
export const expandExamQuestions = asyncHandler(async (req, res) => {
  const questions = req.body?.questions;
  if (!Array.isArray(questions) || !questions.length) {
    throw new ApiError(400, "questions[] is required");
  }
  const expanded = await expandPipelineQuestions(questions);
  return res
    .status(200)
    .json(ApiResponse.success({ questions: expanded }, "Explanation expand complete"));
});

/**
 * POST /admin/ai-powered-test/questions
 * Start full pipeline job: plan → generate → Luna verify → expand.
 */
export const startExamQuestionJob = asyncHandler(async (req, res) => {
  const config = { ...(req.body?.config || req.body || {}) };
  const typeCounts = {
    single: Math.max(0, Number(config.typeCounts?.single) || 0),
    multiple: Math.max(
      0,
      Number(config.typeCounts?.multiple ?? config.typeCounts?.multi) || 0
    ),
    integer: Math.max(0, Number(config.typeCounts?.integer) || 0),
    match: Math.max(0, Number(config.typeCounts?.match) || 0),
  };
  const typeSum =
    typeCounts.single +
    typeCounts.multiple +
    typeCounts.integer +
    typeCounts.match;
  let total = Math.max(0, Number(config.totalQuestions) || 0);
  if (total < 1 && typeSum > 0) total = typeSum;
  if (total < 1) {
    throw new ApiError(400, "typeCounts or totalQuestions is required");
  }
  if (total > 200) {
    throw new ApiError(400, "totalQuestions cannot exceed 200");
  }
  if (typeSum > 0 && typeSum !== total) {
    throw new ApiError(
      400,
      `typeCounts sum (${typeSum}) must equal totalQuestions (${total})`
    );
  }
  if (typeSum === 0) {
    // Fallback: all singles when only total provided
    typeCounts.single = total;
  }
  const subjectCounts = config.subjectCounts || {};
  const subjectSum = Object.values(subjectCounts).reduce(
    (s, n) => s + Math.max(0, Number(n) || 0),
    0
  );
  if (subjectSum > 0 && subjectSum !== total) {
    throw new ApiError(
      400,
      `subjectCounts sum (${subjectSum}) must equal totalQuestions (${total})`
    );
  }

  const job = startAdvancedPaperJob({
    ...config,
    totalQuestions: total,
    typeCounts,
  });
  return res.status(202).json(
    ApiResponse.success(
      {
        jobId: job.jobId,
        status: job.status,
        phase: job.phase,
        message: job.message,
        totalQuestions: total,
        typeCounts,
      },
      "Generation job started"
    )
  );
});

/**
 * GET /admin/ai-powered-test/questions/jobs/:jobId
 */
export const getExamQuestionJob = asyncHandler(async (req, res) => {
  const job = getGenerationJob(req.params.jobId);
  if (!job) throw new ApiError(404, "Generation job not found");
  return res.status(200).json(ApiResponse.success(job, "Generation job fetched"));
});

/**
 * POST /admin/ai-powered-test/questions/jobs/:jobId/resume
 * Continue a failed/interrupted job from locked questions (does not regenerate them).
 */
export const resumeExamQuestionJob = asyncHandler(async (req, res) => {
  const job = resumeAdvancedPaperJob(req.params.jobId);
  return res.status(202).json(
    ApiResponse.success(
      {
        jobId: job.jobId,
        status: job.status,
        phase: job.phase,
        message: job.message,
        counts: job.counts,
        resumable: job.resumable,
        tokenUsage: job.tokenUsage,
      },
      "Generation job resumed"
    )
  );
});

