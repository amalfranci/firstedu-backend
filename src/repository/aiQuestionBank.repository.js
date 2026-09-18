import AiQuestionBank from "../models/AiQuestionBank.js";
import AiQuestion from "../models/AiQuestion.js";
import Test from "../models/Test.js";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import categoryRepository from "./category.repository.js";

const CATEGORY_DEEP_POPULATE = {
  path: "categories",
  select: "name parent order rootType",
  populate: {
    path: "parent",
    select: "name parent order rootType",
    populate: {
      path: "parent",
      select: "name parent order rootType",
      populate: {
        path: "parent",
        select: "name order rootType",
      },
    },
  },
};

const CATEGORY_SHALLOW_POPULATE = {
  path: "categories",
  select: "name parent",
  populate: { path: "parent", select: "name parent" },
};

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getBanksStatsBatch = async (bankIds) => {
  if (!bankIds?.length) return new Map();
  try {
    const objectIds = bankIds.map((id) =>
      typeof id === "string" ? new mongoose.Types.ObjectId(id) : id
    );
    const results = await AiQuestion.aggregate([
      {
        $match: {
          aiQuestionBank: { $in: objectIds },
          parentQuestionId: null,
        },
      },
      {
        $group: {
          _id: "$aiQuestionBank",
          totalQuestions: { $sum: 1 },
          totalMarks: {
            $sum: {
              $cond: [
                { $eq: ["$isParent", true] },
                { $ifNull: ["$marks", 0] },
                { $ifNull: ["$marks", 1] },
              ],
            },
          },
        },
      },
    ]);
    const map = new Map();
    results.forEach((r) => {
      map.set(r._id.toString(), {
        totalQuestions: r.totalQuestions,
        totalMarks: r.totalMarks,
      });
    });
    objectIds.forEach((oid) => {
      const key = oid.toString();
      if (!map.has(key)) {
        map.set(key, { totalQuestions: 0, totalMarks: 0 });
      }
    });
    return map;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch AI bank stats", error.message);
  }
};

const findDuplicateName = async (name, createdBy, excludeId = null) => {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  const query = {
    createdBy,
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, "i") },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return AiQuestionBank.findOne(query).select("_id name").lean();
};

const findByGenerationId = async (generationId) => {
  const id = String(generationId || "").trim();
  if (!id) return null;
  return AiQuestionBank.findOne({ generationId: id })
    .select("_id name generationId")
    .lean();
};

const create = async (data, session = null) => {
  try {
    const docs = await AiQuestionBank.create([data], session ? { session } : undefined);
    return docs[0];
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to create AI question bank", error.message);
  }
};

const insertQuestions = async (questionDocs, session = null) => {
  try {
    if (!questionDocs?.length) return [];
    return await AiQuestion.insertMany(questionDocs, session ? { session } : undefined);
  } catch (error) {
    throw new ApiError(500, "Failed to create AI questions", error.message);
  }
};

const findById = async (id, populate = true) => {
  try {
    let q = AiQuestionBank.findById(id);
    if (populate) {
      q = q.populate(CATEGORY_DEEP_POPULATE);
    }
    return await q;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch AI question bank", error.message);
  }
};

const findAll = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      category,
      shallowCategories = true,
    } = options;

    const query = { ...filter };
    if (category) {
      const descendantIds = await categoryRepository.findDescendantIds(category);
      query.categories = { $in: descendantIds };
    }
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const categoryPopulate = shallowCategories
      ? CATEGORY_SHALLOW_POPULATE
      : CATEGORY_DEEP_POPULATE;

    const [items, total] = await Promise.all([
      AiQuestionBank.find(query)
        .select(
          "name categories overallDifficulty useSectionWise negativeMarks sections questionCount aiProvider generationTopic createdAt createdBy"
        )
        .populate(categoryPopulate)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AiQuestionBank.countDocuments(query),
    ]);

    const itemIds = items.map((b) => b._id);
    const usedTests = await Test.find({ aiQuestionBank: { $in: itemIds } })
      .select("title aiQuestionBank")
      .lean();
    const bankToTest = new Map();
    usedTests.forEach((t) => {
      bankToTest.set(t.aiQuestionBank.toString(), t.title);
    });

    const statsMap = await getBanksStatsBatch(itemIds);

    const taggedItems = items.map((bank) => {
      const key = bank._id.toString();
      const stats = statsMap.get(key) || { totalQuestions: 0, totalMarks: 0 };
      const testTitle = bankToTest.get(key);
      return {
        ...bank,
        questionCount: bank.questionCount ?? stats.totalQuestions,
        totalMarks: stats.totalMarks,
        isUsedInTest: !!testTitle,
        usedInTestTitle: testTitle || null,
        bankType: "ai",
      };
    });

    return {
      items: taggedItems,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch AI question banks", error.message);
  }
};

const deleteById = async (id) => {
  try {
    const deleted = await AiQuestionBank.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, "AI question bank not found");
    return deleted;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to delete AI question bank", error.message);
  }
};

const getQuestionsByBankId = async (bankId, options = {}) => {
  try {
    const { sortBy = "orderInBank", sortOrder = "asc", summary = false } = options;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };
    const select = summary
      ? "questionText questionType difficulty marks negativeMarks orderInBank aiBatchNumber sectionIndex parentQuestionId isParent passage"
      : undefined;
    let query = AiQuestion.find({ aiQuestionBank: bankId }).sort(sort);
    if (select) query = query.select(select);
    if (!summary) {
      query = query
        .populate("createdBy", "name email")
        .populate(
          "childQuestions",
          "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
        );
    }
    return await query.lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch AI questions for bank", error.message);
  }
};

const deleteQuestionsByBankId = async (bankId, session = null) => {
  try {
    const result = await AiQuestion.deleteMany(
      { aiQuestionBank: bankId },
      session ? { session } : undefined
    );
    return result.deletedCount;
  } catch (error) {
    throw new ApiError(500, "Failed to delete AI questions for bank", error.message);
  }
};

export default {
  create,
  insertQuestions,
  findById,
  findAll,
  deleteById,
  getQuestionsByBankId,
  deleteQuestionsByBankId,
  getBanksStatsBatch,
  findDuplicateName,
  findByGenerationId,
};
