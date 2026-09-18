import Test from "../models/Test.js";
import TestBundle from "../models/TestBundle.js";
import Question from "../models/Question.js";
import QuestionBank from "../models/QuestionBank.js";
import AiQuestionBank from "../models/AiQuestionBank.js";
import { ApiError } from "../utils/ApiError.js";
import categoryRepository from "./category.repository.js";
import CourseTestLink from "../models/CourseTestLink.js";

// ========== Test Repository ==========
const createTest = async (testData) => {
  try {
    const test = await Test.create(testData);
    return await populateQuestionBankWithCategories(Test.findById(test._id));
  } catch (error) {
    throw new ApiError(500, "Failed to create test", error.message);
  }
};

const populateQuestionBankWithCategories = (query) => {
  return query
    .populate({
      path: "questionBank",
      select: "name categories useSectionWiseDifficulty useSectionWiseQuestions sections overallDifficulty",
      populate: { path: "categories", select: "name _id" },
    })
    .populate({
      path: "aiQuestionBank",
      select: "name categories overallDifficulty aiProvider questionCount useSectionWise sections",
      populate: { path: "categories", select: "name _id" },
    });
};

const findTestById = async (id, populateOptions = {}) => {
  try {
    let query = Test.findById(id);
    if (populateOptions.questionBank) {
      query = populateQuestionBankWithCategories(query);
    }
    return await query;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test", error.message);
  }
};

const findAllTests = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      questionBank,
      category,
      applicableFor,
      isPublished,
    } = options;

    const query = { ...filter };

    if (questionBank) {
      query.questionBank = questionBank;
    }

    if (category) {
      const descendantIds = await categoryRepository.findDescendantIds(category);
      const bankIds = await QuestionBank.find({
        categories: { $in: descendantIds },
      }).distinct("_id");
      const aiBankIds = await AiQuestionBank.find({
        categories: { $in: descendantIds },
      }).distinct("_id");

      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { questionBank: { $in: bankIds } },
          { aiQuestionBank: { $in: aiBankIds } },
          { categoryId: { $in: descendantIds } },
        ],
      });
    }

    if (typeof isPublished !== "undefined") {
      query.isPublished = isPublished === "true" || isPublished === true;
    }

    if (applicableFor) {
      query.applicableFor = applicableFor;
    }

    if (options.excludeCourseAssigned === "true" || options.excludeCourseAssigned === true) {
      const usedCourseIds = await findAllUsedCourseTestIds(options.includeCourseId);
      if (usedCourseIds.length > 0) {
        query._id = query._id || {};
        if (query._id.$nin) {
          query._id.$nin = [...new Set([...query._id.$nin, ...usedCourseIds])];
        } else {
          query._id.$nin = usedCourseIds;
        }
      }
    }

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ title: regex }, { description: regex }]
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [tests, total] = await Promise.all([
      populateQuestionBankWithCategories(
        Test.find(query).sort(sort).skip(skip).limit(limitNum)
      ),
      Test.countDocuments(query),
    ]);

    return {
      tests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch tests", error.message);
  }
};

const updateTestById = async (id, updateData) => {
  try {
    const updated = await Test.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    return updated
      ? await populateQuestionBankWithCategories(Test.findById(updated._id))
      : null;
  } catch (error) {
    throw new ApiError(500, "Failed to update test", error.message);
  }
};

const deleteTestById = async (id) => {
  try {
    const deleted = await Test.findByIdAndDelete(id);
    if (!deleted) {
      throw new ApiError(404, "Test not found");
    }
    return deleted;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to delete test", error.message);
  }
};

// ========== TestBundle Repository ==========
const populateBundleTests = (query) => {
  return query.populate({
    path: "tests",
    select: "title durationMinutes questionBank",
    populate: {
      path: "questionBank",
      select: "name categories",
      populate: { path: "categories", select: "name _id" },
    },
  });
};

const createBundle = async (bundleData) => {
  try {
    const bundle = await TestBundle.create(bundleData);
    return await populateBundleTests(TestBundle.findById(bundle._id));
  } catch (error) {
    throw new ApiError(500, "Failed to create bundle", error.message);
  }
};

/**
 * Find bundle IDs that contain the given test (for access check when test is part of a bundle)
 */
const findBundleIdsContainingTest = async (testId) => {
  try {
    const bundles = await TestBundle.find({ tests: testId }).select("_id").lean();
    return bundles.map((b) => b._id);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch bundles for test", error.message);
  }
};

const findBundleById = async (id, populateOptions = {}) => {
  try {
    let query = TestBundle.findById(id);
    if (populateOptions.category) {
      query = query.populate("category", populateOptions.category);
    }
    if (populateOptions.tests) {
      query = populateBundleTests(query);
    }
    return await query;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch bundle", error.message);
  }
};

const findAllBundles = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      isActive,
      category,
    } = options;

    const query = { ...filter };

    if (category) {
      const descendantIds = await categoryRepository.findDescendantIds(category);
      const bankIds = await QuestionBank.find({ categories: { $in: descendantIds } }).distinct("_id");
      
      const matchedTests = await Test.find({
        $or: [
          { questionBank: { $in: bankIds } },
          { categoryId: { $in: descendantIds } }
        ]
      }).distinct("_id");

      query.tests = { $in: matchedTests };
    }

    if (typeof isActive !== "undefined") {
      query.isActive = isActive === "true" || isActive === true;
    }

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [{ name: regex }, { description: regex }];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [bundles, total] = await Promise.all([
      populateBundleTests(
        TestBundle.find(query).sort(sort).skip(skip).limit(limitNum)
      ),
      TestBundle.countDocuments(query),
    ]);

    return {
      bundles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch bundles", error.message);
  }
};

const updateBundleById = async (id, updateData) => {
  try {
    const updated = await TestBundle.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    return updated
      ? await populateBundleTests(TestBundle.findById(updated._id))
      : null;
  } catch (error) {
    throw new ApiError(500, "Failed to update bundle", error.message);
  }
};

const deleteBundleById = async (id) => {
  try {
    const deleted = await TestBundle.findByIdAndDelete(id);
    if (!deleted) {
      throw new ApiError(404, "Bundle not found");
    }
    return deleted;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to delete bundle", error.message);
  }
};

// ========== Question Helper Methods ==========
const findQuestionsByIds = async (questionIds, filter = {}) => {
  try {
    return await Question.find({
      _id: { $in: questionIds },
      ...filter,
    }).select("_id marks");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch questions", error.message);
  }
};

const sampleRandomQuestions = async (count) => {
  try {
    const pipeline = [
      { $match: { isActive: true } },
      { $sample: { size: count } },
      { $project: { _id: 1, marks: 1 } },
    ];
    return await Question.aggregate(pipeline);
  } catch (error) {
    throw new ApiError(500, "Failed to sample questions", error.message);
  }
};

/** Sample random questions from a specific question bank */
const sampleRandomQuestionsFromBank = async (questionBankId, count) => {
  try {
    const pipeline = [
      { $match: { questionBank: questionBankId, isActive: true } },
      { $sample: { size: count } },
      { $project: { _id: 1, marks: 1 } },
    ];
    return await Question.aggregate(pipeline);
  } catch (error) {
    throw new ApiError(500, "Failed to sample questions from bank", error.message);
  }
};

/** Get IDs of all published everyday challenge tests */
const findEverydayChallengeTestIds = async () => {
  try {
    const docs = await Test.find({
      applicableFor: "everyday_challenge",
      isPublished: true,
    })
      .select("_id")
      .lean();
    return docs.map((d) => d._id);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch everyday challenge tests", error.message);
  }
};

const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };

/**
 * Bucket tests for challenge/everyday layouts. Section-wise banks often keep
 * overallDifficulty at default "medium" while sections are all "easy" — without
 * this, Bronze (easy-only slot) never picks those tests.
 */
const getEffectiveBankDifficulty = (bank) => {
  if (!bank) return "medium";
  if (bank.useSectionWiseDifficulty && Array.isArray(bank.sections) && bank.sections.length > 0) {
    let easiest = "hard";
    for (const sec of bank.sections) {
      const d = sec?.difficulty;
      if (d && DIFF_RANK[d] < DIFF_RANK[easiest]) easiest = d;
    }
    return easiest;
  }
  return bank.overallDifficulty || "medium";
};

/** Get everyday challenge test IDs grouped by questionBank.overallDifficulty (for Bronze stage) */
const findEverydayChallengeTestsByDifficulty = async () => {
  try {
    const docs = await Test.find({
      applicableFor: "everyday_challenge",
      isPublished: true,
    })
      .select("_id questionBank")
      .populate("questionBank", "overallDifficulty useSectionWiseDifficulty sections")
      .lean();
    const easy = [];
    const medium = [];
    const hard = [];
    docs.forEach((d) => {
      const diff = getEffectiveBankDifficulty(d.questionBank);
      if (diff === "easy") easy.push(d._id);
      else if (diff === "medium") medium.push(d._id);
      else if (diff === "hard") hard.push(d._id);
    });
    return { easy, medium, hard };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch everyday challenge tests by difficulty", error.message);
  }
};

/** Get challenge-yourself test IDs grouped by questionBank.overallDifficulty */
const findChallengeYourselfTestsByDifficulty = async () => {
  try {
    const docs = await Test.find({
      applicableFor: "challenge_yourself",
      isPublished: true,
    })
      .select("_id questionBank")
      .populate("questionBank", "overallDifficulty useSectionWiseDifficulty sections")
      .sort({ createdAt: 1 })
      .lean();
    const easy = [];
    const medium = [];
    const hard = [];
    docs.forEach((d) => {
      const diff = getEffectiveBankDifficulty(d.questionBank);
      if (diff === "easy") easy.push(d._id);
      else if (diff === "medium") medium.push(d._id);
      else if (diff === "hard") hard.push(d._id);
    });
    return { easy, medium, hard };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch challenge-yourself tests", error.message);
  }
};

/** Find all published tests for a gamification stage, keyed by gamificationLevel */
const findTestsByStageCategory = async (categoryId) => {
  try {
    const tests = await Test.find({
      categoryId: categoryId,
      applicableFor: "challenge_yourself",
      isPublished: true,
    })
      .populate({
        path: "questionBank",
        select: "name categories",
        populate: { path: "categories", select: "name _id" },
      })
      .lean();
      
    // Build map: gamificationLevel → test
    const map = new Map();
    tests.forEach((t) => {
      if (t.gamificationLevel != null) {
        map.set(Number(t.gamificationLevel), t);
      }
    });
    return map;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch stage tests", error.message);
  }
};

const findAllUsedBundleTestIds = async (excludeBundleId) => {
  try {
    const query = {};
    if (excludeBundleId) {
      query._id = { $ne: excludeBundleId };
    }
    const bundles = await TestBundle.find(query).select("tests").lean();
    const usedIds = [];
    bundles.forEach((b) => {
      if (b.tests && Array.isArray(b.tests)) {
        b.tests.forEach((t) => usedIds.push(t.toString()));
      }
    });
    return usedIds;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch used bundle test IDs", error.message);
  }
};

const findAllUsedCourseTestIds = async (excludeCourseId) => {
  try {
    const query = {};
    if (excludeCourseId) {
      query.course = { $ne: excludeCourseId };
    }
    const links = await CourseTestLink.find(query).select("test").lean();
    return links.map((l) => l.test.toString());
  } catch (error) {
    throw new ApiError(500, "Failed to fetch used course test IDs", error.message);
  }
};

export default {
  // Test methods
  createTest,
  findTestById,
  findAllTests,
  findEverydayChallengeTestIds,
  findEverydayChallengeTestsByDifficulty,
  findChallengeYourselfTestsByDifficulty,
  findTestsByStageCategory,
  updateTestById,
  deleteTestById,
  // Bundle methods
  createBundle,
  findBundleById,
  findBundleIdsContainingTest,
  findAllBundles,
  updateBundleById,
  deleteBundleById,
  findAllUsedBundleTestIds,
  findAllUsedCourseTestIds,
  // Question helper methods
  findQuestionsByIds,
  sampleRandomQuestions,
  sampleRandomQuestionsFromBank,
};

