import Joi from "joi";

const optionSchema = Joi.object({
  text: Joi.string().allow(null, "").optional(),
  imageUrl: Joi.string().trim().uri().allow(null, "").optional(),
  isCorrect: Joi.boolean().default(false),
}).custom((value, helpers) => {
  const hasText = value.text && value.text.trim().length > 0;
  const hasImage = value.imageUrl && value.imageUrl.length > 0;

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
      then: Joi.array().items(Joi.alternatives().try(Joi.string(), Joi.number())).min(1).required(),
      otherwise: Joi.boolean().required(),
    }),
  }),
  explanation: Joi.string().trim().required(),
  marks: Joi.number().min(0).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  imageUrl: Joi.array().items(Joi.string().trim().uri().allow(null, "")).optional(),
});

const createQuestion = Joi.object({
  questionText: Joi.string().when("questionType", {
    is: "connected",
    then: Joi.string().trim().allow("").optional(),
    otherwise: Joi.string().required().trim(),
  }),
  questionType: Joi.string()
    .valid("single", "multiple", "true_false", "connected", "integer")
    .default("single"),
  paragraph: Joi.string().trim().allow("").optional(),
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
  questionBank: Joi.string().optional(),
  sectionIndex: Joi.number().min(0).optional(),
  orderInBank: Joi.number().min(0).optional(),
  topic: Joi.string().trim().optional(),
  difficulty: Joi.string().valid("easy", "medium", "hard").default("medium"),
  marks: Joi.number().min(0).default(1),
  negativeMarks: Joi.number().min(0).default(0),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  isParent: Joi.boolean().default(false),
  parentQuestionId: Joi.string().optional().allow(null),
  passage: Joi.string().trim().optional().allow(null, ""),
  subQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
  connectedQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
}).custom((value, helpers) => {
  if (value.questionType !== "connected") return value;

  const reading =
    (value.paragraph && String(value.paragraph).trim()) ||
    (value.passage && String(value.passage).trim()) ||
    "";
  if (!reading) {
    return helpers.message(
      'For questionType "connected", send paragraph or passage (reading text).'
    );
  }

  const subs = value.subQuestions ?? value.connectedQuestions;
  if (!Array.isArray(subs) || subs.length < 1) {
    return helpers.message(
      'For questionType "connected", send subQuestions or connectedQuestions (each: questionText and questionType single, multiple, or true_false).'
    );
  }

  return value;
});

const updateQuestion = Joi.object({
  questionText: Joi.string().trim().optional(),
  questionType: Joi.string()
    .valid("single", "multiple", "true_false", "connected", "integer")
    .optional(),
  imageUrl: Joi.array().items(Joi.string().trim().uri().allow(null, "")).optional(),
  options: Joi.array().items(optionSchema).optional(),
  correctAnswer: Joi.alternatives()
    .try(Joi.string(), Joi.number(), Joi.boolean(), Joi.array())
    .optional(),
  explanation: Joi.string().trim().optional(),
  subject: Joi.string().trim().optional(),
  questionBank: Joi.string().optional().allow(null),
  sectionIndex: Joi.number().min(0).optional(),
  orderInBank: Joi.number().min(0).optional(),
  topic: Joi.string().trim().optional(),
  difficulty: Joi.string().valid("easy", "medium", "hard").optional(),
  marks: Joi.number().min(0).optional(),
  negativeMarks: Joi.number().min(0).optional(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  isParent: Joi.boolean().optional(),
  parentQuestionId: Joi.string().optional().allow(null),
  passage: Joi.string().trim().optional().allow(null, ""),
  paragraph: Joi.string().trim().optional().allow(null, ""),
  title: Joi.string().trim().optional().allow(null, ""),
  subQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
  connectedQuestions: Joi.array().items(connectedSubQuestionSchema).optional(),
  isActive: Joi.boolean().optional(),
});

const addChildQuestion = Joi.object({
  childQuestionId: Joi.string().required(),
});

const calculateAnalytics = Joi.object({
  upperGroupCorrect: Joi.number().min(0).required(),
  lowerGroupCorrect: Joi.number().min(0).required(),
  upperGroupTotal: Joi.number().min(0).required(),
  lowerGroupTotal: Joi.number().min(0).required(),
});

export default {
  createQuestion,
  updateQuestion,
  addChildQuestion,
  calculateAnalytics,
};

