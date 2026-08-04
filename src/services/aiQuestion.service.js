import { GoogleGenAI, Modality } from "@google/genai";
import axios from "axios";
import {
    assertGenerationWorkflowAllowed,
    assertTopicRelevanceEvaluationAllowed,
    buildTopicRelevancePrompt,
    buildCorrectnessAuditPrompt,
    buildJeeAuthenticityAuditPrompt,
    buildRegenerationEscalationBlock,
    buildRegenerationQualityGatesBlock,
    formatTopicRelevanceFeedbackBlock,
    mergeValidationResults,
    mergeCorrectnessAuditResults,
    parseTopicRelevanceResponse,
    parseCorrectnessAuditResponse,
    parseAuthenticityAuditResponse,
    REGEN_TARGET_SCORE,
    GENERATE_INTENTS,
    enrichQuestionsForDifficultyAudit,
    sampleQuestionsForValidation,
    TOPIC_RELEVANCE_MAX_SAMPLE,
} from "./topicRelevanceValidation.service.js";
import { runDeterministicCorrectnessAudit } from "./correctnessPreAudit.service.js";
import {
    buildCountPlanGuidanceBlock,
    getCountInferenceContext,
    isQuestionBankCountsMissing,
    normalizeInferredPlan,
    suggestRealisticDefaultPlan,
    splitQuestionBankCountsIntoChunks,
    countApiItemsFromQuestionCounts,
    QB_GENERATION_CHUNK_SIZE,
    computeChunkTierOffsets,
    isParallelChunkGenerationEnabled,
    QB_PARALLEL_CHUNK_CONCURRENCY,
    runTasksWithConcurrency,
} from "./aiQuestionCountInference.service.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadImageToCloudinary } from "../utils/s3Upload.js";
import {
    getImageQuestionArchetype,
    getImagePromptRulesForArchetype,
    IMAGE_QUESTION_ARCHETYPES,
    pickImageQuestionArchetype,
} from "./imageQuestionArchetypes.js";
import {
    buildDifficultyCalibrationBlock,
    detectExamProfile,
    detectCatSection,
    getFormatOnlyExampleNote,
} from "./examDifficultyCalibration.js";
import {
    buildExamGenerationContextBlock,
    buildExamAuthoringBlock,
    buildExamToughnessBlock,
    buildCorrectnessFirstGenerationBlock,
    buildPreOutputCorrectnessChecklist,
    buildGenerationCorrectnessMandatesBlock,
    buildAutomatedAuditorDefectsBlock,
    buildExplanationOptionLockBlock,
    buildSolveFirstSkeletonCorrectnessBlock,
    buildPostSolveSelfCheckBlock,
    buildExamAnswerKeyLockBlock,
    buildExamSolveThenWriteBlock,
    buildExamDifficultyFloorBlock,
    buildMathematicsDifficultyBlock,
    buildChemistryNumericalAuthoringBlock,
    buildPhysicsNumericalAuthoringBlock,
    buildJeeAuthenticityGenerationBlock,
    buildJeeExamPatternFromPlanBlock,
    buildJeeFullPaperMixBlock,
    isJeeFullPaperTopic,
    buildPcmAuthoringBlock,
    getGenerationTopicFocus,
    isChemistryGenerationSubject,
    isMathematicsGenerationSubject,
    isPhysicsGenerationSubject,
    buildCatSectionAuthoringBlock,
} from "./examPromptContext.service.js";
import {
    buildPromptFirstQuestionBankPrompt,
    isPromptFirstGenerationMode,
    isPaperReferenceGenerationMode,
    isQuestionRagGenerationMode,
} from "./examPromptFirst.service.js";
import {
    appendJsonOutputToComposedPrompt,
    resolveComposedGenerationPrompt,
} from "./examPromptComposer.service.js";
import { extractReferencePaperGuidance } from "./referencePaperLibrary.service.js";
import {
    retrieveSimilarConfirmedQuestions,
    rejectNearCorpusDuplicates,
    mergeRagMeta,
} from "./questionCorpusRag.service.js";
import {
    stripFlawedQuestionBankEntries,
    flattenQuestionBankForCorrectnessAudit,
    assertGenerationCorrectness,
} from "./correctnessPreAudit.service.js";
import {
    resolveConceptArchetypeSteering,
    getKindCompositionCounts,
} from "./conceptArchetypePlanner.service.js";
import {
    getSubjectLabelForArchetypes,
    allocateRankedConceptSlots,
} from "./conceptArchetypeGuidance.service.js";
import {
    buildSolveFirstSkeletonPrompt,
    getSolveFirstExamProfile,
    getSolveFirstSubjectId,
    parseSolveFirstSkeletons,
    shouldUseSolveFirstGeneration,
    skeletonsToQuestions,
    getSolveFirstMaxAttempts,
    sanitizeQuestionStemEmbeddedOptions,
    sanitizeBankQuestionForPipeline,
} from "./questionSolveFirst.service.js";
import {
    applyDifficultySelfAuditGate,
    applySkeletonDifficultySelfAuditGate,
    shouldSkipLlmDifficultySelfAudit,
    DIFFICULTY_SELF_AUDIT_MIN_SCORE,
    SKELETON_DIFFICULTY_SELF_AUDIT_MIN_SCORE,
} from "./difficultySelfAudit.service.js";
import {
    reconcileQuestionBankWithIndependentVerify,
} from "./questionNumericVerify.service.js";
import { runAnswerCorrectnessPass } from "./answerCorrection.service.js";
import { runIndependentVerificationPipeline, runPostSymbolicTruthGates, dropQuestionsByRefs } from "./independentVerification.service.js";
import { applySymbolicVerificationToQuestions, applySymPyPreSolvePass } from "./symbolicVerify.service.js";
import {
    isSolverTruthEnabled,
    isStrictAnswerCorrectnessEnabled,
} from "./solverTruth.service.js";
import { rewriteExplanationsForBank } from "./explanationRewrite.service.js";
import { dedupeBatchByHashAndEmbedding } from "./batchDuplicate.service.js";
import { runConceptCoveragePass } from "./conceptCoverage.service.js";
import { withStageTiming, recordVerificationTelemetry } from "./verificationTelemetry.service.js";
import { parkLowConfidenceForHumanReview } from "./humanReviewQueue.service.js";
import {
    repairSkeletonAuditRejections,
    repairDifficultyRejectedQuestions,
} from "./skeletonRepair.service.js";
import { filterSkeletonsByCasVerification } from "./skeletonCasVerification.service.js";
import {
    buildHardQuestionMandateBlock,
    isVeteranDifficultyEnabled,
    isExamNativeVeteranGeneration,
    isRepairOnFailEnabled,
    isMandateRepairEnabled,
    isFinalizeDifficultyRegenEnabled,
    isFinalizeTopUpEnabled,
    getFinalizeTopUpMaxWaves,
    getCountOverflowMax,
} from "./hardQuestionMandate.service.js";
import {
    buildCompetitiveExamPlanGenerationBlock,
    buildCompetitiveExamPlanPrompt,
    normalizeCompetitiveExamPlan,
    resolveExamContextForGeneration,
    suggestMinimalSubjectFallback,
    buildGenerationPlanForEvaluation,
    auditPatternCompliance,
    enforceCatVarcFormatDefaults,
    resolveExamTopicScope,
} from "./competitiveExamPlan.service.js";
import {
    assignDifficultyTiersToQuestions,
    buildDifficultyMixGenerationBlock,
    buildDifficultyTierSlots,
    normalizeQuestionTier,
    buildBankDifficultyProfileBlock,
    buildAssignedTierSlotsBlock,
    countSelectableSlots,
    capQuestionsToMaxSlots,
} from "./difficultyMix.service.js";
import {
    resolveGenerationDifficulty,
    buildExamNativeDifficultyAuthorityBlock,
} from "./examGenerationDifficulty.service.js";
import {
    INITIAL_GEN_DIFFICULTY_MATCH_TARGET,
    runDeterministicDifficultyAudit,
} from "./difficultyPreAudit.service.js";
import {
    resolveTargetedRegenerationCounts,
    extractRegenerationTargetNumbers,
} from "./regenerationTargeting.service.js";
import {
    loadPersistedArchetypes,
    persistArchetypes,
} from "./archetypeHistory.service.js";
import { fetchExamReferenceBrief } from "./examReferenceResearch.service.js";
import {
    buildSubjectScopeBlock,
    buildSubjectScopeBlockForGeneration,
    resolveGenerationSubject,
    resolveSubjectForGeneration,
} from "./subjectDetection.js";
import {
    enrichPromptForExamPaperStyle,
    EXAM_PAPER_IMAGE_DEFAULT_STYLE,
    EXAM_PAPER_IMAGE_GENERATION_BLOCK,
    EXAM_PAPER_IMAGE_QUESTION_RULES,
    EXAM_PAPER_IMAGEN_SUFFIX,
} from "./examPaperImageStyle.js";
import {
    parseJsonArrayFromAIText,
    parseJsonObjectFromAIText,
} from "../utils/aiJsonRepair.js";
import { pipelineTrace, pipelineTraceSection, getActiveWorkflowLogKey } from "../utils/aiApiCallLogger.js";
import { createPromptBasedGenerationRun } from "../utils/promptBasedGenerationLogger.js";
import {
    DEFAULT_IMAGEN_MODEL,
    GEMINI_IMAGE_MODEL_IDS,
    GEMINI_IMAGE_MODEL_OPTIONS,
    getGeminiImageModelOptions,
    getImageModelMeta,
    isNanoBananaImageModel,
    resolveGeminiImageModel,
} from "./geminiImageModels.js";
import {
    GEMINI_TEXT_MODEL_IDS,
    GEMINI_TEXT_MODEL_OPTIONS,
    getGeminiTextModelOptions,
    resolveGeminiTextModel,
    resolveGeminiTextModelForTier,
} from "./geminiTextModels.js";
import {
    CLAUDE_TEXT_MODEL_IDS,
    CLAUDE_TEXT_MODEL_OPTIONS,
    getClaudeTextModelOptions,
    resolveClaudeTextModel,
    claudeModelSupportsTemperature,
} from "./claudeTextModels.js";
import {
    assertGenerationProviderConfigured,
    getAnthropicApiKey,
    normalizeGenerationProvider,
    resolveGenerationTemperature,
    resolveVerificationStageProvider,
    resolveVerificationStageModel,
    isOpenAIReasoningModel,
    resolveReasoningEffort,
    resolveSolverFallbackChain,
    resolveProviderForDifficulty,
} from "./generationProvider.service.js";
import {
    callOpenAIReasoningJson,
    callOpenAIReasoningText,
} from "./openaiReasoningChat.service.js";
import {
    enrichSlotPlansToBlueprints,
    blueprintsToPresetSteering,
    buildExamBlueprintDistribution,
    checkBlueprintCoverage,
    buildBlueprintGenerationBlock,
    isBlueprintPlannerEnabled,
} from "./questionBlueprint.service.js";
import {
    retrieveDifficultyCalibration,
    isDifficultyCalibrationEnabled,
} from "./difficultyCalibration.service.js";
import {
    runDistractorPass,
    isDistractorPassEnabled,
} from "./distractorPass.service.js";
import { runFormulaValidationPass } from "./formulaValidator.service.js";

export {
    GEMINI_IMAGE_MODEL_IDS,
    GEMINI_IMAGE_MODEL_OPTIONS,
    getGeminiImageModelOptions,
    GEMINI_TEXT_MODEL_IDS,
    GEMINI_TEXT_MODEL_OPTIONS,
    getGeminiTextModelOptions,
    CLAUDE_TEXT_MODEL_IDS,
    CLAUDE_TEXT_MODEL_OPTIONS,
    getClaudeTextModelOptions,
};

// Initialize Gemini client (model from GEMINI_TEXT_MODEL)
// httpOptions.timeout bounds a single call's wait for Gemini to respond at
// all — without it, the SDK falls back to undici's ~5min default headers
// timeout, so a stuck call silently hangs for minutes before our own
// retry/backoff logic (callGeminiWithRetries) ever gets a chance to run.
// Increased from 90s to 120s to account for network jitter and Gemini latency variations.
const GEMINI_REQUEST_TIMEOUT_MS = Math.max(
    10_000,
    Number(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? 30_000)
);
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS },
});

const geminiTextModel = () => resolveGeminiTextModel();

const mixOptionsFromResolution = (difficultyResolution) => {
    if (!difficultyResolution?.examCalibrated) return {};
    return {
        examProfile: difficultyResolution.examProfile,
        examCalibrated: true,
    };
};

if (process.env.GEMINI_API_KEY) {
  console.log(`[gemini] text model: ${geminiTextModel()}`);
}
if (getAnthropicApiKey()) {
  console.log(`[claude] text model: ${resolveClaudeTextModel()}`);
}

/**
 * Build a structured prompt for AI question generation
 */
const buildPrompt = ({ topic, subject, classLevel, difficulty, numberOfQuestions, categoryPaths = [], sectionName = "" }) => {
    const resolvedSubject = resolveGenerationSubject({
        topic,
        subject,
        classLevel,
        categoryPaths,
        sectionName,
        bankName: topic,
    });
    const subjectBlock = buildSubjectScopeBlock(resolvedSubject);
    const calibration = buildDifficultyCalibrationBlock({
        topic,
        subject: resolvedSubject.id || subject,
        classLevel,
        difficulty,
        batchSize: numberOfQuestions,
        mode: "text",
        categoryPaths,
        sectionName,
    });
    return `You are an expert educator creating multiple-choice questions for competitive exams.

Generate exactly ${numberOfQuestions} high-quality MCQ questions with the following specifications:

**Topic:** ${topic}
**Class/Level:** ${classLevel}
**Difficulty:** ${difficulty}
${subjectBlock}
${calibration}
**CRITICAL INSTRUCTIONS:**
1. Return ONLY a valid JSON array, no markdown, no code blocks, no extra text
2. Each question must have exactly 4 options (A, B, C, D)
3. Each question must have exactly ONE correct answer
4. Include a clear explanation for the correct answer
5. Questions should be appropriate for ${classLevel} level
6. Difficulty must match the calibration above — NOT generic textbook exercises

**Required JSON Format:**
[
  {
    "questionText": "The complete question text here",
    "optionA": "First option text",
    "optionB": "Second option text",
    "optionC": "Third option text",
    "optionD": "Fourth option text",
    "answer": "A",
    "explanation": "Detailed explanation of why this is correct"
  }
]

**IMPORTANT:** 
- The "answer" field must be ONLY the letter: "A", "B", "C", or "D"
- Do NOT include markdown code blocks like \`\`\`json
- Return ONLY the JSON array, nothing else
- Ensure all questions are unique and relevant to the topic`;
};

const GEMINI_QB_GENERATION_TEMPERATURE = Math.min(
    1,
    Math.max(0, Number(process.env.GEMINI_QB_GENERATION_TEMPERATURE ?? 0.15))
);

const geminiJsonConfig = (temperature = GEMINI_QB_GENERATION_TEMPERATURE) => ({
    responseMimeType: "application/json",
    temperature,
});

const GEMINI_QB_MAX_ATTEMPTS = Math.max(
    1,
    Number(process.env.GEMINI_QB_MAX_ATTEMPTS) || 4
);
const GEMINI_RETRY_DELAY_MS = Math.max(
    500,
    Number(process.env.GEMINI_RETRY_DELAY_MS) || 1500
);
const GEMINI_RETRY_MAX_DELAY_MS = Math.max(
    GEMINI_RETRY_DELAY_MS,
    Number(process.env.GEMINI_RETRY_MAX_DELAY_MS) || 5000
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJsonArrayFromAI = (rawText) => {
    try {
        return parseJsonArrayFromAIText(rawText);
    } catch (error) {
        throw new ApiError(500, error.message);
    }
};

const parseJsonObjectFromAI = (rawText) => {
    try {
        return parseJsonObjectFromAIText(rawText);
    } catch (error) {
        throw new ApiError(500, error.message);
    }
};

const isRateLimitGeminiError = (error) => {
    const msg = String(error?.message || error || "").toLowerCase();
    return msg.includes("rate limit") || msg.includes("quota");
};

/** Collect message + cause chain (Node fetch errors nest details in .cause). */
const collectErrorText = (error) => {
    const parts = [];
    let cur = error;
    for (let i = 0; i < 8 && cur; i++) {
        if (cur.message) parts.push(String(cur.message));
        if (cur.code) parts.push(String(cur.code));
        if (cur.status) parts.push(String(cur.status));
        if (cur.statusCode) parts.push(String(cur.statusCode));
        cur = cur.cause;
    }
    return parts.join(" ").toLowerCase();
};

const isNetworkGeminiError = (error) => {
    const msg = collectErrorText(error);
    return (
        msg.includes("fetch failed") ||
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("enotfound") ||
        msg.includes("econnrefused") ||
        msg.includes("enetunreach") ||
        msg.includes("socket hang up") ||
        msg.includes("network error") ||
        msg.includes("network request failed") ||
        msg.includes("aborterror") ||
        msg.includes("connect timeout") ||
        msg.includes("und_err")
    );
};

const isTransientGeminiError = (error) => {
    const msg = collectErrorText(error);
    return (
        isNetworkGeminiError(error) ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("504") ||
        msg.includes("500") ||
        msg.includes("429") ||
        msg.includes("unavailable") ||
        msg.includes("high demand") ||
        msg.includes("overloaded") ||
        msg.includes("resource exhausted") ||
        msg.includes("deadline") ||
        msg.includes("temporarily") ||
        msg.includes("try again") ||
        msg.includes("internal error") ||
        msg.includes("service unavailable")
    );
};

const getGeminiRetryDelayMs = (error, attempt) => {
    const network = isNetworkGeminiError(error);
    const rateLimited = isRateLimitGeminiError(error);
    const base = network
        ? GEMINI_RETRY_DELAY_MS * 2
        : rateLimited
          ? GEMINI_RETRY_DELAY_MS * 3
          : GEMINI_RETRY_DELAY_MS;
    const exponential = base * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, GEMINI_RETRY_MAX_DELAY_MS);
};

const isGeminiAvailabilityError = (error) => {
    if (error instanceof ApiError && [429, 502, 503, 504].includes(error.statusCode)) {
        return true;
    }
    return isTransientGeminiError(error) || isRateLimitGeminiError(error);
};

const isGeminiSafetyBlockError = (error) => {
    const msg = String(error?.message || error || "").toLowerCase();
    return (
        msg.includes("safety") ||
        msg.includes("blocked") ||
        msg.includes("block_reason") ||
        msg.includes("content filter") ||
        msg.includes("harm category") ||
        msg.includes("recitation") ||
        msg.includes("prohibited content") ||
        msg.includes("candidate was blocked")
    );
};

const toGeminiQuestionBankError = (error) => {
    if (isGeminiSafetyBlockError(error)) {
        return new ApiError(
            400,
            "AI could not generate questions for this topic due to content restrictions. Try rephrasing the topic or bank name."
        );
    }

    if (error instanceof ApiError) {
        if (isRateLimitGeminiError(error)) {
            return new ApiError(
                429,
                "AI service rate limit exceeded. Please try again later."
            );
        }
        if (isTransientGeminiError(error)) {
            const network = isNetworkGeminiError(error);
            return new ApiError(
                503,
                network
                    ? "Could not reach the Gemini API (network error). Check your internet connection and try again."
                    : "Gemini is busy right now. Please wait a moment and try again."
            );
        }
        return error;
    }

    const msg = String(error?.message || error);
    if (msg.includes("API key")) {
        return new ApiError(500, "Invalid or missing Gemini API key");
    }
    if (isRateLimitGeminiError(error)) {
        return new ApiError(
            429,
            "AI service rate limit exceeded. Please try again later."
        );
    }
    if (isTransientGeminiError(error)) {
        const network = isNetworkGeminiError(error);
        return new ApiError(
            503,
            network
                ? "Could not reach the Gemini API (network error). Check your internet connection and try again."
                : "Gemini is busy right now. Please wait a moment and try again."
        );
    }
    if (msg.includes("Failed to parse AI response")) {
        return new ApiError(500, msg);
    }
    return new ApiError(500, `AI question generation failed: ${msg}`);
};

const isRetryableQuestionBankError = (error) => {
    if (isGeminiSafetyBlockError(error)) return false;
    if (error instanceof ApiError) {
        if ([429, 502, 503, 504].includes(error.statusCode)) return true;
    }
    if (isTransientGeminiError(error) || isRateLimitGeminiError(error)) {
        return true;
    }

    const msg = String(error?.message || "");
    if (msg.includes("Failed to parse AI response")) return true;
    if (msg.includes("Failed to parse image question")) return true;
    if (msg.includes("AI returned invalid image question JSON")) return true;
    if (msg.includes("AI returned empty response")) return true;
    if (msg.includes("AI returned") && msg.includes("were requested")) return true;
    if (/Expected \d+ .* questions, got/.test(msg)) return true;
    if (/Question \d+:/.test(msg)) return true;
    if (msg.includes("missing fields")) return true;
    if (msg.includes("invalid answer")) return true;
    if (msg.includes("multiple-choice needs")) return true;
    if (msg.includes("multiple-choice questions can have at most")) return true;
    if (msg.includes("multiple-choice questions can have at most")) return true;
    if (msg.includes("options must be answer text")) return true;
    if (msg.includes("Response is not an array")) return true;
    if (msg.includes("Response is not a JSON array")) return true;
    if (msg.includes("connected needs")) return true;
    if (msg.includes("connected passage")) return true;
    if (/Passage \d+:/.test(msg)) return true;
    if (msg.includes("missing a non-empty questions array")) return true;
    if (msg.includes("combined response")) return true;
    return false;
};

const validateSimpleMcqQuestions = (questions) => {
    if (!Array.isArray(questions)) {
        throw new Error("Response is not an array");
    }

    return questions.map((q, index) => {
        const requiredFields = [
            "questionText",
            "optionA",
            "optionB",
            "optionC",
            "optionD",
            "answer",
            "explanation",
        ];
        const missingFields = requiredFields.filter((field) => !q[field]);

        if (missingFields.length > 0) {
            throw new Error(
                `Question ${index + 1} is missing fields: ${missingFields.join(", ")}`
            );
        }

        const validAnswers = ["A", "B", "C", "D"];
        if (!validAnswers.includes(q.answer.toUpperCase())) {
            throw new Error(
                `Question ${index + 1} has invalid answer: ${q.answer}. Must be A, B, C, or D`
            );
        }

        return {
            questionText: q.questionText.trim(),
            optionA: q.optionA.trim(),
            optionB: q.optionB.trim(),
            optionC: q.optionC.trim(),
            optionD: q.optionD.trim(),
            answer: q.answer.toUpperCase(),
            explanation: q.explanation.trim(),
        };
    });
};

/**
 * Parse and validate the AI-generated questions (legacy string input)
 */
const parseAndValidateQuestions = (jsonString) => {
    try {
        const questions = JSON.parse(jsonString);
        return validateSimpleMcqQuestions(questions);
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, `Failed to parse AI response: ${error.message}`);
    }
};

const callGeminiWithRetries = async (generateOnce) => {
    let lastError;
    for (let attempt = 1; attempt <= GEMINI_QB_MAX_ATTEMPTS; attempt++) {
        try {
            const startTime = Date.now();
            const result = await generateOnce();
            const elapsed = Date.now() - startTime;

            // Alert if slow (approaching timeout threshold)
            if (elapsed > 70_000) {
                console.warn(
                    `[gemini] slow response: ${elapsed}ms (timeout: ${GEMINI_REQUEST_TIMEOUT_MS}ms) — consider increasing GEMINI_REQUEST_TIMEOUT_MS`
                );
            }

            if (process.env.DEBUG_QB_TIMING) {
                console.log(`[gemini] call completed in ${elapsed}ms (attempt ${attempt})`);
            }

            return result;
        } catch (error) {
            lastError = error;
            if (
                attempt < GEMINI_QB_MAX_ATTEMPTS &&
                isRetryableQuestionBankError(error)
            ) {
                const delayMs = getGeminiRetryDelayMs(error, attempt);
                console.warn(
                    `[gemini] attempt ${attempt}/${GEMINI_QB_MAX_ATTEMPTS} failed — retrying in ${delayMs}ms:`,
                    collectErrorText(error).slice(0, 200)
                );
                await sleep(delayMs);
                continue;
            }
            throw toGeminiQuestionBankError(error);
        }
    }
    throw toGeminiQuestionBankError(lastError);
};

/**
 * Generate questions using Gemini AI
 */
const QUESTION_BANK_TYPES = {
    single: "single",
    multiple: "multiple",
    true_false: "true_false",
    connected: "connected",
};

/** Strip leading A)/A./(A) style labels — UI adds letters separately */
const stripOptionLetterPrefix = (text) => {
    let s = String(text ?? "").trim();
    s = s.replace(/^\(?\s*([A-Da-d]|[1-4])\s*\)?\s*[\.\):\-]\s*/u, "");
    return s.trim();
};

/** Remove markdown/backticks from AI text fields */
const stripMarkdownNoise = (text) => {
    return String(text ?? "")
        .replace(/`/g, "")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
};

const formatExcludeBlock = (excludeQuestionTexts = []) => {
    const MAX_ITEM = 480;
    const list = (excludeQuestionTexts || [])
        .map((t) => String(t).trim())
        .filter((t) => t.length >= 3)
        .map((t) =>
            t.length > MAX_ITEM ? `${t.slice(0, MAX_ITEM - 1)}…` : t
        )
        .slice(0, 100);
    if (!list.length) return "";
    const numbered = list
        .map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`)
        .join("\n");
    return `

**ALREADY SHOWN TO THE USER (do NOT repeat or paraphrase):**
The user has already seen these ${list.length} question(s) in a previous batch. You MUST generate completely different questions — new concepts, different wording, different numerical values if applicable.

${numbered}

`;
};

const buildQuestionBankPrompt = ({
    topic,
    bankName,
    difficulty,
    singleCount,
    multipleCount,
    trueFalseCount,
    passageCount = 0,
    passageSingleCount = 0,
    passageMultipleCount = 0,
    passageTrueFalseCount = 0,
    connectedCount = 0,
    excludeQuestionTexts = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
    topicRelevanceFeedback = null,
    generateIntent = "initial",
    maxSelectableSlots = 0,
    examReferenceBlock = "",
    competitiveExamPlan = null,
    tierSlotOffset = 0,
    totalBatchSelectable = null,
    difficultyResolution = null,
}) => {
    const effectiveDifficulty =
        difficultyResolution?.generationDifficulty || difficulty;
    const mixOpts = mixOptionsFromResolution(difficultyResolution);
    const examNativeDifficultyBlock = buildExamNativeDifficultyAuthorityBlock({
        difficultyResolution,
    });
    const resolvedPassageCount = passageCount || connectedCount || 0;
    const passageSubPerPassage =
        passageSingleCount + passageMultipleCount + passageTrueFalseCount;
    const passageSubTotal = resolvedPassageCount * passageSubPerPassage;
    const standaloneTotal = singleCount + multipleCount + trueFalseCount;
    const total = standaloneTotal + resolvedPassageCount;
    const selectableForMix = standaloneTotal + passageSubTotal;
    const excludeBlock = formatExcludeBlock(excludeQuestionTexts);
    const isEvaluationRegen =
        generateIntent === "evaluation_regen" && topicRelevanceFeedback;
    const resolvedSubject = resolveSubjectForGeneration({
        generateIntent,
        topicRelevanceFeedback,
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });
    const examCtx = resolveExamContextForGeneration({
        competitiveExamPlan,
        bankName,
        topic,
        subject: resolvedSubject.id || subject,
        sectionName,
        categoryPaths,
    });
    const examProfile = examCtx.examProfile;
    const catSection = examCtx.catSection;

    // Passage length is decided by the planning AI (competitiveExamPlan.passageWordTarget)
    // from the exam's authentic format; only fall back to letting the writer decide.
    const plannedPassageWords =
        String(competitiveExamPlan?.passageWordTarget || "").trim() || null;
    const passageLengthInstruction = plannedPassageWords
        ? `**${plannedPassageWords} words** (as planned for this exam — match this length; do NOT write a shorter paragraph)`
        : `a length you determine from the authentic format of a real ${examProfile} paper for this section — reading-comprehension exams (CLAT, CAT VARC, UPSC, banking RC) use long multi-paragraph passages, so do NOT write a short paragraph`;

    // Full-paper / combined generation bypasses solve-first's per-slot archetype
    // steering, so it must carry the theory/direct/multi_concept composition here
    // — otherwise the planned split is ignored and the model drifts to numeric.
    const kindCounts =
        standaloneTotal > 0
            ? getKindCompositionCounts({
                  examProfile,
                  subject: resolvedSubject.id || subject,
                  catSection,
                  count: standaloneTotal,
              })
            : null;
    const kindMixBlock = kindCounts
        ? `\n**QUESTION-STYLE COMPOSITION (MANDATORY — match this split across the ${standaloneTotal} standalone question(s), spread over different topics):**
- **${kindCounts.theory} theory** — purely conceptual/qualitative (assertion–reason, statement-correctness, mechanism/definition discrimination). NO numeric givens, NO calculation, NO solve steps.
- **${kindCounts.direct} direct** — one clean single-formula / single-concept item solved in ~1–2 steps.
- **${kindCounts.multi_concept} multi-concept** — two or more fused concepts, multi-step reasoning.
Do NOT convert theory items into calculations, and do NOT inject numeric variables from other subjects. A theory-heavy subject (Biology, GK, Law, English, History) must stay overwhelmingly conceptual.\n`
        : "";
    const regenEscalationBlock = isEvaluationRegen
        ? buildRegenerationEscalationBlock({
              topic,
              bankName,
              sectionName,
              categoryPaths,
              examProfile,
              topicRelevanceFeedback,
              maxSelectableSlots,
          })
        : "";
    const initialQualityGatesBlock = !isEvaluationRegen
        ? buildRegenerationQualityGatesBlock({
              topic,
              bankName,
              examProfile,
              maxSelectableSlots,
              generateIntent: "initial",
          })
        : "";
    const generationCorrectnessMandatesBlock = !isEvaluationRegen
        ? buildGenerationCorrectnessMandatesBlock({ examProfile })
        : "";
    const automatedAuditorDefectsBlock = buildAutomatedAuditorDefectsBlock({
        examProfile,
    });
    const explanationOptionLockBlock = buildExplanationOptionLockBlock({
        examProfile,
    });
    const relevanceFeedbackBlock = isEvaluationRegen
        ? ""
        : formatTopicRelevanceFeedbackBlock(topicRelevanceFeedback);
    const subjectBlock = buildSubjectScopeBlockForGeneration({
        generateIntent,
        topicRelevanceFeedback,
        resolvedSubject,
        topic,
        bankName,
        categoryPaths,
        examProfile,
    });
    const difficultyMixBlock = buildDifficultyMixGenerationBlock({
        bankDifficulty: effectiveDifficulty,
        batchSize: selectableForMix || total,
        examProfile,
        examCalibrated: difficultyResolution?.examCalibrated || false,
    });
    const batchSelectableTotal =
        totalBatchSelectable != null
            ? totalBatchSelectable
            : selectableForMix || total;
    const fullTierSlots = buildDifficultyTierSlots(
        batchSelectableTotal,
        effectiveDifficulty,
        mixOpts
    );
    const chunkTierSlots = fullTierSlots.slice(
        tierSlotOffset,
        tierSlotOffset + (selectableForMix || total)
    );
    const bankDifficultyProfileBlock = buildBankDifficultyProfileBlock({
        bankDifficulty: effectiveDifficulty,
        examProfile,
    });
    const assignedTierSlotsBlock = buildAssignedTierSlotsBlock({
        tierSlots: chunkTierSlots,
        examProfile,
        slotOffset: tierSlotOffset,
    });
    const calibration = isEvaluationRegen
        ? ""
        : buildDifficultyCalibrationBlock({
              bankName,
              topic,
              subject: resolvedSubject.id || "",
              difficulty: effectiveDifficulty,
              batchSize: selectableForMix || standaloneTotal,
              mode: "text",
              categoryPaths,
              sectionName,
              catSection,
          });
    const examContextBlock = !isEvaluationRegen
        ? buildExamGenerationContextBlock({
              examProfile,
              topic,
              bankName,
              sectionName,
              categoryPaths,
              resolvedSubject,
              difficulty: effectiveDifficulty,
              catSection,
              batchSize: selectableForMix || total,
          })
        : "";
    const examAuthoringBlock = isEvaluationRegen
        ? ""
        : buildExamAuthoringBlock({ examProfile });
    const examToughnessBlock = isEvaluationRegen
        ? ""
        : buildExamToughnessBlock({
              examProfile,
              batchSize: standaloneTotal || total,
              difficulty: effectiveDifficulty,
              catSection,
          });
    const examAnswerKeyLockBlock = buildExamAnswerKeyLockBlock();
    const examDifficultyFloorBlock = buildExamDifficultyFloorBlock({
        examProfile,
        difficulty: effectiveDifficulty,
        catSection,
    });
    const examSolveThenWriteBlock = buildExamSolveThenWriteBlock();
    const isMultiSubjectPlan =
        Array.isArray(competitiveExamPlan?.subjects) &&
        competitiveExamPlan.subjects.length > 1;
    const usePcmAuthoringBlock =
        isMultiSubjectPlan ||
        isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName });
    const pcmAuthoringBlock =
        !isEvaluationRegen &&
        (isMultiSubjectPlan ||
            isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName }))
            ? buildPcmAuthoringBlock({ examProfile })
            : "";
    const mathematicsDifficultyBlock =
        !usePcmAuthoringBlock &&
        !isMultiSubjectPlan &&
        isMathematicsGenerationSubject({
            resolvedSubject,
            topic,
            bankName,
            categoryPaths,
            sectionName,
        })
            ? buildMathematicsDifficultyBlock({ examProfile, difficulty })
            : "";
    const physicsNumericalBlock =
        !usePcmAuthoringBlock &&
        !isMultiSubjectPlan &&
        isPhysicsGenerationSubject({
            resolvedSubject,
            topic,
            bankName,
            categoryPaths,
            sectionName,
        })
            ? buildPhysicsNumericalAuthoringBlock({ examProfile })
            : "";
    const chemistryNumericalBlock =
        !usePcmAuthoringBlock &&
        !isMultiSubjectPlan &&
        isChemistryGenerationSubject({
            resolvedSubject,
            topic,
            bankName,
            categoryPaths,
            sectionName,
        })
            ? buildChemistryNumericalAuthoringBlock({ examProfile })
            : "";
    const catSectionAuthoringBlock = buildCatSectionAuthoringBlock({
        catSection,
        passageCount: resolvedPassageCount,
        singleCount,
        passageSingleCount,
    });
    const competitivePlanBlock = competitiveExamPlan
        ? buildCompetitiveExamPlanGenerationBlock(competitiveExamPlan)
        : "";
    const jeeFullPaperBlock =
        !isEvaluationRegen &&
        !competitiveExamPlan &&
        (examProfile === "jee_main" || examProfile === "jee_advanced") &&
        (examCtx.isFullPaper ||
            isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName }))
            ? buildJeeFullPaperMixBlock({
                  examProfile,
                  difficulty,
                  batchSize: standaloneTotal || total,
              })
            : "";
    const jeeAuthenticityBlock =
        !isEvaluationRegen &&
        (examProfile === "jee_main" || examProfile === "jee_advanced")
            ? buildJeeAuthenticityGenerationBlock({
                  examProfile,
                  difficulty,
                  batchSize: standaloneTotal || total,
                  sectionName,
                  paperNumber: competitiveExamPlan?.paperNumber ?? null,
              })
            : "";
    const hardMandateBlock = isEvaluationRegen
        ? ""
        : buildHardQuestionMandateBlock({
              examProfile,
              tier: effectiveDifficulty,
              examCalibrated: difficultyResolution?.examCalibrated || false,
          });
    const jeePatternFromPlanBlock =
        !isEvaluationRegen &&
        competitiveExamPlan &&
        (examProfile === "jee_main" || examProfile === "jee_advanced")
            ? buildJeeExamPatternFromPlanBlock(competitiveExamPlan)
            : "";
    const exampleNote = getFormatOnlyExampleNote(examProfile, catSection);
    const syllabusFocusRaw = getGenerationTopicFocus({ topic, sectionName, bankName });
    const syllabusFocus =
        competitiveExamPlan?.topicScope ||
        resolveExamTopicScope({
            topicScope: "",
            topic,
            bankName,
            sectionName,
            categoryPaths,
            examProfile,
            catSection,
            subjects: competitiveExamPlan?.subjects || [],
        }) ||
        syllabusFocusRaw ||
        topic;
    const formatExample = {
        questionType: "single",
        difficultyTier: "hard",
        questionText:
            "Sample stem with exam-appropriate setup and constraints — replace with a real question for this topic.",
        options: ["Option A text", "Option B text", "Option C text", "Option D text"],
        correctAnswer: "B",
        explanation:
            "Concise proof showing why option B is correct — same conclusion as correctAnswer.",
    };
    const correctnessFirstBlock = buildCorrectnessFirstGenerationBlock({
        examProfile,
        catSection,
    });
    const preOutputCorrectnessChecklist = buildPreOutputCorrectnessChecklist({
        examProfile,
    });
    const postSolveSelfCheckBlock = buildPostSolveSelfCheckBlock();
    const compactPrompts =
        process.env.AI_QB_COMPACT_PROMPTS === "1" ||
        process.env.AI_QB_COMPACT_PROMPTS === "true";
    if (compactPrompts) {
        return `You are an expert educator creating exam questions for an Indian competitive-education platform.
${correctnessFirstBlock}
${generationCorrectnessMandatesBlock}
${explanationOptionLockBlock}
${examNativeDifficultyBlock}
${postSolveSelfCheckBlock}
Generate exactly ${total} top-level items for a question bank with these specifications:

**Question bank name:** ${bankName}
**Topic / syllabus focus (AUTHORITATIVE):** ${syllabusFocus || topic}
**Bank difficulty profile:** ${effectiveDifficulty}${difficultyResolution?.examCalibrated ? " (exam-native — all questions hard)" : ""}
${difficultyMixBlock}
${assignedTierSlotsBlock}
${subjectBlock}
${examReferenceBlock}
${competitivePlanBlock}
${hardMandateBlock}
${excludeBlock}
**Standalone counts:** single=${singleCount}, multiple=${multipleCount}, true_false=${trueFalseCount}
**Passages:** ${resolvedPassageCount} (per-passage: single=${passageSingleCount}, multiple=${passageMultipleCount}, true_false=${passageTrueFalseCount})
${kindMixBlock}
Return ONLY a valid JSON array. Each item needs questionType, difficultyTier, questionText, options, correctAnswer, explanation.
End every explanation with FINAL_ANSWER: <letter(s)>.
${preOutputCorrectnessChecklist}
${examAnswerKeyLockBlock}
${exampleNote}
Generate exactly ${singleCount} standalone single, ${multipleCount} standalone multiple, ${trueFalseCount} standalone true_false, and ${resolvedPassageCount} connected passage item(s). Return ONLY the JSON array.`;
    }
    return `You are an expert educator creating exam questions for an Indian competitive-education platform.
${correctnessFirstBlock}
${generationCorrectnessMandatesBlock}
${automatedAuditorDefectsBlock}
${explanationOptionLockBlock}
${examNativeDifficultyBlock}
${postSolveSelfCheckBlock}
${regenEscalationBlock}
${initialQualityGatesBlock}
Generate exactly ${total} top-level items for a question bank with these specifications:

**Question bank name:** ${bankName}
**Topic / syllabus focus (AUTHORITATIVE — generate for this, not the category path):** ${syllabusFocus || topic}
**Bank difficulty profile:** ${effectiveDifficulty}${difficultyResolution?.examCalibrated ? " (exam-native — all questions hard; UI difficulty ignored)" : " (controls per-question tier mix below — NOT one uniform tier for all items)"}
${difficultyMixBlock}
${bankDifficultyProfileBlock}
${assignedTierSlotsBlock}
${subjectBlock}
${examContextBlock}
${examReferenceBlock}
${examAuthoringBlock}
${catSectionAuthoringBlock}
${examDifficultyFloorBlock}
${examSolveThenWriteBlock}
${pcmAuthoringBlock}
${mathematicsDifficultyBlock}
${physicsNumericalBlock}
${chemistryNumericalBlock}
${competitivePlanBlock}
${jeePatternFromPlanBlock}
${jeeFullPaperBlock}
${jeeAuthenticityBlock}
${hardMandateBlock}
${examToughnessBlock}
${calibration}
**Standalone questions (NOT based on any reading passage):**
- Single correct (one answer): ${singleCount}
- Multiple correct (two or more answers): ${multipleCount}
- True/False: ${trueFalseCount}
${kindMixBlock}
**Reading passages (passage-based questions only):**
- Number of separate reading passages: ${resolvedPassageCount}
- EACH passage must include exactly this mix of sub-questions (every passage gets the same types and counts — do NOT split types across passages):
  - Single answer (per passage): ${passageSingleCount}
  - Multiple correct (per passage): ${passageMultipleCount}
  - True/False (per passage): ${passageTrueFalseCount}
- Total passage sub-questions across all passages: ${passageSubTotal} (${resolvedPassageCount} passage(s) × ${passageSubPerPassage} question(s) each)
${relevanceFeedbackBlock}${excludeBlock}
**CRITICAL INSTRUCTIONS:**
1. Return ONLY a valid JSON array — no markdown, no code fences, no extra text.
2. Each standalone item must include: questionType, difficultyTier, questionText, options, correctAnswer, explanation. Each passage sub-question must include difficultyTier.
3. questionType must be exactly one of: "single", "multiple", "true_false", "connected".
4. For "single": exactly 4 options; correctAnswer is one letter "A", "B", "C", or "D".
5. For "multiple": exactly 4 options; correctAnswer is an array of EXACTLY 2 letters, e.g. ["A","C"]. Never mark 3 or all 4 options correct — a multiple-correct question always has exactly 2 right answers and 2 wrong ones.
5. For "multiple": exactly 4 options; correctAnswer is an array of EXACTLY 2 letters, e.g. ["A","C"]. Never mark 3 or all 4 options correct — a multiple-correct question always has exactly 2 right answers and 2 wrong ones.
6. For "true_false": options must be ["True", "False"]; correctAnswer is "True" or "False".
7. For "connected" (reading passage): include title (short label), passage (reading paragraph — ${passageLengthInstruction}), and subQuestions array with exactly ${passageSubPerPassage} sub-question(s) per passage (${passageSingleCount} single, ${passageMultipleCount} multiple, ${passageTrueFalseCount} true_false in EACH passage). Sub-questions must use only types single, multiple, or true_false. Each sub-question must be answerable ONLY from its passage. Do NOT repeat standalone questions as passage sub-questions. Do NOT put all singles in passage 1 and all true/false in passage 2 — every passage must follow the per-passage mix above.
8. Every standalone question and every passage sub-question MUST have a clear explanation (minimum one sentence).
9. Items must be unique within this response AND must not duplicate or closely paraphrase any question listed under "ALREADY SHOWN TO THE USER" above.
10. Every question MUST match its assigned difficultyTier from the DIFFICULTY MIX block and satisfy the calibration above. Never output chapter-test, homework, or trivial one-step items at any tier — if a draft feels too easy for its tier, rewrite harder before output.
11. **Correctness gate:** Every item must pass solve-then-write and answer-key-lock checks — computed answer in one option, correctAnswer matches, explanation derives the same value, four distinct options, no draft meta-text. Discard and replace any failing draft; never return knowingly broken questions.
12. Use Indian curriculum context where relevant (CBSE, JEE, NEET, etc.) when the topic fits.
${isEvaluationRegen ? `13. **REGEN ONLY:** Every returned question must pass the REGENERATION QUALITY GATES above — if any draft would keep the set below ${REGEN_TARGET_SCORE}/100 topic alignment, replace it before output.\n` : `13. **Every returned question must pass the GENERATION QUALITY GATES and CORRECTNESS MANDATES above** — if any draft would fail the automated factual auditor, replace it before output.\n`}

**FORMATTING RULES (mandatory):**
${isEvaluationRegen ? "14" : "14"}. questionText, passage, title, and explanation: plain text only — NO backticks, NO markdown.
${isEvaluationRegen ? "15" : "15"}. options[] values are ANSWER TEXT ONLY — do NOT prefix with "A)", "B.", "(C)", or similar.
${isEvaluationRegen ? "16" : "16"}. For "multiple": questionText MUST include "Select all that apply". At least ONE option must be incorrect.
${isEvaluationRegen ? "17" : "17"}. For "true_false": options must be exactly ["True", "False"].
${isEvaluationRegen ? "18" : "18"}. **Valid JSON only:** no LaTeX or backslashes in text fields; use Unicode for math (°, ², ×, ≈). No raw line breaks inside strings — use spaces. Never use the double-quote character inside string values.
${isEvaluationRegen ? "19" : "19"}. **explanation:** maximum 3 sentences and 500 characters — concise key steps only, not a full textbook solution. Must end at the same value as the marked option; no meta-commentary about fixing or re-checking.

${preOutputCorrectnessChecklist}
${examAnswerKeyLockBlock}
${exampleNote}
**Required JSON format (example structure only):**
[
  ${JSON.stringify(formatExample, null, 2).split("\n").join("\n  ")},
  {
    "questionType": "connected",
    "title": "Reading: Photosynthesis",
    "passage": "Plants convert light energy into chemical energy through photosynthesis. Chlorophyll in leaves absorbs sunlight...",
    "subQuestions": [
      {
        "questionType": "single",
        "difficultyTier": "medium",
        "questionText": "According to the passage, where does photosynthesis primarily occur?",
        "options": ["Roots", "Leaves", "Stem", "Flowers"],
        "correctAnswer": "B",
        "explanation": "The passage states chlorophyll in leaves absorbs sunlight."
      },
      {
        "questionType": "true_false",
        "questionText": "Photosynthesis converts chemical energy into light energy.",
        "options": ["True", "False"],
        "correctAnswer": "False",
        "explanation": "The passage says light energy is converted into chemical energy, not the reverse."
      }
    ]
  }
]

Generate exactly ${singleCount} standalone single, ${multipleCount} standalone multiple, ${trueFalseCount} standalone true_false, and ${resolvedPassageCount} connected passage item(s). Each passage must have exactly ${passageSingleCount} single, ${passageMultipleCount} multiple, and ${passageTrueFalseCount} true_false sub-questions (${passageSubTotal} passage sub-questions in total). Return ONLY the JSON array.`;
};

const buildQuestionBankCountOnlyPrompt = ({
    topic,
    bankName,
    difficulty,
    categoryPaths = [],
    sectionName = "",
    subject = "",
    topicRelevanceFeedback = null,
    generateIntent = "initial",
    maxApiItems,
    maxSelectableSlots = 10,
    examProfile,
    catSection,
    resolvedSubject,
}) => {
    const isEvaluationRegen =
        generateIntent === "evaluation_regen" && topicRelevanceFeedback;
    const relevanceFeedbackBlock = isEvaluationRegen
        ? ""
        : formatTopicRelevanceFeedbackBlock(topicRelevanceFeedback);
    const subjectBlock = buildSubjectScopeBlockForGeneration({
        generateIntent,
        topicRelevanceFeedback,
        resolvedSubject,
        topic,
        bankName,
        categoryPaths,
        examProfile,
    });
    const calibration = buildDifficultyCalibrationBlock({
        bankName,
        topic,
        subject: resolvedSubject.id || "",
        difficulty,
        batchSize: maxApiItems,
        mode: "text",
        categoryPaths,
        sectionName,
    });
    const countGuidance = buildCountPlanGuidanceBlock({
        topic,
        bankName,
        difficulty,
        sectionName,
        subject: resolvedSubject.label || subject,
        categoryPaths,
        examProfile,
        catSection,
        maxApiItems,
        maxSelectableSlots,
    });
    const syllabusFocus =
        resolveExamTopicScope({
            topicScope: "",
            topic,
            bankName,
            sectionName,
            categoryPaths,
            examProfile,
            catSection,
            subjects: [],
        }) ||
        getGenerationTopicFocus({ topic, sectionName, bankName }) ||
        topic;

    return `You are an expert educator planning question batches for an Indian competitive-education platform.

${countGuidance}

**Question bank name:** ${bankName}
**Topic / syllabus focus (AUTHORITATIVE):** ${syllabusFocus}
**Difficulty:** ${difficulty}
${subjectBlock}
${calibration}
${relevanceFeedbackBlock}

**YOUR TASK:** Decide ONLY how many questions to generate — do NOT write any question text.

Return ONLY valid JSON (no markdown):
{
  "plan": {
    "singleCount": 0,
    "multipleCount": 0,
    "trueFalseCount": 0,
    "passageCount": 0,
    "passageSingleCount": 0,
    "passageMultipleCount": 0,
    "passageTrueFalseCount": 0,
    "rationale": "One short sentence why this count fits the topic and exam"
  }
}

**PLAN RULES:**
- Decide HOW MANY questions only. Standalone questions are always single-choice (multipleCount=0, trueFalseCount=0).
- Passages only if the topic needs reading comprehension; passage sub-questions are single-choice only.
- Selectable total (standalone + passageCount × passage sub-questions) must match the slot target in COUNT PLANNING.`;
};

/** Thrown for a single malformed AI question that should be dropped from the
 * batch rather than failing the whole generation (e.g. a "multiple" question
 * with the wrong correct-answer count). Callers that process a batch of
 * questions should catch this and skip just that item; callers parsing a
 * single question (nothing to fall back to) let it propagate as before. */
class DroppableQuestionError extends Error {
    constructor(message) {
        super(message);
        this.name = "DroppableQuestionError";
        this.droppable = true;
    }
}

/**
 * Was silently returning 0 (option A) for anything that wasn't an exact "A"/"B"/"C"/"D" —
 * so a repair or generation response that answered "Option C", "(C)", "C." or the answer
 * TEXT instead of a bare letter got its correctAnswer silently rewritten to option A. That
 * is a silent wrong-key bug indistinguishable from a correct one downstream: the exact
 * "correct answer doesn't match its option" defect reported from recent papers. Now
 * extracts a standalone A–D letter if one is embedded, and signals -1 (unresolved) instead
 * of guessing, so the caller can fall back to matching correctAnswer against option TEXT.
 */
const letterToIndex = (letter) => {
    const raw = String(letter || "").trim().toUpperCase();
    if (["A", "B", "C", "D"].includes(raw)) return raw.charCodeAt(0) - 65;
    // Recover from light wrapping ("Option C", "(C)", "C)", "C.", "Answer: C") — but
    // require the letter to be an ISOLATED token, not the first character of arbitrary
    // answer text (e.g. a text-type correctAnswer of "Diamond" must NOT resolve to "D").
    const m = raw.match(/(?:^|[\s(])([A-D])(?:[).:\s]|$)/);
    return m ? m[1].charCodeAt(0) - 65 : -1;
};

const normalizeOptionsArray = (options, questionType) => {
    if (questionType === QUESTION_BANK_TYPES.true_false) {
        const a = stripOptionLetterPrefix(options?.[0] || "True");
        const b = stripOptionLetterPrefix(options?.[1] || "False");
        return [a || "True", b || "False", "", ""];
    }
    const list = Array.isArray(options)
        ? options.map((o) => stripOptionLetterPrefix(stripMarkdownNoise(o)))
        : [];
    while (list.length < 4) list.push("");
    return list.slice(0, 4);
};

const parseQuestionBankAIItem = (q, index, labelPrefix = null) => {
    const label = labelPrefix || `Question ${index + 1}`;
    const questionType = QUESTION_BANK_TYPES[q.questionType]
        ? q.questionType
        : "single";

    if (!q.questionText || !String(q.questionText).trim()) {
        throw new Error(`${label}: questionText is required`);
    }
    if (!q.explanation || !String(q.explanation).trim()) {
        throw new Error(`${label}: explanation is required`);
    }

    const questionText = stripMarkdownNoise(q.questionText);
    const explanation = stripMarkdownNoise(q.explanation);

    const options = normalizeOptionsArray(q.options, questionType);
    let correctIndex = 0;
    let multipleCorrectIndexes = [];

    if (questionType === "multiple") {
        const letters = Array.isArray(q.correctAnswer)
            ? q.correctAnswer
            : String(q.correctAnswer || "")
                  .split(/[,;]/)
                  .map((x) => x.trim())
                  .filter(Boolean);
        multipleCorrectIndexes = [
            ...new Set(letters.map(letterToIndex).filter((i) => i >= 0 && i <= 3)),
        ];
        if (multipleCorrectIndexes.length < 2) {
            throw new DroppableQuestionError(
                `${label}: multiple-choice needs at least 2 correct answers`
            );
        }
        if (multipleCorrectIndexes.length > 2) {
            throw new DroppableQuestionError(
                `${label}: multiple-choice questions can have at most 2 correct answers (found ${multipleCorrectIndexes.length})`
            );
        }
        correctIndex = multipleCorrectIndexes[0];
    } else if (questionType === "true_false") {
        const ans = String(q.correctAnswer ?? "").trim().toLowerCase();
        correctIndex =
            ans === "true" || ans === "t" || ans === "1" || options[0].toLowerCase() === ans
                ? 0
                : 1;
        multipleCorrectIndexes = [];
    } else {
        const letter = Array.isArray(q.correctAnswer)
            ? q.correctAnswer[0]
            : q.correctAnswer;
        correctIndex = letterToIndex(letter);
        if (correctIndex < 0) {
            // correctAnswer wasn't a resolvable A-D letter — the LLM answered with the
            // option TEXT itself or an unrecognized format. Try matching it against the
            // actual option text before giving up, rather than silently defaulting to A.
            const target = String(letter || "").trim().toLowerCase();
            correctIndex = options.findIndex(
                (o) => String(o || "").trim().toLowerCase() === target
            );
        }
        if (correctIndex < 0) {
            // Same drop-not-guess handling as the multi-correct-count case below —
            // an unresolvable key means this one item is malformed, not the whole batch.
            throw new DroppableQuestionError(
                `${label}: correctAnswer "${String(letter || "")}" is not a valid option letter or matching option text`
            );
        }
        multipleCorrectIndexes = [];
    }

    let finalQuestionText = questionText;
    if (
        questionType === "multiple" &&
        !/select all that apply/i.test(finalQuestionText)
    ) {
        finalQuestionText = finalQuestionText.replace(/\?+\s*$/, "").trim();
        finalQuestionText = `${finalQuestionText}? Select all that apply.`;
    }

    if (questionType === "single" || questionType === "multiple") {
        const placeholderOnly = options.every((o) => /^[A-D]$/i.test(String(o).trim()));
        if (placeholderOnly) {
            throw new Error(
                `${label}: options must be answer text, not bare letters A–D`
            );
        }
    }

    const tier = normalizeQuestionTier(q.difficultyTier || q.difficulty);

    const built = {
        questionType,
        questionText: finalQuestionText,
        options,
        correctIndex,
        multipleCorrectIndexes,
        explanation,
        ...(tier ? { difficulty: tier } : {}),
        ...(Array.isArray(q._solveSteps) ? { _solveSteps: q._solveSteps } : {}),
        ...(Array.isArray(q.solveSteps) ? { _solveSteps: q.solveSteps } : {}),
        ...(q._conceptSlot || q.conceptSlot
            ? { _conceptSlot: q._conceptSlot || q.conceptSlot }
            : {}),
        ...(q._questionKind || q.questionKind
            ? { _questionKind: q._questionKind || q.questionKind }
            : {}),
    };
    return built;
};

const parseConnectedAIItem = (q, index) => {
    const label = `Question ${index + 1}`;
    const passage = stripMarkdownNoise(
        q.passage || q.paragraph || q.readingText || ""
    );
    if (!passage) {
        throw new Error(`${label}: connected passage is required`);
    }

    const title = stripMarkdownNoise(
        q.title || q.questionText || `Reading set ${index + 1}`
    );
    const subs = q.subQuestions || q.connectedQuestions || [];
    if (!Array.isArray(subs) || subs.length < 1) {
        throw new Error(`${label}: connected needs at least 1 sub-question`);
    }
    if (subs.length > 5) {
        throw new Error(`${label}: connected cannot have more than 5 sub-questions`);
    }

    const subQuestions = subs.map((sub, si) =>
        parseQuestionBankAIItem(sub, index, `${label}, sub-question ${si + 1}`)
    );

    return {
        questionType: "connected",
        title,
        passage,
        subQuestions,
    };
};

const parseQuestionBankAIItems = (questions, expectedCounts) => {
    if (!Array.isArray(questions)) {
        throw new ApiError(500, "AI returned invalid questions array");
    }

    const expectedTotal =
        expectedCounts.singleCount +
        expectedCounts.multipleCount +
        expectedCounts.trueFalseCount +
        (expectedCounts.passageCount || expectedCounts.connectedCount || 0);

    if (questions.length !== expectedTotal) {
        throw new ApiError(
            500,
            `AI returned ${questions.length} questions but ${expectedTotal} were requested`
        );
    }

    const typeCounts = { single: 0, multiple: 0, true_false: 0, connected: 0 };
    const passageSubCounts = { single: 0, multiple: 0, true_false: 0 };
    const connectedItems = [];
    const droppedItems = [];
    const parsed = [];
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        try {
            if (q.questionType === "connected") {
                const item = parseConnectedAIItem(q, i);
                typeCounts.connected += 1;
                connectedItems.push(item);
                for (const sub of item.subQuestions || []) {
                    const st = sub.questionType || "single";
                    if (passageSubCounts[st] !== undefined) {
                        passageSubCounts[st] += 1;
                    }
                }
                parsed.push(item);
                continue;
            }
            const item = parseQuestionBankAIItem(q, i);
            typeCounts[item.questionType] += 1;
            parsed.push(item);
        } catch (err) {
            if (err instanceof DroppableQuestionError) {
                droppedItems.push({ index: i + 1, error: err.message });
                pipelineTrace("QUESTION_DROPPED_MALFORMED", {
                    index: i + 1,
                    error: err.message,
                });
                continue;
            }
            throw err;
        }
    }

    // "multiple" questions with a bad correct-answer count are dropped, not
    // repaired — an undercount here is expected and fine (partial results
    // are allowed everywhere else in this pipeline), only an overcount would
    // signal a real bug.
    const multipleDroppedCount = droppedItems.length;
    if (typeCounts.multiple > expectedCounts.multipleCount) {
        throw new ApiError(
            500,
            `Expected ${expectedCounts.multipleCount} multiple questions, got ${typeCounts.multiple}`
        );
    }
    let multipleDeficit = 0;
    if (typeCounts.multiple < expectedCounts.multipleCount && multipleDroppedCount > 0) {
        multipleDeficit = expectedCounts.multipleCount - typeCounts.multiple;
        pipelineTrace("QUESTION_BANK_MULTIPLE_UNDERCOUNT", {
            expected: expectedCounts.multipleCount,
            got: typeCounts.multiple,
            droppedCount: multipleDroppedCount,
        });
    } else if (typeCounts.multiple !== expectedCounts.multipleCount) {
        throw new ApiError(
            500,
            `Expected ${expectedCounts.multipleCount} multiple questions, got ${typeCounts.multiple}`
        );
    }

    if (typeCounts.single !== expectedCounts.singleCount) {
        throw new ApiError(
            500,
            `Expected ${expectedCounts.singleCount} single questions, got ${typeCounts.single}`
        );
    }
    if (typeCounts.true_false !== expectedCounts.trueFalseCount) {
        throw new ApiError(
            500,
            `Expected ${expectedCounts.trueFalseCount} true/false questions, got ${typeCounts.true_false}`
        );
    }
    if (typeCounts.connected !== (expectedCounts.passageCount || expectedCounts.connectedCount || 0)) {
        throw new ApiError(
            500,
            `Expected ${expectedCounts.passageCount || expectedCounts.connectedCount || 0} passage sets, got ${typeCounts.connected}`
        );
    }

    const passageCount =
        expectedCounts.passageCount || expectedCounts.connectedCount || 0;
    const expectedPassageSubsPerPassage = {
        single: expectedCounts.passageSingleCount || 0,
        multiple: expectedCounts.passageMultipleCount || 0,
        true_false: expectedCounts.passageTrueFalseCount || 0,
    };
    const expectedPassageSubsTotal = {
        single: expectedPassageSubsPerPassage.single * passageCount,
        multiple: expectedPassageSubsPerPassage.multiple * passageCount,
        true_false: expectedPassageSubsPerPassage.true_false * passageCount,
    };
    const hasPassageSubExpectation =
        expectedPassageSubsPerPassage.single +
            expectedPassageSubsPerPassage.multiple +
            expectedPassageSubsPerPassage.true_false >
        0;
    if (hasPassageSubExpectation) {
        for (let pi = 0; pi < connectedItems.length; pi++) {
            const item = connectedItems[pi];
            const perItem = { single: 0, multiple: 0, true_false: 0 };
            for (const sub of item.subQuestions || []) {
                const st = sub.questionType || "single";
                if (perItem[st] !== undefined) perItem[st] += 1;
            }
            if (perItem.single !== expectedPassageSubsPerPassage.single) {
                throw new ApiError(
                    500,
                    `Passage ${pi + 1}: expected ${expectedPassageSubsPerPassage.single} single sub-question(s), got ${perItem.single}`
                );
            }
            if (perItem.multiple !== expectedPassageSubsPerPassage.multiple) {
                throw new ApiError(
                    500,
                    `Passage ${pi + 1}: expected ${expectedPassageSubsPerPassage.multiple} multiple sub-question(s), got ${perItem.multiple}`
                );
            }
            if (perItem.true_false !== expectedPassageSubsPerPassage.true_false) {
                throw new ApiError(
                    500,
                    `Passage ${pi + 1}: expected ${expectedPassageSubsPerPassage.true_false} true/false sub-question(s), got ${perItem.true_false}`
                );
            }
        }
        if (passageSubCounts.single !== expectedPassageSubsTotal.single) {
            throw new ApiError(
                500,
                `Expected ${expectedPassageSubsTotal.single} single passage sub-questions in total, got ${passageSubCounts.single}`
            );
        }
        if (passageSubCounts.multiple !== expectedPassageSubsTotal.multiple) {
            throw new ApiError(
                500,
                `Expected ${expectedPassageSubsTotal.multiple} multiple passage sub-questions in total, got ${passageSubCounts.multiple}`
            );
        }
        if (passageSubCounts.true_false !== expectedPassageSubsTotal.true_false) {
            throw new ApiError(
                500,
                `Expected ${expectedPassageSubsTotal.true_false} true/false passage sub-questions in total, got ${passageSubCounts.true_false}`
            );
        }
    }

    parsed.multipleDeficit = multipleDeficit;
    return parsed;
};

const parseQuestionBankAIResponse = (rawText, expectedCounts) => {
    const questions = parseJsonArrayFromAI(rawText);
    return parseQuestionBankAIItems(questions, expectedCounts);
};

/** Soft parse for prompt-first fill: keep valid items, ignore exact count mismatch. */
const parseQuestionBankAIResponseSoft = (rawText) => {
    const questions = parseJsonArrayFromAI(rawText);
    if (!Array.isArray(questions)) {
        throw new ApiError(500, "AI returned invalid questions array");
    }
    const parsed = [];
    for (let i = 0; i < questions.length; i++) {
        try {
            const q = questions[i];
            if (q?.questionType === "connected") {
                parsed.push(parseConnectedAIItem(q, i));
            } else {
                parsed.push(parseQuestionBankAIItem(q, i));
            }
        } catch (err) {
            pipelineTrace("PROMPT_FIRST_ITEM_PARSE_SKIP", {
                index: i + 1,
                error: err?.message || String(err),
            });
        }
    }
    return parsed;
};

const inferredPlanToExpectedCounts = (plan) => ({
    singleCount: plan.singleCount,
    multipleCount: plan.multipleCount,
    trueFalseCount: plan.trueFalseCount,
    connectedCount: plan.passageCount,
    passageCount: plan.passageCount,
    passageSingleCount: plan.passageSingleCount,
    passageMultipleCount: plan.passageMultipleCount,
    passageTrueFalseCount: plan.passageTrueFalseCount,
});

const upscaleRegenerationCountsToSlots = resolveTargetedRegenerationCounts;

const GEMINI_QB_CORRECTNESS_REPAIR_PASSES = Math.min(
    5,
    Math.max(
        0,
        Number(
            process.env.AI_QB_CORRECTNESS_REPAIR_PASSES ??
                process.env.GEMINI_QB_CORRECTNESS_REPAIR_PASSES ??
                0
        )
    )
);
const GEMINI_QB_REPAIR_BATCH_SIZE = Math.min(
    12,
    Math.max(1, Number(process.env.GEMINI_QB_REPAIR_BATCH_SIZE ?? 6))
);

const unwrapFinalizedQuestions = (result) =>
    Array.isArray(result) ? result : result?.questions || [];

const unwrapFinalizedStats = (result) =>
    Array.isArray(result) ? {} : result?.stats || {};

const questionToRepairPayload = (q) => {
    const questionType = q.questionType || "single";
    if (questionType === "multiple") {
        const letters = (q.multipleCorrectIndexes || [q.correctIndex])
            .map((i) => String.fromCharCode(65 + i));
        return {
            questionType,
            questionText: q.questionText,
            options: q.options,
            correctAnswer: letters,
            explanation: q.explanation,
        };
    }
    if (questionType === "true_false") {
        return {
            questionType,
            questionText: q.questionText,
            options: q.options?.slice(0, 2) || ["True", "False"],
            correctAnswer: q.correctIndex === 1 ? "False" : "True",
            explanation: q.explanation,
        };
    }
    const letter = String.fromCharCode(65 + (q.correctIndex ?? 0));
    return {
        questionType,
        questionText: q.questionText,
        options: q.options,
        correctAnswer: letter,
        explanation: q.explanation,
    };
};

const getQuestionAtRef = (questions, ref) => {
    if (ref?.subIndex != null) {
        return questions[ref.topIndex]?.subQuestions?.[ref.subIndex];
    }
    return questions[ref.topIndex];
};

const applyRepairedQuestions = (questions, flawedEntries, repairedRaw) => {
    const next = questions.map((q) =>
        q.questionType === "connected"
            ? { ...q, subQuestions: [...(q.subQuestions || [])] }
            : { ...q }
    );
    for (let i = 0; i < flawedEntries.length; i++) {
        const entry = flawedEntries[i];
        let parsed;
        try {
            parsed = parseQuestionBankAIItem(
                repairedRaw[i],
                entry.auditItem.sampleNumber - 1,
                `Repair Q${entry.auditItem.sampleNumber}`
            );
        } catch (err) {
            if (err instanceof DroppableQuestionError) {
                pipelineTrace("CORRECTNESS_REPAIR_DROPPED_MALFORMED", {
                    questionNumber: entry.auditItem?.sampleNumber,
                    error: err.message,
                });
                continue; // keep the original (still-flawed but structurally valid) question
            }
            throw err;
        }
        if (entry.ref.subIndex != null) {
            next[entry.ref.topIndex].subQuestions[entry.ref.subIndex] = parsed;
        } else {
            next[entry.ref.topIndex] = parsed;
        }
    }
    return next;
};

const buildQuestionBankRepairPrompt = ({
    topic,
    bankName,
    difficulty,
    flawedEntries,
    questions,
    examProfile = "competitive",
}) => {
    const itemBlocks = flawedEntries
        .map((entry, idx) => {
            const q = getQuestionAtRef(questions, entry.ref);
            const payload = questionToRepairPayload(q);
            const issueLines = [...new Set((entry.issues || []).map((i) => i.issue))]
                .slice(0, 4)
                .join("; ");
            return `
### Item ${idx + 1} (questionType: ${payload.questionType})
**Automated defects:** ${issueLines || "answer-key / explanation mismatch"}
**Draft to repair — prefer MODE A (fix the key/explanation in place):**
${JSON.stringify(payload, null, 2)}`;
        })
        .join("\n");

    return `You are repairing ${flawedEntries.length} flawed MCQ(s) for an exam question bank.

**Topic:** ${topic || bankName}
**Difficulty:** ${difficulty}

${buildCorrectnessFirstGenerationBlock({ examProfile })}
${buildGenerationCorrectnessMandatesBlock({ examProfile })}
${buildAutomatedAuditorDefectsBlock({ examProfile })}
${buildExplanationOptionLockBlock({ examProfile })}
${buildPostSolveSelfCheckBlock()}
${buildExamSolveThenWriteBlock()}
${buildExamAnswerKeyLockBlock()}
${buildPreOutputCorrectnessChecklist({ examProfile })}

**CRITICAL CONSTRAINTS FOR REPAIR (schema — enforced by validator):**
1. For \`questionType: "single"\`: \`correctAnswer\` must be exactly ONE letter (A/B/C/D).
2. For \`questionType: "multiple"\`: \`correctAnswer\` must be an array of EXACTLY 2 letters (e.g. ["A","C"]). Never 1, never 3+, never all 4.
3. For \`questionType: "true_false"\`: \`correctAnswer\` must be exactly "True" or "False".
4. Do NOT include draft/meta language (re-evaluating, actually, however, wait, correction, upon reconsideration).

**TASK — FIX FIRST, REWRITE ONLY IF YOU MUST.** Return ONLY a valid JSON array with exactly **${flawedEntries.length}** object(s), in the same order as below, each using the same questionType as its draft.

**For each item, FIRST re-solve the question yourself from its stem.** Then pick ONE mode:

**MODE A — FIX IN PLACE (strongly preferred).**
If the stem is sound and your computed answer IS one of the existing options:
- Keep \`questionText\` and \`options\` **EXACTLY as given — character for character, same order**.
- Return \`correctAnswer\` pointing at the option that matches your solve.
- Return a rewritten \`explanation\` that derives **exactly that option**.
Most defects here are key/explanation faults on an otherwise good question — a wrong
answer key, an explanation that contradicts the key, or an explanation that self-corrects.
Those do **not** justify throwing the question away. Fix them.

**MODE B — REWRITE (only when MODE A is impossible).**
Only if the item cannot be made correct without changing the stem or options — i.e. your
computed answer is **not among the options**, the options are duplicated/indistinguishable,
or the stem is ambiguous or missing data. Then write a NEW question on the same syllabus
concept, with a new stem and four distinct options.

Either way the returned object must pass every factual gate (solve → option match →
correctAnswer → explanation lock → distinct options). The factual auditor will reject wrong
keys, explanation mismatches, missing computed values in options, and duplicate options.

**Common defects you MUST fix (do not repeat these patterns):**
- Explanation derives **4.926 atm** but options list **926 atm** — include the full decimal value with unit in exactly one option.
- All four options identical (e.g. all "1") or all start with "0" — write four **distinct** plausible values.
- Ratio/orbit questions: if explanation gives **4:1**, options must include **4:1** (or equivalent) and correctAnswer must point to it.
- pH/Ka/de Broglie: use proper decimals and scientific notation (1.0 × 10⁻⁵), never bare integers or \`0 x 10^-6\`.
- Bond order / MO theory: if explanation computes **2.5**, one option must say **2.5** — not a different integer.
- Mixing molarity: explanation **6 M** but options **0.32 M** — use total moles ÷ total volume (L).
- pH buffer: invalid option **347** — pH must be **0–14**.
- Arrhenius two-T: explanation ends at intermediate **1.0705** but options are times in seconds — final **time** must be in one option.

${itemBlocks}

**Output rules:** JSON array only — no markdown. options[] = answer text only (no A)/B. prefixes). explanation max 3 sentences, must match correctAnswer. **In MODE A, \`options\` must be byte-identical to the draft's options and \`questionText\` unchanged** — only \`correctAnswer\` and \`explanation\` may differ.`;
};

/** Regenerate individual flawed questions (one LLM call per entry). */
const repairFlawedEntriesBatch = async ({
    questions,
    flawedEntries,
    topic,
    bankName,
    difficulty,
    generationProvider = "gemini",
    pass = 0,
}) => {
    if (!flawedEntries?.length) return questions;

    const provider = normalizeGenerationProvider(generationProvider);
    const examProfile = detectExamProfile({ topic, bankName });
    let current = questions;
    let repairedAny = false;

    pipelineTrace("CORRECTNESS_REPAIR_PASS", {
        pass: pass + 1,
        provider,
        mode: "per-question",
        totalFlawed: flawedEntries.length,
    });

    for (const entry of flawedEntries.slice(0, GEMINI_QB_REPAIR_BATCH_SIZE)) {
        const prompt = buildQuestionBankRepairPrompt({
            topic,
            bankName,
            difficulty,
            flawedEntries: [entry],
            questions: current,
            examProfile,
        });

        const repairedRaw = await callQuestionBankGenerationLLM(prompt, {
            generationProvider: provider,
            temperature: 0.1,
        });
        const arr = parseJsonArrayFromAI(repairedRaw);
        if (!Array.isArray(arr) || arr.length !== 1) {
            pipelineTrace("CORRECTNESS_REPAIR_SKIP", {
                pass: pass + 1,
                questionNumber: entry.auditItem?.sampleNumber,
                returned: Array.isArray(arr) ? arr.length : 0,
            });
            continue;
        }

        current = applyRepairedQuestions(current, [entry], arr);
        repairedAny = true;
    }

    return repairedAny ? current : questions;
};

const collectQuestionTextsFromBankQuestions = (questions = []) => {
    const texts = [];
    for (const q of questions) {
        if (q.questionType === "connected") {
            if (q.passage?.trim()) texts.push(q.passage.trim());
            for (const sub of q.subQuestions || []) {
                if (sub.questionText?.trim()) texts.push(sub.questionText.trim());
            }
        } else if (q.questionText?.trim()) {
            texts.push(q.questionText.trim());
        }
    }
    return texts;
};

export const shouldDeferQuestionBankValidation = ({
    deferValidation,
    generateIntent = "initial",
    generationMode = "default",
} = {}) => {
    if (isPromptFirstGenerationMode(generationMode)) return false;
    if (generateIntent === "evaluation_regen") return false;
    // Veteran mode needs sync finalize + audits — deferred fast path ships template drills.
    if (isVeteranDifficultyEnabled()) return false;
    if (deferValidation === false) return false;
    if (deferValidation === true) return true;
    return process.env.AI_QB_DEFER_VALIDATION !== "0";
};

/** Prompt-first path: minimal sanitize only — no validation queue markers. */
export const preparePromptFirstQuestions = (questions = []) =>
    (questions || [])
        .map((q, index) => {
            const sanitized = sanitizeBankQuestionForPipeline(q);
            if (!sanitized) return null;
            return {
                ...sanitized,
                _questionIndex: index,
            };
        })
        .filter(Boolean);

export const prepareFastPathQuestions = (
    questions = [],
    { examCalibrated = false } = {}
) =>
    (questions || [])
        .map((q, index) => {
            const sanitized = sanitizeBankQuestionForPipeline(q);
            if (!sanitized) return null;
            return {
                ...sanitized,
                _validationStatus: sanitized._validationStatus || "pending",
                _questionIndex: index,
            };
        })
        .filter(Boolean);

/**
 * Stage-A answer lock (default ON).
 * When generation uses deferValidation (questions-only / fast path), the full
 * finalize pipeline is skipped — but hard/exam banks still need correct keys.
 * This runs the Independent Solver (OpenAI o-series by default) against Stage A
 * output so answers are locked before return.
 *
 * Env:
 *   AI_QB_STAGE_A_ANSWER_LOCK=1|0   (default 1)
 *   AI_QB_STAGE_A_DROP_UNVERIFIED=1 (drop items solver could not lock)
 */
export const isStageAAnswerLockEnabled = () => {
    const flag = process.env.AI_QB_STAGE_A_ANSWER_LOCK;
    if (flag === "0" || flag === "false") return false;
    return true;
};

export const shouldDropStageAUnverified = () => {
    // Strict correctness always drops anything not dual-verified.
    if (isStrictAnswerCorrectnessEnabled()) return true;
    const flag = process.env.AI_QB_STAGE_A_DROP_UNVERIFIED;
    return flag === "1" || flag === "true";
};

/** Only ship keys that passed dual independent solvers (strict mode). */
export const shouldRequireDualSolverForShip = () => {
    if (isStrictAnswerCorrectnessEnabled()) return true;
    const flag = process.env.AI_QB_STAGE_A_REQUIRE_DOUBLE_AGREE;
    return flag === "1" || flag === "true";
};

/**
 * Lock Stage A provisional keys via independent solver (solver-truth).
 * Safe no-op when OpenAI is not configured or answer correction is disabled.
 */
export const runStageAAnswerLock = async (
    questions = [],
    {
        topic = "",
        bankName = "",
        sectionName = "",
        subject = "",
        categoryPaths = [],
        difficulty = "hard",
        generationProvider = "gemini",
        examProfile = null,
    } = {}
) => {
    if (!isStageAAnswerLockEnabled() || !questions?.length) {
        return {
            questions,
            lockedCount: 0,
            droppedCount: 0,
            unfixableCount: 0,
            skipped: true,
        };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
        pipelineTrace("STAGE_A_ANSWER_LOCK_SKIPPED", {
            reason: "no_solver_provider_key",
        });
        return {
            questions,
            lockedCount: 0,
            droppedCount: 0,
            unfixableCount: 0,
            skipped: true,
        };
    }

    const solverProvider = resolveVerificationStageProvider(
        "solver",
        normalizeGenerationProvider(generationProvider)
    );
    const solverModel = resolveVerificationStageModel("solver");
    const solverEffort = resolveReasoningEffort({
        difficulty,
        subject,
        sectionName,
    });

    pipelineTrace("STAGE_A_ANSWER_LOCK_START", {
        count: questions.length,
        provider: solverProvider,
        model: solverModel,
        difficulty,
    });
    console.log(
        `[ai-qb] Stage A answer lock: ${questions.length} question(s) via ${solverProvider}/${solverModel}`
    );

    let locked = questions;
    let unfixableCount = 0;
    let lockedCount = 0;

    try {
        const correction = await runAnswerCorrectnessPass(
            questions,
            {
                topic,
                bankName,
                examProfile:
                    examProfile ||
                    detectExamProfile({
                        bankName,
                        topic,
                        subject,
                        sectionName,
                        categoryPaths,
                    }),
                subject,
                sectionName,
                difficulty,
            },
            {
                callLlm: (prompt) =>
                    callQuestionBankGenerationLLM(prompt, {
                        generationProvider: solverProvider,
                        temperature: 0,
                        model: solverModel,
                        reasoningEffort: solverEffort,
                    }),
                callLlmSecondary: (prompt) =>
                    callQuestionBankGenerationLLM(prompt, {
                        generationProvider: resolveVerificationStageProvider(
                            "solver_b",
                            solverProvider
                        ),
                        temperature: 0,
                        model: resolveVerificationStageModel("solver_b"),
                        reasoningEffort: solverEffort,
                    }),
            }
        );

        locked = correction.questions || questions;
        unfixableCount = (correction.unfixableRefs || []).length;
        lockedCount = (locked || []).filter((q) => q?._solverTruthApplied).length;

        locked = (locked || []).map((q) => {
            if (q?._solverTruthApplied) {
                return {
                    ...q,
                    _answerProvisional: false,
                    _validationStatus: "stage_a_answer_locked",
                    _stageAAnswerLocked: true,
                    _answerCorrectnessGuaranteed:
                        q._doubleSolverAgree === true ||
                        q?._verification?.doubleSolverAgree === true,
                };
            }
            return {
                ...q,
                _validationStatus: q?._validationStatus || "pending",
                _stageAAnswerLocked: false,
                _answerCorrectnessGuaranteed: false,
            };
        });
    } catch (err) {
        pipelineTrace("STAGE_A_ANSWER_LOCK_FAILED", {
            error: err?.message || String(err),
        });
        // Strict mode: NEVER fall back to generator-claimed keys.
        if (isStrictAnswerCorrectnessEnabled()) {
            console.warn(
                `[ai-qb] Stage A answer lock failed under STRICT mode — shipping 0 questions (no generator keys): ${err?.message || err}`
            );
            return {
                questions: [],
                lockedCount: 0,
                droppedCount: questions.length,
                unfixableCount: questions.length,
                skipped: false,
                failed: true,
                error: err?.message || String(err),
            };
        }
        console.warn(
            `[ai-qb] Stage A answer lock failed — returning generator keys: ${err?.message || err}`
        );
        return {
            questions,
            lockedCount: 0,
            droppedCount: 0,
            unfixableCount: 0,
            skipped: false,
            failed: true,
            error: err?.message || String(err),
        };
    }

    let droppedCount = 0;
    if (shouldDropStageAUnverified()) {
        const before = locked.length;
        locked = locked.filter((q) => {
            if (q?._solverTruthApplied !== true) return false;
            // Strict / require-dual: only dual-agreed keys ship for calculative items.
            if (shouldRequireDualSolverForShip()) {
                const kind = String(
                    q?._questionKind || q?.questionKind || ""
                ).toLowerCase();
                if (kind === "theory") return true;
                return (
                    q._doubleSolverAgree === true ||
                    q?._verification?.doubleSolverAgree === true ||
                    q?._answerCorrectnessGuaranteed === true
                );
            }
            return true;
        });
        droppedCount = before - locked.length;
        if (droppedCount > 0) {
            pipelineTrace("STAGE_A_ANSWER_LOCK_DROPPED_UNVERIFIED", {
                dropped: droppedCount,
                kept: locked.length,
                strict: isStrictAnswerCorrectnessEnabled(),
                requireDual: shouldRequireDualSolverForShip(),
            });
            console.warn(
                `[ai-qb] Stage A answer lock dropped ${droppedCount} unverified question(s)` +
                    (isStrictAnswerCorrectnessEnabled()
                        ? " [STRICT: dual-solver consensus required]"
                        : "")
            );
        }
    }

    pipelineTrace("STAGE_A_ANSWER_LOCK_DONE", {
        lockedCount,
        unfixableCount,
        droppedCount,
        kept: locked.length,
    });
    console.log(
        `[ai-qb] Stage A answer lock done: locked=${lockedCount}, unfixable=${unfixableCount}, dropped=${droppedCount}, kept=${locked.length}`
    );

    return {
        questions: locked,
        lockedCount,
        droppedCount,
        unfixableCount,
        skipped: false,
    };
};

/** After repair, drop items that still fail critical/major factual checks. */
export const finalizeQuestionBankSuggestions = async ({
    questions,
    topic,
    bankName,
    difficulty,
    generationProvider,
    excludeQuestionTexts = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
    examReferenceBlock = "",
    competitiveExamPlan = null,
    generateIntent = "initial",
    maxSelectableSlots = 0,
    allowTopUp = true,
    difficultyResolution = null,
    topUpWave = 0,
    skipDifficultyAudit = false,
    multipleTopUpCount = 0,
    /** Requested counts for this section/batch — used to refill after strip. */
    targetSingleCount = null,
    targetMultipleCount = null,
    targetTrueFalseCount = null,
    generationMode = "default",
}) => {
    const provider = normalizeGenerationProvider(generationProvider);
    const effectiveDifficulty =
        difficultyResolution?.generationDifficulty || difficulty;
    const mixOpts = mixOptionsFromResolution(difficultyResolution);
    const topUpBudgetRemaining = Math.max(
        0,
        getFinalizeTopUpMaxWaves() - topUpWave
    );
    let topUpWavesUsed = 0;
    const canRunShallowTopUp = () =>
        allowTopUp &&
        isFinalizeTopUpEnabled() &&
        topUpWavesUsed < topUpBudgetRemaining;

    const countByType = (list = []) => {
        const out = { single: 0, multiple: 0, true_false: 0, connected: 0 };
        for (const q of list || []) {
            const t = String(q?.questionType || "single").toLowerCase();
            if (t === "multiple") out.multiple += 1;
            else if (t === "true_false" || t === "truefalse") out.true_false += 1;
            else if (t === "connected") out.connected += 1;
            else out.single += 1;
        }
        return out;
    };

    /** When top-up can't run, keep near-miss rejects instead of wiping the batch. */
    const DIFFICULTY_KEEP_FLOOR = Math.max(
        50,
        Number(process.env.AI_QB_DIFFICULTY_KEEP_FLOOR ?? 70)
    );
    const restoreNearMissRejected = (rejected = [], reason = "") => {
        const restored = (rejected || [])
            .filter(
                (r) =>
                    r?.question &&
                    Number.isFinite(r.difficultyScore) &&
                    r.difficultyScore >= DIFFICULTY_KEEP_FLOOR
            )
            .map((r) => r.question);
        if (restored.length) {
            pipelineTrace("FINALIZE_DIFFICULTY_KEEP_NEAR_MISS", {
                restored: restored.length,
                rejected: rejected.length,
                keepFloor: DIFFICULTY_KEEP_FLOOR,
                reason,
            });
        }
        return restored;
    };

    const runShallowReplacementBatch = async (
        countForTopUp,
        { extraExclude = [], traceEvent, excludeFrom = null, type = "single" } = {}
    ) => {
        if (!canRunShallowTopUp() || countForTopUp < 1) {
            if (countForTopUp > 0) {
                const reason = !allowTopUp
                    ? "allow_top_up_false"
                    : !isFinalizeTopUpEnabled()
                      ? "top_up_disabled"
                      : "budget_exhausted";
                pipelineTrace("FINALIZE_TOP_UP_SKIPPED", {
                    reason,
                    requested: countForTopUp,
                    type,
                    topUpWave,
                    maxWaves: getFinalizeTopUpMaxWaves(),
                });
            }
            return [];
        }
        pipelineTrace(traceEvent, {
            count: countForTopUp,
            type,
            topUpWave: topUpWave + topUpWavesUsed,
        });
        try {
            const topUpResult = await generateQuestionBankBatch({
                topic,
                bankName,
                difficulty,
                singleCount: type === "single" ? countForTopUp : 0,
                multipleCount: type === "multiple" ? countForTopUp : 0,
                trueFalseCount: type === "true_false" ? countForTopUp : 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
                excludeQuestionTexts: [
                    ...excludeQuestionTexts,
                    ...collectQuestionTextsFromBankQuestions(
                        excludeFrom ?? sanitizedInput
                    ),
                    ...extraExclude,
                ],
                categoryPaths,
                sectionName,
                subject,
                topicRelevanceFeedback: null,
                generateIntent,
                maxSelectableSlots,
                examReferenceBlock,
                competitiveExamPlan,
                provider,
                genTemperature: resolveGenerationTemperature(provider),
                allowTopUp: false,
                forceOneShot:
                    type === "multiple" ||
                    type === "true_false" ||
                    !difficultyResolution?.examCalibrated,
                skipFinalizeDifficultyAudit: !difficultyResolution?.examCalibrated,
                topUpWave: topUpWave + topUpWavesUsed + 1,
                difficultyResolution,
                generationMode,
            });
            const topUpQuestions = unwrapFinalizedQuestions(topUpResult);
            topUpWavesUsed += 1;
            pipelineTrace(`${traceEvent}_DONE`, {
                added: topUpQuestions.length,
                requested: countForTopUp,
                type,
            });
            return topUpQuestions;
        } catch (topUpErr) {
            pipelineTrace(`${traceEvent}_FAILED`, {
                error: topUpErr?.message || String(topUpErr),
            });
            return [];
        }
    };

    pipelineTrace('FINALIZE_START', { inputCount: questions.length, provider });

    const examProfileForGate = detectExamProfile({
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });

    let sanitizedInput = (questions || [])
        .map(sanitizeBankQuestionForPipeline)
        .filter(Boolean);
    const sanitizeDropped = (questions || []).length - sanitizedInput.length;
    if (sanitizeDropped > 0) {
        pipelineTrace("FINALIZE_SANITIZE_STRIPPED", { count: sanitizeDropped });
    }

    if (
        sanitizeDropped > 0 &&
        sanitizeDropped <= Math.max(1, GEMINI_QB_REPAIR_BATCH_SIZE)
    ) {
        const topUpQuestions = await runShallowReplacementBatch(sanitizeDropped, {
            traceEvent: "FINALIZE_SANITIZE_TOP_UP",
        });
        if (topUpQuestions.length) {
            sanitizedInput = [
                ...sanitizedInput,
                ...topUpQuestions
                    .map(sanitizeBankQuestionForPipeline)
                    .filter(Boolean),
            ];
        }
    }

    if (multipleTopUpCount > 0) {
        const multipleTopUpQuestions = await runShallowReplacementBatch(
            multipleTopUpCount,
            { type: "multiple", traceEvent: "FINALIZE_MULTIPLE_UNDERCOUNT_TOP_UP" }
        );
        if (multipleTopUpQuestions.length) {
            sanitizedInput = [
                ...sanitizedInput,
                ...multipleTopUpQuestions
                    .map(sanitizeBankQuestionForPipeline)
                    .filter(Boolean),
            ];
        }
    }

    // Difficulty judge runs AFTER independent solver + SymPy (solver-truth pipeline).
    // Legacy path (!solverTruth) still judges before verify for backward compatibility.
    let selfAuditResult = { questions: sanitizedInput, rejectedCount: 0, rejected: [] };
    const deferDifficultyUntilAfterVerify = isSolverTruthEnabled();
    const effectiveSkipDifficultyAudit =
        skipDifficultyAudit ||
        shouldSkipLlmDifficultySelfAudit(difficultyResolution);

    const runDifficultyJudgeOn = async (inputQuestions) => {
        let working = inputQuestions;
        let result = { questions: working, rejectedCount: 0, rejected: [] };
        if (effectiveSkipDifficultyAudit) {
            return { questions: working, selfAuditResult: result };
        }
        result = await applyDifficultySelfAuditGate(
            working,
            {
                topic,
                bankName,
                difficulty: effectiveDifficulty,
                examProfile: examProfileForGate,
                minScore: DIFFICULTY_SELF_AUDIT_MIN_SCORE,
            },
            {
                callLlm: (auditPrompt) =>
                    callQuestionBankGenerationLLM(auditPrompt, {
                        generationProvider: resolveVerificationStageProvider(
                            "difficulty_judge",
                            provider
                        ),
                        temperature: 0.1,
                        model: resolveVerificationStageModel("difficulty_judge"),
                    }),
            }
        );
        working = result.questions;

        if (result.rejectedCount > 0) {
            if (isRepairOnFailEnabled()) {
                const repairedSingles = await repairDifficultyRejectedQuestions(
                    result.rejected,
                    { topic, bankName, examProfile: examProfileForGate },
                    {
                        callLlm: (repairPrompt) =>
                            callQuestionBankGenerationLLM(repairPrompt, {
                                generationProvider: provider,
                                temperature: 0.1,
                            }),
                        parseQuestion: (raw, index) =>
                            parseQuestionBankAIItem(raw, index, "Difficulty repair"),
                    }
                );
                if (repairedSingles.length) {
                    working = [...working, ...repairedSingles];
                    pipelineTrace("FINALIZE_DIFFICULTY_REPAIRED", {
                        repairedCount: repairedSingles.length,
                        rejectedCount: result.rejectedCount,
                    });
                } else {
                    const kept = restoreNearMissRejected(
                        result.rejected,
                        "repair_empty"
                    );
                    if (kept.length) working = [...working, ...kept];
                    pipelineTrace("FINALIZE_DIFFICULTY_SELF_AUDIT_STRIPPED", {
                        rejectedCount: result.rejectedCount,
                        keptNearMiss: kept.length,
                        minScore: DIFFICULTY_SELF_AUDIT_MIN_SCORE,
                    });
                }
            } else if (
                (isFinalizeDifficultyRegenEnabled() ||
                    difficultyResolution?.examCalibrated ||
                    deferDifficultyUntilAfterVerify) &&
                result.rejectedCount <= Math.max(1, GEMINI_QB_REPAIR_BATCH_SIZE)
            ) {
                const regenCount = result.rejectedCount;
                pipelineTrace("FINALIZE_DIFFICULTY_REGEN", {
                    count: regenCount,
                    minScore: DIFFICULTY_SELF_AUDIT_MIN_SCORE,
                    afterVerify: deferDifficultyUntilAfterVerify,
                });
                const regenQuestions = await runShallowReplacementBatch(regenCount, {
                    extraExclude: result.rejected
                        .map((r) => r.question?.questionText)
                        .filter(Boolean),
                    traceEvent: "FINALIZE_DIFFICULTY_REGEN",
                });
                if (regenQuestions.length) {
                    working = [...working, ...regenQuestions];
                    pipelineTrace("FINALIZE_DIFFICULTY_REGEN_DONE", {
                        added: regenQuestions.length,
                        requested: regenCount,
                    });
                } else {
                    const kept = restoreNearMissRejected(
                        result.rejected,
                        "regen_empty_or_budget"
                    );
                    if (kept.length) working = [...working, ...kept];
                    pipelineTrace("FINALIZE_DIFFICULTY_REGEN_EMPTY", {
                        requested: regenCount,
                        keptNearMiss: kept.length,
                    });
                }
            } else {
                const kept = restoreNearMissRejected(
                    result.rejected,
                    "stripped_no_regen"
                );
                if (kept.length) working = [...working, ...kept];
                pipelineTrace("FINALIZE_DIFFICULTY_SELF_AUDIT_STRIPPED", {
                    rejectedCount: result.rejectedCount,
                    keptNearMiss: kept.length,
                    minScore: DIFFICULTY_SELF_AUDIT_MIN_SCORE,
                    regenEnabled: isFinalizeDifficultyRegenEnabled(),
                });
            }
        }
        return { questions: working, selfAuditResult: result };
    };

    if (!deferDifficultyUntilAfterVerify) {
        const early = await runDifficultyJudgeOn(sanitizedInput);
        sanitizedInput = early.questions;
        selfAuditResult = early.selfAuditResult;
    }

    let normalized = reconcileQuestionBankWithIndependentVerify(sanitizedInput).map(
        sanitizeQuestionStemEmbeddedOptions
    );
    const reconcileAudit = runDeterministicCorrectnessAudit(
        flattenQuestionBankForCorrectnessAudit(normalized).map((e) => e.auditItem)
    );
    pipelineTrace('FINALIZE_NUMERIC_RECONCILE', {
        correctnessScore: reconcileAudit.correctnessScore,
        issueCount: reconcileAudit.confirmedIssues?.length ?? 0,
    });

    // Independent verification: blind solver + explanation verifier (env-gated).
    // Unfixables are dropped here so strip/top-up only regenerates failures.
    const examProfileForVerify = detectExamProfile({
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });
    const solverProvider = resolveVerificationStageProvider(
        "solver",
        provider
    );
    const solverModel = resolveVerificationStageModel("solver");
    const solverBModel = resolveVerificationStageModel("solver_b");
    let verificationStats = {
        passed: 0,
        fixed: 0,
        regenerated: 0,
        stripped: 0,
    };

    // Within-batch duplicates: LaTeX-normalized hash + embedding (~93%) — keep one.
    try {
        const deduped = await dedupeBatchByHashAndEmbedding(normalized);
        if (deduped.dropped > 0) {
            verificationStats.stripped += deduped.dropped;
            pipelineTrace("FINALIZE_BATCH_DEDUPED", {
                dropped: deduped.dropped,
                kept: deduped.kept,
            });
        }
        normalized = deduped.questions || normalized;
    } catch (err) {
        pipelineTrace("FINALIZE_BATCH_DEDUPE_FAILED", {
            error: err?.message || String(err),
        });
    }

    // SymPy pre-parse BEFORE expensive LLM solver (pure math equations only).
    try {
        const pre = await applySymPyPreSolvePass(normalized, {
            subject,
            sectionName,
        });
        if (pre.preSolved > 0) {
            pipelineTrace("FINALIZE_SYMPY_PRESOLVE", {
                preSolved: pre.preSolved,
            });
        }
        normalized = pre.questions || normalized;
    } catch (err) {
        pipelineTrace("FINALIZE_SYMPY_PRESOLVE_FAILED", {
            error: err?.message || String(err),
        });
    }

    const solverReasoningEffort = resolveReasoningEffort({
        difficulty: effectiveDifficulty,
        subject,
        sectionName,
    });

    try {
        const verification = await withStageTiming(
            "independent_verification",
            () =>
                runIndependentVerificationPipeline(normalized, {
                    topic,
                    bankName,
                    examProfile: examProfileForVerify,
                    subject,
                    sectionName,
                    difficulty: effectiveDifficulty,
                    skipExplanationVerifier:
                        isSolverTruthEnabled() ||
                        process.env.AI_QB_DEFER_EXPLANATION_VERIFY === "1" ||
                        process.env.AI_QB_DEFER_EXPLANATION_VERIFY === "true",
                    deferTruthGates: true,
                    callLlm: (prompt) =>
                        callQuestionBankGenerationLLM(prompt, {
                            generationProvider: solverProvider,
                            temperature: 0,
                            model: solverModel,
                            reasoningEffort: solverReasoningEffort,
                        }),
                    callLlmSecondary: (prompt) =>
                        callQuestionBankGenerationLLM(prompt, {
                            generationProvider: resolveVerificationStageProvider(
                                "solver_b",
                                solverProvider
                            ),
                            temperature: 0,
                            model: solverBModel,
                            reasoningEffort: solverReasoningEffort,
                        }),
                }),
            {
                provider: solverProvider,
                model: solverModel,
                reasoning_effort: solverReasoningEffort,
                topic,
                bankName,
            }
        );
        normalized = verification.questions || normalized;
        verificationStats = {
            ...verificationStats,
            ...(verification.verificationStats || {}),
            stripped:
                (verification.droppedCount || 0) +
                (verification.verificationStats?.stripped || 0),
            fixed: verification.fixedCount || 0,
        };
        if (verification.droppedCount > 0) {
            pipelineTrace("FINALIZE_INDEPENDENT_SOLVER_DROPPED", {
                dropped: verification.droppedCount,
                byType: verification.droppedByType,
            });
            // Regenerate only failed questions (not the full batch).
            if (
                isSolverTruthEnabled() &&
                verification.droppedCount <=
                    Math.max(1, GEMINI_QB_REPAIR_BATCH_SIZE)
            ) {
                const replacements = await runShallowReplacementBatch(
                    verification.droppedCount,
                    {
                        excludeFrom: normalized,
                        traceEvent: "FINALIZE_SOLVER_TRUTH_REGEN",
                    }
                );
                if (replacements.length) {
                    normalized = [...normalized, ...replacements];
                    verificationStats.regenerated += replacements.length;
                }
            }
        }
    } catch (err) {
        pipelineTrace("FINALIZE_INDEPENDENT_VERIFICATION_FAILED", {
            error: err?.message || String(err),
        });
        console.warn(
            `[ai-qb] independent verification failed — continuing with deterministic strip: ${err?.message || err}`
        );
    }

    try {
        const beforeSympy = normalized.length;
        const symbolic = await applySymbolicVerificationToQuestions(normalized, {
            subject,
            sectionName,
        });
        normalized = (symbolic.questions || normalized).filter(
            (q) => q?._verification?.symbolicOk !== false
        );
        if (symbolic.failed > 0) {
            verificationStats.stripped += symbolic.failed;
            recordVerificationTelemetry({
                stage: "symbolic_verify",
                failed: symbolic.failed,
                checked: symbolic.checked,
            });
            pipelineTrace("FINALIZE_SYMBOLIC_VERIFY_REJECTED", {
                failed: symbolic.failed,
                kept: normalized.length,
                before: beforeSympy,
            });
            // Regenerate only SymPy failures (Math).
            if (
                isSolverTruthEnabled() &&
                symbolic.failed <= Math.max(1, GEMINI_QB_REPAIR_BATCH_SIZE)
            ) {
                const replacements = await runShallowReplacementBatch(
                    symbolic.failed,
                    {
                        excludeFrom: normalized,
                        traceEvent: "FINALIZE_SYMPY_REGEN",
                    }
                );
                if (replacements.length) {
                    normalized = [...normalized, ...replacements];
                    verificationStats.regenerated += replacements.length;
                }
            }
        }
    } catch (err) {
        pipelineTrace("FINALIZE_SYMBOLIC_VERIFY_FAILED", {
            error: err?.message || String(err),
        });
    }

    // Rewrite student explanations ONLY from verified solver steps (never re-solve).
    if (isSolverTruthEnabled()) {
        try {
            normalized = rewriteExplanationsForBank(normalized);
            pipelineTrace("FINALIZE_EXPLANATION_REWRITE", {
                count: normalized.length,
            });
        } catch (err) {
            pipelineTrace("FINALIZE_EXPLANATION_REWRITE_FAILED", {
                error: err?.message || String(err),
            });
        }
    }

    // Answer + explanation consistency after SymPy (final_answer is source of truth).
    if (isSolverTruthEnabled()) {
        try {
            const gates = runPostSymbolicTruthGates(normalized);
            normalized = gates.questions || normalized;
            // Drop consistency failures now; rule engine runs again after difficulty
            // (indices change if difficulty drops items — do not reuse rule refs).
            if (gates.consistencyUnsolvable?.length) {
                const dropped = dropQuestionsByRefs(
                    normalized,
                    gates.consistencyUnsolvable
                );
                verificationStats.stripped += dropped.droppedCount || 0;
                normalized = dropped.questions;
                pipelineTrace("FINALIZE_ANSWER_EXPL_CONSISTENCY", {
                    dropped: dropped.droppedCount,
                    repaired: gates.repairedCount,
                });
            }
        } catch (err) {
            pipelineTrace("FINALIZE_ANSWER_EXPL_CONSISTENCY_FAILED", {
                error: err?.message || String(err),
            });
        }
    }

    // Difficulty judge AFTER answer verification (solver-truth required order).
    if (deferDifficultyUntilAfterVerify) {
        // Concept coverage + formula gates before difficulty (cheap, deterministic).
        try {
            const coverage = runConceptCoveragePass(normalized, {
                subject,
                sectionName,
            });
            normalized = (coverage.questions || normalized).filter(
                (q) => q?._verification?.conceptCoverageOk !== false
            );
            if (coverage.rejected?.length) {
                verificationStats.stripped += coverage.rejected.length;
                pipelineTrace("FINALIZE_CONCEPT_COVERAGE_REJECTED", {
                    rejected: coverage.rejected.length,
                });
            }
        } catch (err) {
            pipelineTrace("FINALIZE_CONCEPT_COVERAGE_FAILED", {
                error: err?.message || String(err),
            });
        }

        try {
            const formulaResult = runFormulaValidationPass(normalized, { topic });
            const hardFormula = (formulaResult.rejected || []).length;
            normalized = formulaResult.questions || normalized;
            // Stamp hard formula rejects
            if (hardFormula) {
                verificationStats.stripped += hardFormula;
            }
            if (process.env.AI_QB_FORMULA_HARD_REJECT === "1") {
                normalized = normalized.filter(
                    (q) =>
                        !q?._formulaValidation?.issues?.some((i) =>
                            /allow-listed|Impossible/i.test(String(i))
                        )
                );
            }
        } catch (err) {
            pipelineTrace("FINALIZE_FORMULA_GATE_FAILED", {
                error: err?.message || String(err),
            });
        }

        const late = await runDifficultyJudgeOn(normalized);
        normalized = late.questions;
        selfAuditResult = late.selfAuditResult;
        pipelineTrace("FINALIZE_DIFFICULTY_AFTER_VERIFY", {
            kept: normalized.length,
            rejected: selfAuditResult.rejectedCount || 0,
        });

        // Rule engine last (after solver → sympy → answer/expl → difficulty).
        if (isSolverTruthEnabled()) {
            const rulesAgain = runPostSymbolicTruthGates(normalized);
            const gateRefs = [
                ...(rulesAgain.ruleUnsolvable || []),
                ...(rulesAgain.consistencyUnsolvable || []),
            ];
            normalized = rulesAgain.questions || normalized;
            if (gateRefs.length) {
                const dropped = dropQuestionsByRefs(normalized, gateRefs);
                verificationStats.stripped += dropped.droppedCount || 0;
                normalized = dropped.questions;
                pipelineTrace("FINALIZE_RULE_ENGINE_AFTER_DIFFICULTY", {
                    dropped: dropped.droppedCount,
                    kept: normalized.length,
                });
            }
        }
    }

    if (!deferDifficultyUntilAfterVerify && isSolverTruthEnabled()) {
        const gates = runPostSymbolicTruthGates(normalized);
        normalized = gates.questions || normalized;
        const gateRefs = [
            ...(gates.ruleUnsolvable || []),
            ...(gates.consistencyUnsolvable || []),
        ];
        if (gateRefs.length) {
            const dropped = dropQuestionsByRefs(normalized, gateRefs);
            verificationStats.stripped += dropped.droppedCount || 0;
            normalized = dropped.questions;
        }
    }

    // Under solver-truth, do NOT re-solve via correctness repair (causes answer drift).
    // Failures are already stripped/regenerated selectively after solver + SymPy.
    const repairFn =
        GEMINI_QB_CORRECTNESS_REPAIR_PASSES > 0 && !isSolverTruthEnabled()
            ? (current, flawedEntries, pass) =>
                  repairFlawedEntriesBatch({
                      questions: current,
                      flawedEntries,
                      topic,
                      bankName,
                      difficulty: effectiveDifficulty,
                      generationProvider: provider,
                      pass,
                  })
            : null;

    let { questions: cleaned, strippedCount, strippedByType, repairedPasses, audit } =
        await stripFlawedQuestionBankEntries(normalized, {
            repairFn,
            maxRepairPasses: isSolverTruthEnabled()
                ? 0
                : GEMINI_QB_CORRECTNESS_REPAIR_PASSES,
        });

    if (isSolverTruthEnabled() && GEMINI_QB_CORRECTNESS_REPAIR_PASSES > 0) {
        pipelineTrace("CORRECTNESS_REPAIR_SKIP", {
            reason: "solver_truth_enabled",
            configuredPasses: GEMINI_QB_CORRECTNESS_REPAIR_PASSES,
        });
    }

    verificationStats.stripped += strippedCount || 0;

    pipelineTrace('FINALIZE_STRIP', {
        strippedCount,
        repairedPasses,
        correctnessScore: audit?.correctnessScore,
        styleScore: audit?.styleScore,
        issueCount: audit?.confirmedIssues?.length ?? 0,
    });
    if (audit?.confirmedIssues?.length) {
        pipelineTraceSection(
            'stripped issues',
            audit.confirmedIssues.slice(0, 20).map(
                (i) => `Q${i.questionNumber}: ${i.issue}`
            )
        );
    }

    // Always attempt refill for stripped items (not only when count ≤ repair batch).
    if (strippedCount > 0 && canRunShallowTopUp()) {
        const refillCount = Math.min(
            strippedCount,
            Math.max(1, GEMINI_QB_REPAIR_BATCH_SIZE * 2)
        );
        pipelineTrace('FINALIZE_TOP_UP', {
            count: refillCount,
            strippedCount,
            preAuditScore: audit?.correctnessScore,
        });
        console.log(
            `[ai-qb] top-up: generating ${refillCount} replacement(s) after stripping flawed items (pre-audit ${audit?.correctnessScore ?? "?"}/100)`
        );
        const strippedMultiple = Math.min(
            strippedByType?.multiple || 0,
            refillCount
        );
        const strippedOther = refillCount - strippedMultiple;
        const topUpQuestions = [
            ...(strippedOther > 0
                ? await runShallowReplacementBatch(strippedOther, {
                      excludeFrom: cleaned,
                      traceEvent: "FINALIZE_TOP_UP",
                  })
                : []),
            ...(strippedMultiple > 0
                ? await runShallowReplacementBatch(strippedMultiple, {
                      type: "multiple",
                      excludeFrom: cleaned,
                      traceEvent: "FINALIZE_TOP_UP_MULTIPLE",
                  })
                : []),
        ];
        if (topUpQuestions.length) {
            const acceptedTopUp = topUpQuestions.filter((q) => {
                try {
                    assertGenerationCorrectness(q);
                    return true;
                } catch (err) {
                    pipelineTrace("FINALIZE_TOP_UP_REJECT", {
                        error: err?.message || String(err),
                        stem: String(q?.questionText || "").slice(0, 120),
                    });
                    return false;
                }
            });
            if (acceptedTopUp.length) {
                cleaned = [...cleaned, ...acceptedTopUp];
                verificationStats.regenerated += acceptedTopUp.length;
            }
        }
    }

    // Count guarantee: refill until requested minimum; allow up to target + overflow.
    {
        const overflow = getCountOverflowMax();
        const minSingle = Math.max(0, Number(targetSingleCount) || 0);
        const minMultiple = Math.max(
            0,
            Number(targetMultipleCount) || Number(multipleTopUpCount) || 0
        );
        const minTrueFalse = Math.max(0, Number(targetTrueFalseCount) || 0);
        const minTotal = minSingle + minMultiple + minTrueFalse;
        const maxTotal =
            minTotal > 0 ? minTotal + overflow : Number.POSITIVE_INFINITY;

        const fillDeficit = async (type, need) => {
            if (need < 1 || !canRunShallowTopUp()) return 0;
            const batch = await runShallowReplacementBatch(need, {
                excludeFrom: cleaned,
                type,
                traceEvent: `FINALIZE_COUNT_GUARANTEE_${type.toUpperCase()}`,
            });
            const accepted = (batch || []).filter((q) => {
                try {
                    assertGenerationCorrectness(q);
                    return true;
                } catch {
                    return false;
                }
            });
            if (accepted.length) {
                cleaned = [...cleaned, ...accepted];
                verificationStats.regenerated += accepted.length;
            }
            return accepted.length;
        };

        // Up to remaining waves: keep filling type deficits toward the minimum.
        let guard = 0;
        while (canRunShallowTopUp() && guard < 6) {
            guard += 1;
            const counts = countByType(cleaned);
            const needSingle = Math.max(0, minSingle - counts.single);
            const needMultiple = Math.max(0, minMultiple - counts.multiple);
            const needTf = Math.max(0, minTrueFalse - counts.true_false);
            if (needSingle + needMultiple + needTf < 1) break;

            pipelineTrace("FINALIZE_COUNT_GUARANTEE", {
                have: counts,
                need: {
                    single: needSingle,
                    multiple: needMultiple,
                    true_false: needTf,
                },
                minTotal,
                maxTotal: Number.isFinite(maxTotal) ? maxTotal : null,
                wave: topUpWavesUsed + 1,
            });

            if (needSingle > 0) await fillDeficit("single", needSingle);
            if (needMultiple > 0) await fillDeficit("multiple", needMultiple);
            if (needTf > 0) await fillDeficit("true_false", needTf);

            const after = countByType(cleaned);
            if (
                after.single >= minSingle &&
                after.multiple >= minMultiple &&
                after.true_false >= minTrueFalse
            ) {
                break;
            }
            // If a wave added nothing, stop to avoid spinning.
            if (
                after.single === counts.single &&
                after.multiple === counts.multiple &&
                after.true_false === counts.true_false
            ) {
                pipelineTrace("FINALIZE_COUNT_GUARANTEE_STALLED", { counts: after });
                break;
            }
        }

        if (Number.isFinite(maxTotal) && cleaned.length > maxTotal) {
            pipelineTrace("FINALIZE_COUNT_OVERFLOW_CAP", {
                before: cleaned.length,
                maxTotal,
                overflow,
            });
            cleaned = cleaned.slice(0, maxTotal);
        }

        const finalCounts = countByType(cleaned);
        pipelineTrace("FINALIZE_COUNT_GUARANTEE_DONE", {
            min: { single: minSingle, multiple: minMultiple, true_false: minTrueFalse },
            have: finalCounts,
            total: cleaned.length,
            maxTotal: Number.isFinite(maxTotal) ? maxTotal : null,
            shortfall: Math.max(
                0,
                minTotal -
                    (finalCounts.single +
                        finalCounts.multiple +
                        finalCounts.true_false)
            ),
        });
    }

    const stats = {
        correctnessScore: audit?.correctnessScore,
        styleScore: audit?.styleScore,
        strippedCount,
        repairedPasses,
        difficultySelfAuditRejected: selfAuditResult.rejectedCount,
        outputCount: cleaned.length,
        confirmedIssueCount: audit?.confirmedIssues?.length ?? 0,
        verification: verificationStats,
        countGuarantee: {
            targetSingle: targetSingleCount,
            targetMultiple: targetMultipleCount,
            targetTrueFalse: targetTrueFalseCount,
            overflowMax: getCountOverflowMax(),
        },
    };

    cleaned = assignDifficultyTiersToQuestions(
        cleaned,
        effectiveDifficulty,
        mixOpts
    );

    if (generateIntent === GENERATE_INTENTS.INITIAL) {
        const examProfile = detectExamProfile({
            bankName,
            topic,
            subject,
            sectionName,
            categoryPaths,
        });
        const diffCtx = {
            bankDifficulty: effectiveDifficulty,
            examProfile,
            examCalibrated: difficultyResolution?.examCalibrated || false,
            subject,
        };

        const flatEntries = flattenQuestionBankForCorrectnessAudit(cleaned).map(
            (e) => {
                const { topIndex, subIndex } = e.ref;
                const q = cleaned[topIndex];
                const tier =
                    subIndex != null
                        ? q.subQuestions?.[subIndex]?.difficulty
                        : q.difficulty;
                return {
                    ...e.auditItem,
                    difficultyTier: tier,
                    _solveSteps: q._solveSteps,
                };
            }
        );
        const diffAudit = runDeterministicDifficultyAudit(flatEntries, diffCtx);
        stats.difficultyMatchScore = diffAudit.difficultyMatchScore;
        stats.difficultyMatchTarget = INITIAL_GEN_DIFFICULTY_MATCH_TARGET;
        pipelineTrace('FINALIZE_DIFFICULTY_SCORE', {
            difficultyMatchScore: diffAudit.difficultyMatchScore,
            target: INITIAL_GEN_DIFFICULTY_MATCH_TARGET,
            issueCount: diffAudit.confirmedIssues?.length ?? 0,
        });
        stats.outputCount = cleaned.length;
    }

    pipelineTrace('FINALIZE_DONE', stats);

    try {
        const parked = await parkLowConfidenceForHumanReview(cleaned, {
            topic,
            bankName,
            sectionName,
        });
        if (parked.parkedCount > 0) {
            cleaned = parked.questions;
            stats.verification = {
                ...(stats.verification || {}),
                humanReviewParked: parked.parkedCount,
            };
            stats.outputCount = cleaned.length;
            pipelineTrace("FINALIZE_HUMAN_REVIEW_PARKED", {
                parked: parked.parkedCount,
                remaining: cleaned.length,
            });
        }
    } catch (err) {
        pipelineTrace("FINALIZE_HUMAN_REVIEW_FAILED", {
            error: err?.message || String(err),
        });
    }

    return { questions: cleaned, stats };
};

/**
 * Call Gemini to infer question-type counts from topic/exam context (plan only — no questions).
 */
export const inferQuestionBankCounts = async (params) => {
    const {
        topic,
        bankName,
        difficulty,
        sectionName = "",
        subject = "",
        categoryPaths = [],
        maxSelectableSlots = 0,
        topicRelevanceFeedback = null,
        generateIntent = "initial",
    } = params;

    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    const inferenceCtx = getCountInferenceContext({
        topic,
        bankName,
        difficulty,
        sectionName,
        subject,
        categoryPaths,
        maxSelectableSlots,
    });

    const resolvedSubject = resolveSubjectForGeneration({
        generateIntent,
        topicRelevanceFeedback,
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    const prompt = buildQuestionBankCountOnlyPrompt({
        topic,
        bankName,
        difficulty,
        categoryPaths,
        sectionName,
        subject,
        topicRelevanceFeedback,
        generateIntent,
        maxApiItems: inferenceCtx.maxApiItems,
        maxSelectableSlots: inferenceCtx.maxSelectableSlots,
        examProfile: inferenceCtx.examProfile,
        catSection: inferenceCtx.catSection,
        resolvedSubject,
    });

    try {
        const plan = await callGeminiWithRetries(async () => {
            const result = await genAI.models.generateContent({
                model: geminiTextModel(),
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                },
            });

            const text = result.text || "";
            if (!text) {
                throw new ApiError(500, "AI returned empty count-inference response");
            }

            const parsed = parseJsonObjectFromAI(text);
            const rawPlan =
                parsed.plan && typeof parsed.plan === "object" ? parsed.plan : parsed;
            return normalizeInferredPlan(rawPlan, inferenceCtx.maxApiItems, {
                maxSelectableSlots: inferenceCtx.maxSelectableSlots,
            });
        });

        return { plan, detectedSubject: resolvedSubject };
    } catch (error) {
        if (isGeminiAvailabilityError(error)) {
            throw error instanceof ApiError ? error : toGeminiQuestionBankError(error);
        }

        const plan = suggestRealisticDefaultPlan({
            catSection: inferenceCtx.catSection,
            examProfile: inferenceCtx.examProfile,
            maxApiItems: inferenceCtx.maxApiItems,
            maxSelectableSlots: inferenceCtx.maxSelectableSlots,
        });

        return { plan, detectedSubject: resolvedSubject, usedFallback: true };
    }
};

/**
 * Step 1: AI detects exam type, topic scope, subjects, and counts.
 * Step 2 is generateQuestionBankSuggestions with the returned plan.
 */
export const inferCompetitiveExamPlan = async (params) => {
    const {
        topic,
        bankName,
        difficulty,
        sectionName = "",
        subject = "",
        categoryPaths = [],
        maxSelectableSlots = 0,
    } = params;

    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    const inferenceCtx = getCountInferenceContext({
        topic,
        bankName,
        difficulty,
        sectionName,
        subject,
        categoryPaths,
        maxSelectableSlots,
    });

    const resolvedSubject = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    const prompt = buildCompetitiveExamPlanPrompt({
        topic,
        bankName,
        difficulty,
        sectionName,
        subject,
        categoryPaths,
        maxApiItems: inferenceCtx.maxApiItems,
        maxSelectableSlots: inferenceCtx.maxSelectableSlots,
    });

    const normalizePlan = (rawPlan) =>
        normalizeCompetitiveExamPlan(rawPlan, {
            maxApiItems: inferenceCtx.maxApiItems,
            maxSelectableSlots: inferenceCtx.maxSelectableSlots,
            topic,
            bankName,
            categoryPaths,
            sectionName,
            subject,
            bankDifficulty: difficulty,
        });

    try {
        const plan = await callGeminiWithRetries(async () => {
            const result = await genAI.models.generateContent({
                model: geminiTextModel(),
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    temperature: 0.2,
                },
            });

            const text = result.text || "";
            if (!text) {
                throw new ApiError(500, "AI returned empty exam plan");
            }

            const parsed = parseJsonObjectFromAIText(text);
            const rawPlan =
                parsed.plan && typeof parsed.plan === "object" ? parsed.plan : parsed;
            return normalizePlan(rawPlan);
        });

        console.log(
            `[ai-qb] AI exam plan: profile=${plan.examProfile}` +
                (plan.catSection ? ` (${plan.catSection})` : "") +
                (plan.isFullPaper ? ", fullPaper" : "") +
                (plan.topicScope ? ` — ${plan.topicScope}` : "")
        );

        return { plan, detectedSubject: resolvedSubject };
    } catch (error) {
        if (isGeminiAvailabilityError(error)) {
            throw error instanceof ApiError ? error : toGeminiQuestionBankError(error);
        }

        const selectableTarget = inferenceCtx.maxSelectableSlots;
        const subjects = suggestMinimalSubjectFallback({
            topic,
            bankName,
            categoryPaths,
            sectionName,
            subject,
            selectableTarget,
        });
        const plan = normalizePlan({
            subjects,
            singleCount: selectableTarget,
            rationale: `Fallback ${selectableTarget}-question plan (AI planning unavailable).`,
        });

        return { plan, detectedSubject: resolvedSubject, usedFallback: true };
    }
};

const FINALIZE_DIFFICULTY_AUDIT_SKIP_MARGIN = Math.max(
    0,
    Number(process.env.AI_QB_FINALIZE_AUDIT_SKIP_MARGIN ?? 8)
);

/**
 * If the skeleton-level difficulty audit already ran cleanly (nothing
 * rejected that attempt) and scored comfortably above the finalize-level
 * bar, the finalize-stage LLM difficulty audit is redundant re-checking the
 * same thing — skip it to save a round-trip. Falls back to the caller's own
 * skip decision otherwise (never runs the audit MORE than the existing logic
 * already would).
 *
 * Exam-calibrated banks: always skip finalize re-audit when the skeleton gate
 * already ran. Re-scoring the built MCQ was wildly noisy (e.g. pass at 78 then
 * score 45 at finalize) and, with per-chunk allowTopUp=false, wiped entire
 * batches that the UI had already streamed as partials.
 */
const shouldSkipFinalizeDifficultyAudit = (
    baseSkip,
    auditStats,
    difficultyResolution = null
) => {
    if (baseSkip) return true;
    if (!auditStats?.ranSkeletonAudit) return false;
    if (difficultyResolution?.examCalibrated) return true;
    if (auditStats.minKeptScore == null) return false;
    return (
        auditStats.minKeptScore >=
        DIFFICULTY_SELF_AUDIT_MIN_SCORE + FINALIZE_DIFFICULTY_AUDIT_SKIP_MARGIN
    );
};

/**
 * Solve-first path: LLM skeletons → code-built options → verify → MCQs.
 */
const generateSolveFirstSingles = async ({
    topic,
    bankName,
    difficulty,
    singleCount,
    excludeQuestionTexts = [],
    excludeArchetypes = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
    topicRelevanceFeedback = null,
    generateIntent = "initial",
    examReferenceBlock = "",
    competitiveExamPlan = null,
    provider = "gemini",
    genTemperature,
    slotOffset = 0,
    difficultyResolution = null,
    maxSelectableSlots = 0,
    skipSkeletonDifficultyAudit = false,
    streamPartials = true,
    presetSteering = null,
    referenceCalibrationBlock = "",
    retrievedQuestionContextBlock = "",
    auditStats = null,
}) => {
    const effectiveDifficulty =
        difficultyResolution?.generationDifficulty || difficulty;
    const examNativeVeteran = isExamNativeVeteranGeneration(difficultyResolution);
    const skipLlmDifficultyAudit =
        skipSkeletonDifficultyAudit ||
        shouldSkipLlmDifficultySelfAudit(difficultyResolution);
    const mixOpts = mixOptionsFromResolution(difficultyResolution);
    const callRepairLlm = (repairPrompt) =>
        callQuestionBankGenerationLLM(repairPrompt, {
            generationProvider: provider,
            temperature: 0.1,
        });
    const examProfile = getSolveFirstExamProfile({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });
    const { catSection } = resolveExamContextForGeneration({
        competitiveExamPlan,
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });
    const subjectId = getSolveFirstSubjectId({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
        topicRelevanceFeedback,
        generateIntent,
    });
    const archetypeOffset =
        slotOffset + Math.max(0, excludeQuestionTexts?.length || 0);
    const steering = presetSteering
        ? presetSteering
        : await resolveConceptArchetypeSteering(
        {
            count: singleCount,
            topic,
            bankName,
            subject,
            subjectId,
            examProfile,
            catSection,
            bankDifficulty: effectiveDifficulty,
            examCalibrated: difficultyResolution?.examCalibrated || false,
            excludeArchetypes,
            excludeQuestionTexts,
            slotOffset: archetypeOffset,
            subjects: competitiveExamPlan?.subjects,
            preferPeak:
                difficultyResolution?.examCalibrated ||
                isVeteranDifficultyEnabled() ||
                String(effectiveDifficulty || "").toLowerCase() === "hard",
            topicRelevanceFeedback,
            generateIntent,
        },
        {
            callLlm: (planPrompt) =>
                callQuestionBankGenerationLLM(planPrompt, {
                    generationProvider: provider,
                    temperature: 0.25,
                }),
        }
    );
    // Local copies — swap-after-failures below mutates these per-attempt, and
    // steering may be a caller-supplied presetSteering shared across other calls.
    let conceptSlots = [...(steering.conceptSlots || [])];
    let slotPlans = [...(steering.slotPlans || [])];

    // Phase C1: enrich to blueprints; drive per-slot difficulty tiers from plan.
    let blueprints =
        Array.isArray(steering.blueprints) && steering.blueprints.length
            ? steering.blueprints
            : isBlueprintPlannerEnabled()
              ? enrichSlotPlansToBlueprints(slotPlans, {
                    topic,
                    bankDifficulty: effectiveDifficulty,
                    examProfile,
                    examCalibrated: difficultyResolution?.examCalibrated || false,
                    catSection,
                    subject: subjectId || subject,
                })
              : [];
    if (blueprints.length && isBlueprintPlannerEnabled()) {
        const mapped = blueprintsToPresetSteering(blueprints, steering.source || "blueprint");
        conceptSlots = [...mapped.conceptSlots];
        slotPlans = [...mapped.slotPlans];
        pipelineTrace("BLUEPRINT_PLAN_APPLIED", {
            slots: blueprints.length,
            difficulties: blueprints.map((b) => b.difficulty),
        });
    }

    // Slot → question kind (calculative | theory), so the hard-quality gate judges
    // theory items on concept depth instead of numeric givens / solve steps.
    const kindBySlot = Object.fromEntries(
        (slotPlans || [])
            .filter((p) => p?.conceptSlot)
            .map((p) => [p.conceptSlot, p.questionKind || "multi_concept"])
    );
    const difficultyTierSlots =
        blueprints.length === singleCount
            ? blueprints.map((b) =>
                  String(b.difficulty || effectiveDifficulty || "hard").toLowerCase()
              )
            : buildDifficultyTierSlots(
                  singleCount,
                  effectiveDifficulty,
                  mixOpts
              );

    // Phase C9: route provider by dominant difficulty in this batch.
    const dominantDifficulty =
        difficultyTierSlots.filter((t) => t === "hard").length >=
        Math.ceil(difficultyTierSlots.length / 2)
            ? "hard"
            : difficultyTierSlots.filter((t) => t === "easy").length >=
                Math.ceil(difficultyTierSlots.length / 2)
              ? "easy"
              : "medium";
    const routedProvider = resolveProviderForDifficulty(
        dominantDifficulty,
        provider
    );
    if (routedProvider !== provider) {
        pipelineTrace("DIFFICULTY_MODEL_ROUTE", {
            from: provider,
            to: routedProvider,
            dominantDifficulty,
        });
    }
    const activeProvider = routedProvider;

    // Hard / exam-calibrated batches use a stronger Gemini model (not flash-lite).
    // Flash-lite is the dominant source of first-stage arithmetic + option-key errors.
    const generationModel =
        activeProvider === "gemini"
            ? resolveGeminiTextModelForTier({
                  difficulty: effectiveDifficulty,
                  examCalibrated: difficultyResolution?.examCalibrated || false,
              })
            : activeProvider === "openai"
              ? String(
                    process.env.OPENAI_QB_HARD_GENERATION_MODEL ||
                        process.env.OPENAI_QB_GENERATION_MODEL ||
                        process.env.OPENAI_CHAT_MODEL ||
                        ""
                ).trim() || undefined
              : undefined;
    if (generationModel) {
        pipelineTrace("GENERATION_MODEL_TIER", {
            provider: activeProvider,
            model: generationModel,
            difficulty: effectiveDifficulty,
            examCalibrated: !!difficultyResolution?.examCalibrated,
        });
        console.log(
            `[ai-qb] stage-A generation model: ${activeProvider}/${generationModel} (tier=${effectiveDifficulty}${
                difficultyResolution?.examCalibrated ? ", examCalibrated" : ""
            })`
        );
    }

    let questions = [];
    let runningExclude = [...excludeQuestionTexts];
    const batchSeenStems = [];
    let attempts = 0;
    let priorAttemptFeedback = [];
    const solveFirstMaxAttempts = getSolveFirstMaxAttempts({ examProfile });
    const hardTier =
        String(effectiveDifficulty || "").toLowerCase().includes("hard") ||
        !!difficultyResolution?.examCalibrated;
    const llmTemperature = resolveGenerationTemperature(activeProvider, {
        // Harder math needs lower sampling noise for answer stability.
        genTemperature:
            genTemperature != null
                ? genTemperature
                : hardTier
                  ? 0.05
                  : undefined,
        defaultTemp: hardTier ? 0.05 : 0.1,
        openaiDefault: hardTier ? 0.1 : 0.15,
    });

    // Phase C2: difficulty calibration exemplars (optional RAG grounding).
    let calibrationBlock = retrievedQuestionContextBlock || "";
    if (
        isDifficultyCalibrationEnabled() &&
        !calibrationBlock &&
        dominantDifficulty
    ) {
        try {
            const cal = await retrieveDifficultyCalibration({
                topic,
                bankName,
                subject: subjectId || subject,
                sectionName,
                difficulty: dominantDifficulty,
                conceptHints: conceptSlots.slice(0, 6),
                k: 4,
            });
            if (cal.calibrationBlock) {
                calibrationBlock = cal.calibrationBlock;
            }
        } catch (err) {
            pipelineTrace("DIFFICULTY_CALIBRATION_FAILED", {
                error: err?.message || String(err),
            });
        }
    }
    if (examNativeVeteran) {
        pipelineTrace("VETERAN_GENERATION_STRATEGY", {
            skeletonDifficultyAudit: !skipLlmDifficultyAudit,
            mandateRepair: isMandateRepairEnabled(),
            llmDifficultyAudit: !skipLlmDifficultyAudit,
            repairOnFail: isRepairOnFailEnabled(),
            regenOnFail: !isRepairOnFailEnabled(),
            maxAttempts: solveFirstMaxAttempts,
        });
        if (skipLlmDifficultyAudit) {
            pipelineTrace("SKIP_LLM_DIFFICULTY_AUDIT", {
                reason: "exam_native_trust_generation",
                examProfile,
            });
        }
    }

    let skeletonAuditRan = false;
    let minKeptSkeletonScore = Infinity;

    // Some archetypes are structurally capped below the veteran-hard bar (classic
    // single-formula topics like SHM energy or Bernoulli-orifice flow) and no amount
    // of rewriting with feedback gets them past it — they were burning the entire
    // attempt budget getting rejected on the SAME topic every attempt. After a slot
    // fails the audit this many times in a row, swap it for a fresh archetype instead.
    const ARCHETYPE_SWAP_AFTER_FAILURES = Math.max(
        1,
        Number(process.env.AI_QB_ARCHETYPE_SWAP_AFTER_FAILURES ?? 2)
    );
    const archetypeFailureCounts = new Map();
    const archetypesEverUsed = new Set(conceptSlots.filter(Boolean));

    while (
        questions.length < singleCount &&
        attempts < solveFirstMaxAttempts
    ) {
        attempts += 1;

        for (let i = questions.length; i < singleCount; i++) {
            const currentArchetype = conceptSlots[i];
            if (!currentArchetype) continue;
            const failCount = archetypeFailureCounts.get(currentArchetype) || 0;
            if (failCount < ARCHETYPE_SWAP_AFTER_FAILURES) continue;

            // Prefer on-syllabus replacements. For curated JEE Maths hard banks,
            // never swap into probability/trig fluff slots that break blueprint lock
            // (paper-quality lock: 2026-08-01_11-25-30 curated-5 stage).
            const curatedMathOnly =
                process.env.AI_QB_CURATED_MATH_SLOTS_ONLY === "1" ||
                process.env.AI_QB_CURATED_MATH_SLOTS_ONLY === "true";
            const mathSwapOk = (name = "") => {
                const s = String(name || "").toLowerCase().trim();
                if (!s) return false;
                if (curatedMathOnly) {
                    // Off-lock / fluff chapters and bare non-multi archetypes.
                    if (
                        /^(probability|trigonometry|algebra|statistics)$/.test(s) ||
                        /probability|bayes|permutation|combination|binomial_coeff|statistics|heron|triangle_sides|random_variable|bayesian/.test(
                            s
                        )
                    ) {
                        return false;
                    }
                    // Only multi-technique curated-5 patterns (coord-geo / LCD /
                    // integrals / matrices / DE) — reject bare single-word generics.
                    return /area_|integral|limit|contin|diff|implicit|maxima|minima|circle|chord|parabola|ellipse|hyperbola|locus|tangent|matrix|determinant|coordinate|calculus|de_|differential|piecewise|series_limit|trig_limit|definite|line_and|derivative|family_of_lines|even_odd|kings_property|homogeneous/.test(
                        s
                    );
                }
                return true;
            };

            let replacement = null;
            for (let tryN = 0; tryN < 8 && !replacement; tryN++) {
                const [cand] = allocateRankedConceptSlots(1, {
                    examProfile,
                    subjectId,
                    slotOffset: archetypeOffset + i + attempts * 100 + tryN * 17,
                    subjects: competitiveExamPlan?.subjects,
                    preferPeak:
                        difficultyResolution?.examCalibrated ||
                        isVeteranDifficultyEnabled() ||
                        String(effectiveDifficulty || "").toLowerCase() ===
                            "hard",
                    bankDifficulty: effectiveDifficulty,
                    excludeArchetypes: [
                        ...excludeArchetypes,
                        ...Array.from(archetypesEverUsed),
                    ],
                    maxPerArchetype: 1,
                });
                if (cand && cand !== currentArchetype && mathSwapOk(cand)) {
                    replacement = cand;
                }
            }
            if (replacement && replacement !== currentArchetype) {
                pipelineTrace("ARCHETYPE_SWAPPED_AFTER_FAILURES", {
                    slotIndex: i,
                    from: currentArchetype,
                    to: replacement,
                    failures: failCount,
                    attempt: attempts,
                    curatedMathOnly,
                });
                conceptSlots[i] = replacement;
                slotPlans[i] = {
                    conceptSlot: replacement,
                    label: "",
                    questionKind: "multi_concept",
                };
                archetypesEverUsed.add(replacement);
                archetypeFailureCounts.delete(currentArchetype);
            }
        }

        const need = singleCount - questions.length;
        const slots = conceptSlots.slice(
            questions.length,
            questions.length + need
        );
        const tiers = difficultyTierSlots.slice(
            questions.length,
            questions.length + need
        );

        const slicePlans = slotPlans.slice(
            questions.length,
            questions.length + need
        );
        const sliceBlueprints =
            blueprints.length > questions.length
                ? blueprints.slice(questions.length, questions.length + need)
                : enrichSlotPlansToBlueprints(slicePlans, {
                      topic,
                      bankDifficulty: effectiveDifficulty,
                      examProfile,
                      examCalibrated:
                          difficultyResolution?.examCalibrated || false,
                      catSection,
                      subject: subjectId || subject,
                  });
        const blueprintBlock = buildBlueprintGenerationBlock(sliceBlueprints);

        const prompt = buildSolveFirstSkeletonPrompt({
            topic,
            bankName,
            difficulty: effectiveDifficulty,
            count: need,
            conceptSlots: slots,
            slotPlans: slicePlans,
            archetypeSteeringSource: steering.source,
            difficultyTierSlots: tiers,
            excludeQuestionTexts: runningExclude,
            excludeArchetypes: [
                ...excludeArchetypes,
                ...questions.map((q) => q._conceptSlot).filter(Boolean),
            ],
            categoryPaths,
            sectionName,
            subject,
            examProfile,
            examReferenceBlock: [blueprintBlock, examReferenceBlock]
                .filter(Boolean)
                .join("\n"),
            difficultyResolution,
            slotOffset: archetypeOffset + questions.length,
            generateIntent,
            topicRelevanceFeedback,
            maxSelectableSlots,
            referenceCalibrationBlock,
            retrievedQuestionContextBlock:
                calibrationBlock || retrievedQuestionContextBlock,
            priorAttemptFeedback,
        });

        const rawText = await callQuestionBankGenerationLLM(prompt, {
            generationProvider: activeProvider,
            temperature: llmTemperature,
            model: generationModel,
        });

        let skeletons = [];
        try {
            skeletons = parseSolveFirstSkeletons(rawText);
        } catch (err) {
            pipelineTrace('SKELETON_PARSE_FAILED', {
                attempt: attempts,
                error: err?.message || String(err),
            });
            console.warn(
                `[solve-first] attempt ${attempts}/${solveFirstMaxAttempts}: JSON parse failed — ${err?.message || err}`
            );
            continue;
        }

        if (!skeletons.length) {
            pipelineTrace('SKELETON_PARSE_EMPTY', {
                attempt: attempts,
                requested: need,
            });
            console.warn(
                `[solve-first] attempt ${attempts}/${solveFirstMaxAttempts}: no parseable skeletons for ${need} slot(s)`
            );
            continue;
        }

        // Root-cause-1 fix from the correctness review: deterministic SymPy
        // re-derivation, BEFORE the (expensive, LLM-opinion-only) difficulty
        // self-audit and before hardQuestionMandate. A skeleton whose claimed
        // answer provably disagrees with an independent re-derivation from its
        // own declared `givens` is hard-rejected here — no LLM judgment call.
        // Skeletons with no/unrecognized archetype (most non-Maths subjects,
        // and Maths patterns the CAS doesn't cover yet) pass through unchanged.
        const casResult = await filterSkeletonsByCasVerification(skeletons);
        if (casResult.rejected.length) {
            console.warn(
                `[solve-first] attempt ${attempts}/${solveFirstMaxAttempts}: CAS verifier rejected ${casResult.rejected.length}/${skeletons.length} skeleton(s) — ` +
                    casResult.rejected
                        .map((r) => `${r.skeleton?.conceptSlot || "?"} (computed=${r.result.computedAnswer}, claimed=${r.result.claimedAnswer})`)
                        .join("; ")
            );
        }
        skeletons = casResult.kept;

        if (!skeletons.length) {
            pipelineTrace('SKELETON_CAS_VERIFY_ALL_REJECTED', {
                attempt: attempts,
                requested: need,
            });
            continue;
        }

        const skeletonAudit = skipLlmDifficultyAudit
            ? {
                  skeletons,
                  keptIndices: skeletons.map((_, i) => i),
                  rejectedCount: 0,
                  rejected: [],
              }
            : await applySkeletonDifficultySelfAuditGate(
            skeletons,
            {
                topic,
                bankName,
                difficulty: effectiveDifficulty,
                examProfile,
                minScore: SKELETON_DIFFICULTY_SELF_AUDIT_MIN_SCORE,
                tierSlots: tiers,
                kindSlots: slots.map((s) => kindBySlot[s] || "multi_concept"),
                isLastAttempt: attempts >= solveFirstMaxAttempts,
            },
            {
                callLlm: (auditPrompt) =>
                    callQuestionBankGenerationLLM(auditPrompt, {
                        generationProvider: provider,
                        temperature: 0.1,
                    }),
            }
        );

        for (const r of skeletonAudit.rejected || []) {
            if (!r.conceptSlot) continue;
            archetypeFailureCounts.set(
                r.conceptSlot,
                (archetypeFailureCounts.get(r.conceptSlot) || 0) + 1
            );
        }

        // Carry this attempt's rejection reasons into the NEXT attempt's prompt so
        // regeneration targets the auditor's named weaknesses instead of blindly
        // resampling the same instructions at the same reject rate.
        priorAttemptFeedback = skeletonAudit.rejected?.length
            ? skeletonAudit.rejected.map((r) => ({
                  conceptSlot: r.conceptSlot,
                  difficultyScore: r.difficultyScore,
                  reason: r.reason,
              }))
            : [];
        if (priorAttemptFeedback.length) {
            pipelineTrace("DIFFICULTY_REGEN_FEEDBACK_CARRIED", {
                attempt: attempts,
                nextAttempt: attempts + 1,
                count: priorAttemptFeedback.length,
                sample: priorAttemptFeedback
                    .slice(0, 3)
                    .map((r) => `${r.conceptSlot || "?"}:${r.difficultyScore}`),
            });
        }

        if (!skipLlmDifficultyAudit && Array.isArray(skeletonAudit.scores)) {
            skeletonAuditRan = true;
            // Only count this attempt's scores toward the margin when nothing
            // was rejected — in that case every scored item is a kept item,
            // so there's no index mismatch between `scores` and `keptIndices`.
            // A mixed attempt (some rejected) is left out of the margin signal
            // entirely rather than risk crediting a rejected item's low score
            // (or a kept item's) to the wrong bucket.
            if (skeletonAudit.rejectedCount === 0) {
                for (const row of skeletonAudit.scores) {
                    if (Number.isFinite(row?.difficultyScore)) {
                        minKeptSkeletonScore = Math.min(
                            minKeptSkeletonScore,
                            row.difficultyScore
                        );
                    }
                }
            }
        }

        const alignSlotsForIndices = (indices) => ({
            alignedSlots: indices.map((i) => slots[i] ?? ""),
            alignedTiers: indices.map((i) => tiers[i] ?? tiers[0] ?? "medium"),
        });

        let batchQuestions = [];

        if (skeletonAudit.skeletons.length) {
            const { alignedSlots, alignedTiers } = alignSlotsForIndices(
                skeletonAudit.keptIndices ??
                    skeletonAudit.skeletons.map((_, i) => i)
            );
            pipelineTrace("SKELETON_LLM_RESPONSE", {
                attempt: attempts,
                parsed: skeletonAudit.skeletons.length,
                requested: need,
                conceptSlots: alignedSlots,
                phase: "initial_pass",
            });
            const keptBatch = await skeletonsToQuestions(
                skeletonAudit.skeletons,
                alignedTiers,
                alignedSlots,
                {
                    batchSeenStems,
                    examCalibrated: difficultyResolution?.examCalibrated || false,
                    publishPartials: streamPartials,
                },
                { callLlm: callRepairLlm, examProfile, subject, kindBySlot, topic, bankName }
            );
            batchQuestions = batchQuestions.concat(keptBatch);
        }

        if (skeletonAudit.rejected?.length) {
            if (isRepairOnFailEnabled()) {
                const repairedRows = await repairSkeletonAuditRejections(
                    skeletonAudit.rejected,
                    {
                        examProfile,
                        examCalibrated:
                            difficultyResolution?.examCalibrated || false,
                        conceptSlots: slots,
                    },
                    { callLlm: callRepairLlm }
                );
                for (const row of repairedRows) {
                    const skeletonIndex = row.skeletonIndex;
                    const { alignedSlots, alignedTiers } = alignSlotsForIndices([
                        skeletonIndex,
                    ]);
                    const repairedBatch = await skeletonsToQuestions(
                        [row.skeleton],
                        alignedTiers,
                        alignedSlots,
                        {
                            batchSeenStems,
                            examCalibrated:
                                difficultyResolution?.examCalibrated || false,
                            publishPartials: streamPartials,
                        },
                        { callLlm: callRepairLlm, examProfile, subject, kindBySlot, topic, bankName }
                    );
                    batchQuestions = batchQuestions.concat(repairedBatch);
                }
                if (repairedRows.length) {
                    pipelineTrace("SKELETON_DIFFICULTY_REPAIRED", {
                        count: repairedRows.length,
                        rejected: skeletonAudit.rejectedCount,
                    });
                }
            } else {
                pipelineTrace("SKELETON_DIFFICULTY_DEFER_REGEN", {
                    kept: skeletonAudit.skeletons.length,
                    rejected: skeletonAudit.rejectedCount,
                    deficit: need - batchQuestions.length,
                });
            }
        }

        if (!batchQuestions.length) {
            pipelineTrace("SKELETON_BUILD_EMPTY", {
                attempt: attempts,
                parsed: skeletons.length,
            });
            continue;
        }

        const verifiedBatch = [];
        for (const q of batchQuestions) {
            try {
                assertGenerationCorrectness(
                    q,
                    questions.length + verifiedBatch.length + 1
                );
                verifiedBatch.push(q);
            } catch (err) {
                pipelineTrace("GENERATION_CORRECTNESS_REJECT", {
                    attempt: attempts,
                    error: err?.message || String(err),
                    stem: String(q?.questionText || "").slice(0, 120),
                });
            }
        }
        batchQuestions = verifiedBatch;

        if (!batchQuestions.length) {
            pipelineTrace("SKELETON_CORRECTNESS_EMPTY", {
                attempt: attempts,
                parsed: skeletons.length,
            });
            continue;
        }

        questions = questions.concat(batchQuestions);
        runningExclude = [
            ...runningExclude,
            ...batchQuestions.map((q) => q.questionText).filter(Boolean),
        ];

        pipelineTrace("SKELETON_BATCH_OK", {
            attempt: attempts,
            built: batchQuestions.length,
            requested: need,
            total: questions.length,
            target: singleCount,
        });
        console.log(
            `[solve-first] attempt ${attempts}: ${batchQuestions.length}/${need} built (${questions.length}/${singleCount} total)`
        );
        continue;
    }

    if (questions.length < singleCount) {
        const deficit = singleCount - questions.length;
        if (generateIntent === "evaluation_regen") {
            pipelineTrace("SOLVE_FIRST_REGEN_PARTIAL", {
                produced: questions.length,
                target: singleCount,
                deficit,
                attempts,
            });
            console.warn(
                `[solve-first] evaluation_regen: ${questions.length}/${singleCount} after ${attempts} attempt(s) — no one-shot fallback (use targeted merge)`
            );
        } else if (
            difficultyResolution?.examCalibrated &&
            isVeteranDifficultyEnabled() &&
            questions.length > 0
        ) {
            // Partial veteran yield — keep what passed gates; don't dilute with easy filler.
            pipelineTrace("SOLVE_FIRST_VETERAN_NO_FALLBACK", {
                produced: questions.length,
                target: singleCount,
                deficit,
                attempts,
            });
            console.warn(
                `[solve-first] veteran mode: ${questions.length}/${singleCount} after ${attempts} attempt(s) — no one-shot fallback (quality over easy filler)`
            );
        } else {
            // Includes veteran total wipeout (produced===0): empty UI is worse than
            // a fallback batch that still goes through finalize correctness gates.
            const emergencyVeteranWipeout =
                difficultyResolution?.examCalibrated &&
                isVeteranDifficultyEnabled() &&
                questions.length === 0;
            pipelineTrace(
                emergencyVeteranWipeout
                    ? "SOLVE_FIRST_VETERAN_EMERGENCY_FALLBACK"
                    : "SOLVE_FIRST_FALLBACK",
                {
                    produced: questions.length,
                    target: singleCount,
                    deficit,
                    attempts,
                }
            );
            console.warn(
                `[solve-first] ${questions.length}/${singleCount} after ${attempts} attempt(s) — ${
                    emergencyVeteranWipeout ? "emergency " : ""
                }one-shot fallback for ${deficit}`
            );

            const fallbackPrompt = buildQuestionBankPrompt({
                topic,
                bankName,
                difficulty,
                singleCount: deficit,
                multipleCount: 0,
                trueFalseCount: 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
                connectedCount: 0,
                excludeQuestionTexts: runningExclude,
                categoryPaths,
                sectionName,
                subject,
                topicRelevanceFeedback,
                generateIntent,
                maxSelectableSlots: 0,
                examReferenceBlock,
                competitiveExamPlan,
            });

            const fallbackRaw = await callQuestionBankGenerationLLM(fallbackPrompt, {
                generationProvider: activeProvider || provider,
                temperature: llmTemperature,
                model: generationModel,
            });

            const fallbackExpected = {
                singleCount: deficit,
                multipleCount: 0,
                trueFalseCount: 0,
                connectedCount: 0,
                passageCount: 0,
                passageSingleCount: 0,
                passageMultipleCount: 0,
                passageTrueFalseCount: 0,
            };
            const fallbackParsed = parseQuestionBankAIResponse(
                fallbackRaw,
                fallbackExpected
            );

            const verifiedFallback = [];
            for (const q of fallbackParsed) {
                try {
                    assertGenerationCorrectness(
                        q,
                        questions.length + verifiedFallback.length + 1
                    );
                    verifiedFallback.push(q);
                } catch (err) {
                    pipelineTrace("GENERATION_CORRECTNESS_REJECT", {
                        attempt: attempts,
                        source: emergencyVeteranWipeout
                            ? "solve_first_veteran_emergency_fallback"
                            : "solve_first_fallback",
                        error: err?.message || String(err),
                        stem: String(q?.questionText || "").slice(0, 120),
                    });
                }
            }
            pipelineTrace("SOLVE_FIRST_FALLBACK_VERIFIED", {
                produced: fallbackParsed.length,
                accepted: verifiedFallback.length,
                emergencyVeteranWipeout,
            });
            questions = questions.concat(verifiedFallback);
        }
    }

    if (auditStats) {
        auditStats.ranSkeletonAudit = skeletonAuditRan;
        auditStats.minKeptScore = Number.isFinite(minKeptSkeletonScore)
            ? minKeptSkeletonScore
            : null;
    }

    let finalized = questions.slice(0, singleCount);

    // Stamp blueprint metadata onto each question (1:1 when lengths match).
    if (blueprints.length) {
        finalized = finalized.map((q, i) => {
            const b = blueprints[i];
            if (!b) return q;
            return {
                ...q,
                difficulty: b.difficulty || q.difficulty,
                difficultyTier: b.difficulty || q.difficultyTier,
                _conceptSlot: q._conceptSlot || b.conceptSlot,
                _questionKind: q._questionKind || b.questionKind,
                _blueprint: b,
                blooms: b.blooms,
                estimatedTime: b.estimatedTime,
            };
        });
    } else {
        finalized = assignDifficultyTiersToQuestions(
            finalized,
            effectiveDifficulty,
            mixOpts
        );
    }

    // Phase C8: formula allow-list / impossible-pattern gate
    {
        const formulaResult = runFormulaValidationPass(finalized, { topic });
        finalized = formulaResult.questions;
    }

    // Phase C6: dedicated distractor pass
    if (isDistractorPassEnabled()) {
        try {
            const dist = await runDistractorPass(finalized, {
                topic,
                callLlm: (prompt) =>
                    callQuestionBankGenerationLLM(prompt, {
                        generationProvider: activeProvider,
                        temperature: 0.35,
                    }),
            });
            finalized = dist.questions;
        } catch (err) {
            pipelineTrace("DISTRACTOR_PASS_ERROR", {
                error: err?.message || String(err),
            });
        }
    }

    return finalized;
};

/**
 * Generate one LLM batch for explicit question counts (single API call).
 */
const generateQuestionBankBatch = async ({
    topic,
    bankName,
    difficulty,
    singleCount,
    multipleCount,
    trueFalseCount,
    passageCount,
    passageSingleCount,
    passageMultipleCount,
    passageTrueFalseCount,
    excludeQuestionTexts = [],
    excludeArchetypes = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
    topicRelevanceFeedback = null,
    generateIntent = "initial",
    maxSelectableSlots = 0,
    examReferenceBlock = "",
    competitiveExamPlan = null,
    provider = "gemini",
    genTemperature,
    allowTopUp = true,
    chunkIndex = 0,
    chunkTotal = 1,
    forceOneShot = false,
    tierSlotOffset = 0,
    totalBatchSelectable = null,
    difficultyResolution = null,
    deferValidation = false,
    skipFinalizeDifficultyAudit = false,
    topUpWave = 0,
    generationMode = "default",
    promptFirstComposedBody = null,
    promptFirstComposeSource = null,
    promptBasedGenRun = null,
    presetSteering = null,
    cachedRagRetrieval = null,
}) => {
    const promptFirst = isPromptFirstGenerationMode(generationMode);
    // IMPORTANT: deferValidation only skips full finalize (eval/regen loops).
    // It must NOT skip Stage-A skeleton difficulty audit — that was shipping
    // Easy/Medium drills as Hard on the questions-only path.
    const skipLlmDifficultyAudit =
        skipFinalizeDifficultyAudit ||
        shouldSkipLlmDifficultySelfAudit(difficultyResolution);

    if (promptFirst) {
        pipelineTrace("PROMPT_FIRST_BATCH", {
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            composeSource: promptFirstComposeSource || "per_chunk_static",
        });

        const expectedCounts = {
            singleCount,
            multipleCount,
            trueFalseCount,
            connectedCount: passageCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
        };

        const chunkPromptParams = {
            topic,
            bankName,
            sectionName,
            categoryPaths,
            subject,
            difficulty,
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
            excludeQuestionTexts,
        };

        const chunkLabel = String(chunkIndex + 1).padStart(2, "0");

        const requiredApiItems =
            singleCount + multipleCount + trueFalseCount + passageCount;
        const maxPromptFirstAttempts = Math.max(
            1,
            Number(process.env.AI_QB_PROMPT_FIRST_MAX_ATTEMPTS ?? 2)
        );

        const promptFirstTemperature = Math.min(
            1,
            Math.max(
                0.2,
                Number(process.env.AI_QB_PROMPT_FIRST_TEMPERATURE ?? 0.35)
            )
        );

        const accepted = [];
        const seenStems = new Set(
            (excludeQuestionTexts || []).map((t) =>
                String(t || "").trim().toLowerCase()
            )
        );
        let remaining = {
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
        };

        for (let attempt = 1; attempt <= maxPromptFirstAttempts; attempt++) {
            const need =
                remaining.singleCount +
                remaining.multipleCount +
                remaining.trueFalseCount +
                remaining.passageCount;
            if (need <= 0) break;

            const attemptParams = {
                ...chunkPromptParams,
                ...remaining,
                excludeQuestionTexts: [
                    ...excludeQuestionTexts,
                    ...accepted.map((q) => q.questionText).filter(Boolean),
                ],
            };
            const prompt = promptFirstComposedBody
                ? appendJsonOutputToComposedPrompt(
                      promptFirstComposedBody,
                      attemptParams
                  )
                : buildPromptFirstQuestionBankPrompt(attemptParams);

            if (attempt === 1) {
                pipelineTrace("PROMPT_FIRST_BUILT", {
                    promptLength: prompt.length,
                    composed: Boolean(promptFirstComposedBody),
                    examProfile: detectExamProfile({
                        topic,
                        bankName,
                        subject,
                        sectionName,
                        categoryPaths,
                    }),
                });
            }

            promptBasedGenRun?.save(
                `chunk-${chunkLabel}-generation-prompt-attempt-${attempt}.txt`,
                prompt
            );

            const rawText = await callQuestionBankGenerationLLM(prompt, {
                generationProvider: provider,
                temperature: genTemperature ?? promptFirstTemperature,
            });
            promptBasedGenRun?.save(
                `chunk-${chunkLabel}-generation-response-attempt-${attempt}.txt`,
                rawText
            );

            const parsed = parseQuestionBankAIResponseSoft(rawText);
            const sanitized = preparePromptFirstQuestions(parsed);
            let addedSingles = 0;
            let addedMultiple = 0;
            let addedTf = 0;
            let addedPassages = 0;

            for (const q of sanitized) {
                const type = String(q.questionType || "single").toLowerCase();
                const stemKey = String(q.questionText || q.passage || "")
                    .trim()
                    .toLowerCase();
                if (!stemKey || seenStems.has(stemKey)) continue;
                if (type === "connected") {
                    if (addedPassages >= remaining.passageCount) continue;
                    addedPassages += 1;
                } else if (type === "multiple") {
                    if (addedMultiple >= remaining.multipleCount) continue;
                    addedMultiple += 1;
                } else if (type === "true_false") {
                    if (addedTf >= remaining.trueFalseCount) continue;
                    addedTf += 1;
                } else {
                    if (addedSingles >= remaining.singleCount) continue;
                    addedSingles += 1;
                }
                seenStems.add(stemKey);
                accepted.push(q);
            }

            remaining = {
                singleCount: Math.max(0, remaining.singleCount - addedSingles),
                multipleCount: Math.max(
                    0,
                    remaining.multipleCount - addedMultiple
                ),
                trueFalseCount: Math.max(0, remaining.trueFalseCount - addedTf),
                passageCount: Math.max(0, remaining.passageCount - addedPassages),
                passageSingleCount: remaining.passageSingleCount,
                passageMultipleCount: remaining.passageMultipleCount,
                passageTrueFalseCount: remaining.passageTrueFalseCount,
            };

            pipelineTrace("PROMPT_FIRST_FILL_PASS", {
                attempt,
                accepted: accepted.length,
                required: requiredApiItems,
                remaining:
                    remaining.singleCount +
                    remaining.multipleCount +
                    remaining.trueFalseCount +
                    remaining.passageCount,
                sanitized: sanitized.length,
            });
        }

        const fastQuestions = accepted.slice(0, requiredApiItems);

        promptBasedGenRun?.save(`chunk-${chunkLabel}-parsed-summary.json`, {
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            expectedCounts,
            maxAttempts: maxPromptFirstAttempts,
            outputCount: fastQuestions.length,
            requiredApiItems,
        });

        pipelineTrace("BATCH_DONE", {
            mode: deferValidation ? "prompt-first-deferred" : "prompt-first",
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            outputCount: fastQuestions.length,
            composeSource: promptFirstComposeSource || undefined,
        });
        return {
            questions: fastQuestions,
            stats: {
                mode: "prompt_first",
                composeSource: promptFirstComposeSource || "static",
                requested: requiredApiItems,
                outputCount: fastQuestions.length,
            },
        };
    }

    if (isPaperReferenceGenerationMode(generationMode)) {
        const referenceExamProfile = detectExamProfile({
            topic,
            bankName,
            subject,
            sectionName,
            categoryPaths,
        });

        pipelineTrace("PAPER_REFERENCE_BATCH", {
            singleCount,
            examProfile: referenceExamProfile,
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
        });

        const { difficultyCalibration } = await extractReferencePaperGuidance({
            examProfile: referenceExamProfile,
            callLlmText: (extractionPrompt, opts = {}) =>
                callQuestionBankGenerationLLMText(extractionPrompt, {
                    generationProvider: provider,
                    ...opts,
                }),
        });

        // Topic/concept-slot planning stays fully AI-driven here — same
        // archetype planner as the default solve-first path. The reference
        // paper contributes ONLY the difficulty-floor text below; it never
        // defines or constrains which slots/topics get generated.
        const paperReferenceAuditStats = {};
        const questions = await generateSolveFirstSingles({
            topic,
            bankName,
            difficulty,
            singleCount,
            excludeQuestionTexts,
            excludeArchetypes,
            categoryPaths,
            sectionName,
            subject,
            topicRelevanceFeedback,
            generateIntent,
            examReferenceBlock,
            competitiveExamPlan,
            provider,
            genTemperature,
            slotOffset: tierSlotOffset,
            difficultyResolution,
            maxSelectableSlots,
            skipSkeletonDifficultyAudit: skipLlmDifficultyAudit,
            streamPartials: topUpWave === 0,
            referenceCalibrationBlock: difficultyCalibration,
            auditStats: paperReferenceAuditStats,
        });

        if (deferValidation) {
            const fastQuestions = prepareFastPathQuestions(questions, {
                examCalibrated: difficultyResolution?.examCalibrated,
            });
            pipelineTrace("BATCH_DONE", {
                mode: "paper-reference-deferred",
                chunk: `${chunkIndex + 1}/${chunkTotal}`,
                outputCount: fastQuestions.length,
            });
            return { questions: fastQuestions, stats: { mode: "deferred" } };
        }

        const finalized = await finalizeQuestionBankSuggestions({
            questions,
            topic,
            bankName,
            difficulty,
            generationProvider: provider,
            excludeQuestionTexts,
            categoryPaths,
            sectionName,
            subject,
            examReferenceBlock,
            competitiveExamPlan,
            generateIntent,
            maxSelectableSlots,
            allowTopUp,
            difficultyResolution,
            skipDifficultyAudit: shouldSkipFinalizeDifficultyAudit(
                skipLlmDifficultyAudit,
                paperReferenceAuditStats,
                difficultyResolution
            ),
            topUpWave,
        });
        pipelineTrace("BATCH_DONE", {
            mode: "paper-reference",
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            outputCount: unwrapFinalizedQuestions(finalized).length,
        });
        return finalized;
    }

    if (isQuestionRagGenerationMode(generationMode)) {
        pipelineTrace("QUESTION_RAG_BATCH", {
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            topic,
            subject,
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
        });

        const conceptHints = [
            ...(Array.isArray(presetSteering?.conceptSlots)
                ? presetSteering.conceptSlots
                : []),
            ...(Array.isArray(presetSteering?.slotPlans)
                ? presetSteering.slotPlans.map(
                      (p) => p?.label || p?.conceptSlot || ""
                  )
                : []),
        ];

        const retrieval =
            cachedRagRetrieval ||
            (await retrieveSimilarConfirmedQuestions({
                topic,
                bankName,
                subject,
                sectionName,
                conceptHints,
                difficulty,
            }));

        const {
            retrievedQuestionContextBlock,
            exemplarStems,
            exemplarSnippets,
            corpusTexts,
            ragMeta: retrievalMeta,
        } = retrieval;

        if (cachedRagRetrieval) {
            pipelineTrace("QUESTION_RAG_CACHE_HIT", {
                returned: retrievalMeta?.returned || 0,
                chunk: `${chunkIndex + 1}/${chunkTotal}`,
            });
        }

        // Generate with RAG is strict: no silent fallback to ungrounded generation.
        if (!retrievalMeta?.hit || !exemplarStems?.length) {
            const reason = retrievalMeta?.reason || "no_matching_bank";
            pipelineTrace("QUESTION_RAG_REQUIRED_MISS", {
                topic,
                bankName,
                subject,
                sectionName,
                reason,
                matchedBanks: retrievalMeta?.matchedBanks || 0,
            });
            throw new ApiError(
                422,
                `RAG required but no reference questions matched (${String(reason).replace(/_/g, " ")}). Ingest or confirm JEE Main papers for this exam/section, then retry Generate with RAG — ungrounded Gemini generation was not run.`
            );
        }

        const questionRagAuditStats = {};
        let questions = [];
        let ragMeta = {
            ...(retrievalMeta || {}),
            exemplarSnippets: exemplarSnippets || [],
            rejectedNearCopies: 0,
        };

        // Solve-first only produces single-correct items. When the client asks for
        // multiples / T-F / passages only, skip solve-first (singleCount=0 used to
        // finalize an empty batch and show "AI returned no questions").
        if (singleCount > 0) {
            questions = await generateSolveFirstSingles({
                topic,
                bankName,
                difficulty,
                singleCount,
                excludeQuestionTexts: [
                    ...excludeQuestionTexts,
                    ...exemplarStems,
                ],
                excludeArchetypes,
                categoryPaths,
                sectionName,
                subject,
                topicRelevanceFeedback,
                generateIntent,
                examReferenceBlock,
                competitiveExamPlan,
                provider,
                genTemperature,
                slotOffset: tierSlotOffset,
                difficultyResolution,
                maxSelectableSlots,
                skipSkeletonDifficultyAudit: skipLlmDifficultyAudit,
                streamPartials: topUpWave === 0,
                retrievedQuestionContextBlock,
                auditStats: questionRagAuditStats,
                presetSteering,
            });

            if (corpusTexts?.length && questions?.length) {
                const { kept, rejected, rejectedNearCopies } =
                    await rejectNearCorpusDuplicates(questions, {
                        corpusTexts,
                    });
                ragMeta = {
                    ...ragMeta,
                    rejectedNearCopies,
                };
                questions = kept;
                if (rejectedNearCopies > 0 && kept.length < singleCount) {
                    const deficit = singleCount - kept.length;
                    const rejectedStems = rejected
                        .map((r) => r?.question?.questionText)
                        .filter(Boolean);
                    const refill = await generateSolveFirstSingles({
                        topic,
                        bankName,
                        difficulty,
                        singleCount: deficit,
                        excludeQuestionTexts: [
                            ...excludeQuestionTexts,
                            ...exemplarStems,
                            ...rejectedStems,
                            ...kept.map((q) => q.questionText).filter(Boolean),
                        ],
                        excludeArchetypes,
                        categoryPaths,
                        sectionName,
                        subject,
                        topicRelevanceFeedback,
                        generateIntent,
                        examReferenceBlock,
                        competitiveExamPlan,
                        provider,
                        genTemperature,
                        slotOffset: tierSlotOffset + kept.length,
                        difficultyResolution,
                        maxSelectableSlots,
                        skipSkeletonDifficultyAudit: skipLlmDifficultyAudit,
                        streamPartials: false,
                        retrievedQuestionContextBlock,
                        auditStats: questionRagAuditStats,
                        presetSteering,
                    });
                    const {
                        kept: refillKept,
                        rejectedNearCopies: refillRejected,
                    } = await rejectNearCorpusDuplicates(refill, {
                        corpusTexts,
                    });
                    ragMeta.rejectedNearCopies += refillRejected;
                    questions = [...kept, ...refillKept].slice(0, singleCount);
                }
            }
        }

        const nonSingleCount =
            (Number(multipleCount) || 0) +
            (Number(trueFalseCount) || 0) +
            (Number(passageCount) || 0);
        if (nonSingleCount > 0) {
            pipelineTrace("QUESTION_RAG_ONE_SHOT_NON_SINGLES", {
                multipleCount,
                trueFalseCount,
                passageCount,
                chunk: `${chunkIndex + 1}/${chunkTotal}`,
            });
            const ragExamBlock = [
                examReferenceBlock,
                retrievedQuestionContextBlock,
            ]
                .filter(Boolean)
                .join("\n\n");
            const expectedCounts = {
                singleCount: 0,
                multipleCount,
                trueFalseCount,
                connectedCount: passageCount,
                passageCount,
                passageSingleCount,
                passageMultipleCount,
                passageTrueFalseCount,
            };
            const oneShotPrompt = buildQuestionBankPrompt({
                topic,
                bankName,
                difficulty,
                singleCount: 0,
                multipleCount,
                trueFalseCount,
                passageCount,
                passageSingleCount,
                passageMultipleCount,
                passageTrueFalseCount,
                connectedCount: passageCount,
                excludeQuestionTexts: [
                    ...excludeQuestionTexts,
                    ...exemplarStems,
                    ...questions.map((q) => q.questionText).filter(Boolean),
                ],
                categoryPaths,
                sectionName,
                subject,
                topicRelevanceFeedback,
                generateIntent,
                maxSelectableSlots,
                examReferenceBlock: ragExamBlock,
                competitiveExamPlan,
                tierSlotOffset,
                difficultyResolution,
            });
            const oneShotRaw = await callQuestionBankGenerationLLM(
                oneShotPrompt,
                {
                    generationProvider: provider,
                    temperature: genTemperature,
                }
            );
            const oneShotQuestions = parseQuestionBankAIResponse(
                oneShotRaw,
                expectedCounts
            );
            questions = [...questions, ...(oneShotQuestions || [])];
        }

        if (deferValidation) {
            const fastQuestions = prepareFastPathQuestions(questions, {
                examCalibrated: difficultyResolution?.examCalibrated,
            });
            pipelineTrace("BATCH_DONE", {
                mode: "question-rag-deferred",
                chunk: `${chunkIndex + 1}/${chunkTotal}`,
                outputCount: fastQuestions.length,
                ragHit: !!ragMeta.hit,
                rejectedNearCopies: ragMeta.rejectedNearCopies,
            });
            return {
                questions: fastQuestions,
                stats: { mode: "deferred" },
                ragMeta,
            };
        }

        const finalized = await finalizeQuestionBankSuggestions({
            questions,
            topic,
            bankName,
            difficulty,
            generationProvider: provider,
            excludeQuestionTexts: [
                ...excludeQuestionTexts,
                ...exemplarStems,
            ],
            categoryPaths,
            sectionName,
            subject,
            examReferenceBlock,
            competitiveExamPlan,
            generateIntent,
            maxSelectableSlots,
            allowTopUp,
            difficultyResolution,
            skipDifficultyAudit: shouldSkipFinalizeDifficultyAudit(
                skipLlmDifficultyAudit,
                questionRagAuditStats,
                difficultyResolution
            ),
            topUpWave,
            multipleTopUpCount: Math.max(
                0,
                (Number(multipleCount) || 0) -
                    (questions || []).filter(
                        (q) => q?.questionType === "multiple"
                    ).length
            ),
            targetSingleCount: Number(singleCount) || 0,
            targetMultipleCount: Number(multipleCount) || 0,
            targetTrueFalseCount: Number(trueFalseCount) || 0,
            generationMode,
        });
        pipelineTrace("BATCH_DONE", {
            mode: "question-rag",
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            outputCount: unwrapFinalizedQuestions(finalized).length,
            ragHit: !!ragMeta.hit,
            rejectedNearCopies: ragMeta.rejectedNearCopies,
        });
        return {
            ...(Array.isArray(finalized)
                ? { questions: finalized, stats: {} }
                : finalized),
            ragMeta,
        };
    }

    const useSolveFirst =
        !forceOneShot &&
        shouldUseSolveFirstGeneration({
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        generateIntent,
        competitiveExamPlan,
        topic,
        bankName,
        categoryPaths,
        sectionName,
        subject,
    });

    if (useSolveFirst) {
        pipelineTrace('SOLVE_FIRST_BATCH', {
            singleCount,
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
        });
        console.log(
            `[ai-qb] solve-first generation: ${singleCount} single(s) (chunk ${chunkIndex + 1}/${chunkTotal})`
        );
        const solveFirstAuditStats = {};
        const questions = await generateSolveFirstSingles({
            topic,
            bankName,
            difficulty,
            singleCount,
            excludeQuestionTexts,
            excludeArchetypes,
            categoryPaths,
            sectionName,
            subject,
            topicRelevanceFeedback,
            generateIntent,
            examReferenceBlock,
            competitiveExamPlan,
            provider,
            genTemperature,
            slotOffset: tierSlotOffset,
            difficultyResolution,
            maxSelectableSlots,
            skipSkeletonDifficultyAudit: skipLlmDifficultyAudit,
            streamPartials: topUpWave === 0,
            auditStats: solveFirstAuditStats,
            presetSteering,
        });

        if (deferValidation) {
            // Stage A answer lock: even when full finalize is deferred, hard/exam
            // (and by default all deferred) batches get independent-solver keys so
            // questions-only scripts do not ship generator-wrong answer keys.
            const lockResult = await runStageAAnswerLock(questions, {
                topic,
                bankName,
                sectionName,
                subject,
                categoryPaths,
                difficulty:
                    difficultyResolution?.generationDifficulty || difficulty,
                generationProvider: provider,
            });
            const fastQuestions = prepareFastPathQuestions(
                lockResult.questions || questions,
                {
                    examCalibrated: difficultyResolution?.examCalibrated,
                }
            );
            pipelineTrace("BATCH_DONE", {
                mode: "solve-first-deferred",
                chunk: `${chunkIndex + 1}/${chunkTotal}`,
                outputCount: fastQuestions.length,
                stageALocked: lockResult.lockedCount || 0,
                stageADropped: lockResult.droppedCount || 0,
            });
            return {
                questions: fastQuestions,
                stats: {
                    mode: "deferred",
                    stageAAnswerLock: {
                        lockedCount: lockResult.lockedCount || 0,
                        droppedCount: lockResult.droppedCount || 0,
                        unfixableCount: lockResult.unfixableCount || 0,
                        skipped: !!lockResult.skipped,
                    },
                },
            };
        }

        const finalized = await finalizeQuestionBankSuggestions({
            questions,
            topic,
            bankName,
            difficulty,
            generationProvider: provider,
            excludeQuestionTexts,
            categoryPaths,
            sectionName,
            subject,
            examReferenceBlock,
            competitiveExamPlan,
            generateIntent,
            maxSelectableSlots,
            allowTopUp,
            difficultyResolution,
            skipDifficultyAudit: shouldSkipFinalizeDifficultyAudit(
                skipLlmDifficultyAudit,
                solveFirstAuditStats,
                difficultyResolution
            ),
            topUpWave,
            targetSingleCount: Number(singleCount) || 0,
            targetMultipleCount: Number(multipleCount) || 0,
            targetTrueFalseCount: Number(trueFalseCount) || 0,
            generationMode,
        });
        pipelineTrace('BATCH_DONE', {
            mode: 'solve-first',
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            ...unwrapFinalizedStats(finalized),
        });
        return finalized;
    }

    pipelineTrace('ONE_SHOT_BATCH', {
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        chunk: `${chunkIndex + 1}/${chunkTotal}`,
    });

    const expectedCounts = {
        singleCount,
        multipleCount,
        trueFalseCount,
        connectedCount: passageCount,
        passageCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
    };

    const chunkNote =
        chunkTotal > 1
            ? `\n**Batch note:** This is generation chunk ${chunkIndex + 1} of ${chunkTotal}. Return exactly the counts requested below — other chunks cover the rest of the bank. Do not repeat stems from excluded questions.\n`
            : "";

    const selectableThisChunk = countSelectableSlots({
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
    });

    const prompt =
        chunkNote +
        buildQuestionBankPrompt({
            topic,
            bankName,
            difficulty,
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
            connectedCount: passageCount,
            excludeQuestionTexts,
            categoryPaths,
            sectionName,
            subject,
            topicRelevanceFeedback,
            generateIntent,
            maxSelectableSlots,
            examReferenceBlock,
            competitiveExamPlan,
            tierSlotOffset,
            totalBatchSelectable:
                totalBatchSelectable ??
                (chunkTotal > 1 ? null : selectableThisChunk),
            difficultyResolution,
        });

    const rawText = await callQuestionBankGenerationLLM(prompt, {
        generationProvider: provider,
        temperature: genTemperature,
    });

    const questions = parseQuestionBankAIResponse(rawText, expectedCounts);

    if (deferValidation) {
        const fastQuestions = prepareFastPathQuestions(questions, {
            examCalibrated: difficultyResolution?.examCalibrated,
        });
        pipelineTrace("BATCH_DONE", {
            mode: "one-shot-deferred",
            chunk: `${chunkIndex + 1}/${chunkTotal}`,
            outputCount: fastQuestions.length,
        });
        return { questions: fastQuestions, stats: { mode: "deferred" } };
    }

    const finalized = await finalizeQuestionBankSuggestions({
        questions,
        topic,
        bankName,
        difficulty,
        generationProvider: provider,
        excludeQuestionTexts,
        categoryPaths,
        sectionName,
        subject,
        examReferenceBlock,
        competitiveExamPlan,
        generateIntent,
        maxSelectableSlots,
        allowTopUp,
        difficultyResolution,
        skipDifficultyAudit: skipLlmDifficultyAudit,
        topUpWave,
        multipleTopUpCount: questions.multipleDeficit || 0,
        targetSingleCount: Number(singleCount) || 0,
        targetMultipleCount: Number(multipleCount) || 0,
        targetTrueFalseCount: Number(trueFalseCount) || 0,
        generationMode,
    });
    pipelineTrace('BATCH_DONE', {
        mode: 'one-shot',
        chunk: `${chunkIndex + 1}/${chunkTotal}`,
        ...unwrapFinalizedStats(finalized),
    });
    return finalized;
};

/**
 * Generate question-bank suggestions (single, multiple, true/false) via Gemini.
 */
/** Readable one-line label for a planned topic slot (admin-facing). */
const humanizeTopicLabel = (slotPlan = {}) => {
    const label = String(slotPlan.label || "").trim();
    if (label) {
        return label.charAt(0).toUpperCase() + label.slice(1);
    }
    return String(slotPlan.conceptSlot || "Topic").replace(/_/g, " ");
};

/** Readable one-line description for a planned topic slot (admin-facing). */
const humanizeTopicDescription = (slotPlan = {}) => {
    const bp = slotPlan.blueprint || {};
    const fusion = String(bp.conceptFusion || "").trim();
    const pattern = String(bp.pattern || "").trim();
    if (fusion && pattern) {
        return `${fusion} — ${pattern}`;
    }
    const text = fusion || pattern || String(bp.required || "").trim();
    return text || "Multi-concept hard question on this topic.";
};

/** Summarize the theory/direct/multi_concept mix of a planned topic list (admin-facing). */
const summarizeKindComposition = (includedTopics = []) => {
    const counts = { theory: 0, direct: 0, multi_concept: 0 };
    for (const t of includedTopics) {
        const k = t.questionKind === "theory" || t.questionKind === "direct"
            ? t.questionKind
            : "multi_concept";
        counts[k] += 1;
    }
    return {
        ...counts,
        label: `${counts.theory} theory · ${counts.direct} direct · ${counts.multi_concept} multi-concept`,
    };
};

/**
 * Verify answers independently and correct wrong answer keys / mismatched explanations
 * in place on an EXISTING question bank. Generation already runs this inside finalize;
 * this wrapper is the explicit "fix" step for after an evaluation, where the audit has
 * reported correctness issues and the alternative would be regenerating good questions.
 *
 * Read-only on the stem and options — it only re-keys and rewrites explanations. Items it
 * cannot fix are returned in `unfixableRefs` for the caller to regenerate.
 */
export const applyAnswerCorrectionToQuestionBank = async (params = {}) => {
    const {
        questions = [],
        topic = "",
        bankName = "",
        sectionName = "",
        subject = "",
        categoryPaths = [],
        generationProvider = "gemini",
    } = params;

    if (!Array.isArray(questions) || !questions.length) {
        return {
            questions: [],
            checkedCount: 0,
            disagreementCount: 0,
            fixedCount: 0,
            unfixableRefs: [],
            report: [],
        };
    }

    const provider = resolveVerificationStageProvider(
        "solver",
        assertGenerationProviderConfigured(generationProvider)
    );
    const examCtx = resolveExamContextForGeneration({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
        competitiveExamPlan: params.competitiveExamPlan || null,
    });

    const solverModel = resolveVerificationStageModel("solver");
    const solverEffort = resolveReasoningEffort({
        difficulty: params.difficulty || "",
        subject,
        sectionName,
    });

    return runAnswerCorrectnessPass(
        questions,
        {
            topic,
            bankName,
            examProfile: examCtx.examProfile,
            subject,
            sectionName,
            difficulty: params.difficulty || "",
        },
        {
            callLlm: (prompt) =>
                callQuestionBankGenerationLLM(prompt, {
                    generationProvider: provider,
                    temperature: 0,
                    model: solverModel,
                    reasoningEffort: solverEffort,
                }),
        }
    );
};

/**
 * Plan the topic/syllabus list for a bank WITHOUT generating questions.
 * Returns an admin-facing included/excluded topic view plus the full concept-slot
 * steering, which the client echoes back on confirm as `presetSteering` so
 * generation produces exactly the confirmed topics (hard-lock). Optional
 * `planningFeedback` / `adminExcludeTopics` drive reviewer-guided re-planning.
 */
export const planQuestionBankTopics = async (params) => {
    const {
        topic = "",
        bankName = "",
        difficulty,
        singleCount = 0,
        multipleCount = 0,
        trueFalseCount = 0,
        connectedCount = 0,
        passageCount = connectedCount || 0,
        passageSingleCount = 0,
        passageMultipleCount = 0,
        passageTrueFalseCount = 0,
        categoryPaths = [],
        sectionName = "",
        subject = "",
        maxSelectableSlots = 0,
        competitiveExamPlan = null,
        generationProvider = "gemini",
        planningFeedback = "",
        adminExcludeTopics = [],
        excludeArchetypes = [],
    } = params;

    const provider = assertGenerationProviderConfigured(generationProvider);

    const difficultyResolution = resolveGenerationDifficulty({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
        userDifficulty: difficulty,
        competitiveExamPlan,
        generateIntent: "initial",
    });

    const resolvedSubject = resolveSubjectForGeneration({
        generateIntent: "initial",
        topicRelevanceFeedback: null,
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    const examCtx = resolveExamContextForGeneration({
        competitiveExamPlan,
        bankName,
        topic,
        subject: resolvedSubject.id || subject,
        sectionName,
        categoryPaths,
    });

    // One topic slot per standalone selectable question (passages excluded — they
    // carry their own passage topic). Fall back to explicit/selectable counts.
    const slotCount =
        countSelectableSlots({
            singleCount,
            multipleCount,
            trueFalseCount,
            passageCount,
            passageSingleCount,
            passageMultipleCount,
            passageTrueFalseCount,
        }) ||
        maxSelectableSlots ||
        singleCount ||
        10;

    // AI-researched (web-grounded) reference brief on real papers for this exam — the
    // planner uses it to set a realistic theory/direct/multi_concept composition. This is
    // the AI researching, not us feeding data; it never throws (falls back internally).
    const { block: planExamReferenceBlock } = await fetchExamReferenceBrief({
        bankName,
        topic,
        sectionName,
        categoryPaths,
        subject: resolvedSubject.id || subject,
        difficulty: difficultyResolution.generationDifficulty,
        examProfile: examCtx.examProfile,
        catSection: examCtx.catSection,
    });

    const steering = await resolveConceptArchetypeSteering(
        {
            count: slotCount,
            topic,
            bankName,
            subject: resolvedSubject.id || subject,
            subjectId: resolvedSubject.id || subject,
            examProfile: examCtx.examProfile,
            catSection: examCtx.catSection,
            bankDifficulty: difficultyResolution.generationDifficulty,
            examCalibrated: difficultyResolution.examCalibrated,
            excludeArchetypes,
            subjects: competitiveExamPlan?.subjects,
            preferPeak: difficultyResolution.examCalibrated,
            planningFeedback,
            adminExcludeTopics,
            examReferenceBlock: planExamReferenceBlock,
        },
        {
            callLlm: (planPrompt) =>
                callQuestionBankGenerationLLM(planPrompt, {
                    generationProvider: provider,
                    temperature: 0.25,
                }),
        }
    );

    const includedTopics = (steering.slotPlans || []).map((p) => ({
        conceptSlot: p.conceptSlot,
        label: humanizeTopicLabel(p),
        description: humanizeTopicDescription(p),
        questionKind: p.questionKind || "multi_concept",
    }));

    const examDistribution = buildExamBlueprintDistribution({
        totalSlots: slotCount,
        bankDifficulty: difficultyResolution.generationDifficulty,
        examProfile: examCtx.examProfile,
        examCalibrated: difficultyResolution.examCalibrated,
        subjects: competitiveExamPlan?.subjects || [],
    });

    let blueprints = [];
    let finalSteering = steering;
    if (isBlueprintPlannerEnabled()) {
        blueprints = enrichSlotPlansToBlueprints(steering.slotPlans || [], {
            topic,
            bankDifficulty: difficultyResolution.generationDifficulty,
            examProfile: examCtx.examProfile,
            examCalibrated: difficultyResolution.examCalibrated,
            catSection: examCtx.catSection,
            subject: resolvedSubject.id || subject,
        });
        finalSteering = {
            ...blueprintsToPresetSteering(blueprints, steering.source || "blueprint"),
            excludedTopics: steering.excludedTopics || [],
        };
    }

    const enrichedTopics = (finalSteering.slotPlans || []).map((p) => ({
        conceptSlot: p.conceptSlot,
        label: humanizeTopicLabel(p),
        description: humanizeTopicDescription(p),
        questionKind: p.questionKind || "multi_concept",
        difficulty: p.difficulty,
        blooms: p.blooms,
        estimatedTime: p.estimatedTime,
        type: p.type || "single",
    }));

    const kindRatio = summarizeKindComposition(enrichedTopics);

    pipelineTrace("TOPIC_PLAN", {
        source: finalSteering.source,
        slotCount: enrichedTopics.length,
        excludedCount: (finalSteering.excludedTopics || []).length,
        replanned: Boolean(String(planningFeedback || "").trim()),
        kindRatio: kindRatio.label,
        blueprintEnabled: isBlueprintPlannerEnabled(),
    });

    return {
        includedTopics: enrichedTopics,
        excludedTopics: finalSteering.excludedTopics || [],
        kindRatio,
        blueprints,
        examDistribution,
        steering: {
            conceptSlots: finalSteering.conceptSlots,
            slotPlans: finalSteering.slotPlans,
            blueprints,
            source: finalSteering.source,
        },
        meta: {
            subject:
                resolvedSubject.label ||
                getSubjectLabelForArchetypes(resolvedSubject.id || subject),
            subjectId: resolvedSubject.id || null,
            difficulty: difficultyResolution.generationDifficulty,
            examCalibrated: difficultyResolution.examCalibrated,
            examProfile: examCtx.examProfile,
            slotCount: enrichedTopics.length,
            kindRatio,
            examDistribution,
        },
    };
};

export const generateQuestionBankSuggestions = async (params) => {
    const {
        topic,
        bankName,
        difficulty,
        singleCount = 0,
        multipleCount = 0,
        trueFalseCount = 0,
        connectedCount = 0,
        passageCount = connectedCount || 0,
        passageSingleCount = 0,
        passageMultipleCount = 0,
        passageTrueFalseCount = 0,
        excludeQuestionTexts = [],
        excludeArchetypes = [],
        categoryPaths = [],
        sectionName = "",
        subject = "",
        topicRelevanceFeedback = null,
        generateIntent = "initial",
        topicRelevanceEvaluated = false,
        topicRelevanceRegenerated = false,
        hasGeneratedQuestions = false,
        allowContinuation = false,
        inferCountsIfMissing = false,
        maxSelectableSlots = 0,
        competitiveExamPlan = null,
        generationProvider = "gemini",
        forceOneShot = false,
        deferValidation = false,
        generationMode = "default",
        workflowLogKey = "",
        presetSteering = null,
    } = params;

    const promptFirst = isPromptFirstGenerationMode(generationMode);
    const resolvedWorkflowLogKey =
        String(workflowLogKey || "").trim() || getActiveWorkflowLogKey();

    assertGenerationWorkflowAllowed({
        generateIntent,
        topicRelevanceEvaluated,
        topicRelevanceRegenerated,
        topicRelevanceFeedback,
        hasGeneratedQuestions,
        allowContinuation,
    });

    const provider = assertGenerationProviderConfigured(generationProvider);

    const difficultyResolution = promptFirst
        ? {
              userDifficulty: String(difficulty || "medium").toLowerCase(),
              generationDifficulty: String(difficulty || "medium").toLowerCase(),
              examCalibrated: false,
              source: "prompt_first",
              examProfile: detectExamProfile({
                  topic,
                  bankName,
                  subject,
                  sectionName,
                  categoryPaths,
              }),
              rationale: `Prompt-first strategy — using UI difficulty "${difficulty}" (no exam-native veteran upscale).`,
          }
        : resolveGenerationDifficulty({
              topic,
              bankName,
              sectionName,
              categoryPaths,
              subject,
              userDifficulty: difficulty,
              competitiveExamPlan,
              generateIntent,
          });
    const generationDifficulty = difficultyResolution.generationDifficulty;

    if (difficultyResolution.examCalibrated) {
        pipelineTrace("EXAM_NATIVE_DIFFICULTY", {
            userDifficulty: difficultyResolution.userDifficulty,
            generationDifficulty,
            examProfile: difficultyResolution.examProfile,
            source: difficultyResolution.source,
        });
        console.log(`[ai-qb] ${difficultyResolution.rationale}`);
    }

    let resolvedSingleCount = singleCount;
    let resolvedMultipleCount = multipleCount;
    let resolvedTrueFalseCount = trueFalseCount;
    let resolvedPassageCount = passageCount || connectedCount || 0;
    let resolvedPassageSingleCount = passageSingleCount;
    let resolvedPassageMultipleCount = passageMultipleCount;
    let resolvedPassageTrueFalseCount = passageTrueFalseCount;
    let inferredCounts = null;

    ({
        singleCount: resolvedSingleCount,
        multipleCount: resolvedMultipleCount,
        trueFalseCount: resolvedTrueFalseCount,
        passageCount: resolvedPassageCount,
        passageSingleCount: resolvedPassageSingleCount,
        passageMultipleCount: resolvedPassageMultipleCount,
        passageTrueFalseCount: resolvedPassageTrueFalseCount,
    } = upscaleRegenerationCountsToSlots({
        generateIntent,
        topicRelevanceFeedback,
        maxSelectableSlots,
        singleCount: resolvedSingleCount,
        multipleCount: resolvedMultipleCount,
        trueFalseCount: resolvedTrueFalseCount,
        passageCount: resolvedPassageCount,
        passageSingleCount: resolvedPassageSingleCount,
        passageMultipleCount: resolvedPassageMultipleCount,
        passageTrueFalseCount: resolvedPassageTrueFalseCount,
    }));

    if (generateIntent === "evaluation_regen") {
        const flawed = extractRegenerationTargetNumbers(topicRelevanceFeedback);
        pipelineTrace("REGEN_TARGETED", {
            failedQuestionNumbers: [...flawed].slice(0, 20),
            replacementSingleCount: resolvedSingleCount,
            replacementPassageCount: resolvedPassageCount,
        });
    }

    const persistedArchetypes = await loadPersistedArchetypes({
        bankName,
        sectionName,
    });
    let mergedExcludeArchetypes = [
        ...new Set([...(excludeArchetypes || []), ...persistedArchetypes]),
    ];

    const effectiveMaxSelectableSlots =
        generateIntent === "evaluation_regen"
            ? countSelectableSlots({
                  singleCount: resolvedSingleCount,
                  multipleCount: resolvedMultipleCount,
                  trueFalseCount: resolvedTrueFalseCount,
                  passageCount: resolvedPassageCount,
                  passageSingleCount: resolvedPassageSingleCount,
                  passageMultipleCount: resolvedPassageMultipleCount,
                  passageTrueFalseCount: resolvedPassageTrueFalseCount,
              }) || maxSelectableSlots
            : maxSelectableSlots;

    const examCtxForCounts = resolveExamContextForGeneration({
        competitiveExamPlan,
        bankName,
        topic,
        sectionName,
        categoryPaths,
    });
    if (
        examCtxForCounts.catSection === "cat_varc" &&
        !resolvedPassageCount &&
        resolvedSingleCount > 0
    ) {
        const slotTarget =
            maxSelectableSlots > 0
                ? maxSelectableSlots
                : resolvedSingleCount;
        const adjusted = enforceCatVarcFormatDefaults(
            {
                singleCount: resolvedSingleCount,
                multipleCount: resolvedMultipleCount,
                trueFalseCount: resolvedTrueFalseCount,
                passageCount: resolvedPassageCount,
                passageSingleCount: resolvedPassageSingleCount,
                passageMultipleCount: resolvedPassageMultipleCount,
                passageTrueFalseCount: resolvedPassageTrueFalseCount,
            },
            slotTarget
        );
        resolvedSingleCount = adjusted.singleCount || 0;
        resolvedMultipleCount = adjusted.multipleCount || 0;
        resolvedTrueFalseCount = adjusted.trueFalseCount || 0;
        resolvedPassageCount = adjusted.passageCount || 0;
        resolvedPassageSingleCount = adjusted.passageSingleCount || 0;
        resolvedPassageMultipleCount = adjusted.passageMultipleCount || 0;
        resolvedPassageTrueFalseCount = adjusted.passageTrueFalseCount || 0;
        pipelineTrace("CAT_VARC_FORMAT", {
            passages: resolvedPassageCount,
            passageSubs: resolvedPassageSingleCount,
            vaSingles: resolvedSingleCount,
            slotTarget,
        });
        console.log(
            `[ai-qb] CAT VARC format: ${resolvedPassageCount} RC passage(s) × ${resolvedPassageSingleCount} sub-Q + ${resolvedSingleCount} VA singles (not all-standalone GMAT style)`
        );
    }

    const countsMissing = isQuestionBankCountsMissing({
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        connectedCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
    });

    if (countsMissing) {
        throw new ApiError(
            400,
            "Question counts are required, or set inferCountsIfMissing with maxSelectableSlots"
        );
    }

    const resolvedSubject = resolveSubjectForGeneration({
        generateIntent,
        topicRelevanceFeedback,
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    // Explicit counts from the client — use them as-is; no topic-based count inference.
    if (!countsMissing) {
        const examCtx = resolveExamContextForGeneration({
            competitiveExamPlan,
            bankName,
            topic,
            subject: resolvedSubject.id || subject,
            sectionName,
            categoryPaths,
        });
        // prompt_first never reads examReferenceBlock (confirmed: neither the
        // composer meta-prompt nor the per-chunk generation prompt reference
        // it) — skip the research call entirely rather than pay its latency
        // for a result that gets discarded.
        const { block: examReferenceBlock } = promptFirst
            ? { block: "" }
            : await fetchExamReferenceBrief({
                  bankName,
                  topic,
                  sectionName,
                  categoryPaths,
                  subject: resolvedSubject.id || subject,
                  difficulty: generationDifficulty,
                  examProfile: examCtx.examProfile,
                  catSection: examCtx.catSection,
              });

        const regenTemperature =
            generateIntent === "evaluation_regen" ? 0.15 : undefined;
        const genTemperature =
            regenTemperature ??
            (provider === "openai"
                ? Math.min(
                      1,
                      Math.max(
                          0,
                          Number(process.env.OPENAI_QB_GENERATION_TEMPERATURE ?? 0.2)
                      )
                  )
                : provider === "claude"
                  ? Math.min(
                        1,
                        Math.max(
                            0,
                            Number(process.env.CLAUDE_QB_GENERATION_TEMPERATURE ?? 0.1)
                        )
                    )
                  : undefined);

        const countChunks = splitQuestionBankCountsIntoChunks(
            {
                singleCount: resolvedSingleCount,
                multipleCount: resolvedMultipleCount,
                trueFalseCount: resolvedTrueFalseCount,
                passageCount: resolvedPassageCount,
                passageSingleCount: resolvedPassageSingleCount,
                passageMultipleCount: resolvedPassageMultipleCount,
                passageTrueFalseCount: resolvedPassageTrueFalseCount,
            },
            QB_GENERATION_CHUNK_SIZE
        );

        if (countChunks.length > 1) {
            const totalApiItems = countApiItemsFromQuestionCounts({
                singleCount: resolvedSingleCount,
                multipleCount: resolvedMultipleCount,
                trueFalseCount: resolvedTrueFalseCount,
                passageCount: resolvedPassageCount,
            });
            pipelineTrace('CHUNKING', {
                totalApiItems,
                chunks: countChunks.length,
                chunkSize: QB_GENERATION_CHUNK_SIZE,
            });
            console.log(
                `[ai-qb] chunking ${totalApiItems} API item(s) into ${countChunks.length} call(s) of ≤${QB_GENERATION_CHUNK_SIZE}`
            );
        }

        pipelineTrace('GENERATION_START', {
            provider,
            singleCount: resolvedSingleCount,
            multipleCount: resolvedMultipleCount,
            trueFalseCount: resolvedTrueFalseCount,
            passageCount: resolvedPassageCount,
            chunks: countChunks.length,
            generationMode: promptFirst ? "prompt_first" : "default",
        });

        let promptFirstComposedBody = null;
        let promptFirstComposeSource = null;
        let promptBasedGenRun = null;
        if (promptFirst) {
            promptBasedGenRun = createPromptBasedGenerationRun({
                topic,
                bankName,
                sectionName,
                subject,
                difficulty: generationDifficulty,
                workflowLogKey: resolvedWorkflowLogKey,
                provider,
                generationMode: "prompt_first",
                counts: {
                    singleCount: resolvedSingleCount,
                    multipleCount: resolvedMultipleCount,
                    trueFalseCount: resolvedTrueFalseCount,
                    passageCount: resolvedPassageCount,
                    passageSingleCount: resolvedPassageSingleCount,
                    passageMultipleCount: resolvedPassageMultipleCount,
                    passageTrueFalseCount: resolvedPassageTrueFalseCount,
                },
                chunks: countChunks.length,
            });

            const composed = await resolveComposedGenerationPrompt(
                {
                    topic,
                    bankName,
                    sectionName,
                    categoryPaths,
                    subject,
                    difficulty: generationDifficulty,
                    singleCount: resolvedSingleCount,
                    multipleCount: resolvedMultipleCount,
                    trueFalseCount: resolvedTrueFalseCount,
                    passageCount: resolvedPassageCount,
                    passageSingleCount: resolvedPassageSingleCount,
                    passageMultipleCount: resolvedPassageMultipleCount,
                    passageTrueFalseCount: resolvedPassageTrueFalseCount,
                    excludeQuestionTexts,
                },
                {
                    workflowLogKey: resolvedWorkflowLogKey,
                    promptBasedGenRun,
                    callLlmText: (composePrompt, opts = {}) =>
                        callQuestionBankGenerationLLMText(composePrompt, {
                            generationProvider: provider,
                            ...opts,
                        }),
                }
            );
            promptFirstComposedBody = composed.composedBody;
            promptFirstComposeSource = composed.source;

            if (promptBasedGenRun?.runDir) {
                pipelineTrace("PROMPT_BASED_GEN_LOG", {
                    runDir: promptBasedGenRun.runDir,
                    runKey: promptBasedGenRun.runKey,
                });
            }
        }

        let runningExclude = [...excludeQuestionTexts];
        let usedArchetypes = [...mergedExcludeArchetypes];
        let mergedQuestions = [];
        let lastStats = {};
        let mergedRagMeta = null;
        const totalBatchSelectable = countSelectableSlots({
            singleCount: resolvedSingleCount,
            multipleCount: resolvedMultipleCount,
            trueFalseCount: resolvedTrueFalseCount,
            passageCount: resolvedPassageCount,
            passageSingleCount: resolvedPassageSingleCount,
            passageMultipleCount: resolvedPassageMultipleCount,
            passageTrueFalseCount: resolvedPassageTrueFalseCount,
        });
        const chunkTierOffsets = computeChunkTierOffsets(countChunks);

        // Confirmed topic plan (hard-lock): slice the full slotPlans per chunk by
        // cumulative single-slot offset so each chunk generates exactly its share
        // of the confirmed topics. Computed up front so parallel chunks are safe.
        const presetSlotPlans = Array.isArray(presetSteering?.slotPlans)
            ? presetSteering.slotPlans
            : null;
        const chunkSingleOffsets = [];
        {
            let acc = 0;
            for (const c of countChunks) {
                chunkSingleOffsets.push(acc);
                acc += c.singleCount || 0;
            }
        }
        const sliceChunkPresetSteering = (chunkIndex, singleCount) => {
            if (!presetSlotPlans || !singleCount) return null;
            const start = chunkSingleOffsets[chunkIndex] ?? 0;
            const slice = presetSlotPlans.slice(start, start + singleCount);
            if (!slice.length) return null;
            return {
                conceptSlots: slice.map((p) => p.conceptSlot),
                slotPlans: slice,
                source: presetSteering.source || "preset",
            };
        };

        // Retrieve RAG once per job (not once per chunk) — embeddings + Mongo scan
        // are expensive and identical exemplars across chunks are fine for style grounding.
        let jobCachedRag = null;
        if (isQuestionRagGenerationMode(generationMode)) {
            const jobConceptHints = [
                ...(Array.isArray(presetSteering?.conceptSlots)
                    ? presetSteering.conceptSlots
                    : []),
                ...(Array.isArray(presetSteering?.slotPlans)
                    ? presetSteering.slotPlans.map(
                          (p) => p?.label || p?.conceptSlot || ""
                      )
                    : []),
                subject,
                sectionName,
            ].filter(Boolean);
            jobCachedRag = await retrieveSimilarConfirmedQuestions({
                topic,
                bankName,
                subject,
                sectionName,
                conceptHints: jobConceptHints,
                difficulty: generationDifficulty,
            });
            if (!jobCachedRag?.ragMeta?.hit || !jobCachedRag?.exemplarStems?.length) {
                const reason = jobCachedRag?.ragMeta?.reason || "no_matching_bank";
                throw new ApiError(
                    422,
                    `RAG required but no reference questions matched (${String(reason).replace(/_/g, " ")}). Prefer explained ${sectionName || subject || "subject"} papers in AiQuestion, then retry Generate with RAG.`
                );
            }
            mergedRagMeta = mergeRagMeta(null, {
                ...jobCachedRag.ragMeta,
                exemplarSnippets: jobCachedRag.exemplarSnippets || [],
                cachedOnce: true,
            });
            pipelineTrace("QUESTION_RAG_JOB_CACHE", {
                returned: jobCachedRag.ragMeta.returned,
                candidates: jobCachedRag.ragMeta.candidateCount,
                chunks: countChunks.length,
            });
        }

        // Multi-chunk: skip per-chunk finalize (verify/audit/repair once after merge).
        // This alone removes N−1 full verification pipelines for a 25-question run.
        const deferPerChunk =
            deferValidation || (countChunks.length > 1 && !promptFirst);

        const runOneChunk = async (chunkIndex) => {
            const chunk = countChunks[chunkIndex];
            const batchResult = await generateQuestionBankBatch({
                topic,
                bankName,
                difficulty: generationDifficulty,
                singleCount: chunk.singleCount,
                multipleCount: chunk.multipleCount,
                trueFalseCount: chunk.trueFalseCount,
                passageCount: chunk.passageCount,
                passageSingleCount: chunk.passageSingleCount,
                passageMultipleCount: chunk.passageMultipleCount,
                passageTrueFalseCount: chunk.passageTrueFalseCount,
                excludeQuestionTexts: runningExclude,
                excludeArchetypes: usedArchetypes,
                categoryPaths,
                sectionName,
                subject,
                topicRelevanceFeedback,
                generateIntent,
                maxSelectableSlots: effectiveMaxSelectableSlots,
                examReferenceBlock,
                competitiveExamPlan,
                provider,
                genTemperature,
                // Multi-chunk used to force allowTopUp=false, which made finalize
                // difficulty rejects vanish with no refill (UI partials then got
                // replaced by a 0–1 question final batch). Keep one top-up wave.
                allowTopUp: true,
                chunkIndex,
                chunkTotal: countChunks.length,
                tierSlotOffset: chunkTierOffsets[chunkIndex] ?? 0,
                totalBatchSelectable,
                forceOneShot,
                difficultyResolution,
                deferValidation: deferPerChunk,
                generationMode,
                promptFirstComposedBody,
                promptFirstComposeSource,
                promptBasedGenRun,
                presetSteering: sliceChunkPresetSteering(
                    chunkIndex,
                    chunk.singleCount
                ),
                cachedRagRetrieval: jobCachedRag,
            });
            return { chunkIndex, chunk, batchResult };
        };

        let chunkResults;
        // Parallel chunking is normally off for exam-calibrated (JEE/NEET) banks
        // because sequential runs thread used-topics/archetypes forward so later
        // chunks don't repeat earlier ones. Safe when topics are pre-locked OR
        // question_rag mode (job-cached exemplars + slot offsets diversify chunks).
        const topicsPreAssigned = Boolean(presetSteering?.slotPlans?.length);
        const ragModeParallelSafe = isQuestionRagGenerationMode(generationMode);
        const useParallelChunks =
            countChunks.length > 1 &&
            isParallelChunkGenerationEnabled() &&
            (!difficultyResolution?.examCalibrated ||
                topicsPreAssigned ||
                ragModeParallelSafe);

        if (useParallelChunks) {
            pipelineTrace("PARALLEL_CHUNK_GENERATION", {
                chunks: countChunks.length,
                concurrency: QB_PARALLEL_CHUNK_CONCURRENCY,
            });
            console.log(
                `[ai-qb] parallel chunk generation: ${countChunks.length} chunk(s), concurrency ${QB_PARALLEL_CHUNK_CONCURRENCY}`
            );
            chunkResults = await runTasksWithConcurrency(
                countChunks.map(
                    (_, chunkIndex) => () => runOneChunk(chunkIndex)
                ),
                QB_PARALLEL_CHUNK_CONCURRENCY
            );
            chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex);
        } else {
            chunkResults = [];
            for (let chunkIndex = 0; chunkIndex < countChunks.length; chunkIndex++) {
                chunkResults.push(await runOneChunk(chunkIndex));
            }
        }

        for (const { batchResult } of chunkResults) {
            const batchQuestions = unwrapFinalizedQuestions(batchResult);
            lastStats = unwrapFinalizedStats(batchResult);
            if (batchResult?.ragMeta) {
                if (jobCachedRag && mergedRagMeta) {
                    mergedRagMeta = {
                        ...mergedRagMeta,
                        rejectedNearCopies:
                            (mergedRagMeta.rejectedNearCopies || 0) +
                            (batchResult.ragMeta.rejectedNearCopies || 0),
                    };
                } else {
                    mergedRagMeta = mergeRagMeta(mergedRagMeta, {
                        ...batchResult.ragMeta,
                        exemplarSnippets:
                            batchResult.ragMeta.exemplarSnippets || [],
                    });
                }
            }

            mergedQuestions = mergedQuestions.concat(batchQuestions);
            runningExclude = [
                ...runningExclude,
                ...collectQuestionTextsFromBankQuestions(batchQuestions),
            ];
            usedArchetypes = [
                ...usedArchetypes,
                ...batchQuestions
                    .map((q) => q._conceptSlot)
                    .filter(Boolean),
            ];
        }

        await persistArchetypes({
            bankName,
            sectionName,
            archetypes: usedArchetypes,
        });

        const resolvedGenerationMode = promptFirst
            ? "prompt_first"
            : isPaperReferenceGenerationMode(generationMode)
              ? "paper_reference"
              : isQuestionRagGenerationMode(generationMode)
                ? "question_rag"
                : "default";

        let pipelineSummary = {
            generationChunks: countChunks.length,
            generationMode: resolvedGenerationMode,
            ...(promptFirst && promptFirstComposeSource
                ? { promptComposeSource: promptFirstComposeSource }
                : {}),
            ...lastStats,
            ...(deferValidation ? { mode: "deferred" } : {}),
            ...(mergedRagMeta
                ? {
                      ragHit: !!mergedRagMeta.hit,
                      ragReturned: mergedRagMeta.returned || 0,
                      ragRejectedNearCopies:
                          mergedRagMeta.rejectedNearCopies || 0,
                  }
                : {}),
        };
        let repairedQuestions = mergedQuestions;

        // Finalize once after merge when multi-chunk deferred per-chunk validation.
        if (!deferValidation && countChunks.length > 1 && !promptFirst) {
            const finalResult = await finalizeQuestionBankSuggestions({
                questions: mergedQuestions,
                topic,
                bankName,
                difficulty: generationDifficulty,
                generationProvider: provider,
                excludeQuestionTexts: runningExclude,
                categoryPaths,
                sectionName,
                subject,
                examReferenceBlock,
                competitiveExamPlan,
                generateIntent,
                maxSelectableSlots,
                allowTopUp: true,
                difficultyResolution,
                targetSingleCount: Number(resolvedSingleCount) || 0,
                targetMultipleCount: Number(resolvedMultipleCount) || 0,
                targetTrueFalseCount: Number(resolvedTrueFalseCount) || 0,
                generationMode: resolvedGenerationMode,
            });
            repairedQuestions = unwrapFinalizedQuestions(finalResult);
            pipelineSummary = {
                generationChunks: countChunks.length,
                generationMode: resolvedGenerationMode,
                ...unwrapFinalizedStats(finalResult),
                ...(mergedRagMeta
                    ? {
                          ragHit: !!mergedRagMeta.hit,
                          ragReturned: mergedRagMeta.returned || 0,
                          ragRejectedNearCopies:
                              mergedRagMeta.rejectedNearCopies || 0,
                          ragCachedOnce: !!mergedRagMeta.cachedOnce,
                      }
                    : {}),
            };
        }

        if (promptBasedGenRun?.runDir) {
            const summaryPath = promptBasedGenRun.finalize({
                generationMode: "prompt_first",
                composeSource: promptFirstComposeSource,
                chunks: countChunks.length,
                totalQuestions: repairedQuestions.length,
                logDir: promptBasedGenRun.runDir,
            });
            pipelineSummary = {
                ...pipelineSummary,
                promptBasedGenLogDir: promptBasedGenRun.runDir,
                promptBasedGenSummary: summaryPath || undefined,
            };
        }

        const outputQuestions = promptFirst
            ? preparePromptFirstQuestions(repairedQuestions)
            : deferValidation
              ? prepareFastPathQuestions(repairedQuestions, {
                    examCalibrated: difficultyResolution?.examCalibrated,
                })
              : repairedQuestions;
        // Allow target + overflow (default +3) so refill after strip isn't cut to exact target.
        const requestedTotal =
            (Number(resolvedSingleCount) || 0) +
            (Number(resolvedMultipleCount) || 0) +
            (Number(resolvedTrueFalseCount) || 0) +
            (Number(resolvedPassageCount) || 0);
        const overflowCap =
            requestedTotal > 0 ? requestedTotal + getCountOverflowMax() : 0;
        const slotCap =
            effectiveMaxSelectableSlots > 0 && overflowCap > 0
                ? Math.max(effectiveMaxSelectableSlots, overflowCap)
                : effectiveMaxSelectableSlots > 0
                  ? effectiveMaxSelectableSlots
                  : overflowCap;
        const cappedQuestions = capQuestionsToMaxSlots(
            outputQuestions,
            slotCap
        );
        if (
            slotCap > 0 &&
            cappedQuestions.length < outputQuestions.length
        ) {
            pipelineTrace("GENERATION_SLOT_CAP_APPLIED", {
                before: outputQuestions.length,
                after: cappedQuestions.length,
                maxSelectableSlots: effectiveMaxSelectableSlots,
                overflowCap,
                slotCap,
            });
        }

        // Phase C7: blueprint coverage checker
        const planBlueprints =
            Array.isArray(presetSteering?.blueprints) &&
            presetSteering.blueprints.length
                ? presetSteering.blueprints
                : Array.isArray(presetSteering?.slotPlans)
                  ? enrichSlotPlansToBlueprints(presetSteering.slotPlans, {
                        topic,
                        bankDifficulty: generationDifficulty,
                        examProfile: difficultyResolution?.examProfile,
                        examCalibrated:
                            difficultyResolution?.examCalibrated || false,
                        subject: resolvedSubject?.id || subject,
                    })
                  : [];
        const examDistribution = buildExamBlueprintDistribution({
            totalSlots: planBlueprints.length || cappedQuestions.length,
            bankDifficulty: generationDifficulty,
            examProfile: difficultyResolution?.examProfile,
            examCalibrated: difficultyResolution?.examCalibrated || false,
            subjects: competitiveExamPlan?.subjects || [],
        });
        const coverage = checkBlueprintCoverage(
            planBlueprints,
            cappedQuestions,
            { examDistribution }
        );
        pipelineTrace("BLUEPRINT_COVERAGE", {
            ok: coverage.ok,
            expected: coverage.expectedCount,
            generated: coverage.generatedCount,
            missing: coverage.missing?.length || 0,
            difficultyGaps: coverage.difficultyGaps?.length || 0,
        });
        pipelineSummary = {
            ...pipelineSummary,
            blueprintCoverage: coverage,
            examDistribution,
        };

        return {
            questions: cappedQuestions,
            detectedSubject: resolvedSubject,
            inferredCounts,
            generationProvider: provider,
            generationChunks: countChunks.length,
            pipelineSummary,
            difficultyResolution,
            generationDifficulty,
            ragMeta: mergedRagMeta,
            blueprintCoverage: coverage,
            blueprints: planBlueprints,
            examDistribution,
            validationDeferred: promptFirst ? false : deferValidation,
            skipBackgroundValidation: promptFirst,
            backgroundValidationContext:
                promptFirst || !deferValidation
                    ? null
                    : {
                          examReferenceBlock,
                          difficultyResolution,
                          generationDifficulty,
                          singleCount: resolvedSingleCount,
                          multipleCount: resolvedMultipleCount,
                          trueFalseCount: resolvedTrueFalseCount,
                          passageCount: resolvedPassageCount,
                          passageSingleCount: resolvedPassageSingleCount,
                          passageMultipleCount: resolvedPassageMultipleCount,
                          passageTrueFalseCount: resolvedPassageTrueFalseCount,
                          maxSelectableSlots: effectiveMaxSelectableSlots,
                          excludeQuestionTexts: runningExclude,
                      },
            ...(generateIntent === "evaluation_regen"
                ? {
                      targetedRegeneration: {
                          replacementCount: totalBatchSelectable,
                          failedQuestionNumbers: [
                              ...extractRegenerationTargetNumbers(
                                  topicRelevanceFeedback
                              ),
                          ],
                      },
                  }
                : {}),
        };
    }

    throw new ApiError(
        400,
        "Question counts are required. Use inferQuestionBankCounts first or pass explicit counts."
    );
};

export const generateQuestionsWithAI = async (params) => {
    const { topic, subject, classLevel, difficulty, numberOfQuestions } = params;

    const prompt = buildPrompt({
        topic,
        subject,
        classLevel,
        difficulty,
        numberOfQuestions,
    });

    return callGeminiWithRetries(async () => {
        const result = await genAI.models.generateContent({
            model: geminiTextModel(),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
            },
        });

        const text = result.text || "";
        if (!text) {
            throw new ApiError(500, "AI returned empty response");
        }

        const parsed = parseJsonArrayFromAI(text);
        const questions = validateSimpleMcqQuestions(parsed);

        return questions.map((q) => ({
            ...q,
            topic,
            subject,
            classLevel,
            difficulty,
        }));
    });
};


const buildImageQuestionPrompt = ({
    topic,
    bankName,
    difficulty,
    excludeQuestionTexts = [],
    imageQuestionType = "mixed",
    usedImageQuestionTypes = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
}) => {
    const archetypeId = pickImageQuestionArchetype({
        preferred: imageQuestionType,
        usedTypes: usedImageQuestionTypes,
    });
    const archetype = IMAGE_QUESTION_ARCHETYPES[archetypeId];
    const excludeBlock = formatExcludeBlock(excludeQuestionTexts);
    const resolvedSubject = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });
    const subjectBlock = buildSubjectScopeBlock(resolvedSubject);
    const calibration = buildDifficultyCalibrationBlock({
        bankName,
        topic,
        subject: resolvedSubject.id || "",
        difficulty,
        batchSize: 1,
        mode: "image",
        categoryPaths,
        sectionName,
    });
    const exampleJson = JSON.stringify(
        {
            questionType: "single",
            ...archetype.example,
            explanation:
                archetype.example.explanation ||
                "Clear one-sentence explanation referencing the figure.",
        },
        null,
        2
    );
    const syllabusFocus = getGenerationTopicFocus({ topic, sectionName, bankName });

    return `You are an expert educator creating ONE image-based multiple-choice exam question for an Indian competitive-education platform.

**Question bank:** ${bankName}
**Topic / syllabus focus (AUTHORITATIVE):** ${syllabusFocus || topic}
**Difficulty:** ${difficulty}
**Required archetype for this question:** ${archetypeId} (${archetype.label})
${subjectBlock}
${calibration}
${excludeBlock}
**CRITICAL INSTRUCTIONS (all archetypes):**
1. Return ONLY a valid JSON object — no markdown, no code fences, no extra text.
2. The question MUST require looking at the image to answer — not answerable from text alone.
3. questionType must be "single" with exactly 4 options and one correct answer letter A–D.
4. Include a clear explanation (minimum one sentence).
5. imageSpec.archetype MUST be "${archetypeId}".
6. imageSpec must include description, style, imagePrompt, and labels (use {} if no letter markers).
7. questionText must start with "Refer to the figure" or similar and reference the image.
8. options[] must be FULL ANSWER TEXT — NEVER bare letters "A", "B", "C", "D". The UI adds A/B/C/D prefixes.
9. Do NOT duplicate or paraphrase excluded questions.
10. imageSpec.imagePrompt: one plain-text paragraph for image AI — exam-paper schematic style (see below), no watermarks.
11. On-image text: use only single letters A–D and digits where the archetype allows; never full words or sentences on the figure.
${EXAM_PAPER_IMAGE_GENERATION_BLOCK}
${EXAM_PAPER_IMAGE_QUESTION_RULES}

${archetype.instructions}

**Required JSON format (follow this archetype — structure only):**
${exampleJson}

Return ONLY the JSON object.`;
};

const enrichImagePromptForClarity = (prompt) => {
    return enrichPromptForExamPaperStyle(String(prompt || "").trim());
};

/** Normalize imageSpec.labels into letter → meaning pairs. */
const normalizeLabelEntries = (labels = {}) => {
    const entries = Object.entries(labels || {}).filter(([, v]) =>
        String(v || "").trim()
    );
    if (!entries.length) return [];
    return entries.map(([key, value], idx) => {
        const letter = /^[A-Z]$/i.test(String(key).trim())
            ? String(key).trim().toUpperCase()
            : String.fromCharCode(65 + Math.min(idx, 25));
        const meaning = String(value).split(/[(\[]/)[0].trim();
        return { letter, meaning };
    });
};

const formatLetterMarkerClause = (labelEntries) => {
    if (!labelEntries.length) {
        return "Place only single capital letters A, B, C, D as markers. No words anywhere on the image.";
    }
    const parts = labelEntries.map(
        ({ letter, meaning }) =>
            `place large bold letter "${letter}" on the part representing ${meaning}`
    );
    return `On the image: ${parts.join("; ")}. Show ONLY these single letters — absolutely no words, names, or other text.`;
};

/** Remove instructions that ask Imagen to render full-word labels (it cannot do this reliably). */
const stripWordLabelInstructions = (prompt) => {
    let p = String(prompt || "");
    p = p.replace(/\b(?:label|labels|labeled|labelling|reading)\s+(?:exactly\s+)?"[^"]+"/gi, "");
    p = p.replace(/\bBold\s+(?:black\s+)?labels[^.]*\./gi, "");
    p = p.replace(/\b(?:clear|readable)\s+labels[^.]*\./gi, "");
    p = p.replace(/\b(?:correctly\s+spelled|human-readable|real\s+English)\s+[^.]*\./gi, "");
    p = p.replace(/\bdisplay\s+ONLY\s+these\s+exact[^.]*\./gi, "");
    p = p.replace(/\b(?:North America|South America|Atlantic Ocean|Pacific Ocean)[^.]*on\s+the\s+image[^.]*\./gi, "");
    return p.replace(/\s{2,}/g, " ").trim();
};

/** Append archetype-aware rules before sending to Imagen. */
const finalizeImagePromptForImagen = (prompt, imageSpec = {}) => {
    let p = stripWordLabelInstructions(enrichImagePromptForClarity(String(prompt || "").trim()));
    if (!p) return p;

    const archetypeId =
        imageSpec.archetype || imageSpec.questionArchetype || imageSpec.type || "";
    const rules = getImagePromptRulesForArchetype(archetypeId);
    const labelEntries = normalizeLabelEntries(imageSpec.labels);
    const letterClause = formatLetterMarkerClause(labelEntries);

    const parts = [p];
    if (rules.letterClause && letterClause && !/Show ONLY these single letters/i.test(p)) {
        parts.push(letterClause);
    } else if (rules.letterClause && !labelEntries.length && !/capital letters A/i.test(p)) {
        parts.push(
            "Place only single capital letters A, B, C, D as markers where needed. No words anywhere on the image."
        );
    }
    if (rules.noTextRule && !/STRICT:/i.test(p)) {
        parts.push(rules.noTextRule);
    }
    if (!/exam\s+paper|question\s+paper|schematic/i.test(p)) {
        parts.push(EXAM_PAPER_IMAGEN_SUFFIX);
    }
    return parts.join(" ");
};

const buildImagePromptFromSpec = (imageSpec = {}) => {
    const ready = String(imageSpec.imagePrompt || imageSpec.prompt || "").trim();
    if (ready.length >= 20) return finalizeImagePromptForImagen(ready, imageSpec);

    const description = String(imageSpec.description || "").trim();
    const style = String(
        imageSpec.style || EXAM_PAPER_IMAGE_DEFAULT_STYLE
    ).trim();
    const archetypeId = String(imageSpec.archetype || imageSpec.type || "diagram").trim();
    const archetype = getImageQuestionArchetype(archetypeId);
    const visualType = String(imageSpec.type || archetypeId || "diagram").trim();
    const labelEntries = normalizeLabelEntries(imageSpec.labels);
    const rules = getImagePromptRulesForArchetype(archetypeId);
    const letterHint = rules.letterClause ? formatLetterMarkerClause(labelEntries) : "";
    const built = [
        `Exam question paper ${visualType} figure for a competitive exam.`,
        description,
        `Style: ${style}.`,
        letterHint,
        EXAM_PAPER_IMAGEN_SUFFIX,
    ]
        .filter(Boolean)
        .join(" ");
    return finalizeImagePromptForImagen(built, imageSpec);
};

/** Convert labels object to letter-keyed map (A→meaning) for consistent letter-only images. */
const normalizeImageSpecLabels = (rawLabels = {}) => {
    const entries = normalizeLabelEntries(rawLabels);
    const normalized = {};
    for (const { letter, meaning } of entries) {
        normalized[letter] = meaning;
    }
    return normalized;
};

const areBareLetterOptions = (options) =>
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((o) => /^[A-D]$/i.test(String(o).trim()));

/** When the model copies bare A–D into options[], recover text from imageSpec.labels. */
const deriveImageQuestionOptionsFromLabels = (options, labels = {}) => {
    if (!areBareLetterOptions(options)) return options;
    const entries = normalizeLabelEntries(labels);
    if (!entries.length) return options;

    const derived = ["", "", "", ""];
    for (const { letter, meaning } of entries) {
        const idx = letter.charCodeAt(0) - 65;
        if (idx >= 0 && idx <= 3 && meaning) derived[idx] = meaning;
    }
    return derived.filter(Boolean).length >= 2 ? derived : options;
};

const normalizeImageSpec = (raw = {}) => {
    const description = stripMarkdownNoise(raw.description || "");
    if (!description) {
        throw new ApiError(500, "AI image question is missing imageSpec.description");
    }

    const style = stripMarkdownNoise(
        raw.style || EXAM_PAPER_IMAGE_DEFAULT_STYLE
    );
    const archetype = String(
        raw.archetype || raw.questionArchetype || raw.type || "labeled_diagram"
    ).trim();
    const type = String(raw.type || archetype || "diagram").trim();
    const labels = normalizeImageSpecLabels(
        raw.labels && typeof raw.labels === "object" && !Array.isArray(raw.labels)
            ? raw.labels
            : {}
    );

    const specForPrompt = { archetype, type, description, style, labels };

    let imagePrompt = stripMarkdownNoise(raw.imagePrompt || raw.prompt || "");
    if (imagePrompt.length < 20) {
        imagePrompt = buildImagePromptFromSpec(specForPrompt);
    } else {
        imagePrompt = finalizeImagePromptForImagen(imagePrompt, specForPrompt);
    }

    return {
        archetype,
        type,
        description,
        style,
        labels,
        imagePrompt,
    };
};

const parseImageQuestionAIResponse = (rawText) => {
    const parsed = parseJsonObjectFromAI(rawText);

    if (!parsed?.imageSpec) {
        throw new ApiError(500, "AI image question is missing imageSpec");
    }

    if (areBareLetterOptions(parsed.options)) {
        parsed.options = deriveImageQuestionOptionsFromLabels(
            parsed.options,
            parsed.imageSpec.labels
        );
    }

    const item = parseQuestionBankAIItem(parsed, 0, "Image question");
    const imageSpec = normalizeImageSpec(parsed.imageSpec);

    return {
        ...item,
        imageSpec,
    };
};

const IMAGEN_FALLBACK_MODELS = [
    DEFAULT_IMAGEN_MODEL,
    "imagen-3.0-generate-002",
];

const buildImagenGenerationConfig = (model) => {
    const config = { numberOfImages: 1 };
    if (model.includes("ultra") || model === DEFAULT_IMAGEN_MODEL) {
        config.imageSize = "1K";
    }
    return config;
};

const extractImageBytesFromGenerateContentResponse = (response) => {
    const candidates = response?.candidates || [];
    for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
            if (part?.inlineData?.data) {
                return {
                    bytes: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "image/png",
                };
            }
        }
    }

    if (response?.data) {
        return { bytes: response.data, mimeType: "image/png" };
    }

    return null;
};

const extensionForMimeType = (mimeType = "image/png") => {
    const map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
    };
    return map[String(mimeType).toLowerCase()] || "png";
};

const generateImagenImageBytes = async (model, prompt) => {
    const response = await genAI.models.generateImages({
        model,
        prompt,
        config: buildImagenGenerationConfig(model),
    });

    const imageBytes =
        response?.generatedImages?.[0]?.image?.imageBytes ||
        response?.generatedImages?.[0]?.image?.bytes;

    if (!imageBytes) {
        throw new Error("No image bytes in Imagen response");
    }

    return { buffer: Buffer.from(imageBytes, "base64"), mimeType: "image/png" };
};

const generateNanoBananaImageBytes = async (model, prompt) => {
    const response = await genAI.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });

    const extracted = extractImageBytesFromGenerateContentResponse(response);
    if (!extracted?.bytes) {
        throw new Error("No image bytes in Nano Banana response");
    }

    return {
        buffer: Buffer.from(extracted.bytes, "base64"),
        mimeType: extracted.mimeType,
    };
};

const generateGeminiImageBytes = async (model, prompt) => {
    if (isNanoBananaImageModel(model)) {
        return generateNanoBananaImageBytes(model, prompt);
    }
    return generateImagenImageBytes(model, prompt);
};

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const getOpenAIImageConfig = () => ({
    apiKey: process.env.OPENAI_API_KEY,
    model: String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim(),
    size: String(process.env.OPENAI_IMAGE_SIZE || "1024x1024").trim(),
    quality: String(process.env.OPENAI_IMAGE_QUALITY || "medium").trim(),
});

const getOpenAIChatConfig = () => ({
    apiKey: process.env.OPENAI_API_KEY,
    model: String(process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini").trim(),
});

const buildOpenAIImageRequestBody = (prompt, { model, size, quality }) => {
    const body = {
        model,
        prompt,
        n: 1,
        size,
    };

    if (model.startsWith("dall-e-3")) {
        body.quality = quality === "high" || quality === "hd" ? "hd" : "standard";
        body.response_format = "b64_json";
    } else if (model.startsWith("dall-e-2")) {
        body.response_format = "b64_json";
    } else if (model.startsWith("gpt-image")) {
        body.quality = quality;
    }

    return body;
};

const extractOpenAIImageBytes = (responseData) => {
    const item = responseData?.data?.[0];
    if (!item) return null;

    if (item.b64_json) {
        return Buffer.from(item.b64_json, "base64");
    }

    if (item.url) {
        return null;
    }

    return null;
};

const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_RETRY_DELAY_MS = 3000;

const ANTHROPIC_MESSAGES_URL =
    process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION =
    process.env.ANTHROPIC_API_VERSION?.trim() || "2023-06-01";
const CLAUDE_QB_MAX_ATTEMPTS = Math.max(
    1,
    Number(process.env.CLAUDE_QB_MAX_ATTEMPTS) || 6
);
const CLAUDE_RETRY_DELAY_MS = Math.max(
    500,
    Number(process.env.CLAUDE_RETRY_DELAY_MS) || 4000
);
const CLAUDE_RETRY_MAX_DELAY_MS = Math.max(
    CLAUDE_RETRY_DELAY_MS,
    Number(process.env.CLAUDE_RETRY_MAX_DELAY_MS) || 45000
);
const CLAUDE_QB_GENERATION_TEMPERATURE = Math.min(
    1,
    Math.max(0, Number(process.env.CLAUDE_QB_GENERATION_TEMPERATURE ?? 0.1))
);
const CLAUDE_QB_MAX_OUTPUT_TOKENS = Math.max(
    1024,
    Number(process.env.CLAUDE_QB_MAX_OUTPUT_TOKENS) || 16384
);
const CLAUDE_REQUEST_TIMEOUT_MS = Math.max(
    30_000,
    // Claude Sonnet 5 generates ~45 tok/s, so a full batch can take several
    // minutes — 120s default caused constant timeouts. Default now 5 min;
    // override with CLAUDE_REQUEST_TIMEOUT_MS in .env.
    Number(process.env.CLAUDE_REQUEST_TIMEOUT_MS) || 300_000
);

const claudeTextModel = () => resolveClaudeTextModel();

const getAnthropicRequestHeaders = (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
    "Content-Type": "application/json",
});

const extractAnthropicMessageText = (payload) => {
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    return blocks
        .filter((block) => block?.type === "text" && block?.text)
        .map((block) => String(block.text))
        .join("\n")
        .trim();
};

const parseAnthropicApiError = (error) => {
    const status = error?.response?.status;
    const body = error?.response?.data?.error || error?.response?.data || {};
    const message =
        body.message ||
        body.error?.message ||
        error?.message ||
        "Unknown Anthropic error";
    const type = String(body.type || body.error?.type || "").toLowerCase();
    return { status, message, type };
};

const isAnthropicRateLimitError = ({ status, message, type }) =>
    status === 429 ||
    type.includes("rate_limit") ||
    /rate limit/i.test(message);

const isAnthropicRetryableError = (error) => {
    const parsed = parseAnthropicApiError(error);
    const msg = collectErrorText(error);
    if (parsed.status === 401 || parsed.status === 403) return false;
    return (
        isAnthropicRateLimitError(parsed) ||
        parsed.status === 500 ||
        parsed.status === 502 ||
        parsed.status === 503 ||
        parsed.status === 529 ||
        parsed.status === 504 ||
        isNetworkGeminiError(error) ||
        msg.includes("overloaded")
    );
};

const getClaudeRetryDelayMs = (error, attempt) => {
    const parsed = parseAnthropicApiError(error);
    const rateLimited = isAnthropicRateLimitError(parsed);
    const network = isNetworkGeminiError(error);
    const base = network
        ? CLAUDE_RETRY_DELAY_MS * 2
        : rateLimited
          ? CLAUDE_RETRY_DELAY_MS * 3
          : CLAUDE_RETRY_DELAY_MS;
    const exponential = base * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, CLAUDE_RETRY_MAX_DELAY_MS);
};

const toClaudeQuestionBankError = (error) => {
    if (error instanceof ApiError) return error;
    const parsed = parseAnthropicApiError(error);
    const { status, message } = parsed;

    if (status === 401 || status === 403) {
        return new ApiError(
            500,
            "Anthropic API key is invalid (ANTHROPIC_API_KEY)"
        );
    }
    if (isAnthropicRateLimitError(parsed)) {
        return new ApiError(
            429,
            "Claude rate limit exceeded. Please wait a moment and try again."
        );
    }
    if (isAnthropicRetryableError(error)) {
        const network = isNetworkGeminiError(error);
        return new ApiError(
            503,
            network
                ? "Could not reach the Anthropic API (network error). Check your connection and try again."
                : "Claude is busy right now. Please wait a moment and try again."
        );
    }
    return new ApiError(500, `Claude question generation failed: ${message}`);
};

const callClaudeWithRetries = async (generateOnce) => {
    let lastError;
    for (let attempt = 1; attempt <= CLAUDE_QB_MAX_ATTEMPTS; attempt++) {
        try {
            return await generateOnce();
        } catch (error) {
            lastError = error;
            if (
                attempt < CLAUDE_QB_MAX_ATTEMPTS &&
                isAnthropicRetryableError(error)
            ) {
                const delayMs = getClaudeRetryDelayMs(error, attempt);
                console.warn(
                    `[claude] attempt ${attempt}/${CLAUDE_QB_MAX_ATTEMPTS} failed — retrying in ${delayMs}ms:`,
                    collectErrorText(error).slice(0, 200)
                );
                await sleep(delayMs);
                continue;
            }
            throw toClaudeQuestionBankError(error);
        }
    }
    throw toClaudeQuestionBankError(lastError);
};

const parseOpenAIApiError = (error) => {
    const status = error?.response?.status;
    const body = error?.response?.data?.error || {};
    const message = body.message || error?.message || "Unknown OpenAI error";
    const code = String(body.code || body.type || "").toLowerCase();
    return { status, message, code };
};

const isOpenAIQuotaExceeded = ({ status, message, code }) =>
    status === 429 &&
    (code === "insufficient_quota" || /quota|billing|exceeded your current/i.test(message));

const isOpenAIRetryableError = (error) => {
    const parsed = parseOpenAIApiError(error);
    if (parsed.status === 429 && isOpenAIQuotaExceeded(parsed)) return false;
    return parsed.status === 429 || parsed.status === 500 || parsed.status === 503;
};

const toOpenAIApiError = (error, actionLabel = "OpenAI request") => {
    if (error instanceof ApiError) return error;

    const parsed = parseOpenAIApiError(error);
    const { status, message, code } = parsed;

    if (status === 401) {
        return new ApiError(500, "OpenAI API key is invalid (OPENAI_API_KEY)");
    }
    if (isOpenAIQuotaExceeded(parsed)) {
        return new ApiError(
            402,
            "OpenAI account has no remaining quota. Add billing or credits at https://platform.openai.com/account/billing, or use Gemini for now."
        );
    }
    if (status === 429) {
        return new ApiError(
            429,
            "OpenAI rate limit exceeded. Please wait a moment and try again."
        );
    }
    if (status === 400 && /content policy|safety|moderation/i.test(message)) {
        return new ApiError(
            400,
            "OpenAI rejected this prompt due to content policy. Try regenerating the question."
        );
    }

    return new ApiError(500, `${actionLabel} failed: ${message}`);
};

const callOpenAIWithRetries = async (fn) => {
    let lastError;
    for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < OPENAI_MAX_ATTEMPTS && isOpenAIRetryableError(error)) {
                const retryAfter = Number(error?.response?.headers?.["retry-after"]);
                const delayMs =
                    Number.isFinite(retryAfter) && retryAfter > 0
                        ? retryAfter * 1000
                        : OPENAI_RETRY_DELAY_MS * attempt;
                await sleep(delayMs);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
};

const toOpenAIImageError = (error) => toOpenAIApiError(error, "OpenAI image generation");

const toOpenAIChatError = (error) => toOpenAIApiError(error, "OpenAI question generation");

const callOpenAIChatForText = async (
    prompt,
    { model: modelOverride, temperature = 0.2, reasoningEffort } = {}
) => {
    const { apiKey, model: defaultModel } = getOpenAIChatConfig();
    const model = modelOverride || defaultModel;
    return callOpenAIReasoningText({
        apiKey,
        prompt,
        model,
        temperature,
        reasoningEffort,
        callWithRetries: callOpenAIWithRetries,
        toError: toOpenAIChatError,
    });
};

const callOpenAIChatForJson = async (
    prompt,
    { model: modelOverride, reasoningEffort } = {}
) => {
    const { apiKey, model: defaultModel } = getOpenAIChatConfig();
    const model = modelOverride || defaultModel;
    return callOpenAIReasoningJson({
        apiKey,
        prompt,
        model,
        reasoningEffort,
        callWithRetries: callOpenAIWithRetries,
        toError: toOpenAIChatError,
    });
};

/**
 * Build the Anthropic Messages request body.
 * - `temperature` is only included for models that still accept it — newer
 *   models (Sonnet 5, Opus 4.8) deprecated the param and reject it.
 * - Extended thinking is DISABLED: Sonnet 5 runs thinking by default, and
 *   thinking tokens count against max_tokens. Left on, it burned ~15k of the
 *   16k budget reasoning and returned an empty/truncated answer ("Claude
 *   returned empty response"). Disabling it made generation ~20x faster and
 *   reliable — we need JSON questions, not a reasoning trace.
 */
const buildClaudeMessagesBody = (prompt, { temperature, model } = {}) => {
    const resolvedModel = resolveClaudeTextModel(model);
    const body = {
        model: resolvedModel,
        max_tokens: CLAUDE_QB_MAX_OUTPUT_TOKENS,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: prompt }],
    };
    if (claudeModelSupportsTemperature(resolvedModel)) {
        body.temperature = temperature ?? CLAUDE_QB_GENERATION_TEMPERATURE;
    }
    return body;
};

const callClaudeChatForJson = async (prompt, { temperature, model } = {}) => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
        throw new ApiError(500, "Anthropic API key is not configured (ANTHROPIC_API_KEY)");
    }

    return callClaudeWithRetries(async () => {
        const response = await axios.post(
            ANTHROPIC_MESSAGES_URL,
            buildClaudeMessagesBody(prompt, { temperature, model }),
            {
                headers: getAnthropicRequestHeaders(apiKey),
                timeout: CLAUDE_REQUEST_TIMEOUT_MS,
            }
        );

        const text = extractAnthropicMessageText(response.data);
        if (!text.trim()) {
            throw new ApiError(500, "Claude returned empty response");
        }
        return text;
    });
};

const callClaudeChatForText = async (
    prompt,
    { temperature, model } = {}
) => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
        throw new ApiError(500, "Anthropic API key is not configured (ANTHROPIC_API_KEY)");
    }

    return callClaudeWithRetries(async () => {
        const response = await axios.post(
            ANTHROPIC_MESSAGES_URL,
            buildClaudeMessagesBody(prompt, { temperature, model }),
            {
                headers: getAnthropicRequestHeaders(apiKey),
                timeout: CLAUDE_REQUEST_TIMEOUT_MS,
            }
        );

        const text = extractAnthropicMessageText(response.data);
        if (!text.trim()) {
            throw new ApiError(500, "Claude returned empty response");
        }
        return text;
    });
};

const callGeminiChatForJson = async (prompt, { temperature } = {}) => {
    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    return callGeminiWithRetries(async () => {
        const result = await genAI.models.generateContent({
            model: geminiTextModel(),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: geminiJsonConfig(temperature ?? 0.1),
        });
        const text = result.text || "";
        if (!text.trim()) {
            throw new ApiError(500, "Gemini returned empty response");
        }
        return text;
    });
};

/** 429/500/502/503/504 — provider is overloaded/unavailable, not a content/validation problem. */
const isProviderAvailabilityError = (error) =>
    error instanceof ApiError &&
    [429, 500, 502, 503, 504].includes(error.statusCode);

const PROVIDER_FALLBACK_ORDER = ["gemini", "claude", "openai"];

const isProviderConfigured = (provider) => {
    if (provider === "openai") return !!process.env.OPENAI_API_KEY;
    if (provider === "claude") return !!getAnthropicApiKey();
    return !!process.env.GEMINI_API_KEY;
};

const isProviderFallbackEnabled = () =>
    process.env.AI_QB_PROVIDER_FALLBACK !== "0";

const buildProviderFallbackChain = (primaryProvider) =>
    PROVIDER_FALLBACK_ORDER.filter(
        (p) => p !== primaryProvider && isProviderConfigured(p)
    );

/**
 * Runs `attemptFn(provider)` against the requested provider; on an
 * availability-class failure (busy/rate-limited/unavailable — never on
 * content-safety or validation errors), automatically retries the same
 * call against the next configured provider instead of failing the whole
 * generation. Each provider still exhausts its own internal retry/backoff
 * first — this only kicks in once a provider is genuinely down.
 */
const withProviderFallback = async (primaryProvider, attemptFn) => {
    try {
        return await attemptFn(primaryProvider);
    } catch (error) {
        if (!isProviderFallbackEnabled() || !isProviderAvailabilityError(error)) {
            throw error;
        }
        const chain = buildProviderFallbackChain(primaryProvider);
        let lastError = error;
        for (const nextProvider of chain) {
            pipelineTrace("PROVIDER_FALLBACK", {
                from: primaryProvider,
                to: nextProvider,
                reason: lastError?.message || String(lastError),
            });
            console.warn(
                `[ai-qb] ${primaryProvider} unavailable — falling back to ${nextProvider}: ${collectErrorText(lastError).slice(0, 200)}`
            );
            try {
                return await attemptFn(nextProvider);
            } catch (nextError) {
                lastError = nextError;
                if (!isProviderAvailabilityError(nextError)) {
                    throw nextError;
                }
            }
        }
        throw lastError;
    }
};

const dispatchGenerationLLMText = async (provider, prompt, temperature, modelOverride) => {
    if (provider === "openai") {
        if (!process.env.OPENAI_API_KEY) {
            throw new ApiError(
                500,
                "OpenAI API key is not configured (OPENAI_API_KEY)"
            );
        }
        const model =
            modelOverride ||
            process.env.OPENAI_QB_GENERATION_MODEL?.trim() ||
            getOpenAIChatConfig().model;
        return callOpenAIChatForText(prompt, { model, temperature });
    }

    if (provider === "claude") {
        return callClaudeChatForText(prompt, { temperature });
    }

    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    return callGeminiWithRetries(async () => {
        const model = modelOverride
            ? resolveGeminiTextModel(modelOverride)
            : geminiTextModel();
        const result = await genAI.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { temperature },
        });
        const text = result.text || "";
        if (!text) {
            throw new ApiError(500, "AI returned empty response");
        }
        return text;
    });
};

const callQuestionBankGenerationLLMText = async (
    prompt,
    { generationProvider = "gemini", temperature = 0.2, model } = {}
) => {
    const provider = normalizeGenerationProvider(generationProvider);
    return withProviderFallback(provider, (p) =>
        dispatchGenerationLLMText(p, prompt, temperature, model)
    );
};

const dispatchGenerationLLM = async (
    provider,
    prompt,
    temperature,
    modelOverride,
    reasoningEffort
) => {
    if (provider === "openai") {
        if (!process.env.OPENAI_API_KEY) {
            throw new ApiError(
                500,
                "OpenAI API key is not configured (OPENAI_API_KEY)"
            );
        }
        const model =
            modelOverride ||
            process.env.OPENAI_QB_GENERATION_MODEL?.trim() ||
            getOpenAIChatConfig().model;
        return callOpenAIChatForJson(prompt, { model, reasoningEffort });
    }

    if (provider === "claude") {
        return callClaudeChatForJson(prompt, {
            temperature: resolveGenerationTemperature(provider, {
                genTemperature: temperature,
            }),
        });
    }

    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    return callGeminiWithRetries(async () => {
        // Honor modelOverride so hard/exam batches can use GEMINI_HARD_TEXT_MODEL
        // (gemini-3.5-flash / 2.5-flash) instead of the global flash-lite default.
        const model = modelOverride
            ? resolveGeminiTextModel(modelOverride)
            : geminiTextModel();
        const result = await genAI.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: geminiJsonConfig(temperature),
        });
        const text = result.text || "";
        if (!text) {
            throw new ApiError(500, "AI returned empty response");
        }
        return text;
    });
};

const callQuestionBankGenerationLLM = async (
    prompt,
    { generationProvider = "gemini", temperature, model, reasoningEffort } = {}
) => {
    const provider = normalizeGenerationProvider(generationProvider);
    return withProviderFallback(provider, (p) =>
        dispatchGenerationLLM(p, prompt, temperature, model, reasoningEffort)
    );
};

/**
 * Generate a single image-based MCQ (text + imageSpec) via Gemini.
 */
export const generateImageQuestionText = async (params) => {
    const {
        topic,
        bankName,
        difficulty,
        excludeQuestionTexts = [],
        imageQuestionType = "mixed",
        usedImageQuestionTypes = [],
        categoryPaths = [],
        sectionName = "",
        subject = "",
    } = params;

    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    const prompt = buildImageQuestionPrompt({
        topic,
        bankName,
        difficulty,
        excludeQuestionTexts,
        imageQuestionType,
        usedImageQuestionTypes,
        categoryPaths,
        sectionName,
        subject,
    });

    return callGeminiWithRetries(async () => {
        const result = await genAI.models.generateContent({
            model: geminiTextModel(),
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
            },
        });

        const text = result.text || "";
        if (!text) {
            throw new ApiError(500, "AI returned empty response");
        }

        return parseImageQuestionAIResponse(text);
    });
};

/**
 * Generate a single image-based MCQ (text + imageSpec) via OpenAI — test flow only.
 */
export const generateImageQuestionTextWithOpenAI = async (params) => {
    const {
        topic,
        bankName,
        difficulty,
        excludeQuestionTexts = [],
        imageQuestionType = "mixed",
        usedImageQuestionTypes = [],
        categoryPaths = [],
        sectionName = "",
        subject = "",
    } = params;

    const prompt = buildImageQuestionPrompt({
        topic,
        bankName,
        difficulty,
        excludeQuestionTexts,
        imageQuestionType,
        usedImageQuestionTypes,
        categoryPaths,
        sectionName,
        subject,
    });

    const text = await callOpenAIChatForJson(prompt);
    return parseImageQuestionAIResponse(text);
};

/**
 * Generate an educational image from imageSpec, upload to S3, return public URL.
 */
export const generateQuestionImageFromSpec = async (imageSpec, options = {}) => {
    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }

    const prompt = buildImagePromptFromSpec(imageSpec);
    if (!prompt || prompt.length < 10) {
        throw new ApiError(
            400,
            "imageSpec.imagePrompt or imageSpec.description is required to generate an image"
        );
    }

    const requestedModel = options.imageModel;
    let modelsToTry;
    try {
        modelsToTry = requestedModel
            ? [resolveGeminiImageModel(requestedModel)]
            : IMAGEN_FALLBACK_MODELS;
    } catch (error) {
        throw new ApiError(400, error.message);
    }

    let lastError;
    for (const model of modelsToTry) {
        try {
            const { buffer, mimeType } = await callGeminiWithRetries(() =>
                generateGeminiImageBytes(model, prompt)
            );

            const ext = extensionForMimeType(mimeType);
            const imageUrl = await uploadImageToCloudinary(
                buffer,
                `ai-question-image.${ext}`,
                "question-images",
                mimeType
            );

            const modelMeta = getImageModelMeta(model);

            return {
                imageUrl,
                prompt,
                provider: "gemini",
                model,
                modelLabel: modelMeta?.label || model,
                modelFamily: modelMeta?.family || "imagen",
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw toGeminiQuestionBankError(
        lastError || new Error("Image generation failed for all Gemini image models")
    );
};

/**
 * Generate an educational image from imageSpec via OpenAI, upload to S3, return public URL.
 */
export const generateQuestionImageFromSpecWithOpenAI = async (imageSpec) => {
    const { apiKey, model, size, quality } = getOpenAIImageConfig();

    if (!apiKey) {
        throw new ApiError(500, "OpenAI API key is not configured (OPENAI_API_KEY)");
    }

    const prompt = buildImagePromptFromSpec(imageSpec);
    if (!prompt || prompt.length < 10) {
        throw new ApiError(
            400,
            "imageSpec.imagePrompt or imageSpec.description is required to generate an image"
        );
    }

    try {
        const response = await callOpenAIWithRetries(() =>
            axios.post(
                OPENAI_IMAGES_URL,
                buildOpenAIImageRequestBody(prompt, { model, size, quality }),
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 120000,
                }
            )
        );

        let buffer = extractOpenAIImageBytes(response.data);
        const remoteUrl = response.data?.data?.[0]?.url;

        if (!buffer && remoteUrl) {
            const imageResponse = await axios.get(remoteUrl, {
                responseType: "arraybuffer",
                timeout: 60000,
            });
            buffer = Buffer.from(imageResponse.data);
        }

        if (!buffer) {
            throw new Error("No image data in OpenAI response");
        }

        const imageUrl = await uploadImageToCloudinary(
            buffer,
            "ai-question-image-openai.png",
            "question-images",
            "image/png"
        );

        return { imageUrl, prompt, provider: "openai", model };
    } catch (error) {
        throw toOpenAIImageError(error);
    }
};

export const validateQuestionTopicRelevance = async (params) => {
    const {
        topic,
        bankName = "",
        subject = "",
        sectionName = "",
        difficulty = "",
        questions = [],
        alreadyEvaluated = false,
        evaluationProvider = "openai",
        competitiveExamPlan = null,
        categoryPaths = [],
        singleCount = 0,
        multipleCount = 0,
        trueFalseCount = 0,
        passageCount = 0,
        passageSingleCount = 0,
        passageMultipleCount = 0,
        passageTrueFalseCount = 0,
    } = params;

    assertTopicRelevanceEvaluationAllowed({
        alreadyEvaluated,
        questionCount: Array.isArray(questions) ? questions.length : 0,
    });

    const provider = evaluationProvider === "gemini" ? "gemini" : "openai";
    if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }
    if (provider === "openai" && !process.env.OPENAI_API_KEY) {
        throw new ApiError(500, "OpenAI API key is not configured (OPENAI_API_KEY)");
    }

    const callAuditLlm =
        provider === "gemini" ? callGeminiChatForJson : callOpenAIChatForJson;

    const { sampled, totalCount, sampleCount } = sampleQuestionsForValidation(
        enrichQuestionsForDifficultyAudit(questions),
        TOPIC_RELEVANCE_MAX_SAMPLE
    );

    if (!sampled.length) {
        throw new ApiError(400, "At least one question is required for validation");
    }

    const generationPlan = buildGenerationPlanForEvaluation({
        competitiveExamPlan,
        singleCount,
        multipleCount,
        trueFalseCount,
        passageCount,
        passageSingleCount,
        passageMultipleCount,
        passageTrueFalseCount,
        bankName,
        topic,
        sectionName,
        categoryPaths,
        subject,
        difficulty,
    });

    const examCtx = resolveExamContextForGeneration({
        competitiveExamPlan: generationPlan,
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });
    const examProfile = examCtx.examProfile;
    const isJeeProfile =
        examProfile === "jee_main" || examProfile === "jee_advanced";

    const patternComplianceResult = auditPatternCompliance(
        generationPlan,
        questions
    );

    const promptContext = { topic, bankName, sectionName };
    const preAudit = runDeterministicCorrectnessAudit(sampled);
    const difficultyPreAudit = runDeterministicDifficultyAudit(
        sampled.map((q) => ({
            ...q,
            difficultyTier: q.difficulty || difficulty,
            _solveSteps: q._solveSteps,
            _conceptSlot: q._conceptSlot,
            _questionKind: q._questionKind || q.questionKind,
        })),
        {
            bankDifficulty: difficulty || generationPlan?.bankDifficulty || "hard",
            examProfile,
            examCalibrated: generationPlan?.examCalibrated || false,
            subject,
        }
    );
    pipelineTrace('VALIDATE_PRE_AUDIT', {
        provider,
        sampleCount,
        totalCount,
        correctnessScore: preAudit.correctnessScore,
        styleScore: preAudit.styleScore,
        difficultyMatchScore: difficultyPreAudit.difficultyMatchScore,
        issueCount: preAudit.confirmedIssues?.length ?? 0,
    });
    if (preAudit.confirmedIssues?.length) {
        pipelineTraceSection(
            'pre-audit issues',
            preAudit.confirmedIssues.slice(0, 25).map(
                (i) => `Q${i.questionNumber}: ${i.issue}`
            )
        );
    }
    const correctnessModel =
        provider === "openai"
            ? process.env.OPENAI_CORRECTNESS_AUDIT_MODEL?.trim() || "gpt-4o"
            : undefined;

    const topicPrompt = buildTopicRelevancePrompt({
        topic,
        bankName,
        subject,
        sectionName,
        difficulty,
        examProfile,
        sampled,
        totalCount,
        sampleCount,
    });
    const correctnessPrompt = buildCorrectnessAuditPrompt({
        topic,
        difficulty,
        examProfile,
        sampled,
        totalCount,
        sampleCount,
    });
    const authenticityPrompt = isJeeProfile
        ? buildJeeAuthenticityAuditPrompt({
              topic,
              difficulty,
              examProfile,
              generationPlan,
              sampled,
              totalCount,
              sampleCount,
          })
        : null;

    try {
        const [topicRaw, correctnessRaw, authenticityRaw] = await Promise.all([
            callAuditLlm(topicPrompt),
            callAuditLlm(
                correctnessPrompt,
                provider === "openai" ? { model: correctnessModel } : {}
            ),
            authenticityPrompt
                ? callAuditLlm(
                      authenticityPrompt,
                      provider === "openai" ? { model: correctnessModel } : {}
                  )
                : Promise.resolve(null),
        ]);
        const topicResult = parseTopicRelevanceResponse(topicRaw, promptContext);
        const llmCorrectness = parseCorrectnessAuditResponse(correctnessRaw);
        const correctnessResult = mergeCorrectnessAuditResults(
            preAudit,
            llmCorrectness
        );
        const authenticityResult =
            authenticityRaw != null
                ? parseAuthenticityAuditResponse(authenticityRaw)
                : null;
        const result = mergeValidationResults(
            topicResult,
            correctnessResult,
            promptContext,
            authenticityResult,
            patternComplianceResult,
            {
                questionsAudited: sampleCount,
                totalCount,
                deterministicDifficultyScore:
                    difficultyPreAudit.difficultyMatchScore,
            }
        );
        pipelineTrace('VALIDATE_SCORES', {
            overallScore: result.overallScore,
            topicRelevanceScore: result.topicRelevanceScore,
            correctnessScore: result.correctnessScore,
            styleScore: result.styleScore,
            authenticityScore: result.authenticityScore,
            diversityScore: result.diversityScore,
            difficultyMatchScore: result.difficultyMatchScore,
            dimensionScores: result.dimensionScores,
            patternComplianceScore: result.patternComplianceScore,
            factualIssueCount: result.factualIssues?.length ?? 0,
        });
        if (result.factualIssues?.length) {
            pipelineTraceSection(
                'factual issues',
                result.factualIssues.slice(0, 25).map(
                    (i) => `Q${i.questionNumber}: ${i.issue}`
                )
            );
        }
        return {
            ...result,
            totalCount,
            sampleCount,
            maxSample: TOPIC_RELEVANCE_MAX_SAMPLE,
            evaluationProvider: provider,
            pipelineSummary: {
                overallScore: result.overallScore,
                topicRelevanceScore: result.topicRelevanceScore,
                correctnessScore: result.correctnessScore,
                styleScore: result.styleScore,
                authenticityScore: result.authenticityScore,
                diversityScore: result.diversityScore,
                difficultyMatchScore: result.difficultyMatchScore,
                dimensionScores: result.dimensionScores,
                preAuditScore: preAudit.correctnessScore,
                correctQuestions: result.correctQuestions,
                criticalErrors: result.criticalErrors,
                majorErrors: result.majorErrors,
                minorErrors: result.minorErrors,
                sampleCount,
                totalCount,
            },
        };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw provider === "openai"
            ? toOpenAIApiError(error, "OpenAI topic validation")
            : new ApiError(
                  500,
                  error?.message || "Gemini topic validation failed"
              );
    }
};

export default {
    generateQuestionsWithAI,
    inferQuestionBankCounts,
    inferCompetitiveExamPlan,
    planQuestionBankTopics,
    generateQuestionBankSuggestions,
    generateImageQuestionText,
    generateImageQuestionTextWithOpenAI,
    generateQuestionImageFromSpec,
    generateQuestionImageFromSpecWithOpenAI,
    getGeminiImageModelOptions,
    validateQuestionTopicRelevance,
    shouldDeferQuestionBankValidation,
    prepareFastPathQuestions,
    finalizeQuestionBankSuggestions,
    applyAnswerCorrectionToQuestionBank,
};
