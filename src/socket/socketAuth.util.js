import jwt from "jsonwebtoken";
import User from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import studentSessionRepository from "../repository/studentSession.repository.js";

export const normalizeSocketAuthToken = (raw) => {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/^Bearer\s+/i, "").replace(/^"+|"+$/g, "").trim();
};

/**
 * JWT auth for /teacher-chat and /teacher-call namespaces (students + approved teachers).
 */
export async function authenticateTeacherConnectSocket(token) {
  try {
    const cleanToken = normalizeSocketAuthToken(token);
    if (!cleanToken) return null;
    const decoded = jwt.verify(cleanToken, process.env.ACCESS_TOKEN_SECRET);
    if (decoded.userType === "teacher") {
      const teacher = await Teacher.findById(decoded._id).select("_id name email status");
      if (!teacher || teacher.status !== "approved") return null;
      return {
        _id: teacher._id,
        name: teacher.name,
        email: teacher.email,
        role: "teacher",
      };
    }

    const user = await User.findById(decoded._id).select("_id name email phone status");
    if (!user || user.status === "banned") return null;

    if (decoded.sessionId) {
      const session = await studentSessionRepository.findById(decoded.sessionId);
      if (session && session.student.toString() !== user._id.toString()) return null;
    }

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: "student",
    };
  } catch {
    return null;
  }
}
