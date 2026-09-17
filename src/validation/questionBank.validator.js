import Joi from "joi";

const optionSchema = Joi.object({
  text: Joi.string().allow(null, "").optional(),
  imageUrl: Joi.alternatives().try(
    Joi.string().trim().uri().allow(null, ""),
    Joi.array().items(Joi.string().trim().uri().allow(null, ""))
  ).optional(),
  isCorrect: Joi.boolean().default(false),
}).custom((value, helpers) => {
  const hasText = value.text && value.text.trim().length > 0;
  const imgVal = value.imageUrl;
  const hasImage = imgVal && (
    (typeof imgVal === 'string' && imgVal.trim().length > 0) ||
    (Array.isArray(imgVal) && imgVal.length > 0)
  );

  if (hasText && hasImage) {
    return helpers.message("An option must contain EITHER text OR an image, but not both.");
  }
  if (!hasText && !hasImage) {
    return helpers.message("An option must contain EITHER text OR an image. Both cannot be empty.");
  }
  return value;
});

const connectedSubQuestionSchema = Joi.object({
  questionText: Joi.string().required().trim(),
  questionType: Joi.string().valid("single", "multiple", "true_false").required(),
  options: Joi.when("questionType", {
    is: Joi.string().valid("single", "multiple"),
    then: Joi.array().items(optionSchema).min(2).required(),
    otherwise: Joi.array().items(optionSchema).length(2).optional(),
  }),
  correctAnswer: Joi.when("questionType", {
    is: "single",
    then: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    otherwise: Joi.when("questionType", {
      is: "multiple",
      then: Joi.array()
        .items(Joi.alternatives().try(Joi.string(), Joi.number()))
        .min(1)
        .required(),
      otherwise: Joi.boolean().required(),
    }),
  }),
  explanation: Joi.string().trim().required(),
  marks: Joi.number().min(0).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  imageUrl: Joi.array().items(Joi.string().trim().uri().allow(null, "")).optional(),
});

const sectionSchema = Joi.object({
  count: Joi.number().min(1).required(),
  difficulty: Joi.string()
    .valid("easy", "medium", "hard")
    .required()
    .lowercase(),
  id: Joi.number().optional(),
  name: Joi.string().trim().optional(),
  timeMinutes: Joi.number().min(0).optional().default(0),
  questions: Joi.array().items(Joi.string()).optional(),
});

const questionItemSchema = Joi.object({
  questionText: Joi.string().when("questionType", {
    is: "connected",
    then: Joi.string().trim().allow("").optional(),
    otherwise: Joi.string().required().trim(),
  }),
  questionType: Joi.string()
    .valid("single", "multiple", "true_false", "connected", "integer")
    .default("single"),
  /** Long reading text for `connected` (required unless legacy `passage` is sent). */
  paragraph: Joi.string().trim().allow("").optional(),
  /** Short label for lists / navigation (connected only). */
  title: Joi.string().trim().allow("").optional(),
  imageUrl: Joi.array().items(Joi.string().trim().uri().allow(null, "")).optional(),
  options: Joi.when("questionType", {
    switch: [
      {
        is: Joi.string().valid("single", "multiple"),
        then: Joi.array().items(optionSchema).min(2).required(),
      },
      {
        is: "true_false",
        then: Joi.array().items(optionSchema).length(2).optional(),
      },
      {
        is: "integer",
        then: Joi.array().items(optionSchema).optional(),
      },
    ],
    otherwise: Joi.optional(),
  }),
  correctAnswer: Joi.when("questionType", {
    switch: [
      {
        is: "single",
        then: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      },
      {
        is: "integer",
        then: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      },
      {
        is: "multiple",
        then: Joi.array()
          .items(Joi.alternatives().try(Joi.string(), Joi.number()))
          .min(1)
          .required(),
      },
      {
        is: "true_false",
        then: Joi.boolean().required(),
      },
    ],
    otherwise: Joi.optional().allow(null),
  }),
  explanation: Joi.string().when("questionType", {
    is: "connected",
    then: Joi.string().trim().allow("").optional(),
    otherwise: Joi.string().trim().required(),
  }),
  subject: Joi.string().trim().optional(),
  topic: Joi.string().trim().optional(),
  difficulty: Joi.string()
    .valid("easy", "medium", "hard")
    .optional()
    .lowercase(),
  marks: Joi.number().min(0).default(1),
  negativeMarks: Joi.number().min(0).default(0),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  /** Legacy: same role as `paragraph` for connected. */
  passage: Joi.string().trim().optional().allow("", null),
  /** Preferred: sub-questions for the paragraph (single | multiple | true_false each). */
  subQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
  /** Legacy alias of `subQuestions`. */
  connectedQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
}).custom((value, helpers) => {
  if (value.questionType !== "connected") return value;

  const reading =
    (value.paragraph && String(value.paragraph).trim()) ||
    (value.passage && String(value.passage).trim()) ||
    "";
  if (!reading) {
    return helpers.message(
      'For questionType "connected", send paragraph (long reading text) or legacy passage.'
    );
  }

  const subs = value.subQuestions ?? value.connectedQuestions;
  if (!Array.isArray(subs) || subs.length < 1) {
    return helpers.message(
      'For questionType "connected", send subQuestions (or legacy connectedQuestions). Each item needs questionText and questionType: single, multiple, or true_false.'
    );
  }

  return value;
});

const createQuestionBank = Joi.object({
  name: Joi.string().required().trim(),
  categories: Joi.array().items(Joi.string()).min(1).required(),
  useSectionWiseDifficulty: Joi.boolean().default(false),
  useSectionWiseQuestions: Joi.boolean().default(false),
  overallDifficulty: Joi.string()
    .valid("easy", "medium", "hard")
    .default("medium"),
  sections: Joi.array()
    .items(sectionSchema)
    .when("useSectionWiseDifficulty", {
      is: true,
      then: Joi.array().items(sectionSchema).min(1).required(),
    })
    .when("useSectionWiseQuestions", {
      is: true,
      then: Joi.array().items(sectionSchema).min(1).required(),
    })
    .optional(),
});

const createQuestionBankWithQuestions = Joi.object({
  name: Joi.string().required().trim(),
  categories: Joi.array().items(Joi.string()).min(1).required(),
  useSectionWiseDifficulty: Joi.boolean().default(false),
  useSectionWiseQuestions: Joi.boolean().default(false),
  overallDifficulty: Joi.string()
    .valid("easy", "medium", "hard")
    .default("medium"),
  sections: Joi.array()
    .items(sectionSchema)
    .when("useSectionWiseDifficulty", {
      is: true,
      then: Joi.array().items(sectionSchema).min(1).required(),
    })
    .when("useSectionWiseQuestions", {
      is: true,
      then: Joi.array().items(sectionSchema).min(1).required(),
    })
    .optional(),
  questions: Joi.array().items(questionItemSchema).min(1).required(),
});

const updateQuestionBank = Joi.object({
  name: Joi.string().trim().optional(),
  categories: Joi.array().items(Joi.string()).min(1).optional(),
  useSectionWiseDifficulty: Joi.boolean().optional(),
  useSectionWiseQuestions: Joi.boolean().optional(),
  overallDifficulty: Joi.string().valid("easy", "medium", "hard").optional(),
  sections: Joi.array().items(sectionSchema).optional(),
});

const toggleSectionWiseQuestions = Joi.object({
  useSectionWiseQuestions: Joi.boolean().required(),
});

export default {
  createQuestionBank,
  createQuestionBankWithQuestions,
  updateQuestionBank,
  toggleSectionWiseQuestions,
};
