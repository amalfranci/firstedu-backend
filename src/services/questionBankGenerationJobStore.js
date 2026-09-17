import fs from "fs";
import path from "path";

const JOB_TTL_MS = Number(
    process.env.AI_QB_GENERATION_JOB_TTL_MS || 30 * 60 * 1000
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
    if (isActiveStatus(job.status)) return jobAgeMs(job) > JOB_TTL_MS;
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
    const existing = jobs.get(jobId) || readJobFromDisk(jobId);
    if (!existing) return null;
    const updated = {
        ...existing,
        ...patch,
        jobId,
        updatedAt: Date.now(),
    };
    jobs.set(jobId, updated);
    writeJobToDisk(updated);
    return updated;
};

export const getGenerationJob = (jobId) => {
    pruneExpiredJobs();
    const cached = jobs.get(jobId);
    if (cached) return cached;
    const fromDisk = readJobFromDisk(jobId);
    if (fromDisk) {
        jobs.set(jobId, fromDisk);
        return fromDisk;
    }
    return null;
};

/**
 * Nodemon / process restarts kill in-flight generation. Jobs left on disk as
 * pending/running can never complete — mark them failed so the UI stops polling
 * forever and shows a clear error instead of a Network Error.
 */
export const failOrphanedGenerationJobs = (
    reason = "Server restarted during generation. Resume to continue from locked questions — already spent tokens are kept."
) => {
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

export default {
    createGenerationJob,
    updateGenerationJob,
    getGenerationJob,
    failOrphanedGenerationJobs,
};
