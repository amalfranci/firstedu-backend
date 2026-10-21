import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import teacherConnectService from "../services/teacherConnect.service.js";
import teacherConnectValidator from "../validation/teacherConnect.validator.js";
import teacherRepository from "../repository/teacher.repository.js";
import { uploadImageToCloudinary } from "../utils/s3Upload.js";
/**
 * Get teacher profile (current logged-in teacher)
 */
export const getProfile = asyncHandler(async (req, res) => {
  const teacher = await teacherRepository.findById(req.user._id);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  return res
    .status(200)
    .json(ApiResponse.success(teacher, "Profile fetched successfully"));
});

/**
 * Update teacher profile (teacher can update only: name, email, gender, about, profileImage)
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const { error, value } = teacherConnectValidator.updateTeacherProfile.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const teacherId = req.user._id;
  const updateData = {};

  if (value.name !== undefined) updateData.name = value.name;
  if (value.email !== undefined) {
    const existing = await teacherRepository.findOne({ email: value.email });
    if (existing && existing._id.toString() !== teacherId.toString()) {
      throw new ApiError(409, "Email is already in use by another teacher");
    }
    updateData.email = value.email;
  }
  if (value.gender !== undefined) updateData.gender = value.gender;
  if (value.about !== undefined) updateData.about = value.about;

  const profileImageFile = req.file;
  if (profileImageFile && profileImageFile.buffer) {
    if (!profileImageFile.mimetype.startsWith("image/")) {
      throw new ApiError(400, "Profile image must be an image file");
    }
    updateData.profileImage = await uploadImageToCloudinary(
      profileImageFile.buffer,
      profileImageFile.originalname,
      "teacher-profile-images",
      profileImageFile.mimetype
    );
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError(400, "No valid fields to update");
  }

  const teacher = await teacherRepository.updateById(teacherId, updateData);

  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  return res
    .status(200)
    .json(ApiResponse.success(teacher, "Profile updated successfully"));
});

/**
 * Toggle availability (Go Live)
 */
export const toggleAvailability = asyncHandler(async (req, res) => {
  const { error, value } = teacherConnectValidator.toggleAvailability.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const teacherId = req.user._id;

  // Check if teacher is approved
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  if (teacher.status !== "approved") {
    throw new ApiError(400, "Teacher must be approved to go live");
  }

  if (value.isLive && teacher.perMinuteRate <= 0) {
    throw new ApiError(400, "Please set your per-minute rate before going live");
  }

  if (value.isLive && (!teacher.skills || teacher.skills.length === 0)) {
    throw new ApiError(400, "Please add at least one subject/skill before going live");
  }

  const updatedTeacher = await teacherRepository.updateById(teacherId, {
    isLive: value.isLive,
  });

  return res.status(200).json(
    ApiResponse.success(
      updatedTeacher,
      value.isLive ? "You are now live" : "You are now offline"
    )
  );
});

/**
 * Get teacher's session history
 */
export const getSessionHistory = asyncHandler(async (req, res) => {
  const teacherId = req.user._id;
  const { page = 1, limit = 10, status, search } = req.query;

  const result = await teacherConnectService.getTeacherSessionHistory(
    teacherId,
    parseInt(page),
    parseInt(limit),
    status || null,
    typeof search === "string" ? search.trim() || null : null
  );

  return res.status(200).json(
    ApiResponse.success(
      result.sessions,
      "Session history fetched successfully",
      result.pagination
    )
  );
});

/**
 * Delete a session from history (teacher-owned only; not while ongoing).
 */
export const deleteTeacherSession = asyncHandler(async (req, res) => {
  const teacherId = req.user._id;
  const { sessionId } = req.params;

  const result = await teacherConnectService.deleteTeacherSession(teacherId, sessionId);

  return res
    .status(200)
    .json(ApiResponse.success(result, "Session deleted successfully"));
});

/**
 * Register FCM token for push notifications (chat requests, session events).
 */
export const registerTeacherFcmToken = asyncHandler(async (req, res) => {
  const { error, value } = teacherConnectValidator.registerTeacherFcmToken.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }
  const teacherId = req.user._id;
  await teacherRepository.updateById(teacherId, {
    fcmToken: value.fcmToken.trim(),
  });
  return res.status(200).json(ApiResponse.success(null, "FCM token registered successfully"));
});

/**
 * Get teacher's earnings
 */
export const getEarnings = asyncHandler(async (req, res) => {
  const teacherId = req.user._id;
  const { startDate, endDate } = req.query;

  const earnings = await teacherConnectService.getTeacherEarnings(
    teacherId,
    startDate || null,
    endDate || null
  );

  return res
    .status(200)
    .json(ApiResponse.success(earnings, "Earnings fetched successfully"));
});

/**
 * Teacher dashboard: income, today's talk time, completed sessions, rating, recent sessions.
 */
export const getDashboard = asyncHandler(async (req, res) => {
  const data = await teacherConnectService.getTeacherDashboard(req.user._id);
  return res.status(200).json(ApiResponse.success(data, "Dashboard fetched successfully"));
});

/**
 * GET /teacher/active-session
 * Fetch active/pending call or chat session for the logged in teacher (for page refresh restoration)
 */
export const getActiveSession = asyncHandler(async (req, res) => {
  const data = await teacherConnectService.getTeacherActiveSession(req.user._id);
  return res.status(200).json(ApiResponse.success(data, "Teacher active session fetched successfully"));
});

export default {
  getProfile,
  updateProfile,
  toggleAvailability,
  registerTeacherFcmToken,
  getSessionHistory,
  deleteTeacherSession,
  getEarnings,
  getDashboard,
  getActiveSession,
};

