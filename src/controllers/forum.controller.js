import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import forumService from "../services/forum.service.js";
import forumValidator from "../validation/forum.validator.js";

function normalizeForumBody(body) {
  const b = { ...body };
  if (typeof b.tags === "string") {
    try {
      b.tags = JSON.parse(b.tags);
    } catch {
      b.tags = b.tags ? b.tags.split(",").map((s) => s.trim()) : [];
    }
  }
  return b;
}

export const createForum = asyncHandler(async (req, res) => {
  const body = normalizeForumBody(req.body);
  const { error, value } = forumValidator.createForum.validate(body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map((x) => x.message));
  }
  const forum = await forumService.createForum(value, req.user._id, req.file);
  return res.status(201).json(ApiResponse.success(forum, "Forum created successfully"));
});

export const getForums = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;
  const result = await forumService.getForums(req.user?._id, { search, page, limit });
  return res.status(200).json(
    ApiResponse.success(result.forums, "Forums fetched successfully", result.pagination)
  );
});

export const getForumById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const forum = await forumService.getForumById(id);
  return res.status(200).json(ApiResponse.success(forum, "Forum fetched successfully"));
});

export const updateForum = asyncHandler(async (req, res) => {
  const body = normalizeForumBody(req.body);
  const { error, value } = forumValidator.updateForum.validate(body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map((x) => x.message));
  }
  const { id } = req.params;
  const hasFile = req.file?.buffer;
  if (Object.keys(value).length === 0 && !hasFile) {
    throw new ApiError(400, "At least one field or attachment is required");
  }
  const forum = await forumService.updateForum(id, value, req.user._id, req.file);
  return res.status(200).json(ApiResponse.success(forum, "Forum updated successfully"));
});

export const deleteForum = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await forumService.deleteForum(id, req.user._id);
  return res.status(200).json(ApiResponse.success(null, "Forum deleted successfully"));
});

export const addComment = asyncHandler(async (req, res) => {
  const { forumId } = req.params;
  const { error, value } = forumValidator.addComment.validate(req.body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map((x) => x.message));
  }
  const forum = await forumService.addComment(forumId, value.content, req.user._id);
  return res.status(201).json(ApiResponse.success(forum, "Comment added successfully"));
});

export const replyToComment = asyncHandler(async (req, res) => {
  const { forumId, commentId } = req.params;
  const { error, value } = forumValidator.replyToComment.validate(req.body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map((x) => x.message));
  }
  const forum = await forumService.replyToComment(forumId, commentId, value.content, req.user._id);
  return res.status(201).json(ApiResponse.success(forum, "Reply added successfully"));
});

export const likeForum = asyncHandler(async (req, res) => {
  const { forumId } = req.params;
  const forum = await forumService.likeForum(forumId, req.user._id);
  return res.status(200).json(ApiResponse.success(forum, "Like toggled successfully"));
});

export const likeComment = asyncHandler(async (req, res) => {
  const { forumId, commentId } = req.params;
  const forum = await forumService.likeComment(forumId, commentId, req.user._id);
  return res.status(200).json(ApiResponse.success(forum, "Like toggled successfully"));
});

export const likeReply = asyncHandler(async (req, res) => {
  const { forumId, commentId, replyId } = req.params;
  const forum = await forumService.likeReply(forumId, commentId, replyId, req.user._id);
  return res.status(200).json(ApiResponse.success(forum, "Like toggled successfully"));
});

export const deleteComment = asyncHandler(async (req, res) => {
  const { forumId, commentId } = req.params;
  const forum = await forumService.deleteComment(forumId, commentId, req.user._id);
  return res.status(200).json(ApiResponse.success(forum, "Comment deleted successfully"));
});

export const deleteReply = asyncHandler(async (req, res) => {
  const { forumId, commentId, replyId } = req.params;
  const forum = await forumService.deleteReply(forumId, commentId, replyId, req.user._id);
  return res.status(200).json(ApiResponse.success(forum, "Reply deleted successfully"));
});
export const reportForum = async (req,res)=>{

    try{

        const { forumId } = req.params;

        const { reason } = req.body;

        const userId = req.user._id;

        const result = await forumService.reportForum(
    forumId,
    userId,
    reason
);
        return res.status(200).json({
            success:true,
            message:"The sender won't see if you read their messages until you reply or add them as a contact.",
            data:result
        });

    }
    catch(error){

        return res.status(500).json({
            success:false,
            message:error.message
        });

    }

}
// ==================== ADMIN ====================

export const getForumsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.query;
  const result = await forumService.getForumsForAdmin({ page, limit, search });
  return res.status(200).json(
    ApiResponse.success(result.forums, "Forums fetched successfully for admin", result.pagination)
  );
});

export const deleteForumAdmin = asyncHandler(async (req, res) => {
  const { forumId } = req.params;
  await forumService.deleteForumByAdmin(forumId);
  return res.status(200).json(ApiResponse.success(null, "Forum deleted successfully by admin"));
});

export const deleteCommentAdmin = asyncHandler(async (req, res) => {
  const { forumId, commentId } = req.params;
  const forum = await forumService.deleteCommentAdmin(forumId, commentId);
  return res.status(200).json(ApiResponse.success(forum, "Comment deleted successfully by admin"));
});

export const deleteReplyAdmin = asyncHandler(async (req, res) => {
  const { forumId, commentId, replyId } = req.params;
  const forum = await forumService.deleteReplyAdmin(forumId, commentId, replyId);
  return res.status(200).json(ApiResponse.success(forum, "Reply deleted successfully by admin"));
});

export default {
  createForum,
  getForums,
  getForumById,
  updateForum,
  deleteForum,
  addComment,
  replyToComment,
  likeForum,
  likeComment,
  likeReply,
  deleteComment,
  deleteReply,
  getForumsAdmin,
  deleteForumAdmin,
  deleteCommentAdmin,
  deleteReplyAdmin,
};
