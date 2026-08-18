import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import aiBankDraftService from "../services/aiBankDraft.service.js";

/** GET /admin/ai-bank-draft — load the current user's in-progress draft. */
export const getAiBankDraft = asyncHandler(async (req, res) => {
  const draft = await aiBankDraftService.getDraft(req.user._id);
  return res
    .status(200)
    .json(ApiResponse.success(draft, "AI bank draft fetched successfully"));
});

/** PUT /admin/ai-bank-draft — autosave (upsert) the current user's draft. */
export const saveAiBankDraft = asyncHandler(async (req, res) => {
  const { data, clientUpdatedAt } = req.body || {};
  const draft = await aiBankDraftService.saveDraft(req.user._id, {
    data,
    clientUpdatedAt,
  });
  return res
    .status(200)
    .json(ApiResponse.success(draft, "AI bank draft saved successfully"));
});

/** DELETE /admin/ai-bank-draft — clear the draft (after save or discard). */
export const deleteAiBankDraft = asyncHandler(async (req, res) => {
  const result = await aiBankDraftService.deleteDraft(req.user._id);
  return res
    .status(200)
    .json(ApiResponse.success(result, "AI bank draft cleared successfully"));
});
