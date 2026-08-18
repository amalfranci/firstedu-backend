/**
 * Admin cleanup controller
 * Manages job cleanup and disk space monitoring
 */

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import {
    cleanupExpiredGenerationJobs,
    getCleanupStatus,
    forceCleanupAllJobs,
} from '../services/cleanupGenerationJobs.service.js';

/**
 * Get cleanup status and metrics
 * @route GET /api/admin/cleanup/status
 * @access Admin
 */
export const getCleanupStatusController = asyncHandler(async (req, res) => {
    const status = getCleanupStatus();

    return res.status(200).json(
        ApiResponse.success(
            status,
            `Cleanup status: ${status.jobCount} jobs, ${status.sizeGB}GB/${status.maxSizeGB}GB`
        )
    );
});

/**
 * Manually trigger cleanup of expired jobs
 * @route POST /api/admin/cleanup/run
 * @access Admin
 */
export const runCleanupNowController = asyncHandler(async (req, res) => {
    const result = cleanupExpiredGenerationJobs();

    if (result.error) {
        throw new ApiError(500, 'Cleanup failed', [result.error]);
    }

    return res.status(200).json(
        ApiResponse.success(
            {
                deleted: result.deleted,
                expiredCount: result.expiredCount,
                sizeGB: result.sizeGB,
                timestamp: result.timestamp,
            },
            `Cleanup completed: ${result.deleted} jobs deleted`
        )
    );
});

/**
 * Force cleanup all jobs (danger operation)
 * @route POST /api/admin/cleanup/force
 * @access Admin (super-admin only)
 */
export const forceCleanupController = asyncHandler(async (req, res) => {
    const { confirm } = req.body;

    if (confirm !== 'DELETE_ALL_JOBS') {
        throw new ApiError(400, 'Confirmation required', ['Pass confirm: "DELETE_ALL_JOBS" to proceed']);
    }

    const result = forceCleanupAllJobs();

    if (result.error) {
        throw new ApiError(500, 'Force cleanup failed', [result.error]);
    }

    return res.status(200).json(
        ApiResponse.success(
            {
                deleted: result.deleted,
                timestamp: new Date().toISOString(),
            },
            `⚠️  Force cleanup completed: ${result.deleted} jobs deleted`
        )
    );
});

export default {
    getCleanupStatusController,
    runCleanupNowController,
    forceCleanupController,
};
