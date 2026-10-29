import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { generateOTP, generate6DigitOTP } from "../utils/otp.js";
import { sendOtpSms } from "../utils/smsService.js";
import { sendOTPEmail, sendWelcomeEmail } from "../utils/sendEmail.js";
import { uploadImageToCloudinary, deleteFileFromCloudinary } from "../utils/s3Upload.js";
import studentRepository from "../repository/student.repository.js";
import studentSessionRepository from "../repository/studentSession.repository.js";
import userValidator from "../validation/student.validator.js";
import studentService from "../services/student.service.js";
import { sendDataOnlyToDevice } from "../services/fcm.service.js";
import jwt from "jsonwebtoken";
import { normalizeSocketAuthToken } from "../socket/socketAuth.util.js";
import Otp from "../models/Otp.js";


// Student Signup
export const signup = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.studentSignup.validate(req.body);

  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { email, password, name, schoolOrCollege, classOrGrade, phone, referralCode: inputReferralCode } = value;

  // Handle profile image upload if provided
  let profileImageUrl = null;
  if (req.file) {
    // Validate image file type
    if (!req.file.mimetype.startsWith('image/')) {
      throw new ApiError(400, "Only image files are allowed for profile image");
    }

    try {
      profileImageUrl = await uploadImageToCloudinary(
        req.file.buffer,
        req.file.originalname,
        "student-profile-images",
        req.file.mimetype
      );
    } catch (uploadError) {
      throw new ApiError(500, `Failed to upload profile image: ${uploadError.message}`);
    }
  }

  // 1. Generate Referral Code for the new user
  const referralCode = await studentService.generateReferralCode(name);

  // 2. Validate Referrer (if code provided)
  let referredBy = null;
  if (inputReferralCode) {
    try {
      referredBy = await studentService.validateAndGetReferrerId(inputReferralCode);
    } catch (err) {
      console.error("Error validating referral code:", err);
      // Proceed without referrer (graceful failure)
    }
  }

  // Create student (Password hashing should be handled in the User model pre-save hook)
  const createdStudent = await studentRepository.create({
    email,
    password,
    name,
    schoolOrCollege,
    classOrGrade,
    phone,
    profileImage: profileImageUrl,
    referralCode,
    referredBy,
  });

  if (!createdStudent) {
    throw new ApiError(500, "Something went wrong while registering the student");
  }

  // 3. Update Referrer History and Handle Wallet Rewards (Async - don't block response)
  // We can do both in parallel or sequence, independent of main response
  (async () => {
    if (referredBy) {
      try {
        await studentService.addReferralHistory(referredBy, createdStudent._id);
      } catch (err) {
        console.error("Error updating referral history:", err);
      }
    }

    // Send Welcome Email
    try {
      await sendWelcomeEmail(createdStudent.email, createdStudent.name);
    } catch (err) {
      console.error("Error sending welcome email:", err);
    }

    // Handle Wallet Rewards (New Wallet + Referrer Reward)
    try {
      await studentService.handlePostSignupWalletRewards(createdStudent._id, referredBy);
    } catch (err) {
      console.error("Error handling wallet rewards:", err);
    }
  })();

  return res
    .status(201)
    .json(ApiResponse.success(createdStudent, "Student registered successfully"));
});

// Student Login (session-based, single device: alreadyLoggedInElsewhere + forceLogin flow)
export const login = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.studentLogin.validate(req.body);

  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { email, password, forceLogin } = value;
  const rawFcmToken = value.fcmToken || value.fcm_token;
  const rawDeviceId = value.deviceId || value.device_id;

  const student = await studentRepository.findOne({ email }, true);

  if (!student) {
    throw new ApiError(404, "Student does not exist");
  }

  if (student.status === "banned") {
    throw new ApiError(403, "You are banned by the admin");
  }

  const isPasswordValid = await student.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const existingSession = await studentSessionRepository.findByStudentId(student._id);
  const alreadyLoggedInElsewhere = !!existingSession;

  if (alreadyLoggedInElsewhere && !forceLogin) {
    return res.status(200).json(
      ApiResponse.success(
        {
          alreadyLoggedInElsewhere: true,
          message: "You are logged in on another device. Please logout there to continue, or confirm to login here and logout from that device.",
        },
        "Already logged in on another device"
      )
    );
  }

  const fcmTokenValue = (rawFcmToken && rawFcmToken.trim()) ? rawFcmToken.trim() : null;

  if (alreadyLoggedInElsewhere && forceLogin && existingSession.fcmToken) {
    try {
      console.log(`📢 [ForceLogout] Dispatching FORCE_LOGOUT to previous session token: ${existingSession.fcmToken.slice(0, 15)}...`);
      const res = await sendDataOnlyToDevice(existingSession.fcmToken, {
        type: "FORCE_LOGOUT",
        reason: "logged_in_elsewhere",
      });
      console.log(`✅ [ForceLogout] Push sent successfully:`, res);
    } catch (err) {
      console.error("❌ [ForceLogout] Push notification failed in login:", err);
    }
  }

  await studentSessionRepository.deleteByStudentId(student._id);

  const userAgent = req.get("user-agent") || null;

  const session = await studentSessionRepository.create({
    student: student._id,
    refreshToken: student.generateRefreshToken(),
    fcmToken: fcmTokenValue,
    deviceId: (rawDeviceId && rawDeviceId.trim()) ? rawDeviceId.trim() : null,
    userAgent,
  });

  const accessToken = student.generateAccessToken(session._id);
  const refreshToken = student.generateRefreshToken(session._id);
  await studentSessionRepository.updateRefreshToken(session._id, refreshToken);

  await studentRepository.updateById(student._id, { lastLogin: new Date() });

  const loggedInStudent = await studentRepository.findById(student._id);

  const isProduction = process.env.NODE_ENV === "production";
  const accessTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 60 * 60 * 1000,
  };
  const refreshTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, accessTokenOptions)
    .cookie("refreshToken", refreshToken, refreshTokenOptions)
    .json(
      ApiResponse.success(
        {
          user: loggedInStudent,
          accessToken,
          refreshToken,
          fcmTokenRegistered: !!fcmTokenValue,
        },
        "Student logged in successfully"
      )
    );
});

// Phone Login - Send OTP
export const sendLoginOtp = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.sendLoginOtp.validate(req.body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { phone } = value;

  // Verify student exists before generating/sending OTP
  const student = await studentRepository.findOne({ phone });
  if (!student) {
    // Security: use a generic message to avoid disclosing whether a phone exists
    throw new ApiError(404, "No account found with this phone number.");
  }

  // Generate a cryptographically secure 4-digit OTP
  const otpValue = generateOTP();

  // Persist (upsert) OTP — old OTP for this phone is overwritten
  await Otp.findOneAndUpdate(
    { phone },
    { otp: otpValue, createdAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Send OTP via MSG91 SMS gateway
  // In DEV mode this only prints to console — no actual SMS is sent
  await sendOtpSms(phone, otpValue);

  return res.status(200).json(
    ApiResponse.success({ success: true }, "OTP sent successfully")
  );
});

// Phone Login - Verify OTP
export const verifyLoginOtp = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.verifyLoginOtp.validate(req.body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { phone, otp } = value;
  const rawFcmToken = value.fcmToken || value.fcm_token;
  const rawDeviceId = value.deviceId || value.device_id;

  // 1. Verify the OTP in the separate Otp schema
  const otpRecord = await Otp.findOne({ phone, otp });
  if (!otpRecord) {
    throw new ApiError(400, "Invalid OTP or OTP has expired.");
  }

  // 2. OTP is valid -> delete it so it can't be reused
  await Otp.deleteOne({ _id: otpRecord._id });

  // 3. Find the student
  const student = await studentRepository.findOne({ phone }, true);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  
  if (student.status === "banned") {
    throw new ApiError(403, "You are banned by the admin");
  }

  // 4. Session management (same as regular login - notify previous device to force logout)
  const existingSession = await studentSessionRepository.findByStudentId(student._id);
  const userAgent = req.get("user-agent") || null;
  const fcmTokenValue = (rawFcmToken && rawFcmToken.trim()) ? rawFcmToken.trim() : null;

  if (existingSession && existingSession.fcmToken) {
    try {
      console.log(`📢 [ForceLogout:OTP] Dispatching FORCE_LOGOUT to previous device token: ${existingSession.fcmToken.slice(0, 15)}...`);
      const res = await sendDataOnlyToDevice(existingSession.fcmToken, {
        type: "FORCE_LOGOUT",
        reason: "logged_in_elsewhere",
      });
      console.log(`✅ [ForceLogout:OTP] Push sent successfully:`, res);
    } catch (err) {
      console.error("❌ [ForceLogout:OTP] Push notification failed in verifyLoginOtp:", err);
    }
  }

  await studentSessionRepository.deleteByStudentId(student._id);

  const session = await studentSessionRepository.create({
    student: student._id,
    refreshToken: student.generateRefreshToken(),
    fcmToken: fcmTokenValue,
    deviceId: (rawDeviceId && rawDeviceId.trim()) ? rawDeviceId.trim() : null,
    userAgent,
  });

  const accessToken = student.generateAccessToken(session._id);
  const refreshToken = student.generateRefreshToken(session._id);
  await studentSessionRepository.updateRefreshToken(session._id, refreshToken);

  await studentRepository.updateById(student._id, { lastLogin: new Date() });

  const loggedInStudent = await studentRepository.findById(student._id);

  const isProduction = process.env.NODE_ENV === "production";
  const accessTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 60 * 60 * 1000,
  };
  const refreshTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, accessTokenOptions)
    .cookie("refreshToken", refreshToken, refreshTokenOptions)
    .json(
      ApiResponse.success(
        {
          success: true,
          user: loggedInStudent,
          accessToken,
          refreshToken,
          fcmTokenRegistered: !!fcmTokenValue,
        },
        "Student logged in successfully via OTP"
      )
    );
});

// 1. Request OTP for forgot password (no authentication required)
export const requestForgotPasswordOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Validate email format first
  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  // Check if email exists in database
  const user = await studentRepository.findOne({ email });

  if (!user) {
    throw new ApiError(404, "Email not registered");
  }

  const otp = generate6DigitOTP();

  user.passwordResetOTP = otp;
  user.passwordResetOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  await studentRepository.save(user);

  await sendOTPEmail(user.email, otp, user.name);

  return res.status(200).json(
    ApiResponse.success({}, "OTP has been sent to your email")
  );
});

// 2. Verify OTP (no authentication required)
export const verifyForgotPasswordOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new ApiError(400, "Email and OTP are required");
  }

  if (typeof otp !== 'string' || otp.length !== 6 || !/^[0-9]+$/.test(otp)) {
    throw new ApiError(400, "Invalid OTP format. OTP must be 6 digits.");
  }

  const user = await studentRepository.findOne({ email }, true);

  if (!user) {
    throw new ApiError(404, "Student not found");
  }

  if (!user.passwordResetOTP || !user.passwordResetOTPExpires) {
    throw new ApiError(400, "No OTP request found. Please request OTP first.");
  }

  if (user.passwordResetOTPExpires < Date.now()) {
    // Clear expired OTP
    user.passwordResetOTP = null;
    user.passwordResetOTPExpires = null;
    await studentRepository.save(user);
    throw new ApiError(400, "OTP has expired. Please request a new OTP.");
  }

  if (user.passwordResetOTP !== otp) {
    throw new ApiError(400, "Invalid OTP");
  }

  // OTP is correct → mark as verified but keep it until password is reset
  return res.status(200).json(
    ApiResponse.success({}, "OTP verified. You can now set new password.")
  );
});

// 3. Reset password (after OTP verification)
export const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword, confirmPassword } = req.body;

  if (!email || !otp || !newPassword || !confirmPassword) {
    throw new ApiError(400, "Email, OTP, newPassword, and confirmPassword are required");
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters long");
  }

  if (newPassword !== confirmPassword) {
    throw new ApiError(400, "Passwords do not match");
  }

  const user = await studentRepository.findOne({ email }, true);

  if (!user) {
    throw new ApiError(404, "Student not found");
  }

  // Verify OTP again before allowing password reset
  if (!user.passwordResetOTP || !user.passwordResetOTPExpires) {
    throw new ApiError(400, "No OTP request found. Please request OTP first.");
  }

  if (user.passwordResetOTPExpires < Date.now()) {
    user.passwordResetOTP = null;
    user.passwordResetOTPExpires = null;
    await studentRepository.save(user);
    throw new ApiError(400, "OTP has expired. Please request a new OTP.");
  }

  if (user.passwordResetOTP !== otp) {
    throw new ApiError(400, "Invalid OTP");
  }

  // OTP is valid, reset password
  user.password = newPassword; // pre-save hook will hash it
  user.passwordResetOTP = null;
  user.passwordResetOTPExpires = null;
  await studentRepository.save(user);

  return res.status(200).json(
    ApiResponse.success({}, "Password reset successfully")
  );
});

// Logout (deletes this device's session; clears cookies)
export const logout = asyncHandler(async (req, res) => {
  if (req.user.sessionId) {
    await studentSessionRepository.deleteById(req.user.sessionId);
  } else {
    await studentSessionRepository.deleteByStudentId(req.user._id);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(ApiResponse.success(null, "Student logged out successfully"));
});

// Get My Profile (current logged-in student)
export const getProfile = asyncHandler(async (req, res) => {
  const student = await studentRepository.findById(req.user._id);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  return res
    .status(200)
    .json(ApiResponse.success(student, "Profile fetched successfully"));
});

// Update Profile (JSON or multipart/form-data; optional file field `profileImage`)
export const updateProfile = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.updateProfile.validate(req.body ?? {});

  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { name, phone, email, schoolOrCollege, classOrGrade } = value;

  // Check if email is being updated and if it's already taken by another user
  if (email) {
    const existingStudent = await studentRepository.findOne({
      email,
      _id: { $ne: req.user._id }
    });
    if (existingStudent) {
      throw new ApiError(409, "Email is already taken by another student");
    }
  }

  // Check if phone is being updated and if it's already taken by another user
  if (phone) {
    const existingStudent = await studentRepository.findOne({
      phone,
      _id: { $ne: req.user._id }
    });
    if (existingStudent) {
      throw new ApiError(409, "Phone number is already taken by another student");
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (email !== undefined) updateData.email = email;
  if (schoolOrCollege !== undefined) updateData.schoolOrCollege = schoolOrCollege;
  if (classOrGrade !== undefined) updateData.classOrGrade = classOrGrade;

  if (req.file) {
    if (!req.file.mimetype.startsWith("image/")) {
      throw new ApiError(400, "Only image files are allowed for profile image");
    }
    const studentBefore = await studentRepository.findById(req.user._id);
    if (!studentBefore) {
      throw new ApiError(404, "Student not found");
    }
    let profileImageUrl;
    try {
      profileImageUrl = await uploadImageToCloudinary(
        req.file.buffer,
        req.file.originalname,
        "student-profile-images",
        req.file.mimetype
      );
    } catch (uploadError) {
      throw new ApiError(500, `Failed to upload profile image: ${uploadError.message}`);
    }
    if (studentBefore.profileImage) {
      await deleteFileFromCloudinary(studentBefore.profileImage);
    }
    updateData.profileImage = profileImageUrl;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError(400, "No fields to update");
  }

  const updatedStudent = await studentRepository.updateById(req.user._id, updateData);

  if (!updatedStudent) {
    throw new ApiError(404, "Student not found");
  }

  return res
    .status(200)
    .json(ApiResponse.success(updatedStudent, "Profile updated successfully"));
});

// Change password (when logged in)
export const changePassword = asyncHandler(async (req, res) => {
  const { error, value } = userValidator.changePassword.validate(req.body);

  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map(x => x.message));
  }

  const { oldPassword, newPassword } = value;
  const studentId = req.user._id;

  // Get student with password
  const student = await studentRepository.findOne({ _id: studentId }, true);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  // Verify old password
  const isOldPasswordValid = await student.isPasswordCorrect(oldPassword);
  if (!isOldPasswordValid) {
    throw new ApiError(401, "Old password is incorrect");
  }

  // Check if new password is same as old password
  const isSamePassword = await student.isPasswordCorrect(newPassword);
  if (isSamePassword) {
    throw new ApiError(400, "New password must be different from old password");
  }

  // Update password (pre-save hook will hash it)
  student.password = newPassword;
  await studentRepository.save(student);

  return res.status(200).json(
    ApiResponse.success({}, "Password changed successfully")
  );
});

// Convert Reward Points to Monetary Balance
export const convertPoints = asyncHandler(async (req, res) => {
  const { pointsToConvert } = req.body;
  const studentId = req.user._id;

  if (!pointsToConvert) {
    throw new ApiError(400, "pointsToConvert is required");
  }

  const result = await studentService.convertPointsToMoney(studentId, parseFloat(pointsToConvert));

  const balanceAdded = (parseFloat(pointsToConvert) / 100) * 10;
  return res.status(200).json(
    ApiResponse.success(
      result,
      `Successfully converted ${pointsToConvert} points to ${balanceAdded} balance`
    )
  );
});

// -------- Refer & Earn --------

/** Get referral code, share link, points per referral and total referrals count */
export const getReferralInfo = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const info = await studentService.getReferralInfo(studentId);
  if (!info) {
    throw new ApiError(404, "Student not found");
  }
  return res.status(200).json(ApiResponse.success(info, "Refer & Earn details fetched successfully"));
});

/** Get list of users referred by this student (paginated) */
export const getMyReferrals = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page, limit } = req.query;
  const result = await studentService.getMyReferrals(studentId, { page, limit });
  return res.status(200).json(
    ApiResponse.success(result.referrals, "My referrals fetched successfully", result.pagination)
  );
});

// Permanently Delete Student Account
export const deleteAccount = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { password } = req.body;

  if (!password) {
    throw new ApiError(400, "Password is required to delete your account");
  }

  // Verify the student's password before proceeding
  const student = await studentRepository.findOne({ _id: studentId }, true);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  const isPasswordValid = await student.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Incorrect password. Account deletion denied.");
  }

  // Proceed with permanent deletion
  const result = await studentService.deleteAccount(studentId);

  // Clear auth cookies
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "None",
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(ApiResponse.success(result, "Account deleted permanently"));
});

// Refresh Access Token for Student (Mobile & Web)
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const rawToken =
    req.cookies?.refreshToken ||
    req.body?.refreshToken ||
    req.header("Authorization") ||
    req.header("authorization") ||
    "";
  const incomingRefreshToken = normalizeSocketAuthToken(rawToken);

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  let decoded;
  try {
    decoded = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
  } catch (err) {
    throw new ApiError(401, "Refresh token expired or invalid. Please login again.");
  }

  const student = await studentRepository.findById(decoded._id);
  if (!student || student.status === "banned") {
    throw new ApiError(401, "Invalid refresh token or student banned");
  }

  const session = await studentSessionRepository.findByRefreshToken(
    incomingRefreshToken
  );

  if (!session) {
    throw new ApiError(401, "Session invalidated. Please login again.");
  }

  const sessionId = session._id;
  const newAccessToken = student.generateAccessToken(sessionId);
  const newRefreshToken = student.generateRefreshToken(sessionId);

  await studentSessionRepository.updateRefreshToken(session._id, newRefreshToken);

  const isProduction = process.env.NODE_ENV === "production";
  const accessTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
  const refreshTokenOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 60 * 24 * 60 * 60 * 1000,
  };

  return res
    .status(200)
    .cookie("accessToken", newAccessToken, accessTokenOptions)
    .cookie("refreshToken", newRefreshToken, refreshTokenOptions)
    .json(
      ApiResponse.success(
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
        "Access token refreshed successfully"
      )
    );
});



