/**
 * Cleanup service for generation jobs
 * Removes expired job records and manages disk space
 *
 * Features:
 * - Delete jobs older than RETENTION_DAYS
 * - Monitor disk usage
 * - Alert on size threshold exceeded
 * - Called daily by cron
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RETENTION_DAYS = Number(process.env.QB_GENERATION_JOB_RETENTION_DAYS ?? 7);
const MAX_DIR_SIZE_GB = Number(process.env.QB_GENERATION_JOB_MAX_SIZE_GB ?? 5);
const JOBS_DIR = path.join(__dirname, '../../temp/generation-jobs');

/**
 * Calculate directory size in bytes
 */
const calculateDirectorySize = (dirPath) => {
    if (!fs.existsSync(dirPath)) return 0;

    const files = fs.readdirSync(dirPath);
    let totalSize = 0;

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
                totalSize += stats.size;
            }
        } catch (error) {
            console.error(`[cleanup] Error stat file ${file}:`, error.message);
        }
    }

    return totalSize;
};

/**
 * Cleanup expired generation jobs
 * Called daily or on-demand
 * @returns {Object} Cleanup results { deleted, sizeGb, expiredCount, error }
 */
export const cleanupExpiredGenerationJobs = () => {
    if (!fs.existsSync(JOBS_DIR)) {
        console.log('[cleanup] Jobs directory does not exist, skipping cleanup');
        return {
            deleted: 0,
            sizeGB: 0,
            error: null,
            timestamp: new Date().toISOString(),
        };
    }

    try {
        const files = fs.readdirSync(JOBS_DIR);
        const now = Date.now();
        const thresholdMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

        let deletedCount = 0;
        let expiredCount = 0;

        console.log(`[cleanup] Starting cleanup: retention=${RETENTION_DAYS}d, maxSize=${MAX_DIR_SIZE_GB}GB`);

        // Delete expired files
        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const filePath = path.join(JOBS_DIR, file);

            try {
                const stats = fs.statSync(filePath);
                const ageMs = now - stats.mtimeMs;

                if (ageMs > thresholdMs) {
                    expiredCount++;
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    console.log(`[cleanup] Deleted ${file} (${(ageMs / 1000 / 60 / 60).toFixed(1)}h old)`);
                }
            } catch (error) {
                console.error(`[cleanup] Error processing ${file}:`, error.message);
            }
        }

        // Check directory size
        const totalSize = calculateDirectorySize(JOBS_DIR);
        const sizeGB = totalSize / (1024 ** 3);

        console.log(`[cleanup] Deleted ${deletedCount} jobs (${expiredCount} expired)`);
        console.log(`[cleanup] Directory size: ${sizeGB.toFixed(2)}GB (max: ${MAX_DIR_SIZE_GB}GB)`);

        if (sizeGB > MAX_DIR_SIZE_GB) {
            console.warn(
                `[cleanup] ⚠️  Directory exceeds size limit: ${sizeGB.toFixed(2)}GB > ${MAX_DIR_SIZE_GB}GB`
            );
            console.warn('[cleanup] Consider:');
            console.warn(`  - Reducing RETENTION_DAYS (current: ${RETENTION_DAYS})`);
            console.warn(`  - Increasing QB_GENERATION_JOB_MAX_SIZE_GB`);
            console.warn('  - Running cleanup more frequently');
        }

        return {
            deleted: deletedCount,
            expiredCount,
            sizeGB: parseFloat(sizeGB.toFixed(2)),
            error: null,
            timestamp: new Date().toISOString(),
        };
    } catch (error) {
        console.error('[cleanup] Fatal error:', error.message);
        return {
            deleted: 0,
            sizeGB: 0,
            error: error.message,
            timestamp: new Date().toISOString(),
        };
    }
};

/**
 * Get cleanup status/metrics
 */
export const getCleanupStatus = () => {
    const sizeGB = calculateDirectorySize(JOBS_DIR) / (1024 ** 3);
    const files = fs.existsSync(JOBS_DIR) ? fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json')).length : 0;

    return {
        jobsDir: JOBS_DIR,
        jobCount: files,
        sizeGB: parseFloat(sizeGB.toFixed(2)),
        maxSizeGB: MAX_DIR_SIZE_GB,
        retentionDays: RETENTION_DAYS,
        isOverSize: sizeGB > MAX_DIR_SIZE_GB,
        timestamp: new Date().toISOString(),
    };
};

/**
 * Force cleanup of all jobs (danger: removes everything)
 */
export const forceCleanupAllJobs = () => {
    if (!fs.existsSync(JOBS_DIR)) {
        return { deleted: 0, error: 'Jobs directory does not exist' };
    }

    try {
        const files = fs.readdirSync(JOBS_DIR);
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(JOBS_DIR, file);
            fs.unlinkSync(filePath);
            deletedCount++;
        }

        console.log(`[cleanup] Force cleanup: deleted ${deletedCount} jobs`);
        return { deleted: deletedCount, error: null };
    } catch (error) {
        console.error('[cleanup] Force cleanup error:', error.message);
        return { deleted: 0, error: error.message };
    }
};

export default {
    cleanupExpiredGenerationJobs,
    getCleanupStatus,
    forceCleanupAllJobs,
};
