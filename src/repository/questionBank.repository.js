import QuestionBank from "../models/QuestionBank.js";
import Question from "../models/Question.js";
import Test from "../models/Test.js";
import Category from "../models/Category.js";
import categoryRepository from "./category.repository.js";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";

/**
 * Get total questions and total marks for multiple question banks in one query.
 * Returns Map<bankIdString, { totalQuestions, totalMarks }>
 */
const getBanksStatsBatch = async (bankIds) => {
  if (!bankIds?.length) return new Map();
  try {
    const objectIds = bankIds.map((id) =>
      typeof id === "string" ? new mongoose.Types.ObjectId(id) : id
    );
    const results = await Question.aggregate([
      { $match: { questionBank: { $in: objectIds } } },
      {
        $group: {
          _id: "$questionBank",
          totalQuestions: { $sum: 1 },
          totalMarks: { $sum: { $ifNull: ["$marks", 1] } },
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
    // Ensure all bank IDs have an entry (banks with zero questions)
    objectIds.forEach((oid) => {
      const key = oid.toString();
      if (!map.has(key)) {
        map.set(key, { totalQuestions: 0, totalMarks: 0 });
      }
    });
    return map;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch bank stats", error.message);
  }
};

const create = async (data) => {
  try {
    return await QuestionBank.create(data);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to create question bank", error.message);
  }
};

// Deep-populate helper: populates parent chain 3 levels deep (covers Pillar › Class › Subject)
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

const findById = async (id, populate = true) => {
  try {
    let q = QuestionBank.findById(id);
    if (populate) {
      q = q.populate(CATEGORY_DEEP_POPULATE);
    }
    return await q;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch question bank", error.message);
  }
};

const findAll = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      category,
    } = options;

    const query = { ...filter };

    if (category && category !== "All" && category !== "all") {
      const rawCategories = (Array.isArray(category) ? category : [category])
        .flatMap((c) => (typeof c === "string" ? c.split(",") : [c]))
        .map((c) => (typeof c === "string" ? c.trim() : c))
        .filter((c) => c && c !== "All" && c !== "all");

      if (rawCategories.length > 0) {
        const allIds = new Set();
        for (const catItem of rawCategories) {
          const isOid = mongoose.Types.ObjectId.isValid(catItem);
          let matchedSeedIds = [];

          if (isOid) {
            matchedSeedIds.push(catItem.toString());
          }

          // In case catItem is a rootType name (e.g. 'Competitive', 'School') or category name
          const namedCats = await Category.find({
            $or: [
              ...(isOid ? [{ _id: catItem }] : []),
              { rootType: catItem },
              { name: catItem },
            ],
          })
            .select("_id")
            .lean();

          if (namedCats && namedCats.length > 0) {
            namedCats.forEach((c) => matchedSeedIds.push(c._id.toString()));
          }

          if (matchedSeedIds.length === 0 && isOid) {
            matchedSeedIds.push(catItem.toString());
          }

          matchedSeedIds = Array.from(new Set(matchedSeedIds));

          // Expand each seed ID to all its descendants
          for (const seedId of matchedSeedIds) {
            try {
              const descendants = await categoryRepository.findDescendantIds(seedId);
              descendants.forEach((d) => allIds.add(d.toString()));
            } catch (err) {
              allIds.add(seedId);
            }
          }
        }

        if (allIds.size > 0) {
          const objectIds = Array.from(allIds).map((id) =>
            mongoose.Types.ObjectId.isValid(id)
              ? new mongoose.Types.ObjectId(id)
              : id
          );
          query.categories = { $in: objectIds };
        } else {
          query.categories = category;
        }
      }
    }

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [items, total] = await Promise.all([
      QuestionBank.find(query)
        .populate(CATEGORY_DEEP_POPULATE)
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      QuestionBank.countDocuments(query),
    ]);

    // Tag each bank with isUsedInTest / usedInTestTitle (single batched query)
    const itemIds = items.map((b) => b._id);
    const usedTests = await Test.find({ questionBank: { $in: itemIds } })
      .select("title questionBank")
      .lean();
    const bankToTest = new Map();
    usedTests.forEach((t) => {
      bankToTest.set(t.questionBank.toString(), t.title);
    });
    const taggedItems = items.map((bank) => {
      const plain = bank.toObject ? bank.toObject({ virtuals: true }) : { ...bank };
      const testTitle = bankToTest.get(plain._id.toString());
      plain.isUsedInTest = !!testTitle;
      plain.usedInTestTitle = testTitle || null;
      return plain;
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
    throw new ApiError(500, "Failed to fetch question banks", error.message);
  }
};

const updateById = async (id, updateData) => {
  try {
    return await QuestionBank.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("categories", "name parent order");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to update question bank", error.message);
  }
};

const deleteById = async (id) => {
  try {
    const deleted = await QuestionBank.findByIdAndDelete(id);
    if (!deleted) throw new ApiError(404, "Question bank not found");
    return deleted;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to delete question bank", error.message);
  }
};

const getQuestionsByBankId = async (bankId, options = {}) => {
  try {
    const { sortBy = "orderInBank", sortOrder = "asc" } = options;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };
    return await Question.find({ questionBank: bankId })
      .populate("createdBy", "name email")
      .populate(
        "childQuestions",
        "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
      )
      .sort(sort)
      .lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch questions for bank", error.message);
  }
};

const countQuestionsByBankId = async (bankId) => {
  try {
    return await Question.countDocuments({ questionBank: bankId });
  } catch (error) {
    throw new ApiError(500, "Failed to count questions", error.message);
  }
};

const deleteQuestionsByBankId = async (bankId) => {
  try {
    const result = await Question.deleteMany({ questionBank: bankId });
    return result.deletedCount;
  } catch (error) {
    throw new ApiError(500, "Failed to delete questions for bank", error.message);
  }
};

const updateQuestionsDifficultyBySection = async (
  bankId,
  sectionIndex,
  questionIds,
  difficulty
) => {
  try {
    const conditions = [{ questionBank: bankId, sectionIndex }];
    if (Array.isArray(questionIds) && questionIds.length > 0) {
      conditions.push({ _id: { $in: questionIds } });
    }

    const parents = await Question.find(
      { $or: conditions, isParent: true },
      { _id: 1, childQuestions: 1 }
    ).lean();

    const childIds = [];
    parents.forEach((p) => {
      if (Array.isArray(p.childQuestions)) {
        p.childQuestions.forEach((cid) => {
          if (cid) childIds.push(cid);
        });
      }
    });

    const updateConditions = [...conditions];
    if (childIds.length > 0) {
      updateConditions.push({ _id: { $in: childIds } });
      updateConditions.push({ parentQuestionId: { $in: parents.map((p) => p._id) } });
    }

    return await Question.updateMany(
      { $or: updateConditions },
      { $set: { difficulty } }
    );
  } catch (error) {
    throw new ApiError(500, "Failed to update questions difficulty", error.message);
  }
};

const updateAllQuestionsDifficulty = async (bankId, difficulty) => {
  try {
    return await Question.updateMany(
      { questionBank: bankId },
      { $set: { difficulty } }
    );
  } catch (error) {
    throw new ApiError(500, "Failed to update questions difficulty", error.message);
  }
};

export default {
  create,
  findById,
  findAll,
  updateById,
  deleteById,
  getQuestionsByBankId,
  countQuestionsByBankId,
  deleteQuestionsByBankId,
  getBanksStatsBatch,
  updateQuestionsDifficultyBySection,
  updateAllQuestionsDifficulty,
};
