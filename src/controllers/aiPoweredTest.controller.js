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
import {
  getGenerationJob,
  createGenerationJob,
  updateGenerationJob,
} from "../services/questionBankGenerationJobStore.js";
import {
  loadPersistedJob,
  loadGeneratedPaperDraft,
  loadPersistedQuestions,
} from "../services/paperJobArtifact.service.js";
import { pickAuthoritativePaperQuestions } from "../utils/paperQuestionDedupe.js";

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

const progressFromJob = (job = {}) => {
  const totalQuestions = Math.max(
    0,
    Number(job.totalQuestions) ||
      Number(job.counts?.expected) ||
      Number(job.config?.totalQuestions) ||
      0
  );
  const completedQuestions = Math.max(
    0,
    Number(job.completedQuestions) ||
      Number(job.counts?.total) ||
      (Array.isArray(job.questions) ? job.questions.length : 0)
  );
  const failedQuestions = Math.max(
    0,
    Number(job.failedQuestions) ||
      (Array.isArray(job.failures) ? job.failures.length : 0)
  );
  return { totalQuestions, completedQuestions, failedQuestions };
};

/**
 * Resolve paper job across API memory, shared disk, and Mongo (worker mode).
 */
const resolvePaperJob = async (generationId) => {
  const id = String(generationId || "").trim();
  if (!id) return null;

  let job = getGenerationJob(id);
  const draft = loadGeneratedPaperDraft(id);
  const draftQuestions =
    Array.isArray(draft?.questions) && draft.questions.length
      ? draft.questions
      : [];
  const persisted = await loadPersistedJob(id);

  if (!job) {
    if (!persisted) return null;
    job = createGenerationJob(id, {
      ...persisted,
      generationId: persisted.generationId || id,
      questions: [],
      config: persisted.config || {},
    });
  }

  if (persisted) {
    job = {
      ...job,
      status: persisted.status || job.status,
      phase: persisted.phase || job.phase,
      message: persisted.message || job.message,
      error: persisted.error || job.error,
      counts: persisted.counts || job.counts,
      totalQuestions: persisted.totalQuestions ?? job.totalQuestions,
      completedQuestions:
        persisted.completedQuestions ?? job.completedQuestions,
      failedQuestions: persisted.failedQuestions ?? job.failedQuestions,
      resumable: persisted.resumable ?? job.resumable,
      config: persisted.config || job.config,
      plan: persisted.plan || job.plan,
      generationId: persisted.generationId || job.generationId || id,
    };
  }

  // Never prefer a longer temporary draft over the authoritative job list
  const questions = pickAuthoritativePaperQuestions({
    jobQuestions: job.questions || [],
    draftQuestions,
    draftStatus: draft?.status,
    jobStatus: job.status,
  });

  if (
    questions.length !== (job.questions || []).length ||
    questions !== job.questions
  ) {
    job =
      updateGenerationJob(id, {
        questions,
        counts: {
          ...(job.counts || {}),
          total: questions.length,
        },
        completedQuestions: questions.length,
      }) || { ...job, questions };
  }

  const progress = progressFromJob({
    ...job,
    questions,
    completedQuestions: questions.length,
    counts: { ...(job.counts || {}), total: questions.length },
  });
  return {
    ...job,
    ...progress,
    questions,
    completedQuestions: questions.length,
    generationId: job.generationId || job.jobId || id,
    jobId: job.jobId || id,
  };
};

/**
 * POST /admin/ai-powered-test/questions
 * Start full pipeline job — returns immediately with generationId (worker runs pipeline).
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

  const createdBy = req.user?._id || req.user?.id || null;
  const job = startAdvancedPaperJob({
    ...config,
    totalQuestions: total,
    typeCounts,
    createdBy,
  });
  const generationId = job.generationId || job.jobId;
  const status =
    String(job.status || "").toLowerCase() === "running"
      ? "running"
      : "queued";

  return res.status(202).json(
    ApiResponse.success(
      {
        generationId,
        jobId: generationId,
        status,
        phase: job.phase || "queued",
        message: job.message || "Queued",
        totalQuestions: total,
        completedQuestions: 0,
        failedQuestions: 0,
        typeCounts,
      },
      "Generation job queued"
    )
  );
});

/**
 * GET /admin/ai-powered-test/questions/jobs/:jobId
 */
export const getExamQuestionJob = asyncHandler(async (req, res) => {
  const job = await resolvePaperJob(req.params.jobId);
  if (!job) throw new ApiError(404, "Generation job not found");
  return res.status(200).json(ApiResponse.success(job, "Generation job fetched"));
});

/**
 * GET /admin/ai-powered-test/questions/:generationId/status
 * Compact progress for polling / reconnect.
 */
export const getExamQuestionJobStatus = asyncHandler(async (req, res) => {
  const job = await resolvePaperJob(req.params.generationId);
  if (!job) throw new ApiError(404, "Generation job not found");
  const progress = progressFromJob(job);
  const statusRaw = String(job.status || "queued").toLowerCase();
  const status =
    statusRaw === "pending" || statusRaw === "queued"
      ? "queued"
      : statusRaw === "running"
        ? "generating"
        : statusRaw;

  // Optional question rows for debugging; keep payload light by default
  let questionRows = null;
  if (String(req.query.includeQuestions || "") === "1") {
    questionRows = await loadPersistedQuestions(job.jobId || job.generationId);
  }

  return res.status(200).json(
    ApiResponse.success(
      {
        generationId: job.generationId || job.jobId,
        status,
        phase: job.phase || null,
        message: job.message || "",
        ...progress,
        counts: job.counts || {},
        resumable: Boolean(job.resumable),
        error: job.error || "",
        ...(questionRows ? { questions: questionRows } : {}),
      },
      "Generation status fetched"
    )
  );
});

/**
 * POST /admin/ai-powered-test/questions/jobs/:jobId/resume
 * Continue a failed/interrupted job from locked questions (does not regenerate them).
 */
export const resumeExamQuestionJob = asyncHandler(async (req, res) => {
  const existing = await resolvePaperJob(req.params.jobId);
  if (!existing) throw new ApiError(404, "Generation job not found");
  const job = resumeAdvancedPaperJob(existing.jobId || req.params.jobId);
  const progress = progressFromJob(job);
  const generationId = job.generationId || job.jobId;
  return res.status(202).json(
    ApiResponse.success(
      {
        generationId,
        jobId: generationId,
        status: job.status,
        phase: job.phase,
        message: job.message,
        counts: job.counts,
        resumable: job.resumable,
        tokenUsage: job.tokenUsage,
        ...progress,
      },
      "Generation job resumed"
    )
  );
});
