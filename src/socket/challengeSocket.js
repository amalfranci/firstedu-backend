import jwt from "jsonwebtoken";
import challengeRepository from "../repository/challenge.repository.js";
import User from "../models/Student.js";
import studentSessionRepository from "../repository/studentSession.repository.js";

const normalizeToken = (rawToken) => {
  if (!rawToken || typeof rawToken !== "string") return "";
  return rawToken.replace(/^Bearer\s+/i, "").replace(/^"+|"+$/g, "").trim();
};

const authenticateSocket = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decoded?._id).select("_id name email status");
    if (!user || user.status === "banned") return null;

    // Keep socket auth consistent with REST auth.
    if (decoded.sessionId) {
      const session = await studentSessionRepository.findById(decoded.sessionId);
      if (session && session.student.toString() !== user._id.toString()) return null;
    }

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      userType: "Student",
    };
  } catch (error) {
    return null;
  }
};

const buildRoomParticipantsSnapshot = async (roomCode) => {
  const challenge = await challengeRepository.findOne(
    { roomCode },
    [{ path: "participants.student", select: "name email" }]
  );
  if (!challenge) return null;

  const participants = challenge.participants.map((p) => {
    const student = p.student?._id ? p.student : null;
    return {
      studentId: student?._id?.toString?.() || p.student?.toString?.() || null,
      name: student?.name || null,
      email: student?.email || null,
      joinedAt: p.joinedAt,
    };
  });

  return {
    challengeId: challenge._id.toString(),
    roomCode: challenge.roomCode,
    roomStatus: challenge.roomStatus,
    totalParticipants: participants.length,
    participants,
  };
};

const emitParticipantLeft = async (challengeNamespace, roomCode, studentId, reason) => {
  const payload = {
    roomCode,
    studentId,
    reason,
    timestamp: new Date(),
  };
  const roomName = `challenge:${roomCode}`;
  challengeNamespace.to(roomName).emit("participant_left", payload);

  // Also notify creator directly so host/admin gets realtime updates
  // even if not currently joined in the room tab.
  const challenge = await challengeRepository.findOne({ roomCode }, [{ path: "createdBy", select: "_id" }]);
  const creatorId = challenge?.createdBy?._id?.toString?.() || challenge?.createdBy?.toString?.();
  if (creatorId) {
    challengeNamespace.to(`student:${creatorId}`).emit("participant_left", payload);
  }
};

export const setupChallengeSocket = (io) => {
  const challengeNamespace = io.of("/challenge");

  challengeNamespace.use(async (socket, next) => {
    const token = normalizeToken(
      socket.handshake.auth?.token || socket.handshake.headers?.authorization || ""
    );
    if (!token) return next(new Error("Authentication error: No token provided"));

    const user = await authenticateSocket(token);
    if (!user) {
      return next(new Error("Authentication error: Invalid or expired token"));
    }
    if (user.userType !== "Student") {
      return next(new Error("Authentication error: Only students can access challenge rooms"));
    }
    socket.user = user;
    next();
  });

  challengeNamespace.on("connection", (socket) => {
    const studentId = socket.user._id?.toString?.();
    if (studentId) socket.join(`student:${studentId}`);

    socket.on("join_challenge_room", async (roomCode) => {
      try {
        if (!roomCode) return socket.emit("error", { message: "roomCode is required" });
        const challenge = await challengeRepository.findOne({ roomCode });
        if (!challenge) return socket.emit("error", { message: "Challenge room not found" });

        socket.join(`challenge:${roomCode}`);
        socket.emit("joined_challenge_room", {
          challengeId: challenge._id,
          roomCode: challenge.roomCode,
          roomStatus: challenge.roomStatus,
        });

        const snapshot = await buildRoomParticipantsSnapshot(roomCode);
        if (snapshot) {
          socket.emit("room_participants_snapshot", snapshot);
        }
      } catch (error) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("leave_challenge_room", async (roomCode) => {
      try {
        if (!roomCode) return socket.emit("error", { message: "roomCode is required" });
        const roomName = `challenge:${roomCode}`;
        socket.leave(roomName);
        await emitParticipantLeft(challengeNamespace, roomCode, studentId, "left_room");
      } catch (error) {
        socket.emit("error", { message: error.message });
      }
    });

    socket.on("disconnecting", () => {
      try {
        const challengeRooms = Array.from(socket.rooms).filter((room) =>
          room.startsWith("challenge:")
        );
        for (const room of challengeRooms) {
          const roomCode = room.replace("challenge:", "");
          emitParticipantLeft(challengeNamespace, roomCode, studentId, "disconnected").catch(() => {});
        }
      } catch (error) {
        // swallow disconnect errors to avoid noisy disconnect path
      }
    });
  });

  return challengeNamespace;
};

export default {
  setupChallengeSocket,
};
