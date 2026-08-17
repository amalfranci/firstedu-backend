import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import ExamDeskUser from "../models/ExamDeskUser.js";
import { toExamDeskUserId } from "../utils/seedExamDeskUsers.js";

export const loginExamDeskUser = asyncHandler(async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const userId = toExamDeskUserId(username);
  if (!userId) {
    throw new ApiError(400, "Enter a username to continue.");
  }

  const user = await ExamDeskUser.findOne({ userId, isActive: true }).lean();
  if (!user) {
    throw new ApiError(401, "This username is not registered. Ask admin to add it.");
  }

  await ExamDeskUser.updateOne(
    { _id: user._id },
    { $set: { lastLogin: new Date() } }
  );

  return res.status(200).json(
    ApiResponse.success(
      {
        userId: user.userId,
        username: user.username,
      },
      "Login successful"
    )
  );
});
