import { ApiError } from "../utils/ApiError.js";
import tournamentRepository from "../repository/tournament.repository.js";
import testRepository from "../repository/test.repository.js";
import questionBankRepository from "../repository/questionBank.repository.js";
import QuestionBank from "../models/QuestionBank.js";
import Test from "../models/Test.js";
import walletService from "./wallet.service.js";
import eventRegistrationRepository from "../repository/eventRegistration.repository.js";
import examSessionRepository from "../repository/examSession.repository.js";
import {
  uploadImageToCloudinary,
  deleteFileFromCloudinary,
} from "../utils/s3Upload.js";
import { attachOfferToList, attachOfferToItem } from "../utils/offerUtils.js";
import { getStageStatus, getGoesLiveAt } from "../utils/eventStatus.js";
import { sendNotificationToStudent, sendTournamentEditNotification } from "./notification.service.js";
import { ensureUniqueTestTitle } from "../utils/testValidationUtils.js";

const TOURNAMENTS_IMAGE_FOLDER = "tournaments";

const stagesTestWithQuestionBankPopulate = {
  path: "stages.test",
  select: "title durationMinutes questionBank",
  populate: {
    path: "questionBank",
    select: "name categories",
    populate: { path: "categories", select: "name _id" },
  },
};

const enrichTournamentStagesWithBankStats = async (tournaments) => {
  const items = Array.isArray(tournaments) ? tournaments : [tournaments];
  const bankIds = [];
  items.forEach((t) => {
    (t?.stages || []).forEach((s) => {
      if (s?.test?.questionBank?._id) {
        bankIds.push(s.test.questionBank._id.toString());
      }
    });
  });
  const uniqueIds = [...new Set(bankIds)];
  const statsMap = await questionBankRepository.getBanksStatsBatch(uniqueIds);

  items.forEach((t) => {
    (t?.stages || []).forEach((s) => {
      if (s?.test?.questionBank?._id) {
        const key = s.test.questionBank._id.toString();
        const stats = statsMap.get(key) || { totalQuestions: 0, totalMarks: 0 };
        s.test.questionBank.totalQuestions = stats.totalQuestions;
        s.test.questionBank.totalMarks = stats.totalMarks;
      }
    });
  });
};

const clampQualifyPercent = (value) => {
  if (value == null || value === "" || Number.isNaN(Number(value))) return 0;
  return Math.min(100, Math.max(0, Number(value)));
};

/**
 * Student completed this stage's test (default exam context) and met the score % bar.
 * Only considers people who actually submitted the test; uses latest such attempt.
 */
export const studentMeetsStageScoreThreshold = async (completedStage, studentId) => {
  const testId = completedStage.test?._id || completedStage.test;
  if (!testId) return false;

  const requiredPct = clampQualifyPercent(completedStage.minimumPercentageToQualify);

  const session = await examSessionRepository.findLatestDefaultContextCompletedSession(
    studentId,
    testId
  );
  if (!session) return false;

  const score = Number(session.score ?? 0);
  const maxScore = Number(session.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0) {
    return false;
  }

  const achievedPct = (score / maxScore) * 100;
  return achievedPct >= requiredPct - 1e-9;
};

const isPaidTournamentRegistrant = async (tournamentId, studentId) => {
  const reg = await eventRegistrationRepository.findOne({
    student: studentId,
    eventType: "tournament",
    eventId: tournamentId,
    paymentStatus: "completed",
  });
  return !!reg;
};

/**
 * After `completedStage` has ended: paid registrant who completed that stage's test and met minimumPercentageToQualify.
 */
export const isStudentQualifiedAfterStage = async (completedStage, studentId, tournamentId) => {
  if (!tournamentId) return false;
  if (!(await isPaidTournamentRegistrant(tournamentId, studentId))) return false;
  if (new Date() < new Date(completedStage.endTime)) return false;
  return studentMeetsStageScoreThreshold(completedStage, studentId);
};

/**
 * Published tournament + stage that uses this test (for exam timing / results).
 */
export const getTournamentStageContextForPublishedTest = async (testId) => {
  const tournaments = await tournamentRepository.find(
    { "stages.test": testId, isPublished: true },
    { limit: 1 }
  );
  if (!tournaments?.length) return null;
  const tournament = tournaments[0];
  const ordered = [...(tournament.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const tid = testId?.toString?.() ?? String(testId);
  const idx = ordered.findIndex((s) => (s.test?._id || s.test)?.toString?.() === tid);
  if (idx === -1) return null;
  return { tournament, stage: ordered[idx], stageIndex: idx, orderedStages: ordered };
};

/**
 * Personal exam window: full test duration minus late join after stage start, capped by stage endTime.
 * `durationMinutesForQuestionPlan` names legacy shape: it is the effective session length in minutes.
 * Per-question allocation in examSession uses the test's full `durationMinutes`, not this value.
 */
export const computeTournamentAttemptTiming = (test, stage, now = new Date()) => {
  const fullMs = Math.max(0, Number(test.durationMinutes) || 0) * 60 * 1000;
  const stageStart = new Date(stage.startTime).getTime();
  const stageEnd = new Date(stage.endTime).getTime();
  const nowMs = now.getTime();
  const lateMs = Math.max(0, nowMs - stageStart);
  const remainingFromFull = Math.max(0, fullMs - lateMs);
  const remainingToStageEnd = Math.max(0, stageEnd - nowMs);
  const effectiveMs = Math.min(remainingFromFull, remainingToStageEnd);
  const MIN_MS = 60 * 1000;
  if (effectiveMs < MIN_MS) {
    throw new ApiError(
      400,
      "Not enough time remaining in this tournament round to start the test. Join when the round opens."
    );
  }
  return {
    endTime: new Date(nowMs + effectiveMs),
    durationMinutesForQuestionPlan: effectiveMs / (60 * 1000),
    lateJoinMs: lateMs,
  };
};

/**
 * Leaderboard for a tournament stage test: paid registrants only, ranked by score.
 */
export const getTournamentStageLeaderboardForStudent = async (testId, studentId) => {
  const ctx = await getTournamentStageContextForPublishedTest(testId);
  if (!ctx) return null;

  const registrations = await eventRegistrationRepository.find(
    {
      eventType: "tournament",
      eventId: ctx.tournament._id,
      paymentStatus: "completed",
    },
    { limit: 5000 }
  );
  const registeredStudentIds = [
    ...new Set(
      registrations
        .map((r) => (r.student?._id ?? r.student)?.toString?.())
        .filter(Boolean)
    ),
  ];

  const ranked = await examSessionRepository.getRankedByTest(
    testId,
    registeredStudentIds,
    20000
  );
  const top3 = ranked.slice(0, 3).map((entry, index) => ({
    rank: index + 1,
    student: entry.student,
    name: entry.name || null,
    email: entry.email || null,
    score: entry.score ?? 0,
    maxScore: entry.maxScore ?? null,
    completedAt: entry.completedAt || null,
  }));
  const sid = studentId?.toString?.() ?? String(studentId);
  const myIdx = ranked.findIndex(
    (entry) => (entry.student?._id?.toString?.() || entry.student?.toString?.()) === sid
  );
  const myRank = myIdx >= 0 ? myIdx + 1 : null;

  return {
    tournamentId: ctx.tournament._id,
    tournamentTitle: ctx.tournament.title,
    stageName: ctx.stage.name,
    stageEndTime: ctx.stage.endTime,
    top3,
    myRank,
    totalParticipants: ranked.length,
  };
};

/**
 * Build stage documents: endTime = startTime + linked test duration (minutes). Strips subject / client endTime.
 */
const normalizeTournamentStagesForPersist = async (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new ApiError(400, "At least one stage is required");
  }
  const result = [];
  for (let i = 0; i < stages.length; i++) {
    const raw = stages[i];
    const { name, test: testId, startTime } = raw;
    if (!name || !testId || !startTime) {
      throw new ApiError(400, `Stage ${i + 1} is missing required fields (name, test, startTime)`);
    }
    const test = await testRepository.findTestById(testId);
    if (!test) {
      throw new ApiError(404, `Test not found for stage ${i + 1}`);
    }
    if ((test.applicableFor ?? "test") !== "tournament") {
      throw new ApiError(400, `Stage ${i + 1}: selected test is not configured for tournaments`);
    }
    const duration = test.durationMinutes ?? 0;
    if (duration < 1) {
      throw new ApiError(400, `Stage ${i + 1}: linked test must have a valid duration`);
    }
    const start = new Date(startTime);
    const endTime = new Date(start.getTime() + duration * 60 * 1000);
    const stageDoc = {
      name,
      test: testId,
      startTime: start,
      endTime,
      minimumPercentageToQualify: clampQualifyPercent(raw.minimumPercentageToQualify),
      maxParticipants: raw.maxParticipants ?? null,
      order: i + 1,
    };
    if (raw._id) {
      stageDoc._id = raw._id;
    }
    result.push(stageDoc);
  }
  for (let i = 0; i < result.length - 1; i++) {
    if (new Date(result[i].endTime) > new Date(result[i + 1].startTime)) {
      throw new ApiError(400, "Stages must be sequential (each stage must end before the next starts)");
    }
  }
  return result;
};

export const assertStudentMayStartTournamentTest = async (testId, studentId) => {
  const tournaments = await tournamentRepository.find(
    { "stages.test": testId, isPublished: true },
    { limit: 5 }
  );
  if (!tournaments?.length) {
    throw new ApiError(403, "This test is not part of an active published tournament");
  }
  const tournament = tournaments[0];
  const ordered = [...(tournament.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const tid = testId?.toString?.() ?? String(testId);
  const idx = ordered.findIndex((s) => (s.test?._id || s.test)?.toString?.() === tid);
  if (idx === -1) {
    throw new ApiError(403, "Tournament stage not found for this test");
  }
  const reg = await eventRegistrationRepository.findOne({
    student: studentId,
    eventType: "tournament",
    eventId: tournament._id,
  });
  if (!reg || reg.paymentStatus !== "completed") {
    throw new ApiError(403, "Register and complete payment for this tournament to take this test");
  }
  const stage = ordered[idx];
  const now = new Date();
  if (now < new Date(stage.startTime) || now > new Date(stage.endTime)) {
    throw new ApiError(403, "This tournament round is not open at the moment");
  }
  if (idx > 0) {
    const prev = ordered[idx - 1];
    const ok = await isStudentQualifiedAfterStage(prev, studentId, tournament._id);
    if (!ok) {
      throw new ApiError(
        403,
        "You are not eligible for this round. Meet the minimum score percentage on the previous stage's test."
      );
    }
  }
};

const stageJoinBlockReason = ({
  paid,
  hasRegistration,
  stageStatus,
  eligible,
  sessionStatus,
  meetsPreviousStageScore,
  previousStageEnded,
  hasPreviousStage,
}) => {
  if (!hasRegistration) return "Register for this tournament to participate";
  if (!paid) return "Complete payment to join tournament rounds";
  if (stageStatus === "upcoming") return "This round has not started yet";
  if (stageStatus === "completed") return "This round has ended";
  if (stageStatus === "unknown") return "This round is not available";
  if (!eligible && hasPreviousStage && paid) {
    if (!meetsPreviousStageScore) {
      return "You did not reach the minimum score % on the previous stage (among participants who completed that test).";
    }
    if (!previousStageEnded) {
      return "The previous round is still open. Qualification for this stage is finalized after that round ends.";
    }
  }
  if (!eligible) return "You are not eligible for this round.";
  if (sessionStatus === "completed") return "You have already completed this test";
  return null;
};

/**
 * Stages with per-student canJoin / joinBlockReason for student tournament APIs.
 * Each item includes `previousStageQualification` (null on first stage): score bar vs previous round,
 * whether that round ended, and whether the student may enter this stage (paid + rules).
 */
export const buildTournamentStagesWithStudentAccess = async (tournament, studentId) => {
  const reg = await eventRegistrationRepository.findOne({
    student: studentId,
    eventType: "tournament",
    eventId: tournament._id,
  });
  const hasRegistration = !!reg;
  const paid = reg?.paymentStatus === "completed";

  const stages = tournament.stages || [];
  const ordered = [...stages].sort((a, b) => (a.order || 0) - (b.order || 0));
  const testIds = ordered.map((s) => s.test?._id || s.test).filter(Boolean);

  const sessionMap = await examSessionRepository.getSessionStatusMapByStudent(studentId, testIds);

  const out = [];
  for (let i = 0; i < ordered.length; i++) {
    const stage = ordered[i];
    const plain = stage.toObject ? stage.toObject() : { ...stage };
    const stageStatus = getStageStatus(stage);
    const testIdStr = (stage.test?._id || stage.test)?.toString?.();

    let eligible = paid;
    let meetsPreviousStageScore = true;
    let previousStageEnded = true;
    const hasPreviousStage = i > 0;
    if (hasPreviousStage) {
      const prev = ordered[i - 1];
      meetsPreviousStageScore = await studentMeetsStageScoreThreshold(prev, studentId);
      previousStageEnded = new Date() >= new Date(prev.endTime);
      if (paid) {
        eligible = await isStudentQualifiedAfterStage(prev, studentId, tournament._id);
      } else {
        eligible = false;
      }
    }

    const sessionInfo = testIdStr ? sessionMap[testIdStr] : null;
    const sessionStatus = sessionInfo?.status || "not_started";

    const joinBlockReason = stageJoinBlockReason({
      paid,
      hasRegistration,
      stageStatus,
      eligible,
      sessionStatus,
      meetsPreviousStageScore,
      previousStageEnded,
      hasPreviousStage,
    });
    const canJoin =
      paid &&
      stageStatus === "live" &&
      eligible &&
      sessionStatus !== "completed";

    const stageGoesLiveAt =
      stageStatus === "upcoming"
        ? getGoesLiveAt(
            { startTime: stage.startTime, endTime: stage.endTime },
            { onlyWithin24Hours: true }
          )
        : null;

    const previousStageQualification = hasPreviousStage
      ? {
          meetsScoreThreshold: meetsPreviousStageScore,
          previousRoundEnded: previousStageEnded,
          canAdvanceToThisStage: eligible,
        }
      : null;

    if (plain.test && typeof plain.test === "object") {
      out.push({
        ...plain,
        status: stageStatus,
        isEventLive: stageStatus === "live",
        canJoin,
        joinBlockReason,
        eligibleForStage: eligible,
        previousStageQualification,
        goesLiveAt: stageGoesLiveAt,
        test: {
          ...plain.test,
          sessionId: sessionInfo?.sessionId || null,
          testStatus: sessionStatus,
        },
      });
    } else {
      out.push({
        ...plain,
        status: stageStatus,
        isEventLive: stageStatus === "live",
        canJoin,
        joinBlockReason,
        eligibleForStage: eligible,
        previousStageQualification,
        goesLiveAt: stageGoesLiveAt,
      });
    }
  }
  return out;
};

export const createTournament = async (data, adminId, file) => {
  const {
    title,
    description,
    stages,
    registrationStartTime,
    registrationEndTime,
    price,
    firstPlacePoints,
    secondPlacePoints,
    thirdPlacePoints,
  } = data;

  if (title) {
    await ensureUniqueTestTitle(title);
  }

  let imageUrl = null;
  if (file) {
    imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      TOURNAMENTS_IMAGE_FOLDER,
      file.mimetype
    );
  }

  if (!title || !stages || !Array.isArray(stages) || stages.length === 0) {
    throw new ApiError(400, "Missing required fields: title and stages");
  }

  if (!registrationStartTime || !registrationEndTime) {
    throw new ApiError(400, "Registration times are required");
  }

  const normalizedStages = await normalizeTournamentStagesForPersist(stages);

  // Prevent reusing the same test across tournaments
  const stageTestIds = normalizedStages.map((s) => s.test).filter(Boolean);
  if (stageTestIds.length > 0) {

    // Any other tournament using one of these tests?
    const tournamentUsingTest = await tournamentRepository.findOne({
      "stages.test": { $in: stageTestIds },
    });
    if (tournamentUsingTest) {
      throw new ApiError(
        400,
        "One or more selected tests are already linked to another tournament. Please create or clone new tests for this tournament."
      );
    }
  }

  return await tournamentRepository.create({
    title,
    description,
    imageUrl,
    stages: normalizedStages,
    registrationStartTime,
    registrationEndTime,
    price: price ?? 0,
    firstPlacePoints: firstPlacePoints ?? 0,
    secondPlacePoints: secondPlacePoints ?? 0,
    thirdPlacePoints: thirdPlacePoints ?? 0,
    isPublished: data.isPublished === true || data.isPublished === "true",
    createdBy: adminId,
  });
};

/** Valid status values for server-side filtering (student list / events). */
const VALID_STATUSES = ["close", "closed", "open", "upcoming", "live", "completed"];

const buildStatusQuery = (status) => {
  const now = new Date();
  switch (status) {
    case "close":
    case "closed":
      return {
        registrationEndTime: { $lt: now },
        $expr: { $gt: [{ $min: "$stages.startTime" }, now] },
      };
    case "upcoming":
      return { registrationStartTime: { $gt: now } };
    case "open":
      return {
        $and: [
          { registrationStartTime: { $lte: now } },
          { registrationEndTime: { $gte: now } },
        ],
      };
    case "live":
      // Live only when ANY stage is live (avoid "live" during gaps)
      return {
        stages: {
          $elemMatch: {
            startTime: { $lte: now },
            endTime: { $gte: now },
          },
        },
      };
    case "completed":
      return { $expr: { $gt: [now, { $max: "$stages.endTime" }] } };
    default:
      return null;
  }
};

export const getTournaments = async (options = {}) => {
  const { page = 1, limit = 10, search, isPublished, status, category, studentId } = options;

  const query = {};
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  if (isPublished !== undefined) {
    query.isPublished = isPublished === "true" || isPublished === true;
  }
  const rawStatus =
    typeof status === "string" ? status.trim().toLowerCase() : null;
  const normalizedStatus = rawStatus === "closed" ? "close" : rawStatus;
  if (normalizedStatus && VALID_STATUSES.includes(normalizedStatus)) {
    const statusQuery = buildStatusQuery(normalizedStatus);
    if (statusQuery) Object.assign(query, statusQuery);
  }

  if (category) {
    const bankIds = await QuestionBank.find({ categories: category }).distinct("_id");
    if (bankIds.length > 0) {
      const testIds = await Test.find({ questionBank: { $in: bankIds } }).distinct("_id");
      if (testIds.length > 0) {
        query["stages.test"] = { $in: testIds };
      } else {
        query["stages.test"] = { $in: [] };
      }
    } else {
      query["stages.test"] = { $in: [] };
    }
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const [tournamentsRaw, total] = await Promise.all([
    tournamentRepository.find(query, {
      populate: [
        stagesTestWithQuestionBankPopulate,
        { path: "createdBy", select: "name email" },
      ],
      sort: { createdAt: -1 },
      skip,
      limit: limitNum,
    }),
    tournamentRepository.count(query),
  ]);

  await enrichTournamentStagesWithBankStats(tournamentsRaw);

  const tournamentsWithOffer = await attachOfferToList(tournamentsRaw, "Tournament", "price");

  if (studentId && tournamentsWithOffer.length > 0) {
    const registrations = await eventRegistrationRepository.find({
      student: studentId,
      eventType: "tournament",
      eventId: { $in: tournamentsWithOffer.map((t) => t._id) },
      paymentStatus: "completed",
    });
    const registeredIds = new Set(registrations.map((r) => r.eventId?.toString() || r.eventId));
    tournamentsWithOffer.forEach((t) => {
      t.purchased = registeredIds.has(t._id.toString());
    });
  }

  return {
    tournaments: tournamentsWithOffer,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

export const getTournamentById = async (id, isAdmin = false) => {
  const populateFields = [
    stagesTestWithQuestionBankPopulate,
    { path: "createdBy", select: "name email" },
  ];

  const tournament = await tournamentRepository.findById(id, populateFields);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }
  await enrichTournamentStagesWithBankStats(tournament);
  return await attachOfferToItem(tournament, "Tournament", "price");
};

const toISO = (v) => (v ? new Date(v).toISOString() : null);
const fmtDate = (v) =>
  v
    ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : "—";

export const updateTournament = async (id, updateData, file, adminId) => {
  if (updateData.title) {
    await ensureUniqueTestTitle(updateData.title, id, "Tournament");
  }

  const tournament = await tournamentRepository.findById(id);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }

  // ── Snapshot old values for change-detection ──
  const oldTitle = tournament.title;
  const oldRegStart = toISO(tournament.registrationStartTime);
  const oldRegEnd = toISO(tournament.registrationEndTime);
  const oldStages = (tournament.stages || []).map((s) => ({
    name: s.name,
    startTime: toISO(s.startTime),
    endTime: toISO(s.endTime),
  }));

  if (file) {
    if (tournament.imageUrl) {
      await deleteFileFromCloudinary(tournament.imageUrl);
    }
    updateData.imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      TOURNAMENTS_IMAGE_FOLDER,
      file.mimetype
    );
  }

  // Validate stages if provided
  if (updateData.stages && Array.isArray(updateData.stages)) {
    updateData.stages = await normalizeTournamentStagesForPersist(updateData.stages);

    // Prevent reusing the same test across tournaments (excluding this tournament)
    const stageTestIds = updateData.stages.map((s) => s.test).filter(Boolean);
    if (stageTestIds.length > 0) {
      const tournamentUsingTest = await tournamentRepository.findOne({
        _id: { $ne: id },
        "stages.test": { $in: stageTestIds },
      });
      if (tournamentUsingTest) {
        throw new ApiError(
          400,
          "One or more selected tests are already linked to another tournament. Please create or clone new tests for this tournament."
        );
      }
    }
  }

  const updated = await tournamentRepository.updateById(id, updateData);

  // ── Build changed-fields list for notification ──
  try {
    const newTitle = updateData.title ?? oldTitle;
    const changedFields = [];

    if (updateData.title && updateData.title !== oldTitle) {
      changedFields.push(`Title ("${oldTitle}" → "${updateData.title}")`);
    }
    if (updateData.registrationStartTime && toISO(updateData.registrationStartTime) !== oldRegStart) {
      changedFields.push(`Registration start date (→ ${fmtDate(updateData.registrationStartTime)})`);
    }
    if (updateData.registrationEndTime && toISO(updateData.registrationEndTime) !== oldRegEnd) {
      changedFields.push(`Registration end date (→ ${fmtDate(updateData.registrationEndTime)})`);
    }
    if (updateData.stages && Array.isArray(updateData.stages)) {
      updateData.stages.forEach((newStage) => {
        const old = oldStages.find((o) => o.name === newStage.name);
        if (old && toISO(newStage.startTime) !== old.startTime) {
          changedFields.push(`${newStage.name} start time (→ ${fmtDate(newStage.startTime)})`);
        }
        if (old && toISO(newStage.endTime) !== old.endTime) {
          changedFields.push(`${newStage.name} end time (→ ${fmtDate(newStage.endTime)})`);
        }
      });
    }

    // Only fire notification if something meaningful changed
    if (changedFields.length > 0) {
      await sendTournamentEditNotification(
        id,
        newTitle,
        adminId || null,
        oldTitle,
        changedFields
      );
    }
  } catch (notifyErr) {
    console.error("Tournament edit notification failed:", notifyErr);
  }

  return updated;
};

export const deleteTournament = async (id) => {
  const tournament = await tournamentRepository.findById(id);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }
  if (tournament.imageUrl) {
    await deleteFileFromCloudinary(tournament.imageUrl);
  }
  return await tournamentRepository.deleteById(id);
};

/**
 * Get leaderboard for a tournament: ranked by score in the Final stage (or last stage by order).
 * Only registered participants with payment completed are included.
 */
export const getTournamentLeaderboard = async (tournamentId, limit = 20) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }
  const stages = tournament.stages || [];
  const finalStage = stages.find((s) => s.name === "Final") || stages.slice().sort((a, b) => (b.order || 0) - (a.order || 0))[0];
  if (!finalStage || !finalStage.test) {
    return { leaderboard: [], tournamentTitle: tournament.title, stage: null };
  }
  const registrations = await eventRegistrationRepository.find(
    {
      eventType: "tournament",
      eventId: tournamentId,
      paymentStatus: "completed",
    },
    { limit: 5000 }
  );
  const registeredStudentIds = [
    ...new Set(
      registrations
        .map((r) => (r.student?._id ?? r.student)?.toString?.())
        .filter(Boolean)
    ),
  ];
  if (registeredStudentIds.length === 0) {
    return { leaderboard: [], tournamentTitle: tournament.title, stage: finalStage.name };
  }
  const ranked = await examSessionRepository.getRankedByTest(
    finalStage.test,
    registeredStudentIds,
    limit
  );
  const leaderboard = ranked.map((r, index) => ({
    rank: index + 1,
    student: r.student,
    name: r.name,
    email: r.email,
    score: r.score,
    maxScore: r.maxScore,
    completedAt: r.completedAt,
  }));
  return { leaderboard, tournamentTitle: tournament.title, stage: finalStage.name };
};

/**
 * Declare winners and credit points.
 * Body: { firstPlace?, secondPlace?, thirdPlace? } (student IDs), or { autoCalculate: true } to set 1st/2nd/3rd from leaderboard (Final stage score).
 */
export const declareTournamentWinners = async (tournamentId, winners) => {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }

  let firstPlace = winners.firstPlace;
  let secondPlace = winners.secondPlace;
  let thirdPlace = winners.thirdPlace;

  if (winners.autoCalculate) {
    const { leaderboard } = await getTournamentLeaderboard(tournamentId, 3);
    firstPlace = leaderboard[0]?.student?.toString?.() || leaderboard[0]?.student;
    secondPlace = leaderboard[1]?.student?.toString?.() || leaderboard[1]?.student;
    thirdPlace = leaderboard[2]?.student?.toString?.() || leaderboard[2]?.student;
    if (!firstPlace && !secondPlace && !thirdPlace) {
      throw new ApiError(400, "No completed attempts found for Final stage to auto-calculate winners");
    }
  }

  const results = [];
  const placeLabels = { firstPlace: "1st", secondPlace: "2nd", thirdPlace: "3rd" };
  const places = [
    { key: "firstPlace", points: tournament.firstPlacePoints || 0, studentId: firstPlace },
    { key: "secondPlace", points: tournament.secondPlacePoints || 0, studentId: secondPlace },
    { key: "thirdPlace", points: tournament.thirdPlacePoints || 0, studentId: thirdPlace },
  ];

  for (const place of places) {
    const studentId = place.studentId;
    if (!studentId || place.points < 1) continue;
    try {
      await walletService.addRewardPoints(
        studentId,
        place.points,
        "tournament_win",
        `Winner (${place.key.replace("Place", "")} place) - ${tournament.title}`,
        tournamentId,
        "Tournament"
      );
      results.push({ place: place.key, studentId, points: place.points });
      try {
        await sendNotificationToStudent(
          studentId,
          `You placed ${placeLabels[place.key]} — ${tournament.title}`,
          `You earned ${place.points} reward points. They are added to your wallet and transaction history.`,
          {
            type: "event",
            tournamentId: tournamentId.toString(),
            notificationKind: "tournament_prize",
            place: place.key,
            points: String(place.points),
          },
          null
        );
      } catch (notifyErr) {
        console.error("Tournament winner push notification failed:", notifyErr);
      }
    } catch (e) {
      throw new ApiError(400, `Failed to credit ${place.key}: ${e.message}`);
    }
  }

  return { tournament: tournament.title, results };
};

export default {
  createTournament,
  getTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament,
  getTournamentLeaderboard,
  declareTournamentWinners,
  assertStudentMayStartTournamentTest,
  buildTournamentStagesWithStudentAccess,
  isStudentQualifiedAfterStage,
  studentMeetsStageScoreThreshold,
  getTournamentStageContextForPublishedTest,
  computeTournamentAttemptTiming,
  getTournamentStageLeaderboardForStudent,
};

