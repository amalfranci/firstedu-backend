import Joi from "joi";

const optionSchema = Joi.object({
  text: Joi.string().required(),
  isCorrect: Joi.boolean().default(false),
});

const connectedSubQuestionSchema = Joi.object({
  questionText: Joi.string().required().trim(),
  questionType: Joi.string()
    .valid("single", "multiple", "true_false")
    .required(),
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
});

const aiQuestionItemSchema = Joi.object({
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
  aiBatchNumber: Joi.number().integer().min(1).optional().allow(null),
  sectionIndex: Joi.number().integer().min(0).optional().allow(null),
  imageUrl: Joi.string().trim().uri().optional().allow("", null),
  passage: Joi.string().trim().optional().allow("", null),
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
      'For questionType "connected", paragraph or passage is required.'
    );
  }

  const subs = value.subQuestions ?? value.connectedQuestions;
  if (!Array.isArray(subs) || subs.length < 1) {
    return helpers.message(
      "For questionType connected, at least one sub-question is required."
    );
  }

  return value;
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
  negativeMarks: Joi.number().min(0).optional().default(1),
  contentType: Joi.string().valid("text", "image").optional().default("text"),
});

const createAiQuestionBankWithQuestions = Joi.object({
  name: Joi.string().required().trim(),
  generationId: Joi.string().trim().optional(),
  categories: Joi.array().items(Joi.string()).min(1).required(),
  overallDifficulty: Joi.string()
    .valid("easy", "medium", "hard")
    .default("medium"),
  generationTopic: Joi.string().trim().allow("", null).optional(),
  aiProvider: Joi.string().trim().default("gemini"),
  useSectionWise: Joi.boolean().default(false),
  negativeMarks: Joi.number().min(0).optional().default(1),
  sections: Joi.array()
    .items(sectionSchema)
    .when("useSectionWise", {
      is: true,
      then: Joi.array().items(sectionSchema).min(1).required(),
    })
    .optional(),
  questions: Joi.array().items(aiQuestionItemSchema).min(1).required(),
});

const updateAiQuestion = aiQuestionItemSchema
  .fork(
    [
      "questionText",
      "questionType",
      "paragraph",
      "title",
      "options",
      "correctAnswer",
      "explanation",
      "subject",
      "topic",
      "difficulty",
      "marks",
      "negativeMarks",
      "tags",
      "passage",
      "subQuestions",
      "connectedQuestions",
    ],
    (schema) => schema.optional()
  )
  .min(1);

export default {
  createAiQuestionBankWithQuestions,
  updateAiQuestion,
};
