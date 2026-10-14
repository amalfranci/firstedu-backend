import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { generateOTP, generate6DigitOTP } from '../utils/otp.js';
import { sendOTPEmail } from '../utils/sendEmail.js';
import adminRepository from '../repository/admin.repository.js';
import adminAuthValidator from '../validation/adminAuth.validator.js';

// ✅ Admin Login Controller (Email + Password)

export const adminLogin = asyncHandler(async (req, res) => {
  const { error, value } = adminAuthValidator.login.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const { email, password } = value;

  // 🔍 Find Admin (with password for comparison)
  const admin = await adminRepository.findOne({ email: email }, true);
  if (!admin) {
    throw new ApiError(404, 'Admin not found');
  }

  // 🔐 Compare Password
  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid email or password');
  }

  // 🎟 Generate Tokens
  const accessToken = admin.generateAccessToken();
  const refreshToken = admin.generateRefreshToken();

  // 💾 Save refreshToken to DB
  admin.refreshToken = refreshToken;
  await adminRepository.save(admin);

  // 🚫 Sanitize Response Data
  const safeAdminData = {
    _id: admin._id,
    name: admin.name,
    email: admin.email,
    phone: admin.phone,
    userType: admin.userType,
    role: admin.role || 'admin',
    allowedModules: admin.allowedModules && admin.allowedModules.length > 0 ? admin.allowedModules : ['*'], 
    createdAt: admin.createdAt,
  };

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'None' : 'Lax',
    maxAge: 60 * 60 * 1000,
  };
  const refreshCookieOptions = {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  res.cookie('accessToken', accessToken, cookieOptions);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);

  // ✅ Send Response
  return res.status(200).json(ApiResponse.success({
    user: safeAdminData,
    accessToken,
    refreshToken,
  }, 'Admin logged in successfully'));
});

export const adminLogout = asyncHandler(async (req, res) => {
  const adminId = req.user._id;

  // Invalidate the refresh token in the database
  await adminRepository.updateById(adminId, {
    $unset: { refreshToken: 1 }, // Removes the refreshToken field
  });

  const isProd = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'None' : 'Lax',
  };

  return res
    .status(200)
    .clearCookie('accessToken', options)
    .clearCookie('refreshToken', options)
    .json(ApiResponse.success(null, 'Admin logged out successfully'));
});

// 1. Request OTP for forgot password (no authentication required)
export const requestForgotPasswordOTP = asyncHandler(async (req, res) => {
  const { error, value } = adminAuthValidator.requestForgotPasswordOTP.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const { email } = value;

  const admin = await adminRepository.findOne({ email: email });

  if (!admin) {
    throw new ApiError(404, "Email not registered");
  }

  const otp = generate6DigitOTP();

  admin.passwordResetOTP = otp;
  admin.passwordResetOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  await adminRepository.save(admin);

  await sendOTPEmail(admin.email, otp, admin.name);

  return res.status(200).json(
    ApiResponse.success({}, 'OTP has been sent to your email')
  );
});

// 2. Verify OTP (no authentication required)
export const verifyForgotPasswordOTP = asyncHandler(async (req, res) => {
  const { error, value } = adminAuthValidator.verifyForgotPasswordOTP.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const { email, otp } = value;

  const admin = await adminRepository.find({ email: email }).then(admins => admins[0]);

  if (!admin) {
    throw new ApiError(404, 'Admin not found');
  }

  if (!admin.passwordResetOTP || !admin.passwordResetOTPExpires) {
    throw new ApiError(400, 'No OTP request found. Please request OTP first.');
  }

  if (admin.passwordResetOTPExpires < Date.now()) {
    // Clear expired OTP
    admin.passwordResetOTP = null;
    admin.passwordResetOTPExpires = null;
    await adminRepository.save(admin);
    throw new ApiError(400, 'OTP has expired. Please request a new OTP.');
  }

  if (admin.passwordResetOTP !== otp) {
    throw new ApiError(400, 'Invalid OTP');
  }

  // OTP is correct → mark as verified but keep it until password is reset
  // We'll clear it after password is successfully changed
  return res.status(200).json(
    ApiResponse.success({}, 'OTP verified. You can now set new password.')
  );
});

// 3. Reset password (after OTP verification)
export const resetPassword = asyncHandler(async (req, res) => {
  const { error, value } = adminAuthValidator.resetPassword.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const { email, otp, newPassword } = value;

  const admin = await adminRepository.find({ email: email }).then(admins => admins[0]);

  if (!admin) {
    throw new ApiError(404, 'Admin not found');
  }

  // Verify OTP again before allowing password reset
  if (!admin.passwordResetOTP || !admin.passwordResetOTPExpires) {
    throw new ApiError(400, 'No OTP request found. Please request OTP first.');
  }

  if (admin.passwordResetOTPExpires < Date.now()) {
    admin.passwordResetOTP = null;
    admin.passwordResetOTPExpires = null;
    await adminRepository.save(admin);
    throw new ApiError(400, 'OTP has expired. Please request a new OTP.');
  }

  if (admin.passwordResetOTP !== otp) {
    throw new ApiError(400, 'Invalid OTP');
  }

  // OTP is valid, reset password
  admin.password = newPassword; // pre-save hook will hash it
  admin.passwordResetOTP = null;
  admin.passwordResetOTPExpires = null;
  await adminRepository.save(admin);

  return res.status(200).json(
    ApiResponse.success({}, 'Password reset successfully')
  );
});

// Get admin profile (when logged in)
export const getAdminProfile = asyncHandler(async (req, res) => {
  const adminId = req.user._id;

  const admin = await adminRepository.findById(adminId);
  if (!admin) {
    throw new ApiError(404, "Admin not found");
  }

  const profile = {
    _id: admin._id,
    name: admin.name,
    email: admin.email,
    userType: admin.userType,
    role: admin.role || 'admin',
    allowedModules: admin.allowedModules && admin.allowedModules.length > 0 ? admin.allowedModules : ['*'],
    createdAt: admin.createdAt,
  };

  return res.status(200).json(ApiResponse.success(profile, "Profile fetched successfully"));
});

// Change password (when logged in)
export const changePassword = asyncHandler(async (req, res) => {
  const { error, value } = adminAuthValidator.changePassword.validate(req.body);

  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }

  const { oldPassword, newPassword } = value;
  const adminId = req.user._id;

  // Get admin with password
  const admin = await adminRepository.findOne({ _id: adminId }, true);
  if (!admin) {
    throw new ApiError(404, 'Admin not found');
  }

  // Verify old password
  const isOldPasswordValid = await admin.comparePassword(oldPassword);
  if (!isOldPasswordValid) {
    throw new ApiError(401, 'Old password is incorrect');
  }

  // Check if new password is same as old password
  const isSamePassword = await admin.comparePassword(newPassword);
  if (isSamePassword) {
    throw new ApiError(400, 'New password must be different from old password');
  }

  // Update password (pre-save hook will hash it)
  admin.password = newPassword;
  await adminRepository.save(admin);

  return res.status(200).json(
    ApiResponse.success({}, 'Password changed successfully')
  );
});