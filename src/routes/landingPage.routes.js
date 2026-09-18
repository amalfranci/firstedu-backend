import { Router } from "express";
import {
  getAvailableTeachers,
  getTeacherById,
  rateTeacher,
} from "../controllers/studentTeacherConnect.controller.js";
import { getHallOfFame } from "../controllers/hallOfFame.controller.js";
import { getLeaderboardsForStudent } from "../controllers/leaderboard.controller.js";
import {
  getCourseByIdLandingPage,
  getCourses,
  getTestById,
  getTests,
  getTestsAndBundles,
} from "../controllers/marketplace.controller.js";
import {
  applyForJob,
  getAllApplyJobsUser,
  getApplyJobByIdUser,
} from "../controllers/teacherConnectApply.controller.js";
import { getAllBlogs, getBlogById } from "../controllers/blog.controller.js";
import { getAllEvents, getLiveCompetitionById } from "../controllers/events.controller.js";
import { getAllStoriesAdmin } from "../controllers/successStory.controller.js";
import {
  getAllPressAnnouncementsAdmin,
  getPressAnnouncementByIdAdmin,
} from "../controllers/pressAnnouncement.controller.js";
import {
  createQnA,
  getAllQnAsLandingPage,
} from "../controllers/qna.controller.js";
import { getCategoriesForStudent } from "../controllers/category.controller.js";

import { contactUs } from "../controllers/contact.controller.js";
import { submitBlogRequest } from "../controllers/blogRequest.controller.js";
import { uploadImage, uploadPDF } from "../utils/multerConfig.js";
import { applyJob } from "../controllers/jobApplicant.controller.js";
import {
  getCarearJobById,
  getCarearJobs,
} from "../controllers/carear.controller.js";
import {
  signup,
  login,
  logout,
  getProfile,
  requestForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
} from "../controllers/studentAuth.controller.js";
import {
  createTicket,
  getMyTickets,
  getTicketById,
  getTicketMessages,
  sendMessage,
  getTicketCategories,
} from "../controllers/studentSupport.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { getWorkshopById } from "../controllers/workshop.controller.js";
import { getTournamentById } from "../controllers/tournament.controller.js";
import { getFreeMaterialsLandingPage } from "../controllers/marketplace.controller.js";
import { getActiveHeroSlides } from "../controllers/heroSlide.controller.js";

const router = Router();

//start Landing Page routes
router.post("/signup", uploadImage.single("profileImage"), signup);
router.post("/login", login);
router.post("/logout", verifyJWT, logout);
router.get("/profile", verifyJWT, getProfile);
router.post("/forgot-password/request", requestForgotPasswordOTP);
router.post("/forgot-password/verify", verifyForgotPasswordOTP);
router.post("/forgot-password/reset", resetPassword);
router.post("/contact-us", contactUs);
router.get("/success-stories", getAllStoriesAdmin);
router.get("/press-announcements", getAllPressAnnouncementsAdmin);
router.get("/press-announcements/:id", getPressAnnouncementByIdAdmin);
router.get("/teachers", getAvailableTeachers);
router.get("/teachers/:teacherId", getTeacherById);
router.post("/teachers/:teacherId/rate", verifyJWT, rateTeacher);
router.get("/hall-of-fame", getHallOfFame);
router.get("/leaderboard", getLeaderboardsForStudent);
router.get("/tests", getTests);
router.get("/tests-and-bundles", getTestsAndBundles);
router.get("/tests/:id", getTestById);
router.get("/teachers", getAvailableTeachers);
router.post("/teachers/:teacherId/rate", verifyJWT, rateTeacher);
router.get("/teacher-connect/jobs", getAllApplyJobsUser);
router.get("/teacher-connect/jobs/:id", getApplyJobByIdUser);
router.get("/blogs", getAllBlogs);
router.get("/blogs/:id", getBlogById);
router.post(
  "/blog-request",
  verifyJWT,
  uploadImage.single("image"),
  submitBlogRequest,
);
router.get("/courses", getCourses);
router.get("/courses/:id", getCourseByIdLandingPage);
router.get("/workshops/:id", getWorkshopById);
router.get("/tournaments/:id", getTournamentById);
router.get("/live-competitions/:id", getLiveCompetitionById);
router.get("/events", getAllEvents);
router.get("/qna", getAllQnAsLandingPage);
router.post("/qna-request", verifyJWT, createQnA);
router.get("/categories", getCategoriesForStudent);
router.get("/free-materials", getFreeMaterialsLandingPage);
router.get("/hero-slides", getActiveHeroSlides);

// ==================== CAREARS (JOBS) ====================

router.post("/carears/apply", uploadPDF.single("resume"), applyJob);
router.get("/carears", getCarearJobs);
router.get("/carears/:id", getCarearJobById);

// teacher-connect carear
router.post("/teacher-connect/apply", uploadPDF.single("resume"), applyForJob);

// Ticket Management
router.post("/support/tickets", verifyJWT, createTicket);
router.get("/support/tickets", verifyJWT, getMyTickets);

// Specific routes like '/categories' must come before parameterized routes like '/:ticketId'
router.get("/support/tickets/categories", verifyJWT, getTicketCategories);
router.get("/support/tickets/:ticketId", verifyJWT, getTicketById);
router.get("/support/tickets/:ticketId/messages", verifyJWT, getTicketMessages);
router.post("/support/tickets/:ticketId/messages", verifyJWT, sendMessage);

export default router;
