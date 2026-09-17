import { ApiError } from "../utils/ApiError.js";
import OlympiadTest from "../models/OlympiadTest.js";
import examSessionRepository from "../repository/examSession.repository.js";
import orderRepository from "../repository/order.repository.js";
import testRepository from "../repository/test.repository.js";
import tournamentRepository from "../repository/tournament.repository.js";
import eventRegistrationRepository from "../repository/eventRegistration.repository.js";
import questionBankRepository from "../repository/questionBank.repository.js";
import aiQuestionBankRepository from "../repository/aiQuestionBank.repository.js";
import questionRepository from "../repository/question.repository.js";
import {
  getQuestionsForTest,
  getSectionConfigForTiming,
  getBankDisplayName,
  getBankCategories,
  getTestBankType,
} from "../utils/testBankResolver.js";
import {
  findQuestionsByIds,
  findQuestionById,
} from "../utils/questionLookup.js";
import categoryRepository from "../repository/category.repository.js";
import categoryPurchaseRepository from "../repository/categoryPurchase.repository.js";
import examAnalysisService from "./examAnalysis.service.js";
import pointsService from "./points.service.js";
import everydayChallengeService from "./everydayChallenge.service.js";
import everydayChallengeCompletionRepository from "../repository/everydayChallengeCompletion.repository.js";
import challengeYourselfService from "./challengeYourself.service.js";

import tournamentService from "./tournament.service.js";
import { issueCourseCompletionCertificate } from "./certificate.service.js";
import courseTestLinkRepository from "../repository/courseTestLink.repository.js";

const hasCompletedRegistrationForLinkedEventTest = async (testId, studentId) => {
  const linkedTournaments = await tournamentRepository.find(
    { "stages.test": testId, isPublished: true },
    { limit: 1000 }
  );

  const tournamentIds = linkedTournaments.map((t) => t?._id).filter(Boolean);

  if (tournamentIds.length > 0) {
    const tournamentRegistration = await eventRegistrationRepository.findOne({
      student: studentId,
      eventType: "tournament",
      eventId: { $in: tournamentIds },
      paymentStatus: "completed",
    });
    if (tournamentRegistration) return true;
  }

  const linkedOlympiads = await OlympiadTest.find({ testId }).lean();
  const olympiadIds = linkedOlympiads.map((o) => o?._id).filter(Boolean);
  if (olympiadIds.length > 0) {
    const olympiadRegistration = await eventRegistrationRepository.findOne({
      student: studentId,
      eventType: "olympiad",
      eventId: { $in: olympiadIds },
      paymentStatus: "completed",
    });
    if (olympiadRegistration) return true;
  }

  return false;
};

// Pillar tests (Competitive / School / Skill Development) allow unlimited retakes.
const RETAKEABLE_PILLAR_TESTS = ["Competitive", "School", "Skill Development"];

export const checkStudentAccessForPaidTest = async (testId, studentId, categoryId = null) => {
  if (categoryId) {
    const hasCategoryAccess = await categoryPurchaseRepository.checkAccess(studentId, categoryId);
    if (hasCategoryAccess) {
      return { hasAccess: true, accessType: "category_purchase" };
    }
  }

  let purchase = await orderRepository.findTestPurchase({
    student: studentId,
    test: testId,
    paymentStatus: "completed",
  });
  if (purchase) {
    return { hasAccess: true, accessType: "direct_test_purchase" };
  }



  const bundleIdsContainingTest = await testRepository.findBundleIdsContainingTest(testId);
  if (bundleIdsContainingTest.length > 0) {
    purchase = await orderRepository.findTestPurchase({
      student: studentId,
      testBundle: { $in: bundleIdsContainingTest },
      paymentStatus: "completed",
    });
    if (purchase) {
      return { hasAccess: true, accessType: "test_bundle_purchase" };
    }
  }

  // Access via purchased certification course that links this test
  const coursePurchases =
    (await orderRepository.findCoursePurchases(studentId)) || [];
  if (coursePurchases.length > 0) {
    const courseIds = coursePurchases
      .map((p) => p.course?._id || p.course)
      .filter(Boolean);
    if (courseIds.length > 0) {
      const links = await courseTestLinkRepository.findAll(
        { course: { $in: courseIds }, test: testId },
        { sortBy: "order", sortOrder: "asc" }
      );
      if (links && links.length > 0) {
        return { hasAccess: true, accessType: "certification_course_purchase" };
      }
    }
  }

  const hasLinkedEventAccess = await hasCompletedRegistrationForLinkedEventTest(
    testId,
    studentId
  );
  if (hasLinkedEventAccess) {
    return { hasAccess: true, accessType: "linked_event_registration" };
  }

  return { hasAccess: false, accessType: null };
};

const checkStudentAccessForPaidChallengeYourselfTest = async (testId, studentId) => {
  const purchase = await orderRepository.findTestPurchase({
    student: studentId,
    test: testId,
    paymentStatus: "completed",
  });
  if (purchase) {
    return { hasAccess: true, accessType: "direct_test_purchase" };
  }
  return { hasAccess: false, accessType: null };
};

const awardCompletionPoints = async (studentId, session, test) => {
  if (!test) return;
  if (test.applicableFor === "everyday_challenge") {
    await everydayChallengeService.recordCompletion(studentId, session);
    return;
  }

  // NOTE: challenge_yourself points are now awarded only upon purchase (handled in marketplace service).
  // awardChallengeYourselfCompletionPoints has been disabled.


  // Reward points are now awarded on purchase, not completion.
};

const buildCategoryPath = (categoryId, categoryMap) => {
  const node = categoryMap.get(categoryId);
  if (!node) return [];

  const path = [];
  const visited = new Set();
  let cursor = node;

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    path.unshift(cursor.name);
    cursor = cursor.parentId ? categoryMap.get(cursor.parentId) : null;
  }

  return path;
};

const allocateIntegerShares = (total, ratios) => {
  if (!Number.isFinite(total) || total <= 0 || !Array.isArray(ratios) || ratios.length === 0) {
    return [];
  }
  const ratioSum = ratios.reduce((sum, r) => sum + (Number(r) > 0 ? Number(r) : 0), 0);
  if (ratioSum <= 0) return ratios.map(() => 0);

  const rawShares = ratios.map((r) => (Math.max(0, Number(r) || 0) / ratioSum) * total);
  const baseShares = rawShares.map((s) => Math.floor(s));
  let remainder = total - baseShares.reduce((sum, s) => sum + s, 0);

  const indicesByFractionDesc = rawShares
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .map((item) => item.index);

  let ptr = 0;
  while (remainder > 0 && indicesByFractionDesc.length > 0) {
    const index = indicesByFractionDesc[ptr % indicesByFractionDesc.length];
    baseShares[index] += 1;
    remainder -= 1;
    ptr += 1;
  }

  return baseShares;
};

const buildPerQuestionTimePlan = (questions, sectionConfig, durationMinutes) => {
  const totalDurationMs = Math.max(0, Math.round((Number(durationMinutes) || 0) * 60 * 1000));
  const questionCount = Array.isArray(questions) ? questions.length : 0;
  if (questionCount === 0 || totalDurationMs <= 0) {
    return {
      questionTimesMs: new Array(questionCount).fill(0),
      sectionTimesMs: {},
      strategy: "equal",
    };
  }

  const isParentQuestionAtIndex = (index) => {
    const q = questions[index]?.question || questions[index];
    return Boolean(q?.isParent);
  };

  const getQuestionIdAtIndex = (index) => {
    const q = questions[index]?.question || questions[index];
    return getNormalizedId(q?._id || q?.id || q?.questionId);
  };

  const getParentQuestionIdAtIndex = (index) => {
    const q = questions[index]?.question || questions[index];
    return getNormalizedId(q?.parentQuestionId);
  };

  const applyParentDisplayTimes = (questionTimesMs) => {
    questions.forEach((entry, index) => {
      const q = entry?.question || entry;
      if (!q?.isParent) return;

      const parentId = getQuestionIdAtIndex(index);
      if (!parentId) return;

      const childTimes = questions
        .map((_, childIndex) =>
          getParentQuestionIdAtIndex(childIndex) === parentId
            ? questionTimesMs[childIndex] || 0
            : null
        )
        .filter((value) => value !== null && value > 0);

      if (childTimes.length > 0) {
        questionTimesMs[index] = Math.round(
          childTimes.reduce((sum, value) => sum + value, 0) / childTimes.length
        );
      }
    });

    return questionTimesMs;
  };

  const timedQuestionIndexes = questions
    .map((_, index) => index)
    .filter((index) => !isParentQuestionAtIndex(index));

  // Normal banks: equal split across answerable questions. Connected parents are display-only.
  if (!Array.isArray(sectionConfig) || sectionConfig.length === 0) {
    const timedShares = allocateIntegerShares(
      totalDurationMs,
      new Array(timedQuestionIndexes.length).fill(1)
    );
    const questionTimesMs = new Array(questionCount).fill(0);
    timedQuestionIndexes.forEach((questionIndex, shareIndex) => {
      questionTimesMs[questionIndex] = timedShares[shareIndex] || 0;
    });
    applyParentDisplayTimes(questionTimesMs);
    return { questionTimesMs, sectionTimesMs: {}, strategy: "equal" };
  }

  // Section-wise banks: split equally by section, then equally within each section.
  const questionIndexesBySection = sectionConfig.map((section) =>
    questions
      .map((q, idx) => {
        const sectionIndex = q?.question?.sectionIndex ?? q?.sectionIndex;
        return sectionIndex === section.index ? idx : null;
      })
      .filter((idx) => idx !== null)
  );

  const activeSectionEntries = sectionConfig
    .map((section, idx) => ({
      section,
      idx,
      questionIndexes: questionIndexesBySection[idx],
    }))
    .filter((entry) => entry.questionIndexes.length > 0);

  // Fallback to equal split if section indexes are missing on questions.
  if (activeSectionEntries.length === 0) {
    const timedShares = allocateIntegerShares(
      totalDurationMs,
      new Array(timedQuestionIndexes.length).fill(1)
    );
    const questionTimesMs = new Array(questionCount).fill(0);
    timedQuestionIndexes.forEach((questionIndex, shareIndex) => {
      questionTimesMs[questionIndex] = timedShares[shareIndex] || 0;
    });
    applyParentDisplayTimes(questionTimesMs);
    return { questionTimesMs, sectionTimesMs: {}, strategy: "equal" };
  }

  // Use per-section timeMinutes if any section has it configured; otherwise equal split.
  const hasSectionTimes = activeSectionEntries.some(
    (entry) => Number(entry.section.timeMinutes) > 0
  );

  let sectionBudgets;
  if (hasSectionTimes) {
    // Each section's budget comes directly from its own timeMinutes.
    sectionBudgets = activeSectionEntries.map((entry) =>
      Math.round((Number(entry.section.timeMinutes) || 0) * 60 * 1000)
    );
  } else {
    // Legacy: split total duration equally across sections.
    const sectionRatios = new Array(activeSectionEntries.length).fill(1);
    sectionBudgets = allocateIntegerShares(totalDurationMs, sectionRatios);
  }

  const questionTimesMs = new Array(questionCount).fill(0);
  const sectionTimesMs = {};

  activeSectionEntries.forEach((entry, activeIndex) => {
    const sectionBudgetMs = sectionBudgets[activeIndex] || 0;
    const timedIndexes = entry.questionIndexes.filter(
      (questionIndex) => !isParentQuestionAtIndex(questionIndex)
    );
    const perQuestionShares = allocateIntegerShares(
      sectionBudgetMs,
      new Array(timedIndexes.length).fill(1)
    );
    sectionTimesMs[entry.section.index] = sectionBudgetMs;
    timedIndexes.forEach((questionIndex, i) => {
      questionTimesMs[questionIndex] = perQuestionShares[i] || 0;
    });
  });

  applyParentDisplayTimes(questionTimesMs);

  return {
    questionTimesMs,
    sectionTimesMs,
    strategy: hasSectionTimes ? "section_timed" : "section_equal",
  };
};

const getAnswerRemainingTimeMs = (answer, now = new Date()) => {
  const baseRemaining = Number(answer?.remainingTimeMs ?? answer?.questionTimeLimitMs ?? 0);
  if (!answer?.timerStartedAt || answer?.timeExpiredAt) {
    return Math.max(0, baseRemaining);
  }
  const elapsed = Math.max(0, now.getTime() - new Date(answer.timerStartedAt).getTime());
  return Math.max(0, baseRemaining - elapsed);
};

const getNormalizedId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id != null) {
    return value._id?.toString?.() || String(value._id);
  }
  return value?.toString?.() || String(value);
};

const isChildQuestion = (question) => Boolean(getNormalizedId(question?.parentQuestionId));

const resolveContainerStatusFromChildren = (children = []) => {
  const statuses = children.map((child) => child?.status).filter(Boolean);
  if (statuses.length === 0) return "not_visited";
  if (statuses.includes("marked_for_review")) return "marked_for_review";
  if (statuses.includes("answered")) return "answered";
  if (statuses.every((s) => s === "not_visited")) return "not_visited";
  if (statuses.includes("skipped")) return "skipped";
  return statuses[0] || "not_visited";
};

const sanitizeOptionsForExamResponse = (options = []) =>
  Array.isArray(options)
    ? options.map((option) => {
      if (!option || typeof option !== "object") return option;
      const plainOption = option.toObject ? option.toObject() : { ...option };
      delete plainOption.isCorrect;
      return plainOption;
    })
    : [];

const sanitizeConnectedQuestionForResponse = (questionObj = {}, subQuestions = []) => ({
  id: questionObj._id,
  questionType: "connected",
  title: questionObj.questionText || "",
  paragraph: questionObj.passage || "",
  imageUrl: questionObj.imageUrl || null,
  marks: questionObj.marks ?? 0,
  negativeMarks: questionObj.negativeMarks ?? 0,
  difficulty: questionObj.difficulty || null,
  orderInBank:
    questionObj.orderInBank === undefined ? null : questionObj.orderInBank,
  sectionIndex:
    questionObj.sectionIndex === undefined ? null : questionObj.sectionIndex,
  subQuestions,
});

const findAnswerByQuestionId = (session, questionId) => {
  const targetId = getNormalizedId(questionId);
  if (!targetId || !Array.isArray(session?.answers)) return null;
  return session.answers.find((a) => getNormalizedId(a.questionId) === targetId) || null;
};

const findRunningAnswer = (session) => {
  if (!Array.isArray(session?.answers)) return null;
  return (
    session.answers.find(
      (a) => a?.timerStartedAt && !a?.timeExpiredAt && getAnswerRemainingTimeMs(a) > 0
    ) || null
  );
};

const pauseActiveQuestionTimer = (session, now = new Date()) => {
  if (!session?.activeQuestionId) return false;
  let answer = findAnswerByQuestionId(session, session.activeQuestionId);

  if (!answer) {
    const runningAnswer = findRunningAnswer(session);
    if (!runningAnswer) {
      session.activeQuestionId = null;
      return true;
    }
    answer = runningAnswer;
    session.activeQuestionId = runningAnswer.questionId;
  }

  if (answer.timeExpiredAt) {
    answer.remainingTimeMs = 0;
    answer.timerStartedAt = null;
    session.activeQuestionId = null;
    return true;
  }

  const newRemaining = getAnswerRemainingTimeMs(answer, now);
  answer.remainingTimeMs = newRemaining;
  answer.timerStartedAt = null;

  if (newRemaining <= 0) {
    answer.timeExpiredAt = now;
    session.activeQuestionId = null;
  }
  return true;
};

const ensureActiveQuestionNotExpired = (session, now = new Date()) => {
  if (!session?.activeQuestionId) return false;
  let answer = findAnswerByQuestionId(session, session.activeQuestionId);
  if (!answer) {
    const runningAnswer = findRunningAnswer(session);
    if (!runningAnswer) {
      session.activeQuestionId = null;
      return true;
    }
    answer = runningAnswer;
    session.activeQuestionId = runningAnswer.questionId;
    return true;
  }

  if (answer.timeExpiredAt) {
    answer.remainingTimeMs = 0;
    answer.timerStartedAt = null;
    session.activeQuestionId = null;
    return true;
  }

  const remaining = getAnswerRemainingTimeMs(answer, now);
  if (remaining <= 0) {
    answer.remainingTimeMs = 0;
    answer.timerStartedAt = null;
    answer.timeExpiredAt = now;
    session.activeQuestionId = null;
    return true;
  }
  return false;
};

const startOrResumeQuestionTimer = (session, questionId, now = new Date()) => {
  const answer = findAnswerByQuestionId(session, questionId);
  if (!answer) {
    throw new ApiError(404, "Question not found in this exam session");
  }

  const remaining = getAnswerRemainingTimeMs(answer, now);
  if (answer.timeExpiredAt || remaining <= 0) {
    answer.remainingTimeMs = 0;
    answer.timerStartedAt = null;
    answer.timeExpiredAt = answer.timeExpiredAt || now;
    throw new ApiError(400, "Time is over for this question. You cannot open it again.");
  }

  answer.remainingTimeMs = remaining;
  answer.timerStartedAt = now;
  if (answer.status === "not_visited") {
    answer.status = "skipped";
  }
  session.activeQuestionId = answer.questionId;
  return answer;
};

/**
 * Start a new exam session
 */
export const startExamSession = async (testId, studentId, options = {}) => {
  const { challengeId = null, categoryId = null } = options;
  // Check if test exists and is published
  const test = await examSessionRepository.findTestById(testId, {
    questionBank:
      "name sections useSectionWiseQuestions useSectionWiseDifficulty",
    aiQuestionBank: "name overallDifficulty categories useSectionWise sections",
    jeeMainPaper: "title subjects durationMinutes totalQuestions",
  });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  if (!test.isPublished) {
    throw new ApiError(403, "Test is not published");
  }

  const bankType = getTestBankType(test);
  if (!bankType) {
    throw new ApiError(400, "Test has no question bank configured");
  }

  const questions = await getQuestionsForTest(test);
  if (!questions || questions.length === 0) {
    throw new ApiError(400, "Question bank has no questions");
  }

  const questionModel =
    bankType === "ai"
      ? "AiQuestion"
      : bankType === "jee_main_db"
        ? "JeeMainCompetitiveQuestion"
        : "Question";

  // Check if student can access paid test (bypass if it's a challenge room).
  if (test.price > 0 && test.applicableFor !== "everyday_challenge" && !challengeId) {
    const access =
      test.applicableFor === "challenge_yourself"
        ? await checkStudentAccessForPaidChallengeYourselfTest(testId, studentId)
        : await checkStudentAccessForPaidTest(testId, studentId, categoryId);
    if (!access.hasAccess) {
      throw new ApiError(
        403,
        test.applicableFor === "challenge_yourself"
          ? "You need to purchase this challenge level first"
          : "You need to purchase this test first"
      );
    }
  }

  if (test.applicableFor === "tournament") {
    await tournamentService.assertStudentMayStartTournamentTest(testId, studentId);
  }

  // Check if there's an existing in_progress session (resume without pause)
  const sessionScopeFilter = {
    challenge: challengeId || null,
    competitionCategory: categoryId || null,
  };

  const inProgressSession = await examSessionRepository.findOne({
    student: studentId,
    test: testId,
    status: "in_progress",
    ...sessionScopeFilter,
  });

  if (inProgressSession) {
    return await getExamSession(inProgressSession._id, studentId);
  }

  // Check if there's a paused session (resume from pause - timer was stopped)
  const pausedSession = await examSessionRepository.findOne({
    student: studentId,
    test: testId,
    status: "paused",
    ...sessionScopeFilter,
  });

  if (pausedSession) {
    if (pausedSession.challenge || challengeId) {
      throw new ApiError(400, "You can't pause or resume challenge exams");
    }
    const now = new Date();
    const remainingMs = pausedSession.remainingTimeAtPause ?? 0;
    const newEndTime = new Date(now.getTime() + remainingMs);

    pausedSession.status = "in_progress";
    pausedSession.endTime = newEndTime;
    pausedSession.pausedAt = null;
    pausedSession.remainingTimeAtPause = null;
    await examSessionRepository.save(pausedSession);

    return await getExamSession(pausedSession._id, studentId);
  }

  // Challenge-yourself layout: check level unlock and allow retakes (full marks required to unlock next; can retake anytime)
  const challengeSlot = await challengeYourselfService.getSlotForTest(testId);
  if (challengeSlot) {
    const { stagesWithLevels } = await challengeYourselfService.getLayoutFromDB(
      challengeSlot.parentCategoryId || challengeSlot.stageId
    );
    const unlocked = await challengeYourselfService.isLevelUnlocked(
      studentId,
      stagesWithLevels,
      challengeSlot,
      challengeSlot.level
    );
    if (!unlocked) {
      throw new ApiError(
        403,
        "This level is not unlocked yet. Score full marks on the previous level to unlock."
      );
    }
    // Allow retakes: no "already completed" block for challenge-yourself
  } else if (test.applicableFor === "everyday_challenge") {
    // Everyday challenge (not in challenge-yourself): one completion per day
    const today = everydayChallengeService.getStartOfDayUTC();
    const alreadyCompletedToday = await everydayChallengeCompletionRepository.findOne({
      student: studentId,
      date: today,
    });
    if (alreadyCompletedToday) {
      throw new ApiError(400, "You have already completed today's everyday challenge");
    }
  } else if (
    !challengeId &&
    !RETAKEABLE_PILLAR_TESTS.includes(test.applicableFor)
  ) {
    // Non–everyday challenge, non-pillar: prevent retaking the same test
    const completedSessionsResult = await examSessionRepository.findAll({
      student: studentId,
      test: testId,
      status: "completed",
      ...sessionScopeFilter,
    }, { limit: 50 });
    
    const completedSessions = completedSessionsResult.sessions || [];

    if (completedSessions.length > 0) {
      if (test.applicableFor === "certificate" && test.passingPercentage != null) {
        const hasPassed = completedSessions.some(session => {
          const score = session.score || 0;
          const maxScore = session.maxScore || 1;
          return (score / maxScore) * 100 >= test.passingPercentage;
        });

        if (hasPassed) {
          throw new ApiError(400, "You have already passed this certification test");
        }
        // If hasPassed is false, we naturally bypass the error and allow the retake.
      } else {
        throw new ApiError(400, "You have already completed this test");
      }
    }
  }

  // Create new exam session
  const now = new Date();
  let endTime;
  let durationMinutesForPlan = test.durationMinutes;

  if (test.applicableFor === "tournament") {
    const ctx = await tournamentService.getTournamentStageContextForPublishedTest(testId);
    if (!ctx) {
      throw new ApiError(400, "Tournament is not available for this test");
    }
    const timing = tournamentService.computeTournamentAttemptTiming(test, ctx.stage, now);
    endTime = timing.endTime;
    // Per-question limits follow the full published test length; overall session still ends at endTime (late join / round cap).
  } else {
    const durationMs = test.durationMinutes * 60 * 1000;
    endTime = new Date(now.getTime() + durationMs);
  }

  const sectionConfigForTiming = getSectionConfigForTiming(test);

  // If section-wise times are configured, sum them for total duration
  const sectionTimesSum = sectionConfigForTiming.reduce(
    (sum, s) => sum + (Number(s.timeMinutes) || 0), 0
  );
  if (sectionTimesSum > 0) {
    durationMinutesForPlan = sectionTimesSum;
    // Also update endTime for non-tournament tests
    if (test.applicableFor !== "tournament") {
      const durationMs = sectionTimesSum * 60 * 1000;
      endTime = new Date(now.getTime() + durationMs);
    }
  }

  const { questionTimesMs } = buildPerQuestionTimePlan(
    questions,
    sectionConfigForTiming,
    durationMinutesForPlan
  );

  // Initialize answers array for all questions from the bank
  const answers = questions.map((question, index) => ({
    questionId: question._id,
    questionModel,
    answer: null,
    status: "not_visited",
    answeredAt: null,
    questionTimeLimitMs: questionTimesMs[index] || 0,
    remainingTimeMs: questionTimesMs[index] || 0,
    timerStartedAt: null,
    timeExpiredAt: null,
  }));

  const maxScore = questions.filter((q) => !q.isParent).reduce((sum, q) => sum + (q.marks || 0), 0);

  const session = await examSessionRepository.create({
    student: studentId,
    test: testId,
    challenge: challengeId,
    competitionCategory: categoryId || null,
    startTime: now,
    endTime: endTime,
    status: "in_progress",
    answers: answers,
    activeQuestionId: null,
    proctoringEvents: [],
    maxScore,
  });

  return await getExamSession(session._id, studentId);
};

/**
 * Get exam instruction details before starting the exam
 */
export const getExamInstructions = async (testId, studentId, options = {}) => {
  const { challengeId = null, categoryId = null } = options;

  const test = await examSessionRepository.findTestById(testId, {
    questionBank:
      "name sections useSectionWiseQuestions useSectionWiseDifficulty overallDifficulty categories",
    aiQuestionBank: "name overallDifficulty categories useSectionWise sections",
    jeeMainPaper: "title subjects durationMinutes totalQuestions",
  });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  if (!test.isPublished) {
    throw new ApiError(403, "Test is not published");
  }

  if (!getTestBankType(test)) {
    throw new ApiError(400, "Test has no question bank configured");
  }

  const questions = await getQuestionsForTest(test);
  if (!questions || questions.length === 0) {
    throw new ApiError(400, "Question bank has no questions");
  }

  const totalQuestions = questions.filter((q) => !getNormalizedId(q?.parentQuestionId)).length;
  const nonParentQuestions = questions.filter((q) => !q.isParent);
  const totalMarks = nonParentQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
  const totalNegativeMarks = nonParentQuestions.reduce((sum, q) => sum + (q.negativeMarks || 0), 0);

  let canStart = true;
  let blockReason = null;
  let accessType = test.price > 0 ? "requires_purchase_or_event" : "free_test";



  if (canStart && test.price > 0 && test.applicableFor !== "everyday_challenge") {
    const access =
      test.applicableFor === "challenge_yourself"
        ? await checkStudentAccessForPaidChallengeYourselfTest(testId, studentId)
        : await checkStudentAccessForPaidTest(testId, studentId, categoryId);
    if (!access.hasAccess) {
      canStart = false;
      blockReason =
        test.applicableFor === "challenge_yourself"
          ? "You need to purchase this challenge level first"
          : "You need to purchase this test first";
    } else {
      accessType = access.accessType;
    }
  }

  if (canStart && test.applicableFor === "tournament") {
    try {
      await tournamentService.assertStudentMayStartTournamentTest(testId, studentId);
    } catch (e) {
      canStart = false;
      blockReason = e?.message || "You cannot start this tournament test right now";
    }
  }

  const sessionScopeFilter = {
    challenge: challengeId || null,
    competitionCategory: categoryId || null,
  };

  const [inProgressSession, pausedSession] = await Promise.all([
    examSessionRepository.findOne({
      student: studentId,
      test: testId,
      status: "in_progress",
      ...sessionScopeFilter,
    }),
    examSessionRepository.findOne({
      student: studentId,
      test: testId,
      status: "paused",
      ...sessionScopeFilter,
    }),
  ]);

  if (canStart) {
    const challengeSlot = await challengeYourselfService.getSlotForTest(testId);
    if (challengeSlot) {
      const { stagesWithLevels } = await challengeYourselfService.getLayoutFromDB(
        challengeSlot.parentCategoryId || challengeSlot.stageId
      );
      const unlocked = await challengeYourselfService.isLevelUnlocked(
        studentId,
        stagesWithLevels,
        challengeSlot,
        challengeSlot.level
      );
      if (!unlocked) {
        canStart = false;
        blockReason =
          "This level is not unlocked yet. Score full marks on the previous level to unlock.";
      }
    } else if (test.applicableFor === "everyday_challenge") {
      const today = everydayChallengeService.getStartOfDayUTC();
      const alreadyCompletedToday = await everydayChallengeCompletionRepository.findOne({
        student: studentId,
        date: today,
      });
      if (alreadyCompletedToday) {
        canStart = false;
        blockReason = "You have already completed today's everyday challenge";
      }
    } else if (
      !challengeId &&
      !RETAKEABLE_PILLAR_TESTS.includes(test.applicableFor)
    ) {
      const completedSessionsResult = await examSessionRepository.findAll({
        student: studentId,
        test: testId,
        status: "completed",
        ...sessionScopeFilter,
      }, { limit: 50 });
      
      const completedSessions = completedSessionsResult.sessions || [];

      if (completedSessions.length > 0) {
        if (test.applicableFor === "certificate" && test.passingPercentage != null) {
          const hasPassed = completedSessions.some(session => {
            const score = session.score || 0;
            const maxScore = session.maxScore || 1;
            return (score / maxScore) * 100 >= test.passingPercentage;
          });

          if (hasPassed) {
            canStart = false;
            blockReason = "You have already passed this certification test";
          }
        } else {
          canStart = false;
          blockReason = "You have already completed this test";
        }
      }
    }
  }

  const categoryIds = getBankCategories(test)
    .map((category) => {
      if (!category) return null;
      return category?._id?.toString?.() || category?.toString?.() || null;
    })
    .filter(Boolean);

  const allActiveCategoriesResult = await categoryRepository.findAll(
    { isActive: true },
    { page: 1, limit: 1000 }
  );
  const allActiveCategories = allActiveCategoriesResult.items || [];

  const categoryMap = new Map(
    allActiveCategories.map((category) => [
      category._id.toString(),
      {
        id: category._id.toString(),
        name: category.name,
        parentId:
          category.parent?._id?.toString?.() ||
          category.parent?.toString?.() ||
          null,
      },
    ])
  );

  const categories = categoryIds
    .map((categoryId) => {
      const category = categoryMap.get(categoryId);
      if (!category) return null;
      const fullPath = buildCategoryPath(categoryId, categoryMap);
      return {
        id: category.id,
        name: category.name,
        fullPath,
        fullPathText: fullPath.join(" > "),
      };
    })
    .filter(Boolean);

  const hasSectionsConfigured =
    (getTestBankType(test) === "manual" &&
      Array.isArray(test?.questionBank?.sections) &&
      test.questionBank.sections.length > 0) ||
    (getTestBankType(test) === "ai" &&
      Array.isArray(test?.aiQuestionBank?.sections) &&
      test.aiQuestionBank.sections.length > 0);
  const sectionWiseEnabled =
    (getTestBankType(test) === "manual" &&
      hasSectionsConfigured &&
      (!!test?.questionBank?.useSectionWiseQuestions ||
        !!test?.questionBank?.useSectionWiseDifficulty)) ||
    (getTestBankType(test) === "ai" &&
      hasSectionsConfigured &&
      !!test?.aiQuestionBank?.useSectionWise);

  const sections = hasSectionsConfigured
    ? (getTestBankType(test) === "ai"
        ? test.aiQuestionBank.sections
        : test.questionBank.sections
      ).map((section, index) => ({
        id: section.id ?? index + 1,
        name: section.name || `Section ${index + 1}`,
        count: section.count || 0,
        difficulty: section.difficulty || null,
        timeMinutes: section.timeMinutes || null,
      }))
    : [];

  let tournamentExam = null;
  if (test.applicableFor === "tournament" && canStart) {
    try {
      const ctx = await tournamentService.getTournamentStageContextForPublishedTest(testId);
      if (ctx) {
        const previewNow = new Date();
        const timing = tournamentService.computeTournamentAttemptTiming(test, ctx.stage, previewNow);
        tournamentExam = {
          tournamentId: ctx.tournament._id,
          tournamentTitle: ctx.tournament.title,
          stageName: ctx.stage.name,
          stageStartTime: ctx.stage.startTime,
          stageEndTime: ctx.stage.endTime,
          fullTestDurationMinutes: test.durationMinutes,
          yourEffectiveDurationMinutes: Math.round(timing.durationMinutesForQuestionPlan * 100) / 100,
          lateJoinMs: timing.lateJoinMs,
          lateJoinMinutes: Math.round((timing.lateJoinMs / 60000) * 100) / 100,
          personalExamWouldEndAt: timing.endTime,
        };
      }
    } catch (e) {
      if (e instanceof ApiError) {
        canStart = false;
        blockReason = e.message;
      }
    }
  }

  const instructionPoints = [
    `Total questions: ${totalQuestions}`,
    `Total marks: ${totalMarks}`,
    `Duration: ${test.durationMinutes} minutes`,
  ];

  if (totalNegativeMarks > 0) {
    instructionPoints.push(
      `Negative marking: Yes (up to ${totalNegativeMarks} marks can be deducted)`
    );
  } else {
    instructionPoints.push("Negative marking: No");
  }

  if (sectionWiseEnabled) {
    instructionPoints.push(`Section-wise questions: Enabled (${sections.length} sections)`);
  } else {
    instructionPoints.push("Section-wise questions: Disabled");
  }

  if (tournamentExam) {
    instructionPoints.push(
      `Tournament round: your exam clock is ${tournamentExam.yourEffectiveDurationMinutes} minutes (shorter if you joined after the round started or the round is almost over). Suggested time per question still matches the full ${tournamentExam.fullTestDurationMinutes}-minute test; submit before your clock runs out.`
    );
  }

  return {
    test: {
      id: test._id,
      title: test.title,
      description: test.description || "",
      imageUrl: test.imageUrl || null,
      applicableFor: test.applicableFor,
      isFree: test.price <= 0,
      durationMinutes: test.durationMinutes,
      proctoringInstructions: test.proctoringInstructions,
      questionBankName: getBankDisplayName(test),
      paperSource: test.paperSource || getTestBankType(test),
      categories,
    },
    stats: {
      totalQuestions,
      totalMarks,
      totalNegativeMarks,
      averageTimePerQuestionSeconds:
        totalQuestions > 0 ? Math.round((test.durationMinutes * 60) / totalQuestions) : 0,
    },
    sections: {
      sectionWiseEnabled,
      useSectionWiseDifficulty: !!test?.questionBank?.useSectionWiseDifficulty,
      overallDifficulty: test?.questionBank?.overallDifficulty || null,
      items: sections,
    },
    session: {
      inProgressSessionId: inProgressSession?._id || null,
      pausedSessionId: pausedSession?._id || null,
      hasResumableSession: !!(inProgressSession || pausedSession),
      nextAction: inProgressSession || pausedSession ? "resume" : "start",
    },
    eligibility: {
      canStart,
      blockReason,
      accessType,
    },
    instructions: {
      proctoringText: test.proctoringInstructions,
      points: instructionPoints,
    },
    ...(tournamentExam ? { tournamentExam } : {}),
  };
};

/**
 * Get exam session with questions (without correct answers)
 */
export const getExamSession = async (sessionId, studentId) => {
  let session = await examSessionRepository.findOne(
    {
      _id: sessionId,
      student: studentId,
    },
    {
      test: "title description durationMinutes applicableFor questionBank",
      answers: {
        select:
          "questionText questionType options subject topic marks negativeMarks difficulty isParent passage parentQuestionId childQuestions connectedQuestions imageUrl sectionIndex orderInBank",
        populate: {
          path: "childQuestions",
          select: "questionText questionType options marks negativeMarks difficulty imageUrl",
        },
      },
    }
  );

  if (!session) {
    throw new ApiError(404, "Exam session not found");
  }

  const now = new Date();

  // Auto-resume paused sessions when accessed via getExamSession
  if (session.status === "paused") {
    if (session.challenge) {
      throw new ApiError(400, "You can't pause or resume challenge exams");
    }
    const remainingMs = session.remainingTimeAtPause ?? 0;
    session.status = "in_progress";
    session.endTime = new Date(now.getTime() + remainingMs);
    session.pausedAt = null;
    session.remainingTimeAtPause = null;
    await examSessionRepository.save(session);
  }

  // Check if session has expired and auto-submit if needed
  if (session.status === "in_progress" && new Date(session.endTime) < now) {
    // Auto-submit expired session
    try {
      await autoSubmitExam(session._id, studentId, "time_expired");
      // Reload session after auto-submission
      session = await examSessionRepository.findOne(
        {
          _id: sessionId,
          student: studentId,
        },
        {
          test: "title description durationMinutes applicableFor questionBank",
          answers: {
            select:
              "questionText questionType options subject topic marks negativeMarks difficulty isParent passage parentQuestionId childQuestions connectedQuestions imageUrl sectionIndex orderInBank",
            populate: {
              path: "childQuestions",
              select: "questionText questionType options marks negativeMarks difficulty imageUrl",
            },
          },
        }
      );
    } catch (error) {
      console.error("Error auto-submitting expired session:", error);
      // Try to recover by re-reading latest persisted state first.
      // This avoids accidentally overwriting a successfully completed session.
      const latestSession = await examSessionRepository.findOne({
        _id: sessionId,
        student: studentId,
      });
      if (latestSession) {
        session = latestSession;
      } else {
        // Fallback only when session cannot be reloaded
        session.status = "expired";
        await examSessionRepository.save(session);
      }
    }
  }

  // Expire currently active question if its own timer is over.
  const timerStateChanged = ensureActiveQuestionNotExpired(session, now);
  if (timerStateChanged && session.status === "in_progress") {
    await examSessionRepository.save(session);
  }

  // Calculate remaining time (use stored value when paused)
  const remainingTime =
    session.status === "paused" && session.remainingTimeAtPause != null
      ? session.remainingTimeAtPause
      : Math.max(0, new Date(session.endTime).getTime() - now.getTime());

  const answerMetaByQuestionId = new Map(
    session.answers.map((entry) => [getNormalizedId(entry.questionId), entry])
  );
  const answerQuestionById = new Map(
    session.answers
      .map((entry) => {
        const q = entry.questionId;
        if (!q) return null;
        const plain = q.toObject ? q.toObject() : q;
        return [getNormalizedId(plain._id || q), plain];
      })
      .filter(Boolean)
  );

  // Remove correct answers from questions (for security)
  const questions = session.answers.map((answer) => {
    const question = answer.questionId;
    if (!question) return null;
    if (isChildQuestion(question)) return null;

    // For connected questions, remove child correct answers first.
    if (question.isParent && question.childQuestions) {
      question.childQuestions = question.childQuestions.map((child) => {
        const childObj = child.toObject ? child.toObject() : child;
        delete childObj.correctAnswer;
        childObj.options = sanitizeOptionsForExamResponse(childObj.options);
        return childObj;
      });
    }

    let questionObj = question.toObject ? question.toObject() : question;
    delete questionObj.correctAnswer;
    questionObj.options = sanitizeOptionsForExamResponse(questionObj.options);
    if (questionObj.isParent && questionObj.questionType === "connected") {
      const subQuestions = Array.isArray(questionObj.childQuestions)
        ? questionObj.childQuestions
          .map((childRef) => {
            const childId = getNormalizedId(childRef);
            if (!childId) return null;
            const populatedChild =
              childRef && typeof childRef === "object" && childRef.questionText != null
                ? childRef
                : null;
            const childObj = populatedChild || answerQuestionById.get(childId) || { _id: childId };
            delete childObj.correctAnswer;
            childObj.options = sanitizeOptionsForExamResponse(childObj.options);
            const childAnswer = answerMetaByQuestionId.get(childId);
            const childRemainingTimeMs = childAnswer
              ? getAnswerRemainingTimeMs(childAnswer, now)
              : 0;
            const childRecommendedTimeMs = Number(childAnswer?.questionTimeLimitMs || 0);
            return {
              _id: childObj._id,
              questionId: childObj._id,
              questionText: childObj.questionText || "",
              questionType: childObj.questionType || "single",
              options: sanitizeOptionsForExamResponse(childObj.options),
              explanation: childObj.explanation,
              marks: childObj.marks ?? 1,
              negativeMarks: childObj.negativeMarks ?? 0,
              imageUrl: childObj.imageUrl || null,
              sectionIndex: childObj.sectionIndex ?? questionObj.sectionIndex ?? null,
              studentAnswer: childAnswer?.answer ?? null,
              status: childAnswer?.status ?? "not_visited",
              answeredAt: childAnswer?.answeredAt ?? null,
              recommendedTimeMs: childRecommendedTimeMs,
              recommendedTimeSeconds: Math.round(childRecommendedTimeMs / 1000),
              recommendedTimeFormatted: formatTime(childRecommendedTimeMs),
              remainingQuestionTimeMs: childRemainingTimeMs,
              remainingQuestionTimeSeconds: Math.round(childRemainingTimeMs / 1000),
              remainingQuestionTimeFormatted: formatTime(childRemainingTimeMs),
              questionTimeExpired:
                Boolean(childAnswer?.timeExpiredAt) || childRemainingTimeMs <= 0,
            };
          })
          .filter(Boolean)
        : [];
      questionObj = sanitizeConnectedQuestionForResponse(questionObj, subQuestions);
    }

    const remainingQuestionTimeMs = getAnswerRemainingTimeMs(answer, now);
    const basePayload = {
      questionId: questionObj._id || questionObj.id,
      question: questionObj,
      answer: answer.answer,
      status: answer.status,
      answeredAt: answer.answeredAt,
      recommendedTimeMs: Number(answer.questionTimeLimitMs || 0),
      recommendedTimeSeconds: Math.round(Number(answer.questionTimeLimitMs || 0) / 1000),
      recommendedTimeFormatted: formatTime(Number(answer.questionTimeLimitMs || 0)),
      remainingQuestionTimeMs,
      remainingQuestionTimeSeconds: Math.round(remainingQuestionTimeMs / 1000),
      remainingQuestionTimeFormatted: formatTime(remainingQuestionTimeMs),
      questionTimeExpired: Boolean(answer.timeExpiredAt) || remainingQuestionTimeMs <= 0,
    };
    if (questionObj.questionType === "connected") {
      const containerStatus = resolveContainerStatusFromChildren(questionObj.subQuestions || []);
      basePayload.status = containerStatus;
      basePayload.answer = null;
      basePayload.answeredAt = null;
    }
    return basePayload;
  }).filter((q) => q !== null);

  // Build palette (navigation grid)
  const palette = {
    answered: questions.filter((q) => q.status === "answered").length,
    skipped: questions.filter((q) => q.status === "skipped").length,
    markedForReview: questions.filter((q) => q.status === "marked_for_review").length,
    notVisited: questions.filter((q) => q.status === "not_visited").length,
    total: questions.length,
  };

  // Add section metadata for section-wise exam UI (single API response).
  let sectionConfig = [];
  const hasSectionIndexedQuestions = questions.some(
    (q) => q?.question?.sectionIndex !== undefined && q?.question?.sectionIndex !== null
  );
  const questionBankId = session?.test?.questionBank?._id || session?.test?.questionBank;
  const aiQuestionBankId =
    session?.test?.aiQuestionBank?._id || session?.test?.aiQuestionBank;
  if (questionBankId) {
    const questionBank = await questionBankRepository.findById(questionBankId, false);
    if (
      Array.isArray(questionBank.sections) &&
      questionBank.sections.length > 0 &&
      (
        questionBank?.useSectionWiseQuestions ||
        questionBank?.useSectionWiseDifficulty ||
        hasSectionIndexedQuestions
      )
    ) {
      sectionConfig = questionBank.sections.map((section, index) => ({
        index,
        id: section.id ?? index + 1,
        name: section.name || `Section ${String.fromCharCode(65 + index)}`,
        count: section.count,
        difficulty: section.difficulty,
        timeMinutes: section.timeMinutes || null,
      }));
    }
  } else if (aiQuestionBankId) {
    const aiBank = await aiQuestionBankRepository.findById(aiQuestionBankId, false);
    if (
      Array.isArray(aiBank?.sections) &&
      aiBank.sections.length > 0 &&
      (aiBank.useSectionWise || hasSectionIndexedQuestions)
    ) {
      sectionConfig = aiBank.sections.map((section, index) => ({
        index,
        id: section.id ?? index + 1,
        name: section.name || `Section ${String.fromCharCode(65 + index)}`,
        count: section.count,
        difficulty: section.difficulty,
        timeMinutes: section.timeMinutes || null,
      }));
    }
  }

  // Fallback: derive sections from question.sectionIndex when bank section config is absent.
  if (sectionConfig.length === 0 && hasSectionIndexedQuestions) {
    const grouped = new Map();
    questions.forEach((q) => {
      const idx = q?.question?.sectionIndex;
      if (idx === undefined || idx === null) return;
      if (!grouped.has(idx)) grouped.set(idx, []);
      grouped.get(idx).push(q);
    });

    sectionConfig = [...grouped.keys()]
      .sort((a, b) => a - b)
      .map((index) => {
        const sectionQuestions = grouped.get(index) || [];
        const firstDifficulty =
          sectionQuestions.find((q) => q?.question?.difficulty)?.question?.difficulty ||
          "medium";
        const subjectName =
          sectionQuestions.find((q) => q?.question?.subject)?.question?.subject ||
          `Section ${String.fromCharCode(65 + Number(index))}`;
        return {
          index,
          id: index + 1,
          name: subjectName,
          count: sectionQuestions.length,
          difficulty: firstDifficulty,
        };
      });
  }

  const sectionedQuestions =
    sectionConfig.length > 0
      ? sectionConfig.map((section) => ({
        ...section,
        questions: questions.filter(
          (q) => q?.question?.sectionIndex === section.index
        ),
      }))
      : [];

  const { questionTimesMs, sectionTimesMs, strategy } = buildPerQuestionTimePlan(
    questions,
    sectionConfig,
    session?.test?.durationMinutes
  );
  const questionsWithTime = questions.map((q, index) => ({
    ...q,
    // Keep compatibility: if historical sessions don't have stored limits, fallback to computed.
    recommendedTimeMs:
      Number(q.recommendedTimeMs || 0) > 0
        ? Number(q.recommendedTimeMs || 0)
        : questionTimesMs[index] || 0,
    recommendedTimeSeconds: Math.round(
      (Number(q.recommendedTimeMs || 0) > 0
        ? Number(q.recommendedTimeMs || 0)
        : questionTimesMs[index] || 0) / 1000
    ),
    recommendedTimeFormatted: formatTime(
      Number(q.recommendedTimeMs || 0) > 0
        ? Number(q.recommendedTimeMs || 0)
        : questionTimesMs[index] || 0
    ),
  }));
  const sectionedQuestionsWithTime =
    sectionedQuestions.length > 0
      ? sectionedQuestions.map((section) => {
        const sectionTotalMs = sectionTimesMs[section.index] || 0;
        const sectionQuestions = questionsWithTime.filter(
          (q) => q?.question?.sectionIndex === section.index
        );
        const timedQuestionCount = session.answers.filter((answer) => {
          const question = answer?.questionId;
          if (!question || question.isParent) return false;
          const sectionIndex = question?.sectionIndex;
          return sectionIndex === section.index;
        }).length;
        return {
          ...section,
          recommendedTotalTimeMs: sectionTotalMs,
          recommendedTotalTimeFormatted: formatTime(sectionTotalMs),
          recommendedPerQuestionMs:
            timedQuestionCount > 0
              ? Math.round(sectionTotalMs / timedQuestionCount)
              : 0,
          recommendedPerQuestionFormatted:
            timedQuestionCount > 0
              ? formatTime(Math.round(sectionTotalMs / timedQuestionCount))
              : formatTime(0),
          questions: sectionQuestions,
        };
      })
      : [];

  let tournamentExam = null;
  if (session.test?.applicableFor === "tournament") {
    const tid = session.test._id || session.test;
    const ctx = await tournamentService.getTournamentStageContextForPublishedTest(tid);
    if (ctx) {
      tournamentExam = {
        tournamentId: ctx.tournament._id,
        tournamentTitle: ctx.tournament.title,
        stageName: ctx.stage.name,
        stageStartTime: ctx.stage.startTime,
        stageEndTime: ctx.stage.endTime,
      };
    }
  }

  return {
    session: {
      id: session._id,
      test: session.test,
      startTime: session.startTime,
      endTime: session.endTime,
      status: session.status,
      maxScore: session.maxScore,
      remainingTime, // in milliseconds
      remainingTimeFormatted: formatTime(remainingTime),
      sectionWiseQuestionsEnabled: sectionConfig.length > 0,
      timeAllocationStrategy: strategy,
      activeQuestionId: getNormalizedId(session.activeQuestionId) || null,
    },
    questions: questionsWithTime,
    palette,
    sectionConfig,
    sectionedQuestions: sectionedQuestionsWithTime,
    ...(tournamentExam ? { tournamentExam } : {}),
  };
};

/**
 * Save answer for a question
 */
export const saveAnswer = async (sessionId, questionId, answer, studentId, status = "answered") => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
    status: "in_progress",
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found or already completed");
  }

  // Check if session has expired
  const now = new Date();
  if (new Date(session.endTime) < now) {
    session.status = "expired";
    await examSessionRepository.save(session);
    throw new ApiError(400, "Exam session has expired");
  }

  // Find the answer entry
  const answerEntry = session.answers.find(
    (a) => a.questionId.toString() === questionId.toString()
  );

  if (!answerEntry) {
    throw new ApiError(404, "Question not found in this exam session");
  }

  pauseActiveQuestionTimer(session, now);
  startOrResumeQuestionTimer(session, questionId, now);

  // Store the answer. If the frontend sends an option _id (24-char hex), keep it as-is so
  // the frontend can unambiguously re-hydrate the selection even when two options share the
  // same display text. For plain-text / number / object answers (legacy / mobile), still
  // normalise to canonical text for backward compatibility.
  // NOTE: checkAnswerCorrectness already calls resolveAnswerToText internally, so scoring
  // works correctly regardless of whether we store an _id or a text string here.
  const isIdString = (val) =>
    typeof val === "string" && /^[a-f\d]{24}$/i.test(val.trim());
  const isIdArray = (val) =>
    Array.isArray(val) && val.length > 0 && val.every(isIdString);

  let normalizedAnswer = answer;
  if (answer !== null && answer !== undefined && !isIdString(answer) && !isIdArray(answer)) {
    // Non-_id value: resolve to canonical text (backward compat for mobile / legacy)
    const answerModel = answerEntry?.questionModel || "Question";
    const question = await findQuestionById(questionId, answerModel).catch(() => null);
    const options = question?.options || [];
    normalizedAnswer = resolveAnswerToText(answer, options);
  }

  // Update answer
  answerEntry.answer = normalizedAnswer;
  answerEntry.status = status;
  if (status === "answered") {
    answerEntry.answeredAt = now;
  }

  await examSessionRepository.save(session);

  return await getExamSession(sessionId, studentId);
};

/**
 * Mark question for review
 */
export const markForReview = async (sessionId, questionId, studentId) => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
    status: "in_progress",
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found or already completed");
  }

  const now = new Date();
  if (new Date(session.endTime) < now) {
    session.status = "expired";
    await examSessionRepository.save(session);
    throw new ApiError(400, "Exam session has expired");
  }

  pauseActiveQuestionTimer(session, now);
  startOrResumeQuestionTimer(session, questionId, now);

  const answerEntry = session.answers.find(
    (a) => a.questionId.toString() === questionId.toString()
  );

  if (!answerEntry) {
    throw new ApiError(404, "Question not found in this exam session");
  }

  answerEntry.status = "marked_for_review";
  await examSessionRepository.save(session);

  return await getExamSession(sessionId, studentId);
};

/**
 * Skip question
 */
export const skipQuestion = async (sessionId, questionId, studentId) => {
  return await saveAnswer(sessionId, questionId, null, studentId, "skipped");
};

/**
 * Visit/open a question: pauses previous question timer and starts/resumes selected question timer.
 */
export const visitQuestion = async (sessionId, questionId, studentId) => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
    status: "in_progress",
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found or already completed");
  }

  const now = new Date();
  if (new Date(session.endTime) < now) {
    session.status = "expired";
    await examSessionRepository.save(session);
    throw new ApiError(400, "Exam session has expired");
  }

  pauseActiveQuestionTimer(session, now);
  startOrResumeQuestionTimer(session, questionId, now);
  await examSessionRepository.save(session);

  return await getExamSession(sessionId, studentId);
};

/**
 * Auto-submit exam (internal function for time expiration or proctoring violations)
 */
const autoSubmitExam = async (sessionId, studentId, reason = "time_expired") => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
  });

  if (!session) {
    console.error(`Exam session ${sessionId} not found for auto-submission`);
    return;
  }

  if (session.status === "completed") {
    console.log(`Exam session ${sessionId} already completed, skipping auto-submission`);
    return;
  }

  // Mark as completed
  session.status = "completed";
  session.completedAt = new Date();

  // Add auto-submission reason to metadata if needed
  if (reason) {
    session.autoSubmitted = true;
    session.autoSubmitReason = reason;
  }

  // Calculate score
  await calculateScore(session);

  await examSessionRepository.save(session);

  // Calculate detailed analysis
  try {
    await examAnalysisService.calculateDetailedAnalysis(sessionId);
  } catch (error) {
    console.error("Error calculating detailed analysis:", error);
    // Don't fail submission if analysis fails
  }

  // Award points based on test type.
  try {
    const test = await examSessionRepository.findTestById(session.test);
    await awardCompletionPoints(studentId, session, test);
    await issueCourseCompletionCertificate(studentId, session.test);
  } catch (error) {
    console.error("Error awarding points for test completion:", error);
  }
  try {
    await challengeYourselfService.recordProgress(studentId, session);
  } catch (error) {
    console.error("Error recording challenge-yourself progress:", error);
  }

  if (session.challenge) {
    try {
      const { syncChallengeCompletionById } = await import("./challenge.service.js");
      await syncChallengeCompletionById(session.challenge);
    } catch (error) {
      console.error("Error syncing challenge completion:", error);
    }
  }

  console.log(`Exam session ${sessionId} auto-submitted successfully. Reason: ${reason}`);
};

/**
 * Log proctoring event
 */
export const logProctoringEvent = async (sessionId, eventType, metadata, studentId) => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
    status: "in_progress",
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found or already completed");
  }

  const validEventTypes = ["window_blur", "tab_switch", "fullscreen_exit", "visibility_change"];
  if (!validEventTypes.includes(eventType)) {
    throw new ApiError(400, "Invalid proctoring event type");
  }

  session.proctoringEvents.push({
    type: eventType,
    timestamp: new Date(),
    metadata: metadata || {},
  });

  await examSessionRepository.save(session);

  // Auto-submit if proctoring violation detected
  // Check if violation threshold is exceeded (e.g., more than 3 violations)
  const violationCount = session.proctoringEvents.length;
  const VIOLATION_THRESHOLD = 3; // Configurable threshold

  if (violationCount >= VIOLATION_THRESHOLD) {
    console.log(`Auto-submitting exam session ${sessionId} due to proctoring violations (${violationCount} violations)`);
    try {
      await autoSubmitExam(sessionId, studentId, "proctoring_violation");
      return {
        success: true,
        message: "Proctoring event logged. Exam auto-submitted due to proctoring violations.",
        autoSubmitted: true
      };
    } catch (error) {
      console.error("Error auto-submitting exam due to proctoring violation:", error);
      // Continue even if auto-submit fails
    }
  }

  return { success: true, message: "Proctoring event logged", autoSubmitted: false };
};

/**
 * Pause exam session (stops the timer; call start-exam to resume)
 */
export const pauseExamSession = async (sessionId, studentId) => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
    status: "in_progress",
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found or not in progress");
  }

  if (session.challenge) {
    throw new ApiError(400, "You can't pause challenge exams");
  }

  const testForPause = await examSessionRepository.findTestById(session.test);
  if (testForPause?.applicableFor === "tournament") {
    throw new ApiError(400, "You can't pause tournament exams");
  }

  const now = new Date();
  const remainingMs = Math.max(0, new Date(session.endTime).getTime() - now.getTime());
  pauseActiveQuestionTimer(session, now);

  session.status = "paused";
  session.pausedAt = now;
  session.remainingTimeAtPause = remainingMs;
  await examSessionRepository.save(session);

  return {
    success: true,
    message: "Exam paused successfully. Call start-exam to resume.",
    remainingTimeAtPause: remainingMs,
  };
};

/**
 * Submit exam
 */
export const submitExam = async (sessionId, studentId) => {
  const session = await examSessionRepository.findOne({
    _id: sessionId,
    student: studentId,
  });

  if (!session) {
    throw new ApiError(404, "Exam session not found");
  }

  if (session.status === "completed") {
    throw new ApiError(400, "Exam has already been submitted");
  }

  if (session.status === "expired") {
    throw new ApiError(400, "Exam session has expired");
  }

  // Mark as completed
  pauseActiveQuestionTimer(session, new Date());
  session.status = "completed";
  session.completedAt = new Date();
  session.autoSubmitted = false;
  session.autoSubmitReason = null;

  // Calculate score
  await calculateScore(session);

  await examSessionRepository.save(session);

  // Calculate detailed analysis
  try {
    await examAnalysisService.calculateDetailedAnalysis(sessionId);
  } catch (error) {
    console.error("Error calculating detailed analysis:", error);
    // Don't fail submission if analysis fails
  }

  try {
    const test = await examSessionRepository.findTestById(session.test);
    await awardCompletionPoints(studentId, session, test);
    await issueCourseCompletionCertificate(studentId, session.test);
  } catch (error) {
    console.error("Error awarding points for test completion:", error);
  }
  try {
    await challengeYourselfService.recordProgress(studentId, session);
  } catch (error) {
    console.error("Error recording challenge-yourself progress:", error);
  }

  if (session.challenge) {
    try {
      const { syncChallengeCompletionById } = await import("./challenge.service.js");
      await syncChallengeCompletionById(session.challenge);
    } catch (error) {
      console.error("Error syncing challenge completion:", error);
    }
  }

  return await getExamResults(sessionId, studentId);
};

/**
 * Auto-submit expired exam sessions (called by cron job)
 */
export const autoSubmitExpiredSessions = async () => {
  try {
    const expiredSessions = await examSessionRepository.findExpiredInProgressSessions();

    if (expiredSessions.length === 0) {
      return { processed: 0, message: "No expired sessions found" };
    }

    console.log(`Found ${expiredSessions.length} expired exam session(s) to auto-submit`);

    const results = await Promise.allSettled(
      expiredSessions.map(async (session) => {
        try {
          await autoSubmitExam(session._id, session.student, "time_expired");
          return {
            sessionId: session._id.toString(),
            studentId: session.student.toString(),
            success: true
          };
        } catch (error) {
          console.error(`Error auto-submitting session ${session._id}:`, error);
          return {
            sessionId: session._id.toString(),
            success: false,
            error: error.message
          };
        }
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
    const failed = results.length - successful;
    const autoSubmittedSessions = results
      .filter((r) => r.status === "fulfilled" && r.value.success)
      .map((r) => r.value);

    return {
      processed: expiredSessions.length,
      successful,
      failed,
      autoSubmittedSessions, // Array of { sessionId, studentId }
      message: `Auto-submitted ${successful} expired session(s), ${failed} failed`,
    };
  } catch (error) {
    console.error("Error in autoSubmitExpiredSessions:", error);
    throw error;
  }
};

/**
 * Calculate score for exam session
 */
const calculateScore = async (session) => {
  const questionIds = session.answers.map((a) => a.questionId);
  const questionModelsById = new Map(
    session.answers.map((a) => [
      a.questionId?.toString?.() || String(a.questionId),
      a.questionModel || "Question",
    ])
  );
  const questions = await findQuestionsByIds(questionIds, questionModelsById);
  const questionMap = new Map(questions.map((q) => [q._id.toString(), q]));

  let totalScore = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;

  for (const answerEntry of session.answers) {
    const question = questionMap.get(answerEntry.questionId.toString());
    if (!question) continue;

    if (answerEntry.status === "skipped" || answerEntry.answer === null) {
      skippedCount++;
      continue;
    }

    // Check if answer is correct
    const isCorrect = checkAnswerCorrectness(question, answerEntry.answer);

    if (isCorrect) {
      totalScore += question.marks || 0;
      correctCount++;
    } else {
      totalScore -= question.negativeMarks || 0;
      wrongCount++;
    }
  }

  // Ensure score doesn't go negative
  totalScore = Math.max(0, totalScore);

  session.score = totalScore;
  session.correctCount = correctCount;
  session.wrongCount = wrongCount;
  session.skippedCount = skippedCount;
  // maxScore already stored when session was created

  // Calculate percentile
  await calculatePercentile(session);

  // Save session with updated score
  await examSessionRepository.save(session);
};

/**
 * Check if answer is correct
 */
/**
 * Resolve a student answer value to its canonical option text.
 * Accepts:
 *   - A plain string/number/boolean → returned as-is (legacy format)
 *   - A MongoDB ObjectId string that matches an option._id → returns that option's text
 *   - An option object { text, _id } → returns the text
 *   - Arrays of any of the above
 * This is the single authoritative resolver used by both save-time normalization
 * and correctness checking, making the system resilient to duplicates.
 */
const resolveAnswerToText = (rawAnswer, options = []) => {
  if (rawAnswer === null || rawAnswer === undefined) return rawAnswer;

  const resolveOne = (val) => {
    if (val === null || val === undefined) return val;
    // Already a plain primitive (text, number, boolean) that is NOT an _id hex string
    if (typeof val === "boolean") return val;
    const str = String(val).trim();
    if (!str) return str;
    // Check if this value matches an option by _id (24-char hex = MongoDB ObjectId)
    if (/^[a-f\d]{24}$/i.test(str) && Array.isArray(options) && options.length > 0) {
      const matched = options.find((o) => o?._id?.toString?.() === str);
      if (matched) return matched.text ?? matched.label ?? str;
    }
    // Check if it's an option object with a text property
    if (typeof val === "object" && val !== null) {
      if (val.text !== undefined) return val.text;
      if (val.label !== undefined) return val.label;
    }
    return str;
  };

  if (Array.isArray(rawAnswer)) return rawAnswer.map(resolveOne);
  return resolveOne(rawAnswer);
};

const checkAnswerCorrectness = (question, studentAnswer) => {
  if (!question || studentAnswer === null || studentAnswer === undefined) {
    return false;
  }

  const options = question.options || [];
  const isIdString = (val) => typeof val === "string" && /^[a-f\d]{24}$/i.test(val.trim());
  const hasCorrectFlags = options.some(o => o.isCorrect === true);

  // If we have explicit correctness flags and the student provided _id(s), perform strict option evaluation.
  // This correctly scores duplicate text options based on the exact choice the student made.
  if (hasCorrectFlags) {
    if ((question.questionType === "single" || question.questionType === "true_false") && isIdString(studentAnswer)) {
      const matchedOption = options.find((o) => o?._id?.toString?.() === studentAnswer.trim());
      if (matchedOption) {
        return matchedOption.isCorrect === true;
      }
    } else if (question.questionType === "multiple") {
      const saArray = Array.isArray(studentAnswer) ? studentAnswer : [studentAnswer];
      if (saArray.length > 0 && saArray.every(isIdString)) {
        const selectedOptions = saArray.map(id => options.find((o) => o?._id?.toString?.() === id.trim())).filter(Boolean);
        const correctOptions = options.filter(o => o.isCorrect === true);
        if (selectedOptions.length === correctOptions.length && selectedOptions.every(o => o.isCorrect === true)) {
          return true;
        }
        return false;
      }
    }
  }

  const correctAnswer = question.correctAnswer;
  // Resolve to canonical text so _id-based answers compare cleanly as a fallback
  const resolvedStudent = resolveAnswerToText(studentAnswer, options);
  const resolvedCorrect = resolveAnswerToText(correctAnswer, options);

  switch (question.questionType) {
    case "single":
      return String(resolvedStudent).trim() === String(resolvedCorrect).trim();

    case "multiple": {
      const sa = Array.isArray(resolvedStudent) ? resolvedStudent : [resolvedStudent];
      const ca = Array.isArray(resolvedCorrect) ? resolvedCorrect : [resolvedCorrect];
      const studentSet = new Set(sa.map((a) => String(a).trim()));
      const correctSet = new Set(ca.map((a) => String(a).trim()));
      return (
        studentSet.size === correctSet.size &&
        Array.from(studentSet).every((val) => correctSet.has(val))
      );
    }

    case "true_false":
      return String(resolvedStudent).toLowerCase() === String(resolvedCorrect).toLowerCase();

    case "integer": {
      const studentRaw = String(studentAnswer ?? "").trim();
      const correctRaw = String(correctAnswer ?? "").trim();
      if (!studentRaw || !correctRaw) return false;
      if (studentRaw === correctRaw) return true;
      const studentNum = Number(studentRaw);
      const correctNum = Number(correctRaw);
      return Number.isFinite(studentNum) && Number.isFinite(correctNum) && studentNum === correctNum;
    }

    default:
      return false;
  }
};

/**
 * Get exam results (with correct answers and explanations)
 */
export const getExamResults = async (sessionId, studentId) => {
  const populateOptions = {
    test: "title description durationMinutes applicableFor questionBank",
    answers: {
      select: "questionText questionType options correctAnswer explanation subject topic marks negativeMarks sectionIndex isParent passage parentQuestionId childQuestions connectedQuestions imageUrl",
      populate: {
        path: "childQuestions",
        select: "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl",
      },
    },
  };

  let session = await examSessionRepository.findOne(
    {
      _id: sessionId,
      student: studentId,
    },
    populateOptions
  );

  if (!session) {
    throw new ApiError(404, "Exam session not found");
  }

  // If time has expired but session is not completed yet, auto-submit on-demand
  const now = new Date();
  const isOverTime = new Date(session.endTime) < now;
  if ((session.status === "in_progress" || session.status === "paused") && isOverTime) {
    try {
      await autoSubmitExam(sessionId, studentId, "time_expired");
      session = await examSessionRepository.findOne(
        {
          _id: sessionId,
          student: studentId,
        },
        populateOptions
      );
    } catch (error) {
      console.error("Error auto-submitting while fetching results:", error);
    }
  }

  if (!session || session.status !== "completed") {
    throw new ApiError(404, "Exam session not found or not completed");
  }

  // Self-correction: check for missing certificate if this is a certification test
  try {
    await issueCourseCompletionCertificate(studentId, session.test?._id || session.test);
  } catch (error) {
    console.error("Error re-triggering certificate issuance:", error);
  }

  const testDoc = await examSessionRepository.findTestById(session.test);

  let isResultsHidden = false;
  let hiddenEventType = null;
  let tournamentLb = null;
  let olympiadInfo = null;

  if (testDoc?.applicableFor === "tournament") {
    tournamentLb = await tournamentService.getTournamentStageLeaderboardForStudent(
      session.test?._id || session.test,
      studentId
    );
    const stageEndDate = tournamentLb?.stageEndTime ? new Date(tournamentLb.stageEndTime) : null;
    isResultsHidden = tournamentLb && now < stageEndDate;
    if (isResultsHidden) hiddenEventType = "tournament";
  } else if (testDoc?.applicableFor === "Olympiads") {
    const OlympiadTest = (await import("../models/OlympiadTest.js")).default;
    const olympiad = await OlympiadTest.findOne({ testId: session.test?._id || session.test });
    if (olympiad && olympiad.resultDeclarationDate) {
      if (now < new Date(olympiad.resultDeclarationDate)) {
        isResultsHidden = true;
        hiddenEventType = "olympiad";
        olympiadInfo = {
          resultDeclarationDate: olympiad.resultDeclarationDate,
          firstPlacePoints: olympiad.firstPlacePoints,
          secondPlacePoints: olympiad.secondPlacePoints,
          thirdPlacePoints: olympiad.thirdPlacePoints,
        };
      }
    }
  }

  const redirectSuggestion = isResultsHidden
    ? (hiddenEventType === "tournament"
      ? (session.autoSubmitted ? "results" : "tournament")
      : (session.autoSubmitted ? "results" : "my-olympiads"))
    : (tournamentLb ? "results" : null);
  const resultsReleased = !isResultsHidden;

  if (isResultsHidden) {
    const pct =
      session.maxScore > 0
        ? Math.round((session.score / session.maxScore) * 100 * 100) / 100
        : 0;

    return {
      session: {
        id: session._id,
        test: session.test,
        startTime: session.startTime,
        endTime: session.endTime,
        completedAt: session.completedAt,
        status: session.status,
      },
      results: {
        score: session.score,
        maxScore: session.maxScore,
        correctCount: session.correctCount,
        wrongCount: session.wrongCount,
        skippedCount: session.skippedCount,
        percentile: session.percentile,
        percentage: pct,
        resultsHiddenUntilStageEnd: true,
        hiddenEventType,
      },
      leaderboard: hiddenEventType === "tournament" && tournamentLb ? {
        resultsHeldUntilStageEnd: true,
        stageEndTime: tournamentLb.stageEndTime,
        top3: [],
        myRank: null,
        totalParticipants: tournamentLb.totalParticipants,
      } : {
        resultsHeldUntilStageEnd: true,
        top3: [],
      },
      ...(hiddenEventType === "tournament" && tournamentLb ? {
        tournament: {
          tournamentId: tournamentLb.tournamentId,
          tournamentTitle: tournamentLb.tournamentTitle,
          stageName: tournamentLb.stageName,
          stageEndTime: tournamentLb.stageEndTime,
          resultsReleased: false,
          redirectSuggestion,
        }
      } : {}),
      ...(hiddenEventType === "olympiad" ? {
        olympiad: {
          resultDeclarationDate: olympiadInfo.resultDeclarationDate,
          firstPlacePoints: olympiadInfo.firstPlacePoints,
          secondPlacePoints: olympiadInfo.secondPlacePoints,
          thirdPlacePoints: olympiadInfo.thirdPlacePoints,
          resultsReleased: false,
          redirectSuggestion,
        }
      } : {}),
      sectionWiseResults: [],
      questions: [],
      message:
        "Results, leaderboard, rank, and question-by-question review unlock after the declaration threshold.",
    };
  }

  const answerQuestionById = new Map(
    session.answers
      .map((entry) => {
        const q = entry.questionId;
        if (!q) return null;
        const plain = q.toObject ? q.toObject() : q;
        return [getNormalizedId(plain._id || q), plain];
      })
      .filter(Boolean)
  );

  // Build results with correct answers and explanations
  const allQuestions = session.answers.map((answer) => {
    const question = answer.questionId;
    if (!question) return null;

    // For connected questions, include child questions with answers
    let childQuestions = null;
    if (question.isParent && question.childQuestions) {
      childQuestions = question.childQuestions
        .map((child) => {
          const childId = getNormalizedId(child);
          if (!childId) return null;
          const populatedChild =
            child && typeof child === "object" && child.questionText != null
              ? child
              : null;
          const childObj = populatedChild || answerQuestionById.get(childId) || { _id: childId };
          return {
            _id: childObj._id,
            questionText: childObj.questionText || "",
            questionType: childObj.questionType || "single",
            options: childObj.options || [],
            correctAnswer: childObj.correctAnswer,
            explanation: childObj.explanation,
            marks: childObj.marks,
            negativeMarks: childObj.negativeMarks,
            imageUrl: childObj.imageUrl || null,
          };
        })
        .filter(Boolean);
    }

    const questionObj = question.toObject ? question.toObject() : question;
    const isCorrect = checkAnswerCorrectness(question, answer.answer);

    return {
      questionId: questionObj._id,
      question: {
        ...questionObj,
        childQuestions,
      },
      studentAnswer: answer.answer,
      correctAnswer: questionObj.correctAnswer,
      isCorrect,
      explanation: questionObj.explanation,
      marks: questionObj.marks || 0,
      negativeMarks: questionObj.negativeMarks || 0,
      status: answer.status,
      answeredAt: answer.answeredAt,
    };
  }).filter((q) => q !== null);
  const questionResultById = new Map(
    allQuestions.map((q) => [getNormalizedId(q.questionId), q])
  );
  const questions = allQuestions
    .filter((q) => !isChildQuestion(q.question))
    .map((q) => {
      if (q.question?.isParent && Array.isArray(q.question.childQuestions)) {
        const enrichedSubQuestions = q.question.childQuestions.map((child) => {
          const childResult = questionResultById.get(getNormalizedId(child?._id));
          const childQuestion = childResult?.question || {};
          return {
            ...childQuestion,
            ...child,
            studentAnswer: childResult?.studentAnswer ?? null,
            isCorrect: childResult?.isCorrect ?? false,
            status: childResult?.status ?? "not_visited",
            answeredAt: childResult?.answeredAt ?? null,
          };
        });
        return {
          ...q,
          question: {
            ...sanitizeConnectedQuestionForResponse(q.question, enrichedSubQuestions),
          },
        };
      }
      return q;
    });
  const logicalSummary = {
    answered: questions.filter((q) => q.status === "answered").length,
    skipped: questions.filter((q) => q.status === "skipped").length,
    markedForReview: questions.filter((q) => q.status === "marked_for_review").length,
    notVisited: questions.filter((q) => q.status === "not_visited").length,
    total: questions.length,
  };
  const sectionNameByIndex = new Map();
  const questionBankId = session?.test?.questionBank?._id || session?.test?.questionBank || null;
  if (questionBankId) {
    const questionBank = await questionBankRepository.findById(questionBankId, false);
    if (Array.isArray(questionBank?.sections)) {
      questionBank.sections.forEach((section, index) => {
        const safeName = section?.name || `Section ${String.fromCharCode(65 + index)}`;
        sectionNameByIndex.set(index, safeName);
      });
    }
  }

  let top3;
  let myRank;
  let totalParticipants;

  if (tournamentLb && resultsReleased) {
    top3 = tournamentLb.top3;
    myRank = tournamentLb.myRank;
    totalParticipants = tournamentLb.totalParticipants;
  } else {
    let rankedByTest;
    if (session.challenge) {
      rankedByTest = await examSessionRepository.getRankedByChallenge(
        session.challenge,
        null,
        null
      );
    } else {
      rankedByTest = await examSessionRepository.getRankedByTest(
        session.test?._id || session.test,
        null,
        null
      );
    }


    top3 = rankedByTest.slice(0, 3).map((entry, index) => ({
      rank: index + 1,
      student: entry.student,
      name: entry.name || null,
      email: entry.email || null,
      score: entry.score ?? 0,
      maxScore: entry.maxScore ?? null,
      completedAt: entry.completedAt || null,
    }));
    const myRankIndex = rankedByTest.findIndex(
      (entry) =>
        (entry.student?._id?.toString?.() || entry.student?.toString?.()) ===
        studentId.toString()
    );
    myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
    totalParticipants = rankedByTest.length;
  }
  const nonParentResults = allQuestions.filter((q) => !q.question?.isParent);
  const earnedMarks = nonParentResults.reduce(
    (sum, q) => sum + (q.isCorrect ? Number(q.marks || 0) : 0),
    0
  );
  const negativeMarksDeducted = nonParentResults.reduce(
    (sum, q) => sum + (!q.isCorrect && q.status !== "skipped" ? Number(q.negativeMarks || 0) : 0),
    0
  );
  const totalNegativeMarksPossible = nonParentResults.reduce(
    (sum, q) => sum + Number(q.negativeMarks || 0),
    0
  );
  const sectionStatsMap = new Map();
  nonParentResults.forEach((q) => {
    const sectionIndex = Number.isInteger(q?.question?.sectionIndex)
      ? q.question.sectionIndex
      : 0;
    const sectionName =
      sectionNameByIndex.get(sectionIndex) ||
      `Section ${String.fromCharCode(65 + sectionIndex)}`;
    if (!sectionStatsMap.has(sectionIndex)) {
      sectionStatsMap.set(sectionIndex, {
        sectionIndex,
        sectionName,
        score: 0,
        maxScore: 0,
        earnedMarks: 0,
        negativeMarksDeducted: 0,
        correctCount: 0,
        wrongCount: 0,
        skippedCount: 0,
        totalQuestions: 0,
      });
    }
    const section = sectionStatsMap.get(sectionIndex);
    const marks = Number(q.marks || 0);
    const negative = Number(q.negativeMarks || 0);
    section.totalQuestions += 1;
    section.maxScore += marks;
    if (q.isCorrect) {
      section.correctCount += 1;
      section.earnedMarks += marks;
      section.score += marks;
    } else if (q.status === "skipped") {
      section.skippedCount += 1;
    } else {
      section.wrongCount += 1;
      section.negativeMarksDeducted += negative;
      section.score -= negative;
    }
    section.score = Math.max(0, section.score);
  });
  const sectionWiseResults = [...sectionStatsMap.values()]
    .sort((a, b) => a.sectionIndex - b.sectionIndex)
    .map((section) => ({
      ...section,
      percentage:
        section.maxScore > 0
          ? Math.round((section.score / section.maxScore) * 100 * 100) / 100
          : 0,
    }));

  return {
    session: {
      id: session._id,
      test: session.test,
      challengeId: session.challenge || null,
      startTime: session.startTime,
      endTime: session.endTime,
      completedAt: session.completedAt,
      status: session.status,
    },
    results: {
      score: session.score,
      maxScore: session.maxScore,
      earnedMarks,
      negativeMarksDeducted,
      totalNegativeMarksPossible,
      correctCount: session.correctCount,
      wrongCount: session.wrongCount,
      skippedCount: session.skippedCount,
      totalQuestions: logicalSummary.total,
      percentile: session.percentile,
      percentage: session.maxScore > 0
        ? Math.round((session.score / session.maxScore) * 100 * 100) / 100
        : 0,
      rank: myRank,
      isCertificationFailed: 
        testDoc?.applicableFor === "certificate" && 
        testDoc?.passingPercentage != null && 
        (session.maxScore > 0 ? Math.round((session.score / session.maxScore) * 100 * 100) / 100 : 0) < testDoc.passingPercentage,
    },
    palette: logicalSummary,
    leaderboard: {
      top3,
      myRank,
      totalParticipants,
    },
    sectionWiseResults,
    questions,
    ...(tournamentLb
      ? {
        tournament: {
          tournamentId: tournamentLb.tournamentId,
          tournamentTitle: tournamentLb.tournamentTitle,
          stageName: tournamentLb.stageName,
          stageEndTime: tournamentLb.stageEndTime,
          resultsReleased: true,
          redirectSuggestion: redirectSuggestion || "results",
        },
      }
      : {}),
    ...(olympiadInfo
      ? {
        olympiad: {
          resultDeclarationDate: olympiadInfo.resultDeclarationDate,
          firstPlacePoints: olympiadInfo.firstPlacePoints,
          secondPlacePoints: olympiadInfo.secondPlacePoints,
          thirdPlacePoints: olympiadInfo.thirdPlacePoints,
          resultsReleased: true,
          redirectSuggestion: redirectSuggestion || "results",
        },
      }
      : {}),
  };
};

/**
 * Get question palette (navigation grid)
 */
export const getQuestionPalette = async (sessionId, studentId) => {
  const session = await examSessionRepository.findOne(
    {
      _id: sessionId,
      student: studentId,
    },
    {
      answers: {
        select: "_id questionText",
      },
    }
  );

  if (!session) {
    throw new ApiError(404, "Exam session not found");
  }

  const palette = session.answers.map((answer, index) => ({
    questionNumber: index + 1,
    questionId: answer.questionId._id,
    status: answer.status,
    hasAnswer: answer.answer !== null && answer.answer !== undefined,
  }));

  const summary = {
    answered: session.answers.filter((a) => a.status === "answered").length,
    skipped: session.answers.filter((a) => a.status === "skipped").length,
    markedForReview: session.answers.filter((a) => a.status === "marked_for_review").length,
    notVisited: session.answers.filter((a) => a.status === "not_visited").length,
    total: session.answers.length,
  };

  return {
    palette,
    summary,
  };
};

/**
 * Calculate percentile for the exam session
 */
const calculatePercentile = async (session) => {
  // Build percentile distribution by student best score (not by attempts).
  const allSessions = await examSessionRepository.findAllCompletedSessions(session.test);
  const bestScoreByStudent = new Map();

  for (const s of allSessions) {
    const studentId = s.student?.toString?.();
    if (!studentId) continue;
    const existing = bestScoreByStudent.get(studentId);
    const score = s.score ?? 0;
    if (existing === undefined || score > existing) {
      bestScoreByStudent.set(studentId, score);
    }
  }

  const currentStudentId = session.student?.toString?.();
  const currentScore = session.score ?? 0;
  if (currentStudentId) {
    const existing = bestScoreByStudent.get(currentStudentId);
    if (existing === undefined || currentScore > existing) {
      bestScoreByStudent.set(currentStudentId, currentScore);
    }
  }

  const bestScores = [...bestScoreByStudent.values()];
  if (bestScores.length === 0) {
    session.percentile = 100;
    return;
  }

  // Percentile rank = % students with best score <= current score.
  const atOrBelow = bestScores.filter((score) => score <= currentScore).length;
  session.percentile = Math.round((atOrBelow / bestScores.length) * 100 * 100) / 100;
};

/**
 * Format time in milliseconds to readable format
 */
const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * Get paused sessions for a student
 */
export const getInProgressSessions = async (studentId, page = 1, limit = 10) => {
  return await examSessionRepository.findAll(
    {
      student: studentId,
      status: "paused",
      challenge: null,
    },
    {
      page,
      limit,
      sortBy: "startTime",
      sortOrder: "desc",
    }
  );
};

export default {
  startExamSession,
  pauseExamSession,
  getExamInstructions,
  getExamSession,
  saveAnswer,
  visitQuestion,
  markForReview,
  skipQuestion,
  logProctoringEvent,
  submitExam,
  getExamResults,
  getQuestionPalette,
  autoSubmitExpiredSessions,
  getInProgressSessions,
};
