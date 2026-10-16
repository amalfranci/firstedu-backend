import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import marketplaceValidator from "../validation/marketplace.validator.js";
import marketplaceService, {
  initiateCoursePayment as initiateCoursePaymentService,
  getSubcategoriesByPillarName,
  getPaginatedFreeMaterials,
} from "../services/marketplace.service.js";


// Get All Published Courses (Marketplace)
// Query: type (pdf | video | audio), access (free | paid | both), isCertification (true | false)
export const getCourses = asyncHandler(async (req, res) => {
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
  } = req.query;

  const { courses, pagination } = await marketplaceService.getCourses({
    page,
    limit,
    search,
    category,
    sortBy,
    sortOrder,
    type,
    access,
    isCertification:
      typeof isCertification === "string"
        ? isCertification === "true"
        : undefined,
    studentId: req.user?._id,
  });

  return res
    .status(200)
    .json(
      ApiResponse.success(courses, "Courses fetched successfully", pagination),
    );
});

// Get Course Details (with purchase status)
export const getCourseById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const courseData = await marketplaceService.getCourseById(id, studentId);

  return res
    .status(200)
    .json(ApiResponse.success(courseData, "Course fetched successfully"));
});

// Get Course Details for Landing Page (no purchase status / student ID required)
export const getCourseByIdLandingPage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const courseData = await marketplaceService.getCourseById(id);

  return res
    .status(200)
    .json(ApiResponse.success(courseData, "Course fetched successfully"));
});

// Initiate course payment (free, wallet, or razorpay - like test/test-bundle)
export const initiateCoursePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } = marketplaceValidator.initiateCoursePayment.validate(req.body);
  if (error) {
    throw new ApiError(400, "Validation Error", error.details.map((x) => x.message));
  }

  const result = await initiateCoursePaymentService(
    id,
    studentId,
    value.paymentMethod,
    { couponCode: value?.couponCode }
  );

  if (result.completed) {
    return res
      .status(201)
      .json(ApiResponse.success(result.purchase, "Course purchased successfully"));
  }

  return res
    .status(200)
    .json(
      ApiResponse.success(
        result,
        "Payment order created. Complete payment and call purchase API."
      )
    );
});

// Purchase Course (verify Razorpay payment and complete purchase)
export const purchaseCourse = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } = marketplaceValidator.purchaseCourse.validate(
    req.body,
  );
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message),
    );
  }

  const purchaseData = await marketplaceService.purchaseCourse(
    id,
    studentId,
    value,
  );

  return res
    .status(201)
    .json(ApiResponse.success(purchaseData, "Course purchased successfully"));
});

// Get Student's Purchased Courses
// Query: page, limit, search (title/description), contentType (pdf | video | audio), isCertification (true | false)
// Free Material Mode: isFreeMaterial=true&categoryId=...&subCategoryId=...
// Subcategory Fetch Mode: isFreeMaterial=true&fetchSubcategories=true&pillarName=School
export const getMyCourses = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const {
    page = 1, limit = 10, search, contentType,
    isCertification,
    isFreeMaterial,
    categoryId, subCategoryId,
    fetchSubcategories, pillarName,
  } = req.query;

  // ── Branch 1: Fetch subcategories for a given pillar (lazy-load tab list) ──
  // Triggered ONLY when:
  // 1. isFreeMaterial=true AND fetchSubcategories=true
  // 2. A specific pillarName is provided (NOT 'all', NOT null/undefined/empty)
  // 3. subCategoryId is NOT provided (if subCategoryId is present, user wants materials)
  const isPillarSubcategoriesRequest =
    isFreeMaterial === 'true' &&
    fetchSubcategories === 'true' &&
    pillarName &&
    !['all', 'null', 'undefined', ''].includes(String(pillarName).trim().toLowerCase()) &&
    !subCategoryId;

  if (isPillarSubcategoriesRequest) {
    const subcategories = await getSubcategoriesByPillarName(pillarName);
    return res.status(200).json(ApiResponse.success(subcategories, "Subcategories fetched successfully"));
  }

  // ── Branch 2: Fetch paginated free materials ──
  // Triggered when: isFreeMaterial=true (handles Web "All", Mobile "All" where fetchSubcategories=true, and filtered materials)
  if (isFreeMaterial === 'true') {
    const { purchases, pagination } = await getPaginatedFreeMaterials(
      page,
      limit,
      {
        categoryId,
        subCategoryId,
        pillarName,
        search,
        contentType,
      }
    );
    return res.status(200).json(ApiResponse.success(purchases, "Free materials fetched successfully", pagination));
  }


  const { purchases, pagination } = await marketplaceService.getMyCourses(
    studentId,
    page,
    limit,
    {
      search,
      contentType,
      isCertification:
        typeof isCertification === "string"
          ? isCertification === "true"
          : undefined,
    },
  );

  return res
    .status(200)
    .json(
      ApiResponse.success(
        purchases,
        "Purchased courses fetched successfully",
        pagination,
      ),
    );
});

// Get Free Materials for Landing Page
export const getFreeMaterialsLandingPage = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 10, search, contentType,
    categoryId, subCategoryId,
    fetchSubcategories, pillarName,
  } = req.query;

  // Branch 1: Fetch subcategories for a given pillar
  const isPillarSubcategoriesRequest =
    fetchSubcategories === 'true' &&
    pillarName &&
    !['all', 'null', 'undefined', ''].includes(String(pillarName).trim().toLowerCase()) &&
    !subCategoryId;

  if (isPillarSubcategoriesRequest) {
    const subcategories = await getSubcategoriesByPillarName(pillarName);
    return res.status(200).json(ApiResponse.success(subcategories, "Subcategories fetched successfully"));
  }

  // Branch 2: Fetch paginated free materials
  const { purchases, pagination } = await getPaginatedFreeMaterials(
    page,
    limit,
    {
      categoryId,
      subCategoryId,
      pillarName,
      search,
      contentType,
    }
  );
  return res.status(200).json(ApiResponse.success(purchases, "Free materials fetched successfully", pagination));
});


// Get course content for viewing/download (requires purchase; returns contents[] array)
// Query: redirect=true — redirects to first content URL for direct download
export const getCourseContent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;
  const { redirect } = req.query;

  const content = await marketplaceService.getCourseContentForDownload(id, studentId);

  if (redirect === "true" || redirect === "1") {
    const firstUrl = content.contents?.[0]?.url;
    if (!firstUrl) {
      return res.status(404).json(ApiResponse.error("No content URL available"));
    }
    return res.redirect(302, firstUrl);
  }

  return res
    .status(200)
    .json(ApiResponse.success(content, "Course content fetched successfully"));
});

// Get Follow-up Tests for a Course
export const getCourseFollowUpTests = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const links = await marketplaceService.getCourseFollowUpTests(id, studentId);

  return res
    .status(200)
    .json(ApiResponse.success(links, "Follow-up tests fetched successfully"));
});

// Get All Published Tests (Marketplace)
export const getTests = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search,
    questionBank,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
    applicableFor
  } = req.query;

  const { tests, pagination } = await marketplaceService.getTests({
    page,
    limit,
    search,
    questionBank,
    category,
    sortBy,
    sortOrder,
    applicableFor
  });

  return res
    .status(200)
    .json(ApiResponse.success(tests, "Tests fetched successfully", pagination));
});

// Get Tests and Test Bundles (combined, with type filter: test | testBundle | both)
// Always returns { items, pagination } — one list and one pagination for easy handling
export const getTestsAndBundles = asyncHandler(async (req, res) => {
  const {
    type = "both",
    page = 1,
    limit = 10,
    search,
    category,
    questionBank,
    sortBy = "createdAt",
    sortOrder = "desc",
    applicableFor,
  } = req.query;
  const studentId = req.user?._id;
  const isLandingPage = req.originalUrl.includes("/landing-page");

  const result = await marketplaceService.getTestsAndBundles({
    type: ["test", "testBundle", "both", "challenges", "olympiad", "tournament", "school", "competitive", "skill", "all"].includes(type) ? type : "both",
    page,
    limit,
    search,
    category,
    questionBank,
    sortBy,
    sortOrder,
    studentId,
    isLandingPage,
    applicableFor,
  });

  return res
    .status(200)
    .json(
      ApiResponse.success(
        { items: result.items },
        "Tests and bundles fetched successfully",
        result.pagination,
      ),
    );
});

// Get Test Details (full details, no payment check)
export const getTestById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const testData = await marketplaceService.getTestById(id);

  return res
    .status(200)
    .json(ApiResponse.success(testData, "Test fetched successfully"));
});

// Initiate test payment (free, wallet, or razorpay - like olympiad/tournament/workshop)
export const initiateTestPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } = marketplaceValidator.initiateTestPayment.validate(
    req.body,
  );
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message),
    );
  }

  const result = await marketplaceService.initiateTestPayment(
    id,
    studentId,
    value.paymentMethod,
    { couponCode: value?.couponCode },
  );

  if (result.completed) {
    return res
      .status(201)
      .json(
        ApiResponse.success(result.purchase, "Test purchased successfully"),
      );
  }

  return res
    .status(200)
    .json(
      ApiResponse.success(
        result,
        "Payment order created. Complete payment and call purchase API.",
      ),
    );
});

// Purchase Test
export const purchaseTest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } = marketplaceValidator.purchaseTest.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message),
    );
  }

  const purchaseData = await marketplaceService.purchaseTest(
    id,
    studentId,
    value,
  );

  return res
    .status(201)
    .json(ApiResponse.success(purchaseData, "Test purchased successfully"));
});

// Get All Published Test Bundles (Marketplace)
export const getTestBundles = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search,
    category,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const { bundles, pagination } = await marketplaceService.getTestBundles({
    page,
    limit,
    search,
    category,
    sortBy,
    sortOrder,
  });

  return res
    .status(200)
    .json(
      ApiResponse.success(
        bundles,
        "Test bundles fetched successfully",
        pagination,
      ),
    );
});

// Initiate test bundle payment (free, wallet, or razorpay - like olympiad/tournament/workshop)
export const initiateTestBundlePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } =
    marketplaceValidator.initiateTestBundlePayment.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message),
    );
  }

  const result = await marketplaceService.initiateTestBundlePayment(
    id,
    studentId,
    value.paymentMethod,
    { couponCode: value?.couponCode },
  );

  if (result.completed) {
    return res
      .status(201)
      .json(
        ApiResponse.success(
          result.purchase,
          "Test bundle purchased successfully",
        ),
      );
  }

  return res
    .status(200)
    .json(
      ApiResponse.success(
        result,
        "Payment order created. Complete payment and call purchase API.",
      ),
    );
});

// Purchase Test Bundle
export const purchaseTestBundle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const studentId = req.user._id;

  const { error, value } = marketplaceValidator.purchaseTestBundle.validate(
    req.body,
  );
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message),
    );
  }

  const purchaseData = await marketplaceService.purchaseTestBundle(
    id,
    studentId,
    value,
  );

  return res
    .status(201)
    .json(
      ApiResponse.success(purchaseData, "Test bundle purchased successfully"),
    );
});

// Get Student's Purchased Tests
export const getMyTests = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 10 } = req.query;

  const { purchases, pagination } = await marketplaceService.getMyTests(
    studentId,
    page,
    limit,
  );

  return res
    .status(200)
    .json(
      ApiResponse.success(
        purchases,
        "Purchased tests fetched successfully",
        pagination,
      ),
    );
});

// Get Exam Hall - purchased tests, test bundles, and (when live) olympiads & tournaments
// type: "test" | "testBundle" | "olympiad" | "tournament" | "both" (test+bundle) | "all"
export const getExamHall = asyncHandler(async (req, res) => {
  const studentId = req.user._id;
  const { page = 1, limit = 20, type = "all", category, search } = req.query;

  const filterType = ["test", "testBundle", "olympiad", "tournament", "certificationTest", "school", "competitive", "skill", "both", "all"].includes(type)
    ? type
    : "all";

  const result = await marketplaceService.getExamHall(
    studentId,
    page,
    limit,
    filterType,
    category || null,
    search || null
  );

  return res
    .status(200)
    .json(
      ApiResponse.success(
        result.items,
        "Exam hall fetched successfully",
        result.pagination,
      ),
    );
});

// Get All Resources (Courses, Tests, Bundles) combined
export const getAllResources = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);

  const [coursesData, testsData, bundlesData] = await Promise.all([
    marketplaceService.getCourses({
      page: pageNum,
      limit: limitNum,
      search,
      sortBy: "createdAt",
      sortOrder: "desc",
    }),
    marketplaceService.getTests({
      page: pageNum,
      limit: limitNum,
      search,
      sortBy: "createdAt",
      sortOrder: "desc",
    }),
    marketplaceService.getTestBundles({
      page: pageNum,
      limit: limitNum,
      search,
      sortBy: "createdAt",
      sortOrder: "desc",
    }),
  ]);

  const totalResources =
    coursesData.pagination.total +
    testsData.pagination.total +
    bundlesData.pagination.total;

  return res.status(200).json(
    ApiResponse.success(
      {
        courses: coursesData.courses,
        tests: testsData.tests,
        bundles: bundlesData.bundles,
      },
      "All resources fetched successfully",
      {
        page: pageNum,
        limit: limitNum,
        total: totalResources,
        courses: {
          total: coursesData.pagination.total,
          pages: coursesData.pagination.pages,
        },
        tests: {
          total: testsData.pagination.total,
          pages: testsData.pagination.pages,
        },
        bundles: {
          total: bundlesData.pagination.total,
          pages: bundlesData.pagination.pages,
        },
      },
    ),
  );
});

export default {
  getCourses,
  getCourseById,
  getCourseByIdLandingPage,
  initiateCoursePayment,
  purchaseCourse,
  getMyCourses,
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
  getFreeMaterialsLandingPage,
};
