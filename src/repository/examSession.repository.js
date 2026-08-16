import mongoose from "mongoose";
import ExamSession from "../models/ExamSession.js";
import Test from "../models/Test.js";
import Question from "../models/Question.js";
import "../models/JeeMainCompetitiveQuestion.js";
import TestPurchase from "../models/TestPurchase.js";
import { ApiError } from "../utils/ApiError.js";

const create = async (sessionData) => {
  try {
    return await ExamSession.create(sessionData);
  } catch (error) {
    throw new ApiError(500, "Failed to create exam session", error.message);
  }
};

const findById = async (id, populateOptions = {}) => {
  try {
    let query = ExamSession.findById(id);
    if (populateOptions.test) {
      query = query.populate("test", populateOptions.test);
    }
    if (populateOptions.student) {
      query = query.populate("student", populateOptions.student);
    }
    if (populateOptions.answers) {
      const answersPopulate = {
        path: "answers.questionId",
        select: populateOptions.answers.select || "",
      };
      if (populateOptions.answers.populate && (typeof populateOptions.answers.populate === "string" || (typeof populateOptions.answers.populate === "object" && Object.keys(populateOptions.answers.populate).length > 0))) {
        answersPopulate.populate = populateOptions.answers.populate;
      }
      query = query.populate(answersPopulate);
    }
    return await query;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch exam session", error.message);
  }
};

const findOne = async (filter, populateOptions = {}) => {
  try {
    let query = ExamSession.findOne(filter);
    if (populateOptions.test) {
      query = query.populate("test", populateOptions.test);
    }
    if (populateOptions.student) {
      query = query.populate("student", populateOptions.student);
    }
    if (populateOptions.answers) {
      const answersPopulate = {
        path: "answers.questionId",
        select: populateOptions.answers.select || "",
      };
      if (populateOptions.answers.populate && (typeof populateOptions.answers.populate === "string" || (typeof populateOptions.answers.populate === "object" && Object.keys(populateOptions.answers.populate).length > 0))) {
        answersPopulate.populate = populateOptions.answers.populate;
      }
      query = query.populate(answersPopulate);
    }
    return await query;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch exam session", error.message);
  }
};

const findAll = async (filter = {}, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = options;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [sessions, total] = await Promise.all([
      ExamSession.find(filter)
        .populate("test", "title description")
        .populate("student", "name email")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      ExamSession.countDocuments(filter),
    ]);

    return {
      sessions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch exam sessions", error.message);
  }
};

const updateById = async (id, updateData) => {
  try {
    return await ExamSession.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  } catch (error) {
    throw new ApiError(500, "Failed to update exam session", error.message);
  }
};

const save = async (session) => {
  try {
    return await session.save();
  } catch (error) {
    throw new ApiError(500, "Failed to save exam session", error.message);
  }
};

// ========== Test Repository Methods ==========
const findTestById = async (id, populateOptions = {}) => {
  try {
    let query = Test.findById(id);
    if (populateOptions.questionBank) {
      query = query.populate("questionBank", populateOptions.questionBank);
    }
    if (populateOptions.aiQuestionBank) {
      query = query.populate("aiQuestionBank", populateOptions.aiQuestionBank);
    }
    if (populateOptions.jeeMainPaper) {
      query = query.populate("jeeMainPaper", populateOptions.jeeMainPaper);
    }
    return await query;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test", error.message);
  }
};

// ========== Question Repository Methods ==========
const findQuestionById = async (id) => {
  try {
    return await Question.findById(id);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch question", error.message);
  }
};

// ========== TestPurchase Repository Methods ==========
const findTestPurchase = async (filter) => {
  try {
    return await TestPurchase.findOne(filter);
  } catch (error) {
    throw new ApiError(500, "Failed to fetch test purchase", error.message);
  }
};

const findAllCompletedSessions = async (testId) => {
  try {
    return await ExamSession.find({
      test: testId,
      status: "completed",
      score: { $ne: null },
      challenge: null,
    }).select("student score completedAt");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch completed sessions", error.message);
  }
};

const findCompletedSessionsForStudentAndTests = async (studentId, testIds) => {
  try {
    if (!studentId || !testIds?.length) return [];
    const ids = testIds
      .map((id) => id?.toString?.() ?? id)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));
    return await ExamSession.find({
      student: new mongoose.Types.ObjectId(studentId),
      test: { $in: ids },
      status: "completed",
      score: { $ne: null },
      challenge: null,
    }).select("test student score completedAt");
  } catch (error) {
    throw new ApiError(
      500,
      "Failed to fetch completed sessions for student and tests",
      error.message
    );
  }
};

const findExpiredInProgressSessions = async () => {
  try {
    const now = new Date();
    return await ExamSession.find({
      status: "in_progress",
      endTime: { $lte: now },
    });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch expired sessions", error.message);
  }
};

/**
 * Get top N students by best score for a test (one entry per student, best score wins; tie-break: earlier completedAt).
 * studentIds: optional array; if provided, only these students are considered.
 */
/**
 * Get latest exam session status and sessionId per test for a student.
 * Returns Map<testIdString, { status: "not_started"|"resume"|"completed", sessionId: ObjectId|null }>
 */
const getSessionStatusMapByStudent = async (studentId, testIds) => {
  try {
    if (!testIds?.length) return {};
    const ids = testIds.map((id) => id?.toString?.() ?? id).filter(Boolean);
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));

    const latest = await ExamSession.aggregate([
      { $match: { student: new mongoose.Types.ObjectId(studentId), test: { $in: objectIds }, challenge: null } },
      // Use updatedAt so pause/resume changes reflect immediately
      { $sort: { updatedAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$test",
          status: { $first: "$status" },
          sessionId: { $first: "$_id" },
          score: { $first: "$score" },
          maxScore: { $first: "$maxScore" },
        },
      },
    ]);

    const map = {};
    for (const row of latest) {
      const testIdStr = row._id?.toString?.();
      if (!testIdStr) continue;
      let status = "not_started";
      if (row.status === "in_progress" || row.status === "paused") status = "resume";
      else if (["completed", "expired", "abandoned"].includes(row.status)) status = "completed";
      map[testIdStr] = {
        status,
        sessionId: row.sessionId ?? null,
        score: row.score ?? 0,
        maxScore: row.maxScore ?? 0,
      };
    }
    return map;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch session statuses", error.message);
  }
};

const getRankedByTest = async (testId, studentIds = null, limit = 10, year = null) => {
  try {
    const match = {
      test: testId,
      status: "completed",
      score: { $ne: null, $gte: 0 },
      challenge: null,
    };
    if (year) {
      match.completedAt = {
        $gte: new Date(`${year}-01-01T00:00:00.000Z`),
        $lte: new Date(`${year}-12-31T23:59:59.999Z`),
      };
    }
    if (Array.isArray(studentIds) && studentIds.length) {
      // Ensure we compare ObjectIds to ObjectIds in aggregation
      const ids = studentIds
        .map((id) => (id?.toString?.() ?? id))
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id));
      match.student = { $in: ids };
    }
    const pipeline = [
      { $match: match },
      { $sort: { score: -1, completedAt: 1 } },
      {
        $group: {
          _id: "$student",
          score: { $first: "$score" },
          maxScore: { $first: "$maxScore" },
          completedAt: { $first: "$completedAt" },
        },
      },
      { $sort: { score: -1, completedAt: 1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "studentDoc",
          pipeline: [{ $project: { name: 1, email: 1 } }],
        },
      },
      { $unwind: { path: "$studentDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          student: "$_id",
          score: 1,
          maxScore: 1,
          completedAt: 1,
          name: "$studentDoc.name",
          email: "$studentDoc.email",
        },
      },
    ];
    if (Number.isInteger(limit) && limit > 0) {
      pipeline.splice(5, 0, { $limit: limit });
    }
    const ranked = await ExamSession.aggregate(pipeline);
    return ranked;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch rankings", error.message);
  }
};

const getRankedByChallenge = async (challengeId, studentIds = null, limit = 100, year = null) => {
  try {
    const match = {
      challenge: new mongoose.Types.ObjectId(challengeId),
      status: "completed",
      score: { $ne: null, $gte: 0 },
    };
    if (year) {
      match.completedAt = {
        $gte: new Date(`${year}-01-01T00:00:00.000Z`),
        $lte: new Date(`${year}-12-31T23:59:59.999Z`),
      };
    }
    if (Array.isArray(studentIds) && studentIds.length) {
      const ids = studentIds
        .map((id) => (id?.toString?.() ?? id))
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id));
      match.student = { $in: ids };
    }
    const pipeline = [
      { $match: match },
      { $sort: { score: -1, completedAt: 1 } },
      {
        $group: {
          _id: "$student",
          score: { $first: "$score" },
          maxScore: { $first: "$maxScore" },
          completedAt: { $first: "$completedAt" },
        },
      },
      { $sort: { score: -1, completedAt: 1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "studentDoc",
          pipeline: [{ $project: { name: 1, email: 1 } }],
        },
      },
      { $unwind: { path: "$studentDoc", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          student: "$_id",
          score: 1,
          maxScore: 1,
          completedAt: 1,
          name: "$studentDoc.name",
          email: "$studentDoc.email",
        },
      },
    ];
    if (Number.isInteger(limit) && limit > 0) {
      pipeline.splice(4, 0, { $limit: limit });
    }
    const ranked = await ExamSession.aggregate(pipeline);
    return ranked;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch challenge rankings", error.message);
  }
};

const countDocuments = async (filter = {}) => {
  try {
    return await ExamSession.countDocuments(filter);
  } catch (error) {
    throw new ApiError(500, "Failed to count exam sessions", error.message);
  }
};

/**
 * Latest completed session for this test in default context (no challenge / competition category).
 * Tournament and standard exam-hall attempts use this; avoids matching another completed attempt
 * for the same test (e.g. competition sector) when evaluating tournament qualification.
 */
const findLatestDefaultContextCompletedSession = async (studentId, testId) => {
  try {
    const sid =
      studentId instanceof mongoose.Types.ObjectId
        ? studentId
        : new mongoose.Types.ObjectId(String(studentId));
    const tid =
      testId instanceof mongoose.Types.ObjectId
        ? testId
        : new mongoose.Types.ObjectId(String(testId));

    let session = await ExamSession.findOne({
      student: sid,
      test: tid,
      status: "completed",
      challenge: null,
      competitionCategory: null,
    })
      .sort({ completedAt: -1, updatedAt: -1 })
      .select("score maxScore completedAt")
      .lean();

    if (!session) {
      session = await ExamSession.findOne({
        student: sid,
        test: tid,
        status: "completed",
      })
        .sort({ completedAt: -1, updatedAt: -1 })
        .select("score maxScore completedAt")
        .lean();
    }

    return session;
  } catch (error) {
    throw new ApiError(500, "Failed to fetch exam session", error.message);
  }
};

export default {
  create,
  findById,
  findOne,
  findAll,
  updateById,
  save,
  findTestById,
  findQuestionById,
  findTestPurchase,
  findAllCompletedSessions,
  findExpiredInProgressSessions,
  getSessionStatusMapByStudent,
  getRankedByTest,
  getRankedByChallenge,
  countDocuments,
  findLatestDefaultContextCompletedSession,
  findCompletedSessionsForStudentAndTests,
};

