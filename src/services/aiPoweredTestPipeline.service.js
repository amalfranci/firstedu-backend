/**
 * Exam-aware paper-generation pipeline used by /admin/ai-powered-test/*.
 * Exam name in writer/solver prompts comes from the user's selected
 * examType / examLabel (see paperExamIdentity.service.js) — not hardcoded.
 *
 * Minimal parallel flow:
 *   plan → Gemini generate (parallel) → free schema check
 *        → o3 solve + verify answer + verifiedSolution (parallel)
 *        → READY (no Gemini expand, no Luna paper audit)
 *
 * PAPER_JOB_RUNNER=worker (default) enqueues for scripts/paper-job-worker.mjs.
 * PAPER_JOB_RUNNER=inline keeps work in the API process for local UI testing.
 */

import { inspect } from "util";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "crypto";
import { ApiError } from "../utils/ApiError.js";
import {
  isProviderCreditsExhausted,
  isOpenAiAuthError,
  providerCreditsError,
  PROVIDER_CREDITS_CODE,
  OPENAI_AUTH_CODE,
  OPENAI_AUTH_USER_MESSAGE,
  markProviderFatalAbort,
  clearProviderFatalAbort,
  getProviderFatalAbort,
} from "../utils/aiProviderErrors.js";
import {
  alignExplanationToMarkedAnswer,
  sanitizeExplanationText,
  finalizeExplanationForPublish,
  autoFixOptionArticles,
  stripOptionLabelPrefix,
} from "../utils/explanationAnswerAlign.js";
import { safeJsonParse } from "../utils/aiJsonRepair.js";
import { dedupePaperQuestionsByStem } from "../utils/paperQuestionDedupe.js";
import { callOpenAIReasoningJson } from "./openaiReasoningChat.service.js";
import { resolveGeminiTextModelForTier } from "./geminiTextModels.js";
import {
  getHighRelevanceAdvancedTopics,
  getJeeAdvancedMathTopics,
} from "./jeeAdvancedMaths.service.js";
import {
  getHighRelevanceAdvancedPhysicsTopics,
  getJeeAdvancedPhysicsTopics,
} from "./jeeAdvancedPhysics.service.js";
import {
  allocateTopicsFromPool,
  describeAllocation,
  markAllocatedTopicsUsed,
} from "./jeeAdvancedTopicAllocator.service.js";
import {
  createGenerationJob,
  updateGenerationJob,
  getGenerationJob,
  cancelGenerationJob,
} from "./questionBankGenerationJobStore.js";
import {
  enqueuePaperJob,
  requeuePaperJob,
  isInlinePaperRunner,
  PAPER_JOB_RUNNER,
} from "./paperJobQueue.service.js";
import {
  appendPaperLog,
  bindPaperJob,
  extractGeminiUsage,
  getQuestionContext,
  persistJobRecord,
  persistQuestionRecord,
  readTokenSummary,
  recordModelUsage,
  runQuestionContext,
  saveQuestionSnapshot,
  saveGeneratedPaperDraft,
  summarizeCalls,
} from "./paperJobArtifact.service.js";
import { runParallelPaperPipeline } from "./paperParallelOrchestrator.service.js";
import {
  resolvePaperExam,
  buildWriterHardnessLock,
  paperScoreFloor,
  paperDefaultQuestionKind,
} from "./paperExamIdentity.service.js";
import { buildCatVarcAuthoringBlock } from "./examPromptContext.service.js";
import {
  buildCompetitiveQualityLock,
  buildQuestionStructureLock,
  isVerbalQualitativeSubject,
  looksLikeMisplacedNumericalStem,
  looksLikeNumericalVarcStem,
  mcqOptionsAreComplete,
  resolveCompetitiveSeatType,
} from "./paperCompetitiveQuality.service.js";

export { looksLikeNumericalVarcStem, looksLikeMisplacedNumericalStem };

const PIPELINE_DIR = dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOG = "[ai-powered-test]";
let currentJobId = null;
let lastCallContext = null;

const collectErrorChain = (err, depth = 0) => {
  if (!err || depth > 8) return null;
  const item = {
    name: err.name || err.constructor?.name || typeof err,
    message: err.message != null ? String(err.message) : String(err),
    stack: err.stack || null,
    code: err.code ?? err.errno ?? null,
    status: err.status ?? err.statusCode ?? err?.response?.status ?? null,
    aborted:
      err.name === "AbortError" ||
      err.code === 20 ||
      /aborted|AbortError/i.test(String(err.message || "")),
  };
  for (const key of ["statusText", "type", "error", "errorDetails", "reason"]) {
    if (err[key] != null) item[key] = err[key];
  }
  if (err.response?.data) item.responseData = err.response.data;
  if (err.response?.headers) {
    item.responseHeaders = {
      "content-type": err.response.headers["content-type"],
      "x-request-id":
        err.response.headers["x-request-id"] ||
        err.response.headers["x-openai-request-id"],
    };
  }
  if (err.cause) item.cause = collectErrorChain(err.cause, depth + 1);
  return item;
};

const serializeError = (err) => {
  if (!err) return null;
  return {
    ...collectErrorChain(err),
    inspect: inspect(err, { depth: 8, breakLength: 120, maxArrayLength: 20 }),
  };
};

const logPromptPayload = (prompt) => {
  const text = String(prompt || "");
  const max = Number(
    process.env.PAPER_LOG_PROMPT_CHARS ||
      process.env.JEE_ADV_LOG_PROMPT_CHARS ||
      200000
  );
  return {
    promptChars: text.length,
    promptPreview: text.slice(0, 800),
    promptTail: text.length > 800 ? text.slice(-400) : undefined,
    prompt:
      process.env.PAPER_LOG_FULL_PROMPT === "0" ||
      process.env.JEE_ADV_LOG_FULL_PROMPT === "0"
        ? undefined
        : text.length <= max
          ? text
          : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`,
  };
};

const pipelineLog = (event, payload = {}) => {
  const jobId =
    currentJobId ||
    payload?.jobId ||
    getQuestionContext()?.jobId ||
    getProviderFatalAbort()?.jobId ||
    null;
  const body = {
    ts: new Date().toISOString(),
    jobId,
    event,
    ...payload,
  };
  if (payload.error) body.error = serializeError(payload.error);
  if (jobId) {
    try {
      appendPaperLog(jobId, event, {
        ...payload,
        error: payload.error ? serializeError(payload.error) : undefined,
      });
      return;
    } catch {
      // fall through to console
    }
  }
  try {
    console.log(LOG, event, JSON.stringify(body, null, 2));
  } catch {
    console.log(LOG, event, inspect(body, { depth: 6 }));
  }
};

/** Fail the paper job immediately so UI polling sees credits error without waiting for unwind. */
const failJobForProviderCredits = (jobId, creditsErr) => {
  if (!jobId || !creditsErr) return;
  markProviderFatalAbort(jobId, creditsErr);
  try {
    updateGenerationJob(jobId, {
      status: "failed",
      phase: "error",
      error: creditsErr.message,
      errorCode: PROVIDER_CREDITS_CODE,
      message: creditsErr.message,
      resumable: false,
    });
  } catch {
    // non-fatal
  }
  persistJobRecord(jobId, {
    status: "failed",
    phase: "error",
    error: creditsErr.message,
    message: creditsErr.message,
    resumable: false,
  }).catch(() => {});
};

/**
 * Advanced writer prompts are huge. The global GEMINI_REQUEST_TIMEOUT_MS=30s
 * is for short UI calls and aborts this pipeline with AbortError.
 */
const getGeminiTimeoutMs = (kind = "generate") => {
  const dedicated = Number(
    process.env.PAPER_GEMINI_TIMEOUT_MS ||
      process.env.JEE_ADV_GEMINI_TIMEOUT_MS
  );
  if (Number.isFinite(dedicated) && dedicated > 0) return dedicated;
  const floor = kind === "solver" ? 90_000 : 180_000;
  return Math.max(floor, 60_000);
};

const isAbortError = (err) =>
  err?.name === "AbortError" ||
  err?.code === 20 ||
  /aborted|AbortError/i.test(String(err?.message || err || ""));

const isTransientGeminiError = (err) => {
  // Billing / prepaid credits are never transient — fail the job immediately.
  if (isProviderCreditsExhausted(err)) return false;
  const msg = String(err?.message || err || "");
  const status = Number(err?.status || err?.response?.status || 0);
  if (status === 402) return false;
  return (
    isAbortError(err) ||
    /503|UNAVAILABLE|429|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|ECONNABORTED|JSON|fetch failed/i.test(
      msg
    )
  );
};

const abortDiagnosis = ({
  kind,
  model,
  timeoutMs,
  elapsedMs,
  attempt,
  maxAttempts,
}) => {
  const envTimeout = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 0);
  return {
    reason: "gemini_http_aborted",
    meaning:
      "GoogleGenAI aborted the fetch (DOMException AbortError). This is almost always httpOptions.timeout, not a Gemini 4xx.",
    kind,
    model,
    timeoutMs,
    elapsedMs,
    attempt,
    maxAttempts,
    env: {
      GEMINI_REQUEST_TIMEOUT_MS: envTimeout || null,
      JEE_ADV_GEMINI_TIMEOUT_MS: process.env.JEE_ADV_GEMINI_TIMEOUT_MS || null,
      GEMINI_HARD_TEXT_MODEL: process.env.GEMINI_HARD_TEXT_MODEL || null,
    },
    hint: `Raise JEE_ADV_GEMINI_TIMEOUT_MS (this pipeline default ${getGeminiTimeoutMs(kind)}ms). Do not use GEMINI_REQUEST_TIMEOUT_MS=30000 for Advanced generate.`,
  };
};

const LATEX_JSON_HINT = `**LaTeX / JSON rules (mandatory):**
- Inside JSON strings use DOUBLE backslash: \\\\frac{a}{b}
- Prefer $...$ ; no real newlines inside JSON strings
- Every \\\\frac must have two braced args
- Return ONLY JSON`;

const geminiClient = (timeoutMs) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: timeoutMs },
  });
};

const parseJsonLoose = (raw) => {
  if (raw && typeof raw === "object") return raw;
  try {
    return safeJsonParse(raw);
  } catch {
    const fixed = String(raw || "").replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return safeJsonParse(fixed);
  }
};

const callGeminiJson = async (prompt, { kind = "generate" } = {}) => {
  const timeoutMs = getGeminiTimeoutMs(kind);
  const client = geminiClient(timeoutMs);
  const model =
    process.env.GEMINI_HARD_TEXT_MODEL ||
    resolveGeminiTextModelForTier({ difficulty: "hard", examCalibrated: true }) ||
    "gemini-3.5-flash";
  const maxAttempts = Number(
    process.env.PAPER_GEMINI_JSON_ATTEMPTS ||
      process.env.JEE_ADV_GEMINI_JSON_ATTEMPTS ||
      4
  );
  const temperature = kind === "expand" ? 0.2 : 0.1;
  const requestPayload = {
    model,
    timeoutMs,
    kind,
    temperature,
    responseMimeType: "application/json",
    ...logPromptPayload(prompt),
  };
  lastCallContext = { provider: "gemini", ...requestPayload };
  let lastErr;

  // If another parallel seat already hit billing exhaustion, stop immediately.
  const priorAbort = getProviderFatalAbort(currentJobId);
  if (priorAbort?.error) {
    throw priorAbort.error;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (getProviderFatalAbort(currentJobId)?.error) {
      throw getProviderFatalAbort(currentJobId).error;
    }
    const startedAt = Date.now();
    pipelineLog("GEMINI_REQUEST", {
      ...requestPayload,
      attempt,
      maxAttempts,
      payload: {
        model,
        contents: [
          { role: "user", parts: [{ textChars: requestPayload.promptChars }] },
        ],
        config: { temperature, responseMimeType: "application/json" },
        httpOptions: { timeout: timeoutMs },
      },
    });
    try {
      const result = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature, responseMimeType: "application/json" },
      });
      const elapsedMs = Date.now() - startedAt;
      const text = String(result.text || "").trim();
      const usage = extractGeminiUsage(result, { model, kind });
      recordModelUsage(currentJobId, usage);
      pipelineLog("GEMINI_RESPONSE", {
        kind,
        model,
        attempt,
        elapsedMs,
        timeoutMs,
        empty: !text,
        responseChars: text.length,
        responsePreview: text.slice(0, 600),
        tokens: usage,
        finishReason:
          result?.candidates?.[0]?.finishReason ||
          result?.response?.candidates?.[0]?.finishReason ||
          null,
      });
      if (!text) throw new Error("Gemini returned empty text");
      return parseJsonLoose(text);
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      lastErr = err;
      const aborted = isAbortError(err);
      const diagnosis = aborted
        ? abortDiagnosis({
            kind,
            model,
            timeoutMs,
            elapsedMs,
            attempt,
            maxAttempts,
          })
        : null;
      lastCallContext = {
        provider: "gemini",
        ...requestPayload,
        attempt,
        elapsedMs,
        aborted,
        diagnosis,
      };

      if (isProviderCreditsExhausted(err)) {
        const creditsErr = providerCreditsError(err, "gemini");
        creditsErr.pipeline = lastCallContext;
        // First seat wins — mark job failed immediately and latch abort.
        const already = getProviderFatalAbort(currentJobId);
        if (!already) {
          pipelineLog("PROVIDER_CREDITS_EXHAUSTED", {
            kind,
            model,
            provider: "gemini",
            status: 402,
            message: creditsErr.message,
            jobId: currentJobId,
          });
          failJobForProviderCredits(currentJobId, creditsErr);
        }
        throw already?.error || creditsErr;
      }

      pipelineLog("GEMINI_ERROR", {
        kind,
        model,
        attempt,
        maxAttempts,
        elapsedMs,
        timeoutMs,
        transient: isTransientGeminiError(err),
        aborted,
        diagnosis,
        error: err,
        requestPayload,
      });
      if (!isTransientGeminiError(err) || attempt >= maxAttempts) {
        const wrapped = new Error(
          aborted
            ? `Gemini ${kind} aborted after ${elapsedMs}ms (timeout ${timeoutMs}ms, model ${model}, attempt ${attempt}/${maxAttempts}). ${diagnosis.hint}`
            : `Gemini ${kind} failed (${model}, attempt ${attempt}/${maxAttempts}): ${err?.message || err}`
        );
        wrapped.cause = err;
        wrapped.pipeline = lastCallContext;
        throw wrapped;
      }
      const backoffMs = Math.min(45_000, 6_000 * attempt);
      pipelineLog("GEMINI_RETRY", {
        kind,
        model,
        attempt,
        nextAttempt: attempt + 1,
        backoffMs,
        reason: aborted ? "abort_timeout" : String(err?.message || err),
      });
      await sleep(backoffMs);
    }
  }
  throw lastErr;
};

const getVerifyModel = () =>
  String(
    process.env.OPENAI_VERIFY_MODEL ||
      process.env.OPENAI_SOLVER_MODEL ||
      "gpt-5.6-luna"
  ).trim() || "gpt-5.6-luna";

const getVerifyEffort = () => {
  const effort = String(
    process.env.OPENAI_VERIFY_REASONING_EFFORT || "high"
  )
    .trim()
    .toLowerCase();
  if (
    effort === "none" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
  ) {
    return effort;
  }
  return "high";
};

const getVerifyTimeoutMs = () =>
  Math.max(
    30_000,
    Math.min(
      300_000,
      Number(
          process.env.OPENAI_VERIFY_TIMEOUT_MS ||
          process.env.OPENAI_SOLVER_TIMEOUT_MS ||
          120_000
      )
    )
  );

const getVerifyMaxTokens = () =>
  Math.max(
    4000,
    Number(
      process.env.OPENAI_VERIFY_MAX_TOKENS ||
        process.env.OPENAI_SOLVER_MAX_TOKENS ||
        16000
    )
  );

const VERIFY_CONF_FLOOR = Number(
  process.env.PAPER_VERIFY_CONF ||
    process.env.JEE_ADV_VERIFY_CONF ||
    0.9
);

/** Single-model verify: GPT-5.6 Luna only. No o4/o3 chain, no Gemini solver fallback. */
const callVerifyJson = async (prompt) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getVerifyModel();
  const timeoutMs = getVerifyTimeoutMs();
  const reasoningEffort = getVerifyEffort();
  const maxCompletionTokens = getVerifyMaxTokens();
  if (!apiKey) {
    throw new Error("missing_OPENAI_API_KEY");
  }
  lastCallContext = {
    provider: "openai",
    model,
    timeoutMs,
    reasoningEffort,
    ...logPromptPayload(prompt),
  };
  pipelineLog("OPENAI_VERIFY_REQUEST", {
    model,
    timeoutMs,
    reasoningEffort,
    maxCompletionTokens,
    jsonMode: true,
    ...logPromptPayload(prompt),
  });
  const startedAt = Date.now();
  try {
    const packed = await callOpenAIReasoningJson({
      apiKey,
      prompt,
      model,
      reasoningEffort,
      callWithRetries: async (fn) => fn(),
      toError: (e) => e,
      timeoutMs,
      withUsage: true,
      disableFallback: true,
      maxCompletionTokens,
      developerHint:
        "Return ONLY valid JSON. No markdown fences. Complete independent solve, option check, recalculation, and key comparison before answering. PASS only if the question and key are mathematically correct.",
    });
    const text = packed?.text ?? packed;
    const usage = {
      provider: "openai",
      model: packed?.model || model,
      kind: "verify",
      promptTokens: Number(packed?.usage?.promptTokens) || 0,
      completionTokens: Number(packed?.usage?.completionTokens) || 0,
      totalTokens: Number(packed?.usage?.totalTokens) || 0,
      reasoningTokens: Number(packed?.usage?.reasoningTokens) || 0,
    };
    recordModelUsage(currentJobId, usage);
    pipelineLog("OPENAI_VERIFY_RESPONSE", {
      model: packed?.model || model,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      reasoningEffort,
      responseChars: String(text || "").length,
      responsePreview: String(text || "").slice(0, 600),
      tokens: usage,
    });
    return text;
  } catch (err) {
    const status = err?.response?.status;
    const elapsedMs = Date.now() - startedAt;
    lastCallContext = {
      provider: "openai",
      model,
      timeoutMs,
      elapsedMs,
      status,
      reasoningEffort,
      ...logPromptPayload(prompt),
    };
    pipelineLog("OPENAI_VERIFY_ERROR", {
      model,
      timeoutMs,
      elapsedMs,
      status,
      reasoningEffort,
      // Never log raw AxiosError — config.headers can contain API keys.
      error: {
        name: err?.name,
        message: err?.message,
        code: err?.code,
        status,
      },
      axiosData: err?.response?.data || null,
      ...logPromptPayload(prompt),
    });
    throw err;
  }
};

const normalizeSubject = (raw) => {
  const str =
    typeof raw === "object" && raw !== null
      ? raw.subject || raw.name || raw.label || raw.title || ""
      : String(raw || "");
  const key = str.toLowerCase().trim();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  if (key.startsWith("bot") || key.includes("botan")) return "Botany";
  if (key.startsWith("zoo") || key.includes("zool")) return "Zoology";
  if (key.startsWith("bio") || key.includes("biol")) return "Biology";
  if (key === "varc" || key.includes("verbal") || key.includes("reading comprehension"))
    return "VARC";
  if (key === "dilr" || key.includes("data interpretation") || key.includes("logical reasoning"))
    return "DILR";
  if (key === "qa" || key === "quantitative ability" || key === "quantitative aptitude")
    return "QA";
  return str.trim() || "General";
};

const writerLabel = (subject) => {
  const s = normalizeSubject(subject);
  if (s === "Physics") return "Physics";
  if (s === "Chemistry") return "Chemistry";
  if (s === "Botany") return "Botany";
  if (s === "Zoology") return "Zoology";
  if (s === "Biology") return "Biology";
  if (s === "Mathematics") return "Mathematics";
  return s || "Subject";
};

const topicIdsFromSlots = (slots = []) =>
  [...new Set((slots || []).map((s) => s.topicId).filter(Boolean))];

const clip = (value, n = 90) => {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
};

let chemistryTopicCache = null;
const getJeeAdvancedChemistryTopics = () => {
  if (chemistryTopicCache) return chemistryTopicCache;
  try {
    const data = JSON.parse(
      readFileSync(
        join(
          PIPELINE_DIR,
          "..",
          "..",
          "jee_advanced",
          "chemistry",
          "chemistry_syllabus.json"
        ),
        "utf8"
      )
    );
    chemistryTopicCache = (data.topics || []).map((t) => ({
      topicId: t.topic_id,
      chapter: t.chapter,
      branch: t.branch,
      ncert: {},
      scoring: { advanced_relevance: "" },
    }));
  } catch {
    chemistryTopicCache = [];
  }
  return chemistryTopicCache;
};

const neetTopicCache = {};
const neetNcertCache = { loaded: false, byId: {} };

const loadNeetNcertById = () => {
  if (neetNcertCache.loaded) return neetNcertCache.byId;
  const candidates = [
    join(PIPELINE_DIR, "..", "..", "NEET UG LATEST SEED FILE", "neet_ncert_context.json"),
    join(process.cwd(), "NEET UG LATEST SEED FILE", "neet_ncert_context.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (raw?.topics && typeof raw.topics === "object") {
        neetNcertCache.byId = raw.topics;
        neetNcertCache.loaded = true;
        return neetNcertCache.byId;
      }
    } catch {
      // try next
    }
  }
  neetNcertCache.loaded = true;
  return neetNcertCache.byId;
};

const getNeetSyllabusTopics = (subject) => {
  const norm = normalizeSubject(subject);
  if (neetTopicCache[norm]) return neetTopicCache[norm];

  const ncertById = loadNeetNcertById();
  const candidates = [
    join(PIPELINE_DIR, "..", "..", "NEET UG LATEST SEED FILE", "neet_syllabus.json"),
    join(process.cwd(), "NEET UG LATEST SEED FILE", "neet_syllabus.json"),
  ];

  const isBotanyChapter = (chapter) =>
    /plant physiology|plant growth|photosynthesis|mineral nutrition|transport in plants/.test(
      String(chapter || "").toLowerCase()
    );
  const isZoologyChapter = (chapter) =>
    /human physiology|animal|locomotion|neural|digestion|breathing|body fluids|excretory|biology and human welfare/.test(
      String(chapter || "").toLowerCase()
    );

  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const filtered = (raw.topics || []).filter((t) => {
        const sub = String(t.subject || "").trim();
        if (norm === "Physics") return sub === "Physics";
        if (norm === "Chemistry") return sub === "Chemistry";
        if (norm === "Botany") {
          if (sub === "Botany") return true;
          if (sub !== "Biology") return false;
          if (isZoologyChapter(t.chapter) && !isBotanyChapter(t.chapter)) return false;
          return true;
        }
        if (norm === "Zoology") {
          if (sub === "Zoology") return true;
          if (sub !== "Biology") return false;
          if (isBotanyChapter(t.chapter) && !isZoologyChapter(t.chapter)) return false;
          return true;
        }
        return false;
      });
      const list = filtered.map((t) => {
        const topicId = t.topic_id || t.topicId;
        const ncert = ncertById[topicId] || {
          concepts: t.subtopics || [],
          hard_archetypes: t.subtopics || [],
        };
        return {
          topicId,
          chapter: t.chapter,
          subtopics: t.subtopics || [],
          hardArchetypes: ncert.hard_archetypes || t.subtopics || [],
          allowed: ncert.concepts || t.subtopics || [],
          ncert,
        };
      });
      if (list.length) {
        neetTopicCache[norm] = list;
        return list;
      }
    } catch {
      // try next candidate
    }
  }
  return [];
};

const catTopicCache = {};
const catConceptCache = { loaded: false, byId: {} };

const loadCatConceptById = () => {
  if (catConceptCache.loaded) return catConceptCache.byId;
  const candidates = [
    join(PIPELINE_DIR, "..", "..", "CAT EXAM LATAETS SEED FILE", "cat_concept_context.json"),
    join(process.cwd(), "CAT EXAM LATAETS SEED FILE", "cat_concept_context.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (raw?.topics && typeof raw.topics === "object") {
        catConceptCache.byId = raw.topics;
        catConceptCache.loaded = true;
        return catConceptCache.byId;
      }
    } catch {
      // try next
    }
  }
  catConceptCache.loaded = true;
  return catConceptCache.byId;
};

const getCatSyllabusTopics = (subject) => {
  const norm = normalizeSubject(subject);
  if (catTopicCache[norm]) return catTopicCache[norm];

  const conceptById = loadCatConceptById();
  const candidates = [
    join(PIPELINE_DIR, "..", "..", "CAT EXAM LATAETS SEED FILE", "cat_syllabus.json"),
    join(process.cwd(), "CAT EXAM LATAETS SEED FILE", "cat_syllabus.json"),
  ];

  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const filtered = (raw.topics || []).filter((t) => {
        const section = normalizeSubject(t.section || t.subject || "");
        return section === norm;
      });
      const list = filtered.map((t) => {
        const topicId = t.topic_id || t.topicId;
        const ncert = conceptById[topicId] || {
          concepts: t.subtopics || [],
          hard_archetypes: t.subtopics || [],
        };
        return {
          topicId,
          chapter: t.topic_name || t.chapter || topicId,
          subtopics: t.subtopics || [],
          hardArchetypes: ncert.hard_archetypes || t.subtopics || [],
          allowed: ncert.concepts || t.subtopics || [],
          ncert,
        };
      });
      if (list.length) {
        catTopicCache[norm] = list;
        return list;
      }
    } catch {
      // try next candidate
    }
  }
  return [];
};

const lookupNcert = (subject, topicId) => {
  const neetHit = loadNeetNcertById()?.[topicId];
  if (neetHit) return neetHit;
  const catHit = loadCatConceptById()?.[topicId];
  if (catHit) return catHit;
  const pack =
    subject === "Physics"
      ? getJeeAdvancedPhysicsTopics()
      : subject === "Mathematics"
        ? getJeeAdvancedMathTopics()
        : [];
  return pack.find((t) => t.topicId === topicId)?.ncert || null;
};

const uniqKeep = (arr = []) => {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const text = String(item || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const cardBullets = (arr = [], n = 4, width = 80) =>
  uniqKeep(arr)
    .slice(0, n)
    .map((x) => `- ${clip(x, width)}`)
    .filter((x) => x.length > 3);

/** Fallback only — prefer paperScoreFloor(examType) per job. */
const SCORE_FLOOR = Number(
  process.env.JEE_ADV_SCORE_FLOOR ||
    process.env.PAPER_SCORE_FLOOR ||
    75
);

/** @deprecated use resolvePaperExam — kept as alias for local call sites */
const paperExamIdentity = resolvePaperExam;

/** One compact card per assigned slot. Do not also dump full NCERT essays. */
const buildWriterTopicCards = (
  slots = [],
  count,
  type = "single",
  examLabel = "Exam",
  examType = ""
) => {
  const batch = (slots || []).slice(0, count);
  const examTypeNorm = String(examType || "").toLowerCase();
  const isAdvancedExam = examTypeNorm === "jee_advanced";
  // Advanced NCERT archetype banks bias writers toward multi-concept fusion.
  // Only inject those for JEE Advanced; all other exams stay single-skill / exam-faithful.
  const skipAdvArchetypes = !isAdvancedExam;
  if (!batch.length) {
    return skipAdvArchetypes
      ? `Generate distinct hard ${examLabel || "exam"} (exam-faithful) items from the assigned topics.`
      : "Generate distinct hard exam items from the assigned topics.";
  }
  return batch
    .map((s) => {
      const ncert = skipAdvArchetypes
        ? {}
        : s.ncert || lookupNcert(s.subject, s.topicId) || {};
      const allowed = cardBullets(
        ncert.concepts?.length ? ncert.concepts : s.allowed || [],
        4,
        80
      );
      const preferred = cardBullets(
        skipAdvArchetypes
          ? s.hardArchetypes || []
          : ncert.hard_archetypes?.length
            ? ncert.hard_archetypes
            : s.hardArchetypes || [],
        6,
        90
      );
      const banned = cardBullets(
        [s.bannedEasy, ...(ncert.banned_easy_templates || [])],
        2,
        80
      );
      const formulas = cardBullets(ncert.formulas || [], 4, 70);
      const methods = cardBullets(ncert.methods || [], 2, 90);
      const outOfScope = cardBullets(ncert.out_of_scope || [], 2, 80);
      const lockedConcept =
        String(s.conceptSlot || s.hardArchetype || "").trim() || null;
      const lines = [
        `${s.topicId || "?"} ${s.chapter || s.topicId || "topic"}`,
        `question_type=${type} · difficulty=${s.difficulty || "hard"} · exam=${examLabel} · chapter_lock=${s.chapter_lock !== false} · concept_lock=${Boolean(s.concept_lock || lockedConcept)}`,
        lockedConcept
          ? `Assigned chapter + concept (backend lock). Primary concept family: ${lockedConcept}. Stay inside this chapter.`
          : `Assigned chapter (backend). Choose exactly ONE Preferred concept slot. Set conceptSlot to a short slug of that choice.`,
      ];
      if (type === "match") {
        lines.push(
          `MATCH LOCK: listI must have exactly ${s.list1_count || 4} items.`,
          `Every List-I item must belong to the assigned chapter as its PRIMARY concept.`,
          `No List-I item may have another chapter as its primary concept.`,
          `At least 3 of 4 List-I items must directly test the assigned concept family${lockedConcept ? ` (${lockedConcept})` : ""}.`,
          `List-II may be mixed tools/results, but matching must still be chapter-faithful.`
        );
      } else if (type === "multiple") {
        lines.push(
          skipAdvArchetypes
            ? `MULTI-CORRECT: keep options within one chapter idea; avoid Advanced-style independent mini-problems.`
            : `MULTI-CORRECT: prefer concepts with several independent true/false conditions.`
        );
      } else if (type === "integer") {
        lines.push(
          skipAdvArchetypes
            ? `INTEGER: short exam-faithful numeric derivation (unique integer), not a long Advanced chain.`
            : `INTEGER: prefer computational / non-routine numeric results (unique integer).`
        );
      } else {
        lines.push(
          skipAdvArchetypes
            ? `SINGLE: one primary concept + short calculation (2–4 steps). No Advanced multi-topic fusion.`
            : `SINGLE: prefer concepts suitable for a non-obvious multi-step derivation.`
        );
      }
      if (allowed.length) lines.push(`Allowed:\n${allowed.join("\n")}`);
      if (preferred.length) lines.push(`Preferred:\n${preferred.join("\n")}`);
      else {
        lines.push(
          skipAdvArchetypes
            ? `Preferred: pick ONE high-weight ${examLabel} concept from this chapter/topic (single-skill, not Advanced fusion).`
            : `Preferred: pick one high-difficulty ${examLabel} concept from this chapter.`
        );
      }
      if (banned.length) lines.push(`Banned:\n${banned.join("\n")}`);
      if (formulas.length) lines.push(`Formulas:\n${formulas.join("\n")}`);
      if (methods.length) lines.push(`Methods:\n${methods.join("\n")}`);
      if (outOfScope.length) {
        lines.push(`Out of scope (do not require):\n${outOfScope.join("\n")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
};

const SLOT_STOP = new Set([
  "trivial",
  "nontrivial",
  "plain",
  "simple",
  "given",
  "using",
  "from",
  "when",
  "that",
  "this",
  "which",
  "rather",
  "than",
  "requiring",
  "combined",
  "scenario",
  "problems",
  "question",
  "testing",
  "specific",
  "compute",
  "directly",
  "with",
  "into",
  "onto",
  "over",
  "after",
  "before",
  "their",
  "them",
]);

const slugSlot = (topicId, archetype, index = 0) => {
  const raw = String(archetype || "");
  if (/capacitor/i.test(raw) && /bridge/i.test(raw)) {
    return "capacitor_bridge_symmetry";
  }
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !SLOT_STOP.has(w));
  if (words.length) return words.slice(0, 3).join("_");
  return `${String(topicId || "slot").toLowerCase()}_${String(index + 1).padStart(2, "0")}`;
};

const stampTrust = (q) => {
  const mode = String(q._lockMode || "");
  const type = String(q._advancedType || q.questionType || "").toLowerCase();
  const stem = String(q.questionText || "");
  const highRisk =
    type === "integer" ||
    type === "match" ||
    /differenti|\\frac\{dy\}\{dx\}|dy\/dx|area of the region|infinitely many solutions|tr\(|trace|adj\(/i.test(
      stem
    );

  let grade = "provisional";
  let badge = "PROVISIONAL";
  let productionReady = false;
  let needsReview = true;
  let guaranteed = false;

  if (/o3/i.test(mode) || q._o3Verify) {
    grade = "production_o3";
    badge = q._rekeyedByO3 ? "O3-REKEYED" : "O3-VERIFIED";
    productionReady = true;
    needsReview = false;
    guaranteed = true;
  } else if (
    (/luna|gpt-5\.6/i.test(mode) || q._verifyPass) &&
    q._proposedKeyMatch
  ) {
    grade = "production_luna";
    badge = "LUNA-VERIFY";
    productionReady = true;
    needsReview = highRisk && Number(q._solverConfidence) < 0.95;
    guaranteed = true;
  } else if (/dual\(/i.test(mode) && q._doubleSolverAgree) {
    grade = "production_dual";
    badge = "DUAL-OPENAI";
    productionReady = true;
    needsReview = highRisk;
    guaranteed = true;
  } else if (/A\+gemini-B/i.test(mode) && q._doubleSolverAgree) {
    const recomputed = q._recomputeOk === true;
    grade = recomputed ? "cross_provider_recomputed" : "cross_provider";
    badge = recomputed ? "A+GEMINI-B+RECOMPUTE" : "A+GEMINI-B";
    productionReady = recomputed || (!highRisk && q._doubleSolverAgree);
    needsReview = highRisk && !recomputed;
    guaranteed = Boolean(recomputed);
  } else if (mode === "A+generator" || /generator/i.test(mode)) {
    grade = q._recomputeOk ? "provisional_recomputed" : "provisional";
    badge = q._recomputeOk ? "PROVISIONAL+RECOMPUTE" : "PROVISIONAL";
    productionReady = false;
    needsReview = true;
    guaranteed = false;
  }

  if (q._recomputeMismatch) {
    grade = "failed_recompute";
    badge = "RECOMPUTE-MISMATCH";
    productionReady = false;
    needsReview = true;
    guaranteed = false;
  } else if (highRisk && grade === "provisional") {
    badge = "PROVISIONAL-HIGH-RISK";
  }

  return {
    ...q,
    _trustBadge: badge,
    _trustGrade: grade,
    _productionReady: productionReady,
    _needsReview: needsReview,
    _answerCorrectnessGuaranteed: guaranteed,
  };
};

const excludeBlock = (excludeTexts = []) => {
  if (!excludeTexts?.length) return "";
  const cleaned = excludeTexts
    .slice(-20)
    .map((t) => {
      let text = String(t || "").trim();
      const stmtMatch = text.match(/(\*\*Statements:\*\*|Statements:[\s\S]*)/i);
      if (stmtMatch) {
        text = stmtMatch[0];
      } else {
        text = text
          .replace(
            /^(directions?|direction\s*:|in the (following|question)[^:\n]*:?\s*)/i,
            ""
          )
          .trim();
      }
      return text.slice(0, 160);
    })
    .filter(Boolean);

  return cleaned.length
    ? `Do NOT repeat these stems:\n${cleaned
        .map((t, i) => `${i + 1}. ${t}`)
        .join("\n")}`
    : "";
};

const normalizeMultiLetters = (raw) => {
  if (raw == null) return null;
  const letters = (
    Array.isArray(raw)
      ? raw.map((x) => String(x).trim().toUpperCase())
      : String(raw).toUpperCase().split(/[^A-D]+/)
  )
    .map((s) => s.replace(/[^A-D]/g, "").slice(0, 1))
    .filter((s) => /^[A-D]$/.test(s));
  const uniq = [...new Set(letters)].sort();
  return uniq.length ? uniq.join(",") : null;
};

const lettersToCorrectIndices = (key) =>
  String(key || "")
    .split(",")
    .map((L) => L.charCodeAt(0) - 65)
    .filter((i) => i >= 0 && i < 4);

const listFromGemini = (parsed) => {
  if (Array.isArray(parsed?.questions)) return parsed.questions;
  if (Array.isArray(parsed)) return parsed;
  return [];
};

const stripHtmlLite = (s = "") =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeQuestion = (q) => ({
  ...q,
  questionText: stripHtmlLite(q.questionText),
  options: Array.isArray(q.options)
    ? q.options.map((o) =>
        stripHtmlLite(typeof o === "string" ? o : o?.text || String(o || ""))
      )
    : [],
  explanation: stripHtmlLite(q.explanation),
});

export const planPipelineSlots = (config = {}) => {
  const examType = String(config.examType || "").toLowerCase();
  const isJeeMain = examType === "jee_main" || /jee\s*main/i.test(examType);

  if (isJeeMain) {
    config.questionStructure = "standalone";
    config.passageCount = 0;
    config.questionsPerPassage = 0;
    config.subjectStructures = null;
  }

  const subjects = (config.subjects || ["Mathematics"]).map(normalizeSubject);
  // All exams: only Single Correct + Multiple Correct.
  // Legacy integer/match counts fold into single.
  const legacyExtra =
    Math.max(0, Number(config.typeCounts?.integer) || 0) +
    Math.max(0, Number(config.typeCounts?.match) || 0);
  let typeCounts = {
    single:
      Math.max(0, Number(config.typeCounts?.single) || 0) + legacyExtra,
    multiple: isJeeMain
      ? 0
      : Math.max(
          0,
          Number(config.typeCounts?.multiple ?? config.typeCounts?.multi) || 0
        ),
  };
  if (isJeeMain) {
    const rawMulti = Math.max(
      0,
      Number(config.typeCounts?.multiple ?? config.typeCounts?.multi) || 0
    );
    if (rawMulti > 0) {
      typeCounts.single += rawMulti;
    }
  }
  let typeSum = typeCounts.single + typeCounts.multiple;
  const requestedTotal = Math.max(0, Number(config.totalQuestions) || 0);
  // Keep generate / verify on one agreed count.
  if (requestedTotal > 0 && typeSum !== requestedTotal) {
    if (typeSum <= 0) {
      typeCounts = { single: requestedTotal, multiple: 0 };
      typeSum = requestedTotal;
    } else {
      const scale = requestedTotal / typeSum;
      let single = Math.max(0, Math.round(typeCounts.single * scale));
      let multiple = Math.max(
        0,
        requestedTotal - single
      );
      // Prefer preserving multiple share when rounding drifts.
      const targetMulti = Math.max(
        0,
        Math.round(typeCounts.multiple * scale)
      );
      if (targetMulti !== multiple && targetMulti <= requestedTotal) {
        multiple = targetMulti;
        single = requestedTotal - multiple;
      }
      let sum = single + multiple;
      while (sum < requestedTotal) {
        single += 1;
        sum += 1;
      }
      while (sum > requestedTotal && single > 0) {
        single -= 1;
        sum -= 1;
      }
      typeCounts = { single, multiple };
      typeSum = requestedTotal;
    }
  }
  const totalQuestions = typeSum || requestedTotal;
  const selected = config.selectedTopics || {};
  const runTopics = config.runTopics || {};
  const subjectCounts = {};
  for (const s of subjects) {
    const norm = normalizeSubject(s);
    const rawCount =
      config.subjectCounts?.[s] ??
      config.subjectCounts?.[norm] ??
      config.subjectCounts?.[s.toLowerCase()];
    subjectCounts[s] = Math.max(0, Number(rawCount) || 0);
  }
  const hasAnySubjectCount = Object.values(subjectCounts).some((c) => c > 0);
  if (!hasAnySubjectCount) {
    const per = subjects.length
      ? Math.floor(totalQuestions / subjects.length)
      : totalQuestions;
    subjects.forEach((s, i) => {
      subjectCounts[s] =
        i === subjects.length - 1
          ? Math.max(0, totalQuestions - per * (subjects.length - 1))
          : per;
    });
  }

  const packFor = (subject) => {
    const s = normalizeSubject(subject);
    const examTypeNorm = String(config.examType || "").toLowerCase();
    if (examTypeNorm === "neet") {
      const neetList = getNeetSyllabusTopics(s);
      if (neetList.length) return neetList;
    }
    if (examTypeNorm === "cat") {
      const catList = getCatSyllabusTopics(s);
      if (catList.length) return catList;
    }
    if (s === "Physics") return getJeeAdvancedPhysicsTopics();
    if (s === "Mathematics") return getJeeAdvancedMathTopics();
    if (s === "Chemistry") return getJeeAdvancedChemistryTopics();
    if (s === "Botany" || s === "Zoology" || s === "Biology") {
      return getNeetSyllabusTopics(s);
    }
    if (s === "VARC" || s === "DILR" || s === "QA") {
      return getCatSyllabusTopics(s);
    }
    return [];
  };

  const toPoolItem = (subject, hit, topicId, index = 0) => {
    const id = hit?.topicId || topicId;
    const archetypes = hit?.ncert?.hard_archetypes || [];
    return {
      subject,
      topicId: id,
      chapter: hit?.chapter || topicId,
      conceptSlot: "",
      hardArchetype: "",
      hardArchetypes: archetypes,
      hardSlotCount: archetypes.length || undefined,
      bannedEasy: (hit?.ncert?.banned_easy_templates || [])[0] || "",
      allowed: (hit?.ncert?.concepts || []).slice(0, 4),
      relevance: hit?.scoring?.advanced_relevance || "",
      weight: hit?.scoring?.weight,
      ncert: hit?.ncert || null,
      _poolIndex: index,
    };
  };

  const buildSubjectPool = (subject) => {
    const runKeys = runTopics[subject] || [];
    const selectedKeys = selected[subject] || [];
    const keys = (runKeys.length ? runKeys : selectedKeys).filter(Boolean);
    const pack = packFor(subject);
    const items = [];
    if (keys.length) {
      for (const key of keys) {
        const topicId = String(key).split("::").pop();
        const hit =
          pack.find(
            (t) =>
              t.topicId === topicId ||
              t.chapter === topicId ||
              `${subject}::${t.topicId}` === key
          ) || null;
        items.push(toPoolItem(subject, hit, topicId, items.length));
      }
    } else {
      const high =
        subject === "Physics"
          ? getHighRelevanceAdvancedPhysicsTopics()
          : subject === "Mathematics"
            ? getHighRelevanceAdvancedTopics()
            : [];
      const fallback = high.length ? high : pack;
      fallback.forEach((t, i) => {
        items.push(toPoolItem(subject, t, t.topicId, i));
      });
    }
    return items;
  };

  const paper = Number(config.paper) || 1;
  const pools = {};
  const allocated = {};
  const leftovers = {};
  const topicPool = [];
  for (const subject of subjects) {
    const pool = buildSubjectPool(subject);
    pools[subject] = pool;
    const need = subjectCounts[subject] || 0;
    const picked = allocateTopicsFromPool(pool, need, { paper });
    allocated[subject] = picked;
    const pickedIds = new Set(picked.map((t) => t.topicId));
    leftovers[subject] = pool.filter((t) => !pickedIds.has(t.topicId));
    topicPool.push(...pool);
  }
  if (!topicPool.length) {
    topicPool.push({
      subject: subjects[0] || "Mathematics",
      topicId: "M01",
      chapter: "Algebra",
      conceptSlot: "",
    });
    pools[subjects[0] || "Mathematics"] = [...topicPool];
    allocated[subjects[0] || "Mathematics"] = [...topicPool];
    leftovers[subjects[0] || "Mathematics"] = [];
  }

  const pickTopic = (subject, index) => {
    const chosen = allocated[subject]?.length
      ? allocated[subject]
      : pools[subject]?.length
        ? pools[subject]
        : topicPool;
    return chosen[index % chosen.length];
  };

  const typeOrder = ["single", "multiple"];
  const typeQueue = [];
  for (const type of typeOrder) {
    for (let i = 0; i < (typeCounts[type] || 0); i += 1) typeQueue.push(type);
  }

  const subjectOrder = subjects.filter((s) => (subjectCounts[s] || 0) > 0);
  const seats = [];
  const used = Object.fromEntries(subjectOrder.map((s) => [s, 0]));
  while (seats.length < totalQuestions && subjectOrder.length) {
    let added = false;
    for (const s of subjectOrder) {
      if (used[s] < (subjectCounts[s] || 0) && seats.length < totalQuestions) {
        seats.push({ subject: s, index: used[s] });
        used[s] += 1;
        added = true;
      }
    }
    if (!added) break;
  }
  while (seats.length < totalQuestions) {
    const s = subjectOrder[seats.length % Math.max(1, subjectOrder.length)] || subjects[0];
    seats.push({ subject: s, index: seats.length });
  }

  const slots = { single: [], multiple: [] };
  const usedTopicKeys = new Set();
  const scoreTopicForType = (topic, type) => {
    const archetypes = topic?.hardArchetypes || topic?.ncert?.hard_archetypes || [];
    const n = archetypes.length;
    if (type === "multiple") return n * 2 + 2;
    return 4 + Math.min(n, 4);
  };
  const conceptRotationByTopic = new Map();
  const pickPreferredConcept = (topic, type) => {
    const archetypes =
      topic?.hardArchetypes ||
      topic?.ncert?.hard_archetypes ||
      topic?.subtopics ||
      [];
    if (!archetypes.length) return "";
    const key = `${topic.subject || ""}:${topic.topicId || ""}`;
    const usedCount = conceptRotationByTopic.get(key) || 0;
    conceptRotationByTopic.set(key, usedCount + 1);

    // Rotate through distinct concepts/subtopics so multiple seats in the same chapter do NOT get the exact same archetype
    return String(archetypes[usedCount % archetypes.length] || "").trim();
  };
  const takeBestTopic = (subject, type, index) => {
    const pool = (allocated[subject]?.length
      ? allocated[subject]
      : pools[subject]?.length
        ? pools[subject]
        : topicPool
    ).filter(Boolean);
    let best = null;
    let bestScore = -Infinity;
    for (const topic of pool) {
      const key = `${subject}:${topic.topicId}`;
      if (usedTopicKeys.has(key) && pool.some((t) => !usedTopicKeys.has(`${subject}:${t.topicId}`))) {
        continue;
      }
      const score = scoreTopicForType(topic, type);
      if (score > bestScore) {
        bestScore = score;
        best = topic;
      }
    }
    if (!best) {
      return pickTopic(subject, index);
    }
    usedTopicKeys.add(`${subject}:${best.topicId}`);
    return best;
  };

  const examTypeNorm = String(config.examType || "").toLowerCase();

  seats.forEach((seat, i) => {
    const type = resolveCompetitiveSeatType({
      examType: examTypeNorm,
      subject: seat.subject,
      fallbackType: typeQueue[i] || "single",
    });
    const topic = takeBestTopic(seat.subject, type, seat.index);
    const preferred = pickPreferredConcept(topic, type);
    slots[type].push({
      ...topic,
      subject: seat.subject,
      questionType: type,
      difficulty: "hard",
      conceptSlot: preferred,
      hardArchetype: preferred || topic.hardArchetype || "",
      chapter_lock: true,
      concept_lock: Boolean(preferred),
    });
  });

  const resolvedTypeCounts = {
    single: slots.single.length,
    multiple: slots.multiple.length,
  };

  const leftoverPool = subjects.flatMap((s) => leftovers[s] || []);
  const unusedFrom = () => leftoverPool;

  return {
    examType: config.examType || "competitive",
    paper,
    subjects,
    totalQuestions,
    questionStructure: config.questionStructure || "both",
    subjectStructureMode: config.subjectStructureMode || "unified",
    subjectStructures: config.subjectStructures || null,
    passageCount: Math.max(0, Number(config.passageCount) || 0),
    questionsPerPassage: Math.max(0, Number(config.questionsPerPassage) || 0),
    passageBasedQuestions: Math.max(
      0,
      Number(config.passageBasedQuestions) ||
        (Number(config.passageCount) || 0) *
          (Number(config.questionsPerPassage) || 0)
    ),
    standaloneQuestions: Math.max(
      0,
      Number(config.standaloneQuestions) ||
        totalQuestions -
          (Number(config.passageBasedQuestions) ||
            (Number(config.passageCount) || 0) *
              (Number(config.questionsPerPassage) || 0))
    ),
    typeCounts: resolvedTypeCounts,
    subjectCounts,
    topicPool,
    allocatedTopics: Object.fromEntries(
      subjects.map((s) => [s, describeAllocation(allocated[s] || [])])
    ),
    slots,
    unusedSlots: {
      single: unusedFrom(),
      multiple: unusedFrom(),
    },
  };
};

const generateBatch = async ({
  type,
  count,
  slots,
  subject,
  excludeTexts = [],
  examType,
  examLabel,
  questionStructure = "both",
  passageCount = 0,
  questionsPerPassage = 0,
  passageBasedQuestions = 0,
  standaloneQuestions = 0,
  /** "standalone" | "passage_followup" | "" — seat role inside mixed papers */
  seatMode = "",
  /** When regenerating a linked RC sub-question, reuse this exact passage. */
  lockedPassage = "",
  connectedGroup = "",
}) => {
  if (count <= 0) return [];
  const batchSlots = (slots || []).slice(0, count);
  const subj = normalizeSubject(subject || batchSlots[0]?.subject);
  const exam = paperExamIdentity({ examType, examLabel });
  const scoreFloor = paperScoreFloor(exam.examType);
  const questionKind = paperDefaultQuestionKind(exam.examType);
  const safeType = type === "multiple" ? "multiple" : "single";
  const topicCards = buildWriterTopicCards(
    batchSlots,
    count,
    safeType,
    exam.examLabel,
    exam.examType
  );
  const label = writerLabel(subj);
  const hardWord =
    exam.examType === "jee_advanced"
      ? "HARD"
      : exam.examType === "jee_main" || exam.examType === "neet"
        ? "HARD (exam-faithful, single-concept)"
        : "HARD (exam-faithful)";
  const typeLine =
    safeType === "multiple"
      ? `Generate exactly ${count} ${hardWord} MULTI-CORRECT MCQs. At least two of A–D are correct.`
      : `Generate exactly ${count} ${hardWord} SINGLE-CORRECT MCQs. Exactly one of A–D is correct. Place the correct option randomly among A–D (do NOT always put the correct answer in A).`;
  const exampleScore =
    exam.examType === "jee_advanced"
      ? 85
      : exam.examType === "jee_main" || exam.examType === "neet"
        ? 76
        : 78;
  const exampleLetter = ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];
  const schema =
    safeType === "multiple"
      ? `{"questions":[{"questionType":"multiple","conceptSlot":"string","chapter":"string","questionText":"string","options":["A","B","C","D"],"correctLetters":["A","C"],"insightOneLiner":"string","difficultySelfScore":${exampleScore}}]}`
      : `{"questions":[{"questionType":"single","conceptSlot":"string","chapter":"string","questionText":"string","options":["optA","optB","optC","optD"],"correctLetters":["${exampleLetter}"],"insightOneLiner":"string","difficultySelfScore":${exampleScore}}]}`;

  const hardnessLock = buildWriterHardnessLock(exam.examType, exam.examLabel);
  const subjectNorm = normalizeSubject(subj);
  const isCatVarc =
    exam.examType === "cat" && subjectNorm === "VARC";
  const effectivePassages = Math.max(0, Number(passageCount) || 0);
  const effectivePerPassage = Math.max(0, Number(questionsPerPassage) || 0);
  const mode = String(seatMode || "").toLowerCase();
  const sharedPassage = String(lockedPassage || "").trim();
  // Mixed papers: standalone seats must NOT invent a new RC each time.
  const effectiveStructure =
    mode === "standalone"
      ? "standalone"
      : mode === "passage_followup"
        ? "passage"
        : questionStructure;
  const catVarcBlock =
    isCatVarc && mode !== "standalone" && mode !== "passage_followup"
      ? buildCatVarcAuthoringBlock({
          passageCount: effectivePassages,
          singleCount: count,
          passageSingleCount: effectivePerPassage || 4,
        })
      : "";
  // Applies to ALL competitive exams in AI Powered Test (verbal + MCQ completeness).
  const competitiveQualityLock = buildCompetitiveQualityLock({
    examType: exam.examType,
    examLabel: exam.examLabel,
    subject: subjectNorm,
    type: safeType,
  });
  const structureLock = buildQuestionStructureLock(effectiveStructure, {
    passageCount: effectivePassages,
    questionsPerPassage: effectivePerPassage,
    passageBasedQuestions,
    standaloneQuestions,
  });
  const passageFollowupLock = sharedPassage
    ? `
**LOCKED SHARED PASSAGE (Connected Group ${connectedGroup || "P"}):**
You MUST write the sub-question against THIS passage only. Do NOT invent a new passage.
Do NOT paste the passage into questionText — questionText is the sub-question stem only.

PASSAGE:
${sharedPassage}
`
    : mode === "standalone"
      ? `
**STANDALONE LOCK:** Write an independent stem. Do NOT invent a Reading Comprehension passage or "Read the passage…" lead-in.
`
      : "";

  const prompt = `You are a senior ${exam.examLabel} ${label} question setter.
${typeLine}
Exactly 4 options for every MCQ. Use each assigned chapter exactly. Valid LaTeX/JSON. No explanations or solveSteps.
Never generate Numerical/TITA or Match List items — only Single Correct or Multiple Correct.
${hardnessLock}
${catVarcBlock}
${competitiveQualityLock}
${structureLock}
${passageFollowupLock}

TOPIC CONTEXT

${topicCards}

${excludeBlock(excludeTexts)}

Return ONLY JSON:
${schema}`;

  pipelineLog("GENERATE_BATCH", {
    type,
    count,
    subject: subj,
    examType: exam.examType,
    examLabel: exam.examLabel,
    promptChars: prompt.length,
    topicIds: topicIdsFromSlots(batchSlots),
    slots: batchSlots.map((s) => ({
      topicId: s.topicId,
      chapter: s.chapter,
      conceptSlot: s.conceptSlot,
      subject: s.subject,
    })),
    excludeCount: excludeTexts?.length || 0,
  });
  const parsed = await callGeminiJson(prompt, { kind: "generate" });
  const mapped = listFromGemini(parsed)
    .filter((q) => q?.questionText)
    .filter((q) => {
      const ok = passesHardnessScore(q, scoreFloor);
      if (!ok) {
        pipelineLog("HARDNESS_DROP", {
          type,
          examType: exam.examType,
          score: Number(q.difficultySelfScore),
          floor: scoreFloor,
          preview: String(q.questionText || "").slice(0, 120),
        });
      }
      return ok;
    })
    .map((q, i) => {
      const slot = batchSlots[i] || batchSlots[0] || {};
      const insight = String(q.insightOneLiner || "").trim();
      const placeholder = insight || String(q.explanation || "").trim();
      const rawSlot = String(q.conceptSlot || "").trim();
      const lockedSlot = String(slot.conceptSlot || slot.hardArchetype || "").trim();
      const chosenSlot = slugSlot(
        slot.topicId,
        lockedSlot || rawSlot || (slot.hardArchetypes || [])[0] || slot.chapter,
        i
      );
      const slotMeta = {
        _conceptSlot: chosenSlot,
        _chapter: slot.chapter || q.chapter || "",
        _topicId: slot.topicId || "",
        _subject: slot.subject || subj,
        _hardArchetype: lockedSlot || chosenSlot || slot.hardArchetype || "",
        _insight: insight,
        _assignedDifficulty: slot.difficulty || "hard",
        _chapterLock: slot.chapter_lock !== false,
        _conceptLock: Boolean(slot.concept_lock || lockedSlot),
        _examType: exam.examType,
        _examLabel: exam.examLabel,
      };
      if (type === "integer") {
        return sanitizeQuestion({
          questionType: "integer",
          questionText: q.questionText,
          options: [],
          correctAnswer: q.finalAnswer ?? q.answerDisplay,
          explanation: placeholder,
          _solveSteps: q.solveSteps || [],
          ...slotMeta,
          _advancedType: "integer",
          difficultyTier: "hard",
          _questionKind: questionKind,
          _generatorDifficultySelfScore: Number(q.difficultySelfScore) || null,
        });
      }
      if (type === "match") {
        const letter = String(q.correctAnswer || "A").trim().toUpperCase().slice(0, 1);
        return sanitizeQuestion({
          questionType: "match",
          questionText: q.questionText,
          listI: q.listI || [],
          listII: q.listII || [],
          options: q.options || [],
          correctAnswer: letter,
          correctIndex: Math.max(0, letter.charCodeAt(0) - 65),
          explanation: placeholder,
          _solveSteps: q.solveSteps || [],
          ...slotMeta,
          _advancedType: "match",
          difficultyTier: "hard",
          _questionKind: questionKind,
          _generatorDifficultySelfScore: Number(q.difficultySelfScore) || null,
        });
      }
      const letters = normalizeMultiLetters(
        q.correctLetters || q.correct_letters || q.correctAnswer
      );
      const indices = lettersToCorrectIndices(letters);
      return sanitizeQuestion({
        questionType: type === "multiple" ? "multiple" : "single",
        questionText: q.questionText,
        options: q.options || [],
        correctIndices: indices,
        correctIndex: indices[0] ?? 0,
        correctAnswer: letters || "",
        explanation: placeholder,
        _solveSteps: q.solveSteps || [],
        ...slotMeta,
        _advancedType: type === "multiple" ? "multiple" : "single",
        difficultyTier: "hard",
        _questionKind: questionKind,
        _generatorDifficultySelfScore: Number(q.difficultySelfScore) || null,
        ...(sharedPassage
          ? {
              passage: sharedPassage,
              passageText: sharedPassage,
              _connectedGroup: connectedGroup || "P",
            }
          : {}),
      });
    })
    .filter((q) => {
      if (!q) return false;
      // Verbal sections across ALL competitive exams — never ship calc/DI stems.
      if (
        isVerbalQualitativeSubject(subjectNorm) &&
        looksLikeMisplacedNumericalStem(q.questionText)
      ) {
        pipelineLog("VERBAL_NUMERICAL_DROP", {
          examType: exam.examType,
          subject: subjectNorm,
          preview: String(q.questionText || "").slice(0, 160),
        });
        return false;
      }
      const qType = String(q._advancedType || q.questionType || "").toLowerCase();
      if (qType === "single" || qType === "multiple") {
        if (!mcqOptionsAreComplete(q.options, exam.examType)) {
          pipelineLog("OPTIONS_DROP", {
            examType: exam.examType,
            type: qType,
            optionCount: (q.options || []).length,
            preview: String(q.questionText || "").slice(0, 120),
          });
          return false;
        }
      }
      return true;
    });
  return mapped;
};

/**
 * One Excel-style Connected Group: one shared passage + N linked MCQs.
 * questionText must be the sub-question only (passage stored separately).
 */
const generatePassagePack = async ({
  count,
  slots,
  questionTypes = [],
  subject,
  excludeTexts = [],
  examType,
  examLabel,
  packId = "P1",
}) => {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return [];
  const batchSlots = (slots || []).slice(0, n);
  while (batchSlots.length < n) {
    batchSlots.push(batchSlots[batchSlots.length - 1] || {});
  }
  const types = Array.from({ length: n }, (_, i) =>
    questionTypes[i] === "multiple" ? "multiple" : "single"
  );
  const subj = normalizeSubject(subject || batchSlots[0]?.subject);
  const exam = paperExamIdentity({ examType, examLabel });
  const scoreFloor = paperScoreFloor(exam.examType);
  const questionKind = paperDefaultQuestionKind(exam.examType);
  const topicCards = buildWriterTopicCards(
    batchSlots,
    n,
    types.includes("multiple") ? "multiple" : "single",
    exam.examLabel,
    exam.examType
  );
  const label = writerLabel(subj);
  const subjectNorm = normalizeSubject(subj);
  const hardnessLock = buildWriterHardnessLock(exam.examType, exam.examLabel);
  const competitiveQualityLock = buildCompetitiveQualityLock({
    examType: exam.examType,
    examLabel: exam.examLabel,
    subject: subjectNorm,
    type: types[0] || "single",
  });
  const typePlan = types
    .map((t, i) => `  ${i + 1}. questionType "${t}"`)
    .join("\n");
  const schema = `{"passage":"shared reading passage 450-750 words","connectedGroup":"${packId}","questions":[{"questionType":"single|multiple","conceptSlot":"string","chapter":"string","questionText":"sub-question stem only — do NOT repeat the passage","options":["A","B","C","D"],"correctLetters":["A"],"insightOneLiner":"string","difficultySelfScore":78}]}`;

  const prompt = `You are a senior ${exam.examLabel} ${label} question setter.
Generate ONE Connected Group (like Excel import: Connected Group = ${packId}).

HARD RULES (Excel Connected Group parity):
1. Write exactly ONE shared reading passage in "passage".
2. Write exactly ${n} linked questions in "questions" — ALL based on that SAME passage.
3. questionText is the sub-question ONLY. Never paste or restate the full passage inside questionText.
4. Exactly 4 options per question. Never Numerical/TITA or Match List.
5. Per-question types (mandatory):
${typePlan}
6. connectedGroup must be "${packId}".
${hardnessLock}
${competitiveQualityLock}

TOPIC CONTEXT
${topicCards}

${excludeBlock(excludeTexts)}

Return ONLY JSON:
${schema}`;

  pipelineLog("GENERATE_PASSAGE_PACK", {
    packId,
    count: n,
    subject: subj,
    examType: exam.examType,
    types,
    topicIds: topicIdsFromSlots(batchSlots),
  });

  const parsed = await callGeminiJson(prompt, { kind: "generate" });
  const root = parsed && typeof parsed === "object" ? parsed : {};
  const passage = String(root.passage || root.paragraph || "").trim();
  const list = Array.isArray(root.questions)
    ? root.questions
    : listFromGemini(parsed);
  if (!passage || passage.length < 180) {
    pipelineLog("PASSAGE_PACK_DROP", {
      packId,
      reason: "missing_or_short_passage",
      passageChars: passage.length,
    });
    return [];
  }

  const mapped = [];
  for (let i = 0; i < n; i++) {
    const q = list[i];
    if (!q?.questionText) continue;
    if (!passesHardnessScore(q, scoreFloor)) continue;
    const wantType = types[i] || "single";
    const slot = batchSlots[i] || batchSlots[0] || {};
    const insight = String(q.insightOneLiner || "").trim();
    const placeholder = insight || String(q.explanation || "").trim();
    const rawSlot = String(q.conceptSlot || "").trim();
    const lockedSlot = String(slot.conceptSlot || slot.hardArchetype || "").trim();
    const chosenSlot = slugSlot(
      slot.topicId,
      lockedSlot || rawSlot || (slot.hardArchetypes || [])[0] || slot.chapter,
      i
    );
    const letters = normalizeMultiLetters(
      q.correctLetters || q.correct_letters || q.correctAnswer
    );
    const indices = lettersToCorrectIndices(letters);
    const stem = String(q.questionText || "")
      .replace(/^Passage\s*:\s*[\s\S]*?(?=(?:Which|According|Based|Select|Identify|Choose|What|Why|How)\b)/i, "")
      .trim();
    const item = sanitizeQuestion({
      questionType: wantType,
      questionText: stem || q.questionText,
      options: q.options || [],
      correctIndices: indices,
      correctIndex: indices[0] ?? 0,
      correctAnswer: letters || "",
      explanation: placeholder,
      passage,
      passageText: passage,
      _connectedGroup: packId,
      _passagePackIndex: i,
      _conceptSlot: chosenSlot,
      _chapter: slot.chapter || q.chapter || "",
      _topicId: slot.topicId || "",
      _subject: slot.subject || subj,
      _hardArchetype: lockedSlot || chosenSlot || slot.hardArchetype || "",
      _insight: insight,
      _assignedDifficulty: slot.difficulty || "hard",
      _chapterLock: slot.chapter_lock !== false,
      _conceptLock: Boolean(slot.concept_lock || lockedSlot),
      _examType: exam.examType,
      _examLabel: exam.examLabel,
      _advancedType: wantType,
      difficultyTier: "hard",
      _questionKind: questionKind,
      _generatorDifficultySelfScore: Number(q.difficultySelfScore) || null,
    });
    if (!item) continue;
    if (
      isVerbalQualitativeSubject(subjectNorm) &&
      looksLikeMisplacedNumericalStem(item.questionText)
    ) {
      continue;
    }
    if (!mcqOptionsAreComplete(item.options, exam.examType)) continue;
    mapped.push(item);
  }

  if (mapped.length < n) {
    pipelineLog("PASSAGE_PACK_PARTIAL", {
      packId,
      want: n,
      got: mapped.length,
      passageChars: passage.length,
    });
  }
  return mapped;
};

const solverConfidence = (obj) => {
  const n = Number(obj?.confidence);
  return Number.isFinite(n) ? n : null;
};

const proposedKeyOf = (q, type) => {
  if (type === "integer") {
    const n = Number(q.correctAnswer ?? q.finalAnswer);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "match") {
    const letter = String(q.correctAnswer || "")
      .trim()
      .toUpperCase()
      .match(/[A-D]/);
    return letter ? letter[0] : null;
  }
  return normalizeMultiLetters(q.correctAnswer ?? q.correctLetters);
};

const derivedKeyOf = (obj, type) => {
  if (!obj || typeof obj !== "object") return null;
  if (type === "integer") {
    const n = Number(
      obj.derived_answer ?? obj.final_answer ?? obj.value ?? obj.answer
    );
    return Number.isFinite(n) ? n : null;
  }
  if (type === "match") {
    const letter = String(
      obj.derived_answer ?? obj.final_answer ?? obj.answer ?? ""
    )
      .trim()
      .toUpperCase()
      .match(/[A-D]/);
    return letter ? letter[0] : null;
  }
  return normalizeMultiLetters(
    obj.derived_answer ?? obj.correct_letters ?? obj.final_answer ?? obj.answer
  );
};

const keysMatch = (type, derived, proposed) => {
  if (derived == null || proposed == null) return false;
  if (type === "integer") {
    return Math.abs(Number(derived) - Number(proposed)) < 1e-6;
  }
  return String(derived) === String(proposed);
};

const buildLunaVerifyPrompt = (q, type, opts, proposed, exam = {}) => {
  const examLabel = exam.examLabel || "Exam";
  const examType = exam.examType || "competitive";
  const typeLabel =
    type === "multiple"
      ? "MULTI-CORRECT MCQ (one or more options may be correct)"
      : type === "integer"
        ? "INTEGER / NUMERICAL answer"
        : type === "match"
          ? "MATCH THE FOLLOWING"
          : "SINGLE-CORRECT MCQ (exactly one option is correct)";
  const derivedShape =
    type === "integer"
      ? "<number>"
      : type === "multiple"
        ? '["A","C"]'
        : '"A"';
  const optionBlock = opts.length ? `OPTIONS:\n${opts.join("\n")}` : "";
  const listBlock = [
    q.listI?.length
      ? `List-I:\n${q.listI.map((x, i) => `${i + 1}. ${x}`).join("\n")}`
      : "",
    q.listII?.length
      ? `List-II:\n${q.listII
          .map((x, i) => `${String.fromCharCode(80 + i)}. ${x}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const difficultyGate =
    examType === "jee_advanced"
      ? `difficulty_match: truly hard ${examLabel} (IIT selection depth — multi-step / non-routine).`
      : examType === "jee_main"
        ? `difficulty_match: truly hard ${examLabel} shift-paper (not board drill; not Advanced-depth fusion).`
        : examType === "neet"
          ? `difficulty_match: truly hard ${examLabel} (NCERT-depth application; not IIT fusion).`
          : `difficulty_match: truly hard ${examLabel} (exam-faithful; not routine drill; not JEE Advanced fusion).`;

  return `You are a ${examLabel} verification examiner. Use deep independent reasoning.
Do NOT judge by "looks correct". PASS only if ALL gates below are true.

Assigned chapter: ${q._chapter || q.chapter || "(unknown)"}
Assigned concept family: ${q._conceptSlot || q._hardArchetype || "(unknown)"}
Assigned difficulty: ${q._assignedDifficulty || q.difficultyTier || "hard"}
Item type: ${typeLabel}

Follow these steps IN ORDER:
1. Solve the question independently from first principles. Ignore any claimed answer until step 8.
2. Derive the result fully.
3. Check all assumptions and constraints (domain, limiting cases, units, approximations, uniqueness).
4. Check EVERY option TRUE/FALSE. For integer items, sanity-check the numeric value against the stem.
5. Recalculate the final answer from scratch.
6. Detect ambiguity or multiple valid answers. If the item is ambiguous or ill-posed, FAIL.
7. Syllabus / paper-quality gates (REQUIRED):
   - chapter_match: primary content belongs to the assigned chapter (for MATCH: ≥3 of 4 List-I items must be that chapter; no List-I item may have another chapter as primary).
   - concept_match: content tests the assigned concept family (for MATCH: ≥3 of 4 List-I items).
   - ${difficultyGate}
   - format_valid: stem/options/lists structurally valid for the item type.
8. Only now compare your derived answer with the PROPOSED KEY.
9. Return PASS only if mathematical_correct AND proposed_key_match AND chapter_match AND concept_match AND difficulty_match AND format_valid AND not ambiguous.

STEM:
${q.questionText}
${listBlock}
${optionBlock}

PROPOSED KEY (compare only AFTER you independently derived the answer): ${proposed}

Return ONLY JSON:
{"verdict":"PASS"|"FAIL","mathematical_correct":true|false,"derived_answer":${derivedShape},"proposed_key_match":true|false,"chapter_match":true|false,"concept_match":true|false,"difficulty_match":true|false,"format_valid":true|false,"ambiguous":false,"fail_reasons":[],"confidence":0.0,"brief_steps":["..."],"option_verdicts":{"A":"true","B":"false","C":"true","D":"false"}}`;
};

const shuffleCopy = (arr = []) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const explanationLooksComplete = (q) => {
  const text = String(q.explanation || "").trim();
  if (text.length < 180) return false;
  const insight = String(q._insight || "");
  const hasInsight = insight.length >= 20 || /\binsight\b/i.test(text);
  const hasDerivation =
    /therefore|hence|thus|so that|final_answer|correct option/i.test(text);
  const hasSteps = (q._solveSteps || []).length >= 3 || text.length >= 400;
  const notPlaceholder = !/^\s*\*\*Insight:\*\*\s*$/i.test(text);
  return hasInsight && (hasDerivation || hasSteps) && notPlaceholder;
};

const passesHardnessScore = (q, floor = SCORE_FLOOR) => {
  const score = Number(q?.difficultySelfScore ?? q?._generatorDifficultySelfScore);
  if (!Number.isFinite(score)) return true; // allow missing score; writers usually send it
  return score >= floor;
};

let lastDualDrop = null;
const dualDrop = (payload = {}) => {
  lastDualDrop = payload;
  pipelineLog("VERIFY_DROP", payload);
};

const isVerifyTimeoutError = (err) =>
  err?.code === "ECONNABORTED" ||
  err?.code === "ETIMEDOUT" ||
  /timeout|ECONNABORTED|ETIMEDOUT/i.test(String(err?.message || err || ""));

const getVerifyTimeoutRetries = () =>
  Math.max(
    0,
    Math.min(
      5,
      Number(
        process.env.PAPER_VERIFY_TIMEOUT_RETRIES ??
          process.env.JEE_ADV_VERIFY_TIMEOUT_RETRIES ??
          3
      )
    )
  );

const truthyGate = (v, { defaultIfMissing = false } = {}) => {
  if (v === true) return true;
  if (v === false) return false;
  return defaultIfMissing;
};

const dualLockQuestion = async (q) => {
  const type = String(q._advancedType || q.questionType || "").toLowerCase();
  const opts = (q.options || []).map((o, i) =>
    `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : o?.text || o}`
  );
  const proposed = proposedKeyOf(q, type);
  const model = getVerifyModel();
  const effort = getVerifyEffort();
  pipelineLog("LUNA_VERIFY_ITEM", {
    type,
    model,
    reasoningEffort: effort,
    conceptSlot: q._conceptSlot,
    chapter: q._chapter,
    subject: q._subject,
    proposedKey: proposed,
    stemChars: String(q.questionText || "").length,
    stemPreview: String(q.questionText || "").slice(0, 240),
    optionCount: opts.length,
  });

  if (proposed == null || proposed === "") {
    dualDrop({ type, reason: "missing_proposed_key" });
    return null;
  }

  const verifyPrompt = buildLunaVerifyPrompt(
    q,
    type,
    opts,
    proposed,
    paperExamIdentity({
      examType: q._examType,
      examLabel: q._examLabel,
    })
  );
  // Same-request retries are opt-in; default 0 — prefer seat replacement on timeout.
  const maxAttempts = 1 + getVerifyTimeoutRetries();
  let parsed;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await callVerifyJson(verifyPrompt);
      parsed = parseJsonLoose(raw);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const canRetry =
        isVerifyTimeoutError(err) && attempt < maxAttempts;
      if (canRetry) {
        const backoffMs = Math.min(5000, 1000 * attempt);
        pipelineLog("OPENAI_VERIFY_RETRY", {
          type,
          model,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          backoffMs,
          reason: err?.message || String(err),
        });
        await sleep(backoffMs);
        continue;
      }
      dualDrop({
        type,
        reason: isVerifyTimeoutError(err)
          ? "luna_verify_timeout"
          : "luna_verify_error",
        error: err?.message || String(err),
        attempts: attempt,
      });
      throw err;
    }
  }
  if (!parsed) {
    dualDrop({
      type,
      reason: "luna_verify_error",
      error: lastErr?.message || "empty_verify_response",
    });
    throw lastErr || new Error("empty_verify_response");
  }

  const derived = derivedKeyOf(parsed, type);
  const verdict = String(parsed?.verdict || "")
    .trim()
    .toUpperCase();
  const conf = solverConfidence(parsed);
  const matchFlag = parsed?.proposed_key_match === true;
  const ambiguous = parsed?.ambiguous === true;
  const keysOk = keysMatch(type, derived, proposed);
  const confOk = conf == null || conf >= VERIFY_CONF_FLOOR;
  // New models return explicit gates; older responses without them still allow math-only pass
  // unless PAPER_LUNA_REQUIRE_SYLLABUS_GATES=1 (default on).
  const requireSyllabusGates =
    String(process.env.PAPER_LUNA_REQUIRE_SYLLABUS_GATES || "1") !== "0";
  const mathOk = truthyGate(parsed?.mathematical_correct, {
    defaultIfMissing: true,
  });
  const chapterOk = truthyGate(parsed?.chapter_match, {
    defaultIfMissing: !requireSyllabusGates,
  });
  const conceptOk = truthyGate(parsed?.concept_match, {
    defaultIfMissing: !requireSyllabusGates,
  });
  const difficultyOk = truthyGate(parsed?.difficulty_match, {
    defaultIfMissing: !requireSyllabusGates,
  });
  const formatOk = truthyGate(parsed?.format_valid, {
    defaultIfMissing: true,
  });
  const pass =
    verdict === "PASS" &&
    matchFlag &&
    keysOk &&
    !ambiguous &&
    confOk &&
    derived != null &&
    mathOk &&
    chapterOk &&
    conceptOk &&
    difficultyOk &&
    formatOk;

  if (!pass) {
    dualDrop({
      type,
      reason: ambiguous
        ? "ambiguous"
        : !chapterOk
          ? "chapter_mismatch"
          : !conceptOk
            ? "concept_mismatch"
            : !difficultyOk
              ? "difficulty_mismatch"
              : !formatOk
                ? "format_invalid"
                : !mathOk
                  ? "math_incorrect"
                  : verdict !== "PASS"
                    ? "luna_fail"
                    : !keysOk || !matchFlag
                      ? "key_mismatch"
                      : !confOk
                        ? "low_confidence"
                        : "luna_verify_fail",
      verdict,
      derived,
      proposed,
      matchFlag,
      ambiguous,
      confidence: conf,
      mathematical_correct: mathOk,
      chapter_match: chapterOk,
      concept_match: conceptOk,
      difficulty_match: difficultyOk,
      format_valid: formatOk,
      failReasons: parsed?.fail_reasons || [],
    });
    return null;
  }

  const lockMode = `luna(${model}:${effort})`;
  const base = {
    ...q,
    _dualA: derived,
    _dualB: derived,
    _doubleSolverAgree: true,
    _stageAAnswerLocked: true,
    _lockMode: lockMode,
    _ranB: false,
    _verifyPass: true,
    _proposedKeyMatch: true,
    _solverConfidence: conf,
    _verifyBriefSteps: parsed?.brief_steps || [],
    _optionVerdicts: parsed?.option_verdicts || null,
    _mathematicalCorrect: mathOk,
    _chapterMatch: chapterOk,
    _conceptMatch: conceptOk,
    _difficultyMatch: difficultyOk,
    _formatValid: formatOk,
  };

  if (type === "integer") {
    return stampTrust({
      ...base,
      correctAnswer: derived,
      finalAnswer: derived,
      answerDisplay: String(derived),
    });
  }

  const letters = String(derived);
  const indices = lettersToCorrectIndices(letters);
  return stampTrust({
    ...base,
    correctAnswer: letters,
    correctIndices: indices,
    correctIndex: indices[0] ?? 0,
  });
};

const expandExplanation = async (q) => {
  if (explanationLooksComplete(q)) {
    pipelineLog("EXPAND_SKIP", {
      conceptSlot: q._conceptSlot,
      chars: String(q.explanation || "").length,
      reason: "existing_explanation_ok",
    });
    return { ...q, _expandSkipped: true };
  }

  const type = String(q._advancedType || q.questionType || "").toLowerCase();
  const opts = (q.options || []).map(
    (o, i) =>
      `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : o?.text || o}`
  );
  const lockedKey = q.correctAnswer ?? q.answerDisplay ?? "?";
  const typeRules =
    type === "multiple"
      ? `MULTI-CORRECT structure:
1) Insight
2) Shared core derivation once
3) Judge EACH option A–D TRUE/FALSE
4) End: "Therefore correct option(s): ${lockedKey}"`
      : type === "match"
        ? `MATCH: solve each List-I item, then assemble → ${lockedKey}`
        : type === "integer"
          ? `INTEGER: insight, setup, compressed algebra. Last line: FINAL_ANSWER: ${lockedKey}`
          : `Insight first. End with locked key ${lockedKey}.`;

  const prompt = `You are writing an official-style ${q._examLabel || "exam"} solution (coaching quality).
The answer key is ALREADY LOCKED — NEVER change the final answer.
If a derivation would imply a different key, rewrite so it supports the locked key. Do not output a different answer.
LOCKED KEY: ${lockedKey}
${typeRules}

STEM:
${q.questionText}
${opts.length ? `OPTIONS:\n${opts.join("\n")}` : ""}
${q.listI?.length ? `List-I:\n${q.listI.map((x, i) => `${i + 1}. ${x}`).join("\n")}` : ""}
${q.listII?.length ? `List-II:\n${q.listII.map((x, i) => `${String.fromCharCode(80 + i)}. ${x}`).join("\n")}` : ""}

Prior notes (may be incomplete — rewrite insight-first):
${JSON.stringify(q._solveSteps || q.explanation || "").slice(0, 1000)}

${LATEX_JSON_HINT}

Return ONLY JSON:
{"insight":"...","explanation":"full solution starting with Insight","solveSteps":["..."]}`;

  try {
    const parsed = await callGeminiJson(prompt, { kind: "expand" });
    let explanation = String(
      parsed?.explanation || (parsed?.solveSteps || []).join("\n") || ""
    ).trim();
    const insight = String(parsed?.insight || "").trim();
    if (insight && !/^\*\*Insight:\*\*/i.test(explanation)) {
      explanation = `**Insight:** ${insight}\n\n${explanation}`;
    }
    if (explanation.length < 80) return q;
    return {
      ...q,
      explanation,
      _insight: insight || q._insight,
      _solveSteps: Array.isArray(parsed?.solveSteps) ? parsed.solveSteps : q._solveSteps,
      _explanationExpanded: true,
      correctAnswer: q.correctAnswer,
      finalAnswer: q.finalAnswer ?? q.correctAnswer,
      correctIndex: q.correctIndex,
      correctIndices: q.correctIndices,
    };
  } catch {
    return q;
  }
};

export const generatePipelineQuestions = (body = {}) =>
  generateBatch({
    type: String(body.questionType || body.type || "multiple").toLowerCase(),
    count: Math.max(1, Number(body.count) || 1),
    slots: body.slots || [],
    subject: body.subject,
    excludeTexts: body.excludeQuestionTexts || body.excludeTexts || [],
    examType: body.examType,
    examLabel: body.examLabel,
    questionStructure: body.questionStructure || body.config?.questionStructure || "both",
    passageCount: body.passageCount ?? body.config?.passageCount ?? 0,
    questionsPerPassage:
      body.questionsPerPassage ?? body.config?.questionsPerPassage ?? 0,
    passageBasedQuestions:
      body.passageBasedQuestions ?? body.config?.passageBasedQuestions ?? 0,
    standaloneQuestions:
      body.standaloneQuestions ?? body.config?.standaloneQuestions ?? 0,
  });

export const dualLockPipelineQuestions = async (questions = []) => {
  const kept = [];
  const dropped = [];
  for (const q of questions) {
    try {
      const locked = await dualLockQuestion(q);
      if (locked) kept.push(locked);
      else
        dropped.push({
          reason: lastDualDrop?.reason || "luna_verify_fail",
          questionText: q.questionText,
        });
    } catch (err) {
      dropped.push({ reason: err?.message || "lock_error", questionText: q.questionText });
    }
  }
  return { questions: kept, dropped };
};

export const expandPipelineQuestions = async (questions = []) => {
  const out = [];
  for (const q of questions) {
    out.push(await expandExplanation(q));
  }
  return out;
};

const optionPlainText = (o) => {
  let text = typeof o === "string" ? o : o?.text || String(o || "");
  // Strip HTML the model sometimes embeds in verbal stems/options.
  text = text.replace(/<[^>]+>/g, " ");
  // Strip leading labels: Option A: / A) / A. / (A) / [A] -- NEVER strip the English article "A "
  text = stripOptionLabelPrefix(text);
  return text.replace(/\s+/g, " ").trim();
};

/** Repair common Gemini/o3 LaTeX / prose corruptions before UI/bank save. */
export const sanitizeExplanationLatex = (raw) => sanitizeExplanationText(raw);

const toUiQuestion = (q, config = {}) => {
  const type = q._advancedType || q.questionType;
  const letters = "ABCD".split("");
  const rawPlain = (q.options || []).map(optionPlainText);
  const plain = autoFixOptionArticles(rawPlain);
  const prefixed = plain.map((text, i) => `${letters[i]}) ${text}`);
  const indices = Array.isArray(q.correctIndices)
    ? q.correctIndices
    : lettersToCorrectIndices(q.correctAnswer);
  const uiType =
    type === "integer"
      ? "integer"
      : type === "multiple"
        ? "multiple"
        : type === "match"
          ? "match"
          : "single";
  const optionList =
    type === "integer"
      ? []
      : prefixed.length
        ? prefixed
        : plain;
  const exam = resolvePaperExam({
    examType: q._examType || config.examType,
    examLabel: q._examLabel || config.examLabel,
  });
  const questionKind =
    q._questionKind || paperDefaultQuestionKind(exam.examType);
  const stem = sanitizeExplanationLatex(q.questionText);
  const passage = String(q.passage || q.passageText || q.paragraph || "").trim();
  const finalized = finalizeExplanationForPublish({
    explanation: sanitizeExplanationLatex(q.explanation),
    correctAnswer: q.correctAnswer,
  });
  return {
    questionType: uiType,
    text: stem,
    questionText: stem,
    options: optionList,
    correctAnswer: q.correctAnswer,
    correctIndex: q.correctIndex ?? indices[0] ?? 0,
    correctIndices: indices,
    multipleCorrectIndexes: type === "multiple" ? indices : [],
    explanation: finalized.explanation || "",
    marks: config.marksByType?.[type] ?? 4,
    negativeMarks: config.negativeMarks ?? 1,
    difficulty: "Hard",
    // First-class metadata for bank save / paper export (not only underscore fields).
    subject: q._subject || q.subject || "",
    topic: q._chapter || q.chapter || q.topic || "",
    chapter: q._chapter || q.chapter || "",
    topicId: q._topicId || q.topicId || "",
    passage,
    passageText: passage,
    _connectedGroup: q._connectedGroup || null,
    _passagePackIndex: q._passagePackIndex ?? null,
    _conceptSlot: q._conceptSlot,
    _chapter: q._chapter,
    _topicId: q._topicId,
    _subject: q._subject,
    _advancedType: type,
    _lockMode: q._lockMode,
    _trustBadge: q._trustBadge,
    _trustGrade: q._trustGrade,
    _productionReady: q._productionReady,
    _needsReview: q._needsReview,
    _qualityGateIssues: q._qualityGateIssues || null,
    _qualityGateOk: q._qualityGateOk ?? null,
    _qualityGateNeedsReview: q._qualityGateNeedsReview ?? null,
    _optionShuffleSkipped: q._optionShuffleSkipped || null,
    _doubleSolverAgree: q._doubleSolverAgree,
    _explanationExpanded: q._explanationExpanded,
    _insight: q._insight,
    listI: q.listI,
    listII: q.listII,
    difficultyTier: q.difficultyTier || "hard",
    _questionKind: questionKind,
    _examType: exam.examType,
    _examLabel: exam.examLabel,
  };
};

const usableQuestion = (item) => {
  if (
    !(
      item?.locked &&
      item.locked._productionReady === true &&
      (item.stage === "ready_to_confirm" ||
        item.stage === "expanded" ||
        item.stage === "verified" ||
        item.stage === "locked")
    )
  ) {
    return false;
  }
  const type = String(
    item.type || item.locked._advancedType || item.locked.questionType || "single"
  ).toLowerCase();
  if (type === "single" || type === "multiple") {
    if (
      !mcqOptionsAreComplete(
        item.locked.options,
        item.locked._examType || item._examType
      )
    ) {
      return false;
    }
  }
  if (
    isVerbalQualitativeSubject(item.subject || item.locked._subject) &&
    looksLikeMisplacedNumericalStem(item.locked.questionText)
  ) {
    return false;
  }
  return true;
};

const itemType = (item) =>
  String(item?.type || item?.locked?._advancedType || item?.raw?._advancedType || "single");

const checkpointItem = async (item) => {
  const ctx = getQuestionContext();
  if (ctx?.calls) item.tokenCalls = [...ctx.calls];
  item.tokenTotals = summarizeCalls(item.tokenCalls || []).byModel;
  item.attempt = Number(item.attempt) || 1;
  saveQuestionSnapshot(currentJobId, item);
  await persistQuestionRecord(currentJobId, item);
  pipelineLog(
    item.stage === "dropped" || item.stage === "failed"
      ? "QUESTION_FAILED"
      : "QUESTION_STAGE",
    {
      seq: item.seq,
      stage: item.stage,
      attempt: item.attempt,
      subject: item.subject,
      topicId: item.topicId,
      chapter: item.chapter,
      type: item.type,
      reason: item.failureReason || undefined,
      tokens: item.tokenTotals,
      stemPreview: String(
        item.locked?.questionText || item.raw?.questionText || ""
      ).slice(0, 180),
    }
  );
  return item;
};

const failItem = async (item, reason, detail = null) => {
  item.stage = /drop|disagree|luna|o3_|key_mismatch|ambiguous|code_validation|duplicate|generate_empty|missing|uncertain|math_incorrect|explanation_/i.test(
    String(reason || "")
  )
    ? "dropped"
    : "failed";
  item.failureReason = reason;
  item.failureDetail = detail;
  await checkpointItem(item);
  return item;
};

const lockAndExpandItem = async (item) => {
  lastDualDrop = null;
  item.stage = "validating";
  await checkpointItem(item);
  let locked = null;
  try {
    locked = await dualLockQuestion(item.raw);
  } catch (err) {
    return failItem(
      item,
      isVerifyTimeoutError(err) ? "luna_verify_timeout" : "luna_verify_error",
      err?.message || String(err)
    );
  }
  if (!locked) {
    const reason = lastDualDrop?.reason || "luna_verify_fail";
    return failItem(item, reason, lastDualDrop);
  }
  // verified = answer-locked by Luna; "locked" kept as alias for older consumers
  item.stage = "verified";
  item.locked = locked;
  item.answerKey = locked.correctAnswer ?? locked.answerDisplay ?? null;
  await checkpointItem(item);

  item.stage = "expanding";
  await checkpointItem(item);
  try {
    const expanded = await expandExplanation(locked);
    item.locked = expanded;
    item.stage =
      expanded?._explanationExpanded || explanationLooksComplete(expanded)
        ? "expanded"
        : "verified";
    if (item.stage === "expanded") {
      item.stage = "ready_to_confirm";
    }
  } catch (err) {
    item.expandError = err?.message || String(err);
    item.stage = "verified";
    pipelineLog("QUESTION_EXPAND_FAILED", {
      seq: item.seq,
      reason: item.expandError,
    });
  }
  await checkpointItem(item);
  return item;
};

const processOneSlot = async ({
  type,
  slot,
  exclude,
  seq,
  attempt = 1,
  examType,
  examLabel,
}) => {
  const subject = normalizeSubject(slot.subject);
  const item = {
    seq,
    type,
    subject,
    topicId: slot.topicId || "",
    chapter: slot.chapter || "",
    conceptSlot: slot.conceptSlot || slot.hardArchetype || "",
    stage: "queued",
    attempt,
  };
  return runQuestionContext(item, async () => {
    pipelineLog("QUESTION_START", {
      seq,
      type,
      subject,
      topicId: item.topicId,
      chapter: item.chapter,
      conceptSlot: item.conceptSlot,
      attempt,
    });
    item.stage = "generating";
    await checkpointItem(item);
    let generated = null;
    try {
      const part = await generateBatch({
        type,
        count: 1,
        slots: [slot],
        subject,
        excludeTexts: exclude,
        examType,
        examLabel,
        questionStructure: "both",
      });
      generated = part[0] || null;
      if (generated) {
        generated._examType = examType;
        generated._examLabel = examLabel;
      }
    } catch (err) {
      return failItem(item, "generate_error", err?.message || String(err));
    }
    if (!generated) {
      return failItem(
        item,
        "generate_empty_or_hardness_drop",
        "Writer returned no question that passed the hardness floor"
      );
    }
    item.stage = "generated";
    item.raw = generated;
    await checkpointItem(item);
    return lockAndExpandItem(item);
  });
};

const resumeIncompleteItem = async (item) => {
  return runQuestionContext(item, async () => {
    pipelineLog("QUESTION_RESUME", {
      seq: item.seq,
      stage: item.stage,
      topicId: item.topicId,
      type: item.type,
    });
    if (
      (item.stage === "generated" || item.stage === "validating") &&
      item.raw
    ) {
      return lockAndExpandItem(item);
    }
    if (
      (item.stage === "locked" ||
        item.stage === "verified" ||
        item.stage === "expanding") &&
      item.locked
    ) {
      item.stage = "expanding";
      await checkpointItem(item);
      try {
        const expanded = await expandExplanation(item.locked);
        item.locked = expanded;
        item.stage =
          expanded?._explanationExpanded || explanationLooksComplete(expanded)
            ? "ready_to_confirm"
            : "verified";
      } catch (err) {
        item.expandError = err?.message || String(err);
        item.stage = "verified";
      }
      await checkpointItem(item);
      return item;
    }
    return item;
  });
};

const nextSlot = (pool, unused, unusedCursor, index) => {
  if (index < pool.length) return { slot: pool[index], unusedCursor };
  if (unusedCursor < unused.length) {
    return { slot: unused[unusedCursor], unusedCursor: unusedCursor + 1 };
  }
  return {
    slot: pool[index % Math.max(1, pool.length)] || {},
    unusedCursor,
  };
};

const fillType = async ({
  type,
  need,
  slots,
  unusedSlots = [],
  exclude,
  onProgress,
  resumeItems = [],
  seqStart = 1,
  config = {},
}) => {
  const pool = Array.isArray(slots) && slots.length ? slots : [{}];
  const unused = shuffleCopy(unusedSlots || []);
  let unusedCursor = 0;
  const kept = [];
  const items = [];
  const failures = [];
  let seq = seqStart;

  for (const existing of resumeItems) {
    if (itemType(existing) !== type) continue;
    if (usableQuestion(existing)) {
      kept.push(existing.locked);
      items.push(existing);
      exclude.push(String(existing.locked?.questionText || "").slice(0, 180));
      continue;
    }
    if (
      existing.stage === "generated" ||
      existing.stage === "validating" ||
      existing.stage === "locked" ||
      existing.stage === "verified" ||
      existing.stage === "expanding"
    ) {
      const updated = await resumeIncompleteItem(existing);
      items.push(updated);
      if (usableQuestion(updated)) {
        kept.push(updated.locked);
        exclude.push(String(updated.locked?.questionText || "").slice(0, 180));
      } else {
        failures.push(updated);
      }
    } else if (existing.stage === "dropped" || existing.stage === "failed") {
      items.push(existing);
      failures.push(existing);
    }
    seq = Math.max(seq, Number(existing.seq) + 1);
    onProgress?.({
      phase: usableQuestion(items[items.length - 1]) ? "locked" : "resume",
      message: `${type} resume ${kept.length}/${need}`,
      items,
      failures,
    });
    if (kept.length >= need) return { kept, items, failures, seq };
  }

  const maxAttempts = Math.max(
    need *
      Number(
        process.env.PAPER_FILL_ROUNDS ||
          process.env.JEE_ADV_FILL_ROUNDS ||
          4
      ),
    need
  );
  const concurrency = Math.max(
    1,
    Math.min(
      6,
      Number(
        process.env.PAPER_QUESTION_CONCURRENCY ||
          process.env.JEE_ADV_QUESTION_CONCURRENCY ||
          2
      )
    )
  );
  let attempt = 0;
  const usedKeys = new Set(
    kept.map((q) => `${q._subject || ""}:${q._topicId || ""}`)
  );

  while (kept.length < need && attempt < maxAttempts) {
    const wave = [];
    while (
      wave.length < concurrency &&
      kept.length + wave.length < need &&
      attempt < maxAttempts
    ) {
      const { slot, unusedCursor: nextCursor } = nextSlot(
        pool,
        unused,
        unusedCursor,
        attempt
      );
      unusedCursor = nextCursor;
      const slotKey = `${slot.subject || ""}:${slot.topicId || ""}`;
      const hasAlt = [...pool, ...unused].some(
        (s) => s?.topicId && !usedKeys.has(`${s.subject || ""}:${s.topicId}`)
      );
      if (slot.topicId && usedKeys.has(slotKey) && hasAlt) {
        attempt += 1;
        continue;
      }
      wave.push({
        slot,
        seqNum: seq,
        attemptIndex: attempt + 1,
      });
      seq += 1;
      attempt += 1;
    }
    if (!wave.length) break;

    onProgress?.({
      phase: "generate",
      message: `${type} generating ${wave.length} seat(s) · concurrency=${concurrency}`,
    });

    const waveResults =
      wave.length === 1
        ? [
            await processOneSlot({
              type,
              slot: wave[0].slot,
              exclude,
              seq: wave[0].seqNum,
              attempt: wave[0].attemptIndex,
              examType: config.examType,
              examLabel: config.examLabel,
            }),
          ]
        : await Promise.all(
            wave.map((w) =>
              processOneSlot({
                type,
                slot: w.slot,
                exclude: [...exclude],
                seq: w.seqNum,
                attempt: w.attemptIndex,
                examType: config.examType,
                examLabel: config.examLabel,
              })
            )
          );

    for (const item of waveResults) {
      items.push(item);
      if (usableQuestion(item)) {
        kept.push(item.locked);
        usedKeys.add(`${item.subject || ""}:${item.topicId || ""}`);
        exclude.push(String(item.locked?.questionText || "").slice(0, 180));
        onProgress?.({
          phase: "locked",
          message: `${type} locked ${kept.length}/${need} (${item.topicId})`,
          questions: kept.map((q) => toUiQuestion(q, config)),
          items,
          failures,
        });
      } else {
        failures.push(item);
        onProgress?.({
          phase: "failed-item",
          message: `${type} failed: ${item.failureReason || "unknown"}`,
          items,
          failures,
        });
      }
    }
  }
  return { kept, items, failures, seq };
};

export const runAdvancedPaperPipeline = async (
  config = {},
  { onProgress, resumeJob = null } = {}
) => {
  const reusePlan = resumeJob?.plan?.slots ? resumeJob.plan : null;
  const plan = reusePlan || planPipelineSlots(config);
  const expectedTotal =
    plan.totalQuestions ||
    Object.values(plan.typeCounts || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  pipelineLog("PLAN_COUNTS", {
    totalQuestions: expectedTotal,
    typeCounts: plan.typeCounts,
    subjectCounts: plan.subjectCounts,
    subjects: plan.subjects,
    allocation: plan.allocatedTopics,
    resume: Boolean(reusePlan),
    mode: "parallel_gemini_o3_solution",
  });
  if (!reusePlan) {
    const usedTopics = Object.values(plan.slots || {})
      .flat()
      .filter((s) => s?.topicId);
    markAllocatedTopicsUsed(usedTopics, plan.paper);
  }
  onProgress?.({
    phase: "plan",
    message: reusePlan
      ? `Resuming slot plan (${expectedTotal} Q)`
      : `Phase 1 — slot plan (${expectedTotal} Q)`,
    plan,
  });

  const resumeCount = Number(resumeJob?.resumeCount) || 0;
  return runParallelPaperPipeline({
    plan,
    config: { ...config, _resumeCount: resumeCount },
    onProgress,
    resumeItems: resumeJob?.items || [],
    deps: {
      generateBatch,
      generatePassagePack,
      expandExplanation,
      explanationLooksComplete,
      toUiQuestion,
      checkpointItem,
      failItem,
      normalizeSubject,
      looksLikeMisplacedNumericalStem,
      isVerbalQualitativeSubject,
      pipelineLog,
      recordUsage: recordModelUsage,
      jobId: currentJobId,
      runQuestionContext,
      stampTrust,
      readTokenSummary,
    },
  });
};


const runningJobs = new Set();

const applyJobProgress = (jobId, evt) => {
  pipelineLog("JOB_PROGRESS", {
    phase: evt.phase,
    message: evt.message,
    counts: evt.counts || null,
    failures: evt.failures?.length || 0,
    plan: evt.plan
      ? {
          examType: evt.plan.examType,
          subjects: evt.plan.subjects,
          typeCounts: evt.plan.typeCounts,
          slotCounts: evt.plan.slots
            ? Object.fromEntries(
                Object.entries(evt.plan.slots).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.length : 0,
                ])
              )
            : null,
        }
      : undefined,
  });
  const patch = { phase: evt.phase, message: evt.message };
  if (evt.subPhase) patch.subPhase = evt.subPhase;
  if (evt.plan) patch.plan = evt.plan;
  if (evt.questions) {
    const deduped = dedupePaperQuestionsByStem(evt.questions);
    patch.questions = deduped;
    if (evt.counts) {
      patch.counts = { ...evt.counts, total: deduped.length };
    } else {
      patch.counts = { total: deduped.length };
    }
    patch.completedQuestions = deduped.length;
  } else if (evt.counts) {
    patch.counts = evt.counts;
  }
  if (evt.items) patch.items = evt.items;
  if (evt.failures) patch.failures = evt.failures;
  if (evt.counts?.expected != null) patch.totalQuestions = evt.counts.expected;
  if (Array.isArray(evt.failures)) patch.failedQuestions = evt.failures.length;
  patch.tokenUsage = readTokenSummary(jobId)?.byModel || {};
  patch.logDir = `temp/paper-jobs/${jobId}`;
  updateGenerationJob(jobId, patch);
  if (patch.questions) {
    saveGeneratedPaperDraft(jobId, patch.questions, {
      status: "temporary",
      phase: evt.phase,
      message: evt.message,
      counts: patch.counts || {},
    });
  }
  persistJobRecord(jobId, {
    status: "running",
    phase: evt.phase,
    message: evt.message,
    generationId: jobId,
    counts: patch.counts || evt.counts || {},
    failures: evt.failures || [],
    plan: evt.plan,
    totalQuestions:
      evt.counts?.expected ??
      getGenerationJob(jobId)?.totalQuestions ??
      getGenerationJob(jobId)?.config?.totalQuestions,
    completedQuestions: patch.completedQuestions ?? evt.counts?.total,
    failedQuestions: Array.isArray(evt.failures) ? evt.failures.length : undefined,
  }).catch(() => {});
};

const runJobLoop = async (jobId, config, { resume = false } = {}) => {
  if (runningJobs.has(jobId)) return getGenerationJob(jobId);
  const current = getGenerationJob(jobId);
  const currentStatus = String(current?.status || "").toLowerCase();
  if (currentStatus === "cancelled") {
    return current;
  }
  if (
    currentStatus === "failed" &&
    (current?.errorCode === PROVIDER_CREDITS_CODE ||
      isProviderCreditsExhausted({ message: current?.error }))
  ) {
    return current;
  }
  runningJobs.add(jobId);
  currentJobId = jobId;
  lastCallContext = null;
  clearProviderFatalAbort(jobId);
  bindPaperJob(jobId);
  try {
    updateGenerationJob(jobId, {
      status: "running",
      phase: resume ? "resume" : "plan",
      message: resume
        ? "Resuming from last locked question"
        : "Planning slots",
      error: "",
      errorCode: "",
      resumable: false,
    });
    const resumeJob = resume ? getGenerationJob(jobId) : null;
    const result = await runAdvancedPaperPipeline(config, {
      resumeJob,
      onProgress: (evt) => applyJobProgress(jobId, evt),
    });
    const afterStatus = String(
      getGenerationJob(jobId)?.status || ""
    ).toLowerCase();
    // Credits abort may have already marked the job failed mid-flight.
    if (afterStatus === "cancelled" || afterStatus === "failed") {
      return getGenerationJob(jobId);
    }
    const tokens = readTokenSummary(jobId);
    pipelineLog("JOB_DONE", { counts: result.counts, tokens: tokens.byModel });
    const questions = dedupePaperQuestionsByStem(result.questions || []);
    const counts = {
      ...(result.counts || {}),
      total: questions.length,
    };
    const terminalStatus =
      result.completionStatus === "partially_completed"
        ? "partially_completed"
        : result.completionStatus === "failed"
          ? "failed"
          : "completed";
    const doneMessage =
      terminalStatus === "completed"
        ? `Done — ${counts.total}/${counts.expected || counts.total} o3-verified`
        : terminalStatus === "partially_completed"
          ? `Partial — ${counts.total}/${counts.expected || "?"} o3-verified`
          : `Failed — ${counts.total || 0} locked`;
    updateGenerationJob(jobId, {
      status: terminalStatus,
      phase: "done",
      message: doneMessage,
      questions,
      counts,
      plan: result.plan,
      items: result.items,
      failures: result.failures,
      tokenUsage: tokens.byModel,
      logDir: `temp/paper-jobs/${jobId}`,
      resumable: terminalStatus !== "completed",
      completedQuestions: counts.total,
      failedQuestions: Array.isArray(result.failures) ? result.failures.length : 0,
      totalQuestions: counts.expected,
      completionStatus: result.completionStatus || terminalStatus,
    });
    await persistJobRecord(jobId, {
      status: terminalStatus === "partially_completed" ? "completed" : terminalStatus,
      phase: "done",
      message: doneMessage,
      generationId: jobId,
      counts,
      failures: result.failures || [],
      plan: result.plan,
      resumable: terminalStatus !== "completed",
      completedQuestions: counts.total,
      failedQuestions: Array.isArray(result.failures) ? result.failures.length : 0,
      totalQuestions: counts.expected,
      completedAt: new Date(),
    });
    saveGeneratedPaperDraft(jobId, questions, {
      status:
        terminalStatus === "completed" ? "ready_to_confirm" : terminalStatus,
      phase: "done",
      message: doneMessage,
      counts,
    });
  } catch (err) {
    const errorDetail = serializeError(err);
    const payload = err?.pipeline || lastCallContext;
    const credits = isProviderCreditsExhausted(err);
    const auth = !credits && isOpenAiAuthError(err);
    const reason = auth
      ? OPENAI_AUTH_USER_MESSAGE
      : credits
        ? err?.message || providerCreditsError(err, err?.provider || "gemini").message
        : err?.message || String(err);
    const errorCode = auth
      ? OPENAI_AUTH_CODE
      : credits
        ? PROVIDER_CREDITS_CODE
        : err?.code || null;
    const status = auth ? "paused" : "failed";
    pipelineLog(auth ? "JOB_PAUSED" : "JOB_FAILED", {
      error: err,
      errorDetail,
      lastCall: payload,
      cause: err?.cause ? serializeError(err.cause) : null,
      reason,
      fatal: credits || auth || Boolean(err?.fatal),
      errorCode,
    });
    const existing = getGenerationJob(jobId) || {};
    const tokens = readTokenSummary(jobId);
    updateGenerationJob(jobId, {
      status,
      phase: auth ? "paused" : "error",
      error: reason,
      errorCode,
      errorDetail,
      lastCall: payload,
      message: reason,
      // Credits exhaustion cannot resume until billing is topped up.
      // Auth pause can resume after OPENAI_API_KEY is corrected.
      resumable: credits ? false : true,
      tokenUsage: tokens.byModel,
      logDir: `temp/paper-jobs/${jobId}`,
    });
    await persistJobRecord(jobId, {
      status,
      phase: auth ? "paused" : "error",
      error: reason,
      errorDetail,
      message: reason,
      resumable: credits ? false : true,
      counts: existing.counts || {},
      failures: existing.failures || [],
    });
  } finally {
    runningJobs.delete(jobId);
    clearProviderFatalAbort(jobId);
    if (currentJobId === jobId) currentJobId = null;
  }
  return getGenerationJob(jobId);
};

export const startAdvancedPaperJob = (config = {}) => {
  const jobId = `apt-${randomUUID()}`;
  const totalQuestions = Math.max(0, Number(config.totalQuestions) || 0);
  currentJobId = jobId;
  lastCallContext = null;
  bindPaperJob(jobId);
  pipelineLog("JOB_START", {
    jobId,
    generationId: jobId,
    runner: PAPER_JOB_RUNNER,
    config,
    env: {
      PAPER_JOB_RUNNER,
      GEMINI_HARD_TEXT_MODEL: process.env.GEMINI_HARD_TEXT_MODEL || null,
      GEMINI_REQUEST_TIMEOUT_MS: process.env.GEMINI_REQUEST_TIMEOUT_MS || null,
      JEE_ADV_GEMINI_TIMEOUT_MS: process.env.JEE_ADV_GEMINI_TIMEOUT_MS || null,
      pipelineGeminiTimeoutMs: getGeminiTimeoutMs("generate"),
      OPENAI_VERIFY_MODEL: getVerifyModel(),
      OPENAI_VERIFY_REASONING_EFFORT: getVerifyEffort(),
      OPENAI_VERIFY_TIMEOUT_MS: getVerifyTimeoutMs(),
      JEE_ADV_VERIFY_TIMEOUT_RETRIES: getVerifyTimeoutRetries(),
      JEE_ADV_QUESTION_CONCURRENCY: Number(
        process.env.JEE_ADV_QUESTION_CONCURRENCY || 2
      ),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    },
  });

  if (isInlinePaperRunner()) {
    createGenerationJob(jobId, {
      status: "running",
      phase: "queued",
      pipeline: "jee_advanced_luna_verify",
      runner: "inline",
      generationId: jobId,
      config,
      questions: [],
      items: [],
      failures: [],
      totalQuestions,
      completedQuestions: 0,
      failedQuestions: 0,
      logDir: `temp/paper-jobs/${jobId}`,
      message: `Queued ${config.examLabel || config.examType || "exam"} generate → o3 verify+solution (inline)`,
    });
    persistJobRecord(jobId, {
      status: "running",
      phase: "queued",
      message: `Queued ${config.examLabel || config.examType || "exam"} generate → o3 verify+solution (inline)`,
      generationId: jobId,
      config,
      runner: "inline",
      totalQuestions,
      completedQuestions: 0,
      failedQuestions: 0,
      exam: config.examLabel || config.examType || "",
      subject: config.subject || "",
      userId: config.createdBy || null,
    }).catch(() => {});
    setImmediate(() => {
      runJobLoop(jobId, config, { resume: false }).catch((err) => {
        pipelineLog("JOB_LOOP_CRASH", { error: err });
      });
    });
  } else {
    enqueuePaperJob(jobId, config, {
      generationId: jobId,
      totalQuestions,
      exam: config.examLabel || config.examType || "",
      subject: config.subject || "",
    });
  }
  return getGenerationJob(jobId);
};

/**
 * Worker entrypoint — claim already happened; run the pipeline loop.
 */
export const executePaperJob = async (jobId, config = {}, { resume = false } = {}) => {
  const job = getGenerationJob(jobId);
  const cfg = config?.typeCounts || config?.totalQuestions ? config : job?.config || {};
  const shouldResume =
    resume ||
    Boolean(job?.resumable) ||
    Boolean(job?.items?.length) ||
    Boolean(job?.plan?.slots);
  return runJobLoop(jobId, cfg, { resume: shouldResume });
};

export const resumeAdvancedPaperJob = (jobId) => {
  const job = getGenerationJob(jobId);
  if (!job) {
    throw new ApiError(404, "Generation job not found");
  }
  const status = String(job.status || "").toLowerCase();
  if (status === "completed") return job;
  if (status === "running" && runningJobs.has(jobId)) return job;

  pipelineLog("JOB_RESUME", {
    jobId,
    runner: PAPER_JOB_RUNNER,
    kept: job.questions?.length || 0,
    items: job.items?.length || 0,
    failures: job.failures?.length || 0,
  });

  if (isInlinePaperRunner()) {
    updateGenerationJob(jobId, {
      status: "running",
      phase: "resume",
      runner: "inline",
      message: "Resuming from saved questions (tokens already spent are kept)",
      error: "",
      resumeCount: (Number(job.resumeCount) || 0) + 1,
      resumable: false,
    });
    persistJobRecord(jobId, {
      status: "running",
      phase: "resume",
      message: "Resuming from saved questions",
      resumeCount: (Number(job.resumeCount) || 0) + 1,
      resumable: false,
      runner: "inline",
    }).catch(() => {});
    setImmediate(() => {
      runJobLoop(jobId, job.config || {}, { resume: true }).catch((err) => {
        pipelineLog("JOB_LOOP_CRASH", { error: err });
      });
    });
  } else {
    requeuePaperJob(jobId, {
      resumeCount: (Number(job.resumeCount) || 0) + 1,
      resumable: true,
      message: "Re-queued resume for paper worker",
    });
  }
  return getGenerationJob(jobId);
};

export const cancelAdvancedPaperJob = (jobId) => {
  runningJobs.delete(jobId);
  const updated = cancelGenerationJob(jobId, "Generation cancelled by user");
  persistJobRecord(jobId, {
    status: "cancelled",
    phase: "cancelled",
    message: "Generation cancelled by user",
    resumable: false,
  }).catch(() => {});
  return updated;
};

export default {
  planPipelineSlots,
  generatePipelineQuestions,
  dualLockPipelineQuestions,
  expandPipelineQuestions,
  runAdvancedPaperPipeline,
  startAdvancedPaperJob,
  resumeAdvancedPaperJob,
  cancelAdvancedPaperJob,
  executePaperJob,
};
