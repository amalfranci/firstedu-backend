import { ApiError } from "../utils/ApiError.js";
import teacherRepository from "../repository/teacher.repository.js";
import teacherSessionRepository from "../repository/teacherSession.repository.js";
import teacherRatingRepository from "../repository/teacherRating.repository.js";
import walletService from "./wallet.service.js";
import * as teacherWalletLedger from "./teacherWalletLedger.service.js";
import Teacher from "../models/Teacher.js";
import { rejectChatSession, chatConstants } from "./teacherChat.service.js";
import {
  buildSessionRateSnapshot,
  roundMoney,
  withStudentPricing,
} from "./platformFee.service.js";
import teacherChatMessageRepository from "../repository/teacherChatMessage.repository.js";
import * as agoraCloudRecording from "./agoraCloudRecording.service.js";
import {
  resolveSessionRecordingMp3,
  buildCallRecordingDownloadName,
} from "./callRecordingMp3.service.js";

const { INSUFFICIENT_REQUEST_MSG, TEACHER_BUSY_MSG } = chatConstants;
const roundDurationMinutes = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

/** Strip phone and email from teacher object for student-facing responses */
const omitContactFromTeacher = (teacher) => {
  const obj = teacher.toObject ? teacher.toObject() : { ...teacher };
  delete obj.phone;
  delete obj.email;
  return obj;
};

/**
 * Get available teachers by subject.
 * Returns all approved teachers (live or not). Each teacher includes isOnline and averageRating.
 * Phone and email are excluded from response.
 */
export const getAvailableTeachers = async (
  subject,
  page = 1,
  limit = 10,
  search,
  presence
) => {
  const baseFilter = {
    status: "approved",
  };

  if (subject) {
    baseFilter.skills = { $in: [new RegExp(subject, "i")] };
  }

  if (search) {
    baseFilter.name = { $regex: search, $options: "i" };
  }

  const filter = { ...baseFilter };
  const p = (presence || "").toString().trim().toLowerCase();
  if (p === "online") {
    filter.isLive = true;
  } else if (p === "offline") {
    filter.isLive = false;
  }

  const options = {
    page,
    limit,
    sortBy: "perMinuteRate",
    sortOrder: "asc",
  };

  const [result, totalOnline] = await Promise.all([
    teacherRepository.findAll(filter, options),
    Teacher.countDocuments({ ...baseFilter, isLive: true }),
  ]);

  const teachers = result.teachers.map((teacher) => ({
    ...omitContactFromTeacher(withStudentPricing(teacher)),
    isOnline: teacher.isLive,
    averageRating: teacher.averageRating ?? 0,
    ratingCount: teacher.ratingCount ?? 0,
  }));

  return {
    teachers,
    pagination: result.pagination,
    totalTeachers: result.pagination.total,
    totalOnline,
  };
};

/**
 * Get a single teacher's details by ID (for students). Only approved teachers. Phone and email excluded.
 */
export const getTeacherById = async (teacherId) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  if (teacher.status !== "approved") {
    throw new ApiError(404, "Teacher not found");
  }
  const result = {
    ...omitContactFromTeacher(withStudentPricing(teacher)),
    isOnline: teacher.isLive,
    averageRating: teacher.averageRating ?? 0,
    ratingCount: teacher.ratingCount ?? 0,
  };
  return result;
};

/**
 * Initiate a call request (used by socket; same rules as chat request).
 */
export const initiateCallRequest = async (studentId, teacherId, subject) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  if (teacher.status !== "approved") {
    throw new ApiError(400, "Teacher is not approved");
  }

  if (!teacher.isLive) {
    throw new ApiError(400, "Teacher is not currently live");
  }

  if (teacher.perMinuteRate <= 0) {
    throw new ApiError(400, "Teacher has not set their rate");
  }

  const teacherBusyChat = await teacherSessionRepository.findTeacherActiveChatSession(teacherId);
  if (teacherBusyChat) {
    throw new ApiError(409, TEACHER_BUSY_MSG);
  }

  const teacherBusyCall = await teacherSessionRepository.findTeacherActiveCallSession(teacherId);
  if (teacherBusyCall) {
    throw new ApiError(409, TEACHER_BUSY_MSG);
  }

  const studentBusyChat = await teacherSessionRepository.findStudentOngoingChatSession(studentId);
  if (studentBusyChat) {
    throw new ApiError(400, "You already have an active chat session");
  }

  const studentBusyCall = await teacherSessionRepository.findStudentOngoingCallSession(studentId);
  if (studentBusyCall) {
    throw new ApiError(400, "You already have an active call");
  }

  const ongoingSession = await teacherSessionRepository.findOngoingSession(studentId, teacherId);
  if (ongoingSession) {
    throw new ApiError(400, "You already have an ongoing session with this teacher");
  }

  const existingPending = await teacherSessionRepository.findPendingCallBetween(
    studentId,
    teacherId
  );
  if (existingPending) {
    throw new ApiError(400, "You already have a pending call request with this teacher");
  }

  const rateSnapshot = buildSessionRateSnapshot(teacher);
  const wallet = await walletService.getWalletBalance(studentId, "User");
  if (wallet.monetaryBalance < rateSnapshot.studentPerMinuteRate) {
    throw new ApiError(400, INSUFFICIENT_REQUEST_MSG);
  }

  const session = await teacherSessionRepository.create({
    student: studentId,
    teacher: teacherId,
    subject: subject || teacher.skills[0] || "General",
    sessionKind: "call",
    ...rateSnapshot,
    status: "pending",
    initiatedBy: "student",
  });

  return session;
};

/**
 * Accept call request (teacher)
 */
export const acceptCallRequest = async (teacherId, sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.sessionKind === "chat") {
    throw new ApiError(400, "Chat requests must be accepted in the live chat connection");
  }

  if (session.teacher._id.toString() !== teacherId.toString()) {
    throw new ApiError(403, "Unauthorized to accept this session");
  }

  if (session.status !== "pending") {
    throw new ApiError(400, `Session is already ${session.status}`);
  }

  if (session.sessionKind === "call") {
    const teacherBusyChat = await teacherSessionRepository.findTeacherActiveChatSession(teacherId);
    if (teacherBusyChat) {
      throw new ApiError(409, TEACHER_BUSY_MSG);
    }
    const teacherBusyCall = await teacherSessionRepository.findTeacherActiveCallSession(teacherId);
    if (teacherBusyCall && teacherBusyCall._id.toString() !== sessionId.toString()) {
      throw new ApiError(409, TEACHER_BUSY_MSG);
    }

    const wallet = await walletService.getWalletBalance(session.student._id, "User");
    const studentRate = session.studentPerMinuteRate || session.perMinuteRate;
    if (wallet.monetaryBalance < studentRate) {
      await teacherSessionRepository.updateById(sessionId, {
        status: "cancelled",
        rejectedAt: new Date(),
        rejectionReason: INSUFFICIENT_REQUEST_MSG,
        sessionEndReason: "insufficient_balance_at_accept",
        callEndTime: new Date(),
      });
      throw new ApiError(400, INSUFFICIENT_REQUEST_MSG);
    }
  }

  const updatedSession = await teacherSessionRepository.updateById(sessionId, {
    status: "accepted",
    acceptedAt: new Date(),
  });

  return updatedSession;
};

/**
 * Reject call request (teacher)
 */
export const rejectCallRequest = async (teacherId, sessionId, reason) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.teacher._id.toString() !== teacherId.toString()) {
    throw new ApiError(403, "Unauthorized to reject this session");
  }

  if (session.status !== "pending") {
    throw new ApiError(400, `Session is already ${session.status}`);
  }

  if (session.sessionKind === "chat") {
    return await rejectChatSession(teacherId, sessionId, reason);
  }

  const updatedSession = await teacherSessionRepository.updateById(sessionId, {
    status: "rejected",
    rejectedAt: new Date(),
    rejectionReason: reason || "Teacher declined the call",
  });

  return updatedSession;
};

/**
 * Start billing for an Agora RTC session (clients join via POST .../agora-token, then call this when ready).
 */
export const startCall = async (sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.sessionKind === "chat") {
    throw new ApiError(400, "Chat sessions start automatically when accepted in chat");
  }

  if (session.status !== "accepted") {
    throw new ApiError(400, "Session must be accepted before starting");
  }

  const updatedSession = await teacherSessionRepository.updateById(sessionId, {
    status: "ongoing",
    callStartTime: new Date(),
  });

  return updatedSession;
};

/**
 * End call and process billing
 */
export const endCall = async (sessionId, durationMinutes, recordingUrl = null, agoraRecordingId = null) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.sessionKind === "chat") {
    throw new ApiError(400, "End chat sessions through the chat connection");
  }

  if (session.status !== "ongoing") {
    throw new ApiError(400, "Session is not ongoing");
  }

  const elapsedMinutes =
    typeof durationMinutes === "number" && durationMinutes > 0 && Number.isFinite(durationMinutes)
      ? durationMinutes
      : session.callStartTime
        ? Math.max(
            1 / 60,
            (Date.now() - new Date(session.callStartTime).getTime()) / 60000
          )
        : 1;
  const billableMinutes = roundDurationMinutes(elapsedMinutes);
  const studentRate = session.studentPerMinuteRate || session.perMinuteRate;
  const teacherRate = session.teacherPerMinuteRate || session.perMinuteRate;
  const platformFeeRate =
    session.platformFeePerMinute || Math.max(0, studentRate - teacherRate);
  const totalAmount = roundMoney(billableMinutes * studentRate);
  const teacherAmount = roundMoney(billableMinutes * teacherRate);
  const platformFeeAmount = roundMoney(billableMinutes * platformFeeRate);

  let actualDeductAmount = totalAmount;
  if (!session.amountDeducted) {
    try {
      const wallet = await walletService.getOrCreateWallet(session.student._id, "User");
      const currentBalance = Number(wallet?.monetaryBalance || 0);
      actualDeductAmount = Math.max(0, Math.min(currentBalance, totalAmount));
    } catch {
      actualDeductAmount = 0;
    }
  }

  // Atomically claim completion so duplicate end/disconnect events cannot credit twice.
  const completionPayload = {
    status: "completed",
    callEndTime: new Date(),
    durationMinutes: billableMinutes,
    totalAmount,
    teacherAmount,
    platformFeeAmount,
    amountDeducted: true,
  };
  if (recordingUrl) completionPayload.recordingUrl = recordingUrl;
  if (agoraRecordingId) completionPayload.agoraRecordingId = agoraRecordingId;

  const updatedSession = await teacherSessionRepository.completeOngoingSession(
    sessionId,
    completionPayload
  );

  if (!updatedSession) {
    return await teacherSessionRepository.findById(sessionId);
  }

  if (!session.amountDeducted && actualDeductAmount > 0) {
    await walletService
      .deductMonetaryBalance(session.student._id, actualDeductAmount, "User")
      .catch((err) => {
        console.warn("Wallet deduction warning during endCall:", err?.message);
      });
  }

  const teacherId = session.teacher._id || session.teacher;
  const creditAmount = Number(updatedSession.teacherAmount ?? teacherAmount);
  if (creditAmount > 0) {
    const alreadyCredited = await teacherWalletLedger.hasSessionEarning(
      teacherId,
      updatedSession._id
    );
    if (!alreadyCredited) {
      await walletService.addMonetaryBalance(
        teacherId,
        creditAmount,
        `agora_session_${sessionId}`,
        "Teacher"
      );
    }
    const bal = await walletService.getWalletBalance(teacherId, "Teacher");
    await teacherWalletLedger
      .recordSessionEarning({
        teacherId,
        amount: creditAmount,
        balanceAfter: bal.monetaryBalance,
        sessionId: updatedSession._id,
        sessionKind: "agora_call",
      })
      .catch((e) => console.error("teacherWalletLedger recordSessionEarning:", e));
  }

  return updatedSession;
};

/**
 * Student disconnects before teacher accepts (same pattern as chat).
 */
export const cancelPendingCallRequestByStudent = async (studentId, sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);
  if (!session || session.sessionKind !== "call") {
    return null;
  }
  if (session.student._id.toString() !== studentId.toString()) {
    throw new ApiError(403, "Unauthorized to cancel this call request");
  }
  if (session.status !== "pending") {
    return null;
  }
  return await teacherSessionRepository.updateById(sessionId, {
    status: "cancelled",
    rejectedAt: new Date(),
    rejectionReason: "Student left before the call started",
    callEndTime: new Date(),
    sessionEndReason: "student_withdrew_before_accept",
  });
};

/**
 * Cancel call request (student)
 */
export const cancelCallRequest = async (studentId, sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.student._id.toString() !== studentId.toString()) {
    throw new ApiError(403, "Unauthorized to cancel this session");
  }

  if (!["pending", "accepted"].includes(session.status)) {
    throw new ApiError(400, `Cannot cancel session with status: ${session.status}`);
  }

  const updatedSession = await teacherSessionRepository.updateById(sessionId, {
    status: "cancelled",
  });

  return updatedSession;
};

/**
 * Get student's call history
 */
export const getStudentCallHistory = async (studentId, page = 1, limit = 10, status = null) => {
  return await teacherSessionRepository.findStudentSessions(studentId, {
    page,
    limit,
    status,
  });
};

/**
 * Unique teachers with call recordings (call report sidebar).
 */
export const getStudentCallConversations = async (
  studentId,
  page = 1,
  limit = 20,
  search = null
) => {
  return await teacherSessionRepository.findCallConversationsByStudent(studentId, {
    page,
    limit,
    search,
  });
};

/**
 * Convert legacy mp4 recordings to mp3 when listing (updates DB).
 */
export const hydrateCallRecordingsAsMp3 = async (recordings) => {
  const hydrated = [];
  for (const rec of recordings) {
    const doc = rec.toObject ? rec.toObject() : { ...rec };
    if (doc.recordingUrl && !/\.mp3(\?|$)/i.test(doc.recordingUrl)) {
      try {
        const mp3Url = await resolveSessionRecordingMp3(doc);
        if (mp3Url) doc.recordingUrl = mp3Url;
      } catch (err) {
        console.error(
          `[MP3] hydrate failed for session ${doc._id}:`,
          err.message
        );
      }
    }
    hydrated.push(doc);
  }
  return hydrated;
};

/**
 * All MP3 recordings with a specific teacher.
 */
export const getStudentCallRecordingsByTeacher = async (
  studentId,
  teacherId,
  page = 1,
  limit = 50
) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const result = await teacherSessionRepository.findCallRecordingsByStudentAndTeacher(
    studentId,
    teacherId,
    { page, limit }
  );

  const recordings = await hydrateCallRecordingsAsMp3(result.recordings);

  return {
    recordings,
    pagination: result.pagination,
  };
};

/**
 * Get MP3 bytes for a call recording download (converts legacy mp4 on demand).
 */
export const getCallRecordingMp3Download = async (studentId, sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);
  if (!session || session.sessionKind !== "call") {
    throw new ApiError(404, "Call session not found");
  }
  if (session.student._id?.toString?.() !== studentId.toString()) {
    throw new ApiError(403, "You do not have access to this recording");
  }
  if (!session.recordingUrl) {
    throw new ApiError(404, "No recording available for this call");
  }

  const mp3Url = await resolveSessionRecordingMp3(session);
  if (!mp3Url) {
    throw new ApiError(404, "Recording file is not available");
  }

  const res = await fetch(mp3Url);
  if (!res.ok) {
    throw new ApiError(502, "Failed to fetch recording file from storage");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const teacherName =
    session.teacher?.name ||
    (typeof session.teacher === "object" ? session.teacher.name : "teacher");

  return {
    buffer,
    fileName: buildCallRecordingDownloadName(teacherName, session.callEndTime),
    mp3Url,
  };
};

/**
 * Get student's call recordings (completed call sessions with a recording URL).
 */
export const getStudentRecordings = async (studentId, page = 1, limit = 10) => {
  return await teacherSessionRepository.findStudentSessions(studentId, {
    page,
    limit,
    status: "completed",
    sessionKind: "call",
    hasRecording: true,
    sortBy: "callEndTime",
    sortOrder: "desc",
  });
};

/**
 * Unique teacher conversations for chat report (one row per teacher).
 */
export const getStudentChatConversations = async (
  studentId,
  page = 1,
  limit = 20,
  search = null
) => {
  return await teacherChatMessageRepository.findConversationsByStudent(studentId, {
    page,
    limit,
    search,
  });
};

/**
 * All messages with a teacher across every completed chat session.
 */
export const getStudentChatMessagesByTeacher = async (
  studentId,
  teacherId,
  page = 1,
  limit = 200
) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const [result, chatSessionsResult] = await Promise.all([
    teacherChatMessageRepository.findByStudentAndTeacher(studentId, teacherId, {
      page,
      limit,
      sortOrder: "asc",
    }),
    teacherSessionRepository.findChatSessionsByStudentAndTeacher(
      studentId,
      teacherId,
      { page: 1, limit: 100 }
    ),
  ]);

  if (
    result.messages.length === 0 &&
    (chatSessionsResult.sessions?.length ?? 0) === 0
  ) {
    throw new ApiError(404, "No chat history with this teacher");
  }

  return {
    ...result,
    sessions: chatSessionsResult.sessions || [],
    sessionsPagination: chatSessionsResult.pagination,
  };
};

/**
 * Completed chat sessions for the student (chat report list).
 * @deprecated Use getStudentChatConversations for grouped-by-teacher UI.
 */
export const getStudentChatSessions = async (
  studentId,
  page = 1,
  limit = 10,
  teacherId = null
) => {
  const result = await teacherSessionRepository.findStudentSessions(studentId, {
    page,
    limit,
    status: "completed",
    sessionKind: "chat",
    sortBy: "chatStartedAt",
    sortOrder: "desc",
    teacherId,
  });

  const sessions = await Promise.all(
    result.sessions.map(async (session) => {
      const doc = session.toObject ? session.toObject() : { ...session };
      const messageCount = await teacherChatMessageRepository.countBySession(session._id);
      return { ...doc, messageCount };
    })
  );

  return {
    sessions,
    pagination: result.pagination,
  };
};

/**
 * Paginated chat messages for a completed chat session (student only).
 */
export const getStudentChatMessages = async (
  studentId,
  sessionId,
  page = 1,
  limit = 50
) => {
  const session = await teacherSessionRepository.findById(sessionId);
  if (!session || session.sessionKind !== "chat") {
    throw new ApiError(404, "Chat session not found");
  }
  const sid = session.student._id?.toString?.() ?? String(session.student);
  if (sid !== studentId.toString()) {
    throw new ApiError(403, "You do not have access to this chat session");
  }
  if (session.status !== "completed") {
    throw new ApiError(400, "Chat history is available after the session ends");
  }

  return await teacherChatMessageRepository.findBySession(sessionId, {
    page,
    limit,
    sortOrder: "asc",
  });
};

/**
 * Stop Agora Cloud Recording in the background and patch the session URL when ready.
 */
export const finalizeCallRecordingAsync = (sessionId, snapshot = null) => {
  Promise.resolve()
    .then(async () => {
      await agoraCloudRecording.waitForRecordingReady(sessionId, 6000);
      const stopped = await agoraCloudRecording.stopCallRecording(sessionId, snapshot);
      if (!stopped.recordingUrl && !stopped.agoraRecordingId) return;
      await teacherSessionRepository.updateById(sessionId, {
        ...(stopped.recordingUrl ? { recordingUrl: stopped.recordingUrl } : {}),
        ...(stopped.agoraRecordingId
          ? { agoraRecordingId: stopped.agoraRecordingId }
          : {}),
      });
    })
    .catch((err) => {
      console.error("finalizeCallRecordingAsync:", err.message);
    })
    .finally(() => {
      agoraCloudRecording.clearActiveRecordingHandle(sessionId);
    });
};

/**
 * End call immediately; finalize Agora Cloud Recording asynchronously.
 */
export const endCallWithRecording = async (
  sessionId,
  durationMinutes,
  clientRecordingUrl = null,
  clientAgoraRecordingId = null
) => {
  const preSession = await teacherSessionRepository.findById(sessionId);
  const recordingSnapshot = preSession
    ? {
        resourceId: preSession.agoraRecordingResourceId || undefined,
        sid: preSession.agoraRecordingId || undefined,
      }
    : null;

  const updated = await endCall(
    sessionId,
    durationMinutes,
    clientRecordingUrl || null,
    clientAgoraRecordingId || null
  );
  finalizeCallRecordingAsync(sessionId, recordingSnapshot);
  return updated;
};

/**
 * Get teacher's pending requests
 */
export const getTeacherPendingRequests = async (teacherId) => {
  return await teacherSessionRepository.findPendingRequests(teacherId);
};

/**
 * Get teacher's session history
 * @param {string|null} search - optional: student name/email, subject, status text, or "chat"/"call"
 */
export const getTeacherSessionHistory = async (
  teacherId,
  page = 1,
  limit = 10,
  status = null,
  search = null
) => {
  return await teacherSessionRepository.findTeacherSessions(teacherId, {
    page,
    limit,
    status,
    search,
  });
};

/**
 * Remove a session from the teacher's history (and DB). Own sessions only.
 * Active (ongoing) sessions must be ended first.
 */
export const deleteTeacherSession = async (teacherId, sessionId) => {
  const session = await teacherSessionRepository.findById(sessionId);

  if (!session) {
    throw new ApiError(404, "Session not found");
  }

  if (session.teacher._id.toString() !== teacherId.toString()) {
    throw new ApiError(403, "Unauthorized to delete this session");
  }

  if (session.status === "ongoing") {
    throw new ApiError(
      400,
      "Cannot delete an active session. End the call or chat first."
    );
  }

  await teacherSessionRepository.deleteById(sessionId);
  return { deleted: true, sessionId: session._id.toString() };
};

/**
 * Get teacher's earnings
 */
export const getTeacherEarnings = async (teacherId, startDate = null, endDate = null) => {
  return await teacherSessionRepository.calculateTeacherEarnings(teacherId, startDate, endDate);
};

/**
 * Dashboard: income, today's talk time, completed session counts, rating, recent sessions.
 */
export const getTeacherDashboard = async (teacherId) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }

  const [stats, history] = await Promise.all([
    teacherSessionRepository.getTeacherDashboardSessionAggregates(teacherId),
    teacherSessionRepository.findTeacherSessions(teacherId, { page: 1, limit: 3 }),
  ]);

  return {
    totalIncome: stats.totalIncome,
    todayTalktimeMinutes: stats.todayTalktimeMinutes,
    totalCompletedSessions: stats.totalCompletedSessions,
    rating: {
      averageRating: teacher.averageRating ?? 0,
      ratingCount: teacher.ratingCount ?? 0,
    },
    recentSessions: history.sessions,
  };
};

/**
 * Rate a teacher (1-5). Replaces previous rating if student already rated. Auto-updates teacher's averageRating.
 */
export const rateTeacher = async (teacherId, studentId, rating) => {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  if (teacher.status !== "approved") {
    throw new ApiError(400, "Cannot rate a teacher who is not approved");
  }

  await teacherRatingRepository.upsert(teacherId, studentId, rating);
  const { averageRating, ratingCount } = await teacherRatingRepository.getAggregationForTeacher(
    teacherId
  );
  await teacherRatingRepository.updateTeacherRatingFields(teacherId, averageRating, ratingCount);

  return { averageRating, ratingCount };
};

/**
 * Get active/ongoing or pending session for a teacher (used to restore UI state on refresh)
 */
export const getTeacherActiveSession = async (teacherId) => {
  // 1. Check active/accepted call session
  const activeCall = await teacherSessionRepository.findTeacherActiveCallSession(teacherId);
  if (activeCall) {
    return {
      type: "call",
      state: activeCall.status, // "accepted" or "ongoing"
      session: activeCall,
      student: activeCall.student,
    };
  }

  // 2. Check active ongoing chat session
  const activeChat = await teacherSessionRepository.findTeacherActiveChatSession(teacherId);
  if (activeChat) {
    const { messages } = await teacherChatMessageRepository.findBySession(activeChat._id, {
      limit: 100,
      sortOrder: "asc",
    });
    return {
      type: "chat",
      state: "active",
      session: activeChat,
      student: activeChat.student,
      messages: messages || [],
    };
  }

  // 3. Check pending call request
  const pendingCall = await teacherSessionRepository.findTeacherPendingCallSession(teacherId);
  if (pendingCall) {
    const elapsedMs = Date.now() - new Date(pendingCall.createdAt).getTime();
    if (elapsedMs > 45_000 + 15_000) {
      await teacherSessionRepository.updateById(pendingCall._id, {
        status: "cancelled",
        sessionEndReason: "teacher_no_response_timeout",
        callEndTime: new Date(),
      });
    } else {
      return {
        type: "call",
        state: "pending",
        session: pendingCall,
        student: pendingCall.student,
      };
    }
  }

  // 4. Check pending chat request
  const pendingChat = await teacherSessionRepository.findTeacherPendingChatSession(teacherId);
  if (pendingChat) {
    const elapsedMs = Date.now() - new Date(pendingChat.createdAt).getTime();
    if (elapsedMs > 45_000 + 15_000) {
      await teacherSessionRepository.updateById(pendingChat._id, {
        status: "cancelled",
        sessionEndReason: "teacher_no_response_timeout",
        callEndTime: new Date(),
      });
    } else {
      return {
        type: "chat",
        state: "pending",
        session: pendingChat,
        student: pendingChat.student,
      };
    }
  }

  return null;
};

/**
 * Get active/ongoing or pending session for a student (used to restore UI state on refresh)
 */
export const getStudentActiveSession = async (studentId) => {
  // 1. Check active/accepted call session
  const activeCall = await teacherSessionRepository.findStudentOngoingCallSession(studentId);
  if (activeCall) {
    return {
      type: "call",
      state: activeCall.status, // "accepted" or "ongoing"
      session: activeCall,
      teacher: activeCall.teacher,
    };
  }

  // 2. Check active ongoing chat session
  const activeChat = await teacherSessionRepository.findStudentOngoingChatSession(studentId);
  if (activeChat) {
    const { messages } = await teacherChatMessageRepository.findBySession(activeChat._id, {
      limit: 100,
      sortOrder: "asc",
    });
    return {
      type: "chat",
      state: "active",
      session: activeChat,
      teacher: activeChat.teacher,
      messages: messages || [],
    };
  }

  // 3. Check pending call request
  const pendingCall = await teacherSessionRepository.findStudentPendingCallSession(studentId);
  if (pendingCall) {
    const elapsedMs = Date.now() - new Date(pendingCall.createdAt).getTime();
    if (elapsedMs > 45_000 + 15_000) {
      await teacherSessionRepository.updateById(pendingCall._id, {
        status: "cancelled",
        sessionEndReason: "teacher_no_response_timeout",
        callEndTime: new Date(),
      });
    } else {
      return {
        type: "call",
        state: "pending",
        session: pendingCall,
        teacher: pendingCall.teacher,
      };
    }
  }

  // 4. Check pending chat request
  const pendingChat = await teacherSessionRepository.findStudentPendingChatSession(studentId);
  if (pendingChat) {
    const elapsedMs = Date.now() - new Date(pendingChat.createdAt).getTime();
    if (elapsedMs > 45_000 + 15_000) {
      await teacherSessionRepository.updateById(pendingChat._id, {
        status: "cancelled",
        sessionEndReason: "teacher_no_response_timeout",
        callEndTime: new Date(),
      });
    } else {
      return {
        type: "chat",
        state: "pending",
        session: pendingChat,
        teacher: pendingChat.teacher,
      };
    }
  }

  return null;
};

export default {
  getAvailableTeachers,
  getTeacherById,
  initiateCallRequest,
  acceptCallRequest,
  rejectCallRequest,
  startCall,
  endCall,
  cancelPendingCallRequestByStudent,
  cancelCallRequest,
  getStudentCallHistory,
  getStudentRecordings,
  getStudentCallConversations,
  getStudentCallRecordingsByTeacher,
  getCallRecordingMp3Download,
  hydrateCallRecordingsAsMp3,
  getStudentChatConversations,
  getStudentChatMessagesByTeacher,
  getStudentChatSessions,
  getStudentChatMessages,
  endCallWithRecording,
  getTeacherPendingRequests,
  getTeacherSessionHistory,
  deleteTeacherSession,
  getTeacherEarnings,
  getTeacherDashboard,
  rateTeacher,
  getTeacherActiveSession,
  getStudentActiveSession,
};

