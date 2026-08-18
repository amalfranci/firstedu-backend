import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import AiQuestion from "../models/AiQuestion.js";
import aiQuestionBankRepository from "../repository/aiQuestionBank.repository.js";
import categoryRepository from "../repository/category.repository.js";
import { assertAiBankNotInUse } from "../utils/aiBankUsageGuard.js";
import { logConfirmedQuestionsToFile } from "./confirmedQuestionsLogger.service.js";

const getSectionIndexByCount = (sectionConfigs = [], questionIndex = 0) => {
  let cursor = 0;
  for (let i = 0; i < sectionConfigs.length; i++) {
    const count = Number(sectionConfigs[i]?.count || 0);
    if (questionIndex < cursor + count) return i;
    cursor += count;
  }
  return null;
};

const validateQuestionOptions = (questionType, options) => {
  if (
    (questionType === "single" || questionType === "multiple") &&
    options
  ) {
    const correctOptions = options.filter((opt) => opt.isCorrect);
    if (correctOptions.length === 0) {
      throw new ApiError(400, "At least one option must be marked as correct");
    }
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

const resolveQuestionNegativeMarks = (
  q,
  questionIndex,
  { useSectionWise, sections, bankNegativeMarks }
) => {
  if (Number(q?.negativeMarks) > 0) {
    return Number(q.negativeMarks);
  }
  if (useSectionWise) {
    const sectionIndex = getSectionIndexByCount(sections, questionIndex);
    const sectionValue = sections[sectionIndex]?.negativeMarks;
    return Number(sectionValue) >= 0 ? Number(sectionValue) : 1;
  }
  return Number(bankNegativeMarks) >= 0 ? Number(bankNegativeMarks) : 1;
};

const applyNegativeMarksToConnectedSubs = (subs, fallbackNegativeMarks) =>
  (subs || []).map((sub) => ({
    ...sub,
    negativeMarks:
      Number(sub?.negativeMarks) > 0
        ? Number(sub.negativeMarks)
        : fallbackNegativeMarks,
  }));

const validateQuestionInput = (q, i) => {
  if (q.questionType === "connected") {
    const subs = q.subQuestions ?? q.connectedQuestions ?? [];
    validateConnectedQuestions(subs);
    const reading =
      (q.paragraph && String(q.paragraph).trim()) ||
      (q.passage && String(q.passage).trim()) ||
      "";
    if (!reading) {
      throw new ApiError(
        400,
        `Question ${i + 1}: paragraph is required for connected questions`
      );
    }
    return;
  }

  validateQuestionOptions(q.questionType, q.options);
  if (!String(q.explanation || "").trim()) {
    throw new ApiError(400, `Question ${i + 1}: explanation is required`);
  }
};

/**
 * Best-effort: mirror a saved bank's questions to temp/confirmed-questions/*.txt
 * (same human-readable format as the AI-suggestion "log to file" action), so
 * every saved paper has a response .txt regardless of which UI path built it.
 * Never throws — logging must not break a successful save.
 */
const logSavedBankQuestions = async ({
  topic,
  bankName,
  useSectionWise,
  sections,
  questions,
}) => {
  if (!topic || !Array.isArray(questions) || !questions.length) return;
  // Connected questions carry the passage under `paragraph`; the logger reads `passage`.
  const normalize = (q) =>
    q?.questionType === "connected"
      ? { ...q, passage: q.passage ?? q.paragraph ?? "" }
      : q;

  if (useSectionWise && Array.isArray(sections) && sections.length) {
    const bySection = new Map();
    questions.forEach((q, i) => {
      const idx = getSectionIndexByCount(sections, i);
      if (!bySection.has(idx)) bySection.set(idx, []);
      bySection.get(idx).push(normalize(q));
    });
    for (const [idx, qs] of bySection) {
      await logConfirmedQuestionsToFile({
        topic,
        bankName,
        sectionName: idx != null ? sections[idx]?.name || "" : "",
        sectionIndex: idx,
        questions: qs,
      });
    }
  } else {
    await logConfirmedQuestionsToFile({
      topic,
      bankName,
      questions: questions.map(normalize),
    });
  }
};

export const createAiQuestionBankWithQuestions = async (data, createdBy) => {
  const categoryIds = data.categories || [];
  for (const catId of categoryIds) {
    const cat = await categoryRepository.findById(catId);
    if (!cat) throw new ApiError(404, `Category not found: ${catId}`);
  }

  const bankName = String(data.name || "").trim();
  if (!bankName) throw new ApiError(400, "Bank name is required");

  const duplicate = await aiQuestionBankRepository.findDuplicateName(
    bankName,
    createdBy
  );
  if (duplicate) {
    throw new ApiError(
      400,
      `An AI question bank named "${duplicate.name}" already exists`
    );
  }

  const questionsInput = data.questions || [];
  const overallDifficulty = data.overallDifficulty || "medium";
  const useSectionWise = data.useSectionWise ?? false;
  const sections = useSectionWise ? data.sections || [] : [];
  const bankNegativeMarks =
    Number(data.negativeMarks) >= 0 ? Number(data.negativeMarks) : 1;

  if (!questionsInput.length) {
    throw new ApiError(400, "At least one question is required");
  }

  if (useSectionWise) {
    if (!sections.length) {
      throw new ApiError(
        400,
        "sections must be configured when section-wise is enabled"
      );
    }
    const expectedCount = sections.reduce(
      (sum, s) => sum + Number(s.count || 0),
      0
    );
    if (questionsInput.length !== expectedCount) {
      throw new ApiError(
        400,
        `Number of questions (${questionsInput.length}) must match total count (${expectedCount})`
      );
    }
  }

  questionsInput.forEach((q, i) => validateQuestionInput(q, i));

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const bank = await aiQuestionBankRepository.create(
      {
        name: bankName,
        categories: categoryIds,
        overallDifficulty,
        useSectionWise,
        negativeMarks: useSectionWise ? 0 : bankNegativeMarks,
        sections: sections.map((s, idx) => ({
          id: s.id ?? idx + 1,
          name: s.name || `Section ${idx + 1}`,
          count: s.count,
          difficulty: s.difficulty || overallDifficulty,
          timeMinutes: s.timeMinutes ?? 0,
          negativeMarks:
            Number(s.negativeMarks) >= 0 ? Number(s.negativeMarks) : 1,
          contentType: s.contentType === "image" ? "image" : "text",
        })),
        aiProvider: data.aiProvider || "gemini",
        generationTopic: data.generationTopic || null,
        questionCount: questionsInput.length,
        createdBy,
      },
      session
    );

    const createdQuestions = [];

    for (let i = 0; i < questionsInput.length; i++) {
      const q = questionsInput[i];
      const sectionIndex = useSectionWise
        ? getSectionIndexByCount(sections, i)
        : null;
      const sectionDifficulty =
        useSectionWise && sectionIndex !== null
          ? sections[sectionIndex]?.difficulty
          : null;
      const difficulty = q.difficulty || sectionDifficulty || overallDifficulty;
      const questionNegativeMarks = resolveQuestionNegativeMarks(q, i, {
        useSectionWise,
        sections,
        bankNegativeMarks,
      });
      const baseFields = {
        topic: q.topic,
        difficulty,
        tags: q.tags,
        aiBatchNumber: q.aiBatchNumber ?? null,
        sectionIndex,
        aiQuestionBank: bank._id,
        orderInBank: i,
        createdBy,
      };

      if (q.questionType === "connected") {
        const rawSubs = q.subQuestions ?? q.connectedQuestions ?? [];
        const subs = applyNegativeMarksToConnectedSubs(
          rawSubs,
          questionNegativeMarks
        );
        validateConnectedQuestions(subs);
        const connectedTotals = getConnectedTotals(subs);
        const passageText =
          (q.paragraph && String(q.paragraph).trim()) ||
          (q.passage && String(q.passage).trim()) ||
          (q.questionText && String(q.questionText).trim()) ||
          "";
        const parentLabel =
          (q.title && String(q.title).trim()) ||
          (q.questionText && String(q.questionText).trim()) ||
          passageText.slice(0, 200);

        const [parent] = await AiQuestion.create(
          [
            {
              ...baseFields,
              questionText: parentLabel,
              questionType: "connected",
              isParent: true,
              passage: passageText,
              marks: connectedTotals.marks,
              negativeMarks: connectedTotals.negativeMarks,
              options: [],
              connectedQuestions: [],
            },
          ],
          { session }
        );

        const childIds = [];
        for (let si = 0; si < subs.length; si++) {
          const sub = subs[si];
          const { marks, negativeMarks } = normalizeSubQuestionScoring(sub);
          const [child] = await AiQuestion.create(
            [
              {
                ...baseFields,
                questionText: sub.questionText,
                questionType: sub.questionType,
                options: sub.options,
                correctAnswer: sub.correctAnswer,
                explanation: sub.explanation,
                marks,
                negativeMarks,
                orderInBank: i + (si + 1) * 0.001,
                parentQuestionId: parent._id,
              },
            ],
            { session }
          );
          childIds.push(child._id);
          createdQuestions.push(child);
        }

        parent.childQuestions = childIds;
        await parent.save({ session });
        createdQuestions.push(parent);
        continue;
      }

      const [doc] = await AiQuestion.create(
        [
          {
            ...baseFields,
            questionText: q.questionText,
            questionType: q.questionType || "single",
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            marks: q.marks ?? 1,
            negativeMarks: questionNegativeMarks,
            imageUrl: q.imageUrl || null,
          },
        ],
        { session }
      );
      createdQuestions.push(doc);
    }

    await session.commitTransaction();

    // Best-effort confirmed-questions .txt log — never blocks/reverts the save.
    try {
      await logSavedBankQuestions({
        topic: String(data.generationTopic || bankName || "").trim(),
        bankName,
        useSectionWise,
        sections,
        questions: questionsInput,
      });
    } catch (logErr) {
      console.error(
        "[confirmed-questions] failed to log saved bank:",
        logErr?.message
      );
    }

    const populatedBank = await aiQuestionBankRepository.findById(bank._id);
    return {
      bank: populatedBank,
      questions: createdQuestions,
    };
  } catch (error) {
    await session.abortTransaction();
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      500,
      "Failed to create AI question bank with questions",
      error.message
    );
  } finally {
    session.endSession();
  }
};

export const getAiQuestionBanks = async (options = {}) => {
  return aiQuestionBankRepository.findAll({}, options);
};

export const getAiQuestionBankById = async (id) => {
  const bank = await aiQuestionBankRepository.findById(id);
  if (!bank) throw new ApiError(404, "AI question bank not found");
  return bank;
};

export const getAiQuestionsByBankId = async (bankId, options = {}) => {
  const bank = await aiQuestionBankRepository.findById(bankId, false);
  if (!bank) throw new ApiError(404, "AI question bank not found");
  return aiQuestionBankRepository.getQuestionsByBankId(bankId, options);
};

export const deleteAiQuestionBank = async (id) => {
  const bank = await aiQuestionBankRepository.findById(id, false);
  if (!bank) throw new ApiError(404, "AI question bank not found");
  await assertAiBankNotInUse(id, "delete");
  await aiQuestionBankRepository.deleteQuestionsByBankId(id);
  return aiQuestionBankRepository.deleteById(id);
};

export const updateAiQuestion = async (id, updateData) => {
  const existingQuestion = await AiQuestion.findById(id).populate(
    "childQuestions"
  );
  if (!existingQuestion) {
    throw new ApiError(404, "AI question not found");
  }
  if (existingQuestion.parentQuestionId && !existingQuestion.isParent) {
    throw new ApiError(
      400,
      "Edit connected sub-questions via the parent passage question"
    );
  }

  await assertAiBankNotInUse(existingQuestion.aiQuestionBank, "edit");

  if (updateData.options && updateData.questionType !== "connected") {
    validateQuestionOptions(
      updateData.questionType || existingQuestion.questionType,
      updateData.options
    );
  }

  const effectiveType =
    updateData.questionType || existingQuestion.questionType;
  const hasSubQuestionsUpdate =
    Array.isArray(updateData.subQuestions) ||
    Array.isArray(updateData.connectedQuestions);
  const isConnectedEdit =
    effectiveType === "connected" || hasSubQuestionsUpdate;

  if (isConnectedEdit) {
    if (
      existingQuestion.questionType !== "connected" ||
      !existingQuestion.isParent
    ) {
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
          (updateData.questionText &&
            String(updateData.questionText).trim()) ||
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
      ["difficulty", "imageUrl"].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          partialParentUpdate[key] = updateData[key];
        }
      });

      const updatedParent = await AiQuestion.findByIdAndUpdate(
        id,
        partialParentUpdate,
        { new: true }
      ).populate("childQuestions");

      return updatedParent;
    }

    const subs =
      updateData.subQuestions ?? updateData.connectedQuestions ?? [];
    validateConnectedQuestions(subs);
    const connectedTotals = getConnectedTotals(subs);

    const passageText =
      (updateData.paragraph && String(updateData.paragraph).trim()) ||
      (updateData.passage && String(updateData.passage).trim()) ||
      (updateData.questionText && String(updateData.questionText).trim()) ||
      (existingQuestion.passage && String(existingQuestion.passage).trim()) ||
      "";
    if (!passageText) {
      throw new ApiError(
        400,
        "Connected question passage/paragraph is required"
      );
    }

    const parentLabel =
      (updateData.title && String(updateData.title).trim()) ||
      (updateData.questionText && String(updateData.questionText).trim()) ||
      (existingQuestion.questionText &&
        String(existingQuestion.questionText).trim()) ||
      passageText.slice(0, 200);

    const parentUpdate = {
      questionText: parentLabel,
      passage: passageText,
      difficulty: updateData.difficulty ?? existingQuestion.difficulty,
    };
    if (Object.prototype.hasOwnProperty.call(updateData, "imageUrl")) {
      parentUpdate.imageUrl = updateData.imageUrl;
    }

    const existingChildIds = (existingQuestion.childQuestions || []).map(
      (child) => child?._id?.toString?.() || child?.toString?.()
    );
    if (existingChildIds.length) {
      await AiQuestion.deleteMany({ _id: { $in: existingChildIds } });
    }

    const newChildIds = [];
    for (const sub of subs) {
      const { marks, negativeMarks } = normalizeSubQuestionScoring(sub);
      const child = await AiQuestion.create({
        questionText: sub.questionText,
        questionType: sub.questionType,
        options: sub.options,
        correctAnswer: sub.correctAnswer,
        explanation: sub.explanation,
        difficulty: parentUpdate.difficulty,
        marks,
        negativeMarks,
        aiQuestionBank: existingQuestion.aiQuestionBank,
        sectionIndex: existingQuestion.sectionIndex,
        orderInBank: existingQuestion.orderInBank,
        createdBy: existingQuestion.createdBy,
        parentQuestionId: existingQuestion._id,
      });
      newChildIds.push(child._id);
    }

    const updatedParent = await AiQuestion.findByIdAndUpdate(
      id,
      {
        ...parentUpdate,
        marks: connectedTotals.marks,
        negativeMarks: connectedTotals.negativeMarks,
        childQuestions: newChildIds,
        connectedQuestions: [],
        options: [],
        correctAnswer: undefined,
        isParent: true,
      },
      { new: true }
    ).populate(
      "childQuestions",
      "questionText questionType options correctAnswer explanation marks negativeMarks imageUrl"
    );

    return updatedParent;
  }

  const updatedQuestion = await AiQuestion.findByIdAndUpdate(id, updateData, {
    new: true,
  });
  return updatedQuestion;
};

export default {
  createAiQuestionBankWithQuestions,
  getAiQuestionBanks,
  getAiQuestionBankById,
  getAiQuestionsByBankId,
  deleteAiQuestionBank,
  updateAiQuestion,
};
