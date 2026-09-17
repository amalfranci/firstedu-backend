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

export const PAPER_JOB_RUNNER =
  String(process.env.PAPER_JOB_RUNNER || "inline").toLowerCase() === "worker"
    ? "worker"
    : "inline";

export const isInlinePaperRunner = () => PAPER_JOB_RUNNER === "inline";

export const enqueuePaperJob = (jobId, config = {}, extra = {}) => {
  const job = createGenerationJob(jobId, {
    status: "pending",
    phase: "queued",
    pipeline: "jee_advanced_luna_verify",
    runner: PAPER_JOB_RUNNER,
    config,
    questions: [],
    items: [],
    failures: [],
    logDir: `temp/paper-jobs/${jobId}`,
    message: "Queued for paper worker (generate → Luna verify → expand)",
    ...extra,
  });
  persistJobRecord(jobId, {
    status: "pending",
    phase: "queued",
    message: job.message,
    config,
    runner: PAPER_JOB_RUNNER,
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
