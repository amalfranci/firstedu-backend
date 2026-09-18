import { ApiError } from "../utils/ApiError.js";
import courseRepository from "../repository/course.repository.js";
import testRepository from "../repository/test.repository.js";
import courseTestLinkRepository from "../repository/courseTestLink.repository.js";
import orderRepository from "../repository/order.repository.js";
import examSessionRepository from "../repository/examSession.repository.js";
import eventRegistrationRepository from "../repository/eventRegistration.repository.js";
import tournamentRepository from "../repository/tournament.repository.js";
import razorpayOrderIntentRepository from "../repository/razorpayOrderIntent.repository.js";
import categoryRepository from "../repository/category.repository.js";
import pointsService from "./points.service.js";
import walletService from "./wallet.service.js";
import {
  createRazorpayOrder,
  verifyPaymentSignature,
} from "../utils/razorpayUtils.js";
import { attachOfferToList, attachOfferToItem, getApplicableOfferDetails, getAmountToCharge } from "../utils/offerUtils.js";
import couponService from "./coupon.service.js";
import studentRepository from "../repository/student.repository.js";
import { sendCourseEnrollmentEmail, sendTestBundlePurchaseEmail } from "../utils/sendEmail.js";
import Category from "../models/Category.js";
import OlympiadTest from "../models/OlympiadTest.js";
import { getOlympiads } from "./studentOlympiad.service.js";
import { getTournaments } from "./tournament.service.js";
import FreeMaterial from "../models/FreeMaterial.js";
import Certificate from "../models/Certificate.js";
import { logTransaction, resolveTestSourceType } from "./adminRevenue.service.js";
import QuestionBank from "../models/QuestionBank.js";
import AiQuestionBank from "../models/AiQuestionBank.js";

/**
 * Resolves the effective categoryId for a test.
 * - Prefers test.categoryId (explicitly assigned on the test)
 * - Falls back to the first category on the test's QuestionBank or AiQuestionBank
 * - Also checks test.schoolCategory / test.skillCategory for legacy tests
 */
const resolveTestCategoryId = async (test) => {
  if (test.categoryId) return test.categoryId;
  if (test.schoolCategory) return test.schoolCategory;
  if (test.skillCategory) return test.skillCategory;
  if (test.questionBank) {
    const qbId = test.questionBank._id || test.questionBank;
    const qb = await QuestionBank.findById(qbId).select("categories").lean();
    if (qb?.categories?.length > 0) return qb.categories[0];
  }
  if (test.aiQuestionBank) {
    const aiId = test.aiQuestionBank._id || test.aiQuestionBank;
    const ai = await AiQuestionBank.findById(aiId).select("categories").lean();
    if (ai?.categories?.length > 0) return ai.categories[0];
  }
  return null;
};

const buildCategoryPathsMap = async () => {
  const categories = await Category.find({}).select('name parent').lean();
  const catMap = new Map();
  categories.forEach(c => catMap.set(c._id.toString(), c));

  const pathMap = new Map();
  const getPath = (id) => {
    if (!id) return '';
    const idStr = id.toString();
    if (pathMap.has(idStr)) return pathMap.get(idStr);
    
    let current = catMap.get(idStr);
    if (!current) {
      pathMap.set(idStr, '');
      return '';
    }
    
    const parts = [];
    const visited = new Set();
    while (current && !visited.has(current._id.toString())) {
      parts.push(current.name);
      visited.add(current._id.toString());
      current = current.parent ? catMap.get(current.parent.toString()) : null;
    }
    const path = parts.reverse().join(' > ');
    pathMap.set(idStr, path);
    return path;
  };

  return getPath;
};

const DIRECT_PURCHASABLE_TEST_TYPES = [
  "test",
  "challenge_yourself",
  "challenge_your_friend",
  "competition_sector",
  "Olympiads",
  "School",
  "Competitive",
  "Skill Development",
  "certificate",
  "competitive",
  "school",
  "skill development",
  "skill",
  "olympiads",
];

const isDirectPurchasableTest = (test) => {
  const applicableFor = (test?.applicableFor || "test").toLowerCase().trim();
  return DIRECT_PURCHASABLE_TEST_TYPES.includes(applicableFor);
};

const getFrontendItemType = (test) => {
  const appFor = (test?.applicableFor || "").toLowerCase().trim();
  if (appFor.startsWith("challenge")) return "challenge";
  if (appFor === "school") return "school";
  if (appFor === "competitive") return "competitive";
  if (appFor === "skill" || appFor === "skill development") return "skill";
  if (appFor === "olympiads") return "olympiad";
  return "test";
};

export const attachPurchasedFlagToTests = async (tests, studentId) => {
  if (!studentId || !tests.length) {
    tests.forEach((t) => (t.purchased = false));
    return tests;
  }
  
  // 1. Direct Test Purchases
  const testIds = tests.map((t) => t._id.toString());
  const purchasedIds = await orderRepository.findPurchasedTestIdsForStudent(
    studentId,
    testIds
  );
  const purchasedSet = new Set(purchasedIds);
  
  // 2. Category Purchases (for tests inside owned folders)
  const categoryPurchases = await orderRepository.findCategoryPurchases(studentId);
  const unlockedCategoryMap = new Map();
  // categoryPurchases is sorted newest first. We only want to keep the newest purchase per category.
  categoryPurchases.forEach(p => {
    if (p.categoryId) {
      const catIdStr = p.categoryId._id?.toString() || p.categoryId.toString();
      if (!unlockedCategoryMap.has(catIdStr)) {
        unlockedCategoryMap.set(catIdStr, p);
      }
    }
    if (p.unlockedCategoryIds && Array.isArray(p.unlockedCategoryIds)) {
      p.unlockedCategoryIds.forEach(cat => {
        const catIdStr = cat._id?.toString() || cat.toString();
        if (!unlockedCategoryMap.has(catIdStr)) {
          unlockedCategoryMap.set(catIdStr, p);
        }
      });
    }
  });

  tests.forEach((t) => {
    let isPurchased = purchasedSet.has(t._id.toString());
    
    // If not bought directly, check if the student owns the parent category
    if (!isPurchased && t.categoryId) {
      const catIdStr = t.categoryId.toString();
      const purchase = unlockedCategoryMap.get(catIdStr);
      
      if (purchase) {
        // Ensure test isn't newly added after their purchase date (unless upgraded)
        const purchaseDate = purchase.lastUpgradedAt || purchase.createdAt;
        if (new Date(t.createdAt) <= new Date(purchaseDate)) {
          isPurchased = true;
        }
      }
    }
    
    t.purchased = isPurchased;
  });
  
  return tests;
};

const attachPurchasedFlagToBundles = async (bundles, studentId) => {
  if (!studentId || !bundles.length) {
    bundles.forEach((b) => (b.purchased = false));
    return bundles;
  }
  const purchases = await orderRepository.findTestPurchases(studentId);
  const purchasedBundleIds = new Set(
    purchases
      .map((p) => p.testBundle?._id?.toString() || p.testBundle?.toString())
      .filter(Boolean)
  );
  bundles.forEach((b) => {
    b.purchased = purchasedBundleIds.has(b._id.toString());
  });
  return bundles;
};

const attachPurchasedFlagToCourses = async (courses, studentId) => {
  if (!studentId || !courses.length) {
    courses.forEach((c) => (c.isPurchased = false));
    return courses;
  }
  const courseIds = courses.map((c) => c._id.toString());
  const purchasedIds = await orderRepository.findPurchasedCourseIdsForStudent(
    studentId,
    courseIds
  );
  const purchasedSet = new Set(purchasedIds);
  courses.forEach((c) => {
    c.isPurchased = purchasedSet.has(c._id.toString());
  });
  return courses;
};

/**
 * Get all published courses (marketplace listing)
 * Filters: type (pdf | video | audio), access (free | paid | both)
 * - free: price === 0, paid: price > 0, both: no filter
 */
export const getCourses = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
    type,
    access,
    isCertification,
    studentId,
  } = options;
 
  const query = { isPublished: true };
  if (typeof isCertification === "boolean") {
    query.isCertification = isCertification;
  }
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query.$or = [{ title: regex }, { description: regex }];
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const result = await courseRepository.findAll(query, {
    page: pageNum,
    limit: limitNum,
    sortBy,
    sortOrder,
    search,
    category,
    type,
    access,
  });

  const coursesRaw = result.courses.map((course) => {
    const courseObj = course.toObject();
    delete courseObj.contentUrl;
    return courseObj;
  });
  const coursesWithOffers = await attachOfferToList(coursesRaw, "Course", "price");
  const courses = await attachPurchasedFlagToCourses(coursesWithOffers, studentId);
  const total = result.pagination.total;

  return {
    courses,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/**
 * Get course by ID with purchase status for student
 */
export const getCourseById = async (courseId, studentId) => {
  const course = await courseRepository.findById(courseId);

  if (!course) throw new ApiError(404, "Course not found");
  if (!course.isPublished) throw new ApiError(404, "Course not found");

  let purchase = null;
  if (studentId) {
    purchase = await orderRepository.findCoursePurchase({
      student: studentId,
      course: courseId,
      paymentStatus: "completed",
    });
  }

  const courseData = await attachOfferToItem(course, "Course", "price");
  courseData.isPurchased = !!purchase;
  if (!courseData.isPurchased) delete courseData.contentUrl;

  if (courseData.isCertification) {
    const links = await courseTestLinkRepository.findAll(
      { course: courseId },
      { sortBy: "order", sortOrder: "asc" }
    );
    const linkedTests = links.map((link) => link.test).filter(Boolean);
    const testIds = linkedTests.map((test) => test._id || test).filter(Boolean);
    const statusMap =
      studentId && testIds.length
        ? await examSessionRepository.getSessionStatusMapByStudent(
            studentId,
            testIds
          )
        : {};
    let completedCount = 0;
    for (const testId of testIds) {
      const testIdStr = testId.toString();
      const testStatusInfo = statusMap[testIdStr];
      if (testStatusInfo?.status === "completed") {
        const testObj = linkedTests.find(t => (t._id || t).toString() === testIdStr);
        if (testObj?.passingPercentage) {
          const score = testStatusInfo.score || 0;
          const maxScore = testStatusInfo.maxScore || 1;
          if ((score / maxScore) * 100 >= testObj.passingPercentage) {
            completedCount++;
          }
        } else {
          completedCount++;
        }
      }
    }

    courseData.modules = (courseData.modules || []).map((module, index) => {
      const testId = module.test?._id || module.test;
      const test = linkedTests.find(
        (item) => (item._id || item)?.toString() === testId?.toString()
      );
      let testStatus = "not_started";
      let sessionId = null;
      if (testId) {
        const testStatusInfo = statusMap[testId.toString()];
        if (testStatusInfo) {
          testStatus = testStatusInfo.status;
          sessionId = testStatusInfo.sessionId || null;
          
          if (testStatus === "completed" && test?.passingPercentage) {
            const score = testStatusInfo.score || 0;
            const maxScore = testStatusInfo.maxScore || 1;
            const currentPercentage = (score / maxScore) * 100;
            if (currentPercentage < test.passingPercentage) {
              testStatus = "failed";
            }
          }
        }
      }

      return {
        ...module,
        order: module.order ?? index,
        test,
        testStatus,
        sessionId,
      };
    });
    courseData.certificationTests = linkedTests.map((test) => {
      const testIdStr = (test._id || test).toString();
      let status = statusMap[testIdStr]?.status || "not_started";
      
      if (status === "completed" && test.passingPercentage) {
        const info = statusMap[testIdStr];
        const currentPercentage = ((info.score || 0) / (info.maxScore || 1)) * 100;
        if (currentPercentage < test.passingPercentage) {
          status = "failed";
        }
      }

      return {
        ...(test.toObject?.() ?? test),
        status,
        sessionId: statusMap[testIdStr]?.sessionId || null,
      };
    });
    courseData.certificationTestCount = testIds.length;
    courseData.completedCertificationTestCount = completedCount;
    courseData.certificateEligible = testIds.length > 0 && completedCount === testIds.length;
    const certificate =
      studentId && courseData.certificateEligible
        ? await Certificate.findOne({
            student: studentId,
            title: `${courseData.title} - Completion`,
          }).select("_id title issuedAt pdfUrl")
        : null;
    courseData.certificate = certificate;
    courseData.certificateIssued = Boolean(certificate);
  }

  return courseData;
};

/**
 * Initiate course purchase. Handles free, wallet, and razorpay (like test/test-bundle).
 * - free: completes purchase immediately if price is 0
 * - wallet: deducts balance and completes purchase immediately
 * - razorpay: creates order, returns order details; purchase completed via purchase API after payment
 * @param {Object} options - { couponCode?: string }
 */
export const initiateCoursePayment = async (courseId, studentId, paymentMethod, options = {}) => {
  const { couponCode } = options;
  const course = await courseRepository.findById(courseId);

  if (!course || !course.isPublished) {
    throw new ApiError(404, "Course not found");
  }

  const existingPurchase = await orderRepository.findCoursePurchase({
    student: studentId,
    course: courseId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Course already purchased");
  }

  const price = Number(course.price) || 0;

  const { amountToCharge, couponId, appliedOffer, appliedCoupon } = await getAmountToCharge("Course", price, couponCode);

  if (paymentMethod === "free") {
    if (amountToCharge > 0) {
      throw new ApiError(400, "This course is paid. Use paymentMethod: wallet or razorpay.");
    }
    const purchase = await orderRepository.createCoursePurchase({
      student: studentId,
      course: courseId,
      purchasePrice: 0,
      paymentId: "free",
      paymentStatus: "completed",
    });
    await logTransaction({
      studentId,
      amount: 0,
      sourceType: "course",
      itemId: courseId,
      itemName: course.title || "Course",
      categoryId: course.categoryIds && course.categoryIds[0] ? course.categoryIds[0] : null,
      paymentId: "free"
    });
    try {
      await pointsService.awardCoursePurchasePoints(studentId, courseId, course.title || "Course");
    } catch (error) {
      console.error("Error awarding points for course purchase:", error);
    }
    (async () => {
      try {
        const student = await studentRepository.findById(studentId);
        if (student) await sendCourseEnrollmentEmail(student.email, student.name, course.title || "Course", amountToCharge, new Date());
      } catch (err) {
        console.error("Error sending course enrollment email:", err);
      }
    })();
    return { purchase, completed: true };
  }

  if (paymentMethod === "wallet") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This course is free. Use paymentMethod: free.");
    }
    await walletService.deductMonetaryBalance(studentId, amountToCharge, "User");
    const purchase = await orderRepository.createCoursePurchase({
      student: studentId,
      course: courseId,
      purchasePrice: amountToCharge,
      paymentId: "wallet",
      paymentStatus: "completed",
    });
    await logTransaction({
      studentId,
      amount: amountToCharge,
      sourceType: "course",
      itemId: courseId,
      itemName: course.title || "Course",
      categoryId: course.categoryIds && course.categoryIds[0] ? course.categoryIds[0] : null,
      paymentId: "wallet"
    });
    if (couponId) {
      await couponService.incrementCouponUsedCount(couponId);
    }
    try {
      await pointsService.awardCoursePurchasePoints(studentId, courseId, course.title || "Course");
    } catch (error) {
      console.error("Error awarding points for course purchase:", error);
    }
    (async () => {
      try {
        const student = await studentRepository.findById(studentId);
        if (student) await sendCourseEnrollmentEmail(student.email, student.name, course.title || "Course", amountToCharge, new Date());
      } catch (err) {
        console.error("Error sending course enrollment email:", err);
      }
    })();
    return { purchase, completed: true };
  }

  if (paymentMethod === "razorpay") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This course is free. Use paymentMethod: free.");
    }
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new ApiError(500, "Payment gateway not configured");
    }
    const receipt = `course_${courseId}_${studentId}_${Date.now()}`.substring(0, 40);
    let order;
    try {
      order = await createRazorpayOrder(amountToCharge, receipt);
    } catch (err) {
      const statusCode = err?.statusCode ?? err?.response?.status;
      const code = err?.error?.code ?? err?.response?.data?.error?.code;
      if (statusCode === 401 || code === "BAD_REQUEST_ERROR") {
        console.error("[Razorpay] Authentication failed:", err?.error ?? err?.message ?? err);
        throw new ApiError(500, "Payment gateway authentication failed.");
      }
      console.error("[Razorpay] Order create error:", err?.error ?? err?.message ?? err);
      throw new ApiError(500, "Payment gateway error. Please try again later.");
    }

    await razorpayOrderIntentRepository.create({
      orderId: order.orderId,
      studentId,
      type: "course",
      entityId: courseId,
      entityModel: "Course",
      amountPaise: order.amount,
      currency: order.currency || "INR",
      receipt,
      couponId: couponId || undefined,
    });

    return {
      completed: false,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKeyId,
      courseId,
      courseTitle: course.title,
      appliedOffer: appliedOffer || undefined,
      appliedCoupon: appliedCoupon || undefined,
      originalPrice: price,
      discountedPrice: amountToCharge,
    };
  }

  throw new ApiError(400, "Invalid paymentMethod. Use: free, wallet, or razorpay.");
};

/** @deprecated Use initiateCoursePayment with paymentMethod: 'razorpay' */
export const createCourseOrder = async (courseId, studentId, options = {}) => {
  const result = await initiateCoursePayment(courseId, studentId, "razorpay", options);
  if (result.completed) return result.purchase;
  return result;
};

/**
 * Purchase course (verify Razorpay payment and complete purchase)
 */
export const purchaseCourse = async (
  courseId,
  studentId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
) => {
  const course = await courseRepository.findById(courseId);

  if (!course || !course.isPublished) {
    throw new ApiError(404, "Course not found");
  }

  const existingPurchase = await orderRepository.findCoursePurchase({
    student: studentId,
    course: courseId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Course already purchased");
  }

  const isValid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    throw new ApiError(400, "Payment verification failed");
  }

  const intent = await razorpayOrderIntentRepository.findByOrderId(razorpayOrderId);
  if (!intent) {
    throw new ApiError(400, "Invalid order or payment already used");
  }
  const studentIdStr = studentId?.toString?.() ?? String(studentId);
  const courseIdStr = courseId?.toString?.() ?? String(courseId);
  if (intent.studentId?.toString?.() !== studentIdStr) {
    throw new ApiError(403, "This payment was made by a different user");
  }
  if (intent.type !== "course" || intent.entityId?.toString?.() !== courseIdStr) {
    throw new ApiError(400, "Payment does not match this course");
  }
  const purchasePrice = intent.amountPaise / 100;

  const purchaseData = await orderRepository.createCoursePurchase({
    student: studentId,
    course: courseId,
    purchasePrice,
    paymentId: razorpayPaymentId,
    paymentStatus: "completed",
  });
  await razorpayOrderIntentRepository.markReconciled(razorpayOrderId, razorpayPaymentId);

  if (intent.couponId) {
    await couponService.incrementCouponUsedCount(intent.couponId);
  }

  await logTransaction({
    studentId,
    amount: purchasePrice,
    sourceType: "course",
    itemId: courseId,
    itemName: course.title || "Course",
    categoryId: course.categoryIds && course.categoryIds[0] ? course.categoryIds[0] : null,
    paymentId: razorpayPaymentId
  });

  try {
    await pointsService.awardCoursePurchasePoints(
      studentId,
      courseId,
      course.title || "Course"
    );
  } catch (error) {
    console.error("Error awarding points for course purchase:", error);
  }

  (async () => {
    try {
      const student = await studentRepository.findById(studentId);
      if (student) await sendCourseEnrollmentEmail(student.email, student.name, course.title || "Course", purchasePrice, new Date());
    } catch (err) {
      console.error("Error sending course enrollment email:", err);
    }
  })();

  return purchaseData;
};

/**
 * Get student's purchased courses (paginated).
 * Filters: search (title/description), contentType (pdf | video | audio)
 */
export const getMyCourses = async (studentId, page = 1, limit = 10, options = {}) => {
  const { search, contentType, isCertification } = options;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  let purchases = await orderRepository.findCoursePurchases(studentId);

  // Filter by isCertification
  if (typeof isCertification === "boolean") {
    purchases = purchases.filter(
      (p) => p.course && Boolean(p.course.isCertification) === isCertification
    );
  }

  // Filter by contentType (pdf, video, audio, image)
  if (contentType && contentType !== 'all') {
    const type = String(contentType).toLowerCase();
    if (["pdf", "video", "audio", "image"].includes(type)) {
      purchases = purchases.filter((p) => {
        if (!p.course) return false;
        const hasContent = p.course.contents?.some(c => String(c.type || "").toLowerCase() === type);
        if (hasContent) return true;
        const hasModuleContent = p.course.modules?.some(m => 
          m.contents?.some(c => String(c.type || "").toLowerCase() === type)
        );
        return hasModuleContent;
      });
    }
  }

  // Filter by search (title, description)
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    purchases = purchases.filter((p) => {
      if (!p.course) return false;
      const title = (p.course.title || "").toLowerCase();
      const desc = (p.course.description || "").toLowerCase();
      return title.includes(term) || desc.includes(term);
    });
  }

  const total = purchases.length;
  const paginatedPurchases = purchases.slice(skip, skip + limitNum);

  return {
    purchases: paginatedPurchases,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/**
 * Get paginated free materials (integrated into my-courses flow).
 */
export const getPaginatedFreeMaterials = async (page = 1, limit = 10, options = {}) => {
  const { categoryId, subCategoryId, search, contentType } = options;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const query = {};
  if (categoryId && categoryId !== 'null' && categoryId !== 'undefined') {
    query.category = categoryId;
  }
  if (subCategoryId && subCategoryId !== 'null' && subCategoryId !== 'undefined') {
    const subCatIds = subCategoryId.split(',').map(id => id.trim()).filter(Boolean);
    if (subCatIds.length > 1) {
      query.subCategory = { $in: subCatIds };
    } else if (subCatIds.length === 1) {
      query.subCategory = subCatIds[0];
    }
  }
  
  if (contentType && contentType !== 'all') {
    query.fileType = String(contentType).toLowerCase();
  }

  if (search && search.trim()) {
    const regex = { $regex: search, $options: "i" };
    query.title = regex;
  }

  const materials = await FreeMaterial.find(query)
    .populate("category subCategory", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await FreeMaterial.countDocuments(query);

  const formattedItems = materials.map((m) => {
    const filename = decodeURIComponent(m.fileUrl || '').split('/').pop() || 'Download File';
    const title = m.title || filename;
    
    let categoryString = 'Free Material';
    if (m.category?.name) {
      categoryString = m.category.name;
      if (m.subCategory?.name) {
        categoryString += ` › ${m.subCategory.name}`;
      }
    }

    return {
      _id: m._id,
      course: {
         _id: m._id,
         title: categoryString,
         description: 'Free Material',
         price: 0,
         contentType: m.fileType,
         contents: [
            {
               originalName: title,
               type: m.fileType,
               url: m.fileUrl
            }
         ],
         imageUrl: null,
      }
    };
  });

  return {
    purchases: formattedItems,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/**
 * Get subcategories for a given pillar name (used for lazy-loading the Free Material filter tabs).
 * Queries by rootType field (e.g. "School", "Olympiads") so it is fast and index-backed.
 */
export const getSubcategoriesByPillarName = async (pillarName) => {
  if (!pillarName) return [];

  // The 4 valid rootType values stored in the Category model
  const VALID_ROOT_TYPES = ['School', 'Competitive', 'Olympiads', 'Skill Development'];

  // Case-insensitive match against the rootType enum
  const normalizedName = VALID_ROOT_TYPES.find(
    (rt) => rt.toLowerCase() === String(pillarName).toLowerCase()
  );
  if (!normalizedName) return [];

  // Find the pillar (parent) category by rootType
  const pillar = await Category.findOne({
    rootType: normalizedName,
    parent: null,       // top-level pillar has no parent
    isActive: true,
  }).select('_id name rootType').lean();

  if (!pillar) return [];

  // Fetch its direct children (subcategories) sorted by order then name
  const subcategories = await Category.find({
    parent: pillar._id,
    isActive: true,
  })
    .select('_id name')
    .sort({ order: 1, name: 1 })
    .lean();

  return subcategories;
};

/**
 * Get course content for viewing/download (requires purchase).
 * Returns contentUrl and contentType for video, audio, or PDF.
 */
export const getCourseContentForDownload = async (courseId, studentId) => {
  const purchase = await orderRepository.findCoursePurchase({
    student: studentId,
    course: courseId,
    paymentStatus: "completed",
  });
  if (!purchase) {
    throw new ApiError(403, "You must purchase this course to access content");
  }

  const course = await courseRepository.findById(courseId);
  if (!course || !course.isPublished) {
    throw new ApiError(404, "Course not found");
  }
  if (!course.contentUrl) {
    throw new ApiError(404, "Course content is not available");
  }

  return {
    contentUrl: course.contentUrl,
    contentType: course.contentType || "pdf",
    title: course.title,
  };
};

/**
 * Get follow-up tests for a course (requires purchase)
 */
export const getCourseFollowUpTests = async (courseId, studentId) => {
  const purchase = await orderRepository.findCoursePurchase({
    student: studentId,
    course: courseId,
    paymentStatus: "completed",
  });

  if (!purchase) {
    throw new ApiError(
      403,
      "You must purchase this course to access follow-up tests"
    );
  }

  return await courseTestLinkRepository.findAll(
    { course: courseId },
    { sortBy: "order", sortOrder: "asc" }
  );
};

/**
 * Get tests and/or test bundles in one API (student marketplace).
 * type: "test" | "testBundle" | "both" — filter to tests only, bundles only, or both (default: both)
 */
export const getTestsAndBundles = async (options = {}) => {
  const {
    type = "both",
    page = 1,
    limit = 10,
    search,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
    questionBank,
    studentId,
    isLandingPage,
    applicableFor,
  } = options;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (type === "test") {
    const defaultTestApplicableFor = isLandingPage ? ["test", "trending_test"] : ["test"];
    const finalApplicableFor = applicableFor ? applicableFor : defaultTestApplicableFor;
    const result = await getTests({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      applicableFor: finalApplicableFor,
      studentId,
    });
    return {
      items: result.tests.map((t) => ({
        ...toTestItem(t),
        itemType: getFrontendItemType(t),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "challenges") {
    const result = await getTests({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      applicableFor: ["challenge_yourself", "challenge_your_friend"],
      studentId,
    });
    return {
      items: result.tests.map((t) => ({
        ...toTestItem(t),
        itemType: getFrontendItemType(t),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "school") {
    const result = await getTests({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      applicableFor: ["school", "School"],
      studentId,
    });
    return {
      items: result.tests.map((t) => ({
        ...toTestItem(t),
        itemType: getFrontendItemType(t),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "competitive") {
    const result = await getTests({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      applicableFor: ["competitive", "Competitive"],
      studentId,
    });
    return {
      items: result.tests.map((t) => ({
        ...toTestItem(t),
        itemType: getFrontendItemType(t),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "skill") {
    const result = await getTests({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      applicableFor: ["skill", "skill development", "Skill Development"],
      studentId,
    });
    return {
      items: result.tests.map((t) => ({
        ...toTestItem(t),
        itemType: getFrontendItemType(t),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "testBundle") {
    const result = await getTestBundles({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      sortBy,
      sortOrder,
      studentId,
    });
    return {
      items: result.bundles.map((b) => ({
        ...toBundleItem(b),
        itemType: "testBundle",
      })),
      pagination: result.pagination,
    };
  }

  if (type === "olympiad") {
    const result = await getOlympiads({
      page: pageNum,
      limit: limitNum,
      search,
      categoryId: category,
      studentId,
    });
    return {
      items: result.olympiads.map((o) => ({
        ...toOlympiadItem(o),
      })),
      pagination: result.pagination,
    };
  }

  if (type === "tournament") {
    const result = await getTournaments({
      page: pageNum,
      limit: limitNum,
      search,
      category,
      isPublished: true,
      studentId,
    });
    return {
      items: result.tournaments.map((t) => ({
        ...toTournamentItem(t),
      })),
      pagination: result.pagination,
    };
  }

  // type === "both" or "all" — single merged list + one pagination
  const fetchSize = pageNum * limitNum;
  const baseTestTypes = DIRECT_PURCHASABLE_TEST_TYPES.filter(
    (type) => !["certificate", "Olympiads", "olympiads", "tournament", "tournaments"].includes(type)
  );
  if (isLandingPage) {
    baseTestTypes.push("trending_test");
  }
  
  const finalApplicableFor = applicableFor ? applicableFor : baseTestTypes;

  const [testsResult, bundlesResult] = await Promise.all([
    getTests({
      page: 1,
      limit: fetchSize,
      search,
      category,
      questionBank,
      sortBy,
      sortOrder,
      studentId,
      applicableFor: finalApplicableFor,
    }),
    getTestBundles({
      page: 1,
      limit: fetchSize,
      search,
      category,
      sortBy,
      sortOrder,
      studentId,
    }),
  ]);

  const testsTotal = testsResult.pagination.total;
  const bundlesTotal = bundlesResult.pagination.total;
  const total = testsTotal + bundlesTotal;
  const sortDesc = sortOrder === "desc";

  const testItems = testsResult.tests.map((t) => ({
    ...toTestItem(t),
    itemType: getFrontendItemType(t),
  }));
  const bundleItems = bundlesResult.bundles.map((b) => ({
    ...toBundleItem(b),
    itemType: "testBundle",
  }));

  const merged = [...testItems, ...bundleItems].sort((a, b) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return sortDesc ? dateB - dateA : dateA - dateB;
  });

  const start = (pageNum - 1) * limitNum;
  const items = merged.slice(start, start + limitNum);

  return {
    items,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

const toTestItem = (test) => {
  const obj = test?.toObject ? test.toObject() : { ...test };
  delete obj.questions;
  delete obj.randomConfig;
  return obj;
};

const toBundleItem = (bundle) => {
  return bundle?.toObject ? bundle.toObject() : { ...bundle };
};

const toOlympiadItem = (olympiad) => {
  const obj = olympiad?.toObject ? olympiad.toObject() : { ...olympiad };
  return {
    ...obj,
    itemType: "olympiad",
    purchased: Boolean(obj.isRegistered),
  };
};

const toTournamentItem = (tournament) => {
  const obj = tournament?.toObject ? tournament.toObject() : { ...tournament };
  return {
    ...obj,
    itemType: "tournament",
    // purchased field will be added by attachPurchasedFlagToTournaments if we want
  };
};

/**
 * Get all published tests (marketplace listing)
 */
export const getTests = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    questionBank,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
    applicableFor,
    studentId,
  } = options;

  const query = { isPublished: true };
  if (applicableFor) {
    query.applicableFor = Array.isArray(applicableFor)
      ? { $in: applicableFor }
      : applicableFor;
  } else {
    query.applicableFor = { $in: DIRECT_PURCHASABLE_TEST_TYPES };
  }

  if (questionBank) query.questionBank = questionBank;
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query.$or = [
      { title: regex },
      { description: regex },
      { applicableFor: regex },
    ];
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const result = await testRepository.findAllTests(query, {
    page: pageNum,
    limit: limitNum,
    sortBy,
    sortOrder,
    search,
    questionBank,
    category,
    isPublished: true,
  });

  const getPath = await buildCategoryPathsMap();

  const testsRaw = result.tests.map((test) => {
    const testObj = test.toObject();
    delete testObj.questions;
    delete testObj.randomConfig;

    let catId = testObj.categoryId;
    if (!catId && testObj.questionBank?.categories?.length > 0) {
      catId = testObj.questionBank.categories[0]._id || testObj.questionBank.categories[0];
    }
    if (!catId && testObj.aiQuestionBank?.categories?.length > 0) {
      catId =
        testObj.aiQuestionBank.categories[0]._id ||
        testObj.aiQuestionBank.categories[0];
    }
    if (catId) {
      testObj.categoryPath = getPath(catId);
    }

    return testObj;
  });

  const tests = await Promise.all(
    testsRaw.map(async (test) => {
      const moduleTypeForOffer = test.applicableFor && test.applicableFor !== "test" 
        ? test.applicableFor 
        : "Test";
      return await attachOfferToItem(test, moduleTypeForOffer, "price");
    })
  );
  await attachPurchasedFlagToTests(tests, studentId);

  const total = result.pagination.total;

  return {
    tests,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/**
 * Initiate test purchase. Handles free, wallet, and razorpay (like tournament/workshop).
 * - free: completes purchase immediately if price is 0
 * - wallet: deducts balance and completes purchase immediately
 * - razorpay: creates order, returns order details; purchase completed via purchase API after payment
 * @param {Object} options - { couponCode?: string }
 */
export const initiateTestPayment = async (testId, studentId, paymentMethod, options = {}) => {
  const { couponCode } = options;
  const test = await testRepository.findTestById(testId);

  if (!test || !test.isPublished) {
    throw new ApiError(404, "Test not found");
  }
  console.log("DEBUG_TEST_APPFOR:", test.applicableFor, test._id, test.title);
  if (!isDirectPurchasableTest(test)) {
    throw new ApiError(400, `This test is not available for direct purchase. Its applicableFor is: ${test.applicableFor}`);
  }

  const existingPurchase = await orderRepository.findTestPurchase({
    student: studentId,
    test: testId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Test already purchased");
  }

  const price = Number(test.price) || 0;

  const shouldApplyOfferAndCoupon = test.applicableFor !== "challenge_yourself";
  
  const moduleTypeForOffer = test.applicableFor && test.applicableFor !== "test" 
    ? test.applicableFor 
    : "Test";

  const {
    amountToCharge,
    couponId,
    appliedOffer,
    appliedCoupon,
  } = shouldApplyOfferAndCoupon
    ? await getAmountToCharge(moduleTypeForOffer, price, couponCode)
    : {
        amountToCharge: price,
        couponId: null,
        appliedOffer: null,
        appliedCoupon: null,
      };

  if (paymentMethod === "free") {
    if (amountToCharge > 0) {
      throw new ApiError(400, "This test is paid. Use paymentMethod: wallet or razorpay.");
    }
    const purchase = await orderRepository.createTestPurchase({
      student: studentId,
      test: testId,
      purchasePrice: 0,
      paymentId: "free",
      paymentStatus: "completed",
    });
    // Award reward points for purchase if configured on test
    if (test.rewardPoints > 0) {
      await pointsService.awardTestPurchasePoints(studentId, testId, test.title, test.rewardPoints);
    }
    const freeCategoryId = await resolveTestCategoryId(test);
    await logTransaction({
      studentId,
      amount: 0,
      sourceType: resolveTestSourceType(test),
      itemId: testId,
      itemName: test.title || "Test",
      categoryId: freeCategoryId,
      paymentId: "free"
    });
    return { purchase, completed: true };
  }

  if (paymentMethod === "wallet") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This test is free. Use paymentMethod: free.");
    }
    await walletService.deductMonetaryBalance(studentId, amountToCharge, "User");
    const purchase = await orderRepository.createTestPurchase({
      student: studentId,
      test: testId,
      purchasePrice: amountToCharge,
      paymentId: "wallet",
      paymentStatus: "completed",
    });
    // Award reward points for purchase if configured on test
    if (test.rewardPoints > 0) {
      await pointsService.awardTestPurchasePoints(studentId, testId, test.title, test.rewardPoints);
    }
    if (couponId) {
      await couponService.incrementCouponUsedCount(couponId);
    }
    const walletCategoryId = await resolveTestCategoryId(test);
    await logTransaction({
      studentId,
      amount: amountToCharge,
      sourceType: resolveTestSourceType(test),
      itemId: testId,
      itemName: test.title || "Test",
      categoryId: walletCategoryId,
      paymentId: "wallet"
    });
    return { purchase, completed: true };
  }

  if (paymentMethod === "razorpay") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This test is free. Use paymentMethod: free.");
    }
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new ApiError(500, "Payment gateway not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
    }
    const receipt = `test_${testId}_${studentId}_${Date.now()}`.substring(0, 40);
    let order;
    try {
      order = await createRazorpayOrder(amountToCharge, receipt);
    } catch (err) {
      const statusCode = err?.statusCode ?? err?.response?.status;
      const code = err?.error?.code ?? err?.response?.data?.error?.code;
      if (statusCode === 401 || code === "BAD_REQUEST_ERROR") {
        console.error("[Razorpay] Authentication failed:", err?.error ?? err?.message ?? err);
        throw new ApiError(500, "Payment gateway authentication failed. Please check Razorpay credentials.");
      }
      console.error("[Razorpay] Order create error:", err?.error ?? err?.message ?? err);
      throw new ApiError(500, "Payment gateway error. Please try again later.");
    }

    await razorpayOrderIntentRepository.create({
      orderId: order.orderId,
      studentId,
      type: "test",
      entityId: testId,
      entityModel: "Test",
      amountPaise: order.amount,
      currency: order.currency || "INR",
      receipt,
      couponId: couponId || undefined,
    });

    return {
      completed: false,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKeyId,
      testId,
      testTitle: test.title,
      appliedOffer: appliedOffer || undefined,
      appliedCoupon: appliedCoupon || undefined,
      originalPrice: price,
      discountedPrice: amountToCharge,
    };
  }

  throw new ApiError(400, "Invalid paymentMethod. Use: free, wallet, or razorpay.");
};

/** @deprecated Use initiateTestPayment with paymentMethod: 'razorpay' */
export const createTestOrder = async (testId, studentId) => {
  const result = await initiateTestPayment(testId, studentId, "razorpay");
  if (result.completed) return result.purchase;
  return result;
};

/**
 * Get test by ID with full details (no payment check)
 */
export const getTestById = async (testId) => {
  const test = await testRepository.findTestById(testId, {
    questionBank: "name categories",
  });

  if (!test) throw new ApiError(404, "Test not found");
  if (!test.isPublished) throw new ApiError(404, "Test not found");
  if (!isDirectPurchasableTest(test)) {
    throw new ApiError(404, "Test not found");
  }

  const moduleTypeForOffer = test.applicableFor && test.applicableFor !== "test" 
    ? test.applicableFor 
    : "Test";
  const testData = await attachOfferToItem(test, moduleTypeForOffer, "price");
  delete testData.questions;
  delete testData.randomConfig;

  const getPath = await buildCategoryPathsMap();
  let catId = testData.categoryId;
  if (!catId && testData.questionBank?.categories?.length > 0) {
    catId = testData.questionBank.categories[0]._id || testData.questionBank.categories[0];
  }
  if (!catId && testData.aiQuestionBank?.categories?.length > 0) {
    catId =
      testData.aiQuestionBank.categories[0]._id ||
      testData.aiQuestionBank.categories[0];
  }
  if (catId) {
    testData.categoryPath = getPath(catId);
  }

  return testData;
};

/**
 * Purchase test (verify Razorpay payment and complete purchase)
 * Called only after initiateTestPayment with paymentMethod: razorpay and user completed Razorpay checkout
 */
export const purchaseTest = async (
  testId,
  studentId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
) => {
  const test = await testRepository.findTestById(testId);

  if (!test || !test.isPublished) {
    throw new ApiError(404, "Test not found");
  }
  if (!isDirectPurchasableTest(test)) {
    throw new ApiError(400, `This test is not available for direct purchase. Its applicableFor is: ${test.applicableFor}`);
  }

  const existingPurchase = await orderRepository.findTestPurchase({
    student: studentId,
    test: testId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Test already purchased");
  }

  const isValid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    throw new ApiError(400, "Payment verification failed");
  }

  const intent = await razorpayOrderIntentRepository.findByOrderId(razorpayOrderId);
  if (!intent) {
    throw new ApiError(400, "Invalid order or payment already used");
  }
  const studentIdStr = studentId?.toString?.() ?? String(studentId);
  const testIdStr = testId?.toString?.() ?? String(testId);
  if (intent.studentId?.toString?.() !== studentIdStr) {
    throw new ApiError(403, "This payment was made by a different user");
  }
  if (intent.type !== "test" || intent.entityId?.toString?.() !== testIdStr) {
    throw new ApiError(400, "Payment does not match this test");
  }
  // Intent amount may be discounted (offer applied)
  const purchasePrice = intent.amountPaise / 100;

  const purchase = await orderRepository.createTestPurchase({
    student: studentId,
    test: testId,
    purchasePrice,
    paymentId: razorpayPaymentId,
    paymentStatus: "completed",
  });
  // Award reward points for purchase if configured on test
  if (test.rewardPoints > 0) {
    await pointsService.awardTestPurchasePoints(studentId, testId, test.title, test.rewardPoints);
  }
  await razorpayOrderIntentRepository.markReconciled(razorpayOrderId, razorpayPaymentId);
  if (intent.couponId) {
    await couponService.incrementCouponUsedCount(intent.couponId);
  }
  const razorpayCategoryId = await resolveTestCategoryId(test);
  await logTransaction({
    studentId,
    amount: purchasePrice,
    sourceType: "test",
    itemId: testId,
    itemName: test.title || "Test",
    categoryId: razorpayCategoryId,
    paymentId: razorpayPaymentId
  });
  return purchase;
};

/**
 * Get all published test bundles (marketplace listing)
 */
export const getTestBundles = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
    studentId,
  } = options;

  const query = { isActive: true };
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query.$or = [{ name: regex }, { description: regex }];
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const result = await testRepository.findAllBundles(query, {
    page: pageNum,
    limit: limitNum,
    sortBy,
    sortOrder,
    search,
    category,
    isActive: true,
  });

  const getPath = await buildCategoryPathsMap();
  const bundlesRaw = result.bundles.map((b) => {
    const bundleObj = b.toObject ? b.toObject() : b;
    let catId = bundleObj.category;
    if (catId) {
      bundleObj.categoryPath = getPath(catId);
    } else if (bundleObj.tests?.length > 0) {
      const firstTest = bundleObj.tests[0];
      const testCatId = firstTest?.categoryId || (firstTest?.questionBank?.categories?.[0]?._id || firstTest?.questionBank?.categories?.[0]);
      if (testCatId) {
        bundleObj.categoryPath = getPath(testCatId);
      }
    }
    return bundleObj;
  });
  const bundles = await attachOfferToList(bundlesRaw, "TestSeries", "price");
  await attachPurchasedFlagToBundles(bundles, studentId);

  return {
    bundles,
    pagination: result.pagination,
  };
};

/**
 * Initiate test bundle purchase. Handles free, wallet, and razorpay (like tournament/workshop).
 * @param {Object} options - { couponCode?: string }
 */
export const initiateTestBundlePayment = async (bundleId, studentId, paymentMethod, options = {}) => {
  const { couponCode } = options;
  const bundle = await testRepository.findBundleById(bundleId, {
    tests: "title durationMinutes questionBank",
  });

  if (!bundle || !bundle.isActive) {
    throw new ApiError(404, "Test bundle not found");
  }

  const existingPurchase = await orderRepository.findTestPurchase({
    student: studentId,
    testBundle: bundleId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Test bundle already purchased");
  }

  const price = Number(bundle.price) || 0;

  const { amountToCharge, couponId, appliedOffer, appliedCoupon } = await getAmountToCharge("TestSeries", price, couponCode);

  if (paymentMethod === "free") {
    if (amountToCharge > 0) {
      throw new ApiError(400, "This test bundle is paid. Use paymentMethod: wallet or razorpay.");
    }
    const purchase = await orderRepository.createTestPurchase({
      student: studentId,
      testBundle: bundleId,
      purchasePrice: 0,
      paymentId: "free",
      paymentStatus: "completed",
    });

    await logTransaction({
      studentId,
      amount: 0,
      sourceType: "test_bundle",
      itemId: bundleId,
      itemName: bundle.name || "Test Bundle",
      categoryId: null,
      paymentId: "free"
    });

    (async () => {
      try {
        const student = await studentRepository.findById(studentId);
        if (student) await sendTestBundlePurchaseEmail(student.email, student.name, bundle.name || "Bundle", amountToCharge, new Date());
      } catch (err) {
        console.error("Error sending test bundle purchase email:", err);
      }
    })();
    return { purchase, completed: true };
  }

  if (paymentMethod === "wallet") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This test bundle is free. Use paymentMethod: free.");
    }
    await walletService.deductMonetaryBalance(studentId, amountToCharge, "User");
    const purchase = await orderRepository.createTestPurchase({
      student: studentId,
      testBundle: bundleId,
      purchasePrice: amountToCharge,
      paymentId: "wallet",
      paymentStatus: "completed",
    });
    if (couponId) {
      await couponService.incrementCouponUsedCount(couponId);
    }

    await logTransaction({
      studentId,
      amount: amountToCharge,
      sourceType: "test_bundle",
      itemId: bundleId,
      itemName: bundle.name || "Test Bundle",
      categoryId: null,
      paymentId: "wallet"
    });

    (async () => {
      try {
        const student = await studentRepository.findById(studentId);
        if (student) await sendTestBundlePurchaseEmail(student.email, student.name, bundle.name || "Bundle", amountToCharge, new Date());
      } catch (err) {
        console.error("Error sending test bundle purchase email:", err);
      }
    })();
    return { purchase, completed: true };
  }

  if (paymentMethod === "razorpay") {
    if (amountToCharge < 1) {
      throw new ApiError(400, "This test bundle is free. Use paymentMethod: free.");
    }
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new ApiError(500, "Payment gateway not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
    }
    const receipt = `bundle_${bundleId}_${studentId}_${Date.now()}`.substring(0, 40);
    let order;
    try {
      order = await createRazorpayOrder(amountToCharge, receipt);
    } catch (err) {
      const statusCode = err?.statusCode ?? err?.response?.status;
      const code = err?.error?.code ?? err?.response?.data?.error?.code;
      if (statusCode === 401 || code === "BAD_REQUEST_ERROR") {
        console.error("[Razorpay] Authentication failed:", err?.error ?? err?.message ?? err);
        throw new ApiError(500, "Payment gateway authentication failed. Please check Razorpay credentials.");
      }
      console.error("[Razorpay] Order create error:", err?.error ?? err?.message ?? err);
      throw new ApiError(500, "Payment gateway error. Please try again later.");
    }

    await razorpayOrderIntentRepository.create({
      orderId: order.orderId,
      studentId,
      type: "bundle",
      entityId: bundleId,
      entityModel: "TestBundle",
      amountPaise: order.amount,
      currency: order.currency || "INR",
      receipt,
      couponId: couponId || undefined,
    });

    return {
      completed: false,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKeyId,
      bundleId,
      bundleName: bundle.name,
      appliedOffer: appliedOffer || undefined,
      appliedCoupon: appliedCoupon || undefined,
      originalPrice: price,
      discountedPrice: amountToCharge,
    };
  }

  throw new ApiError(400, "Invalid paymentMethod. Use: free, wallet, or razorpay.");
};

/** @deprecated Use initiateTestBundlePayment with paymentMethod: 'razorpay' */
export const createTestBundleOrder = async (bundleId, studentId) => {
  const result = await initiateTestBundlePayment(bundleId, studentId, "razorpay");
  if (result.completed) return result.purchase;
  return result;
};

/**
 * Purchase test bundle (verify Razorpay payment and complete purchase)
 * Called only after initiateTestBundlePayment with paymentMethod: razorpay
 */
export const purchaseTestBundle = async (
  bundleId,
  studentId,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
) => {
  const bundle = await testRepository.findBundleById(bundleId, {
    tests: "title durationMinutes questionBank",
  });

  if (!bundle || !bundle.isActive) {
    throw new ApiError(404, "Test bundle not found");
  }

  const existingPurchase = await orderRepository.findTestPurchase({
    student: studentId,
    testBundle: bundleId,
    paymentStatus: "completed",
  });
  if (existingPurchase) {
    throw new ApiError(400, "Test bundle already purchased");
  }

  const isValid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isValid) {
    throw new ApiError(400, "Payment verification failed");
  }

  const intent = await razorpayOrderIntentRepository.findByOrderId(razorpayOrderId);
  if (!intent) {
    throw new ApiError(400, "Invalid order or payment already used");
  }
  const studentIdStr = studentId?.toString?.() ?? String(studentId);
  const bundleIdStr = bundleId?.toString?.() ?? String(bundleId);
  if (intent.studentId?.toString?.() !== studentIdStr) {
    throw new ApiError(403, "This payment was made by a different user");
  }
  if (intent.type !== "bundle" || intent.entityId?.toString?.() !== bundleIdStr) {
    throw new ApiError(400, "Payment does not match this test bundle");
  }
  // Intent amount may be discounted (offer applied)
  const purchasePrice = intent.amountPaise / 100;

  const purchase = await orderRepository.createTestPurchase({
    student: studentId,
    testBundle: bundleId,
    purchasePrice,
    paymentId: razorpayPaymentId,
    paymentStatus: "completed",
  });
  await razorpayOrderIntentRepository.markReconciled(razorpayOrderId, razorpayPaymentId);
  if (intent.couponId) {
    await couponService.incrementCouponUsedCount(intent.couponId);
  }

  await logTransaction({
    studentId,
    amount: purchasePrice,
    sourceType: "test_bundle",
    itemId: bundleId,
    itemName: bundle.name || "Test Bundle",
    categoryId: null,
    paymentId: razorpayPaymentId
  });

  (async () => {
    try {
      const student = await studentRepository.findById(studentId);
      if (student) await sendTestBundlePurchaseEmail(student.email, student.name, bundle.name || "Bundle", purchasePrice, new Date());
    } catch (err) {
      console.error("Error sending test bundle purchase email:", err);
    }
  })();
  return purchase;
};

/**
 * Get student's purchased tests (paginated)
 */
export const getMyTests = async (studentId, page = 1, limit = 10) => {
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const purchases = await orderRepository.findTestPurchases(studentId);
  const total = purchases.length;
  const paginatedPurchases = purchases.slice(skip, skip + limitNum);

  return {
    purchases: paginatedPurchases,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

/**
 * Check if categories array contains the given categoryId
 */
const hasCategory = (categories, categoryId) => {
  if (!categories || !Array.isArray(categories) || !categoryId) return false;
  const idStr = categoryId.toString();
  return categories.some((c) => (c?._id ?? c)?.toString?.() === idStr);
};


const tournamentStagesPopulate = [
  {
    path: "stages.test",
    select: "title description durationMinutes questionBank",
    populate: { path: "questionBank", select: "name categories" },
  },
];

/**
 * Get exam hall - purchased tests, test bundles, and (when live) tournaments the student joined.
 * Tournament tests appear only when event startTime <= now <= endTime (or stage window for tournaments).
 * @param {string} type - "test" | "testBundle" | "tournament" | "both" (test+bundle) | "all" (default: all)
 * @param {string} category - Filter by category ID (questionBank categories for tests / tournament)
 */
export const getExamHall = async (studentId, page = 1, limit = 20, type = "all", category = null, search = null) => {
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;
  const now = new Date();
  const nowMs = now.getTime();
  const getPath = await buildCategoryPathsMap();
  
  // Resolve category descendants for hierarchical filtering
  let descendantCategoryIds = null;
  if (category && category !== "All" && category !== "all") {
    descendantCategoryIds = await categoryRepository.findDescendantIds(category);
  }

  /** Include in exam hall whenever event is live: startTime <= now <= endTime. */
  const isWithinEventWindow = (startTime, endTime) => {
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
    return nowMs >= startMs && nowMs <= endMs;
  };

  // 1. Fetch Test & Bundle Purchases
  const purchases = await orderRepository.findTestPurchasesForExamHall(studentId);
  const purchaseTestIds = [];
  purchases.forEach((p) => {
    if (p.test) purchaseTestIds.push(p.test._id);
    else if (p.testBundle?.tests?.length)
      p.testBundle.tests.forEach((t) => t?._id && purchaseTestIds.push(t._id));
  });

  const statusMap = await examSessionRepository.getSessionStatusMapByStudent(studentId, purchaseTestIds);
  const getTestStatus = (testId) => statusMap[testId?.toString?.() ?? ""]?.status ?? "not_started";
  const getSessionId = (testId) => statusMap[testId?.toString?.() ?? ""]?.sessionId ?? null;

  const purchaseItems = purchases
    .filter((p) => p.test || p.testBundle)
    .map((p) => {
      const base = { _id: p._id, purchaseDate: p.purchaseDate, purchasePrice: p.purchasePrice };
      if (p.test) {
        const testObj = p.test?.toObject ? p.test.toObject() : { ...p.test };
        const catId =
          testObj.questionBank?.categories?.[0] ||
          testObj.aiQuestionBank?.categories?.[0] ||
          testObj.categoryId;
        const categoryPath = getPath(catId) || "";
        const appFor = testObj.applicableFor || "Test";
        const itemType = getFrontendItemType({ ...testObj, applicableFor: appFor });
        
        return {
          ...base,
          type: "test",
          test: {
            ...testObj,
            itemType,
            applicableFor: appFor,
            categoryPath,
          },
          testId: testObj._id,
          testStatus: getTestStatus(testObj._id),
          sessionId: getSessionId(testObj._id),
        };
      }
      const bundleTests = (p.testBundle?.tests || []).map((t) => {
        const testObj = t?.toObject ? t.toObject() : { ...t };
        const catId =
          testObj.questionBank?.categories?.[0] ||
          testObj.aiQuestionBank?.categories?.[0] ||
          testObj.categoryId;
        const categoryPath = getPath(catId) || "";
        const appFor = testObj.applicableFor || "Test";
        const itemType = getFrontendItemType({ ...testObj, applicableFor: appFor });

        return {
          ...testObj,
          itemType,
          applicableFor: appFor,
          categoryPath,
          testStatus: getTestStatus(testObj._id),
          sessionId: getSessionId(testObj._id),
        };
      });
      return {
        ...base,
        type: "testBundle",
        testBundle: p.testBundle,
        bundleId: p.testBundle._id,
        tests: bundleTests,
      };
    });

  // 2. Fetch Tournament & Olympiad Registrations
  const eventRegs = await eventRegistrationRepository.find(
    { student: studentId, eventType: { $in: ["tournament", "olympiad"] }, paymentStatus: "completed" },
    { limit: 500 }
  );
  
  const tournamentIds = [...new Set(eventRegs.filter((r) => r.eventType === "tournament").map((r) => r.eventId).filter(Boolean))];
  const olympiadIds = [...new Set(eventRegs.filter((r) => r.eventType === "olympiad").map((r) => r.eventId).filter(Boolean))];

  const eventTestIds = [];
  const tournamentItems = [];
  if (tournamentIds.length > 0) {
    const tournaments = await tournamentRepository.find(
      { _id: { $in: tournamentIds }, isPublished: true },
      { populate: tournamentStagesPopulate, limit: 500 }
    );
    for (const t of tournaments) {
      const stages = t.stages || [];
      const liveStages = stages
        .filter((s) => s.test && s.startTime && s.endTime)
        .filter((s) => isWithinEventWindow(s.startTime, s.endTime))
        .map((s) => {
          eventTestIds.push(s.test._id);
          const testObj = s.test?.toObject ? s.test.toObject() : { ...s.test };
          const isPurchased = !!testObj.purchased;
          const catId = testObj.questionBank?.categories?.[0];
          return {
            ...(s.toObject ? s.toObject() : { ...s }),
            test: {
              ...testObj,
              itemType: "tournament",
              applicableFor: "Tournament",
              categoryPath: getPath(catId) || "",
            },
            testId: testObj._id,
          };
        });
      if (liveStages.length > 0) {
        tournamentItems.push({
          _id: t._id,
          type: "tournament",
          tournamentId: t._id,
          tournamentTitle: t.title,
          stages: liveStages,
          createdAt: t.createdAt
        });
      }
    }
  }

  const olympiadItems = [];
  if (olympiadIds.length > 0) {
    const olympiads = await OlympiadTest.find({ _id: { $in: olympiadIds } })
      .populate({
        path: "testId",
        select: "title description durationMinutes imageUrl questionBank applicableFor",
        populate: { path: "questionBank", select: "name categories" }
      })
      .lean();
    
    for (const o of olympiads) {
      if (!o.testId) continue;
      if (o.startTime && o.endTime && !isWithinEventWindow(o.startTime, o.endTime)) continue;
      
      const testObj = o.testId;
      const catId = testObj.questionBank?.categories?.[0];
      eventTestIds.push(testObj._id);
      olympiadItems.push({
        _id: o._id,
        type: "olympiad",
        olympiadId: o._id,
        olympiadTitle: o.title,
        test: {
          ...testObj,
          itemType: "olympiad",
          applicableFor: "Olympiad",
          categoryPath: getPath(catId) || "",
        },
        testId: testObj._id,
        createdAt: o.createdAt
      });
    }
  }

  const eventStatusMap =
    eventTestIds.length > 0
      ? await examSessionRepository.getSessionStatusMapByStudent(studentId, [...new Set(eventTestIds)])
      : {};
  const getEventTestStatus = (id) => eventStatusMap[id?.toString?.() ?? ""]?.status ?? "not_started";
  const getEventSessionId = (id) => eventStatusMap[id?.toString?.() ?? ""]?.sessionId ?? null;

  tournamentItems.forEach((item) => {
    (item.stages || []).forEach((st) => {
      st.testStatus = getEventTestStatus(st.testId);
      st.sessionId = getEventSessionId(st.testId);
      if (st.test) {
        st.test = { ...st.test, testStatus: st.testStatus, sessionId: st.sessionId };
      }
    });
  });

  olympiadItems.forEach((item) => {
    item.testStatus = getEventTestStatus(item.testId);
    item.sessionId = getEventSessionId(item.testId);
    if (item.test) {
      item.test = { ...item.test, testStatus: item.testStatus, sessionId: item.sessionId };
    }
  });

  let combined = [...purchaseItems, ...tournamentItems, ...olympiadItems];

  const typeFilter = (item) => {
    const t = (type || "all").toLowerCase();
    const isTest = ["test", "school", "competitive", "skill", "challenge"].includes(item.type);
    
    if (t === "all") return true;
    if (t === "both") return isTest || item.type === "testBundle";
    if (t === "test") {
      if (item.type !== "test" || !item.test) return false;
      const frontendType = item.test.itemType || getFrontendItemType(item.test);
      return frontendType === "test";
    }
    if (t === "testbundle") return item.type === "testBundle";
    if (t === "tournament") return item.type === "tournament";
    if (t === "olympiad") return item.type === "olympiad";
    
    // Sub-types for tests
    if (["school", "competitive", "skill"].includes(t)) {
      if (item.type !== "test" || !item.test) return false;
      const frontendType = item.test.itemType || getFrontendItemType(item.test);
      return frontendType === t;
    }
    
    return true;
  };

  const searchFilter = (item) => {
    if (!search || !search.trim()) return true;
    const term = search.toLowerCase().trim();
    if (item.type === "test" && item.test) {
      return (item.test.title || "").toLowerCase().includes(term) || (item.test.description || "").toLowerCase().includes(term);
    }
    if (item.type === "testBundle" && item.testBundle) {
      return (item.testBundle.name || "").toLowerCase().includes(term) || (item.testBundle.description || "").toLowerCase().includes(term);
    }
    if (item.type === "tournament") {
      return (item.tournamentTitle || "").toLowerCase().includes(term);
    }
    if (item.type === "olympiad") {
      return (item.olympiadTitle || "").toLowerCase().includes(term);
    }
    return false;
  };

  const categoryFilter = (item) => {
    if (!descendantCategoryIds) return true;
    
    const checkCategories = (categories) => {
      if (!categories || !Array.isArray(categories)) return false;
      return categories.some((c) => {
        const idStr = (c?._id ?? c)?.toString?.();
        return idStr && descendantCategoryIds.includes(idStr);
      });
    };

    if (item.type === "test" && item.test) {
      return (
        checkCategories(item.test?.questionBank?.categories) ||
        checkCategories(item.test?.aiQuestionBank?.categories) ||
        (item.test?.categoryId &&
          descendantCategoryIds.includes(String(item.test.categoryId)))
      );
    }
    if (item.type === "testBundle" && item.testBundle?.tests) {
      return item.testBundle.tests.some(
        (t) =>
          checkCategories(t?.questionBank?.categories) ||
          checkCategories(t?.aiQuestionBank?.categories) ||
          (t?.categoryId &&
            descendantCategoryIds.includes(String(t.categoryId)))
      );
    }
    if (item.type === "tournament" && item.stages) {
      return item.stages.some(
        (s) =>
          checkCategories(s.test?.questionBank?.categories) ||
          checkCategories(s.test?.aiQuestionBank?.categories)
      );
    }
    if (item.type === "olympiad" && item.test) {
      return (
        checkCategories(item.test?.questionBank?.categories) ||
        checkCategories(item.test?.aiQuestionBank?.categories)
      );
    }
    return false;
  };

  combined = combined.filter((i) => typeFilter(i) && searchFilter(i) && categoryFilter(i));
  
  // Sort by createdAt desc
  combined.sort((a, b) => {
    const dateA = new Date(a.createdAt || a.purchaseDate || 0).getTime();
    const dateB = new Date(b.createdAt || b.purchaseDate || 0).getTime();
    return dateB - dateA;
  });

  const total = combined.length;
  const paginated = combined.slice(skip, skip + limitNum);

  return {
    items: paginated,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 },
  };
};

export default {
  getCourses,
  getCourseById,
  initiateCoursePayment,
  createCourseOrder,
  purchaseCourse,
  getMyCourses,
  getCourseContentForDownload,
  getCourseFollowUpTests,
  getTests,
  getTestById,
  initiateTestPayment,
  createTestOrder,
  purchaseTest,
  getTestBundles,
  getTestsAndBundles,
  initiateTestBundlePayment,
  createTestBundleOrder,
  purchaseTestBundle,
  getMyTests,
  getExamHall,
};