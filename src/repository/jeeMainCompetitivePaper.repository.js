import JeeMainCompetitivePaper from "../models/JeeMainCompetitivePaper.js";
import JeeMainCompetitiveQuestion from "../models/JeeMainCompetitiveQuestion.js";
import { ApiError } from "../utils/ApiError.js";

const listPapers = async (filter = {}, options = {}) => {
  try {
    const sort = options.sort || { sortOrder: 1, createdAt: 1 };
    return await JeeMainCompetitivePaper.find(filter).sort(sort).lean();
  } catch (error) {
    throw new ApiError(500, "Failed to list JEE Main papers", error.message);
  }
};

const findPaperById = async (id) => {
  try {
    return await JeeMainCompetitivePaper.findById(id).lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch JEE Main paper", error.message);
  }
};

const findPaperByKey = async (paperKey) => {
  try {
    return await JeeMainCompetitivePaper.findOne({ paperKey }).lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch JEE Main paper", error.message);
  }
};

const getQuestionsByPaperId = async (paperId) => {
  try {
    return await JeeMainCompetitiveQuestion.find({
      paper: paperId,
      isActive: true,
    })
      .sort({ orderInPaper: 1 })
      .lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch JEE Main questions", error.message);
  }
};

const countQuestionsByPaperId = async (paperId) => {
  try {
    return await JeeMainCompetitiveQuestion.countDocuments({
      paper: paperId,
      isActive: true,
    });
  } catch (error) {
    throw new ApiError(500, "Failed to count JEE Main questions", error.message);
  }
};

const getAllActiveQuestions = async () => {
  try {
    return await JeeMainCompetitiveQuestion.find({ isActive: true })
      .sort({ subject: 1, orderInPaper: 1 })
      .lean();
  } catch (error) {
    throw new ApiError(500, "Failed to fetch JEE Main question bank", error.message);
  }
};

export default {
  listPapers,
  findPaperById,
  findPaperByKey,
  getQuestionsByPaperId,
  countQuestionsByPaperId,
  getAllActiveQuestions,
};
