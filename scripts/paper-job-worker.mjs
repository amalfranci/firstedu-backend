#!/usr/bin/env node
/**
 * Dedicated paper-generation worker process.
 *
 * Run alongside the API server:
 *   node scripts/paper-job-worker.mjs
 *   npm run worker:paper
 *
 * The API enqueues jobs (status=pending). This process claims and runs
 * generate → Luna verify → expand so cron/API timers stay responsive.
 */

import dotenv from "dotenv";
import { randomUUID } from "crypto";
import connectDB from "../src/config/db.js";
import { requeueOrphanedWorkerJobs } from "../src/services/questionBankGenerationJobStore.js";
import { claimNextPaperJob } from "../src/services/paperJobQueue.service.js";
import {
  executePaperJob,
} from "../src/services/aiPoweredTestPipeline.service.js";

dotenv.config();

const WORKER_ID =
  process.env.PAPER_WORKER_ID ||
  `paper-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const POLL_MS = Math.max(
  500,
  Number(process.env.PAPER_WORKER_POLL_MS || 2000)
);
const MAX_CONCURRENT = Math.max(
  1,
  Math.min(4, Number(process.env.PAPER_WORKER_MAX_JOBS || 1))
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const active = new Set();
let stopping = false;

const runClaimedJob = async (job) => {
  const jobId = job.jobId;
  active.add(jobId);
  console.log(`[paper-worker ${WORKER_ID}] start ${jobId}`);
  try {
    const resume = Boolean(job.resumable) || Boolean(job.items?.length);
    if (resume && (job.items?.length || job.plan)) {
      // Prefer full execute with resume flag so checkpoints are honored.
      await executePaperJob(jobId, job.config || {}, { resume: true });
    } else {
      await executePaperJob(jobId, job.config || {}, { resume: false });
    }
    console.log(`[paper-worker ${WORKER_ID}] done ${jobId}`);
  } catch (err) {
    console.error(
      `[paper-worker ${WORKER_ID}] crash ${jobId}:`,
      err?.message || err
    );
  } finally {
    active.delete(jobId);
  }
};

const tick = async () => {
  if (stopping) return;
  while (!stopping && active.size < MAX_CONCURRENT) {
    const claimed = claimNextPaperJob(WORKER_ID);
    if (!claimed) break;
    // Fire without awaiting so multiple jobs can run when MAX_CONCURRENT > 1
    runClaimedJob(claimed);
  }
};

const main = async () => {
  console.log(
    `[paper-worker] starting id=${WORKER_ID} poll=${POLL_MS}ms maxJobs=${MAX_CONCURRENT}`
  );
  await connectDB();
  requeueOrphanedWorkerJobs();

  const onStop = (sig) => {
    console.log(`[paper-worker] ${sig} — draining ${active.size} job(s)`);
    stopping = true;
  };
  process.on("SIGINT", () => onStop("SIGINT"));
  process.on("SIGTERM", () => onStop("SIGTERM"));

  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      console.error("[paper-worker] tick error:", err?.message || err);
    }
    if (stopping) break;
    await sleep(POLL_MS);
  }

  while (active.size > 0) {
    await sleep(500);
  }
  console.log("[paper-worker] exit");
  process.exit(0);
};

main().catch((err) => {
  console.error("[paper-worker] fatal:", err);
  process.exit(1);
});
