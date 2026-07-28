/**
 * Human review queue for low-confidence AI questions.
 */
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
    listHumanReviewQueue,
    AiQuestionReviewQueue,
} from "../services/humanReviewQueue.service.js";

export const listAiQuestionReviewQueue = asyncHandler(async (req, res) => {
    const status = String(req.query.status || "pending").trim();
    const limit = Number(req.query.limit || 50);
    const items = await listHumanReviewQueue({ status, limit });
    return res
        .status(200)
        .json(ApiResponse.success({ items, count: items.length }, "Review queue"));
});

export const updateAiQuestionReviewItem = asyncHandler(async (req, res) => {
    const id = String(req.params.id || "").trim();
    const status = String(req.body?.status || "").trim();
    if (!["approved", "rejected", "pending"].includes(status)) {
        return res
            .status(400)
            .json(ApiResponse.error(400, "status must be approved|rejected|pending"));
    }
    const item = await AiQuestionReviewQueue.findByIdAndUpdate(
        id,
        { status },
        { new: true }
    ).lean();
    return res
        .status(200)
        .json(ApiResponse.success({ item }, "Review item updated"));
});
