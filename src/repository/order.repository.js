import mongoose from "mongoose";
import Order from "../models/Order.js";
import CoursePurchase from "../models/CoursePurchase.js";
import TestPurchase from "../models/TestPurchase.js";
import MerchandiseClaim from "../models/MerchandiseClaim.js";
import EventRegistration from "../models/EventRegistration.js";
import LiveCompetitionSubmission from "../models/LiveCompetitionSubmission.js";
import CategoryPurchase from "../models/CategoryPurchase.js";
import OlympiadTest from "../models/OlympiadTest.js";
import { ApiError } from "../utils/ApiError.js";

// Register missing Olympiad model alias to prevent Mongoose populate error
if (!mongoose.models.Olympiad) {
  mongoose.model("Olympiad", OlympiadTest.schema);
}

const findOrderById = async (id) => {
  try {
    return await Order.findById(id)
      .populate("student", "name email phone")
      .populate("coupon", "code discountType discountValue");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch order", error.message);
  }
};

const findOrders = async (query, options = {}) => {
  try {
    const { page = 1, limit = 10, sort = { createdAt: -1 } } = options;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("student", "name email phone")
        .populate("coupon", "code discountType discountValue")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(query),
    ]);

    return {
      orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch orders", error.message);
  }
};

const createOrder = async (orderData) => {
  try {
    return await Order.create(orderData);
  } catch (error) {
    throw new ApiError(500, "Failed to create order", error.message);
  }
};

const findCoursePurchases = async (studentId) => {
  try {
    return await CoursePurchase.find({ student: studentId, paymentStatus: "completed" })
      .populate("student", "name email")
      .populate("course", "title description price imageUrl isCertification categoryIds syllabus contents modules")
      .sort({ purchaseDate: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch course purchases", error.message);
  }
};

const findTestPurchases = async (studentId) => {
  try {
    return await TestPurchase.find({ student: studentId, paymentStatus: "completed" })
      .populate({
        path: "test",
        select: "title description price categoryId applicableFor questionBank",
        populate: { path: "questionBank", select: "categories" },
      })
      .populate("testBundle", "name description price")
      .populate("schoolCategory", "name description price")
      .populate("skillCategory", "name description price")
      .sort({ purchaseDate: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test purchases", error.message);
  }
};

const findTestPurchasesForExamHall = async (studentId) => {
  try {
    return await TestPurchase.find({ student: studentId, paymentStatus: "completed" })
      .populate({
        path: "test",
        select: "title description durationMinutes questionBank aiQuestionBank price applicableFor",
        populate: [
          { path: "questionBank", select: "name categories" },
          { path: "aiQuestionBank", select: "name categories questionCount" },
        ],
      })
      .populate({
        path: "testBundle",
        select: "name description price tests",
        populate: {
          path: "tests",
          select: "title description durationMinutes questionBank aiQuestionBank applicableFor",
          populate: [
            { path: "questionBank", select: "name categories" },
            { path: "aiQuestionBank", select: "name categories questionCount" },
          ],
        },
      })
      .populate("schoolCategory", "name description")
      .populate("skillCategory", "name description")
      .sort({ purchaseDate: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch exam hall purchases", error.message);
  }
};

const findMerchandiseClaims = async (studentId) => {
  try {
    return await MerchandiseClaim.find({ student: studentId })
      .populate("merchandise", "name description pointsRequired")
      .sort({ claimedAt: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch merchandise claims", error.message);
  }
};

const findEventRegistrations = async (studentId) => {
  try {
    return await EventRegistration.find({
      student: studentId,
      eventType: { $in: ["tournament", "workshop", "olympiad"] },
      paymentStatus: "completed",
    })
      .populate("eventId", "title price categoryId")
      .sort({ registeredAt: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch event registrations", error.message);
  }
};

const findLiveCompetitionRegistrations = async (studentId) => {
  try {
    return await LiveCompetitionSubmission.find({
      participant: studentId,
      paymentStatus: "COMPLETED",
    })
      .populate("event", "title fee")
      .sort({ createdAt: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch live competition registrations", error.message);
  }
};

const findCategoryPurchases = async (studentId) => {
  try {
    return await CategoryPurchase.find({ student: studentId, paymentStatus: "completed" })
      .populate("categoryId", "name rootType price")
      .populate("unlockedCategoryIds", "name rootType")
      .sort({ createdAt: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch category purchases", error.message);
  }
};

const findCoursePurchase = async (filter) => {
  try {
    return await CoursePurchase.findOne(filter);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch course purchase", error.message);
  }
};

const createCoursePurchase = async (purchaseData) => {
  try {
    const purchase = await CoursePurchase.create(purchaseData);
    return await CoursePurchase.findById(purchase._id)
      .populate("course", "title description price")
      .populate("student", "name email");
  } catch (error) {
    throw new ApiError(500, "Failed to create course purchase", error.message);
  }
};

const findTestPurchase = async (filter) => {
  try {
    return await TestPurchase.findOne(filter);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test purchase", error.message);
  }
};

/** Completed direct test purchases for this student, restricted to given test ids (e.g. challenge-yourself layout). */
const findPurchasedTestIdsForStudent = async (studentId, testIds) => {
  try {
    if (!studentId || !testIds?.length) return [];
    const objectIds = testIds
      .map((id) => {
        if (id == null) return null;
        const s = id?.toString?.() ?? String(id);
        return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
      })
      .filter(Boolean);
    if (objectIds.length === 0) return [];
    const docs = await TestPurchase.find({
      student: studentId,
      test: { $in: objectIds },
      paymentStatus: "completed",
    })
      .select("test")
      .lean();
    return [...new Set(docs.map((d) => d.test?.toString?.()).filter(Boolean))];
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test purchases by tests", error.message);
  }
};

/** Completed course purchases for this student, restricted to given course ids. */
const findPurchasedCourseIdsForStudent = async (studentId, courseIds) => {
  try {
    if (!studentId || !courseIds?.length) return [];
    const objectIds = courseIds
      .map((id) => {
        if (id == null) return null;
        const s = id?.toString?.() ?? String(id);
        return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
      })
      .filter(Boolean);
    if (objectIds.length === 0) return [];
    const docs = await CoursePurchase.find({
      student: studentId,
      course: { $in: objectIds },
      paymentStatus: "completed",
    })
      .select("course")
      .lean();
    return [...new Set(docs.map((d) => d.course?.toString?.()).filter(Boolean))];
  } catch (error) {
    throw new ApiError(500, "Failed to fetch course purchases by courses", error.message);
  }
};

const createTestPurchase = async (purchaseData) => {
  try {
    const purchase = await TestPurchase.create(purchaseData);
    return await TestPurchase.findById(purchase._id)
      .populate("test", "title description durationMinutes questionBank")
      .populate("testBundle", "name description tests price")
      .populate("schoolCategory", "name description")
      .populate("skillCategory", "name description")
      .populate("student", "name email");
  } catch (error) {
    throw new ApiError(500, "Failed to create test purchase", error.message);
  }
};

export default {
  findOrderById,
  findOrders,
  createOrder,
  findCoursePurchases,
  findTestPurchases,
  findTestPurchasesForExamHall,
  findMerchandiseClaims,
  findEventRegistrations,
  findLiveCompetitionRegistrations,
  findCategoryPurchases,
  findCoursePurchase,
  createCoursePurchase,
  findTestPurchase,
  findPurchasedTestIdsForStudent,
  findPurchasedCourseIdsForStudent,
  createTestPurchase,
};

