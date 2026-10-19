import Question from "../models/Question.js";
import { ApiError } from "../utils/ApiError.js";

const create = async (questionData) => {
  try {
    return await Question.create(questionData);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to create question", error.message);
  }
};

const findByIds = async (ids) => {
  try {
    if (!ids || ids.length === 0) return [];
    return await Question.find({ _id: { $in: ids } }).lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch questions", error.message);
  }
};

const findById = async (id) => {
  try {
    return await Question.findById(id)
      .populate("parentQuestionId", "questionText passage")
      .populate(
        "childQuestions",
        "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
      )
      .populate("createdBy", "name email")
      .populate("questionBank", "name");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch question", error.message);
  }
};

const findAll = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      subject,
      topic,
      difficulty,
      questionType,
      isParent,
      questionBank,
    } = options;

    const query = { ...filter };

    if (questionBank) {
      query.questionBank = questionBank;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { questionText: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { topic: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by subject
    if (subject) {
      query.subject = subject;
    }

    // Filter by topic
    if (topic) {
      query.topic = topic;
    }

    // Filter by difficulty
    if (difficulty) {
      query.difficulty = difficulty;
    }

    // Filter by question type
    if (questionType) {
      query.questionType = questionType;
    }

    // Filter by parent/child
    if (isParent !== undefined) {
      query.isParent = isParent === "true" || isParent === true;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const questions = await Question.find(query)
      .populate("parentQuestionId", "questionText passage")
      .populate(
        "childQuestions",
        "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
      )
      .populate("createdBy", "name email")
      .populate("questionBank", "name")
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Question.countDocuments(query);

    return {
      questions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch questions", error.message);
  }
};

const updateById = async (id, updateData) => {
  try {
    updateData.updatedAt = new Date();
    return await Question.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("parentQuestionId", "questionText passage")
      .populate(
        "childQuestions",
        "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
      )
      .populate("createdBy", "name email")
      .populate("questionBank", "name");
  } catch (error) {
    throw new ApiError(500, "Failed to update question", error.message);
  }
};

const deleteById = async (id) => {
  try {
    const question = await Question.findById(id);
    if (!question) {
      throw new ApiError(404, "Question not found");
    }

    // If it's a parent question, remove references from child questions
    if (question.isParent && question.childQuestions.length > 0) {
      await Question.updateMany(
        { _id: { $in: question.childQuestions } },
        { $unset: { parentQuestionId: 1 } }
      );
    }

    // If it's a child question, remove from parent's childQuestions array
    if (question.parentQuestionId) {
      await Question.findByIdAndUpdate(question.parentQuestionId, {
        $pull: { childQuestions: id },
      });
    }

    return await Question.findByIdAndDelete(id);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to delete question", error.message);
  }
};

const addChildQuestion = async (parentId, childId) => {
  try {
    const parent = await Question.findById(parentId);
    if (!parent) {
      throw new ApiError(404, "Parent question not found");
    }

    const child = await Question.findById(childId);
    if (!child) {
      throw new ApiError(404, "Child question not found");
    }

    // Update parent
    if (!parent.childQuestions.includes(childId)) {
      parent.childQuestions.push(childId);
      await parent.save();
    }

    // Update child
    child.parentQuestionId = parentId;
    await child.save();

    return await Question.findById(parentId).populate(
      "childQuestions",
      "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to add child question", error.message);
  }
};

const removeChildQuestion = async (parentId, childId) => {
  try {
    const parent = await Question.findById(parentId);
    if (!parent) {
      throw new ApiError(404, "Parent question not found");
    }

    const child = await Question.findById(childId);
    if (!child) {
      throw new ApiError(404, "Child question not found");
    }

    // Remove from parent
    parent.childQuestions = parent.childQuestions.filter(
      (id) => id.toString() !== childId.toString()
    );
    await parent.save();

    // Remove parent reference from child
    child.parentQuestionId = null;
    await child.save();

    return parent;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to remove child question", error.message);
  }
};

const getAnalytics = async (questionId) => {
  try {
    const question = await Question.findById(questionId);
    if (!question) {
      throw new ApiError(404, "Question not found");
    }

    return {
      pValue: question.analytics.pValue,
      discriminationIndex: question.analytics.discriminationIndex,
      totalAttempts: question.analytics.totalAttempts,
      correctAttempts: question.analytics.correctAttempts,
      lastCalculated: question.analytics.lastCalculated,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to fetch analytics", error.message);
  }
};

const updateAnalytics = async (questionId, analyticsData) => {
  try {
    return await Question.findByIdAndUpdate(
      questionId,
      {
        $set: {
          "analytics.pValue": analyticsData.pValue,
          "analytics.discriminationIndex": analyticsData.discriminationIndex,
          "analytics.totalAttempts": analyticsData.totalAttempts,
          "analytics.correctAttempts": analyticsData.correctAttempts,
          "analytics.lastCalculated": new Date(),
        },
      },
      { new: true }
    );
  } catch (error) {
    throw new ApiError(500, "Failed to update analytics", error.message);
  }
};

const updateDifficultyByIds = async (ids, difficulty) => {
  try {
    if (!Array.isArray(ids) || ids.length === 0) return;
    return await Question.updateMany({ _id: { $in: ids } }, { $set: { difficulty } });
  } catch (error) {
    throw new ApiError(500, "Failed to update questions difficulty", error.message);
  }
};

export default {
  create,
  findById,
  findByIds,
  findAll,
  updateById,
  deleteById,
  addChildQuestion,
  removeChildQuestion,
  getAnalytics,
  updateAnalytics,
  updateDifficultyByIds,
};

