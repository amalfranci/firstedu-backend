import { Router } from "express";
import {
  signup,
  login,
  logout,
  requestForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  convertPoints,
  getReferralInfo,
  getMyReferrals,
  deleteAccount,
  sendLoginOtp,
  verifyLoginOtp,
} from "../controllers/studentAuth.controller.js";
import {
  getCourses,
  getCourseById,
  initiateCoursePayment,
  purchaseCourse,
  getMyCourses,
  getCourseContent,
  getCourseFollowUpTests,
  getTests,
  getTestsAndBundles,
  getTestById,
  initiateTestPayment,
  purchaseTest,
  getTestBundles,
  initiateTestBundlePayment,
  purchaseTestBundle,
  getMyTests,
  getExamHall,
  getAllResources,
} from "../controllers/marketplace.controller.js";
import {
  getDetailedAnalysis,
  calculateAnalysis,
} from "../controllers/examAnalysis.controller.js";
import {
  getPublishedTournaments,
  getTournamentDetails,
  registerForTournament,
  initiateTournamentPayment,
} from "../controllers/tournament.controller.js";
import {
  getPublishedWorkshops,
  getWorkshopDetails,
  registerForWorkshop,
  initiateWorkshopPayment,
} from "../controllers/workshop.controller.js";
import {
  createChallenge,
  getChallenges,
  joinChallengeByCode,
  startChallenge,
  deleteChallenge,
  getChallengeYourFriendsTests,
  getCompletedChallenges,
  getCompletedChallengeById,
} from "../controllers/challenge.controller.js";
import {
  createForum,
  getForums,
  getForumById,
  updateForum,
  deleteForum,
  addComment,
  replyToComment,
  likeForum,
  likeComment,
  likeReply,
  deleteComment,
  deleteReply,
} from "../controllers/forum.controller.js";
import { getHallOfFame } from "../controllers/hallOfFame.controller.js";
import { getMyEventsDashboard } from "../controllers/eventRegistration.controller.js";
import { getEverydayChallenges } from "../controllers/everydayChallenge.controller.js";
import { getChallengeYourself } from "../controllers/challengeYourself.controller.js";
import { getAllEvents } from "../controllers/events.controller.js";
import { contactUs } from "../controllers/contact.controller.js";
import { getLeaderboardsForStudent } from "../controllers/leaderboard.controller.js";
import {
  startExam,
  getExamInstructions,
  pauseExam,
  getExamSession,
  saveAnswer,
  visitQuestion,
  markForReview,
  skipQuestion,
  logProctoringEvent,
  submitExam,
  getExamResults,
  getQuestionPalette,
  getInProgressExams,
} from "../controllers/examSession.controller.js";
import {
  getWallet,
  initiateRecharge,
  completeRecharge,
  getPointsHistory,
} from "../controllers/wallet.controller.js";
import {
  getMerchandiseItems,
  getMerchandiseById,
  claimMerchandise,
  initiateMerchandisePayment,
  confirmMerchandisePayment,
  getMyClaims,
} from "../controllers/merchandise.controller.js";
import { getMyOrders } from "../controllers/order.controller.js";
import {
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
} from "../controllers/studentTeacherConnect.controller.js";
import { postStudentAgoraRtcToken } from "../controllers/agoraRtc.controller.js";
import {
  createTicket,
  getMyTickets,
  getTicketById,
  getTicketMessages,
  sendMessage,
  getTicketCategories,
} from "../controllers/studentSupport.controller.js";
import { submitSupport } from "../controllers/contactSupport.controller.js";
import { submitBlogRequest } from "../controllers/blogRequest.controller.js";
import { getAllBlogs, getBlogById } from "../controllers/blog.controller.js";
import {
  getAllPressAnnouncementsUser,
  getPressAnnouncementByIdUser,
} from "../controllers/pressAnnouncement.controller.js";
import {
  getAllApplyJobsUser,
  getApplyJobByIdUser,
  applyForJob,
} from "../controllers/teacherConnectApply.controller.js";
import {
  registerFCMToken,
  getMyNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../controllers/notification.controller.js";
import {
  getFeaturedStories,
  getAllStoriesStudent,
  getStoryDetailStudent,
} from "../controllers/successStory.controller.js";
import {
  getCategoriesForStudent,
  getCategoryDetailForStudent,
  resolveCategoryPathForStudent
} from "../controllers/category.controller.js";
import {
  initiateCategoryPurchase,
  confirmCategoryPurchase,
  getMyCategoryPurchases,
  checkCategoryAccess,
} from "../controllers/categoryPurchase.controller.js";
import { applyCoupon } from "../controllers/studentCoupon.controller.js";
import {
  getMyCertificates,
  getMyCertificateById,
} from "../controllers/certificate.controller.js";
import { getUpgradeCost, processUpgrade, confirmUpgrade } from "../controllers/upgrade.controller.js";
import {
  listOlympiads,
  getOlympiadDetails,
  initiateRegistration,
  completeRegistration,
  getMyRegistrations
} from "../controllers/studentOlympiad.controller.js";

import { getCompetitiveTestsForStudent } from "../controllers/competitiveTest.controller.js";
import {
  listJeeMainPapersStudent,
  getJeeMainPaperStudent,
  getJeeMainGeneratorSummary,
  generateJeeMainQuestionSet,
  generateJeeAdvancedQuestionSet,
  generateNeetQuestionSet,
  generateClatQuestionSet,
  generateIbpsQuestionSet,
  generateGmatQuestionSet,
  generateSscCglTier1QuestionSet,
  generateSscCglTier2QuestionSet,
  generateUpscQuestionSet,
  generateCatQuestionSet,
} from "../controllers/jeeMainCompetitivePaper.controller.js";
import {
  listJeeExamSyllabus,
  getJeeExamSyllabusByExam,
} from "../controllers/jeeExamSyllabus.controller.js";
import { getSchoolTestsForStudent } from "../controllers/schoolTest.controller.js";
import { getSkillTestsForStudent } from "../controllers/skillTest.controller.js";

import {
  getNeedToImprove,
  refreshNeedToImprove,
} from "../controllers/needToImprove.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  upload,
  uploadImage,
  uploadPDF,
  uploadLiveCompetitionContent,
} from "../utils/multerConfig.js";
// import {
//   getCompetitions,
//   getSingleCompetition,
// } from "../controllers/competition.controller.js";
import { getStudentDashboardStats } from "../controllers/studentDashboard.controller.js";
import {
  getPublishedEvents as getPublishedLiveCompetitions,
  getPublishedEventById as getPublishedLiveCompetitionById,
  registerForEvent as registerLiveCompetition,
  initiateLiveCompetitionPayment,
  completeLiveCompetitionRegistration,
  submitWork as submitLiveCompetitionWork,
  getMySubmissions as getMyLiveCompetitionSubmissions,
  startEssaySession,
  saveDraft as saveLiveEssayDraft,
} from "../controllers/liveCompetition.controller.js";
import { getActiveCategories } from "../controllers/liveCompetitionCategory.controller.js";
import { loginExamDeskUser } from "../controllers/examDeskAuth.controller.js";

import {
  createQnA,
  getAllQnAs,
  getQnAById,
  selfQnAs,
} from "../controllers/qna.controller.js";
import {
  getCategories as getFreeMaterialCategories,
} from "../controllers/studentFreeMaterial.controller.js";

const router = Router();

// Student Authentication Routes
router.post("/signup", uploadImage.single("profileImage"), signup);
router.post("/login", login);
router.post("/send-otp", sendLoginOtp);
router.post("/verify-otp", verifyLoginOtp);

// Contact Us (no JWT)
router.post("/contact-us", contactUs);
router.post("/logout", verifyJWT, logout);

router.get("/profile", verifyJWT, getProfile);
router.post("/forgot-password/request", requestForgotPasswordOTP);
router.post("/forgot-password/verify", verifyForgotPasswordOTP);
router.post("/forgot-password/reset", resetPassword);
router.put(
  "/update-profile",
  verifyJWT,
  uploadImage.single("profileImage"),
  updateProfile,
);
router.put("/change-password", verifyJWT, changePassword);
router.delete("/delete-account", verifyJWT, deleteAccount);

// Dadshboard api
router.get("/dashboard/stats", verifyJWT, getStudentDashboardStats);

// Refer & Earn (100 points per successful referral signup)
router.get("/refer-earn", verifyJWT, getReferralInfo);
router.get("/refer-earn/referrals", verifyJWT, getMyReferrals);

// Marketplace - All Resources (Combined)
router.get("/marketplace/all", verifyJWT, getAllResources);

// Marketplace - Courses
router.get("/courses", verifyJWT, getCourses);
router.get("/courses/:id", verifyJWT, getCourseById);
router.post("/courses/:id/initiate-payment", verifyJWT, initiateCoursePayment);
router.post("/courses/:id/purchase", verifyJWT, purchaseCourse);
router.get("/my-courses", verifyJWT, getMyCourses);
router.get("/courses/:id/content", verifyJWT, getCourseContent);
router.get("/courses/:id/follow-up-tests", verifyJWT, getCourseFollowUpTests);

// Marketplace - Tests
router.get("/tests", verifyJWT, getTests);
router.get("/tests-and-bundles", verifyJWT, getTestsAndBundles);
router.get("/tests/:id", verifyJWT, getTestById);
router.post("/tests/:id/initiate-payment", verifyJWT, initiateTestPayment);
router.post("/tests/:id/purchase", verifyJWT, purchaseTest);

// Marketplace - Test Bundles
router.get("/test-bundles", getTestBundles);
router.post(
  "/test-bundles/:id/initiate-payment",
  verifyJWT,
  initiateTestBundlePayment,
);
router.post("/test-bundles/:id/purchase", verifyJWT, purchaseTestBundle);

// Categories (taxonomy for filtering tests/question banks)
router.get("/categories", verifyJWT, getCategoriesForStudent);
router.get("/categories/resolve-path", verifyJWT, resolveCategoryPathForStudent);
router.get("/categories/:id/detail", verifyJWT, getCategoryDetailForStudent);
router.post("/categories/:categoryId/initiate-payment", verifyJWT, initiateCategoryPurchase);
router.post("/categories/:categoryId/confirm-payment", verifyJWT, confirmCategoryPurchase);
router.get("/categories/:categoryId/access", verifyJWT, checkCategoryAccess);
router.get("/my-category-purchases", verifyJWT, getMyCategoryPurchases);
router.get("/competitive-tests", verifyJWT, getCompetitiveTestsForStudent);
router.get("/competitive/jee-main/papers", verifyJWT, listJeeMainPapersStudent);
router.get("/competitive/jee-main/papers/:id", verifyJWT, getJeeMainPaperStudent);
router.get("/competitive/jee-main/generator/summary", getJeeMainGeneratorSummary);
router.post("/competitive/jee-main/generator/set", generateJeeMainQuestionSet);
router.post(
  "/competitive/jee-advanced/generator/set",
  generateJeeAdvancedQuestionSet
);
router.post("/competitive/neet/generator/set", generateNeetQuestionSet);
router.post("/competitive/clat/generator/set", generateClatQuestionSet);
router.post("/competitive/ibps/generator/set", generateIbpsQuestionSet);
router.post("/competitive/gmat/generator/set", generateGmatQuestionSet);
router.post("/competitive/ssc-cgl-tier1/generator/set", generateSscCglTier1QuestionSet);
router.post("/competitive/ssc-cgl-tier2/generator/set", generateSscCglTier2QuestionSet);
router.post("/competitive/upsc/generator/set", generateUpscQuestionSet);
router.post("/competitive/cat/generator/set", generateCatQuestionSet);
router.post("/exam-desk/login", loginExamDeskUser);
router.get("/competitive/jee-syllabus", verifyJWT, listJeeExamSyllabus);
router.get("/competitive/jee-syllabus/:examType", verifyJWT, getJeeExamSyllabusByExam);
router.get("/school-tests", verifyJWT, getSchoolTestsForStudent);
router.get("/skill-tests", verifyJWT, getSkillTestsForStudent);

// Upgrade logic
router.get("/categories/:categoryId/upgrade-cost", verifyJWT, getUpgradeCost);
router.post("/categories/:categoryId/checkout-upgrade", verifyJWT, processUpgrade);
router.post("/categories/:categoryId/confirm-upgrade", verifyJWT, confirmUpgrade);

// Coupons - Apply discount code (test, testBundle, course, olympiad, tournament, workshop, all)
router.post("/coupons/apply", verifyJWT, applyCoupon);

// My Purchases
router.get("/my-tests", verifyJWT, getMyTests);

// Exam Performance Analysis
router.get(
  "/exam-sessions/:sessionId/analysis",
  verifyJWT,
  getDetailedAnalysis,
);
router.post(
  "/exam-sessions/:sessionId/calculate-analysis",
  verifyJWT,
  calculateAnalysis,
);

// Community & Competitions - Tournaments
router.get("/tournaments", verifyJWT, getPublishedTournaments);
router.get("/tournaments/:id", verifyJWT, getTournamentDetails);
router.post(
  "/tournaments/:id/initiate-payment",
  verifyJWT,
  initiateTournamentPayment,
);
router.post("/tournaments/:id/register", verifyJWT, registerForTournament);

// Community & Competitions - Workshops
router.get("/workshops", verifyJWT, getPublishedWorkshops);
router.get("/workshops/:id", verifyJWT, getWorkshopDetails);
router.post(
  "/workshops/:id/initiate-payment",
  verifyJWT,
  initiateWorkshopPayment,
);
router.post("/workshops/:id/register", verifyJWT, registerForWorkshop);

// Community & Competitions - Olympiads
router.get("/olympiads", verifyJWT, listOlympiads);
router.get("/my-olympiads", verifyJWT, getMyRegistrations);
router.get("/olympiads/:id", verifyJWT, getOlympiadDetails);
router.post("/olympiads/:id/initiate-payment", verifyJWT, initiateRegistration);
router.post("/olympiads/:id/register", verifyJWT, completeRegistration);


// Community & Competitions - Challenges
router.post("/challenges", verifyJWT, createChallenge);
router.get(
  "/challenges/tests/challenge-yourfriends",
  verifyJWT,
  getChallengeYourFriendsTests,
);
router.get("/challenges", verifyJWT, getChallenges);
router.get(
  "/challenges/completed-challenges",
  verifyJWT,
  getCompletedChallenges,
);
router.get(
  "/challenges/completed-challenges/:id",
  verifyJWT,
  getCompletedChallengeById,
);
router.post("/challenges/join-by-code", verifyJWT, joinChallengeByCode);
router.post("/challenges/:id/start", verifyJWT, startChallenge);
router.delete("/challenges/:id", verifyJWT, deleteChallenge);

// Community - Forums (title, description, tags, topic, attachment; comments & replies)
router.post(
  "/forums",
  verifyJWT,
  uploadImage.single("attachment"),
  createForum,
);
router.get("/forums", verifyJWT, getForums);
router.get("/forums/:id", verifyJWT, getForumById);
router.put(
  "/forums/:id",
  verifyJWT,
  uploadImage.single("attachment"),
  updateForum,
);
router.delete("/forums/:id", verifyJWT, deleteForum);
router.post("/forums/:forumId/comments", verifyJWT, addComment);
router.post(
  "/forums/:forumId/comments/:commentId/replies",
  verifyJWT,
  replyToComment,
);
router.post("/forums/:forumId/like", verifyJWT, likeForum);
router.post(
  "/forums/:forumId/comments/:commentId/like",
  verifyJWT,
  likeComment,
);
router.post(
  "/forums/:forumId/comments/:commentId/replies/:replyId/like",
  verifyJWT,
  likeReply,
);
router.delete("/forums/:forumId/comments/:commentId", verifyJWT, deleteComment);
router.delete(
  "/forums/:forumId/comments/:commentId/replies/:replyId",
  verifyJWT,
  deleteReply,
);

// Community & Competitions - Hall of Fame
router.get("/hall-of-fame", verifyJWT, getHallOfFame);

// All Events (Olympiads, Tournaments) - catalog, no registration filter
router.get("/events", verifyJWT, getAllEvents);

// Leaderboards
router.get("/leaderboard", verifyJWT, getLeaderboardsForStudent);

// My Events Dashboard
router.get("/my-events", verifyJWT, getMyEventsDashboard);

// Everyday Challenges (daily free challenge, streak-based XP)
router.get("/everyday-challenges", verifyJWT, getEverydayChallenges);

// Challenge Yourself (6 stages: Bronze → Heroic, free tests only in this API)
router.get("/challenge-yourself", verifyJWT, getChallengeYourself);

// ==================== EXAM HALL (Examination System) ====================

// Exam Hall - all purchased tests and test series
router.get("/examhall", verifyJWT, getExamHall);

// Exam Instructions (dynamic details before start)
router.get("/tests/:testId/exam-instructions", verifyJWT, getExamInstructions);

// Start Exam Session
router.post("/tests/:testId/start-exam", verifyJWT, startExam);

// Get In-Progress Exams
router.get("/exam-sessions/in-progress", verifyJWT, getInProgressExams);

// Get Exam Session (with questions, timer, palette)
router.get("/exam-sessions/:sessionId", verifyJWT, getExamSession);

// Pause Exam (stops timer; call start-exam to resume)
router.post("/exam-sessions/:sessionId/pause", verifyJWT, pauseExam);

// Save Answer
router.put(
  "/exam-sessions/:sessionId/questions/:questionId/answer",
  verifyJWT,
  saveAnswer,
);

// Visit/Open Question (pause previous question timer, start/resume selected question timer)
router.post(
  "/exam-sessions/:sessionId/questions/:questionId/visit",
  verifyJWT,
  visitQuestion,
);

// Mark for Review
router.post(
  "/exam-sessions/:sessionId/questions/:questionId/mark-review",
  verifyJWT,
  markForReview,
);

// Skip Question
router.post(
  "/exam-sessions/:sessionId/questions/:questionId/skip",
  verifyJWT,
  skipQuestion,
);

// Log Proctoring Event (window blur, tab switch, etc.)
router.post(
  "/exam-sessions/:sessionId/proctoring",
  verifyJWT,
  logProctoringEvent,
);

// Submit Exam
router.post("/exam-sessions/:sessionId/submit", verifyJWT, submitExam);

// Get Exam Results (Instant Results with explanations)
router.get("/exam-sessions/:sessionId/results", verifyJWT, getExamResults);

// Get Question Palette (Navigation Grid)
router.get("/exam-sessions/:sessionId/palette", verifyJWT, getQuestionPalette);

// ==================== GAMIFICATION & WALLET ====================

// Wallet Routes
router.get("/wallet", verifyJWT, getWallet);
router.post("/wallet/recharge/initiate", verifyJWT, initiateRecharge);
router.post("/wallet/recharge", verifyJWT, completeRecharge);
router.get("/wallet/points-history", verifyJWT, getPointsHistory);
router.post("/wallet/convert-points", verifyJWT, convertPoints);

// Merchandise Store Routes (specific routes must come before parameterized :id)
router.get("/merchandise", verifyJWT, getMerchandiseItems);
router.get("/merchandise/my-claims", verifyJWT, getMyClaims);
router.get("/merchandise/:id", verifyJWT, getMerchandiseById);
router.post("/merchandise/:id/claim", verifyJWT, claimMerchandise);
router.post("/merchandise/:id/initiate-payment", verifyJWT, initiateMerchandisePayment);
router.post("/merchandise/:id/confirm-payment", verifyJWT, confirmMerchandisePayment);

// Order History
router.get("/orders", verifyJWT, getMyOrders);

// ==================== TEACHER CONNECT ====================

// Teacher Listing & Availability
router.get("/teachers", verifyJWT, getAvailableTeachers);
router.get("/teachers/:teacherId", verifyJWT, getTeacherById);
router.post("/teachers/:teacherId/rate", verifyJWT, rateTeacher);
router.get("/teachers/:teacherId/check-balance", verifyJWT, checkWalletBalance);

// Teacher sessions (history) + Agora token after call_accepted on /teacher-call socket
router.get("/teacher-sessions", verifyJWT, getCallHistory);
router.get("/teacher-sessions/recordings", verifyJWT, getCallRecordings);
router.get("/teacher-sessions/call-reports", verifyJWT, getCallReportConversations);
router.get(
  "/teacher-sessions/call-reports/:teacherId/recordings",
  verifyJWT,
  getCallTeacherRecordings
);
router.get(
  "/teacher-sessions/:sessionId/recording/download",
  verifyJWT,
  downloadCallRecording
);
router.get("/teacher-sessions/chat-reports", verifyJWT, getChatReportSessions);
router.get(
  "/teacher-sessions/chat-reports/:teacherId/messages",
  verifyJWT,
  getChatTeacherMessages
);
router.get(
  "/teacher-sessions/:sessionId/chat-messages",
  verifyJWT,
  getChatSessionMessages
);
router.post(
  "/teacher-sessions/:sessionId/agora-token",
  verifyJWT,
  postStudentAgoraRtcToken,
);

// ==================== SUPPORT DESK ====================

// Simple Support Message (no JWT required)
router.post("/contact-support", verifyJWT, submitSupport);

// Blog Request (optional image)
router.post(
  "/blog-request",
  verifyJWT,
  uploadImage.single("image"),
  submitBlogRequest,
);

// Approved blogs (approved by admin + admin-added blogs)
router.get("/blogs", verifyJWT, getAllBlogs);
router.get("/blogs/:id", verifyJWT, getBlogById);

router.post("/qna-request", verifyJWT, createQnA);
router.get("/qna", verifyJWT, getAllQnAs);
router.get("/qna/:id", verifyJWT, getQnAById);
router.get("/qna-request", verifyJWT, selfQnAs);
// Press announcements (read only)
router.get("/press-announcements", verifyJWT, getAllPressAnnouncementsUser);
router.get("/press-announcements/:id", verifyJWT, getPressAnnouncementByIdUser);

// Teacher Connect – Apply Job (teachers can view jobs and apply; apply is public so candidates without account can apply)
router.get("/teacher-connect/jobs", getAllApplyJobsUser);
router.get("/teacher-connect/jobs/:id", getApplyJobByIdUser);
router.post("/teacher-connect/apply", uploadPDF.single("resume"), applyForJob);

// Ticket Management
router.post("/support/tickets", verifyJWT, createTicket);
router.get("/support/tickets", verifyJWT, getMyTickets);

// Specific routes like '/categories' must come before parameterized routes like '/:ticketId'
router.get("/support/tickets/categories", verifyJWT, getTicketCategories);
router.get("/support/tickets/:ticketId", verifyJWT, getTicketById);
router.get("/support/tickets/:ticketId/messages", verifyJWT, getTicketMessages);
router.post("/support/tickets/:ticketId/messages", verifyJWT, sendMessage);

// ==================== CERTIFICATES ====================

// Student's own certificates
router.get("/certificates", verifyJWT, getMyCertificates);
router.get("/certificates/:certificateId", verifyJWT, getMyCertificateById);

// ==================== NOTIFICATIONS ====================

// Register/Update FCM token
router.post("/notifications/register-token", verifyJWT, registerFCMToken);

// Get all notifications
router.get("/notifications", verifyJWT, getMyNotifications);

// Get unread notification count
router.get("/notifications/unread-count", verifyJWT, getUnreadCount);

// Mark notification as read
router.put(
  "/notifications/:notificationId/read",
  verifyJWT,
  markNotificationAsRead,
);

// Mark all notifications as read
router.put("/notifications/read-all", verifyJWT, markAllNotificationsAsRead);

// ==================== SUCCESS STORIES ====================

// Success Stories (Public)
router.get("/success-stories/featured", verifyJWT, getFeaturedStories);
router.get("/success-stories", verifyJWT, getAllStoriesStudent);
router.get("/success-stories/:id", verifyJWT, getStoryDetailStudent);



// ==================== NEED TO IMPROVE ====================
router.get("/need-to-improve", verifyJWT, getNeedToImprove);
router.post("/need-to-improve/refresh", verifyJWT, refreshNeedToImprove);

// ==================== LIVE COMPETITIONS ====================

// Event Browsing
router.get("/live-competitions", verifyJWT, getPublishedLiveCompetitions);
router.get(
  "/live-competitions/:id",
  verifyJWT,
  getPublishedLiveCompetitionById,
);

// Registration — initiate handles free / wallet / razorpay in one place
router.post(
  "/live-competitions/:id/initiate-payment",
  verifyJWT,
  initiateLiveCompetitionPayment,
);
router.post(
  "/live-competitions/:id/complete-payment",
  verifyJWT,
  completeLiveCompetitionRegistration,
);
router.post(
  "/live-competitions/:id/register",
  verifyJWT,
  registerLiveCompetition,
);

// Submission (supports file uploads via uploadLiveCompetitionContent.array("files", 1))
router.post(
  "/live-competitions/:id/submit",
  verifyJWT,
  uploadLiveCompetitionContent.array("files", 1),
  submitLiveCompetitionWork,
);
router.get("/my-live-submissions", verifyJWT, getMyLiveCompetitionSubmissions);

// Live Essay Session
router.post("/live-competitions/:id/start", verifyJWT, startEssaySession);
router.patch(
  "/live-competitions/:id/save-draft",
  verifyJWT,
  saveLiveEssayDraft,
);

// ==================== LIVE COMPETITION CATEGORIES (Public) ====================
router.get("/live-competition-categories", verifyJWT, getActiveCategories);

// ==================== FREE MATERIALS ====================
router.get("/free-materials/categories", verifyJWT, getFreeMaterialCategories);

export default router;
