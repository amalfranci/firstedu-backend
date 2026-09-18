/**
 * File + Mongo backed paper-job queue.
 * API process enqueues; a separate worker process claims and runs jobs
 * so long Gemini/Luna work does not stall the Express/node-cron event loop.
 */

import {
  createGenerationJob,
  updateGenerationJob,
  getGenerationJob,
  listGenerationJobs,
  claimGenerationJob,
} from "./questionBankGenerationJobStore.js";
import { persistJobRecord } from "./paperJobArtifact.service.js";

/** Production default is worker; set PAPER_JOB_RUNNER=inline only for local API-only testing. */
export const PAPER_JOB_RUNNER =
  String(process.env.PAPER_JOB_RUNNER || "worker").toLowerCase() === "inline"
    ? "inline"
    : "worker";

export const isInlinePaperRunner = () => PAPER_JOB_RUNNER === "inline";

export const enqueuePaperJob = (jobId, config = {}, extra = {}) => {
  const totalQuestions = Math.max(0, Number(config.totalQuestions) || 0);
  const job = createGenerationJob(jobId, {
    status: "pending",
    phase: "queued",
    pipeline: "jee_advanced_luna_verify",
    runner: PAPER_JOB_RUNNER,
    generationId: jobId,
    config,
    questions: [],
    items: [],
    failures: [],
    totalQuestions,
    completedQuestions: 0,
    failedQuestions: 0,
    logDir: `temp/paper-jobs/${jobId}`,
    message: "Queued for paper worker (generate → o3 verify+solution → READY)",
    ...extra,
  });
  persistJobRecord(jobId, {
    status: "pending",
    phase: "queued",
    message: job.message,
    generationId: jobId,
    config,
    runner: PAPER_JOB_RUNNER,
    totalQuestions,
    completedQuestions: 0,
    failedQuestions: 0,
    exam: config.examLabel || config.examType || "",
    subject: config.subject || "",
    userId: config.createdBy || null,
  }).catch(() => {});
  return job;
};

export const requeuePaperJob = (jobId, patch = {}) => {
  const job = updateGenerationJob(jobId, {
    status: "pending",
    phase: "queued",
    runner: PAPER_JOB_RUNNER,
    claimedBy: null,
    claimedAt: null,
    message: "Re-queued for paper worker",
    error: "",
    resumable: false,
    ...patch,
  });
  if (job) {
    persistJobRecord(jobId, {
      status: "pending",
      phase: "queued",
      message: job.message,
      resumable: false,
      runner: PAPER_JOB_RUNNER,
    }).catch(() => {});
  }
  return job || getGenerationJob(jobId);
};

export const listPendingPaperJobs = () =>
  listGenerationJobs({
    status: ["pending", "queued"],
    pipeline: "jee_advanced_luna_verify",
  });

export const claimNextPaperJob = (workerId) => {
  const pending = listPendingPaperJobs();
  for (const job of pending) {
    const claimed = claimGenerationJob(job.jobId, workerId);
    if (claimed) {
      persistJobRecord(claimed.jobId, {
        status: "running",
        phase: "claimed",
        message: `Claimed by worker ${workerId}`,
        workerId,
      }).catch(() => {});
      return claimed;
    }
  }
  return null;
};

export default {
  PAPER_JOB_RUNNER,
  isInlinePaperRunner,
  enqueuePaperJob,
  requeuePaperJob,
  listPendingPaperJobs,
  claimNextPaperJob,
};
