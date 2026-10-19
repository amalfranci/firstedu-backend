import { Router } from "express";
import {
  login,
  logout,
  requestForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
  changePassword,
} from "../controllers/teacherAuth.controller.js";
import {
  getProfile,
  updateProfile,
  toggleAvailability,
  getSessionHistory,
  deleteTeacherSession,
  getEarnings,
  getDashboard,
  registerTeacherFcmToken,
  getActiveSession,
} from "../controllers/teacherConnect.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { uploadImage } from "../utils/multerConfig.js";
import { submitSupport } from "../controllers/contactSupport.controller.js";
import {
  getTeacherMyNotifications,
  getTeacherUnreadCount,
  markTeacherNotificationAsRead,
  markAllTeacherNotificationsAsRead,
} from "../controllers/notification.controller.js";
import {
  getTeacherWallet,
  putTeacherBankDetails,
  getTeacherBankDetails,
  postTeacherWithdrawal,
  getTeacherWalletTransactions
} from "../controllers/teacherWithdrawal.controller.js";
import { postTeacherAgoraRtcToken } from "../controllers/agoraRtc.controller.js";

const router = Router();

// Teacher Authentication Routes (no signup – teachers are created by admin)
router.post("/login", login);
router.post("/logout", verifyJWT, logout);
router.post("/forgot-password/request", requestForgotPasswordOTP);
router.post("/forgot-password/verify", verifyForgotPasswordOTP);
router.post("/forgot-password/reset", resetPassword);
router.put("/change-password", verifyJWT, changePassword);

// ==================== SUPPORT ====================

// Simple Support Message (no JWT required)
router.post("/contact-support",verifyJWT, submitSupport);

// ==================== TEACHER CONNECT MODULE ====================

// Profile Management (teacher can update only: name, email, gender, about, profileImage)
router.get("/profile", verifyJWT, getProfile);
router.put("/profile", verifyJWT, uploadImage.single("profileImage"), updateProfile);
router.put("/availability", verifyJWT, toggleAvailability);
router.get("/dashboard", verifyJWT, getDashboard);
router.get("/active-session", verifyJWT, getActiveSession);
router.post("/notifications/register-token", verifyJWT, registerTeacherFcmToken);
router.get("/notifications", verifyJWT, getTeacherMyNotifications);
router.get("/notifications/unread-count", verifyJWT, getTeacherUnreadCount);
router.put(
  "/notifications/:notificationId/read",
  verifyJWT,
  markTeacherNotificationAsRead
);
router.put("/notifications/read-all", verifyJWT, markAllTeacherNotificationsAsRead);

// Wallet & withdrawals (Teacher wallet userType: Teacher)
router.get("/wallet", verifyJWT, getTeacherWallet);
router.get("/wallet/transactions", verifyJWT, getTeacherWalletTransactions);
router.put("/wallet/bank-details", verifyJWT, putTeacherBankDetails);
router.get("/wallet/bank-details", verifyJWT, getTeacherBankDetails);
router.post("/wallet/withdrawals", verifyJWT, postTeacherWithdrawal);

// Agora RTC token (join channel after call_accepted on /teacher-call socket)
router.post("/sessions/:sessionId/agora-token", verifyJWT, postTeacherAgoraRtcToken);

// Session History & Earnings
router.get("/sessions", verifyJWT, getSessionHistory);
router.delete("/sessions/:sessionId", verifyJWT, deleteTeacherSession);
router.get("/earnings", verifyJWT, getEarnings);

export default router;

