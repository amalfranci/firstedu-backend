import { ApiError } from "../utils/ApiError.js";
import questionBankRepository from "../repository/questionBank.repository.js";
import questionRepository from "../repository/question.repository.js";
import categoryRepository from "../repository/category.repository.js";
import { assertBankNotInUse } from "../utils/bankUsageGuard.js";
import { normalizeCategoryIds } from "../utils/normalizeCategoryIds.js";


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

const toQuestionPlain = (doc) => {
  if (!doc) return null;
  return doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
};

/**
 * Passage-style blocks for admin UI: one reading + sub-questions (single / multiple / true_false).
 */
const buildPassageQuestionSets = (flatDocs) => {
  if (!Array.isArray(flatDocs) || flatDocs.length === 0) return [];
  const byId = new Map(
    flatDocs.map((d) => {
      const p = toQuestionPlain(d);
      return [p._id.toString(), p];
    })
  );
  return flatDocs
    .map((d) => toQuestionPlain(d))
    .filter((q) => q.isParent && q.questionType === "connected")
    .map((parent) => {
      const refs = parent.childQuestions || [];
      const subQuestions = refs
        .map((ref) => {
          const id = ref?._id?.toString?.() || ref?.toString?.();
          if (!id) return null;
          const fromPopulate = ref && typeof ref === "object" && ref.questionText != null
            ? toQuestionPlain(ref)
            : null;
          return fromPopulate || byId.get(id) || null;
        })
        .filter(Boolean);
      return {
        paragraph: parent.passage || parent.questionText,
        passage: parent.passage || parent.questionText,
        title: parent.questionText,
        parentQuestionId: parent._id,
        imageUrl: parent.imageUrl || null,
        subQuestions,
      };
    });
};

const buildQuestionBankQuestionsResponse = (flatDocs) => {
  if (!Array.isArray(flatDocs) || flatDocs.length === 0) return [];

  const byId = new Map(
    flatDocs.map((doc) => {
      const plain = toQuestionPlain(doc);
      return [plain._id.toString(), plain];
    })
  );

  return flatDocs
    .map((doc) => toQuestionPlain(doc))
    .filter((q) => !q.parentQuestionId)
    .map((q) => {
      if (!(q.isParent && q.questionType === "connected")) {
        return q;
      }

      const refs = q.childQuestions || [];
      const subQuestions = refs
        .map((ref) => {
          const id = ref?._id?.toString?.() || ref?.toString?.();
          if (!id) return null;
          const fromPopulate =
            ref && typeof ref === "object" && ref.questionText != null
              ? toQuestionPlain(ref)
              : null;
          return fromPopulate || byId.get(id) || null;
        })
        .filter(Boolean)
        .map((child) => ({
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
        }));

      return {
        ...q,
        title: q.questionText || "",
        paragraph: q.passage || "",
        subQuestions,
      };
    });
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

const getSectionIndexByCount = (sectionConfigs = [], questionIndex = 0) => {
  let cursor = 0;
  for (let i = 0; i < sectionConfigs.length; i++) {
    const count = Number(sectionConfigs[i]?.count || 0);
    if (questionIndex < cursor + count) return i;
    cursor += count;
  }
  return undefined;
};

/**
 * Appends totalTimeMinutes to a question bank plain object.
 * Only added when useSectionWiseDifficulty === true.
 */
const appendTotalTime = (bank) => {
  if (!bank) return bank;
  const plain = bank.toObject ? bank.toObject({ virtuals: true }) : { ...bank };
  if (plain.useSectionWiseDifficulty === true && Array.isArray(plain.sections)) {
    plain.totalTimeMinutes = plain.sections.reduce(
      (sum, s) => sum + (Number(s.timeMinutes) || 0),
      0
    );
  }
  return plain;
};

export const createQuestionBank = async (data, createdBy) => {
  const categoryIds = normalizeCategoryIds(data.categories || []);
  for (const catId of categoryIds) {
    const cat = await categoryRepository.findById(catId);
    if (!cat) throw new ApiError(404, `Category not found: ${catId}`);
  }
  const payload = {
    name: data.name,
    categories: categoryIds,
    useSectionWiseDifficulty: data.useSectionWiseDifficulty ?? false,
    overallDifficulty: data.overallDifficulty || "medium",
    sections: (data.sections || []).map((section) => ({
      ...section,
      questions: Array.isArray(section.questions) ? section.questions : [],
    })),
    useSectionWiseQuestions: data.useSectionWiseQuestions ?? false,
    createdBy,
  };
  return await questionBankRepository.create(payload);
};

export const createQuestionBankWithQuestions = async (data, createdBy) => {
  const categoryIds = normalizeCategoryIds(data.categories || []);
  for (const catId of categoryIds) {
    const cat = await categoryRepository.findById(catId);
    if (!cat) throw new ApiError(404, `Category not found: ${catId}`);
  }

  const useSectionWise = data.useSectionWiseDifficulty ?? false;
  const sections = data.sections || [];
  const useSectionWiseQuestions = data.useSectionWiseQuestions ?? false;
  const questionsInput = data.questions || [];
  const overallDifficulty = data.overallDifficulty || "medium";

  let expectedCount = 0;
  if ((useSectionWise || useSectionWiseQuestions) && sections.length) {
    expectedCount = sections.reduce((sum, s) => sum + s.count, 0);
  } else {
    expectedCount = questionsInput.length;
  }
  if (questionsInput.length !== expectedCount) {
    throw new ApiError(
      400,
      `Number of questions (${questionsInput.length}) must match total count (${expectedCount})`
    );
  }

  if (useSectionWiseQuestions && sections.length === 0) {
    throw new ApiError(
      400,
      "sections must be configured when section-wise questions is enabled"
    );
  }

  const bankPayload = {
    name: data.name,
    categories: categoryIds,
    useSectionWiseDifficulty: useSectionWise,
    overallDifficulty,
    sections: sections.map((section) => ({ ...section, questions: [] })),
    useSectionWiseQuestions,
    createdBy,
  };
  const bank = await questionBankRepository.create(bankPayload);

  let questionIndex = 0;
  const buildDifficultyAndSection = () => {
    if (useSectionWise && sections.length) {
      let idx = 0;
      for (let s = 0; s < sections.length; s++) {
        for (let c = 0; c < sections[s].count; c++) {
          if (idx === questionIndex) {
            return {
              difficulty: sections[s].difficulty,
              sectionIndex: s,
              orderInBank: questionIndex,
            };
          }
          idx++;
        }
      }
    }
    return {
      difficulty: overallDifficulty,
      sectionIndex: undefined,
      orderInBank: questionIndex,
    };
  };

  const createdQuestions = [];
  const sectionsWithIds = (sections || []).map((section) => ({
    ...section,
    questions: [],
  }));
  for (let i = 0; i < questionsInput.length; i++) {
    questionIndex = i;
    const q = questionsInput[i];
    validateQuestionOptions(q.questionType, q.options);
    const {
      difficulty,
      sectionIndex: sectionIndexByDifficulty,
      orderInBank,
    } = buildDifficultyAndSection();
    const sectionIndexByQuestionMode = useSectionWiseQuestions
      ? getSectionIndexByCount(sections, questionIndex)
      : undefined;
    const sectionIndex =
      sectionIndexByQuestionMode !== undefined
        ? sectionIndexByQuestionMode
        : sectionIndexByDifficulty;
    const questionData = {
      questionText: q.questionText,
      questionType: q.questionType || "single",
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      topic: q.topic,
      difficulty,
      marks: q.marks ?? 1,
      negativeMarks: q.negativeMarks ?? 0,
      tags: q.tags,
      imageUrl: q.imageUrl || null,
      subject: q.subject || undefined,
      questionBank: bank._id,
      sectionIndex,
      orderInBank,
      createdBy,
    };
    if (questionData.questionType === "connected") {
      const subs = q.subQuestions ?? q.connectedQuestions ?? [];
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
      const parent = await questionRepository.create({
        ...questionData,
        questionText: parentLabel,
        isParent: true,
        passage: passageText,
        marks: connectedTotals.marks,
        negativeMarks: connectedTotals.negativeMarks,
        correctAnswer: undefined,
        options: [],
        connectedQuestions: [],
      });

      const childIds = [];
      const childrenCreated = [];
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
          questionBank: bank._id,
          sectionIndex,
          orderInBank: orderInBank + childIds.length + 1,
          createdBy,
          parentQuestionId: parent._id,
        });
        childIds.push(child._id);
        childrenCreated.push(child);
      }

      const updatedParent = await questionRepository.updateById(parent._id, {
        childQuestions: childIds,
      });
      createdQuestions.push(updatedParent, ...childrenCreated);
      if (
        useSectionWiseQuestions &&
        sectionIndex !== undefined &&
        sectionsWithIds[sectionIndex]
      ) {
        sectionsWithIds[sectionIndex].questions.push(parent._id, ...childIds);
      }
      continue;
    }

    const created = await questionRepository.create(questionData);
    createdQuestions.push(created);

    if (
      useSectionWiseQuestions &&
      sectionIndex !== undefined &&
      sectionsWithIds[sectionIndex]
    ) {
      sectionsWithIds[sectionIndex].questions.push(created._id);
    }
  }

  if (useSectionWiseQuestions) {
    await questionBankRepository.updateById(bank._id, {
      sections: sectionsWithIds,
    });
  }

  const bankWithPopulate = await questionBankRepository.findById(bank._id);
  return {
    questionBank: appendTotalTime(bankWithPopulate),
    questions: createdQuestions,
    passageQuestionSets: buildPassageQuestionSets(createdQuestions),
  };
};

export const getQuestionBanks = async (options = {}) => {
  const result = await questionBankRepository.findAll({}, options);
  return {
    ...result,
    items: result.items.map(appendTotalTime),
  };
};

export const getQuestionBankById = async (id) => {
  const bank = await questionBankRepository.findById(id);
  if (!bank) throw new ApiError(404, "Question bank not found");
  return appendTotalTime(bank);
};

export const getQuestionsByBankId = async (bankId) => {
  const bank = await questionBankRepository.findById(bankId);
  if (!bank) throw new ApiError(404, "Question bank not found");
  const flatQuestions = await questionBankRepository.getQuestionsByBankId(bankId);
  return buildQuestionBankQuestionsResponse(flatQuestions);
};

export const updateQuestionBank = async (id, updateData) => {
  const existing = await questionBankRepository.findById(id);
  if (!existing) throw new ApiError(404, "Question bank not found");

  // Block edit if the bank is currently used in any test
  await assertBankNotInUse(id, "edit");

  if (updateData.categories && updateData.categories.length > 0) {
    updateData.categories = normalizeCategoryIds(updateData.categories);
    for (const catId of updateData.categories) {
      const cat = await categoryRepository.findById(catId);
      if (!cat) throw new ApiError(404, `Category not found: ${catId}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(updateData, "sections")) {
    updateData.sections = (updateData.sections || []).map(
      (section, index) => ({
        ...(existing.sections?.[index]?.toObject?.() ||
          existing.sections?.[index] ||
          {}),
        ...section,
        questions: Array.isArray(section.questions)
          ? section.questions
          : existing.sections?.[index]?.questions || [],
      })
    );
  }

  if (updateData.useSectionWiseQuestions === true) {
    const effectiveSections = updateData.sections ?? existing.sections ?? [];
    if (!Array.isArray(effectiveSections) || effectiveSections.length === 0) {
      throw new ApiError(
        400,
        "sections must be configured before enabling section-wise questions"
      );
    }
  }

  return await questionBankRepository.updateById(id, updateData);
};

export const toggleSectionWiseQuestions = async (id, useSectionWiseQuestions) => {
  const existing = await questionBankRepository.findById(id, false);
  if (!existing) throw new ApiError(404, "Question bank not found");

  // Block toggle if the bank is currently used in any test
  await assertBankNotInUse(id, "edit");

  if (useSectionWiseQuestions === true) {
    const hasSections =
      Array.isArray(existing.sections) && existing.sections.length > 0;
    if (!hasSections) {
      throw new ApiError(
        400,
        "Cannot enable section-wise questions without sections configuration"
      );
    }
  }

  return await questionBankRepository.updateById(id, { useSectionWiseQuestions });
};

export const deleteQuestionBank = async (id) => {
  const existing = await questionBankRepository.findById(id);
  if (!existing) throw new ApiError(404, "Question bank not found");

  // Block delete if the bank is currently used in any test (lists all test names)
  await assertBankNotInUse(id, "delete");

  await questionBankRepository.deleteQuestionsByBankId(id);
  return await questionBankRepository.deleteById(id);
};

export default {
  createQuestionBank,
  createQuestionBankWithQuestions,
  getQuestionBanks,
  getQuestionBankById,
  getQuestionsByBankId,
  updateQuestionBank,
  toggleSectionWiseQuestions,
  deleteQuestionBank,
};
