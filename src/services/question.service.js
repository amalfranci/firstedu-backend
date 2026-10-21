import { ApiError } from "../utils/ApiError.js";
import questionRepository from "../repository/question.repository.js";
import questionBankRepository from "../repository/questionBank.repository.js";
import { assertBankNotInUse } from "../utils/bankUsageGuard.js";

const toQuestionPlain = (doc) => {
  if (!doc) return null;
  return doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
};

// Validate question options and correct answer
const validateQuestionOptions = (questionType, options) => {
  if (
    (questionType === "single" || questionType === "multiple") &&
    options
  ) {
    const correctOptions = options.filter((opt) => opt.isCorrect);
    if (correctOptions.length === 0) {
      throw new ApiError(400, "At least one option must be marked as correct");
    }

    // For single choice, ensure only one correct option
    if (questionType === "single" && correctOptions.length > 1) {
      throw new ApiError(
        400,
        "Single choice questions must have exactly one correct answer"
      );
    }
  }
};

const validateConnectedQuestions = (connectedQuestions = []) => {
  if (!Array.isArray(connectedQuestions) || connectedQuestions.length === 0) {
    throw new ApiError(
      400,
      "Connected questions must include at least one sub-question"
    );
  }
  connectedQuestions.forEach((sub, index) => {
    validateQuestionOptions(sub.questionType, sub.options);
    if (!String(sub.explanation ?? "").trim()) {
      throw new ApiError(
        400,
        `connectedQuestions[${index}] explanation is required`
      );
    }
    if (sub.questionType === "true_false" && sub.correctAnswer === undefined) {
      throw new ApiError(
        400,
        `connectedQuestions[${index}] correctAnswer is required for true_false`
      );
    }
  });
};

const normalizeSubQuestionScoring = (sub = {}) => ({
  marks: sub.marks ?? 1,
  negativeMarks: sub.negativeMarks ?? 0,
});

const getConnectedTotals = (subs = []) =>
  subs.reduce(
    (acc, sub) => {
      const { marks, negativeMarks } = normalizeSubQuestionScoring(sub);
      return {
        marks: acc.marks + marks,
        negativeMarks: acc.negativeMarks + negativeMarks,
      };
    },
    { marks: 0, negativeMarks: 0 }
  );

const formatConnectedQuestionForEdit = (parentDoc, childDocs = []) => {
  const parent = toQuestionPlain(parentDoc);
  const children = (childDocs || []).map((child) => toQuestionPlain(child));

  return {
    ...parent,
    questionText: parent.questionText || "",
    title: parent.questionText || "",
    paragraph: parent.passage || "",
    passage: parent.passage || "",
    subQuestions: children.map((child) => ({
      _id: child._id,
      questionText: child.questionText,
      questionType: child.questionType,
      options: child.options || [],
      correctAnswer: child.correctAnswer,
      explanation: child.explanation,
      marks: child.marks ?? 1,
      negativeMarks: child.negativeMarks ?? 0,
      imageUrl: child.imageUrl || null,
      id: child.id || child._id,
    })),
  };
};

// Create Question Service
export const createQuestion = async (questionData, createdBy) => {
  // Add createdBy from authenticated admin
  questionData.createdBy = createdBy;

  // Validate correct answer matches options for single/multiple choice
  validateQuestionOptions(questionData.questionType, questionData.options);
  if (questionData.questionType === "connected") {
    const subsEarly =
      questionData.subQuestions ?? questionData.connectedQuestions ?? [];
    validateConnectedQuestions(subsEarly);
  }

  let sectionAwareBank = null;
  if (questionData.questionBank) {
    sectionAwareBank = await questionBankRepository.findById(
      questionData.questionBank,
      false
    );
    if (!sectionAwareBank) {
      throw new ApiError(404, "Question bank not found");
    }

    if (sectionAwareBank.useSectionWiseQuestions) {
      if (
        questionData.sectionIndex === undefined ||
        questionData.sectionIndex === null
      ) {
        throw new ApiError(
          400,
          "sectionIndex is required when section-wise questions is enabled"
        );
      }

      const sectionIndex = Number(questionData.sectionIndex);
      if (
        Number.isNaN(sectionIndex) ||
        sectionIndex < 0 ||
        sectionIndex >= (sectionAwareBank.sections || []).length
      ) {
        throw new ApiError(400, "Invalid sectionIndex for question bank");
      }

      const selectedSection = sectionAwareBank.sections[sectionIndex];
      const existingCount = selectedSection?.questions?.length || 0;
      const allowedCount = Number(selectedSection?.count || 0);
      if (allowedCount > 0 && existingCount >= allowedCount) {
        throw new ApiError(
          400,
          `Selected section already has maximum ${allowedCount} question(s)`
        );
      }

      questionData.sectionIndex = sectionIndex;
    }
  }

  if (questionData.questionType === "connected") {
    const subs =
      questionData.subQuestions ?? questionData.connectedQuestions ?? [];
    const connectedTotals = getConnectedTotals(subs);
    const passageText =
      (questionData.paragraph && String(questionData.paragraph).trim()) ||
      (questionData.passage && String(questionData.passage).trim()) ||
      (questionData.questionText && String(questionData.questionText).trim()) ||
      "";
    const parentLabel =
      (questionData.title && String(questionData.title).trim()) ||
      (questionData.questionText && String(questionData.questionText).trim()) ||
      passageText.slice(0, 200);
    const parentPayload = {
      ...questionData,
      questionText: parentLabel,
      isParent: true,
      passage: passageText,
      imageUrl: questionData.imageUrl || null,
      marks: connectedTotals.marks,
      negativeMarks: connectedTotals.negativeMarks,
      correctAnswer: undefined,
      options: [],
      connectedQuestions: [],
    };
    const parentQuestion = await questionRepository.create(parentPayload);
    const childIds = [];

    for (const sub of subs) {
      const { marks, negativeMarks } = normalizeSubQuestionScoring(sub);
      const child = await questionRepository.create({
        questionText: sub.questionText,
        questionType: sub.questionType,
        options: sub.options,
        correctAnswer: sub.correctAnswer,
        explanation: sub.explanation,
        subject: questionData.subject,
        topic: questionData.topic,
        difficulty: questionData.difficulty,
        marks,
        negativeMarks,
        tags: questionData.tags,
        imageUrl: sub.imageUrl || null,
        questionBank: questionData.questionBank,
        sectionIndex: questionData.sectionIndex,
        orderInBank: questionData.orderInBank,
        createdBy,
        parentQuestionId: parentQuestion._id,
      });
      childIds.push(child._id);
    }

    const question = await questionRepository.updateById(parentQuestion._id, {
      childQuestions: childIds,
    });

    if (sectionAwareBank?.useSectionWiseQuestions) {
      const sections = (sectionAwareBank.sections || []).map((section) => ({
        ...section,
        questions: [...(section.questions || [])],
      }));
      sections[questionData.sectionIndex].questions.push(question._id);
      childIds.forEach((id) => sections[questionData.sectionIndex].questions.push(id));
      await questionBankRepository.updateById(sectionAwareBank._id, { sections });
    }
    return question;
  }

  if (!Object.prototype.hasOwnProperty.call(questionData, "imageUrl")) {
    questionData.imageUrl = null;
  }
  const question = await questionRepository.create(questionData);

  if (sectionAwareBank?.useSectionWiseQuestions) {
    const sections = (sectionAwareBank.sections || []).map((section) => ({
      ...section,
      questions: [...(section.questions || [])],
    }));
    sections[questionData.sectionIndex].questions.push(question._id);
    await questionBankRepository.updateById(sectionAwareBank._id, {
      sections,
    });
  }

  const createdQuestion = await questionRepository.findById(question._id);
  return createdQuestion;
};

// Get All Questions Service
export const getAllQuestions = async (filterOptions) => {
  const {
    page,
    limit,
    sortBy,
    sortOrder,
    search,
    subject,
    topic,
    difficulty,
    questionType,
    isParent,
    questionBank,
  } = filterOptions;

  const options = {
    page,
    limit,
    sortBy,
    sortOrder,
    search,
    subject,
    topic,
    difficulty,
    questionType,
    isParent,
    questionBank,
  };

  const result = await questionRepository.findAll({ isActive: true }, options);

  return result;
};

// Get Question by ID Service
export const getQuestionById = async (id) => {
  const question = await questionRepository.findById(id);

  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  if (question.questionType === "connected" && question.isParent) {
    const childIds = (question.childQuestions || []).map((child) =>
      child?._id?.toString?.() || child?.toString?.()
    );
    const children = childIds.length
      ? await questionRepository.findByIds(childIds)
      : [];
    const childrenMap = new Map(children.map((c) => [c._id?.toString?.() || String(c._id), c]));
    const orderedChildren = childIds.map((cid) => childrenMap.get(cid)).filter(Boolean);
    return formatConnectedQuestionForEdit(question, orderedChildren);
  }

  return question;
};

// Update Question Service
export const updateQuestion = async (id, updateData) => {
  // Check if question exists
  const existingQuestion = await questionRepository.findById(id);
  if (!existingQuestion) {
    throw new ApiError(404, "Question not found");
  }

  // Block edit if the question's parent bank is currently used in any test
  if (existingQuestion.questionBank) {
    await assertBankNotInUse(existingQuestion.questionBank, "edit");
  }

  // Validate correct answer if options are being updated
  if (updateData.options && updateData.questionType !== "connected") {
    validateQuestionOptions(
      updateData.questionType || existingQuestion.questionType,
      updateData.options
    );
  }

  const effectiveType = updateData.questionType || existingQuestion.questionType;
  const hasSubQuestionsUpdate =
    Array.isArray(updateData.subQuestions) ||
    Array.isArray(updateData.connectedQuestions);
  const isConnectedEdit =
    effectiveType === "connected" ||
    hasSubQuestionsUpdate;

  if (isConnectedEdit) {
    if (existingQuestion.questionType !== "connected" || !existingQuestion.isParent) {
      throw new ApiError(
        400,
        "Connected question editing is only supported for connected parent questions"
      );
    }

    if (!hasSubQuestionsUpdate) {
      const partialParentUpdate = {};
      if (
        Object.prototype.hasOwnProperty.call(updateData, "title") ||
        Object.prototype.hasOwnProperty.call(updateData, "questionText")
      ) {
        partialParentUpdate.questionText =
          (updateData.title && String(updateData.title).trim()) ||
          (updateData.questionText && String(updateData.questionText).trim()) ||
          existingQuestion.questionText;
      }
      if (
        Object.prototype.hasOwnProperty.call(updateData, "paragraph") ||
        Object.prototype.hasOwnProperty.call(updateData, "passage")
      ) {
        partialParentUpdate.passage =
          (updateData.paragraph && String(updateData.paragraph).trim()) ||
          (updateData.passage && String(updateData.passage).trim()) ||
          existingQuestion.passage;
      }
      ["subject", "topic", "difficulty", "tags", "imageUrl"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          partialParentUpdate[key] = updateData[key];
        }
      });

      const updatedParent = await questionRepository.updateById(
        id,
        partialParentUpdate
      );

      if (
        partialParentUpdate.difficulty &&
        Array.isArray(existingQuestion.childQuestions) &&
        existingQuestion.childQuestions.length > 0
      ) {
        const childIds = existingQuestion.childQuestions.map(
          (child) => child?._id?.toString?.() || child?.toString?.()
        );
        await questionRepository.updateDifficultyByIds(
          childIds,
          partialParentUpdate.difficulty
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(updateData, "marks") ||
        Object.prototype.hasOwnProperty.call(updateData, "negativeMarks")
      ) {
        const existingChildIds = (existingQuestion.childQuestions || []).map(
          (child) => child?._id?.toString?.() || child?.toString?.()
        );
        const existingChildren = existingChildIds.length
          ? await questionRepository.findByIds(existingChildIds)
          : [];
        const connectedTotals = getConnectedTotals(existingChildren);
        partialParentUpdate.marks = connectedTotals.marks;
        partialParentUpdate.negativeMarks = connectedTotals.negativeMarks;
      }

      const childIds = (updatedParent.childQuestions || []).map((child) =>
        child?._id?.toString?.() || child?.toString?.()
      );
      const children = childIds.length
        ? await questionRepository.findByIds(childIds)
        : [];
      return formatConnectedQuestionForEdit(updatedParent, children);
    }

    const subs = updateData.subQuestions ?? updateData.connectedQuestions ?? [];
    validateConnectedQuestions(subs);
    const connectedTotals = getConnectedTotals(subs);

    const passageText =
      (updateData.paragraph && String(updateData.paragraph).trim()) ||
      (updateData.passage && String(updateData.passage).trim()) ||
      (updateData.questionText && String(updateData.questionText).trim()) ||
      (existingQuestion.passage && String(existingQuestion.passage).trim()) ||
      "";
    if (!passageText) {
      throw new ApiError(400, "Connected question passage/paragraph is required");
    }

    const parentLabel =
      (updateData.title && String(updateData.title).trim()) ||
      (updateData.questionText && String(updateData.questionText).trim()) ||
      (existingQuestion.questionText && String(existingQuestion.questionText).trim()) ||
      passageText.slice(0, 200);

    const parentUpdate = {
      questionText: parentLabel,
      passage: passageText,
      subject: updateData.subject ?? existingQuestion.subject,
      topic: updateData.topic ?? existingQuestion.topic,
      difficulty: updateData.difficulty ?? existingQuestion.difficulty,
      tags: updateData.tags ?? existingQuestion.tags,
    };
    if (Object.prototype.hasOwnProperty.call(updateData, "imageUrl")) {
      parentUpdate.imageUrl = updateData.imageUrl;
    }

    const existingChildIds = (existingQuestion.childQuestions || []).map((child) =>
      child?._id?.toString?.() || child?.toString?.()
    );
    const existingChildIdSet = new Set(existingChildIds);
    const incomingChildIds = new Set();
    const newChildIds = [];

    for (const sub of subs) {
      const { marks, negativeMarks } = normalizeSubQuestionScoring(sub);
      const subIdStr = sub._id ? String(sub._id) : (sub.id ? String(sub.id) : null);

      const subData = {
        questionText: sub.questionText,
        questionType: sub.questionType,
        options: sub.options,
        correctAnswer: sub.correctAnswer,
        explanation: sub.explanation,
        subject: parentUpdate.subject,
        topic: parentUpdate.topic,
        difficulty: parentUpdate.difficulty,
        marks,
        negativeMarks,
        tags: parentUpdate.tags,
        imageUrl: sub.imageUrl || null,
      };

      if (subIdStr && existingChildIdSet.has(subIdStr)) {
        // Edit existing sub-question in place (preserves original _id without deletion)
        await questionRepository.updateById(subIdStr, subData);
        newChildIds.push(subIdStr);
        incomingChildIds.add(subIdStr);
      } else {
        // Create only new sub-questions
        const child = await questionRepository.create({
          ...subData,
          questionBank: existingQuestion.questionBank?._id || existingQuestion.questionBank,
          sectionIndex: existingQuestion.sectionIndex,
          orderInBank: existingQuestion.orderInBank,
          createdBy: existingQuestion.createdBy?._id || existingQuestion.createdBy,
          parentQuestionId: existingQuestion._id,
        });
        const createdIdStr = child?._id?.toString?.() || String(child._id);
        newChildIds.push(createdIdStr);
        incomingChildIds.add(createdIdStr);
      }
    }

    // Only delete child questions that the admin explicitly removed
    const removedChildIds = existingChildIds.filter((cid) => !incomingChildIds.has(cid));
    if (removedChildIds.length > 0) {
      await Promise.all(removedChildIds.map((childId) => questionRepository.deleteById(childId)));
    }

    // Keep section-wise bank question list in sync if questions were added/removed
    if (
      existingQuestion.questionBank &&
      (removedChildIds.length > 0 || newChildIds.some((nid) => !existingChildIdSet.has(nid)))
    ) {
      const bankId = existingQuestion.questionBank?._id || existingQuestion.questionBank;
      const bank = await questionBankRepository.findById(bankId, false);
      if (
        bank?.useSectionWiseQuestions &&
        typeof existingQuestion.sectionIndex === 'number' &&
        bank.sections?.[existingQuestion.sectionIndex]
      ) {
        const sIndex = existingQuestion.sectionIndex;
        const currentSecQuestions = (bank.sections[sIndex].questions || []).map((q) =>
          q?._id?.toString?.() || q?.toString?.()
        );
        const filteredSecQuestions = currentSecQuestions.filter(
          (qid) => !removedChildIds.includes(qid)
        );
        for (const nid of newChildIds) {
          if (!filteredSecQuestions.includes(nid) && !existingChildIdSet.has(nid)) {
            filteredSecQuestions.push(nid);
          }
        }
        const sections = bank.sections.map((sec, idx) => ({
          ...sec,
          questions: idx === sIndex ? filteredSecQuestions : sec.questions,
        }));
        await questionBankRepository.updateById(bank._id, { sections });
      }
    }

    const updatedParent = await questionRepository.updateById(id, {
      ...parentUpdate,
      marks: connectedTotals.marks,
      negativeMarks: connectedTotals.negativeMarks,
      childQuestions: newChildIds,
      connectedQuestions: [],
      options: [],
      correctAnswer: undefined,
      isParent: true,
    });

    const children = newChildIds.length
      ? await questionRepository.findByIds(newChildIds)
      : [];
    const childrenMap = new Map(children.map((c) => [c._id?.toString?.() || String(c._id), c]));
    const orderedChildren = newChildIds.map((cid) => childrenMap.get(cid)).filter(Boolean);
    return formatConnectedQuestionForEdit(updatedParent, orderedChildren);
  }

  const updatedQuestion = await questionRepository.updateById(id, updateData);

  return updatedQuestion;
};

// Delete Question Service
export const deleteQuestion = async (id) => {
  const question = await questionRepository.findById(id);
  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  // Block delete if the question's parent bank is currently used in any test
  if (question.questionBank) {
    await assertBankNotInUse(question.questionBank, "delete");
  }

  await questionRepository.deleteById(id);

  return true;
};

// Add Child Question Service
export const addChildQuestion = async (parentId, childQuestionId) => {
  // Check if parent question exists and is a parent
  const parent = await questionRepository.findById(parentId);
  if (!parent) {
    throw new ApiError(404, "Parent question not found");
  }
  if (!parent.isParent) {
    throw new ApiError(400, "Question is not a parent question");
  }

  // Check if child question exists
  const child = await questionRepository.findById(childQuestionId);
  if (!child) {
    throw new ApiError(404, "Child question not found");
  }

  const updatedParent = await questionRepository.addChildQuestion(
    parentId,
    childQuestionId
  );

  return updatedParent;
};

// Remove Child Question Service
export const removeChildQuestion = async (parentId, childId) => {
  const parent = await questionRepository.findById(parentId);
  if (!parent) {
    throw new ApiError(404, "Parent question not found");
  }

  const updatedParent = await questionRepository.removeChildQuestion(
    parentId,
    childId
  );

  return updatedParent;
};

// Get Question Analytics Service
export const getQuestionAnalytics = async (questionId) => {
  const question = await questionRepository.findById(questionId);
  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  const analytics = await questionRepository.getAnalytics(questionId);

  return analytics;
};

// Calculate Analytics Service
export const calculateAnalytics = async (questionId, analyticsData) => {
  const question = await questionRepository.findById(questionId);
  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  const {
    upperGroupCorrect,
    lowerGroupCorrect,
    upperGroupTotal,
    lowerGroupTotal,
  } = analyticsData;

  // Calculate P-Value (Difficulty)
  const totalAttempts = upperGroupTotal + lowerGroupTotal;
  const correctAttempts = upperGroupCorrect + lowerGroupCorrect;
  const pValue = totalAttempts > 0 ? correctAttempts / totalAttempts : null;

  // Calculate Discrimination Index
  const upperPercent =
    upperGroupTotal > 0 ? upperGroupCorrect / upperGroupTotal : 0;
  const lowerPercent =
    lowerGroupTotal > 0 ? lowerGroupCorrect / lowerGroupTotal : 0;
  const discriminationIndex = upperPercent - lowerPercent;

  // Update analytics
  const updatedQuestion = await questionRepository.updateAnalytics(
    questionId,
    {
      pValue,
      discriminationIndex,
      totalAttempts,
      correctAttempts,
    }
  );

  return {
    pValue: updatedQuestion.analytics.pValue,
    discriminationIndex: updatedQuestion.analytics.discriminationIndex,
    totalAttempts: updatedQuestion.analytics.totalAttempts,
    correctAttempts: updatedQuestion.analytics.correctAttempts,
    lastCalculated: updatedQuestion.analytics.lastCalculated,
  };
};

// Get Bulk Analytics Service
export const getBulkAnalytics = async (questionIds) => {
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    throw new ApiError(400, "questionIds must be a non-empty array");
  }

  const result = await questionRepository.findAll(
    { _id: { $in: questionIds }, isActive: true },
    { limit: questionIds.length }
  );

  const analytics = result.questions.map((q) => ({
    questionId: q._id,
    questionText: q.questionText,
    pValue: q.analytics?.pValue || null,
    discriminationIndex: q.analytics?.discriminationIndex || null,
    totalAttempts: q.analytics?.totalAttempts || 0,
    correctAttempts: q.analytics?.correctAttempts || 0,
    lastCalculated: q.analytics?.lastCalculated || null,
  }));

  return analytics;
};

export default {
  createQuestion,
  getAllQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  addChildQuestion,
  removeChildQuestion,
  getQuestionAnalytics,
  calculateAnalytics,
  getBulkAnalytics,
};

