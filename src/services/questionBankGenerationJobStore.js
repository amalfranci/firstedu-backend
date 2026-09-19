import fs from "fs";
import path from "path";

const JOB_TTL_MS = Number(
    process.env.AI_QB_GENERATION_JOB_TTL_MS || 30 * 60 * 1000
);
/** Paper jobs (apt-*) can run for hours — never prune while active under 6h default. */
const PAPER_JOB_TTL_MS = Number(
    process.env.PAPER_JOB_TTL_MS ||
        process.env.AI_QB_GENERATION_JOB_TTL_MS ||
        6 * 60 * 60 * 1000
);
const JOB_KEEP_DONE_MS = Number(
    process.env.AI_QB_GENERATION_JOB_KEEP_MS || 7 * 24 * 60 * 60 * 1000
);
const JOB_DIR = path.join(
    process.cwd(),
    "temp",
    "generation-jobs"
);

/** @type {Map<string, object>} */
const jobs = new Map();

const ensureJobDir = () => {
    if (!fs.existsSync(JOB_DIR)) {
        fs.mkdirSync(JOB_DIR, { recursive: true });
    }
};

const jobIdToFileName = (jobId) =>
    `${String(jobId || "unknown")
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .slice(0, 120)}.json`;

const jobFilePath = (jobId) => path.join(JOB_DIR, jobIdToFileName(jobId));

const readJobFromDisk = (jobId) => {
    try {
        const filePath = jobFilePath(jobId);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const writeJobToDisk = (job) => {
    if (!job?.jobId) return;
    try {
        ensureJobDir();
        fs.writeFileSync(jobFilePath(job.jobId), JSON.stringify(job, null, 2), "utf8");
    } catch {
        // non-fatal — in-memory copy still works until restart
    }
};

const deleteJobFromDisk = (jobId) => {
    try {
        const filePath = jobFilePath(jobId);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
        // ignore
    }
};

const isActiveStatus = (status) => {
    const s = String(status || "").toLowerCase();
    return s === "pending" || s === "running" || s === "queued";
};

const jobAgeMs = (job) => Date.now() - (job.updatedAt || job.createdAt || 0);

const shouldPruneJob = (job) => {
    if (!job) return false;
    const isPaper =
        String(job.pipeline || "") === "jee_advanced_luna_verify" ||
        String(job.jobId || "").startsWith("apt-");
    const activeTtl = isPaper ? PAPER_JOB_TTL_MS : JOB_TTL_MS;
    if (isActiveStatus(job.status)) return jobAgeMs(job) > activeTtl;
    return jobAgeMs(job) > JOB_KEEP_DONE_MS;
};

const pruneExpiredJobs = () => {
    for (const [id, job] of jobs.entries()) {
        if (shouldPruneJob(job)) {
            jobs.delete(id);
            deleteJobFromDisk(id);
        }
    }

    try {
        ensureJobDir();
        for (const file of fs.readdirSync(JOB_DIR)) {
            if (!file.endsWith(".json")) continue;
            const filePath = path.join(JOB_DIR, file);
            const raw = fs.readFileSync(filePath, "utf8");
            const job = JSON.parse(raw);
            if (shouldPruneJob(job)) {
                fs.unlinkSync(filePath);
            }
        }
    } catch {
        // ignore prune errors on disk
    }
};

const isTerminalJobStatus = (status) => {
    const s = String(status || "").toLowerCase();
    return (
        s === "completed" ||
        s === "partially_completed" ||
        s === "failed" ||
        s === "cancelled"
    );
};

const isActiveJobStatus = (status) => {
    const s = String(status || "").toLowerCase();
    return (
        s === "pending" ||
        s === "queued" ||
        s === "running" ||
        s === "resume" ||
        s === "generating"
    );
};

const isPaperJobId = (jobId, job = null) =>
    String(job?.pipeline || "") === "jee_advanced_luna_verify" ||
    String(jobId || "").startsWith("apt-");

/**
 * Prefer the freshest shared-disk copy for paper jobs (API + worker are
 * separate processes with separate memory Maps).
 */
const resolveExistingJob = (jobId) => {
    const mem = jobs.get(jobId) || null;
    const disk = readJobFromDisk(jobId);
    if (!disk) return mem;
    if (!mem) return disk;
    if (!isPaperJobId(jobId, mem) && !isPaperJobId(jobId, disk)) {
        return mem;
    }
    const memTs = Number(mem.updatedAt || mem.createdAt || 0);
    const diskTs = Number(disk.updatedAt || disk.createdAt || 0);
    // Disk wins when newer, or when memory would downgrade a finished job.
    if (diskTs >= memTs) return disk;
    if (isTerminalJobStatus(disk.status) && isActiveJobStatus(mem.status)) {
        return disk;
    }
    return mem;
};

export const createGenerationJob = (jobId, payload = {}) => {
    pruneExpiredJobs();
    const now = Date.now();
    const job = {
        jobId,
        status: "pending",
        phase: "queued",
        createdAt: now,
        updatedAt: now,
        ...payload,
    };
    jobs.set(jobId, job);
    writeJobToDisk(job);
    return job;
};

export const updateGenerationJob = (jobId, patch = {}) => {
    const existing = resolveExistingJob(jobId);
    if (!existing) return null;
    let nextPatch = { ...patch };
    // Never let a stale API poll overwrite worker terminal status with "running".
    if (
        isTerminalJobStatus(existing.status) &&
        isActiveJobStatus(nextPatch.status)
    ) {
        const { status: _s, phase: _p, message: _m, ...rest } = nextPatch;
        nextPatch = rest;
    }
    if (
        isTerminalJobStatus(existing.status) &&
        nextPatch.status == null &&
        isPaperJobId(jobId, existing)
    ) {
        // Progress-only patches from the API must keep completion markers.
        nextPatch = {
            ...nextPatch,
            status: existing.status,
            phase: existing.phase || nextPatch.phase,
            message: existing.message || nextPatch.message,
        };
    }
    if (Array.isArray(patch.questions) && patch.questions.length) {
        const seen = new Set();
        const unique = [];
        for (const q of patch.questions) {
            if (!q) continue;
            const key = String(q.questionText || q.text || q.title || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase()
                .slice(0, 280);
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            unique.push(q);
        }
        if (unique.length !== patch.questions.length) {
            nextPatch = {
                ...nextPatch,
                questions: unique,
                completedQuestions: unique.length,
                counts: {
                    ...(existing.counts || {}),
                    ...(nextPatch.counts || {}),
                    total: unique.length,
                },
            };
        }
    }
    const updated = {
        ...existing,
        ...nextPatch,
        jobId,
        updatedAt: Date.now(),
    };
    jobs.set(jobId, updated);
    writeJobToDisk(updated);
    return updated;
};

export const getGenerationJob = (jobId, { refresh = false } = {}) => {
    pruneExpiredJobs();
    if (!refresh) {
        const cached = jobs.get(jobId);
        if (cached) {
            // Paper jobs are updated by a separate worker process — always prefer disk.
            const isPaper =
                String(cached.pipeline || "") === "jee_advanced_luna_verify" ||
                String(jobId || "").startsWith("apt-");
            if (!isPaper) return cached;
        } else {
            // fall through to disk
        }
    }
    const fromDisk = readJobFromDisk(jobId);
    if (fromDisk) {
        jobs.set(jobId, fromDisk);
        return fromDisk;
    }
    return jobs.get(jobId) || null;
};

/**
 * List jobs from disk (shared across API + worker processes).
 * @param {{ status?: string|string[], pipeline?: string }} [filter]
 */
export const listGenerationJobs = (filter = {}) => {
    pruneExpiredJobs();
    const statuses = filter.status
        ? new Set(
              (Array.isArray(filter.status) ? filter.status : [filter.status]).map(
                  (s) => String(s).toLowerCase()
              )
          )
        : null;
    const pipeline = filter.pipeline ? String(filter.pipeline) : null;
    const out = [];
    try {
        ensureJobDir();
        for (const file of fs.readdirSync(JOB_DIR)) {
            if (!file.endsWith(".json")) continue;
            let job;
            try {
                job = JSON.parse(
                    fs.readFileSync(path.join(JOB_DIR, file), "utf8")
                );
            } catch {
                continue;
            }
            if (!job?.jobId) continue;
            if (statuses && !statuses.has(String(job.status || "").toLowerCase())) {
                continue;
            }
            if (pipeline && String(job.pipeline || "") !== pipeline) continue;
            jobs.set(job.jobId, job);
            out.push(job);
        }
    } catch {
        // ignore
    }
    out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return out;
};

/**
 * Atomically claim a pending job for a worker (exclusive lock file + status check).
 */
export const claimGenerationJob = (jobId, workerId) => {
    const existing = getGenerationJob(jobId);
    if (!existing) return null;
    const status = String(existing.status || "").toLowerCase();
    if (status !== "pending" && status !== "queued") return null;

    const lockPath = `${jobFilePath(jobId)}.claim`;
    try {
        fs.writeFileSync(lockPath, String(workerId || "worker"), { flag: "wx" });
    } catch {
        return null;
    }
    try {
        const again = getGenerationJob(jobId);
        const st = String(again?.status || "").toLowerCase();
        if (st !== "pending" && st !== "queued") return null;
        return updateGenerationJob(jobId, {
            status: "running",
            phase: "claimed",
            claimedBy: workerId,
            workerId,
            claimedAt: Date.now(),
            message: `Claimed by worker ${workerId}`,
            error: "",
            resumable: Boolean(again?.resumable) || Boolean(again?.items?.length),
        });
    } finally {
        try {
            fs.unlinkSync(lockPath);
        } catch {
            // ignore
        }
    }
};

/**
 * Nodemon / process restarts kill in-flight generation. Jobs left on disk as
 * pending/running can never complete — mark them failed so the UI stops polling
 * forever and shows a clear error instead of a Network Error.
 *
 * @param {string} [reason]
 * @param {{ onlyRunners?: string[] }} [opts] — when set, only fail jobs whose
 *   `runner` is in this list. API should pass `['inline']` so worker-queued
 *   paper jobs survive API restarts.
 */
export const failOrphanedGenerationJobs = (
    reason = "Server restarted during generation. Resume to continue from locked questions — already spent tokens are kept.",
    opts = {}
) => {
    const onlyRunners = opts.onlyRunners
        ? new Set(opts.onlyRunners.map((r) => String(r).toLowerCase()))
        : null;
    let failed = 0;
    try {
        ensureJobDir();
        for (const file of fs.readdirSync(JOB_DIR)) {
            if (!file.endsWith(".json")) continue;
            const filePath = path.join(JOB_DIR, file);
            let job;
            try {
                job = JSON.parse(fs.readFileSync(filePath, "utf8"));
            } catch {
                continue;
            }
            const status = String(job?.status || "").toLowerCase();
            if (status !== "pending" && status !== "running" && status !== "queued") {
                continue;
            }
            const runner = String(job?.runner || "inline").toLowerCase();
            if (onlyRunners && !onlyRunners.has(runner)) {
                continue;
            }
            const updated = {
                ...job,
                status: "failed",
                phase: "error",
                error: reason,
                resumable: true,
                message: reason,
                updatedAt: Date.now(),
            };
            if (job?.jobId) {
                jobs.set(job.jobId, updated);
                writeJobToDisk(updated);
                failed += 1;
            }
        }
    } catch {
        // non-fatal
    }
    if (failed > 0) {
        console.warn(
            `[ai-qb] marked ${failed} orphaned generation job(s) as failed after restart`
        );
    }
    return failed;
};

/**
 * After a paper-worker restart, put interrupted worker jobs back to pending
 * so they can be claimed again (resume path keeps checkpoints).
 */
export const requeueOrphanedWorkerJobs = () => {
    let requeued = 0;
    try {
        ensureJobDir();
        for (const file of fs.readdirSync(JOB_DIR)) {
            if (!file.endsWith(".json")) continue;
            let job;
            try {
                job = JSON.parse(
                    fs.readFileSync(path.join(JOB_DIR, file), "utf8")
                );
            } catch {
                continue;
            }
            const status = String(job?.status || "").toLowerCase();
            const runner = String(job?.runner || "").toLowerCase();
            if (runner !== "worker") continue;
            if (status !== "running") continue;
            const updated = {
                ...job,
                status: "pending",
                phase: "queued",
                claimedBy: null,
                claimedAt: null,
                message: "Re-queued after worker restart (resume from checkpoints)",
                resumable: true,
                updatedAt: Date.now(),
            };
            if (job?.jobId) {
                jobs.set(job.jobId, updated);
                writeJobToDisk(updated);
                requeued += 1;
            }
        }
    } catch {
        // non-fatal
    }
    if (requeued > 0) {
        console.warn(
            `[paper-worker] re-queued ${requeued} interrupted paper job(s)`
        );
    }
    return requeued;
};

export default {
    createGenerationJob,
    updateGenerationJob,
    getGenerationJob,
    listGenerationJobs,
    claimGenerationJob,
    failOrphanedGenerationJobs,
    requeueOrphanedWorkerJobs,
};
