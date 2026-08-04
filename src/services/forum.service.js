import { ApiError } from "../utils/ApiError.js";
import forumRepository from "../repository/forum.repository.js";
import { uploadImageToCloudinary, deleteFileFromCloudinary } from "../utils/s3Upload.js";
import ForumReport from "../models/forumReport.model.js";
const FORUM_IMAGE_FOLDER = "forums";

const defaultPopulate = [
  { path: "createdBy", select: "name email" },
  { path: "comments.author", select: "name email" },
  { path: "comments.replies.author", select: "name email" },
];

export const createForum = async (data, userId, file) => {
  const { title, description, tags, topic } = data;
  if (!title || !topic) {
    throw new ApiError(400, "Title and topic are required");
  }

  let attachmentUrl = null;
  if (file?.buffer) {
    attachmentUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      FORUM_IMAGE_FOLDER,
      file.mimetype
    );
  }

  return await forumRepository.create({
    title,
    description: description || "",
    tags: Array.isArray(tags) ? tags : [],
    topic,
    attachment: attachmentUrl,
    createdBy: userId,
    likes: [],
    comments: [],
  });
};

export const getForums = async (userId, options = {}) => {
  const { search, page = 1, limit = 10 } = options;
  const query = {};
  const reportedForums = await ForumReport.find({
    userId,
}).select("forumId");

const reportedForumIds = reportedForums.map(
    report => report.forumId
);
  if (search && search.trim()) {
    query.$or = [
      { title: { $regex: search.trim(), $options: "i" } },
      { description: { $regex: search.trim(), $options: "i" } },
      { topic: { $regex: search.trim(), $options: "i" } },
    ];
  }
if (reportedForumIds.length > 0) {
    query._id = {
        $nin: reportedForumIds,
    };
}
  const [all, total] = await Promise.all([
    forumRepository.find(query, {
      populate: defaultPopulate,
      sort: { createdAt: -1 },
    }),
    forumRepository.count(query),
  ]);

  let sorted = all;
  if (userId && all.length) {
    const mine = all.filter((f) => f.createdBy?._id?.toString() === userId.toString());
    const others = all.filter((f) => f.createdBy?._id?.toString() !== userId.toString());
    sorted = [...mine, ...others];
  }

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
  const skip = (pageNum - 1) * limitNum;
  const forums = sorted.slice(skip, skip + limitNum);

  return {
    forums,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

export const getForumById = async (id) => {
  const forum = await forumRepository.findById(id, defaultPopulate);
  if (!forum) throw new ApiError(404, "Forum not found");
  return forum;
};

export const updateForum = async (id, data, userId, file) => {
  const forum = await forumRepository.findById(id);
  if (!forum) throw new ApiError(404, "Forum not found");
  if (forum.createdBy.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only update forums you created");
  }

  const updateData = {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.tags !== undefined && { tags: Array.isArray(data.tags) ? data.tags : [] }),
    ...(data.topic !== undefined && { topic: data.topic }),
  };

  if (file?.buffer) {
    if (forum.attachment) await deleteFileFromCloudinary(forum.attachment);
    updateData.attachment = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      FORUM_IMAGE_FOLDER,
      file.mimetype
    );
  }

  return await forumRepository.updateById(id, updateData);
};

export const reportForum = async (

    forumId,

    userId,

    reason

)=>{

    const report = await ForumReport.create({

        forumId,

        userId,

        reason

    });

    return report;

}
export const deleteForum = async (id, userId) => {
  const forum = await forumRepository.findById(id);
  if (!forum) throw new ApiError(404, "Forum not found");
  if (forum.createdBy.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only delete forums you created");
  }
  if (forum.attachment) await deleteFileFromCloudinary(forum.attachment);
  return await forumRepository.deleteById(id);
};

export const addComment = async (forumId, content, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  if (!content || !content.trim()) throw new ApiError(400, "Content is required");

  forum.comments.push({
    content: content.trim(),
    author: userId,
    likes: [],
    replies: [],
  });
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const replyToComment = async (forumId, commentId, content, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  if (!content || !content.trim()) throw new ApiError(400, "Content is required");

  comment.replies.push({
    content: content.trim(),
    author: userId,
    likes: [],
  });
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

const toggleLike = (arr, userId) => {
  const idx = arr.findIndex((id) => id.toString() === userId.toString());
  if (idx > -1) arr.splice(idx, 1);
  else arr.push(userId);
};

export const likeForum = async (forumId, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  toggleLike(forum.likes, userId);
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const likeComment = async (forumId, commentId, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  toggleLike(comment.likes, userId);
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const likeReply = async (forumId, commentId, replyId, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  const reply = comment.replies.id(replyId);
  if (!reply) throw new ApiError(404, "Reply not found");
  toggleLike(reply.likes, userId);
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const deleteComment = async (forumId, commentId, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  if (comment.author.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only delete your own comment");
  }
  forum.comments.pull(commentId);
  forum.markModified("comments");
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const deleteReply = async (forumId, commentId, replyId, userId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  const reply = comment.replies.id(replyId);
  if (!reply) throw new ApiError(404, "Reply not found");
  if (reply.author.toString() !== userId.toString()) {
    throw new ApiError(403, "You can only delete your own reply");
  }
  comment.replies.pull(replyId);
  forum.markModified("comments");
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

// ==================== ADMIN ====================

export const getForumsForAdmin = async (options = {}) => {
  const { page = 1, limit = 10, search } = options;
  const query = {};
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { topic: { $regex: search, $options: "i" } },
    ];
  }
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const [forums, total, stats] = await Promise.all([
    forumRepository.find(query, {
      populate: defaultPopulate,
      sort: { createdAt: -1 },
      skip,
      limit: limitNum,
    }),
    forumRepository.count(query),
    forumRepository.getForumStats(),
  ]);

  return {
    forums,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
      ...stats,
    },
  };
};

export const deleteForumByAdmin = async (forumId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  if (forum.attachment) await deleteFileFromCloudinary(forum.attachment);
  return await forumRepository.deleteById(forumId);
};

export const deleteCommentAdmin = async (forumId, commentId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  forum.comments.pull(commentId);
  forum.markModified("comments");
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

export const deleteReplyAdmin = async (forumId, commentId, replyId) => {
  const forum = await forumRepository.findById(forumId);
  if (!forum) throw new ApiError(404, "Forum not found");
  const comment = forum.comments.id(commentId);
  if (!comment) throw new ApiError(404, "Comment not found");
  const reply = comment.replies.id(replyId);
  if (!reply) throw new ApiError(404, "Reply not found");
  comment.replies.pull(replyId);
  forum.markModified("comments");
  await forum.save();
  return await forumRepository.findById(forumId, defaultPopulate);
};

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
  reportForum,
  getForumsForAdmin,
  deleteForumByAdmin,
  deleteCommentAdmin,
  deleteReplyAdmin,
};
