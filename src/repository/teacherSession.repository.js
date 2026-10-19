import mongoose from "mongoose";
import TeacherSession from "../models/TeacherSession.js";
import User from "../models/Student.js";
import { ApiError } from "../utils/ApiError.js";

const teacherEarningExpression = {
  $cond: [
    { $gt: [{ $ifNull: ["$teacherAmount", 0] }, 0] },
    "$teacherAmount",
    {
      $cond: [
        { $gt: [{ $ifNull: ["$platformFeeAmount", 0] }, 0] },
        {
          $max: [
            0,
            {
              $subtract: [
                { $ifNull: ["$totalAmount", 0] },
                { $ifNull: ["$platformFeeAmount", 0] },
              ],
            },
          ],
        },
        {
          $cond: [
            {
              $and: [
                { $gt: [{ $ifNull: ["$teacherPerMinuteRate", 0] }, 0] },
                { $gt: [{ $ifNull: ["$durationMinutes", 0] }, 0] },
              ],
            },
            {
              $multiply: [
                { $ifNull: ["$teacherPerMinuteRate", 0] },
                { $ifNull: ["$durationMinutes", 0] },
              ],
            },
            { $ifNull: ["$totalAmount", 0] },
          ],
        },
      ],
    },
  ],
};

const getTeacherEarningAmount = (session) => {
  const teacherRate = Number(session?.teacherPerMinuteRate || 0);
  const durationMinutes = Number(session?.durationMinutes || 0);
  const totalAmount = Number(session?.totalAmount || 0);
  const storedTeacherAmount = Number(session?.teacherAmount || 0);
  const storedPlatformFee = Number(session?.platformFeeAmount || 0);

  if (teacherRate > 0 && durationMinutes > 0) {
    return Math.round((teacherRate * durationMinutes + Number.EPSILON) * 100) / 100;
  }

  if (storedTeacherAmount > 0) {
    if (
      storedPlatformFee > 0 &&
      Math.abs(storedTeacherAmount - storedPlatformFee) < 0.01 &&
      totalAmount > storedTeacherAmount + storedPlatformFee + 0.01
    ) {
      return Math.max(0, Math.round((totalAmount - storedPlatformFee + Number.EPSILON) * 100) / 100);
    }
    return storedTeacherAmount;
  }

  if (totalAmount > 0 && storedPlatformFee >= 0) {
    return Math.max(0, Math.round((totalAmount - storedPlatformFee + Number.EPSILON) * 100) / 100);
  }

  return 0;
};

const create = async (sessionData) => {
  try {
    const session = await TeacherSession.create(sessionData);
    return await TeacherSession.findById(session._id)
      .populate("student", "name email")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to create teacher session", error.message);
  }
};

const findById = async (sessionId) => {
  try {
    return await TeacherSession.findById(sessionId)
      .populate("student", "name email")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch session", error.message);
  }
};

const findOne = async (filter) => {
  try {
    return await TeacherSession.findOne(filter)
      .populate("student", "name email")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch session", error.message);
  }
};

const updateById = async (sessionId, updateData) => {
  try {
    return await TeacherSession.findByIdAndUpdate(
      sessionId,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("student", "name email")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to update session", error.message);
  }
};

const completeOngoingSession = async (sessionId, updateData) => {
  try {
    return await TeacherSession.findOneAndUpdate(
      {
        _id: sessionId,
        status: "ongoing",
      },
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("student", "name email")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to complete session", error.message);
  }
};

const findStudentSessions = async (studentId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      sessionKind,
      hasRecording,
      teacherId,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = options;

    const query = { student: studentId };
    if (status) {
      query.status = status;
    }
    if (sessionKind) {
      query.sessionKind = sessionKind;
    }
    if (hasRecording) {
      query.recordingUrl = { $exists: true, $nin: [null, ""] };
    }
    if (teacherId) {
      query.teacher = teacherId;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [sessions, total] = await Promise.all([
      TeacherSession.find(query)
        .populate("teacher", "name email skills perMinuteRate platformFeePercent")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      TeacherSession.countDocuments(query),
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
    throw new ApiError(500, "Failed to fetch student sessions", error.message);
  }
};

const findTeacherSessions = async (teacherId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = options;

    const match = { teacher: teacherId };
    if (status) {
      match.status = status;
    }

    const searchTrim = typeof search === "string" ? search.trim() : "";
    let finalQuery = match;
    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      const matchingStudents = await User.find({
        $or: [{ name: rx }, { email: rx }],
      })
        .select("_id")
        .lean();
      const studentIds = matchingStudents.map((s) => s._id);
      const orConditions = [
        { subject: rx },
        { status: rx },
        { sessionKind: rx },
      ];
      if (studentIds.length > 0) {
        orConditions.push({ student: { $in: studentIds } });
      }
      finalQuery = { $and: [match, { $or: orConditions }] };
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

    const [sessions, total] = await Promise.all([
      TeacherSession.find(finalQuery)
        .populate("student", "name email")
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      TeacherSession.countDocuments(finalQuery),
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
    throw new ApiError(500, "Failed to fetch teacher sessions", error.message);
  }
};

const findPendingRequests = async (teacherId) => {
  try {
    return await TeacherSession.find({
      teacher: teacherId,
      status: "pending",
    })
      .populate("student", "name email")
      .sort({ createdAt: -1 });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch pending requests", error.message);
  }
};

const findOngoingSession = async (studentId, teacherId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      teacher: teacherId,
      status: "ongoing",
    });
  } catch (error) {
    throw new ApiError(500, "Failed to fetch ongoing session", error.message);
  }
};

const deleteById = async (sessionId) => {
  try {
    return await TeacherSession.findByIdAndDelete(sessionId);
  } catch (error) {
    throw new ApiError(500, "Failed to delete session", error.message);
  }
};

/** Teacher is in an active chat session (billing / messaging). */
const findTeacherActiveChatSession = async (teacherId) => {
  try {
    return await TeacherSession.findOne({
      teacher: teacherId,
      sessionKind: "chat",
      status: "ongoing",
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch teacher chat session", error.message);
  }
};

const findStudentOngoingChatSession = async (studentId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      sessionKind: "chat",
      status: "ongoing",
    })
      .sort({ createdAt: -1 })
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch student chat session", error.message);
  }
};

const findPendingChatBetween = async (studentId, teacherId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      teacher: teacherId,
      sessionKind: "chat",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch pending chat", error.message);
  }
};

const findTeacherPendingChatSession = async (teacherId) => {
  try {
    return await TeacherSession.findOne({
      teacher: teacherId,
      sessionKind: "chat",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch teacher pending chat session", error.message);
  }
};

const findPendingCallBetween = async (studentId, teacherId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      teacher: teacherId,
      sessionKind: "call",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch pending call", error.message);
  }
};

const findTeacherPendingCallSession = async (teacherId) => {
  try {
    return await TeacherSession.findOne({
      teacher: teacherId,
      sessionKind: "call",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch teacher pending call session", error.message);
  }
};

/** Ongoing Agora/voice call (not chat). Supports both accepted and ongoing. */
const findTeacherActiveCallSession = async (teacherId) => {
  try {
    return await TeacherSession.findOne({
      teacher: teacherId,
      sessionKind: "call",
      status: { $in: ["accepted", "ongoing"] },
    })
      .sort({ createdAt: -1 })
      .populate("student", "name email phone classOrGrade profileImage")
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch teacher call session", error.message);
  }
};

const findStudentOngoingCallSession = async (studentId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      sessionKind: "call",
      status: { $in: ["accepted", "ongoing"] },
    })
      .sort({ createdAt: -1 })
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch student call session", error.message);
  }
};

const findStudentPendingCallSession = async (studentId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      sessionKind: "call",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch student pending call session", error.message);
  }
};

const findStudentPendingChatSession = async (studentId) => {
  try {
    return await TeacherSession.findOne({
      student: studentId,
      sessionKind: "chat",
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("teacher", "name email skills perMinuteRate platformFeePercent profileImage");
  } catch (error) {
    throw new ApiError(500, "Failed to fetch student pending chat session", error.message);
  }
};

/** Start/end of "today" in IST (Asia/Kolkata), as UTC Date objects for querying stored timestamps. */
const getIstDayBoundsUtc = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const dateStr = `${y}-${m}-${d}`;
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);
  return { start, end };
};

/**
 * Lifetime income (same basis as earnings API), completed session count (chat + call),
 * and today's total duration minutes (IST calendar day, by callEndTime).
 */
const getTeacherDashboardSessionAggregates = async (teacherId) => {
  try {
    const tid =
      typeof teacherId === "string" ? new mongoose.Types.ObjectId(teacherId) : teacherId;
    const { start, end } = getIstDayBoundsUtc();

    const [incomeRow, totalCompletedSessions, todayRow] = await Promise.all([
      TeacherSession.aggregate([
        { $match: { teacher: tid, status: "completed", amountDeducted: true } },
        {
          $group: {
            _id: null,
            totalIncome: { $sum: teacherEarningExpression },
          },
        },
      ]),
      TeacherSession.countDocuments({ teacher: tid, status: "completed" }),
      TeacherSession.aggregate([
        {
          $match: {
            teacher: tid,
            status: "completed",
            callEndTime: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, totalMinutes: { $sum: "$durationMinutes" } } },
      ]),
    ]);

    return {
      totalIncome: incomeRow[0]?.totalIncome ?? 0,
      totalCompletedSessions,
      todayTalktimeMinutes: todayRow[0]?.totalMinutes ?? 0,
    };
  } catch (error) {
    throw new ApiError(500, "Failed to calculate dashboard stats", error.message);
  }
};

const calculateTeacherEarnings = async (teacherId, startDate, endDate) => {
  try {
    const query = {
      teacher: teacherId,
      status: "completed",
      amountDeducted: true,
    };

    if (startDate || endDate) {
      query.callEndTime = {};
      if (startDate) query.callEndTime.$gte = new Date(startDate);
      if (endDate) query.callEndTime.$lte = new Date(endDate);
    }

    const sessions = await TeacherSession.find(query);
    const totalEarnings = sessions.reduce(
      (sum, session) => sum + getTeacherEarningAmount(session),
      0
    );
    const totalSessions = sessions.length;
    const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);

    return {
      totalEarnings,
      totalSessions,
      totalMinutes,
      averageEarningPerSession: totalSessions > 0 ? totalEarnings / totalSessions : 0,
    };
  } catch (error) {
    throw new ApiError(500, "Failed to calculate earnings", error.message);
  }
};

const findCallConversationsByStudent = async (studentId, options = {}) => {
  try {
    const { page = 1, limit = 20, search, requireRecording = true } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const searchTrim = typeof search === "string" ? search.trim() : "";

    const matchStage = {
      student: new mongoose.Types.ObjectId(String(studentId)),
      sessionKind: "call",
      status: "completed",
    };
    if (requireRecording) {
      matchStage.recordingUrl = { $exists: true, $nin: [null, ""] };
    }

    const pipeline = [
      { $match: matchStage },
      { $sort: { callEndTime: -1 } },
      {
        $group: {
          _id: "$teacher",
          recordingCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$recordingUrl", null] },
                    { $ne: ["$recordingUrl", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          callCount: { $sum: 1 },
          totalDurationMinutes: { $sum: { $ifNull: ["$durationMinutes", 0] } },
          lastCallEndTime: { $max: "$callEndTime" },
          latestSubject: { $first: "$subject" },
          latestRecordingUrl: { $first: "$recordingUrl" },
        },
      },
      { $sort: { lastCallEndTime: -1 } },
      {
        $lookup: {
          from: "teachers",
          localField: "_id",
          foreignField: "_id",
          as: "teacherDoc",
        },
      },
      { $unwind: "$teacherDoc" },
    ];

    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      pipeline.push({
        $match: {
          $or: [
            { "teacherDoc.name": rx },
            { "teacherDoc.skills": rx },
            { latestSubject: rx },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              teacherId: "$_id",
              teacher: {
                _id: "$teacherDoc._id",
                name: "$teacherDoc.name",
                profileImage: "$teacherDoc.profileImage",
                skills: "$teacherDoc.skills",
              },
              recordingCount: 1,
              callCount: 1,
              totalDurationMinutes: 1,
              lastCallEndTime: 1,
              latestSubject: 1,
              latestRecordingUrl: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const [result] = await TeacherSession.aggregate(pipeline);
    const conversations = result?.data || [];
    const total = result?.total?.[0]?.count || 0;

    return {
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch call conversations", error.message);
  }
};

const findCallRecordingsByStudentAndTeacher = async (
  studentId,
  teacherId,
  options = {}
) => {
  try {
    const { page = 1, limit = 50 } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = {
      student: studentId,
      teacher: teacherId,
      sessionKind: "call",
      status: "completed",
      recordingUrl: { $exists: true, $nin: [null, ""] },
    };

    const [sessions, total] = await Promise.all([
      TeacherSession.find(query)
        .populate("teacher", "name email skills profileImage")
        .sort({ callEndTime: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TeacherSession.countDocuments(query),
    ]);

    return {
      recordings: sessions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch call recordings", error.message);
  }
};

const findCallConversationsByTeacher = async (teacherId, options = {}) => {
  try {
    const { page = 1, limit = 20, search } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const searchTrim = typeof search === "string" ? search.trim() : "";

    const pipeline = [
      {
        $match: {
          teacher: new mongoose.Types.ObjectId(String(teacherId)),
          sessionKind: "call",
          status: "completed",
        },
      },
      { $sort: { callEndTime: -1 } },
      {
        $group: {
          _id: "$student",
          callCount: { $sum: 1 },
          recordingCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$recordingUrl", null] },
                    { $ne: ["$recordingUrl", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalDurationMinutes: { $sum: { $ifNull: ["$durationMinutes", 0] } },
          lastCallEndTime: { $max: "$callEndTime" },
          latestSubject: { $first: "$subject" },
        },
      },
      { $sort: { lastCallEndTime: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "studentDoc",
        },
      },
      { $unwind: "$studentDoc" },
    ];

    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      pipeline.push({
        $match: {
          $or: [
            { "studentDoc.name": rx },
            { "studentDoc.email": rx },
            { "studentDoc.phone": rx },
            { latestSubject: rx },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              studentId: "$_id",
              student: {
                _id: "$studentDoc._id",
                name: "$studentDoc.name",
                profileImage: "$studentDoc.profileImage",
                email: "$studentDoc.email",
                phone: "$studentDoc.phone",
              },
              callCount: 1,
              recordingCount: 1,
              totalDurationMinutes: 1,
              lastCallEndTime: 1,
              latestSubject: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const [result] = await TeacherSession.aggregate(pipeline);
    const conversations = result?.data || [];
    const total = result?.total?.[0]?.count || 0;

    return {
      conversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch call conversations", error.message);
  }
};

const findStudentsWithCallLogs = async (options = {}) => {
  try {
    const { page = 1, limit = 20, search } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const searchTrim = typeof search === "string" ? search.trim() : "";

    const pipeline = [
      {
        $match: {
          sessionKind: "call",
          status: "completed",
        },
      },
      { $sort: { callEndTime: -1 } },
      {
        $group: {
          _id: "$student",
          callCount: { $sum: 1 },
          recordingCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$recordingUrl", null] },
                    { $ne: ["$recordingUrl", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalDurationMinutes: { $sum: { $ifNull: ["$durationMinutes", 0] } },
          lastCallEndTime: { $max: "$callEndTime" },
          latestSubject: { $first: "$subject" },
          teacherIds: { $addToSet: "$teacher" },
        },
      },
      { $sort: { lastCallEndTime: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "studentDoc",
        },
      },
      { $unwind: "$studentDoc" },
    ];

    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      pipeline.push({
        $match: {
          $or: [
            { "studentDoc.name": rx },
            { "studentDoc.email": rx },
            { "studentDoc.phone": rx },
            { latestSubject: rx },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              studentId: "$_id",
              student: {
                _id: "$studentDoc._id",
                name: "$studentDoc.name",
                profileImage: "$studentDoc.profileImage",
                email: "$studentDoc.email",
                phone: "$studentDoc.phone",
              },
              callCount: 1,
              recordingCount: 1,
              conversationCount: { $size: "$teacherIds" },
              totalDurationMinutes: 1,
              lastCallEndTime: 1,
              latestSubject: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const [result] = await TeacherSession.aggregate(pipeline);
    const students = result?.data || [];
    const total = result?.total?.[0]?.count || 0;

    return {
      students,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch students with call logs", error.message);
  }
};

const findTeachersWithCallLogs = async (options = {}) => {
  try {
    const { page = 1, limit = 20, search } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const searchTrim = typeof search === "string" ? search.trim() : "";

    const pipeline = [
      {
        $match: {
          sessionKind: "call",
          status: "completed",
        },
      },
      { $sort: { callEndTime: -1 } },
      {
        $group: {
          _id: "$teacher",
          callCount: { $sum: 1 },
          recordingCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$recordingUrl", null] },
                    { $ne: ["$recordingUrl", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalDurationMinutes: { $sum: { $ifNull: ["$durationMinutes", 0] } },
          lastCallEndTime: { $max: "$callEndTime" },
          latestSubject: { $first: "$subject" },
          studentIds: { $addToSet: "$student" },
        },
      },
      { $sort: { lastCallEndTime: -1 } },
      {
        $lookup: {
          from: "teachers",
          localField: "_id",
          foreignField: "_id",
          as: "teacherDoc",
        },
      },
      { $unwind: "$teacherDoc" },
    ];

    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      pipeline.push({
        $match: {
          $or: [
            { "teacherDoc.name": rx },
            { "teacherDoc.skills": rx },
            { latestSubject: rx },
          ],
        },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              teacherId: "$_id",
              teacher: {
                _id: "$teacherDoc._id",
                name: "$teacherDoc.name",
                profileImage: "$teacherDoc.profileImage",
                skills: "$teacherDoc.skills",
              },
              callCount: 1,
              recordingCount: 1,
              conversationCount: { $size: "$studentIds" },
              totalDurationMinutes: 1,
              lastCallEndTime: 1,
              latestSubject: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const [result] = await TeacherSession.aggregate(pipeline);
    const teachers = result?.data || [];
    const total = result?.total?.[0]?.count || 0;

    return {
      teachers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch teachers with call logs", error.message);
  }
};

const findCallSessionsByStudentAndTeacher = async (
  studentId,
  teacherId,
  options = {}
) => {
  try {
    const { page = 1, limit = 50 } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = {
      student: studentId,
      teacher: teacherId,
      sessionKind: "call",
      status: "completed",
    };

    const [sessions, total] = await Promise.all([
      TeacherSession.find(query)
        .populate("teacher", "name email skills profileImage")
        .populate("student", "name email phone profileImage")
        .sort({ callEndTime: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TeacherSession.countDocuments(query),
    ]);

    return {
      calls: sessions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    };
  } catch (error) {
    throw new ApiError(500, "Failed to fetch call sessions", error.message);
  }
};

const findChatSessionsByStudentAndTeacher = async (
  studentId,
  teacherId,
  options = {}
) => {
  try {
    const { page = 1, limit = 50 } = options;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = {
      student: studentId,
      teacher: teacherId,
      sessionKind: "chat",
      status: "completed",
    };

    const [sessions, total] = await Promise.all([
      TeacherSession.find(query)
        .populate("teacher", "name email skills profileImage")
        .populate("student", "name email phone profileImage")
        .sort({ callEndTime: -1, chatStartedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TeacherSession.countDocuments(query),
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
    throw new ApiError(500, "Failed to fetch chat sessions", error.message);
  }
};

export default {
  create,
  findById,
  findOne,
  updateById,
  completeOngoingSession,
  deleteById,
  findStudentSessions,
  findCallConversationsByStudent,
  findCallConversationsByTeacher,
  findCallRecordingsByStudentAndTeacher,
  findCallSessionsByStudentAndTeacher,
  findChatSessionsByStudentAndTeacher,
  findStudentsWithCallLogs,
  findTeachersWithCallLogs,
  findTeacherSessions,
  findPendingRequests,
  findOngoingSession,
  findTeacherActiveChatSession,
  findStudentOngoingChatSession,
  findPendingChatBetween,
  findPendingCallBetween,
  findTeacherPendingCallSession,
  findTeacherPendingChatSession,
  findStudentPendingCallSession,
  findStudentPendingChatSession,
  findTeacherActiveCallSession,
  findStudentOngoingCallSession,
  calculateTeacherEarnings,
  getTeacherDashboardSessionAggregates,
};

