import Joi from 'joi';
import { GEMINI_IMAGE_MODEL_IDS } from '../services/geminiImageModels.js';
import { IMAGE_QUESTION_ARCHETYPE_IDS } from '../services/imageQuestionArchetypes.js';
import {
    GENERATE_INTENTS,
    validateGenerationWorkflow,
    validateTopicRelevanceEvaluationWorkflow,
} from '../services/topicRelevanceValidation.service.js';
import { GENERATION_MODES } from '../services/examPromptFirst.service.js';

// Validation schema for generating questions
export const generateQuestionsSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(200).messages({
        'string.empty': 'Topic is required',
        'string.min': 'Topic must be at least 2 characters long',
        'string.max': 'Topic must not exceed 200 characters',
        'any.required': 'Topic is required'
    }),

    subject: Joi.string().required().trim().min(2).max(100).messages({
        'string.empty': 'Subject is required',
        'string.min': 'Subject must be at least 2 characters long',
        'string.max': 'Subject must not exceed 100 characters',
        'any.required': 'Subject is required'
    }),

    classLevel: Joi.string().required().trim().min(2).max(100).messages({
        'string.empty': 'Class level is required',
        'string.min': 'Class level must be at least 2 characters long',
        'string.max': 'Class level must not exceed 100 characters',
        'any.required': 'Class level is required'
    }),

    difficulty: Joi.string()
        .valid('easy', 'medium', 'hard')
        .required()
        .messages({
            'any.only': 'Difficulty must be one of: easy, medium, hard',
            'any.required': 'Difficulty is required'
        }),

    numberOfQuestions: Joi.number()
        .integer()
        .min(1)
        .max(20)
        .required()
        .messages({
            'number.base': 'Number of questions must be a number',
            'number.min': 'Must generate at least 1 question',
            'number.max': 'Cannot generate more than 20 questions at once',
            'any.required': 'Number of questions is required'
        })
});

// Validation schema for saving generated questions
export const saveGeneratedQuestionsSchema = Joi.object({
    questions: Joi.array()
        .items(
            Joi.object({
                topic: Joi.string().required().trim(),
                subject: Joi.string().required().trim(),
                classLevel: Joi.string().required().trim(),
                difficulty: Joi.string().valid('easy', 'medium', 'hard').required(),
                questionText: Joi.string().required().trim().min(5),
                optionA: Joi.string().required().trim(),
                optionB: Joi.string().required().trim(),
                optionC: Joi.string().required().trim(),
                optionD: Joi.string().required().trim(),
                answer: Joi.string().valid('A', 'B', 'C', 'D').required(),
                explanation: Joi.string().optional().trim().allow(''),
                subjectRef: Joi.string().optional().allow(null),
                questionBank: Joi.string().optional().allow(null),
                marks: Joi.number().optional().default(1),
                negativeMarks: Joi.number().optional().default(0)
            })
        )
        .min(1)
        .max(50)
        .required()
        .messages({
            'array.min': 'At least 1 question is required',
            'array.max': 'Cannot save more than 50 questions at once',
            'any.required': 'Questions array is required'
        }),

    questionBankId: Joi.string().optional().allow(null, '')
});

// Question bank AI suggestions (single / multiple / true_false counts)
const TOPIC_RELEVANCE_ISSUE_CATEGORIES = [
    "factual",
    "style",
    "diversity",
    "authenticity",
    "difficulty",
    "correctness",
];

const topicRelevanceIssueSchema = Joi.object({
    questionNumber: Joi.number().integer().min(1).optional().allow(null),
    sampleNumber: Joi.number().integer().min(1).optional().allow(null),
    issue: Joi.string().trim().max(500).required(),
    severity: Joi.string()
        .valid("critical", "major", "minor", "suspected")
        .optional(),
    confidence: Joi.string().trim().max(20).optional(),
    category: Joi.string()
        .valid(...TOPIC_RELEVANCE_ISSUE_CATEGORIES)
        .optional(),
}).unknown(true);

const optionalRelevanceScore = Joi.number().min(0).max(100).optional().allow(null);

/** Confirmed concept-slot steering echoed back from /ai/plan-question-topics. */
const presetSteeringSchema = Joi.object({
    conceptSlots: Joi.array().items(Joi.string().trim().max(120)).max(200).optional(),
    slotPlans: Joi.array()
        .items(
            Joi.object({
                conceptSlot: Joi.string().trim().max(120).optional(),
                label: Joi.string().trim().max(200).optional().allow(''),
                blueprint: Joi.object().unknown(true).optional(),
            }).unknown(true)
        )
        .max(200)
        .optional(),
    source: Joi.string().trim().max(40).optional(),
})
    .unknown(true)
    .optional()
    .allow(null);

export const generateQuestionBankSuggestionsSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(300).messages({
        'string.empty': 'Topic is required',
        'any.required': 'Topic is required',
    }),
    bankName: Joi.string().trim().max(200).optional().allow(''),
    difficulty: Joi.string()
        .valid('easy', 'medium', 'hard', 'Easy', 'Medium', 'Hard')
        .required()
        .messages({
            'any.only': 'Difficulty must be easy, medium, or hard',
            'any.required': 'Difficulty is required',
        }),
    singleCount: Joi.number().integer().min(0).max(100).default(0),
    multipleCount: Joi.number().integer().min(0).max(100).default(0),
    trueFalseCount: Joi.number().integer().min(0).max(100).default(0),
    /** @deprecated use passageCount */
    connectedCount: Joi.number().integer().min(0).max(10).default(0),
    passageCount: Joi.number().integer().min(0).max(10).default(0),
    passageSingleCount: Joi.number().integer().min(0).max(30).default(0),
    passageMultipleCount: Joi.number().integer().min(0).max(30).default(0),
    passageTrueFalseCount: Joi.number().integer().min(0).max(30).default(0),
    /** Stems from prior AI batches in this session — do not repeat */
    excludeQuestionTexts: Joi.array()
        .items(Joi.string().trim().min(3).max(500))
        .max(100)
        .default([]),
    sectionName: Joi.string().trim().max(200).optional().allow(""),
    categoryPaths: Joi.array()
        .items(Joi.string().trim().min(1).max(500))
        .max(20)
        .default([]),
    subject: Joi.string().trim().max(100).optional().allow(""),
    topicRelevanceFeedback: Joi.object({
        overallScore: Joi.number().min(0).max(100).required(),
        regenerationInstructions: Joi.string()
            .trim()
            .max(2000)
            .optional()
            .allow(""),
        topicRelevanceScore: optionalRelevanceScore,
        correctnessScore: optionalRelevanceScore,
        styleScore: optionalRelevanceScore,
        authenticityScore: optionalRelevanceScore,
        /** @deprecated legacy fields from older evaluate responses */
        verdict: Joi.string()
            .valid("strong", "moderate", "weak", "off-topic")
            .optional(),
        summary: Joi.string().trim().max(2000).optional().allow(""),
        confirmedIssues: Joi.array()
            .items(topicRelevanceIssueSchema)
            .max(50)
            .optional(),
        correctnessIssues: Joi.array()
            .items(topicRelevanceIssueSchema)
            .max(50)
            .optional(),
        flawedQuestionNumbers: Joi.array()
            .items(Joi.number().integer().min(1))
            .max(50)
            .optional(),
        issuesByDimension: Joi.object().unknown(true).optional(),
        dimensionScores: Joi.object().unknown(true).optional(),
        difficultyMatchScore: optionalRelevanceScore,
        diversityScore: optionalRelevanceScore,
        outliers: Joi.array()
            .items(
                Joi.object({
                    sampleNumber: Joi.number().integer().min(1).required(),
                    reason: Joi.string().trim().max(500).required(),
                })
            )
            .max(5)
            .optional(),
    })
        .unknown(true)
        .optional(),
    generateIntent: Joi.string()
        .valid(GENERATE_INTENTS.INITIAL, GENERATE_INTENTS.EVALUATION_REGEN)
        .default(GENERATE_INTENTS.INITIAL),
    /** default = solve-first / one-shot pipeline; prompt_first = exam-setter prompt then Gemini; paper_reference = topics/difficulty grounded in a stored reference paper; question_rag = style/pattern grounded in retrieved previously-confirmed questions */
    generationMode: Joi.string()
        .valid(
            GENERATION_MODES.DEFAULT,
            GENERATION_MODES.PROMPT_FIRST,
            GENERATION_MODES.PAPER_REFERENCE,
            GENERATION_MODES.QUESTION_RAG
        )
        .default(GENERATION_MODES.DEFAULT),
    topicRelevanceEvaluated: Joi.boolean().default(false),
    topicRelevanceRegenerated: Joi.boolean().default(false),
    hasGeneratedQuestions: Joi.boolean().default(false),
    allowContinuation: Joi.boolean().default(false),
    /** Client workflow id — ties multi-chunk generation + validation into one ai-api-log file */
    workflowLogKey: Joi.string().trim().max(80).optional().allow(''),
    generationProvider: Joi.string().valid('gemini', 'openai', 'claude').default('gemini'),
    /** When true (default), return after generation and validate in background. */
    deferValidation: Joi.boolean().optional(),
    /** Provider used for background validation after deferred generation. */
    backgroundEvaluationProvider: Joi.string()
        .valid('gemini', 'openai')
        .default('openai'),
    /** When deferValidation is on, start background job only on the final client chunk. */
    startBackgroundValidation: Joi.boolean().default(false),
    /** When all type counts are 0, Gemini infers counts from topic/exam (requires maxSelectableSlots). Ignored when counts are provided. */
    inferCountsIfMissing: Joi.boolean().default(false),
    /** Empty bank slots — required for infer mode; when counts are provided, caps selectable total. */
    maxSelectableSlots: Joi.number().integer().min(1).max(500).optional(),
    competitiveExamPlan: Joi.object({
        examProfile: Joi.string().trim().max(50).optional(),
        catSection: Joi.string().trim().max(50).optional().allow(null),
        paperNumber: Joi.number().integer().valid(1, 2).optional().allow(null),
        isFullPaper: Joi.boolean().optional(),
        topicScope: Joi.string().trim().max(500).optional().allow(''),
        singleCount: Joi.number().integer().min(0).max(100).optional(),
        multipleCount: Joi.number().integer().min(0).max(100).optional(),
        trueFalseCount: Joi.number().integer().min(0).max(100).optional(),
        passageCount: Joi.number().integer().min(0).max(10).optional(),
        passageSingleCount: Joi.number().integer().min(0).max(30).optional(),
        passageMultipleCount: Joi.number().integer().min(0).max(30).optional(),
        passageTrueFalseCount: Joi.number().integer().min(0).max(30).optional(),
        subjects: Joi.array()
            .items(
                Joi.object({
                    id: Joi.string().trim().max(50).optional(),
                    label: Joi.string().trim().max(100).optional(),
                    count: Joi.number().integer().min(0).max(100).optional(),
                })
            )
            .max(20)
            .optional(),
        rationale: Joi.string().trim().max(2000).optional().allow(''),
    })
        .unknown(true)
        .optional(),
    /** Confirmed topic plan from /ai/plan-question-topics — hard-locks generation to these topics. */
    presetSteering: presetSteeringSchema,
})
    .custom((value, helpers) => {
        const passageCount =
            (value.passageCount || 0) > 0
                ? value.passageCount
                : value.connectedCount || 0;
        const standaloneTotal =
            (value.singleCount || 0) +
            (value.multipleCount || 0) +
            (value.trueFalseCount || 0);
        const passageQuestionsPerPassage =
            (value.passageSingleCount || 0) +
            (value.passageMultipleCount || 0) +
            (value.passageTrueFalseCount || 0);
        const apiItemTotal = standaloneTotal + passageCount;
        const selectableTotal =
            standaloneTotal + passageCount * passageQuestionsPerPassage;

        const countsMissing = apiItemTotal < 1 && selectableTotal < 1;

        if (!countsMissing) {
            value.inferCountsIfMissing = false;
            if (
                value.maxSelectableSlots &&
                selectableTotal > value.maxSelectableSlots
            ) {
                return helpers.error('any.custom', {
                    message: `Requested ${selectableTotal} selectable question(s), but only ${value.maxSelectableSlots} empty slot(s) remain in the bank`,
                });
            }
        }

        if (countsMissing) {
            if (!value.inferCountsIfMissing) {
                return helpers.error('any.custom', {
                    message:
                        'Request at least one standalone question or reading passage, or set inferCountsIfMissing with maxSelectableSlots',
                });
            }
            if (!value.maxSelectableSlots || value.maxSelectableSlots < 1) {
                return helpers.error('any.custom', {
                    message:
                        'maxSelectableSlots is required when inferring question counts from topic',
                });
            }
        }
        if (apiItemTotal > 100) {
            return helpers.error('any.custom', {
                message: 'Cannot generate more than 100 top-level items per request',
            });
        }
        if (passageQuestionsPerPassage > 0 && passageCount < 1) {
            return helpers.error('any.custom', {
                message:
                    'Set the number of reading passages when requesting passage-based questions',
            });
        }
        if (passageCount > 0 && passageQuestionsPerPassage < 1) {
            return helpers.error('any.custom', {
                message:
                    'Specify at least one passage question type (single, multiple, or true/false)',
            });
        }

        const workflowError = validateGenerationWorkflow({
            generateIntent: value.generateIntent,
            topicRelevanceEvaluated: value.topicRelevanceEvaluated,
            topicRelevanceRegenerated: value.topicRelevanceRegenerated,
            topicRelevanceFeedback: value.topicRelevanceFeedback,
            hasGeneratedQuestions: value.hasGeneratedQuestions,
            allowContinuation: value.allowContinuation,
        });
        if (workflowError) {
            return helpers.error('any.custom', { message: workflowError });
        }

        return { ...value, passageCount };
    })
    .messages({
        'any.custom': '{{#message}}',
    });

export const planQuestionBankTopicsSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(300).messages({
        'string.empty': 'Topic is required',
        'any.required': 'Topic is required',
    }),
    bankName: Joi.string().trim().max(200).optional().allow(''),
    difficulty: Joi.string()
        .valid('easy', 'medium', 'hard', 'Easy', 'Medium', 'Hard')
        .default('medium'),
    singleCount: Joi.number().integer().min(0).max(100).default(0),
    multipleCount: Joi.number().integer().min(0).max(100).default(0),
    trueFalseCount: Joi.number().integer().min(0).max(100).default(0),
    connectedCount: Joi.number().integer().min(0).max(10).default(0),
    passageCount: Joi.number().integer().min(0).max(10).default(0),
    passageSingleCount: Joi.number().integer().min(0).max(30).default(0),
    passageMultipleCount: Joi.number().integer().min(0).max(30).default(0),
    passageTrueFalseCount: Joi.number().integer().min(0).max(30).default(0),
    sectionName: Joi.string().trim().max(200).optional().allow(''),
    categoryPaths: Joi.array()
        .items(Joi.string().trim().min(1).max(500))
        .max(20)
        .default([]),
    subject: Joi.string().trim().max(100).optional().allow(''),
    generationProvider: Joi.string().valid('gemini', 'openai', 'claude').default('gemini'),
    inferCountsIfMissing: Joi.boolean().default(false),
    maxSelectableSlots: Joi.number().integer().min(1).max(500).optional(),
    /** Reviewer's free-text guidance to re-plan (include X, drop Y, more of Z). */
    planningFeedback: Joi.string().trim().max(2000).optional().allow(''),
    /** Topics the reviewer explicitly rejected — seeded as hard exclusions. */
    adminExcludeTopics: Joi.array()
        .items(Joi.string().trim().min(1).max(300))
        .max(60)
        .default([]),
    excludeArchetypes: Joi.array()
        .items(Joi.string().trim().min(1).max(120))
        .max(100)
        .default([]),
    competitiveExamPlan: Joi.object().unknown(true).optional().allow(null),
});

export const generateImageQuestionTextSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(300),
    bankName: Joi.string().trim().max(200).optional().allow(''),
    difficulty: Joi.string()
        .valid('easy', 'medium', 'hard', 'Easy', 'Medium', 'Hard')
        .required(),
    excludeQuestionTexts: Joi.array()
        .items(Joi.string().trim().min(3).max(500))
        .max(100)
        .default([]),
    imageQuestionType: Joi.string()
        .valid('mixed', ...IMAGE_QUESTION_ARCHETYPE_IDS)
        .default('mixed'),
    usedImageQuestionTypes: Joi.array()
        .items(Joi.string().valid(...IMAGE_QUESTION_ARCHETYPE_IDS))
        .max(50)
        .default([]),
    sectionName: Joi.string().trim().max(200).optional().allow(""),
    categoryPaths: Joi.array()
        .items(Joi.string().trim().min(1).max(500))
        .max(20)
        .default([]),
    subject: Joi.string().trim().max(100).optional().allow(""),
});

export const generateQuestionImageSchema = Joi.object({
    imageSpec: Joi.object({
        archetype: Joi.string().trim().max(80).optional(),
        type: Joi.string().trim().max(80).optional(),
        description: Joi.string().trim().min(10).max(2000).optional(),
        style: Joi.string().trim().max(500).optional().allow(''),
        labels: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
        imagePrompt: Joi.string().trim().min(20).max(4000).optional(),
        prompt: Joi.string().trim().min(20).max(4000).optional(),
    })
        .custom((value, helpers) => {
            const hasPrompt =
                String(value?.imagePrompt || value?.prompt || "").trim().length >= 20;
            const hasDescription =
                String(value?.description || "").trim().length >= 10;
            if (!hasPrompt && !hasDescription) {
                return helpers.message(
                    'imageSpec must include imagePrompt or description for image generation'
                );
            }
            return value;
        })
        .required(),
    imageModel: Joi.string()
        .valid(...GEMINI_IMAGE_MODEL_IDS)
        .optional(),
});

export const validateQuestionTopicRelevanceSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(300).messages({
        'string.empty': 'Topic is required',
        'any.required': 'Topic is required',
    }),
    bankName: Joi.string().trim().max(200).optional().allow(''),
    subject: Joi.string().trim().max(100).optional().allow(''),
    sectionName: Joi.string().trim().max(200).optional().allow(''),
    difficulty: Joi.string()
        .valid('easy', 'medium', 'hard', 'Easy', 'Medium', 'Hard')
        .optional()
        .allow(''),
    questions: Joi.array()
        .items(
            Joi.object({
                questionType: Joi.string()
                    .valid('single', 'multiple', 'true_false')
                    .default('single'),
                questionText: Joi.string().required().trim().min(5).max(2000),
                options: Joi.array()
                    .items(Joi.string().trim().max(500))
                    .max(4)
                    .optional(),
                correctAnswer: Joi.string().trim().max(800).optional().allow(''),
                explanation: Joi.string().trim().max(3000).optional().allow(''),
                passage: Joi.string().trim().max(3000).optional().allow(''),
                _solveSteps: Joi.array()
                    .items(Joi.string().trim().max(1200))
                    .max(12)
                    .optional(),
                _conceptSlot: Joi.string().trim().max(120).optional().allow(''),
                conceptSlot: Joi.string().trim().max(120).optional().allow(''),
            })
        )
        .min(1)
        .max(500)
        .required()
        .messages({
            'array.min': 'At least one question is required',
            'any.required': 'Questions array is required',
        }),
    alreadyEvaluated: Joi.boolean().default(false),
    evaluationProvider: Joi.string().valid('gemini', 'openai').default('openai'),
    workflowLogKey: Joi.string().trim().max(80).optional().allow(''),
    categoryPaths: Joi.array()
        .items(Joi.string().trim().min(1).max(500))
        .max(20)
        .default([]),
    competitiveExamPlan: Joi.object({
        examProfile: Joi.string().trim().max(50).optional(),
        catSection: Joi.string().trim().max(50).optional().allow(null),
        paperNumber: Joi.number().integer().valid(1, 2).optional().allow(null),
        isFullPaper: Joi.boolean().optional(),
        topicScope: Joi.string().trim().max(500).optional().allow(''),
        singleCount: Joi.number().integer().min(0).max(100).optional(),
        multipleCount: Joi.number().integer().min(0).max(100).optional(),
        trueFalseCount: Joi.number().integer().min(0).max(100).optional(),
        passageCount: Joi.number().integer().min(0).max(10).optional(),
        passageSingleCount: Joi.number().integer().min(0).max(30).optional(),
        passageMultipleCount: Joi.number().integer().min(0).max(30).optional(),
        passageTrueFalseCount: Joi.number().integer().min(0).max(30).optional(),
        subjects: Joi.array()
            .items(
                Joi.object({
                    id: Joi.string().trim().max(50).optional(),
                    label: Joi.string().trim().max(100).optional(),
                    count: Joi.number().integer().min(0).max(100).optional(),
                })
            )
            .max(20)
            .optional(),
        rationale: Joi.string().trim().max(2000).optional().allow(''),
    })
        .unknown(true)
        .optional(),
    singleCount: Joi.number().integer().min(0).max(100).optional(),
    multipleCount: Joi.number().integer().min(0).max(100).optional(),
    trueFalseCount: Joi.number().integer().min(0).max(100).optional(),
    passageCount: Joi.number().integer().min(0).max(10).optional(),
    passageSingleCount: Joi.number().integer().min(0).max(30).optional(),
    passageMultipleCount: Joi.number().integer().min(0).max(30).optional(),
    passageTrueFalseCount: Joi.number().integer().min(0).max(30).optional(),
})
    .custom((value, helpers) => {
        const workflowError = validateTopicRelevanceEvaluationWorkflow({
            alreadyEvaluated: value.alreadyEvaluated,
            evaluationProvider: value.evaluationProvider,
            questionCount: value.questions?.length || 0,
        });
        if (workflowError) {
            return helpers.error('any.custom', { message: workflowError });
        }
        return value;
    })
    .messages({
        'any.custom': '{{#message}}',
    });

const confirmedQuestionItemSchema = Joi.object({
    questionType: Joi.string()
        .valid('single', 'multiple', 'true_false', 'connected')
        .optional(),
    questionText: Joi.string().trim().max(8000).optional().allow(''),
    text: Joi.string().trim().max(8000).optional().allow(''),
    title: Joi.string().trim().max(500).optional().allow(''),
    passage: Joi.string().trim().max(12000).optional().allow(''),
    options: Joi.array()
        .items(
            Joi.alternatives().try(
                Joi.string().trim().max(2000),
                Joi.object().unknown(true)
            )
        )
        .max(8)
        .optional(),
    optionA: Joi.string().trim().max(2000).optional().allow(''),
    optionB: Joi.string().trim().max(2000).optional().allow(''),
    optionC: Joi.string().trim().max(2000).optional().allow(''),
    optionD: Joi.string().trim().max(2000).optional().allow(''),
    correctIndex: Joi.number().integer().min(0).max(7).optional(),
    multipleCorrectIndexes: Joi.array()
        .items(Joi.number().integer().min(0).max(7))
        .optional(),
    correctAnswer: Joi.alternatives()
        .try(Joi.string().trim().max(50), Joi.array().items(Joi.string()))
        .optional(),
    explanation: Joi.string().trim().max(8000).optional().allow(''),
    subQuestions: Joi.array().items(Joi.link('#confirmedQuestion')).optional(),
    connectedQuestions: Joi.array().items(Joi.link('#confirmedQuestion')).optional(),
}).id('confirmedQuestion');

export const logConfirmedQuestionsSchema = Joi.object({
    topic: Joi.string().required().trim().min(2).max(500),
    bankName: Joi.string().trim().max(300).optional().allow(''),
    sectionName: Joi.string().trim().max(200).optional().allow(''),
    sectionIndex: Joi.number().integer().min(0).max(50).optional().allow(null),
    questions: Joi.array().items(confirmedQuestionItemSchema).min(1).max(300).required(),
});

export default {
    generateQuestions: generateQuestionsSchema,
    saveGeneratedQuestions: saveGeneratedQuestionsSchema,
    generateQuestionBankSuggestions: generateQuestionBankSuggestionsSchema,
    planQuestionBankTopics: planQuestionBankTopicsSchema,
    generateImageQuestionText: generateImageQuestionTextSchema,
    generateQuestionImage: generateQuestionImageSchema,
    validateQuestionTopicRelevance: validateQuestionTopicRelevanceSchema,
    logConfirmedQuestions: logConfirmedQuestionsSchema,
};
