import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import teacherConnectService from "../services/teacherConnect.service.js";
import teacherConnectValidator from "../validation/teacherConnect.validator.js";
import walletService from "../services/wallet.service.js";
import teacherRepository from "../repository/teacher.repository.js";
import { getRateBreakdown } from "../services/platformFee.service.js";

/**
 * Get available teachers by subject
 */
export const getAvailableTeachers = asyncHandler(async (req, res) => {
  const { subject, page = 1, limit = 10, search, presence } = req.query;

  const result = await teacherConnectService.getAvailableTeachers(
    subject,
    parseInt(page),
    parseInt(limit),
    search,
    presence
  );

  return res.status(200).json(
    ApiResponse.success(
      {
        teachers: result.teachers,
        totalTeachers: result.totalTeachers,
        totalOnline: result.totalOnline,
      },
      "Available teachers fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get a single teacher's details by ID (for students). Phone and email excluded from response.
 */
export const getTeacherById = asyncHandler(async (req, res) => {
  const { teacherId } = req.params;
  const teacher = await teacherConnectService.getTeacherById(teacherId);
  return res
    .status(200)
    .json(ApiResponse.success(teacher, "Teacher details fetched successfully"));
});

/**
 * Get student's call history
 */
export const getCallHistory = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  const result = await teacherConnectService.getStudentCallHistory(
    studentId,
    parseInt(page),
    parseInt(limit),
    status || null
  );

  return res.status(200).json(
    ApiResponse.success(
      result.sessions,
      "Call history fetched successfully",
      result.pagination
    )
  );
});

/**
 * Download call recording as MP3 (converts legacy files on demand).
 */
export const downloadCallRecording = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { sessionId } = req.params;

  const { buffer, fileName } = await teacherConnectService.getCallRecordingMp3Download(
    studentId,
    sessionId
  );

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName.replace(/"/g, "")}"`
  );
  res.send(buffer);
});

/**
 * Get call report conversations grouped by teacher.
 */
export const getCallReportConversations = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 20, search } = req.query;

  const result = await teacherConnectService.getStudentCallConversations(
    studentId,
    parseInt(page),
    parseInt(limit),
    search || null
  );

  return res.status(200).json(
    ApiResponse.success(
      result.conversations,
      "Call conversations fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get all recordings with a teacher.
 */
export const getCallTeacherRecordings = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { teacherId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const result = await teacherConnectService.getStudentCallRecordingsByTeacher(
    studentId,
    teacherId,
    parseInt(page),
    parseInt(limit)
  );

  return res.status(200).json(
    ApiResponse.success(
      result.recordings,
      "Call recordings fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get student's call recordings
 */
export const getCallRecordings = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 10 } = req.query;

  const result = await teacherConnectService.getStudentRecordings(
    studentId,
    parseInt(page),
    parseInt(limit)
  );

  return res.status(200).json(
    ApiResponse.success(
      result.sessions,
      "Call recordings fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get student's chat conversations grouped by teacher.
 */
export const getChatReportSessions = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 20, search } = req.query;

  const result = await teacherConnectService.getStudentChatConversations(
    studentId,
    parseInt(page),
    parseInt(limit),
    search || null
  );

  return res.status(200).json(
    ApiResponse.success(
      result.conversations,
      "Chat conversations fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get all messages with a teacher (merged across sessions).
 */
export const getChatTeacherMessages = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { teacherId } = req.params;
  const { page = 1, limit = 200 } = req.query;

  const result = await teacherConnectService.getStudentChatMessagesByTeacher(
    studentId,
    teacherId,
    parseInt(page),
    parseInt(limit)
  );

  return res.status(200).json(
    ApiResponse.success(
      {
        messages: result.messages,
        sessions: result.sessions || [],
      },
      "Chat messages fetched successfully",
      result.pagination
    )
  );
});

/**
 * Get messages for a completed chat session.
 */
export const getChatSessionMessages = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { sessionId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const result = await teacherConnectService.getStudentChatMessages(
    studentId,
    sessionId,
    parseInt(page),
    parseInt(limit)
  );

  return res.status(200).json(
    ApiResponse.success(
      result.messages,
      "Chat messages fetched successfully",
      result.pagination
    )
  );
});

/**
 * Check wallet balance before connecting
 */
export const checkWalletBalance = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { teacherId } = req.params;

  const wallet = await walletService.getWalletBalance(studentId, "User");

  // Get teacher to check rate
  const teacher = await teacherRepository.findById(teacherId);

  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const rate = getRateBreakdown(teacher);
  const canAfford = wallet.monetaryBalance >= rate.studentPerMinuteRate;
  const estimatedCost = rate.studentPerMinuteRate; // For 1 minute minimum

  return res.status(200).json(
    ApiResponse.success(
      {
        walletBalance: wallet.monetaryBalance,
        teacherRate: rate.teacherPerMinuteRate,
        platformFeePercent: rate.platformFeePercent,
        platformFeePerMinute: rate.platformFeePerMinute,
        studentRate: rate.studentPerMinuteRate,
        canAfford,
        estimatedCost,
        message: canAfford
          ? "Sufficient balance to connect"
          : "Insufficient balance. Please recharge your wallet.",
      },
      "Wallet balance checked successfully"
    )
  );
});

/**
 * Rate a teacher (1-5). Updates or sets the student's rating for the teacher; teacher's average rating is recalculated.
 */
export const rateTeacher = asyncHandler(async (req, res) => {
  const { error, value } = teacherConnectValidator.rateTeacher.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }
  const studentId = req.user._id;
  const { teacherId } = req.params;
  const { rating } = value;

  const result = await teacherConnectService.rateTeacher(teacherId, studentId, rating);

  return res
    .status(200)
    .json(ApiResponse.success(result, "Rating submitted successfully"));
});

/**
 * GET /user/teacher-sessions/active-session
 * Fetch active/pending call or chat session for the logged in student (for page refresh restoration)
 */
export const getStudentActiveSession = asyncHandler(async (req, res) => {
  const data = await teacherConnectService.getStudentActiveSession(req.user._id);
  return res.status(200).json(ApiResponse.success(data, "Student active session fetched successfully"));
});

export default {
  getAvailableTeachers,
  getTeacherById,
  getCallHistory,
  getCallRecordings,
  getCallReportConversations,
  getCallTeacherRecordings,
  downloadCallRecording,
  getChatReportSessions,
  getChatTeacherMessages,
  getChatSessionMessages,
  checkWalletBalance,
  rateTeacher,
  getStudentActiveSession,
};

