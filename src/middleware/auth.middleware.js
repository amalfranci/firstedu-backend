import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import Admin from "../models/Admin.js";
import User from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import studentSessionRepository from "../repository/studentSession.repository.js";

export const verifyJWT = asyncHandler(async (req, _, next) => {
  if (req.user) {
    return next();
  }

  const token =
    req.cookies?.accessToken ||
    req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    // If no token is present, throw an unauthorized error.
    throw new ApiError(401, "Unauthorized request. please login to continue.");
    //  return next();
  }

  try {
    // Check if ACCESS_TOKEN_SECRET is set
    if (!process.env.ACCESS_TOKEN_SECRET) {
      throw new ApiError(
        500,
        "Server configuration error: ACCESS_TOKEN_SECRET is not set",
      );
    }

    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    let user =
      (await User.findById(decodedToken?._id).select("-password")) ||
      (await Admin.findById(decodedToken?._id).select("-password")) ||
      (await Teacher.findById(decodedToken?._id).select("-password"));

    if (!user) {
      throw new ApiError(401, "Invalid Access Token");
    }

    if (user.status === "banned") {
      await studentSessionRepository.deleteByStudentId(user._id);
      throw new ApiError(403, "You are banned by the admin");
    }

    if (decodedToken.sessionId) {
      const session = await studentSessionRepository.findById(
        decodedToken.sessionId,
      );
      if (!session || session.student.toString() !== user._id.toString()) {
        throw new ApiError(401, "Session invalidated. Please login again.");
      }
    }
    req.user = user;
    if (decodedToken.sessionId) req.user.sessionId = decodedToken.sessionId;
    next();
  } catch (error) {
    // Handle specific JWT errors
    if (error.name === "JsonWebTokenError") {
      if (error.message === "invalid signature") {
        throw new ApiError(401, "Invalid token signature. Please login again.");
      }
      throw new ApiError(401, "Invalid token format");
    }
    if (error.name === "TokenExpiredError") {
      throw new ApiError(401, "Token has expired. Please login again.");
    }
    // If it's already an ApiError, re-throw it
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(401, error?.message || "Invalid access token");
  }
});
