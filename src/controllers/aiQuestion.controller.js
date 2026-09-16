import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import aiQuestionValidator from '../validation/aiQuestion.validator.js';
import aiQuestionService from '../services/aiQuestion.service.js';
import questionService from '../services/question.service.js';
import {
    logGenerateQuestionBankSuggestions,
    logInferCompetitiveExamPlan,
    logValidateQuestionTopicRelevance,
    runWithPipelineTrace,
} from '../utils/aiApiCallLogger.js';
import { resolveGeminiTextModel } from '../services/geminiTextModels.js';
import { resolveClaudeTextModel } from '../services/claudeTextModels.js';
import { QB_GENERATION_CHUNK_SIZE } from '../services/aiQuestionCountInference.service.js';
import { isSolveFirstEnabled } from '../services/questionSolveFirst.service.js';
import {
    isQuestionBankCountsMissing,
    countSelectableFromPlan,
} from '../services/aiQuestionCountInference.service.js';
import { logConfirmedQuestionsToFile } from '../services/confirmedQuestionsLogger.service.js';
import {
    startQuestionBankBackgroundValidation,
    getQuestionBankBackgroundValidationStatus,
} from '../services/questionBankBackgroundValidation.service.js';
import {
    createGenerationJob,
    updateGenerationJob,
    getGenerationJob,
} from '../services/questionBankGenerationJobStore.js';
import { getPipelineEvents } from '../utils/pipelineEventStore.js';
import { lockCountsToPaperFormats } from '../services/aiPoweredTestExamBlueprint.service.js';

/**
 * Generate questions using AI
 * @route POST /api/admin/generate-questions
 * @access Admin/Teacher
 */
export const generateQuestions = asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = aiQuestionValidator.generateQuestions.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    // Generate questions using AI
    const questions = await aiQuestionService.generateQuestionsWithAI(value);

    return res
        .status(200)
        .json(
            ApiResponse.success(
                { questions, count: questions.length },
                'Questions generated successfully. Review and save them.'
            )
        );
});

/**
 * Save AI-generated questions to database
 * @route POST /api/admin/save-generated-questions
 * @access Admin/Teacher
 */
/**
 * Generate question-bank suggestions (single, multiple, true/false) via Gemini.
 * Starts a background job and returns immediately — the pipeline can take
 * several minutes, so it must not hold the HTTP connection open. Poll
 * getQuestionBankGenerationJobStatus for progress/result.
 * @route POST /api/admin/ai/generate-question-bank-suggestions
 */
export const generateQuestionBankSuggestions = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.generateQuestionBankSuggestions.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const jobId = `qbg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const workflowLogKey = value.workflowLogKey?.trim() || '';

    createGenerationJob(jobId, {
        topic: value.topic || value.bankName || '',
        bankName: value.bankName || value.topic || '',
        workflowLogKey,
    });

    setImmediate(() => {
        runQuestionBankGenerationJob(req, value)
            .then((responseBody) => {
                updateGenerationJob(jobId, {
                    status: 'completed',
                    phase: 'done',
                    // Store just the payload (ApiResponse.data), not the whole
                    // ApiResponse envelope — the axios interceptor already
                    // unwraps one envelope layer, so this keeps job.result
                    // shaped exactly like the old synchronous res.data was.
                    result: responseBody?.data ?? responseBody,
                });
            })
            .catch((err) => {
                updateGenerationJob(jobId, {
                    status: 'failed',
                    phase: 'error',
                    error: err?.message || String(err),
                });
            });
    });

    return res.status(202).json(
        ApiResponse.success(
            { jobId, workflowLogKey },
            'Question bank generation started'
        )
    );
});

/**
 * Runs the actual (potentially long-running) generation pipeline off the
 * request/response cycle. Errors are caught by the setImmediate caller above
 * and stored on the job — this must not throw into an HTTP response.
 */
const runQuestionBankGenerationJob = async (req, value) => {
    const difficulty = String(value.difficulty).toLowerCase();
    const passageCount =
        value.passageCount > 0 ? value.passageCount : value.connectedCount || 0;

    const countsMissing = isQuestionBankCountsMissing({
        singleCount: value.singleCount,
        multipleCount: value.multipleCount,
        trueFalseCount: value.trueFalseCount,
        passageCount,
        connectedCount: value.connectedCount || 0,
        passageSingleCount: value.passageSingleCount || 0,
        passageMultipleCount: value.passageMultipleCount || 0,
        passageTrueFalseCount: value.passageTrueFalseCount || 0,
    });

    let inferredCounts = null;
    let competitiveExamPlan = null;
    let singleCount = value.singleCount;
    let multipleCount = value.multipleCount;
    let trueFalseCount = value.trueFalseCount;
    let resolvedPassageCount = passageCount;
    let passageSingleCount = value.passageSingleCount || 0;
    let passageMultipleCount = value.passageMultipleCount || 0;
    let passageTrueFalseCount = value.passageTrueFalseCount || 0;

    if (countsMissing && value.inferCountsIfMissing) {
        const planResult = await aiQuestionService.inferCompetitiveExamPlan({
            topic: value.topic,
            bankName: value.bankName || value.topic,
            difficulty,
            sectionName: value.sectionName || '',
            subject: value.subject || '',
            categoryPaths: value.categoryPaths || [],
            maxSelectableSlots: value.maxSelectableSlots || 0,
        });

        const planCounts = lockCountsToPaperFormats(
            planResult.plan,
            req.aiPoweredTestBlueprint
        );
        competitiveExamPlan = { ...planResult.plan, ...planCounts };
        inferredCounts = competitiveExamPlan;
        singleCount = planCounts.singleCount;
        multipleCount = planCounts.multipleCount;
        trueFalseCount = planCounts.trueFalseCount;
        resolvedPassageCount = planCounts.passageCount;
        passageSingleCount = planCounts.passageSingleCount;
        passageMultipleCount = planCounts.passageMultipleCount;
        passageTrueFalseCount = planCounts.passageTrueFalseCount;

        const guessedSelectable = countSelectableFromPlan(planResult.plan);
        const subjectSummary = (planResult.plan.subjects || [])
            .map((s) => `${s.count} ${s.label}`)
            .join(', ');
        const topicLabel = value.bankName || value.topic;
        console.log(
            `[ai-qb] AI exam plan for "${topicLabel}": profile=${planResult.plan.examProfile}` +
                (planResult.plan.catSection ? ` (${planResult.plan.catSection})` : '') +
                `, ${guessedSelectable} question(s)` +
                (subjectSummary ? ` — ${subjectSummary}` : '') +
                (planResult.usedFallback ? ' (fallback plan)' : '') +
                (planResult.plan.rationale ? ` — ${planResult.plan.rationale}` : '')
        );

        void logInferCompetitiveExamPlan(
            req,
            {
                topic: value.topic,
                bankName: value.bankName || value.topic,
                difficulty,
                maxSelectableSlots: value.maxSelectableSlots || 0,
                generateIntent: value.generateIntent || 'initial',
                workflowLogKey: value.workflowLogKey || '',
            },
            {
                competitiveExamPlan: planResult.plan,
                usedFallback: planResult.usedFallback || false,
                detectedSubject: planResult.detectedSubject || null,
            }
        );
    } else if (value.competitiveExamPlan) {
        competitiveExamPlan = value.competitiveExamPlan;
    }

    const deferValidation = aiQuestionService.shouldDeferQuestionBankValidation({
        deferValidation: value.deferValidation,
        generateIntent: value.generateIntent || 'initial',
        generationMode: value.generationMode || 'default',
    });

    const promptFirstGeneration =
        String(value.generationMode || 'default').toLowerCase() === 'prompt_first';

    const questions = await runWithPipelineTrace(
        req,
        value.topic || value.bankName,
        {
            startNewSession: !value.allowContinuation,
            allowContinuation: value.allowContinuation || false,
            workflowLogKey: value.workflowLogKey || '',
            intent: value.generateIntent || 'initial',
            generationMode: value.generationMode || 'default',
            provider: value.generationProvider || 'gemini',
            difficulty,
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount: resolvedPassageCount,
            solveFirstEnabled: isSolveFirstEnabled(),
            chunkSize: QB_GENERATION_CHUNK_SIZE,
            maxSelectableSlots: value.maxSelectableSlots || 0,
        },
        () =>
            aiQuestionService.generateQuestionBankSuggestions({
                topic: value.topic,
                bankName: value.bankName || value.topic,
                difficulty,
                singleCount,
                multipleCount,
                trueFalseCount,
                connectedCount: resolvedPassageCount,
                passageCount: resolvedPassageCount,
                passageSingleCount,
                passageMultipleCount,
                passageTrueFalseCount,
                excludeQuestionTexts: value.excludeQuestionTexts || [],
                categoryPaths: value.categoryPaths || [],
                sectionName: value.sectionName || "",
                subject: value.subject || "",
                topicRelevanceFeedback: value.topicRelevanceFeedback || null,
                generateIntent: value.generateIntent || "initial",
                topicRelevanceEvaluated: value.topicRelevanceEvaluated || false,
                topicRelevanceRegenerated: value.topicRelevanceRegenerated || false,
                hasGeneratedQuestions: value.hasGeneratedQuestions || false,
                allowContinuation: value.allowContinuation || false,
                inferCountsIfMissing: false,
                maxSelectableSlots: value.maxSelectableSlots || 0,
                competitiveExamPlan,
                generationProvider: value.generationProvider || "gemini",
                deferValidation,
                generationMode: value.generationMode || "default",
                workflowLogKey: value.workflowLogKey?.trim() || "",
                presetSteering: value.presetSteering || null,
            })
    );

    let backgroundValidation = null;
    if (
        !promptFirstGeneration &&
        deferValidation &&
        value.startBackgroundValidation &&
        Array.isArray(questions.questions) &&
        questions.questions.length
    ) {
        const jobId = `qbv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const bgCtx = questions.backgroundValidationContext || {};
        backgroundValidation = startQuestionBankBackgroundValidation(jobId, {
            rawQuestions: questions.questions,
            workflowLogKey: value.workflowLogKey?.trim() || "",
            topic: value.topic,
            bankName: value.bankName || value.topic,
            difficulty,
            generationProvider: value.generationProvider || 'gemini',
            evaluationProvider: value.backgroundEvaluationProvider || 'openai',
            categoryPaths: value.categoryPaths || [],
            sectionName: value.sectionName || '',
            subject: value.subject || '',
            competitiveExamPlan,
            examReferenceBlock: bgCtx.examReferenceBlock || '',
            difficultyResolution: bgCtx.difficultyResolution || questions.difficultyResolution,
            maxSelectableSlots: bgCtx.maxSelectableSlots || value.maxSelectableSlots || 0,
            singleCount: bgCtx.singleCount ?? singleCount,
            multipleCount: bgCtx.multipleCount ?? multipleCount,
            trueFalseCount: bgCtx.trueFalseCount ?? trueFalseCount,
            passageCount: bgCtx.passageCount ?? resolvedPassageCount,
            passageSingleCount: bgCtx.passageSingleCount ?? passageSingleCount,
            passageMultipleCount: bgCtx.passageMultipleCount ?? passageMultipleCount,
            passageTrueFalseCount: bgCtx.passageTrueFalseCount ?? passageTrueFalseCount,
            excludeQuestionTexts: bgCtx.excludeQuestionTexts || value.excludeQuestionTexts || [],
        });
    }

    const responseBody = ApiResponse.success(
        {
            questions: questions.questions,
            count: questions.questions.length,
            detectedSubject: questions.detectedSubject,
            inferredCounts: inferredCounts || questions.inferredCounts || null,
            competitiveExamPlan,
            generationProvider: value.generationProvider || "gemini",
            generationDifficulty: questions.generationDifficulty,
            difficultySource: questions.difficultyResolution?.source,
            difficultyRationale: questions.difficultyResolution?.rationale,
            examProfile: questions.difficultyResolution?.examProfile,
            targetedRegeneration: questions.targetedRegeneration || null,
            pipelineSummary: questions.pipelineSummary || null,
            ragMeta: questions.ragMeta || null,
            validationDeferred: !!backgroundValidation,
            backgroundValidation,
        },
        'Question bank suggestions generated successfully'
    );

    void logGenerateQuestionBankSuggestions(req, value, responseBody);

    return responseBody;
};

/**
 * Plan the topic/syllabus list for a bank WITHOUT generating questions.
 * Returns included/excluded topics + steering (echoed back on generate as
 * presetSteering). Supports reviewer-guided re-planning via planningFeedback /
 * adminExcludeTopics.
 * @route POST /api/admin/ai/plan-question-topics
 */
export const planQuestionBankTopics = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.planQuestionBankTopics.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const difficulty = String(value.difficulty || 'medium').toLowerCase();
    const passageCount =
        value.passageCount > 0 ? value.passageCount : value.connectedCount || 0;

    const countsMissing = isQuestionBankCountsMissing({
        singleCount: value.singleCount,
        multipleCount: value.multipleCount,
        trueFalseCount: value.trueFalseCount,
        passageCount,
        connectedCount: value.connectedCount || 0,
        passageSingleCount: value.passageSingleCount || 0,
        passageMultipleCount: value.passageMultipleCount || 0,
        passageTrueFalseCount: value.passageTrueFalseCount || 0,
    });

    let competitiveExamPlan = value.competitiveExamPlan || null;
    let singleCount = value.singleCount || 0;
    let multipleCount = value.multipleCount || 0;
    let trueFalseCount = value.trueFalseCount || 0;
    let resolvedPassageCount = passageCount;
    let passageSingleCount = value.passageSingleCount || 0;
    let passageMultipleCount = value.passageMultipleCount || 0;
    let passageTrueFalseCount = value.passageTrueFalseCount || 0;

    if (countsMissing && value.inferCountsIfMissing && !competitiveExamPlan) {
        const planResult = await aiQuestionService.inferCompetitiveExamPlan({
            topic: value.topic,
            bankName: value.bankName || value.topic,
            difficulty,
            sectionName: value.sectionName || '',
            subject: value.subject || '',
            categoryPaths: value.categoryPaths || [],
            maxSelectableSlots: value.maxSelectableSlots || 0,
        });
        const planCounts = lockCountsToPaperFormats(
            planResult.plan,
            req.aiPoweredTestBlueprint
        );
        competitiveExamPlan = { ...planResult.plan, ...planCounts };
        singleCount = planCounts.singleCount;
        multipleCount = planCounts.multipleCount;
        trueFalseCount = planCounts.trueFalseCount;
        resolvedPassageCount = planCounts.passageCount;
        passageSingleCount = planCounts.passageSingleCount;
        passageMultipleCount = planCounts.passageMultipleCount;
        passageTrueFalseCount = planCounts.passageTrueFalseCount;
    }

    const result = await aiQuestionService.planQuestionBankTopics({
        topic: value.topic,
        bankName: value.bankName || value.topic,
        difficulty,
        singleCount,
        multipleCount,
        trueFalseCount,
        connectedCount: resolvedPassageCount,
        passageCount: resolvedPassageCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
        categoryPaths: value.categoryPaths || [],
        sectionName: value.sectionName || '',
        subject: value.subject || '',
        maxSelectableSlots: value.maxSelectableSlots || 0,
        competitiveExamPlan,
        generationProvider: value.generationProvider || 'gemini',
        planningFeedback: value.planningFeedback || '',
        adminExcludeTopics: value.adminExcludeTopics || [],
        excludeArchetypes: value.excludeArchetypes || [],
    });

    return res.status(200).json(
        ApiResponse.success(
            { ...result, competitiveExamPlan },
            'Question topics planned successfully'
        )
    );
});

/**
 * Poll question-bank generation started by generateQuestionBankSuggestions.
 * @route GET /api/admin/ai/question-bank-generation/:jobId
 */
export const getQuestionBankGenerationJobStatus = asyncHandler(async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId) {
        throw new ApiError(400, 'jobId is required');
    }

    const job = getGenerationJob(jobId);
    if (!job) {
        throw new ApiError(404, 'Generation job not found or expired');
    }

    return res.status(200).json(
        ApiResponse.success(job, 'Generation job status retrieved')
    );
});

/**
 * Poll background validation started by deferred question-bank generation.
 * @route GET /api/admin/ai/question-bank-background-validation/:jobId
 */
export const getQuestionBankBackgroundValidation = asyncHandler(async (req, res) => {
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId) {
        throw new ApiError(400, 'jobId is required');
    }

    const status = getQuestionBankBackgroundValidationStatus(jobId);
    if (!status) {
        throw new ApiError(404, 'Background validation job not found or expired');
    }

    return res.status(200).json(
        ApiResponse.success(status, 'Background validation status retrieved')
    );
});

/**
 * Poll live pipeline events for an in-flight generation or validation run.
 * @route GET /api/admin/ai/pipeline-events/:workflowLogKey
 */
export const getPipelineEventsStatus = asyncHandler(async (req, res) => {
    const workflowLogKey = String(req.params.workflowLogKey || '').trim();
    if (!workflowLogKey) {
        throw new ApiError(400, 'workflowLogKey is required');
    }

    const since = Number(req.query.since);
    const sincePartial = Number(req.query.sincePartial);
    const payload = getPipelineEvents(
        workflowLogKey,
        Number.isFinite(since) ? since : 0,
        Number.isFinite(sincePartial) ? sincePartial : 0
    );

    return res.status(200).json(
        ApiResponse.success(payload, 'Pipeline events retrieved')
    );
});

/**
 * Generate a single image-based question (text + imageSpec)
 * @route POST /api/admin/ai/generate-image-question
 */
export const generateImageQuestion = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.generateImageQuestionText.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const question = await aiQuestionService.generateImageQuestionText({
        topic: value.topic,
        bankName: value.bankName || value.topic,
        difficulty: String(value.difficulty).toLowerCase(),
        excludeQuestionTexts: value.excludeQuestionTexts || [],
        imageQuestionType: value.imageQuestionType || 'mixed',
        usedImageQuestionTypes: value.usedImageQuestionTypes || [],
        categoryPaths: value.categoryPaths || [],
        sectionName: value.sectionName || '',
        subject: value.subject || '',
    });

    return res.status(200).json(
        ApiResponse.success({ question }, 'Image question generated successfully')
    );
});

/**
 * Generate a single image-based question (text + imageSpec) via OpenAI — test flow
 * @route POST /api/admin/ai/generate-image-question-openai
 */
export const generateImageQuestionOpenAI = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.generateImageQuestionText.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const question = await aiQuestionService.generateImageQuestionTextWithOpenAI({
        topic: value.topic,
        bankName: value.bankName || value.topic,
        difficulty: String(value.difficulty).toLowerCase(),
        excludeQuestionTexts: value.excludeQuestionTexts || [],
        imageQuestionType: value.imageQuestionType || 'mixed',
        usedImageQuestionTypes: value.usedImageQuestionTypes || [],
        categoryPaths: value.categoryPaths || [],
        sectionName: value.sectionName || '',
        subject: value.subject || '',
    });

    return res.status(200).json(
        ApiResponse.success(
            { question },
            'Image question generated successfully with OpenAI'
        )
    );
});

/**
 * Generate image from imageSpec and upload to storage
 * @route POST /api/admin/ai/generate-question-image
 */
export const generateQuestionImage = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.generateQuestionImage.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const result = await aiQuestionService.generateQuestionImageFromSpec(
        value.imageSpec,
        { imageModel: value.imageModel }
    );

    return res.status(200).json(
        ApiResponse.success(result, 'Question image generated successfully')
    );
});

/**
 * List selectable Gemini / Imagen image models
 * @route GET /api/admin/ai/gemini-image-models
 */
export const listGeminiImageModels = asyncHandler(async (req, res) => {
    const models = aiQuestionService.getGeminiImageModelOptions();
    return res.status(200).json(
        ApiResponse.success({ models }, 'Gemini image models retrieved successfully')
    );
});

/**
 * List selectable Gemini text models (question generation)
 * @route GET /api/admin/ai/gemini-text-models
 */
export const listGeminiTextModels = asyncHandler(async (req, res) => {
    const models = aiQuestionService.getGeminiTextModelOptions();
    const active = resolveGeminiTextModel();
    return res.status(200).json(
        ApiResponse.success(
            { models, active },
            'Gemini text models retrieved successfully'
        )
    );
});

/**
 * List selectable Claude text models (question generation)
 * @route GET /api/admin/ai/claude-text-models
 */
export const listClaudeTextModels = asyncHandler(async (req, res) => {
    const models = aiQuestionService.getClaudeTextModelOptions();
    const active = resolveClaudeTextModel();
    return res.status(200).json(
        ApiResponse.success(
            { models, active },
            'Claude text models retrieved successfully'
        )
    );
});

/**
 * Generate image from imageSpec via OpenAI and upload to storage
 * @route POST /api/admin/ai/generate-question-image-openai
 */
export const generateQuestionImageOpenAI = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.generateQuestionImage.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const result = await aiQuestionService.generateQuestionImageFromSpecWithOpenAI(
        value.imageSpec
    );

    return res.status(200).json(
        ApiResponse.success(result, 'Question image generated successfully with OpenAI')
    );
});

export const saveGeneratedQuestions = asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = aiQuestionValidator.saveGeneratedQuestions.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const { questions, questionBankId } = value;
    const createdBy = req.user._id;

    // Transform questions to match Question model schema
    const questionsToSave = questions.map((q) => ({
        questionText: q.questionText,
        questionType: 'single', // AI generates single-choice MCQs
        options: [
            { text: q.optionA, isCorrect: q.answer === 'A' },
            { text: q.optionB, isCorrect: q.answer === 'B' },
            { text: q.optionC, isCorrect: q.answer === 'C' },
            { text: q.optionD, isCorrect: q.answer === 'D' }
        ],
        correctAnswer: q.answer,
        explanation: q.explanation || '',
        subject: q.subject,
        subjectRef: q.subjectRef || null,
        topic: q.topic,
        difficulty: q.difficulty,
        marks: q.marks || 1,
        negativeMarks: q.negativeMarks || 0,
        questionBank: questionBankId || q.questionBank || null,
        createdBy,
        isActive: true
    }));

    // Save questions to database
    const savedQuestions = [];
    const errors = [];

    for (let i = 0; i < questionsToSave.length; i++) {
        try {
            const savedQuestion = await questionService.createQuestion(
                questionsToSave[i],
                createdBy
            );
            savedQuestions.push(savedQuestion);
        } catch (err) {
            errors.push({
                index: i,
                questionText: questionsToSave[i].questionText.substring(0, 50) + '...',
                error: err.message
            });
        }
    }

    // Return response with saved questions and any errors
    const response = {
        saved: savedQuestions,
        savedCount: savedQuestions.length,
        totalCount: questionsToSave.length,
        errors: errors.length > 0 ? errors : undefined
    };

    const message = errors.length > 0
        ? `${savedQuestions.length} of ${questionsToSave.length} questions saved successfully. ${errors.length} failed.`
        : `All ${savedQuestions.length} questions saved successfully`;

    return res
        .status(201)
        .json(ApiResponse.success(response, message));
});

/**
 * Validate generated question relevancy to topic via OpenAI (sample of up to 50).
 * @route POST /api/admin/ai/validate-question-topic-relevance
 */
export const validateQuestionTopicRelevance = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.validateQuestionTopicRelevance.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const result = await runWithPipelineTrace(
        req,
        value.topic || value.bankName,
        {
            startNewSession: false,
            intent: 'validate',
            provider: value.evaluationProvider || 'openai',
            workflowLogKey: value.workflowLogKey || '',
            difficulty: value.difficulty
                ? String(value.difficulty).toLowerCase()
                : '',
            questionCount: Array.isArray(value.questions)
                ? value.questions.length
                : 0,
        },
        () =>
            aiQuestionService.validateQuestionTopicRelevance({
                topic: value.topic,
                bankName: value.bankName || '',
                subject: value.subject || '',
                sectionName: value.sectionName || '',
                difficulty: value.difficulty
                    ? String(value.difficulty).toLowerCase()
                    : '',
                questions: value.questions,
                alreadyEvaluated: value.alreadyEvaluated || false,
                evaluationProvider: value.evaluationProvider || 'openai',
                competitiveExamPlan: value.competitiveExamPlan || null,
                categoryPaths: value.categoryPaths || [],
                singleCount: value.singleCount || 0,
                multipleCount: value.multipleCount || 0,
                trueFalseCount: value.trueFalseCount || 0,
                passageCount: value.passageCount || 0,
                passageSingleCount: value.passageSingleCount || 0,
                passageMultipleCount: value.passageMultipleCount || 0,
                passageTrueFalseCount: value.passageTrueFalseCount || 0,
            })
    );

    const responseBody = ApiResponse.success(
        { ...result, evaluationProvider: value.evaluationProvider || "openai" },
        "Topic relevance validated successfully"
    );

    void logValidateQuestionTopicRelevance(req, value, responseBody);

    return res.status(200).json(responseBody);
});

/**
 * Log confirmed questions to temp/confirmed-questions (topic, section, stems, options, correct answer, explanation).
 * @route POST /api/admin/ai/log-confirmed-questions
 */
export const logConfirmedQuestions = asyncHandler(async (req, res) => {
    const { error, value } =
        aiQuestionValidator.logConfirmedQuestions.validate(req.body);

    if (error) {
        throw new ApiError(
            400,
            'Validation Error',
            error.details.map((x) => x.message)
        );
    }

    const result = await logConfirmedQuestionsToFile({
        topic: value.topic,
        bankName: value.bankName || '',
        sectionName: value.sectionName || '',
        sectionIndex: value.sectionIndex ?? null,
        questions: value.questions,
    });

    return res.status(200).json(
        ApiResponse.success(
            {
                filePath: result.filePath,
                questionCount: result.questionCount,
                appended: result.appended,
            },
            'Confirmed questions logged successfully'
        )
    );
});

/**
 * Apply deep answer correction to an existing question bank.
 * Performs independent re-solve and fixes high-confidence disagreements.
 * @route POST /api/admin/ai/apply-answer-correction
 */
export const applyAnswerCorrection = asyncHandler(async (req, res) => {
    const { topic, bankName, questions, evaluationProvider } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
        throw new ApiError(400, 'Validation Error', ['questions array is required and must not be empty']);
    }

    if (questions.length > 500) {
        throw new ApiError(400, 'Validation Error', ['Maximum 500 questions per request']);
    }

    try {
        const result = await runWithPipelineTrace(
            req,
            topic || bankName || 'unknown',
            { intent: 'answer_correction', questionCount: questions.length },
            async () => {
                return await aiQuestionService.applyAnswerCorrectionToQuestionBank({
                    topic: topic || bankName || '',
                    bankName: bankName || topic || '',
                    questions,
                    evaluationProvider: evaluationProvider || 'openai',
                });
            }
        );

        return res.status(200).json(
            ApiResponse.success(
                {
                    questions: result.questions,
                    checkedCount: result.checkedCount,
                    disagreementCount: result.disagreementCount,
                    fixedCount: result.fixedCount,
                    skippedCount: result.skippedCount || 0,
                    report: result.report,
                },
                `Answer correction complete: ${result.fixedCount} fixed, ${result.checkedCount} checked`
            )
        );
    } catch (error) {
        console.error('[answer-correction]', error.message);
        throw error;
    }
});

export default {
    generateQuestions,
    generateQuestionBankSuggestions,
    getQuestionBankGenerationJobStatus,
    getQuestionBankBackgroundValidation,
    getPipelineEventsStatus,
    generateImageQuestion,
    generateImageQuestionOpenAI,
    generateQuestionImage,
    listGeminiImageModels,
    listGeminiTextModels,
    generateQuestionImageOpenAI,
    saveGeneratedQuestions,
    validateQuestionTopicRelevance,
    planQuestionBankTopics,
    logConfirmedQuestions,
    applyAnswerCorrection,
};
