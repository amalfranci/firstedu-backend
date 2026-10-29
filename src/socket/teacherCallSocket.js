import teacherSessionRepository from "../repository/teacherSession.repository.js";
import teacherRepository from "../repository/teacher.repository.js";
import teacherConnectService from "../services/teacherConnect.service.js";
import teacherChatService from "../services/teacherChat.service.js";
import * as agoraCloudRecording from "../services/agoraCloudRecording.service.js";
import {
  authenticateTeacherConnectSocket,
  normalizeSocketAuthToken,
} from "./socketAuth.util.js";

const CALL_REQUEST_AUTO_CANCEL_MS = 45_000;
const TEACHER_SOCKET_RECONNECT_GRACE_MS = Number(
  process.env.TEACHER_SOCKET_RECONNECT_GRACE_MS || 30_000
);
const pendingCallCancelTimers = new Map();
const callDisconnectCleanupTimers = new Map();
const recordingStartTimers = new Map();
const callSessionParticipants = new Map();

const getCallParticipantKey = (sessionId) =>
  sessionId?.toString?.() ?? String(sessionId || "");

const clearCallParticipantState = (sessionId) => {
  callSessionParticipants.delete(getCallParticipantKey(sessionId));
};

const markCallParticipantJoined = (sessionId, role) => {
  const key = getCallParticipantKey(sessionId);
  if (!key) return false;
  const state = callSessionParticipants.get(key) || {
    teacher: false,
    student: false,
  };
  if (role === "teacher" || role === "student") {
    state[role] = true;
  }
  callSessionParticipants.set(key, state);
  return Boolean(state.teacher && state.student);
};

const getCallDisconnectKey = (kind, userId, sessionId) =>
  `${kind}:${userId?.toString?.() ?? userId}:${sessionId?.toString?.() ?? sessionId}`;

const clearCallDisconnectCleanup = (kind, userId, sessionId) => {
  const key = getCallDisconnectKey(kind, userId, sessionId);
  const timerId = callDisconnectCleanupTimers.get(key);
  if (timerId) {
    clearTimeout(timerId);
    callDisconnectCleanupTimers.delete(key);
  }
};

const clearRecordingStartTimer = (sessionId) => {
  const key = getCallParticipantKey(sessionId);
  recordingStartTimers.delete(key);
};

/** Start cloud recording once both sides have joined the live call channel. */
const startCallRecordingNow = (sessionId) => {
  const key = getCallParticipantKey(sessionId);
  if (!key || recordingStartTimers.has(key)) return;
  recordingStartTimers.set(key, true);
  agoraCloudRecording
    .startCallRecording(sessionId)
    .catch((err) => {
      recordingStartTimers.delete(key);
      console.error(`[Agora Recording] start failed (session ${key}):`, err.message);
    });
};

const clearPendingCallAutoCancel = (sessionId) => {
  const key = sessionId?.toString?.() ?? String(sessionId || "");
  if (!key) return;
  const timerId = pendingCallCancelTimers.get(key);
  if (timerId) {
    clearTimeout(timerId);
    pendingCallCancelTimers.delete(key);
  }
};

function assertCallParticipant(session, userId, role) {
  const studentId = session.student._id?.toString?.() ?? String(session.student);
  const teacherId = session.teacher._id?.toString?.() ?? String(session.teacher);
  const uid = userId.toString();
  if (role === "student" && uid === studentId) return;
  if (role === "teacher" && uid === teacherId) return;
  throw new Error("Not a participant in this call session");
}

function resolveDurationMinutes(session, endedAt = Date.now(), clientDurationSeconds = null) {
  const clientSecs = Number(clientDurationSeconds);
  const clientMinutes =
    Number.isFinite(clientSecs) && clientSecs > 0 ? clientSecs / 60 : null;

  let serverMinutes = null;
  if (session.callStartTime) {
    const elapsedMs = Math.max(
      0,
      endedAt - new Date(session.callStartTime).getTime()
    );
    serverMinutes = Math.max(elapsedMs / 60000, 1 / 60);
  }

  if (clientMinutes != null && serverMinutes != null) {
    return Math.min(clientMinutes, serverMinutes);
  }
  if (clientMinutes != null) return clientMinutes;
  if (serverMinutes != null) return serverMinutes;
  return 1 / 60;
}

export const setupTeacherCallSocket = (io) => {
  const ns = io.of("/teacher-call");

  ns.use(async (socket, next) => {
    const rawToken =
      socket.handshake.auth?.token ||
      socket.handshake.auth?.accessToken ||
      socket.handshake.auth?.Authorization ||
      socket.handshake.headers?.authorization ||
      socket.handshake.headers?.token ||
      socket.handshake.query?.token ||
      "";
    const token = normalizeSocketAuthToken(rawToken);
    if (!token) return next(new Error("Authentication error: No token provided"));

    const user = await authenticateTeacherConnectSocket(token);
    if (!user) {
      return next(new Error("Authentication error: Invalid or expired token"));
    }
    socket.data.callUser = user;
    next();
  });

  ns.on("connection", (socket) => {
    const user = socket.data.callUser;
    const userId = user._id.toString();

    if (user.role === "teacher") {
      socket.join(`teacher:${userId}`);
    } else {
      socket.join(`student:${userId}`);
    }

    const hasUserReconnected = () => {
      const roomName = user.role === "teacher" ? `teacher:${userId}` : `student:${userId}`;
      return (ns.adapter.rooms.get(roomName)?.size || 0) > 0;
    };

    const schedulePendingCallAutoCancel = (sessionId, teacherId) => {
      const sid = sessionId.toString();
      clearPendingCallAutoCancel(sid);
      const timerId = setTimeout(async () => {
        pendingCallCancelTimers.delete(sid);
        try {
          const sessionDoc = await teacherConnectService.cancelPendingCallRequestByStudent(userId, sid);
          if (!sessionDoc) return;
          delete socket.data.pendingCallSessionId;
          const endedPayload = {
            sessionId: sid,
            reason: "teacher_no_response_timeout",
            message: "Teacher did not accept within 45 seconds.",
            autoCancelled: true,
            timeoutMs: CALL_REQUEST_AUTO_CANCEL_MS,
            timestamp: new Date(),
          };
          socket.emit("call_request_cancelled", endedPayload);
          ns.to(`teacher:${teacherId}`).emit("call_request_withdrawn", endedPayload);
        } catch (err) {
          console.error("Auto-cancel pending call error:", err);
        }
      }, CALL_REQUEST_AUTO_CANCEL_MS);
      pendingCallCancelTimers.set(sid, timerId);
    };

    const restoreCallState = async () => {
      if (user.role === "student") {
        const pending = await teacherSessionRepository.findStudentPendingCallSession(userId);
        if (pending) {
          const sid = pending._id.toString();
          socket.data.pendingCallSessionId = sid;
          clearCallDisconnectCleanup("pending", userId, sid);
          socket.emit("pending_call_restored", {
            sessionId: sid,
            session: pending,
            teacher: pending.teacher,
          });
        }
      }

      if (user.role === "teacher") {
        const pending = await teacherSessionRepository.findTeacherPendingCallSession(userId);
        if (pending) {
          const elapsedMs = Date.now() - new Date(pending.createdAt).getTime();
          if (elapsedMs <= CALL_REQUEST_AUTO_CANCEL_MS + 15_000) {
            socket.emit("incoming_call_request", {
              session: pending,
              student: pending.student,
            });
          }
        }
      }

      const ongoing =
        user.role === "teacher"
          ? await teacherSessionRepository.findTeacherActiveCallSession(userId)
          : await teacherSessionRepository.findStudentOngoingCallSession(userId);

      if (!ongoing) return;

      const sid = ongoing._id.toString();
      socket.join(`session:${sid}`);
      socket.data.callSessionId = sid;
      clearCallDisconnectCleanup("active", userId, sid);
      markCallParticipantJoined(sid, user.role);
      socket.emit("joined_call_session", {
        sessionId: sid,
        session: ongoing,
        student: ongoing.student,
        teacher: ongoing.teacher,
        restored: true,
      });
      if (ongoing.status === "ongoing" && ongoing.callStartTime) {
        const mediaPayload = {
          sessionId: sid,
          session: ongoing,
          student: ongoing.student,
          teacher: ongoing.teacher,
          timestamp: ongoing.callStartTime,
        };
        socket.emit("call_media_started", mediaPayload);
      }
    };

    const schedulePendingCallDisconnectCleanup = (sessionId) => {
      if (user.role !== "student") return;
      const sid = sessionId?.toString?.() ?? String(sessionId || "");
      if (!sid) return;

      clearCallDisconnectCleanup("pending", userId, sid);
      const key = getCallDisconnectKey("pending", userId, sid);
      const timerId = setTimeout(async () => {
        callDisconnectCleanupTimers.delete(key);
        if (hasUserReconnected()) return;

        try {
          const sessionDoc = await teacherConnectService.cancelPendingCallRequestByStudent(userId, sid);
          if (!sessionDoc) return;
          const tid = sessionDoc.teacher._id.toString();
          ns.to(`teacher:${tid}`).emit("call_request_withdrawn", {
            sessionId: sessionDoc._id.toString(),
            reason: "student_disconnected",
            timestamp: new Date(),
          });
        } catch (err) {
          console.error("Teacher call pending disconnect cleanup error:", err);
        }
      }, TEACHER_SOCKET_RECONNECT_GRACE_MS);
      callDisconnectCleanupTimers.set(key, timerId);
    };

    const scheduleActiveCallDisconnectCleanup = (sessionId) => {
      const sid = sessionId?.toString?.() ?? String(sessionId || "");
      if (!sid) return;
      const disconnectedAt = Date.now();

      clearCallDisconnectCleanup("active", userId, sid);
      const key = getCallDisconnectKey("active", userId, sid);
      const timerId = setTimeout(async () => {
        callDisconnectCleanupTimers.delete(key);
        if (hasUserReconnected()) return;

        try {
          const session = await teacherSessionRepository.findById(sid);
          if (session && session.sessionKind === "call" && session.status === "ongoing") {
            const isTeacher = user.role === "teacher";
            const durationMinutes = resolveDurationMinutes(session, disconnectedAt);
            await endCallForSocket(
              session._id,
              isTeacher ? "teacher_disconnected" : "student_disconnected",
              isTeacher
                ? "The teacher disconnected. The call has ended."
                : "The student disconnected. The call has ended.",
              durationMinutes
            );
          }
        } catch (err) {
          console.error("Teacher call disconnect cleanup error:", err);
        }
      }, TEACHER_SOCKET_RECONNECT_GRACE_MS);
      callDisconnectCleanupTimers.set(key, timerId);
    };

    restoreCallState().catch((err) => {
      console.error("Teacher call restore state error:", err);
    });

    socket.on("call_request", async (payload = {}) => {
      if (user.role !== "student") {
        socket.emit("call_error", { message: "Only students can request a call" });
        return;
      }
      const { teacherId, subject } = payload;
      if (!teacherId) {
        socket.emit("call_error", { message: "teacherId is required" });
        return;
      }
      try {
        const session = await teacherConnectService.initiateCallRequest(userId, teacherId, subject);
        socket.data.pendingCallSessionId = session._id.toString();
        clearCallDisconnectCleanup("pending", userId, session._id);
        schedulePendingCallAutoCancel(session._id, teacherId);
        socket.emit("call_request_sent", { session });

        ns.to(`teacher:${teacherId}`).emit("incoming_call_request", {
          session,
          student: { _id: user._id, name: user.name, email: user.email },
        });

        // Do not block socket response on notification providers/DB round-trips.
        Promise.resolve()
          .then(async () => {
            const teacherDoc = await teacherRepository.findById(teacherId);
            await teacherChatService.notifyTeacherDevice(
              teacherDoc,
              "New call request",
              `${user.name || "A student"} wants to start a paid voice call.`,
              {
                type: "teacher_call_request",
                sessionId: session._id.toString(),
                studentId: userId,
              }
            );
          })
          .catch((notifyErr) => {
            console.error("Teacher call request notification error:", notifyErr);
          });
      } catch (err) {
        socket.emit("call_error", {
          message: err.message || "Could not send call request",
          statusCode: err.statusCode,
        });
      }
    });

    socket.on("accept_call", async (payload = {}) => {
      if (user.role !== "teacher") {
        socket.emit("call_error", { message: "Only teachers can accept" });
        return;
      }
      const { sessionId } = payload;
      if (!sessionId) {
        socket.emit("call_error", { message: "sessionId is required" });
        return;
      }
      try {
        const pre = await teacherSessionRepository.findById(sessionId);
        if (!pre || pre.sessionKind !== "call") {
          socket.emit("call_error", { message: "Call session not found" });
          return;
        }
        await teacherConnectService.acceptCallRequest(userId, sessionId);
        const session = await teacherSessionRepository.findById(sessionId);
        const sid = session._id.toString();
        clearPendingCallAutoCancel(sid);
        const studentRef = session.student._id ?? session.student;
        const studentId = studentRef.toString();

        socket.join(`session:${sid}`);
        socket.data.callSessionId = sid;
        clearCallDisconnectCleanup("active", userId, sid);
        markCallParticipantJoined(sid, "teacher");

        const acceptedPayload = {
          session,
          timestamp: new Date(),
        };

        ns.to(`student:${studentId}`).emit("call_accepted", acceptedPayload);
        socket.emit("call_accepted", acceptedPayload);

        // Non-blocking notification emission
        teacherChatService.notifyStudentDevices(
          studentId,
          "Call request accepted",
          "Your teacher accepted. You can join the call now.",
          { type: "teacher_call_accepted", sessionId: sid }
        ).catch((err) => console.error("Student call accepted notification error:", err));
      } catch (err) {
        socket.emit("call_error", {
          message: err.message || "Could not accept call",
          statusCode: err.statusCode,
        });
      }
    });

    socket.on("reject_call", async (payload = {}) => {
      if (user.role !== "teacher") {
        socket.emit("call_error", { message: "Only teachers can reject" });
        return;
      }
      const { sessionId, reason } = payload;
      if (!sessionId) {
        socket.emit("call_error", { message: "sessionId is required" });
        return;
      }
      try {
        const pre = await teacherSessionRepository.findById(sessionId);
        if (!pre || pre.sessionKind !== "call") {
          socket.emit("call_error", { message: "Call session not found" });
          return;
        }
        const sessionDoc = await teacherConnectService.rejectCallRequest(userId, sessionId, reason);
        clearPendingCallAutoCancel(sessionDoc._id);
        const studentId = sessionDoc.student._id.toString();
        const endedPayload = {
          sessionId: sessionDoc._id.toString(),
          reason: sessionDoc.rejectionReason,
          timestamp: new Date(),
        };
        ns.to(`student:${studentId}`).emit("call_rejected", endedPayload);
        socket.emit("call_rejected_ack", endedPayload);

        // Non-blocking notification emission
        teacherChatService.notifyStudentDevices(
          studentId,
          "Call request declined",
          endedPayload.reason || "The teacher declined your call.",
          { type: "teacher_call_rejected", sessionId: endedPayload.sessionId }
        ).catch((err) => console.error("Student call rejected notification error:", err));
      } catch (err) {
        socket.emit("call_error", {
          message: err.message || "Could not reject call",
          statusCode: err.statusCode,
        });
      }
    });

    socket.on("join_call_session", async (payload = {}) => {
      const { sessionId } = payload;
      if (!sessionId) {
        socket.emit("call_error", { message: "sessionId is required" });
        return;
      }
      try {
        let session = await teacherSessionRepository.findById(sessionId);
        if (!session || session.sessionKind !== "call") {
          socket.emit("call_error", { message: "Call session not found" });
          return;
        }
        assertCallParticipant(session, userId, user.role);
        if (session.status !== "accepted" && session.status !== "ongoing") {
          socket.emit("call_error", { message: "Call is not active" });
          return;
        }
        const sid = session._id.toString();
        socket.join(`session:${sid}`);
        socket.data.callSessionId = sid;
        clearCallDisconnectCleanup("active", userId, sid);
        if (user.role === "student") {
          clearPendingCallAutoCancel(sid);
          clearCallDisconnectCleanup("pending", userId, sid);
          delete socket.data.pendingCallSessionId;
        }

        const bothJoined = markCallParticipantJoined(sid, user.role);
        if (bothJoined && session.status === "accepted") {
          session = await teacherConnectService.startCall(sessionId);
          startCallRecordingNow(session._id);
          const mediaPayload = {
            sessionId: sid,
            session,
            timestamp: session.callStartTime || new Date(),
          };
          ns.to(`session:${sid}`).emit("call_media_started", mediaPayload);
          ns.to(`student:${session.student._id}`).emit("call_media_started", mediaPayload);
          ns.to(`teacher:${session.teacher._id}`).emit("call_media_started", mediaPayload);
        } else if (session.status === "ongoing") {
          const mediaPayload = {
            sessionId: sid,
            session,
            timestamp: session.callStartTime || new Date(),
          };
          socket.emit("call_media_started", mediaPayload);
        }

        socket.emit("joined_call_session", { sessionId: sid, session });
      } catch (err) {
        socket.emit("call_error", {
          message: err.message || "Cannot join session",
          statusCode: err.statusCode,
        });
      }
    });

    const endCallForSocket = async (
      sessionId,
      reason,
      message,
      resolvedDurationMinutes = null,
      clientDurationSeconds = null
    ) => {
      const sid = sessionId.toString();
      clearRecordingStartTimer(sid);
      clearCallParticipantState(sid);
      const session = await teacherSessionRepository.findById(sessionId);
      if (!session || session.sessionKind !== "call" || session.status !== "ongoing") {
        return;
      }
      const endedAt = Date.now();
      const durationMinutes =
        resolvedDurationMinutes ||
        resolveDurationMinutes(session, endedAt, clientDurationSeconds);
      const updated = await teacherConnectService.endCallWithRecording(
        sid,
        durationMinutes,
        null,
        null
      );
      const endedPayload = {
        sessionId: sid,
        reason,
        message: message || "",
        session: updated,
        timestamp: new Date(),
      };
      ns.to(`session:${sid}`).emit("call_session_ended", endedPayload);
      ns.to(`student:${session.student._id}`).emit("call_session_ended", endedPayload);
      ns.to(`teacher:${session.teacher._id}`).emit("call_session_ended", endedPayload);
    };

    const withdrawStudentPendingCall = async () => {
      if (user.role !== "student") return null;
      const pendingId = socket.data.pendingCallSessionId;
      if (!pendingId) return null;
      clearPendingCallAutoCancel(pendingId);
      delete socket.data.pendingCallSessionId;
      try {
        const sessionDoc = await teacherConnectService.cancelPendingCallRequestByStudent(
          userId,
          pendingId
        );
        if (sessionDoc) {
          const tid = sessionDoc.teacher._id.toString();
          ns.to(`teacher:${tid}`).emit("call_request_withdrawn", {
            sessionId: sessionDoc._id.toString(),
            timestamp: new Date(),
          });
        }
        return sessionDoc;
      } catch (err) {
        console.error("Withdraw pending call error:", err);
        return null;
      }
    };

    socket.on("cancel_call_request", async (payload = {}, ack) => {
      const respond = (body) => {
        if (typeof ack === "function") ack(body);
      };
      if (user.role !== "student") {
        socket.emit("call_error", { message: "Only students can cancel a call request" });
        respond({ ok: false, message: "Only students can cancel a call request" });
        return;
      }
      const requestedId = payload.sessionId || socket.data.pendingCallSessionId;
      if (!requestedId) {
        socket.emit("call_error", { message: "No pending call request to cancel" });
        respond({ ok: false, message: "No pending call request to cancel" });
        return;
      }
      if (
        socket.data.pendingCallSessionId &&
        socket.data.pendingCallSessionId !== String(requestedId)
      ) {
        socket.emit("call_error", { message: "sessionId does not match your pending request" });
        respond({ ok: false, message: "sessionId does not match your pending request" });
        return;
      }
      socket.data.pendingCallSessionId = String(requestedId);
      const withdrawn = await withdrawStudentPendingCall();
      if (withdrawn) {
        socket.emit("call_request_cancelled", { sessionId: withdrawn._id.toString() });
        respond({ ok: true, sessionId: withdrawn._id.toString() });
      } else {
        socket.emit("call_error", {
          message: "No pending call request to cancel or it was already handled",
        });
        respond({ ok: false, message: "No pending call request to cancel or it was already handled" });
      }
    });

    socket.on("end_call", async (payload = {}, ack) => {
      const respond = (body) => {
        if (typeof ack === "function") ack(body);
      };
      const { sessionId, recordingUrl, agoraRecordingId, durationSeconds } = payload || {};
      if (!sessionId) {
        socket.emit("call_error", { message: "sessionId is required" });
        respond({ ok: false, message: "sessionId is required" });
        return;
      }
      try {
        const session = await teacherSessionRepository.findById(sessionId);
        if (!session || session.sessionKind !== "call") {
          socket.emit("call_error", { message: "Call session not found" });
          respond({ ok: false, message: "Call session not found" });
          return;
        }
        assertCallParticipant(session, userId, user.role);
        if (session.status === "accepted") {
          clearRecordingStartTimer(sessionId);
          clearCallParticipantState(sessionId);
          const updated = await teacherSessionRepository.updateById(sessionId, {
            status: "cancelled",
            callEndTime: new Date(),
            sessionEndReason: "ended_before_media_connect",
          });
          const sid = updated._id.toString();
          const isTeacher = user.role === "teacher";
          const endedPayload = {
            sessionId: sid,
            reason: isTeacher ? "ended_by_teacher" : "ended_by_student",
            message: isTeacher
              ? "The teacher ended the call before it connected."
              : "The student ended the call before it connected.",
            session: updated,
            timestamp: new Date(),
          };
          ns.to(`session:${sid}`).emit("call_session_ended", endedPayload);
          ns.to(`student:${session.student._id}`).emit("call_session_ended", endedPayload);
          ns.to(`teacher:${session.teacher._id}`).emit("call_session_ended", endedPayload);
          socket.emit("call_ended_ack", { session: updated });
          respond({ ok: true, session: updated });
          return;
        }
        if (session.status === "completed" || session.status === "cancelled") {
          const endedPayload = {
            sessionId: session._id.toString(),
            reason: session.sessionEndReason || "already_ended",
            message: "Call has already ended.",
            session,
            timestamp: new Date(),
          };
          socket.emit("call_session_ended", endedPayload);
          socket.emit("call_ended_ack", { session });
          respond({ ok: true, session });
          return;
        }
        if (session.status !== "ongoing") {
          socket.emit("call_error", { message: "Call is not active" });
          respond({ ok: false, message: "Call is not active" });
          return;
        }
        const endedAt = Date.now();
        clearRecordingStartTimer(sessionId);
        clearCallParticipantState(sessionId);
        const dm = resolveDurationMinutes(session, endedAt, durationSeconds);
        const updated = await teacherConnectService.endCallWithRecording(
          sessionId,
          dm,
          recordingUrl || null,
          agoraRecordingId || null
        );
        const sid = updated._id.toString();
        const isTeacher = user.role === "teacher";
        const endedPayload = {
          sessionId: sid,
          reason: isTeacher ? "ended_by_teacher" : "ended_by_student",
          message: isTeacher ? "The teacher ended the call." : "The student ended the call.",
          session: updated,
          timestamp: new Date(),
        };
        ns.to(`session:${sid}`).emit("call_session_ended", endedPayload);
        ns.to(`student:${session.student._id}`).emit("call_session_ended", endedPayload);
        ns.to(`teacher:${session.teacher._id}`).emit("call_session_ended", endedPayload);
        socket.emit("call_ended_ack", { session: updated });
        respond({ ok: true, session: updated });
      } catch (err) {
        socket.emit("call_error", {
          message: err.message || "Could not end call",
          statusCode: err.statusCode,
        });
        respond({
          ok: false,
          message: err.message || "Could not end call",
          statusCode: err.statusCode,
        });
      }
    });

    socket.on("disconnect", async () => {
      schedulePendingCallDisconnectCleanup(socket.data.pendingCallSessionId);
      const sid = socket.data.callSessionId;
      if (!sid) return;
      scheduleActiveCallDisconnectCleanup(sid);
    });
  });
};
