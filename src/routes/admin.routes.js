import { getEverydayChallengeSchedule, upsertEverydayChallengeSchedule, getEverydayChallengeStatus } from "../controllers/adminEverydayChallenge.controller.js";
import { updateGamificationSubcategory } from "../controllers/gamificationCategory.controller.js";
import { Router } from "express";

import {
  adminLogin,
  adminLogout,
  requestForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
  changePassword,
  getAdminProfile,
} from "../controllers/adminAuth.controller.js";
import {
  getDashboardData,
  getRevenueHistory,
} from "../controllers/adminDashboard.controller.js";
import { getRevenueTransactions } from "../controllers/adminRevenue.controller.js";
import {
  createQuestion,
  getAllQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  addChildQuestion,
  removeChildQuestion,
  getQuestionAnalytics,
  calculateAnalytics,
  getBulkAnalytics,
} from "../controllers/question.controller.js";
import {
  createTest,
  getTests,
  getTestById,
  updateTest,
  deleteTest,
  createBundle,
  getBundles,
  getBundleById,
  updateBundle,
  deleteBundle,
} from "../controllers/test.controller.js";
import {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
} from "../controllers/course.controller.js";
import {
  getStudents,
  getStudentById,
  getStudentTestHistory,
  getProctorLogs,
  updateStudentStatus,
} from "../controllers/adminUser.controller.js";
import {
  createTeacher,
  getTeachers,
  getTeacherById,
  approveTeacher,
  rejectTeacher,
  updatePerMinuteRate,
  updateTeacher,
  deleteTeacher,
  sendLoginCredentials,
} from "../controllers/teacher.controller.js";
import {
  getPlatformFees,
  getPlatformFeesSummary,
  updatePlatformFee,
} from "../controllers/adminPlatformFee.controller.js";
import {
  createCourseTestLink,
  getCourseTestLinks,
  updateCourseTestLink,
  deleteCourseTestLink,
} from "../controllers/courseTestLink.controller.js";
import {
  createTournament,
  getTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament,
  getTournamentLeaderboard,
  declareTournamentWinners,
} from "../controllers/tournament.controller.js";
import {
  createWorkshop,
  getWorkshops,
  getWorkshopById,
  updateWorkshop,
  deleteWorkshop,
} from "../controllers/workshop.controller.js";
import {
  getForumsAdmin,
  deleteCommentAdmin,
  deleteReplyAdmin,
  deleteForumAdmin,
} from "../controllers/forum.controller.js";
import {
  createCoupon,
  getCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
} from "../controllers/coupon.controller.js";
import {

  getAllOrders,
  getOrderById,
} from "../controllers/order.controller.js";
import {
  createOffer,
  getOffers,
  getOfferById,
  updateOffer,
  deleteOffer,
} from "../controllers/offer.controller.js";
import {
  getMerchandise,
  getMerchandiseById,
  createMerchandise,
  updateMerchandise,
  deleteMerchandise,
  getMerchandiseRequests,
  updateClaimStatus,
} from "../controllers/adminMerchandise.controller.js";
import {
  getAllTickets,
  getTicketById,
  assignTicket,
  updateTicketStatus,
  addInternalNote,
  getTicketMessages,
  sendMessage,
  getTicketCategories,
} from "../controllers/adminSupport.controller.js";
import {
  uploadCertificate,
  getCertificates,
  getCertificateById,
} from "../controllers/certificate.controller.js";
import {
  uploadCertificateTemplate,
  getCertificateTemplate,
} from "../controllers/certificateTemplate.controller.js";
import {
  sendNotificationToStudent,
  sendNotificationToMultipleStudents,
  sendNotificationToAllStudents,
  sendNotificationToPurchasers,
} from "../controllers/notification.controller.js";
import {
  createCategory as createTaxonomyCategory,
  getCategories as getTaxonomyCategories,
  getCategoryTree as getTaxonomyCategoryTree,
  getCategoryById as getTaxonomyCategoryById,
  getCategoryChildren as getTaxonomyCategoryChildren,
  updateCategory as updateTaxonomyCategory,
  updateCategoryPricing as updateTaxonomyCategoryPricing,
  deleteCategory as deleteTaxonomyCategory,
  createCategoryOffer,
  removeCategoryOffer,
  createCategoryCoupon,
  getCategoryCoupons,
  deleteCategoryCoupon,
  getGamificationCategoryByType
} from "../controllers/category.controller.js";
import {
  createSchoolTest,
  getSchoolTests,
  updateSchoolTest,
  deleteSchoolTest,
} from "../controllers/schoolTest.controller.js";
import {
  createSkillTest,
  getSkillTests,
  updateSkillTest,
  deleteSkillTest,
} from "../controllers/skillTest.controller.js";
import {
  createCompetitiveTest,
  getCompetitiveTests,
  updateCompetitiveTest,
  deleteCompetitiveTest,
} from "../controllers/competitiveTest.controller.js";
import {
  createOlympiadTest,
  getOlympiadTests,
  getOlympiadTestById,
  updateOlympiadTest,
  deleteOlympiadTest,
} from "../controllers/olympiadTest.controller.js";
import {
  createQuestionBank,
  createQuestionBankWithQuestions,
  getQuestionBanks,
  getQuestionBankById,
  getQuestionsByBankId,
  updateQuestionBank,
  toggleSectionWiseQuestions,
  deleteQuestionBank,
} from "../controllers/questionBank.controller.js";
import {
  createAiQuestionBankWithQuestions,
  getAiQuestionBanks,
  getAiQuestionBankById,
  getAiQuestionsByBankId,
  deleteAiQuestionBank,
  updateAiQuestion,
} from "../controllers/aiQuestionBank.controller.js";
import {
  getAiBankDraft,
  saveAiBankDraft,
  deleteAiBankDraft,
} from "../controllers/aiBankDraft.controller.js";

import {
  getAllSupport,
  replyToSupport,
} from '../controllers/contactSupport.controller.js';


import {
  getAllBlogRequests,
  getBlogRequestById,
  updateBlogRequestStatus,
} from '../controllers/blogRequest.controller.js';
import { createBlog, updateBlog, deleteBlog, getAllBlogs } from '../controllers/blog.controller.js';


import {
  addSuccessStory,
  getAllStoriesAdmin,
  getStoryByIdAdmin,
  updateSuccessStory,
  updateStoryStatus,
  deleteSuccessStory,
} from '../controllers/successStory.controller.js';


import {
  generateQuestions,
  generateQuestionBankSuggestions,
  getQuestionBankGenerationJobStatus,
  getQuestionBankBackgroundValidation,
  getPipelineEventsStatus,
  generateImageQuestion,
  generateImageQuestionOpenAI,
  generateQuestionImage,
  generateQuestionImageOpenAI,
  listGeminiImageModels,
  listGeminiTextModels,
  listClaudeTextModels,
  saveGeneratedQuestions,
  validateQuestionTopicRelevance,
  planQuestionBankTopics,
  logConfirmedQuestions,
  applyAnswerCorrection,
} from '../controllers/aiQuestion.controller.js';

import {
  getCleanupStatusController,
  runCleanupNowController,
  forceCleanupController,
} from '../controllers/adminCleanup.controller.js';

import {
  createPressAnnouncement,
  getAllPressAnnouncementsAdmin,
  getPressAnnouncementByIdAdmin,
  updatePressAnnouncement,
  deletePressAnnouncement,
} from '../controllers/pressAnnouncement.controller.js';
import {
  createApplyJob,
  getAllApplyJobsAdmin,
  getApplyJobByIdAdmin,
  updateApplyJob,
  deleteApplyJob,
  getAllApplicationsAdmin,
  getInterviewTakenAdmin,
  getApplicationByIdAdmin,
  scheduleInterview,
  approveApplication,
  rejectApplication,
} from '../controllers/teacherConnectApply.controller.js';
import {
  getCategories,
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/emailTemplate.controller.js";

import {
  createQnA,
  getAllQnAs,
  getQnAById,
  updateQnA,
  deleteQnA,
  approveQnA,
} from "../controllers/qna.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { verifyAdmin } from "../middleware/admin.middleware.js";
import {
  getAdminStudentsWithChatLogs,
  getAdminTeachersWithChatLogs,
  getAdminStudentChatConversations,
  getAdminTeacherChatConversations,
  getAdminChatMessages,
  getAdminStudentsWithCallLogs,
  getAdminTeachersWithCallLogs,
  getAdminStudentCallConversations,
  getAdminTeacherCallConversations,
  getAdminCallSessions,
  downloadAdminCallRecording,
} from "../controllers/adminTeacherConnectChat.controller.js";
import {
  getAdminWithdrawalList,
  getAdminWithdrawalById,
  postAdminApproveWithdrawal,
  postAdminRejectWithdrawal,
} from "../controllers/teacherWithdrawal.controller.js";
import { uploadCourseMaterial, uploadImage, uploadAnyImages, uploadPDF, uploadSuccessStory, uploadPDFAndImage, uploadLiveCompetitionContent, uploadBlogContent } from '../utils/multerConfig.js';
import {
  createEvent as createLiveCompetition,
  getEvents as getLiveCompetitions,
  getEventById as getLiveCompetitionById,
  updateEvent as updateLiveCompetition,
  deleteEvent as deleteLiveCompetition,
  getSubmissionsByEvent,
  getSubmissionById,
  reviewSubmission,
  deleteSubmission,
  qualifyStudents,
  declareResult,
  declareWinner,
  getEventStats,
} from "../controllers/liveCompetition.controller.js";
import {
  createCategory as createLiveCategory,
  getAllCategories as getLiveCategories,
  updateCategory as updateLiveCategory,
  deleteCategory as deleteLiveCategory,
} from "../controllers/liveCompetitionCategory.controller.js";

import {
  createCarearJob,
  getCarearJobs,
  getCarearJobById,
  updateCarearJob,
  deleteCarearJob,
} from "../controllers/carear.controller.js";

import {
  getApplicantsForJob,
  getApplicantDetails,
  updateApplicantStatus,
} from "../controllers/jobApplicant.controller.js";
import {
  createManualEntry,
  getManualEntries,
  getManualEntryById,
  updateManualEntry,
  deleteManualEntry,
  uploadHallOfFameImage,
} from "../controllers/adminHallOfFame.controller.js";

import {
  createMaterial,
  getMaterials,
  deleteMaterial,
} from "../controllers/adminFreeMaterial.controller.js";

import {
  createHeroSlide,
  getHeroSlidesAdmin,
  updateHeroSlide,
  deleteHeroSlide,
} from "../controllers/heroSlide.controller.js";


const router = Router();

// Admin Authentication Routes
router.post("/login", adminLogin);
router.post("/logout", verifyJWT, adminLogout);
router.get("/profile", verifyJWT, getAdminProfile);
router.get("/dashboard", verifyJWT, getDashboardData);
router.get("/revenue-history", verifyJWT, getRevenueHistory);
router.get("/revenue-transactions", verifyJWT, getRevenueTransactions);
router.post("/forgot-password/request", requestForgotPasswordOTP);
router.post("/forgot-password/verify", verifyForgotPasswordOTP);
router.post("/forgot-password/reset", resetPassword);
router.put("/change-password", verifyJWT, changePassword);

// Categories (hierarchical, unlimited nesting: School -> Classes -> Class 1 -> Subjects -> Math -> Geometry)
router.post("/categories", verifyJWT, createTaxonomyCategory);
router.get("/categories", verifyJWT, getTaxonomyCategories);
router.get("/categories/tree", verifyJWT, getTaxonomyCategoryTree);
router.get("/categories/:id", verifyJWT, getTaxonomyCategoryById);
router.get("/categories/:id/children", verifyJWT, getTaxonomyCategoryChildren);
router.put("/categories/:id", verifyJWT, updateTaxonomyCategory);
router.patch("/categories/:id/pricing", verifyJWT, uploadImage.single("bannerImg"), updateTaxonomyCategoryPricing);
router.delete("/categories/:id", verifyJWT, deleteTaxonomyCategory);
router.post("/categories/:id/offer", verifyJWT, createCategoryOffer);
router.delete("/categories/:id/offer", verifyJWT, removeCategoryOffer);
router.post("/categories/:id/coupons", verifyJWT, createCategoryCoupon);
router.get("/categories/:id/coupons", verifyJWT, getCategoryCoupons);
router.delete("/categories/:id/coupons/:couponId", verifyJWT, deleteCategoryCoupon);

// Gamification - Everyday Challenge Schedule
router.get("/gamification/everyday-challenge/status", verifyJWT, getEverydayChallengeStatus);
router.get("/gamification/everyday-challenge", verifyJWT, getEverydayChallengeSchedule);
router.post("/gamification/everyday-challenge", verifyJWT, upsertEverydayChallengeSchedule);

// Gamification - Categories
router.get("/gamification-categories/:type", verifyJWT, getGamificationCategoryByType);

// Gamification - Subcategories
router.put("/gamification-subcategories/:id", verifyJWT, updateGamificationSubcategory);

// School & Skill Tests Management
router.post("/school-tests", verifyJWT, createSchoolTest);
router.get("/school-tests", verifyJWT, getSchoolTests);
router.put("/school-tests/:id", verifyJWT, updateSchoolTest);
router.delete("/school-tests/:id", verifyJWT, deleteSchoolTest);

// ─── Skill Tests ───
router.post("/skill-tests", verifyJWT, createSkillTest);
router.get("/skill-tests", verifyJWT, getSkillTests);
router.put("/skill-tests/:id", verifyJWT, updateSkillTest);
router.delete("/skill-tests/:id", verifyJWT, deleteSkillTest);

// ─── Competitive Tests ───
router.post("/competitive-tests", verifyJWT, createCompetitiveTest);
router.get("/competitive-tests", verifyJWT, getCompetitiveTests);
router.put("/competitive-tests/:id", verifyJWT, updateCompetitiveTest);
router.delete("/competitive-tests/:id", verifyJWT, deleteCompetitiveTest);

// ─── Olympiad Tests ───
router.post("/olympiad-tests", verifyJWT, createOlympiadTest);
router.get("/olympiad-tests", verifyJWT, getOlympiadTests);
router.get("/olympiad-tests/:id", verifyJWT, getOlympiadTestById);
router.put("/olympiad-tests/:id", verifyJWT, updateOlympiadTest);
router.delete("/olympiad-tests/:id", verifyJWT, deleteOlympiadTest);

// Question Banks (create bank, create bank with questions, list, update name, delete)
router.post("/question-banks", verifyJWT, createQuestionBank);
router.post(
  "/question-banks/with-questions",
  verifyJWT,
  uploadAnyImages,
  createQuestionBankWithQuestions
);
router.get("/question-banks", verifyJWT, getQuestionBanks);
router.get("/question-banks/:id", verifyJWT, getQuestionBankById);
router.get("/question-banks/:id/questions", verifyJWT, getQuestionsByBankId);
router.put("/question-banks/:id", verifyJWT, updateQuestionBank);
router.patch(
  "/question-banks/:id/section-wise-questions",
  verifyJWT,
  toggleSectionWiseQuestions
);
router.delete("/question-banks/:id", verifyJWT, deleteQuestionBank);

// AI Question Banks (separate collection from manual question banks)
router.post(
  "/ai-question-banks/with-questions",
  verifyJWT,
  createAiQuestionBankWithQuestions
);
router.get("/ai-question-banks", verifyJWT, getAiQuestionBanks);
router.get("/ai-question-banks/:id", verifyJWT, getAiQuestionBankById);
router.get(
  "/ai-question-banks/:id/questions",
  verifyJWT,
  getAiQuestionsByBankId
);
router.delete("/ai-question-banks/:id", verifyJWT, deleteAiQuestionBank);
router.put("/ai-questions/:id", verifyJWT, updateAiQuestion);

// AI Powered Test create-flow draft (one per user; autosaved so work survives
// refresh / tab close and can be resumed). Stored in its own collection.
router.get("/ai-bank-draft", verifyJWT, getAiBankDraft);
router.put("/ai-bank-draft", verifyJWT, saveAiBankDraft);
router.delete("/ai-bank-draft", verifyJWT, deleteAiBankDraft);

// Question Bank Management Routes (individual questions - create, list all, get, update, delete)
router.post("/questions", verifyJWT, uploadAnyImages, createQuestion);
router.get("/questions", verifyJWT, getAllQuestions);
router.get("/questions/:id", verifyJWT, getQuestionById);
router.put("/questions/:id", verifyJWT, uploadAnyImages, updateQuestion);
router.delete("/questions/:id", verifyJWT, deleteQuestion);

// Connected Questions Routes
router.post("/questions/:id/child-questions", verifyJWT, addChildQuestion);
router.delete("/questions/:id/child-questions/:childId", verifyJWT, removeChildQuestion);
// Analytics Routes
router.get("/questions/:id/analytics", verifyJWT, getQuestionAnalytics);
router.post("/questions/:id/analytics/calculate", verifyJWT, calculateAnalytics);
router.post("/questions/analytics/bulk", verifyJWT, getBulkAnalytics);

// Tests (Test Builder) - optional image = cover/thumbnail
router.post("/tests", verifyJWT, uploadImage.single("image"), createTest);
router.get("/tests", verifyJWT, getTests);
router.get("/tests/:id", verifyJWT, getTestById);
router.put("/tests/:id", verifyJWT, uploadImage.single("image"), updateTest);
router.delete("/tests/:id", verifyJWT, deleteTest);

// Test Bundles (Test Series) - optional image = cover/thumbnail
router.post("/test-bundles", verifyJWT, uploadImage.single("image"), createBundle);
router.get("/test-bundles", verifyJWT, getBundles);
router.get("/test-bundles/:id", verifyJWT, getBundleById);
router.put("/test-bundles/:id", verifyJWT, uploadImage.single("image"), updateBundle);
router.delete("/test-bundles/:id", verifyJWT, deleteBundle);

// Courses
router.post("/courses", verifyJWT, uploadCourseMaterial, createCourse);
router.get("/courses", verifyJWT, getCourses);
router.get("/courses/:id", verifyJWT, getCourseById);
router.put("/courses/:id", verifyJWT, uploadCourseMaterial, updateCourse);
router.delete("/courses/:id", verifyJWT, deleteCourse);

// Teacher Management (admin creates/updates teachers; teachers can only login and update limited profile)
router.post("/teachers", verifyJWT, uploadImage.single("profileImage"), createTeacher);
router.get("/teachers", verifyJWT, getTeachers);
router.get("/teachers/:id", verifyJWT, getTeacherById);
router.post("/teachers/:id/approve", verifyJWT, approveTeacher);
router.post("/teachers/:id/reject", verifyJWT, rejectTeacher);
router.post("/teachers/:id/send-credentials", verifyJWT, sendLoginCredentials);
router.put("/teachers/:id/rate", verifyJWT, updatePerMinuteRate);
router.put("/teachers/:id/platform-fee", verifyJWT, verifyAdmin, updatePlatformFee);
router.put("/teachers/:id", verifyJWT, uploadImage.single("profileImage"), updateTeacher);
router.delete("/teachers/:id", verifyJWT, deleteTeacher);

router.get("/platform-fees", verifyJWT, verifyAdmin, getPlatformFees);
router.get("/platform-fees/summary", verifyJWT, verifyAdmin, getPlatformFeesSummary);

// Teacher wallet withdrawals (pending requests; approve/reject notifies teacher via FCM)
router.get("/teacher-withdrawals", verifyJWT, verifyAdmin, getAdminWithdrawalList);
router.get("/teacher-withdrawals/:id", verifyJWT, verifyAdmin, getAdminWithdrawalById);
router.post(
  "/teacher-withdrawals/:id/approve",
  verifyJWT,
  verifyAdmin,
  postAdminApproveWithdrawal
);
router.post(
  "/teacher-withdrawals/:id/reject",
  verifyJWT,
  verifyAdmin,
  postAdminRejectWithdrawal
);

// Student Management & Proctoring
router.get("/students", verifyJWT, getStudents);
router.get("/students/:id", verifyJWT, getStudentById);
router.put("/students/:id/status", verifyJWT, updateStudentStatus);
router.get("/students/:id/test-history", verifyJWT, getStudentTestHistory);
router.get("/exam-sessions/:sessionId/proctor-logs", verifyJWT, getProctorLogs);

// Course-Test Links (Follow-up Tests)
router.post("/course-test-links", verifyJWT, createCourseTestLink);
router.get("/courses/:courseId/test-links", verifyJWT, getCourseTestLinks);
router.put("/course-test-links/:id", verifyJWT, updateCourseTestLink);
router.delete("/course-test-links/:id", verifyJWT, deleteCourseTestLink);

// Live Events Management - Tournaments
router.post("/tournaments", verifyJWT, createTournament);
router.get("/tournaments", verifyJWT, getTournaments);
router.get("/tournaments/:id", verifyJWT, getTournamentById);
router.put("/tournaments/:id", verifyJWT, updateTournament);
router.delete("/tournaments/:id", verifyJWT, deleteTournament);
router.get("/tournaments/:id/leaderboard", verifyJWT, getTournamentLeaderboard);
router.post("/tournaments/:id/winners", verifyJWT, declareTournamentWinners);

// Live Events Management - Workshops
router.post("/workshops", verifyJWT, uploadImage.single("image"), createWorkshop);
router.get("/workshops", verifyJWT, getWorkshops);
router.get("/workshops/:id", verifyJWT, getWorkshopById);
router.put("/workshops/:id", verifyJWT, uploadImage.single("image"), updateWorkshop);
router.delete("/workshops/:id", verifyJWT, deleteWorkshop);

// Forum Moderation (Admin)
router.get("/forums", verifyJWT, getForumsAdmin);
router.delete("/forums/:forumId", verifyJWT, deleteForumAdmin);
router.delete("/forums/:forumId/comments/:commentId", verifyJWT, deleteCommentAdmin);
router.delete("/forums/:forumId/comments/:commentId/replies/:replyId", verifyJWT, deleteReplyAdmin);

// ==================== E-COMMERCE & WALLET ====================

// Coupon Management
router.post("/coupons", verifyJWT, createCoupon);
router.get("/coupons", verifyJWT, getCoupons);
router.get("/coupons/:id", verifyJWT, getCouponById);
router.put("/coupons/:id", verifyJWT, updateCoupon);
router.delete("/coupons/:id", verifyJWT, deleteCoupon);

// Offer Management (Discount System)
router.post("/offers", verifyJWT, createOffer);
router.get("/offers", verifyJWT, getOffers);
router.get("/offers/:id", verifyJWT, getOfferById);
router.put("/offers/:id", verifyJWT, updateOffer);
router.delete("/offers/:id", verifyJWT, deleteOffer);

// Order History
router.get("/orders", verifyJWT, getAllOrders);
router.get("/orders/:id", verifyJWT, getOrderById);

// Merchandise Management
router.get("/merchandise", verifyJWT, getMerchandise);
router.get("/merchandise/:id", verifyJWT, getMerchandiseById);
router.post("/merchandise", verifyJWT, uploadImage.single("image"), createMerchandise);
router.put("/merchandise/:id", verifyJWT, uploadImage.single("image"), updateMerchandise);
router.delete("/merchandise/:id", verifyJWT, deleteMerchandise);

// Merchandise Requests (Claims)
router.get("/merchandise-requests", verifyJWT, getMerchandiseRequests);
router.put("/merchandise-requests/:id/status", verifyJWT, updateClaimStatus);

// ==================== SUPPORT DESK ====================



// Simple Support Messages
router.get('/contact-support', verifyJWT, getAllSupport);
router.patch('/contact-support/:id', verifyJWT, replyToSupport);

// Blog Requests
router.get('/blog-request', verifyJWT, getAllBlogRequests);
router.get('/blog-request/:id', verifyJWT, getBlogRequestById);
router.patch('/blog-request/:id', verifyJWT, updateBlogRequestStatus);

// Admin-added blogs (create, update, delete - admin-created or approved)
const blogUploadFields = uploadBlogContent.fields([
  { name: 'image', maxCount: 1 },
  { name: 'document', maxCount: 1 },
]);
router.get('/blogs',verifyJWT,getAllBlogs)
router.post('/blogs', verifyJWT, blogUploadFields, createBlog);
router.put('/blogs/:id', verifyJWT, blogUploadFields, updateBlog);
router.delete('/blogs/:id', verifyJWT, deleteBlog);

// Ticket Management
router.get("/support/tickets", verifyJWT, getAllTickets);
router.get("/support/tickets/categories", verifyJWT, getTicketCategories);
router.get("/support/tickets/:ticketId", verifyJWT, getTicketById);
router.post("/support/tickets/:ticketId/assign", verifyJWT, assignTicket);
router.put("/support/tickets/:ticketId/status", verifyJWT, updateTicketStatus);
router.post("/support/tickets/:ticketId/internal-notes",verifyJWT, addInternalNote);

// Chat Management
router.get("/support/tickets/:ticketId/messages", verifyJWT, getTicketMessages);
router.post("/support/tickets/:ticketId/messages", verifyJWT, sendMessage);

// ==================== CERTIFICATES ====================

// Upload certificate PDF for student (admin sends PDF from frontend)
router.post("/certificates/upload", verifyJWT, uploadPDF.single("pdf"), uploadCertificate);

// List and view issued certificates
router.get("/certificates", verifyJWT, getCertificates);
router.get("/certificates/:certificateId", verifyJWT, getCertificateById);

// Global certificate template for auto-generated certificates
router.post(
  "/certificate-template",
  verifyJWT,
  uploadPDF.single("pdf"),
  uploadCertificateTemplate
);
router.get("/certificate-template", verifyJWT, getCertificateTemplate);

// ==================== NOTIFICATIONS ====================

// Send notification to a single student
router.post("/notifications/send", verifyJWT, sendNotificationToStudent);

// Send notification to multiple students
router.post("/notifications/send-multiple", verifyJWT, sendNotificationToMultipleStudents);

// Send notification to all students
router.post("/notifications/send-all", verifyJWT, sendNotificationToAllStudents);

// Send notification to students who purchased a specific product (course, test, bundle, olympiad, tournament, workshop)
router.post("/notifications/send-to-purchasers", verifyJWT, sendNotificationToPurchasers);




// ==================== SUCCESS STORIES ====================

// Success Stories Management
router.post(
  '/success-stories',
  verifyJWT,
  uploadSuccessStory.fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  addSuccessStory,
);
router.get('/success-stories', verifyJWT, getAllStoriesAdmin);
router.get('/success-stories/:id', verifyJWT, getStoryByIdAdmin);
router.put(
  '/success-stories/:id',
  verifyJWT,
  uploadSuccessStory.fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  updateSuccessStory,
);
router.patch('/success-stories/:id/status', verifyJWT, updateStoryStatus);
router.delete('/success-stories/:id', verifyJWT, deleteSuccessStory);


/* ==================== AI QUESTION GENERATION ==================== */

// Generate questions using Gemini 2.5 Flash
router.post(
  '/ai/generate-questions',
  verifyJWT,
  generateQuestions
);

// Question bank: plan topics/syllabus (no generation) — step 1 of the split flow
router.post(
  '/ai/plan-question-topics',
  verifyJWT,
  planQuestionBankTopics
);

// Question bank: single / multiple / true-false suggestions (Gemini)
router.post(
  '/ai/generate-question-bank-suggestions',
  verifyJWT,
  generateQuestionBankSuggestions
);

router.get(
  '/ai/question-bank-generation/:jobId',
  verifyJWT,
  getQuestionBankGenerationJobStatus
);

router.get(
  '/ai/question-bank-background-validation/:jobId',
  verifyJWT,
  getQuestionBankBackgroundValidation
);

router.get(
  '/ai/pipeline-events/:workflowLogKey',
  verifyJWT,
  getPipelineEventsStatus
);

router.post(
  '/ai/generate-image-question',
  verifyJWT,
  generateImageQuestion
);

router.post(
  '/ai/generate-image-question-openai',
  verifyJWT,
  generateImageQuestionOpenAI
);

router.post(
  '/ai/generate-question-image',
  verifyJWT,
  generateQuestionImage
);

router.get(
  '/ai/gemini-image-models',
  verifyJWT,
  listGeminiImageModels
);

router.get(
  '/ai/gemini-text-models',
  verifyJWT,
  listGeminiTextModels
);

router.get(
  '/ai/claude-text-models',
  verifyJWT,
  listClaudeTextModels
);

router.post(
  '/ai/generate-question-image-openai',
  verifyJWT,
  generateQuestionImageOpenAI
);

router.post(
  '/ai/validate-question-topic-relevance',
  verifyJWT,
  validateQuestionTopicRelevance
);

router.post(
  '/ai/log-confirmed-questions',
  verifyJWT,
  logConfirmedQuestions
);

router.post(
  '/ai/apply-answer-correction',
  verifyJWT,
  applyAnswerCorrection
);

// Save generated questions to Question Bank
router.post(
  '/ai/save-generated-questions',
  verifyJWT,
  saveGeneratedQuestions
);


// ==================== PRESS ANNOUNCEMENTS ====================
router.post('/press-announcements', verifyJWT, uploadImage.single('image'), createPressAnnouncement);
router.get('/press-announcements', verifyJWT, getAllPressAnnouncementsAdmin);
router.get('/press-announcements/:id', verifyJWT, getPressAnnouncementByIdAdmin);
router.put('/press-announcements/:id', verifyJWT, uploadImage.single('image'), updatePressAnnouncement);
router.delete('/press-announcements/:id', verifyJWT, deletePressAnnouncement);

// ==================== TEACHER CONNECT – APPLY JOB ====================
router.post('/teacher-connect/jobs', verifyJWT, createApplyJob);
router.get('/teacher-connect/jobs', verifyJWT, getAllApplyJobsAdmin);
router.get('/teacher-connect/jobs/:id', verifyJWT, getApplyJobByIdAdmin);
router.put('/teacher-connect/jobs/:id', verifyJWT, updateApplyJob);
router.delete('/teacher-connect/jobs/:id', verifyJWT, deleteApplyJob);
router.get('/teacher-connect/applications', verifyJWT, getAllApplicationsAdmin);
router.get('/teacher-connect/interview-taken', verifyJWT, getInterviewTakenAdmin);
router.get('/teacher-connect/applications/:id', verifyJWT, getApplicationByIdAdmin);
router.post('/teacher-connect/applications/:id/schedule-interview', verifyJWT, scheduleInterview);
router.post('/teacher-connect/applications/:id/approve', verifyJWT, uploadPDFAndImage.single('attachment'), approveApplication);
router.post('/teacher-connect/applications/:id/reject', verifyJWT, rejectApplication);

// ==================== EMAIL TEMPLATES ====================
router.get("/email-templates/categories", verifyJWT, getCategories);
router.get("/email-templates", verifyJWT, getTemplates);
router.get("/email-templates/:id", verifyJWT, getTemplateById);
router.post("/email-templates", verifyJWT, createTemplate);
router.put("/email-templates/:id", verifyJWT, updateTemplate);
router.delete("/email-templates/:id", verifyJWT, deleteTemplate);


// QnA Routes
router.post("/qna", verifyJWT, createQnA);
router.get("/qna", verifyJWT, getAllQnAs);
router.get("/qna/:id", verifyJWT, getQnAById);
router.put("/qna/:id", verifyJWT, updateQnA);
router.put("/qna/approve/:id", verifyJWT, approveQnA);
router.delete("/qna/:id", verifyJWT, deleteQnA);
// ==================== LIVE COMPETITIONS ====================

// Event Management (CRUD)
router.post("/live-competitions", verifyJWT, uploadImage.single("banner"), createLiveCompetition);
router.get("/live-competitions", verifyJWT, getLiveCompetitions);
router.get("/live-competitions/:id", verifyJWT, getLiveCompetitionById);
router.put("/live-competitions/:id", verifyJWT, uploadImage.single("banner"), updateLiveCompetition);
router.delete("/live-competitions/:id", verifyJWT, deleteLiveCompetition);

// Submission Management
router.get("/live-competitions/:id/submissions", verifyJWT, getSubmissionsByEvent);
router.get("/live-competition-submissions/:id", verifyJWT, getSubmissionById);
router.patch("/live-competition-submissions/:id/review", verifyJWT, reviewSubmission);
router.delete("/live-competition-submissions/:id", verifyJWT, deleteSubmission);

// Qualifier System
router.post("/live-competitions/:id/qualify", verifyJWT, qualifyStudents);

// Result Declaration
router.post("/live-competitions/:id/declare-result", verifyJWT, declareResult);

// Winner System
router.put("/live-competitions/:id/winner", verifyJWT, declareWinner);

// Analytics
router.get("/live-competitions/:id/stats", verifyJWT, getEventStats);

// ==================== LIVE COMPETITION CATEGORIES ====================
router.post("/live-competition-categories", verifyJWT, createLiveCategory);
router.get("/live-competition-categories", verifyJWT, getLiveCategories);
router.put("/live-competition-categories/:id", verifyJWT, updateLiveCategory);
router.delete("/live-competition-categories/:id", verifyJWT, deleteLiveCategory);

// ==================== CAREARS (JOBS) ====================
router.post("/carears", verifyJWT, createCarearJob);

router.get("/carears", verifyJWT, getCarearJobs);
router.get("/carears/:id", verifyJWT, getCarearJobById);
router.put("/carears/:id", verifyJWT, updateCarearJob);
router.delete("/carears/:id", verifyJWT, deleteCarearJob);
router.get("/carears/:jobId/applicants", verifyJWT, getApplicantsForJob);

// ==================== JOB APPLICANTS ====================
router.get("/applicants/:id", verifyJWT, getApplicantDetails);
router.put("/applicants/:id/status", verifyJWT, updateApplicantStatus);

// ==================== HALL OF FAME (MANUAL ENTRIES) ====================
router.post("/hall-of-fame/upload-image", verifyJWT, uploadImage.single("image"), uploadHallOfFameImage);
router.post("/hall-of-fame", verifyJWT, createManualEntry);
router.get("/hall-of-fame", verifyJWT, getManualEntries);
router.get("/hall-of-fame/:id", verifyJWT, getManualEntryById);
router.put("/hall-of-fame/:id", verifyJWT, updateManualEntry);
router.delete("/hall-of-fame/:id", verifyJWT, deleteManualEntry);

// ==================== FREE MATERIALS ====================
router.post("/free-materials", verifyJWT, uploadLiveCompetitionContent.single("file"), createMaterial);
router.get("/free-materials", verifyJWT, getMaterials);
router.delete("/free-materials/:id", verifyJWT, deleteMaterial);

// ==================== HERO SLIDES (Landing Page) ====================
router.post("/hero-slides", verifyJWT, uploadSuccessStory.single("media"), createHeroSlide);
router.get("/hero-slides", verifyJWT, getHeroSlidesAdmin);
router.put("/hero-slides/:id", verifyJWT, uploadSuccessStory.single("media"), updateHeroSlide);
router.delete("/hero-slides/:id", verifyJWT, deleteHeroSlide);

// ==================== TEACHER CONNECT CHAT REPORTS (Admin monitoring) ====================
router.get(
  "/teacher-connect/chat-reports/students",
  verifyJWT,
  verifyAdmin,
  getAdminStudentsWithChatLogs
);
router.get(
  "/teacher-connect/chat-reports/teachers",
  verifyJWT,
  verifyAdmin,
  getAdminTeachersWithChatLogs
);
router.get(
  "/teacher-connect/chat-reports/students/:studentId/conversations",
  verifyJWT,
  verifyAdmin,
  getAdminStudentChatConversations
);
router.get(
  "/teacher-connect/chat-reports/teachers/:teacherId/conversations",
  verifyJWT,
  verifyAdmin,
  getAdminTeacherChatConversations
);
router.get(
  "/teacher-connect/chat-reports/:studentId/:teacherId/messages",
  verifyJWT,
  verifyAdmin,
  getAdminChatMessages
);

// ==================== TEACHER CONNECT CALL REPORTS (Admin monitoring) ====================
router.get(
  "/teacher-connect/call-reports/students",
  verifyJWT,
  verifyAdmin,
  getAdminStudentsWithCallLogs
);
router.get(
  "/teacher-connect/call-reports/teachers",
  verifyJWT,
  verifyAdmin,
  getAdminTeachersWithCallLogs
);
router.get(
  "/teacher-connect/call-reports/students/:studentId/conversations",
  verifyJWT,
  verifyAdmin,
  getAdminStudentCallConversations
);
router.get(
  "/teacher-connect/call-reports/teachers/:teacherId/conversations",
  verifyJWT,
  verifyAdmin,
  getAdminTeacherCallConversations
);
router.get(
  "/teacher-connect/call-reports/:studentId/:teacherId/calls",
  verifyJWT,
  verifyAdmin,
  getAdminCallSessions
);
router.get(
  "/teacher-connect/call-reports/sessions/:sessionId/recording/download",
  verifyJWT,
  verifyAdmin,
  downloadAdminCallRecording
);

// ==================== CLEANUP & MAINTENANCE ====================
router.get(
  '/cleanup/status',
  verifyJWT,
  verifyAdmin,
  getCleanupStatusController
);

router.post(
  '/cleanup/run',
  verifyJWT,
  verifyAdmin,
  runCleanupNowController
);

router.post(
  '/cleanup/force',
  verifyJWT,
  verifyAdmin,
  forceCleanupController
);

export default router;
