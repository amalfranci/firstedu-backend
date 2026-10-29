/**
 * Minimal parallel paper pipeline (token-efficient):
 *
 *   Gemini generate (Q + proposed answer)  [parallel]
 *        ↓
 *   Free schema check (no LLM)
 *        ↓
 *   o3 independent solve + verify answer + verifiedSolution  [parallel]
 *        · empty / infra / uncertain → same-seat o3 retry (NO Gemini)
 *        · clear QUALITY fail → Gemini replace ≤ JEE_ADV_QUALITY_REPLACE_MAX
 *        ↓
 *   Prose polish (gpt-5.6-luna, spelling/grammar only — answer locked)
 *        ↓
 *   READY (Gemini stem + o3 answer + polished explanation)
 *
 * Removed from this path: hard Code QC stage, Gemini Expand, full Luna paper audit.
 */

import { randomUUID } from "crypto";
import { callOpenAIReasoningJson } from "./openaiReasoningChat.service.js";
import { isDuplicateStem } from "./paperCodeValidation.service.js";
import {
  dedupePaperQuestionsByStem,
  isNearDuplicateOfAny,
} from "../utils/paperQuestionDedupe.js";
import {
  isProviderCreditsExhausted,
  isOpenAiAuthError,
  openAiAuthError,
  providerCreditsError,
  getProviderFatalAbort,
  markProviderFatalAbort,
} from "../utils/aiProviderErrors.js";
import { resolvePaperExam } from "./paperExamIdentity.service.js";
import {
  explanationRemapMismatch,
  finalizeExplanationForPublish,
  remapExplanationOptionLetters,
  stripOptionLabelPrefix,
  autoFixOptionArticles,
} from "../utils/explanationAnswerAlign.js";
import { polishExplanationProse } from "./paperExplanationProsePolish.service.js";
import { applyExplanationQualityGate } from "./paperExplanationQualityGate.service.js";
import { appendStageQuestionLog } from "./paperJobArtifact.service.js";
import { getGenerationJob } from "./questionBankGenerationJobStore.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const mapPool = async (items, concurrency, fn) => {
  const n = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const results = new Array(items.length);
  let cursor = 0;
  let fatal = null;
  const worker = async () => {
    while (true) {
      if (fatal) return;
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (isProviderCreditsExhausted(err) || err?.fatal) {
          fatal = err;
        }
        throw err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, () => worker())
  );
  return results;
};

const getSolverModel = () =>
  String(process.env.PAPER_SOLVER_MODEL || "o3").trim() || "o3";
const getSolverEffort = () =>
  String(process.env.PAPER_SOLVER_REASONING_EFFORT || "high")
    .trim()
    .toLowerCase() || "high";
const getSolverTimeoutMs = () =>
  Math.max(
    30_000,
    Math.min(300_000, Number(process.env.PAPER_SOLVER_TIMEOUT_MS || 120_000))
  );
/** Higher default — o3 must return verifiedSolution, not just a key. Default 10k prevents TPM reservation spikes. */
const getSolverMaxTokens = () =>
  Math.max(2000, Math.min(25000, Number(process.env.PAPER_SOLVER_MAX_TOKENS || 10000)));

const genConcurrency = () =>
  Math.max(
    1,
    Math.min(
      8,
      Number(
        process.env.PAPER_GENERATE_CONCURRENCY ||
          process.env.JEE_ADV_GENERATE_CONCURRENCY ||
          6
      )
    )
  );
const o3Concurrency = () =>
  Math.max(
    1,
    Math.min(
      8,
      Number(
        process.env.PAPER_O3_CONCURRENCY ||
          process.env.JEE_ADV_O3_CONCURRENCY ||
          2
      )
    )
  );

const infraTimeoutRetries = () =>
  Math.max(
    0,
    Math.min(
      5,
      Number(
        process.env.PAPER_VERIFY_TIMEOUT_RETRIES ??
          process.env.JEE_ADV_VERIFY_TIMEOUT_RETRIES ??
          4
      )
    )
  );

const o3SameSeatRetries = () =>
  Math.max(
    0,
    Math.min(
      5,
      Number(
        process.env.PAPER_O3_SAME_SEAT_RETRIES ??
          process.env.JEE_ADV_O3_SAME_SEAT_RETRIES ??
          2
      )
    )
  );

const qualityReplaceMax = (needSeats) => {
  const raw =
    process.env.PAPER_QUALITY_REPLACE_MAX ??
    process.env.JEE_ADV_QUALITY_REPLACE_MAX;
  if (raw === "0" || raw === "false") return 0;
  if (raw != null && String(raw).trim() !== "") {
    const parsed = Number(raw);
    return Math.max(needSeats, Number.isFinite(parsed) ? parsed : 0);
  }
  return Math.max(0, Number(needSeats) || 0);
};

const isInfraError = (err) => {
  if (isProviderCreditsExhausted(err) || err?.fatal) return false;
  const code = String(err?.code || "");
  const msg = String(err?.message || err || "");
  const status = Number(err?.response?.status || err?.status || 0);
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "O3_EMPTY" ||
    code === "O3_INFRA" ||
    /timeout|ECONNABORTED|ETIMEDOUT|network|socket hang up|fetch failed|temporarily unavailable|429|rate limit|502|503|504|empty response|unparseable/i.test(
      msg
    )
  );
};

const getRetryAfterSeconds = (err) => {
  const header =
    err?.response?.headers?.["retry-after"] ||
    err?.response?.headers?.["Retry-After"] ||
    err?.headers?.["retry-after"] ||
    err?.headers?.["Retry-After"];
  if (!header) return null;
  const sec = Number(header);
  if (Number.isFinite(sec) && sec > 0) return sec;
  const date = new Date(header).getTime();
  if (Number.isFinite(date) && date > Date.now()) {
    return Math.ceil((date - Date.now()) / 1000);
  }
  return null;
};

const withInfraRetries = async (fn, { label, pipelineLog, maxAttempts } = {}) => {
  const attempts = Math.max(1, 1 + (maxAttempts ?? infraTimeoutRetries()));
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const is429 =
        Number(err?.response?.status || err?.status || 0) === 429 ||
        /429|rate limit/i.test(String(err?.message || err || ""));
      const canRetry = isInfraError(err) && attempt < attempts;
      if (!canRetry) throw err;

      const retryAfterSec = getRetryAfterSeconds(err);
      const jitter = Math.floor(Math.random() * 2000);
      let backoffMs;
      if (is429) {
        // Exponential backoff: 2s -> 4s -> 8s -> 16s -> 30s (+ jitter)
        const exp = Math.min(30000, 2000 * Math.pow(2, attempt - 1) + jitter);
        backoffMs = retryAfterSec ? Math.max(exp, retryAfterSec * 1000 + jitter) : exp;
      } else {
        backoffMs = Math.min(8000, 1000 * attempt + jitter);
      }

      pipelineLog?.("INFRA_RETRY", {
        label,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: attempts,
        backoffMs,
        retryAfter: retryAfterSec || null,
        reason: err?.message || String(err),
        status: err?.response?.status || null,
        rateLimitReset:
          err?.response?.headers?.["x-ratelimit-reset-requests"] ||
          err?.response?.headers?.["x-ratelimit-reset-tokens"] ||
          null,
      });
      await sleep(backoffMs);
    }
  }
  throw lastErr;
};

const parseJsonLoose = (raw) => {
  if (raw && typeof raw === "object") return raw;
  let text = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!text) return null;

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = text.slice(start, end + 1);
    parsed = tryParse(sliced);
    if (parsed) return parsed;
    // Common o3 failure: invalid single backslashes inside LaTeX in verifiedSolution.
    parsed = tryParse(sliced.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
    if (parsed) return parsed;
  }

  // Last resort: pull the fields we actually need even if the full blob is truncated.
  const pick = (key) => {
    const m = text.match(
      new RegExp(
        `"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|true|false|null|-?\\d+(?:\\.\\d+)?)`,
        "i"
      )
    );
    if (!m) return undefined;
    try {
      return JSON.parse(m[1]);
    } catch {
      return String(m[1] || "")
        .replace(/^"|"$/g, "")
        .replace(/\\n/g, "\n");
    }
  };
  const independentAnswer = pick("independentAnswer");
  if (independentAnswer == null || independentAnswer === "") return null;
  return {
    independentAnswer,
    answerMatches: pick("answerMatches"),
    calculationCorrect: pick("calculationCorrect"),
    questionValid: pick("questionValid") ?? true,
    confidence: pick("confidence") || "medium",
    verifiedSolution: pick("verifiedSolution") || "",
    issues: ["partial_o3_json_recovered"],
  };
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
  if (type === "multiple") {
    const letters = (
      Array.isArray(q.correctAnswer)
        ? q.correctAnswer
        : String(q.correctAnswer || q.correctLetters || "")
            .toUpperCase()
            .split(/[^A-D]+/)
    )
      .map((s) => String(s).replace(/[^A-D]/g, "").slice(0, 1))
      .filter((s) => /^[A-D]$/.test(s));
    const uniq = [...new Set(letters)].sort();
    return uniq.length ? uniq.join(",") : null;
  }
  const letter = String(q.correctAnswer || "")
    .trim()
    .toUpperCase()
    .match(/[A-D]/);
  if (letter) return letter[0];
  if (Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3) {
    return String.fromCharCode(65 + q.correctIndex);
  }
  return null;
};

const keysMatch = (type, a, b) => {
  if (a == null || b == null) return false;
  if (type === "integer") return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a) === String(b);
};

/**
 * Free local schema check — NOT a model stage.
 * Only blocks outputs o3 cannot usefully solve (missing stem / broken shape).
 * MCQs: require ≥4 non-empty options (all competitive exams).
 */
export const schemaOkForO3 = (q, typeHint = null, _examType = "") => {
  const issues = [];
  if (!q || typeof q !== "object") {
    return { ok: false, issues: ["not_an_object"] };
  }
  const type = String(
    typeHint || q._advancedType || q.questionType || ""
  ).toLowerCase();
  if (!["single", "multiple", "integer", "match"].includes(type)) {
    issues.push(`invalid_type:${type || "empty"}`);
  }
  const stem = String(q.questionText || q.text || "").trim();
  if (!stem || stem.length < 12) issues.push("missing_or_short_stem");

  const exam = String(_examType || q._examType || "").toLowerCase();
  const isJeeMain = exam === "jee_main" || /jee\s*main/i.test(exam);
  if (isJeeMain) {
    const passage = String(q.passage || q.passageText || q.paragraph || "").trim();
    if (passage && passage.length > 40) {
      issues.push("passage_disallowed_for_jee_main");
    }
  }

  if (type === "integer") {
    const n = Number(q.correctAnswer ?? q.finalAnswer ?? q.answerDisplay);
    if (!Number.isFinite(n)) issues.push("integer_answer_not_numeric");
  } else if (type === "match") {
    const listI = Array.isArray(q.listI) ? q.listI : [];
    const listII = Array.isArray(q.listII) ? q.listII : [];
    if (listI.length < 2 || listII.length < 2) {
      issues.push("match_lists_incomplete");
    }
    if (!proposedKeyOf(q, "match")) issues.push("match_missing_proposed_key");
  } else if (type === "single" || type === "multiple") {
    const opts = (Array.isArray(q.options) ? q.options : [])
      .map((o) => String(typeof o === "string" ? o : o?.text || "").trim())
      .filter(Boolean);
    // Never ship empty/partial MCQs — ≥4 options for every competitive exam.
    if (opts.length < 4) issues.push(`options_incomplete:${opts.length}`);
    if (!proposedKeyOf(q, type)) issues.push("missing_proposed_key");
  }
  return { ok: issues.length === 0, issues };
};

const callOpenAiJson = async ({
  kind,
  model,
  effort,
  timeoutMs,
  maxTokens,
  prompt,
  developerHint,
  pipelineLog,
  recordUsage,
  jobId,
  /** Correlate parallel REQUEST/RESPONSE logs — never match by arrival order. */
  requestId: requestIdIn,
  seq,
  topicId,
  subject,
  chapter,
  questionType,
  stemPreview,
}) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("missing_OPENAI_API_KEY");
  const requestId = requestIdIn || randomUUID();
  const correlate = {
    requestId,
    ...(seq != null ? { seq } : {}),
    ...(topicId ? { topicId } : {}),
    ...(subject ? { subject } : {}),
    ...(chapter ? { chapter } : {}),
    ...(questionType ? { type: questionType } : {}),
    ...(stemPreview ? { stemPreview: String(stemPreview).slice(0, 160) } : {}),
  };
  pipelineLog?.(
    kind === "solve" ? "OPENAI_SOLVE_REQUEST" : "OPENAI_VERIFY_REQUEST",
    {
      ...correlate,
      model,
      kind,
      timeoutMs,
      reasoningEffort: effort,
      maxCompletionTokens: maxTokens,
      promptChars: String(prompt || "").length,
      promptPreview: String(prompt || "").slice(0, 400),
    }
  );
  const started = Date.now();
  try {
    // Await is per-call; returned text belongs to THIS requestId even when
    // other seats finish earlier and their RESPONSE logs print first.
    const packed = await callOpenAIReasoningJson({
      apiKey,
      prompt,
      model,
      reasoningEffort: effort,
      callWithRetries: async (fn) => fn(),
      toError: (e) => e,
      timeoutMs,
      withUsage: true,
      disableFallback: true,
      maxCompletionTokens: maxTokens,
      developerHint,
    });
    const text = packed?.text ?? packed;
    const usage = {
      provider: "openai",
      model: packed?.model || model,
      kind,
      promptTokens: Number(packed?.usage?.promptTokens) || 0,
      completionTokens: Number(packed?.usage?.completionTokens) || 0,
      totalTokens: Number(packed?.usage?.totalTokens) || 0,
      reasoningTokens: Number(packed?.usage?.reasoningTokens) || 0,
    };
    recordUsage?.(jobId, usage);
    pipelineLog?.(
      kind === "solve" ? "OPENAI_SOLVE_RESPONSE" : "OPENAI_VERIFY_RESPONSE",
      {
        ...correlate,
        model: packed?.model || model,
        kind,
        elapsedMs: Date.now() - started,
        responseChars: String(text || "").length,
        responsePreview: String(text || "").slice(0, 500),
        tokens: usage,
      }
    );
    return { text, requestId };
  } catch (err) {
    if (isOpenAiAuthError(err)) {
      const authErr = openAiAuthError(err);
      markProviderFatalAbort(jobId, authErr);
      pipelineLog?.(
        kind === "solve" ? "OPENAI_SOLVE_ERROR" : "OPENAI_VERIFY_ERROR",
        {
          ...correlate,
          model,
          kind,
          elapsedMs: Date.now() - started,
          timeoutMs,
          fatal: true,
          errorCode: authErr.code,
          error: {
            message: authErr.message,
            code: authErr.code,
            status: authErr.status,
          },
        }
      );
      throw authErr;
    }
    if (isProviderCreditsExhausted(err)) {
      const creditsErr = providerCreditsError(err, "openai");
      pipelineLog?.(
        kind === "solve" ? "OPENAI_SOLVE_ERROR" : "OPENAI_VERIFY_ERROR",
        {
          ...correlate,
          model,
          kind,
          elapsedMs: Date.now() - started,
          timeoutMs,
          fatal: true,
          errorCode: creditsErr.code,
          error: {
            message: creditsErr.message,
            code: creditsErr.code,
            status: 402,
          },
        }
      );
      throw creditsErr;
    }
    pipelineLog?.(
      kind === "solve" ? "OPENAI_SOLVE_ERROR" : "OPENAI_VERIFY_ERROR",
      {
        ...correlate,
        model,
        kind,
        elapsedMs: Date.now() - started,
        timeoutMs,
        error: {
          message: err?.message,
          code: err?.code,
          status: err?.response?.status,
        },
      }
    );
    throw err;
  }
};

const buildO3SolvePrompt = (q, type, examHint = {}) => {
  const proposed = proposedKeyOf(q, type);
  const opts = (q.options || []).map(
    (o, i) =>
      `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : o?.text || o}`
  );
  const lists = [
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

  const exam = resolvePaperExam({
    examType: q._examType || examHint?.examType,
    examLabel: q._examLabel || examHint?.examLabel,
  });
  const examLabel = exam.examLabel;

  const passage = String(q.passage || q.passageText || q.paragraph || "").trim();
  const stemBody = passage
    ? `PASSAGE:\n${passage}\n\nQUESTION:\n${q.questionText}`
    : String(q.questionText || "");

  return `You are an independent ${examLabel} solver (o3).
Solve from first principles. Do NOT trust the proposed answer.
You MUST return a complete verified derivation in verifiedSolution.

Type: ${type}
Exam: ${examLabel}
Chapter: ${q._chapter || q.chapter || ""}
STEM:
${stemBody}
${lists}
${opts.length ? `OPTIONS:\n${opts.join("\n")}` : ""}

PROPOSED ANSWER (from writer — verify independently): ${proposed}

Return ONLY JSON:
{
  "independentAnswer": "...",
  "answerMatches": true|false,
  "calculationCorrect": true|false,
  "questionValid": true|false,
  "confidence": "high"|"medium"|"low",
  "verifiedSolution": "full insight-first derivation ending with the locked answer. Use LaTeX with $...$.",
  "issues": []
}

Rules:
- independentAnswer: letter A-D, letters CSV for multiple, or number for integer
- verifiedSolution: complete student-facing explanation (this becomes the final explanation)
- If proposed answer is wrong, set answerMatches false and still give the correct independentAnswer + verifiedSolution for the CORRECT answer
- Do not rewrite the stem; do not invent options
- verifiedSolution prose rules (mandatory):
  - Write "Option Analysis" / "Option B is …" with a real space — never glue letters into words (never "Option Bnalysis" / "Option A. nalysis")
  - Do NOT include meta tags: "Locked answer", "FINAL_ANSWER", "Answer: A", bare "[C]", or solver notes
  - End with exactly one closer: "Therefore, the correct option is X." matching independentAnswer
  - Mid-text critiques may name wrong options; the final closer must match independentAnswer only`;
};

export const o3VerifyCompact = async (q, type, ctx) => {
  const proposed = proposedKeyOf(q, type);
  const requestId = randomUUID();
  const stemPreview = String(q?.questionText || q?.text || "").slice(0, 160);
  const seatMeta = {
    requestId,
    seq: ctx?.seq,
  };
  let raw;
  try {
    const packed = await withInfraRetries(
      async (attempt) =>
        callOpenAiJson({
          kind: "solve",
          model: getSolverModel(),
          effort: attempt > 1 ? "medium" : getSolverEffort(),
          timeoutMs: getSolverTimeoutMs(),
          maxTokens: Math.min(24000, getSolverMaxTokens() + (attempt > 1 ? 4000 : 0)),
          prompt: buildO3SolvePrompt(q, type, ctx),
          developerHint:
            "Return ONLY JSON. Independently solve. verifiedSolution is mandatory and must derive independentAnswer.",
          pipelineLog: ctx.pipelineLog,
          recordUsage: ctx.recordUsage,
          jobId: ctx.jobId,
          // Same requestId across infra retries so logs stay joinable to this seat.
          requestId,
          seq: ctx.seq,
          topicId: ctx.topicId || q?._topicId || q?.topicId,
          subject: ctx.subject || q?.subject || q?._subject,
          chapter: ctx.chapter || q?.chapter || q?._chapter,
          questionType: type,
          stemPreview,
        }),
      { label: "o3_verify", pipelineLog: ctx.pipelineLog }
    );
    // callOpenAiJson returns { text, requestId }; tolerate legacy string.
    raw = typeof packed === "string" ? packed : packed?.text;
  } catch (err) {
    if (isOpenAiAuthError(err)) {
      throw isOpenAiAuthError(err) && err?.code === "OPENAI_AUTH_FAILURE"
        ? err
        : openAiAuthError(err);
    }
    if (isProviderCreditsExhausted(err)) {
      throw providerCreditsError(err, "openai");
    }
    return {
      pass: false,
      infra: true,
      uncertain: false,
      result: {
        independentAnswer: null,
        answerMatches: false,
        calculationCorrect: false,
        questionValid: true,
        confidence: "low",
        verifiedSolution: "",
        issues: [err?.message || "o3_infra_error"],
        proposedKey: proposed,
        empty: true,
        ...seatMeta,
      },
    };
  }

  if (!String(raw || "").trim()) {
    return {
      pass: false,
      infra: true,
      uncertain: false,
      result: {
        independentAnswer: null,
        answerMatches: false,
        calculationCorrect: false,
        questionValid: true,
        confidence: "low",
        verifiedSolution: "",
        issues: ["empty_o3_response"],
        proposedKey: proposed,
        empty: true,
        ...seatMeta,
      },
    };
  }

  const parsed = parseJsonLoose(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      pass: false,
      infra: true,
      uncertain: false,
      result: {
        independentAnswer: null,
        answerMatches: false,
        calculationCorrect: false,
        questionValid: true,
        confidence: "low",
        verifiedSolution: "",
        issues: ["unparseable_o3_response"],
        proposedKey: proposed,
        empty: true,
        ...seatMeta,
      },
    };
  }

  const independent =
    parsed.independentAnswer ??
    parsed.derived_answer ??
    parsed.answer ??
    null;
  let independentNorm = independent;
  if (type === "integer") {
    const n = Number(independent);
    independentNorm = Number.isFinite(n) ? n : null;
  } else if (type === "multiple") {
    const letters = String(independent || "")
      .toUpperCase()
      .split(/[^A-D]+/)
      .filter((s) => /^[A-D]$/.test(s));
    independentNorm = [...new Set(letters)].sort().join(",") || null;
  } else {
    const m = String(independent || "")
      .toUpperCase()
      .match(/[A-D]/);
    independentNorm = m ? m[0] : String(independent || "").trim() || null;
  }

  const hasExplicitFail =
    parsed.answerMatches === false ||
    parsed.calculationCorrect === false ||
    parsed.questionValid === false;

  if (independentNorm == null && !hasExplicitFail) {
    return {
      pass: false,
      infra: true,
      uncertain: false,
      result: {
        independentAnswer: null,
        answerMatches: false,
        calculationCorrect: false,
        questionValid: true,
        confidence: "low",
        verifiedSolution: String(parsed.verifiedSolution || "").trim(),
        issues: ["o3_missing_independent_answer"],
        proposedKey: proposed,
        empty: true,
        ...seatMeta,
      },
    };
  }

  const answerMatches =
    parsed.answerMatches === true || keysMatch(type, independentNorm, proposed);
  const calculationCorrect = parsed.calculationCorrect === true;
  const questionValid = parsed.questionValid !== false;
  const confidence = String(parsed.confidence || "medium").toLowerCase();
  const verifiedSolution = String(
    parsed.verifiedSolution || parsed.explanation || parsed.solution || ""
  ).trim();

  const pass =
    answerMatches &&
    calculationCorrect &&
    questionValid &&
    confidence !== "low" &&
    parsed.answerMatches !== false &&
    verifiedSolution.length >= 40;

  const uncertain =
    !pass &&
    !hasExplicitFail &&
    (confidence === "medium" || confidence === "low" || verifiedSolution.length < 40);

  return {
    pass,
    infra: false,
    uncertain: Boolean(uncertain && !pass),
    result: {
      independentAnswer: independentNorm,
      answerMatches,
      calculationCorrect,
      questionValid,
      confidence,
      verifiedSolution,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      proposedKey: proposed,
      ...seatMeta,
    },
  };
};

const isValidKeyForQuestion = (type, key, locked) => {
  if (key == null) return false;
  if (type === "integer") {
    return Number.isFinite(Number(key));
  }
  if (type === "multiple") {
    const letters = String(key)
      .toUpperCase()
      .split(/[^A-D]+/)
      .filter((s) => /^[A-D]$/.test(s));
    if (!letters.length) return false;
    const maxIdx = Array.isArray(locked?.options) ? locked.options.length : 4;
    return letters.every((L) => {
      const idx = L.charCodeAt(0) - 65;
      return idx >= 0 && idx < maxIdx;
    });
  }
  // single / match
  const letter = String(key).toUpperCase().slice(0, 1);
  if (!/^[A-D]$/.test(letter)) return false;
  const maxIdx = Array.isArray(locked?.options) ? locked.options.length : 4;
  const idx = letter.charCodeAt(0) - 65;
  return idx >= 0 && idx < maxIdx;
};

const isTier1RekeyEnabled = () => {
  const v =
    process.env.PAPER_TIER1_REKEY_ENABLED ??
    process.env.AI_QB_STAGE_A_ANSWER_LOCK;
  if (v === "0" || v === "false") return false;
  return true;
};

const applyO3Lock = (item, out, stampTrust, { rekeyed = false } = {}) => {
  const type = item.type;
  const key = out.result.independentAnswer;
  const isRekeyed = Boolean(rekeyed || !out.result.answerMatches);
  const locked = {
    ...item.locked,
    explanation: out.result.verifiedSolution,
    _insight: String(out.result.verifiedSolution || "").slice(0, 280),
    _o3Verify: out.result,
    _o3DerivedKey: key,
    _verifiedSolution: out.result.verifiedSolution,
    _stageAAnswerLocked: true,
    _proposedKeyMatch: out.result.answerMatches,
    _doubleSolverAgree: out.result.answerMatches,
    _lockMode: `o3(${getSolverModel()})+solution`,
    _productionReady: true,
    _needsReview: false,
    _trustBadge: isRekeyed ? "O3-REKEYED" : "O3-VERIFIED",
    _trustGrade: "production_o3",
    _explanationExpanded: true,
    _explanationSource: "o3_verifiedSolution",
    _solverTruthApplied: isRekeyed,
    _rekeyedByO3: isRekeyed,
  };

  if (type === "integer" && key != null) {
    locked.correctAnswer = key;
    locked.finalAnswer = key;
    locked.answerDisplay = String(key);
  } else if (type === "multiple" && key) {
    const letters = String(key).split(",").filter(Boolean);
    locked.correctAnswer = letters;
    locked.correctLetters = letters;
    locked.multipleCorrectIndexes = letters.map((L) => L.charCodeAt(0) - 65);
    locked.correctIndex = locked.multipleCorrectIndexes[0] ?? 0;
  } else if (key) {
    const letter = String(key).toUpperCase().slice(0, 1);
    locked.correctAnswer = letter;
    locked.correctIndex = letter.charCodeAt(0) - 65;
  }

  item.stage = "ready_to_confirm";
  // Shuffle single-correct options so the key letter is not stuck on A (~70% bias).
  // Remap explanation option-letters to the post-shuffle positions (otherwise
  // "Hence option B" stays while the key moves to C/D).
  item.locked = stampTrust(shuffleSingleCorrectOptions(locked));
  item.locked = finalizeExplanationForPublish(item.locked);
  item.answerKey =
    item.locked.correctAnswer ?? item.locked.answerDisplay ?? key ?? null;
  item.o3 = out.result;
  return item;
};

/** Infer VARC metadata for RC items wrongly labelled General. */
const repairRcMetadata = (locked, item) => {
  const exam = String(
    locked?._examType || locked?._examLabel || item?.subject || ""
  ).toLowerCase();
  const passage = String(locked?.passage || locked?.passageText || "").trim();
  const stem = String(locked?.questionText || locked?.text || "");
  const looksRc =
    passage.length >= 120 ||
    /read the (following )?(passage|excerpt)|according to the passage/i.test(
      stem
    );
  if (!looksRc) return locked;
  const subject = String(locked?.subject || locked?._subject || "").trim();
  const topic = String(
    locked?.topic || locked?.chapter || locked?._chapter || ""
  ).trim();
  const next = { ...locked };
  if (!subject || /^general$/i.test(subject)) {
    if (/cat|varc|mba/i.test(exam) || /varc/i.test(String(item?.subject || ""))) {
      next.subject = "VARC";
      next._subject = "VARC";
    }
  }
  if (!topic) {
    next.topic =
      locked?._chapter ||
      item?.chapter ||
      "Reading Comprehension";
    next.chapter = next.topic;
    next._chapter = next.topic;
  }
  return next;
};

/** Copy-edit o3 verifiedSolution for spelling/grammar without changing the key. */
const polishLockedExplanation = async (item, ctx) => {
  if (!item?.locked?.explanation) return item;
  item.locked = repairRcMetadata(item.locked, item);
  const polishCtx = {
    pipelineLog: ctx?.pipelineLog,
    recordUsage: ctx?.recordUsage,
    jobId: ctx?.jobId,
    seq: item.seq,
    topicId: item.topicId,
    subject: item.subject,
    chapter: item.chapter,
  };
  const result = await polishExplanationProse({
    explanation: item.locked.explanation,
    markedAnswer: item.locked.correctAnswer,
    ctx: polishCtx,
  });
  if (result?.explanation) {
    item.locked.explanation = result.explanation;
    item.locked._explanationSource = result.polished
      ? "o3_verifiedSolution+prose_polish"
      : item.locked._explanationSource || "o3_verifiedSolution";
    item.locked._explanationPolished = Boolean(result.polished);
    if (result.model) item.locked._explanationPolishModel = result.model;
  }
  // Deterministic finalize after Luna (multi-safe align, strip tails, headers).
  item.locked = finalizeExplanationForPublish(item.locked);
  const gated = applyExplanationQualityGate(item.locked);
  item.locked = gated.locked;
  if (gated.issues?.length) {
    ctx?.pipelineLog?.("EXPLANATION_QUALITY_GATE", {
      seq: item.seq,
      ok: gated.ok,
      issues: gated.issues,
      needsReview: Boolean(item.locked._needsReview),
    });
  }
  return item;
};

/** Fisher–Yates shuffle of MCQ options; updates correctIndex / letter + explanation. */
const shuffleSingleCorrectOptions = (locked = {}) => {
  const type = String(locked._advancedType || locked.questionType || "single").toLowerCase();
  if (type !== "single" && type !== "match") return locked;
  const opts = Array.isArray(locked.options) ? locked.options : [];
  if (opts.length < 2) return locked;

  const rawPlain = opts.map((o) =>
    stripOptionLabelPrefix(typeof o === "string" ? o : o?.text || "")
  );
  const plain = autoFixOptionArticles(rawPlain);
  let correctIdx = Number.isInteger(locked.correctIndex) ? locked.correctIndex : -1;
  if (correctIdx < 0 || correctIdx >= plain.length) {
    const letter = String(locked.correctAnswer || "").toUpperCase().slice(0, 1);
    if (/^[A-D]$/.test(letter)) correctIdx = letter.charCodeAt(0) - 65;
  }
  if (correctIdx < 0 || correctIdx >= plain.length) return locked;

  // Index-stable shuffle so duplicate option texts still get a real permutation.
  const order = plain.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Skip no-op shuffles (identity permutation).
  if (order.every((oldI, newI) => oldI === newI)) {
    return locked;
  }

  const shuffled = order.map((oldI) => plain[oldI]);
  const newIdx = order.indexOf(correctIdx);
  if (newIdx < 0) return locked;
  const letter = String.fromCharCode(65 + newIdx);

  const letterMap = {};
  order.forEach((oldI, newI) => {
    letterMap[String.fromCharCode(65 + oldI)] = String.fromCharCode(65 + newI);
  });

  const rawExpl = locked.explanation || locked._verifiedSolution || "";
  const explanation = remapExplanationOptionLetters(rawExpl, letterMap);

  // If remapped labels disagree with option texts (Q8/Q10), keep pre-shuffle.
  const check = explanationRemapMismatch(explanation, shuffled);
  if (check.mismatch) {
    return {
      ...locked,
      _optionShuffleSkipped: check.reason || "explanation_remap_mismatch",
    };
  }

  return {
    ...locked,
    options: shuffled,
    correctIndex: newIdx,
    correctAnswer: letter,
    correctLetters: [letter],
    ...(explanation ? { explanation } : {}),
    ...(explanation && locked._verifiedSolution
      ? { _verifiedSolution: explanation }
      : {}),
    _optionShuffleMap: letterMap,
  };
};

const verifySeatWithO3Budget = async (item, ctx, stampTrust) => {
  const maxAttempts = 1 + o3SameSeatRetries();
  let lastOut = null;
  // Seat-scoped ctx so parallel o3 calls never share ambiguous log identity.
  const seatCtx = {
    ...ctx,
    seq: item.seq,
    topicId: item.topicId,
    subject: item.subject,
    chapter: item.chapter,
    type: item.type,
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    item.stage = "validating";
    await ctx.checkpointItem?.(item);
    const out = await o3VerifyCompact(item.locked, item.type, seatCtx);
    lastOut = out;
    item.o3 = out.result;
    item.o3Attempts = attempt;
    item.o3RequestId = out.result?.requestId;

    if (out.pass) {
      applyO3Lock(item, out, stampTrust, { rekeyed: false });
      appendStageQuestionLog(ctx?.jobId, "after_o3", item);
      await polishLockedExplanation(item, ctx);
      appendStageQuestionLog(ctx?.jobId, "after_luna", item);
      await ctx.checkpointItem?.(item);
      return { ok: true, item, kind: "pass" };
    }

    // TIER 1: Auto-rekey if question is valid and o3 solved independently with high confidence
    const canTier1Rekey =
      isTier1RekeyEnabled() &&
      out.result?.questionValid === true &&
      !out.result?.answerMatches &&
      out.result?.confidence === "high" &&
      out.result?.calculationCorrect === true &&
      String(out.result?.verifiedSolution || "").trim().length >= 40 &&
      isValidKeyForQuestion(item.type, out.result?.independentAnswer, item.locked);

    if (canTier1Rekey) {
      ctx.pipelineLog?.("TIER1_REKEY", {
        seq: item.seq,
        requestId: out.result?.requestId,
        type: item.type,
        topicId: item.topicId,
        chapter: item.chapter,
        generatorKey: out.result.proposedKey,
        solverKey: out.result.independentAnswer,
        confidence: out.result.confidence,
        reason: "o3_high_confidence_rekey",
      });
      applyO3Lock(item, out, stampTrust, { rekeyed: true });
      appendStageQuestionLog(ctx?.jobId, "after_o3", item);
      await polishLockedExplanation(item, ctx);
      appendStageQuestionLog(ctx?.jobId, "after_luna", item);
      await ctx.checkpointItem?.(item);
      return { ok: true, item, kind: "rekeyed" };
    }

    if (out.infra) {
      if (
        isOpenAiAuthError({
          message: out.result?.issues?.[0],
          status: out.result?.status,
          code: out.result?.code,
        })
      ) {
        throw openAiAuthError(
          new Error(out.result?.issues?.[0] || "OpenAI authentication failed")
        );
      }
      if (
        isProviderCreditsExhausted(out.result) ||
        isProviderCreditsExhausted({ message: out.result?.issues?.[0] })
      ) {
        throw providerCreditsError(
          new Error(out.result?.issues?.[0] || "credits exhausted"),
          "openai"
        );
      }
      return { ok: false, item, kind: "infra", detail: out.result };
    }

    if (out.uncertain && attempt < maxAttempts) {
      ctx.pipelineLog?.("O3_SAME_SEAT", {
        seq: item.seq,
        requestId: out.result?.requestId,
        attempt,
        maxAttempts,
        infra: false,
        uncertain: true,
        willRetry: true,
        issues: out.result?.issues,
        solutionChars: String(out.result?.verifiedSolution || "").length,
      });
      await sleep(Math.min(4000, 1000 * attempt));
      continue;
    }

    if (out.uncertain) {
      return { ok: false, item, kind: "uncertain", detail: out.result };
    }
    return { ok: false, item, kind: "quality", detail: out.result };
  }
  return { ok: false, item, kind: "infra", detail: lastOut?.result };
};

/**
 * @param {object} args
 * @param {object} args.plan
 * @param {object} args.config
 * @param {function} args.onProgress
 * @param {object[]} args.resumeItems
 * @param {object} args.deps
 */
export const runParallelPaperPipeline = async ({
  plan,
  config,
  onProgress,
  resumeItems = [],
  deps,
}) => {
  const {
    generateBatch,
    generatePassagePack,
    toUiQuestion,
    checkpointItem,
    failItem,
    normalizeSubject,
    looksLikeMisplacedNumericalStem,
    looksLikeNumericalVarcStem, // legacy alias
    isVerbalQualitativeSubject = () => false,
    pipelineLog,
    recordUsage,
    jobId,
    runQuestionContext,
    stampTrust,
  } = deps;
  const isMisplacedNumerical =
    typeof looksLikeMisplacedNumericalStem === "function"
      ? looksLikeMisplacedNumericalStem
      : typeof looksLikeNumericalVarcStem === "function"
        ? looksLikeNumericalVarcStem
        : () => false;

  const ctx = {
    pipelineLog,
    recordUsage,
    jobId,
    examType: config?.examType,
    examLabel: config?.examLabel,
  };
  const expectedTotal =
    plan.totalQuestions ||
    Object.values(plan.typeCounts || {}).reduce(
      (s, n) => s + (Number(n) || 0),
      0
    );

  // AI Powered Test: only Single Correct + Multiple Correct seats.
  const types = ["single", "multiple"];
  const seats = [];
  for (const t of types) {
    for (const slot of plan.slots?.[t] || []) {
      seats.push({ type: t, slot });
    }
  }

  const failures = [];
  const keptBySeq = new Map();
  const failedResume = [];
  for (const it of resumeItems || []) {
    if (
      it?.locked &&
      (it.stage === "ready_to_confirm" ||
        it.stage === "verified" ||
        it.stage === "expanded")
    ) {
      keptBySeq.set(Number(it.seq), {
        ...it,
        stage: "ready_to_confirm",
        locked: {
          ...it.locked,
          _productionReady: true,
          _trustBadge: it.locked._trustBadge || "O3-VERIFIED",
        },
      });
      continue;
    }
    // Prior failed / dropped seats — keep for same-subject replace + stem exclude
    if (
      it &&
      (it.failureReason ||
        it.stage === "failed" ||
        it.stage === "dropped" ||
        it.stage === "generated_ok" ||
        it.stage === "generated" ||
        it.locked ||
        it.raw)
    ) {
      failedResume.push(it);
    }
  }

  let seq = 1;
  for (const it of resumeItems || []) {
    seq = Math.max(seq, (Number(it.seq) || 0) + 1);
  }
  for (const k of keptBySeq.keys()) {
    seq = Math.max(seq, Number(k) + 1);
  }

  const stemSnippet = (q) =>
    String(q?.questionText || q?.text || "").slice(0, 180);

  const exclude = [
    ...[...keptBySeq.values()].map((it) => stemSnippet(it.locked)),
    ...failedResume.map((it) => stemSnippet(it.locked || it.raw)),
  ].filter(Boolean);

  const needSeats = Math.max(0, expectedTotal - keptBySeq.size);

    // Prefer seats matching previously failed items (same subject/topic/type)
    // so resume fills the gaps without drifting to unrelated chapters.
    // First resume (resumeCount becomes 1 when queued): re-verify failed stems once.
    // Later resumes: generate NEW unique stems only (same subject/topic).
    const allowReverify = Number(config?._resumeCount || 0) <= 1;
  const preferredFromFailures = failedResume
    .map((it) => ({
      type: it.type || "single",
      slot: {
        subject: it.subject,
        topicId: it.topicId,
        chapter: it.chapter,
        conceptSlot: it.conceptSlot || "",
        hardArchetype: it.conceptSlot || "",
      },
      retryItem: allowReverify && (it.locked || it.raw) ? it : null,
    }))
    .slice(0, needSeats);

  const usedPreferredKeys = new Set();
  const seatKey = (s) =>
    `${s.type}|${normalizeSubject(s.slot?.subject)}|${s.slot?.topicId || ""}`;

  let seatQueue = [];
  if (preferredFromFailures.length > 0) {
    for (const pref of preferredFromFailures) {
      seatQueue.push(pref);
      usedPreferredKeys.add(seatKey(pref));
    }
    // Fill remaining need from the original plan seats
    for (const s of seats) {
      if (seatQueue.length >= needSeats) break;
      const k = seatKey(s);
      if (usedPreferredKeys.has(k)) {
        usedPreferredKeys.delete(k);
        continue;
      }
      seatQueue.push(s);
    }
    while (seatQueue.length < needSeats && seats.length > 0) {
      seatQueue.push(seats[seatQueue.length % seats.length]);
    }
    seatQueue = seatQueue.slice(0, needSeats);
  } else {
    seatQueue = seats.slice(0, needSeats);
  }

  const unusedPool = types.flatMap((t) =>
    (plan.unusedSlots?.[t] || []).map((slot) => ({ type: t, slot }))
  );

  const makeItem = (type, slot, seqNum, attempt = 1) => ({
    seq: seqNum,
    type,
    subject: normalizeSubject(slot.subject),
    topicId: slot.topicId || "",
    chapter: slot.chapter || "",
    conceptSlot: slot.conceptSlot || slot.hardArchetype || "",
    stage: "queued",
    attempt,
  });

  const examType = String(config?.examType || plan?.examType || "").toLowerCase();
  const isJeeMain = examType === "jee_main" || /jee\s*main/i.test(examType);

  const passageCountCfg = isJeeMain
    ? 0
    : Math.max(
        0,
        Number(config?.passageCount ?? plan?.passageCount) || 0
      );
  const perPassageCfg = isJeeMain
    ? 0
    : Math.max(
        0,
        Number(config?.questionsPerPassage ?? plan?.questionsPerPassage) || 0
      );
  const structureCfg = isJeeMain
    ? "standalone"
    : String(
        config?.questionStructure || plan?.questionStructure || "both"
      ).toLowerCase();
  const subjectStructuresCfg = isJeeMain
    ? null
    : config?.subjectStructures || plan?.subjectStructures || null;
  const isSubjectWise =
    !isJeeMain &&
    subjectStructuresCfg &&
    typeof subjectStructuresCfg === "object" &&
    Object.keys(subjectStructuresCfg).length > 0;
  const wantsPassagePacks =
    !isJeeMain &&
    typeof generatePassagePack === "function" &&
    (structureCfg === "passage" || structureCfg === "both") &&
    (passageCountCfg > 0 || isSubjectWise);

  if (isJeeMain) {
    seatQueue.forEach((s) => {
      s.seatMode = "standalone";
      s.lockedPassage = null;
      s.connectedGroup = null;
    });
  }

  const isRcishSeat = (seat) => {
    if (seat?.slot?.isPassageSlot === true || seat?.seatMode === "passage") return true;
    if (seat?.slot?.isPassageSlot === false || seat?.seatMode === "standalone") return false;

    const topicId = String(seat?.slot?.topicId || "").toUpperCase();
    const ch = String(seat?.slot?.chapter || "").toLowerCase();

    // Explicit standalone verbal ability topics (never RC passages)
    if (
      topicId === "CV03" ||
      topicId === "CV04" ||
      topicId === "CV05" ||
      /para\s*jumble|\bpj\b|para\s*summary|odd\s*sentence|para\s*completion|sentence\s*completion|error\s*spotting|fill\s*in/i.test(
        ch
      )
    ) {
      return false;
    }

    // Explicit passage / comprehension topics
    if (
      topicId === "CV01" ||
      topicId === "CV02" ||
      /reading\s*comprehension|passage|caselet/i.test(ch)
    ) {
      return true;
    }

    return /reading|comprehension|\brc\b|passage|caselet/.test(`${ch} ${topicId}`);
  };

  // Excel Connected Group packs: N seats share one passage (P1, P2, …).
  const workUnits = [];
  if (wantsPassagePacks) {
    if (isSubjectWise) {
      const packSet = new Set();
      let globalPackIdx = 1;

      // Group seat indices by normalized subject
      const indicesBySubject = new Map();
      seatQueue.forEach((s, i) => {
        const subjNorm = normalizeSubject(s.slot?.subject) || "default";
        if (!indicesBySubject.has(subjNorm)) indicesBySubject.set(subjNorm, []);
        indicesBySubject.get(subjNorm).push(i);
      });

      // For each subject with a configured structure:
      for (const [subjKey, indices] of indicesBySubject.entries()) {
        const cfg =
          Object.entries(subjectStructuresCfg).find(
            ([k]) => normalizeSubject(k) === subjKey || k === subjKey
          )?.[1] || null;

        const subStruct = String(
          cfg?.questionStructure || "standalone"
        ).toLowerCase();
        const subPassages = Math.max(0, Number(cfg?.passageCount) || 0);
        const subPer = Math.max(0, Number(cfg?.questionsPerPassage) || 0);

        if (
          (subStruct === "passage" || subStruct === "both") &&
          subPassages > 0 &&
          subPer > 0
        ) {
          const rcIndices = indices.filter((idx) => isRcishSeat(seatQueue[idx]));
          const otherIndices = indices.filter((idx) => !isRcishSeat(seatQueue[idx]));
          const orderedIndices =
            rcIndices.length > 0 ? [...rcIndices, ...otherIndices] : indices;

          for (let p = 0; p < subPassages; p += 1) {
            const chunk = orderedIndices.slice(p * subPer, (p + 1) * subPer);
            if (chunk.length < subPer) break;
            chunk.forEach((idx) => packSet.add(idx));
            workUnits.push({
              kind: "pack",
              packId: `P${globalPackIdx}`,
              seats: chunk.map((i) => seatQueue[i]),
              seatIndexes: chunk,
            });
            globalPackIdx += 1;
          }
        }
      }

      // Any unpacked seat becomes single (standalone)
      seatQueue.forEach((seat, i) => {
        if (packSet.has(i)) return;
        workUnits.push({ kind: "single", seat, seatIndex: i });
      });

      pipelineLog?.("PASSAGE_PACK_PLAN", {
        mode: "subject_wise",
        packs: workUnits.filter((u) => u.kind === "pack").length,
        standalones: workUnits.filter((u) => u.kind === "single").length,
        packIds: workUnits
          .filter((u) => u.kind === "pack")
          .map((u) => u.packId),
      });
    } else {
      const rcIdx = [];
      const otherIdx = [];
      seatQueue.forEach((s, i) => {
        if (isRcishSeat(s)) rcIdx.push(i);
        else otherIdx.push(i);
      });
      // Order passage-eligible (RC) seats first, followed by standalone seats
      const orderedIndices =
        rcIdx.length > 0 ? [...rcIdx, ...otherIdx] : seatQueue.map((_, i) => i);
      const needPackSeats = Math.min(
        passageCountCfg * perPassageCfg,
        orderedIndices.length
      );
      const packIndices = orderedIndices.slice(0, needPackSeats);
      const packSet = new Set(packIndices);
      for (let p = 0; p < passageCountCfg; p += 1) {
        const chunk = packIndices.slice(
          p * perPassageCfg,
          (p + 1) * perPassageCfg
        );
        if (chunk.length < perPassageCfg) break;
        workUnits.push({
          kind: "pack",
          packId: `P${p + 1}`,
          seats: chunk.map((i) => seatQueue[i]),
          seatIndexes: chunk,
        });
      }
      seatQueue.forEach((seat, i) => {
        if (packSet.has(i)) return;
        workUnits.push({ kind: "single", seat, seatIndex: i });
      });
      pipelineLog?.("PASSAGE_PACK_PLAN", {
        mode: "unified",
        passageCount: passageCountCfg,
        questionsPerPassage: perPassageCfg,
        packs: workUnits.filter((u) => u.kind === "pack").length,
        standalones: workUnits.filter((u) => u.kind === "single").length,
        packIds: workUnits
          .filter((u) => u.kind === "pack")
          .map((u) => u.packId),
      });
    }
  } else {
    seatQueue.forEach((seat, i) => {
      workUnits.push({ kind: "single", seat, seatIndex: i });
    });
  }

  onProgress?.({
    phase: "generate",
    message: wantsPassagePacks
      ? `Gemini generate · ${passageCountCfg} passage pack(s)×${perPassageCfg} + standalones (then o3)`
      : `Parallel Gemini generate ×${seatQueue.length} (then o3 solve+solution)`,
    plan,
  });

  let working = [];
  let preVerified = [];
  let unusedCursor = 0;
  const o3CtxEarly = {
    pipelineLog,
    recordUsage,
    jobId,
    examType: config?.examType,
    examLabel: config?.examLabel,
    checkpointItem,
  };

  const generateOne = async (seat, seqNum, attempt, excludeTexts) => {
    const item = makeItem(seat.type, seat.slot, seqNum, attempt);
    return runQuestionContext(item, async () => {
      const prior = getProviderFatalAbort(jobId);
      if (prior?.error) {
        throw prior.error;
      }
      const jobStatus = String(getGenerationJob(jobId)?.status || "").toLowerCase();
      if (jobStatus === "failed" || jobStatus === "cancelled") {
        throw (
          prior?.error ||
          providerCreditsError(new Error(`job_${jobStatus || "aborted"}`), "gemini")
        );
      }
      pipelineLog("QUESTION_START", {
        seq: seqNum,
        type: seat.type,
        topicId: item.topicId,
        attempt,
        phase: "gemini_then_o3",
        jobId,
        seatMode: seat.seatMode || (seat.lockedPassage ? "passage_followup" : "standalone"),
        connectedGroup: seat.connectedGroup || null,
      });
      item.stage = "generating";
      await checkpointItem(item);
      let generated = null;
      try {
        generated = await withInfraRetries(
          async () => {
            if (getProviderFatalAbort(jobId)?.error) {
              throw getProviderFatalAbort(jobId).error;
            }
            const part = await generateBatch({
              type: seat.type,
              count: 1,
              slots: [seat.slot],
              subject: item.subject,
              excludeTexts,
              examType: config?.examType,
              examLabel: config?.examLabel,
              questionStructure: config?.questionStructure || "both",
              passageCount: config?.passageCount || 0,
              questionsPerPassage: config?.questionsPerPassage || 0,
              passageBasedQuestions: config?.passageBasedQuestions || 0,
              standaloneQuestions: config?.standaloneQuestions || 0,
              seatMode:
                seat.seatMode ||
                (seat.lockedPassage ? "passage_followup" : "standalone"),
              lockedPassage: seat.lockedPassage || "",
              connectedGroup: seat.connectedGroup || "",
            });
            const q = part[0] || null;
            if (q) {
              q._examType = config?.examType;
              q._examLabel = config?.examLabel;
              q._topicId = q._topicId || seat.slot?.topicId || item.topicId;
              q.topicId = q.topicId || seat.slot?.topicId || item.topicId;
              q.subject = q.subject || item.subject || seat.slot?.subject;
              if (isJeeMain) {
                delete q.passage;
                delete q.passageText;
                delete q.paragraph;
                delete q._connectedGroup;
              } else if (seat.lockedPassage && !q.passage) {
                q.passage = seat.lockedPassage;
                q.passageText = seat.lockedPassage;
                q._connectedGroup = seat.connectedGroup || q._connectedGroup;
              }
            }
            return q;
          },
          { label: `gemini_generate_seq_${seqNum}`, pipelineLog }
        );
      } catch (err) {
        // Prepaid / billing exhaustion: abort the whole paper job immediately
        // (do not quality-replace loop forever).
        if (isProviderCreditsExhausted(err)) {
          throw providerCreditsError(err, "gemini");
        }
        return failItem(
          item,
          isInfraError(err) ? "generate_timeout" : "generate_error",
          err?.message || String(err)
        );
      }
      if (!generated) {
        return failItem(item, "generate_empty", "no question");
      }
      item.stage = "generated";
      item.raw = generated;
      await checkpointItem(item);

      // Free schema check only (not a model / hard QC stage)
      const subjectForGate = String(
        item.subject || seat.slot?.subject || generated._subject || ""
      ).trim();
      // All competitive exams: verbal/English/RC sections must stay qualitative.
      if (
        isVerbalQualitativeSubject(subjectForGate) &&
        isMisplacedNumerical(generated.questionText)
      ) {
        return failItem(
          item,
          "verbal_numerical",
          "numerical/DI/QA-style stem not allowed in verbal/reading sections"
        );
      }
      if (isDuplicateStem(generated.questionText, excludeTexts)) {
        return failItem(item, "duplicate_stem", "near-duplicate stem");
      }
      // Catch same-subject template clones (e.g. rail+capacitor across topic codes).
      const lockedPeers = [
        ...[...keptBySeq.values()].map((it) => it.locked),
        ...working.map((it) => it.locked),
        ...preVerified.map((it) => it.locked),
      ].filter(Boolean);
      if (isNearDuplicateOfAny(generated, lockedPeers)) {
        return failItem(
          item,
          "duplicate_stem",
          "near-duplicate of an already locked question — regenerating"
        );
      }
      const schema = schemaOkForO3(
        generated,
        seat.type,
        config?.examType || generated._examType
      );
      if (!schema.ok) {
        return failItem(item, "schema_invalid", schema.issues);
      }
      item.stage = "generated_ok";
      item.locked = generated;
      appendStageQuestionLog(jobId, "after_gemini", item);
      await checkpointItem(item);
      return item;
    });
  };

  const finalizeGeneratedItem = async (seat, seqNum, attempt, generated, excludeTexts) => {
    const item = makeItem(seat.type, seat.slot, seqNum, attempt);
    item.stage = "generated";
    item.raw = generated;
    await checkpointItem(item);
    const subjectForGate = String(
      item.subject || seat.slot?.subject || generated._subject || ""
    ).trim();
    if (
      isVerbalQualitativeSubject(subjectForGate) &&
      isMisplacedNumerical(generated.questionText)
    ) {
      return failItem(
        item,
        "verbal_numerical",
        "numerical/DI/QA-style stem not allowed in verbal/reading sections"
      );
    }
    if (isDuplicateStem(generated.questionText, excludeTexts)) {
      return failItem(item, "duplicate_stem", "near-duplicate stem");
    }
    const lockedPeers = [
      ...[...keptBySeq.values()].map((it) => it.locked),
      ...working.map((it) => it.locked),
      ...preVerified.map((it) => it.locked),
    ].filter(Boolean);
    if (isNearDuplicateOfAny(generated, lockedPeers)) {
      return failItem(
        item,
        "duplicate_stem",
        "near-duplicate of an already locked question — regenerating"
      );
    }
    const schema = schemaOkForO3(
      generated,
      seat.type,
      config?.examType || generated._examType
    );
    if (!schema.ok) {
      return failItem(item, "schema_invalid", schema.issues);
    }
    item.stage = "generated_ok";
    item.locked = generated;
    appendStageQuestionLog(jobId, "after_gemini", item);
    await checkpointItem(item);
    return item;
  };

  const generatePackUnit = async (unit, seqBase, attempt, excludeTexts) => {
    pipelineLog?.("QUESTION_START", {
      seq: seqBase,
      type: "passage_pack",
      packId: unit.packId,
      count: unit.seats.length,
      attempt,
      phase: "gemini_passage_pack",
      jobId,
    });
    let generatedList = [];
    try {
      generatedList = await withInfraRetries(
        async () => {
          if (getProviderFatalAbort(jobId)?.error) {
            throw getProviderFatalAbort(jobId).error;
          }
          return generatePassagePack({
            count: unit.seats.length,
            slots: unit.seats.map((s) => s.slot),
            questionTypes: unit.seats.map((s) => s.type),
            subject: unit.seats[0]?.slot?.subject,
            excludeTexts,
            examType: config?.examType,
            examLabel: config?.examLabel,
            packId: unit.packId,
          });
        },
        { label: `gemini_passage_pack_${unit.packId}`, pipelineLog }
      );
    } catch (err) {
      if (isProviderCreditsExhausted(err)) {
        throw providerCreditsError(err, "gemini");
      }
      pipelineLog?.("PASSAGE_PACK_FALLBACK", {
        packId: unit.packId,
        error: err?.message || String(err),
      });
      generatedList = [];
    }

    const sharedPassage = String(generatedList?.[0]?.passage || "").trim();
    const out = [];
    for (let j = 0; j < unit.seats.length; j += 1) {
      const seat = unit.seats[j];
      const seqNum = seqBase + j;
      const generated = generatedList?.[j];
      if (generated?.questionText) {
        if (sharedPassage && !generated.passage) {
          generated.passage = sharedPassage;
          generated.passageText = sharedPassage;
          generated._connectedGroup = unit.packId;
        }
        generated._examType = config?.examType;
        generated._examLabel = config?.examLabel;
        out.push(
          await finalizeGeneratedItem(
            seat,
            seqNum,
            attempt,
            generated,
            excludeTexts
          )
        );
        continue;
      }
      // Missing member: regenerate against the shared passage when available.
      out.push(
        await generateOne(
          {
            ...seat,
            seatMode: sharedPassage ? "passage_followup" : "standalone",
            lockedPassage: sharedPassage,
            connectedGroup: unit.packId,
          },
          seqNum,
          attempt,
          excludeTexts
        )
      );
    }
    return out;
  };

  let seqCursor = seq;
  for (const unit of workUnits) {
    if (unit.kind === "pack") {
      unit.seqBase = seqCursor;
      seqCursor += unit.seats.length;
    } else {
      unit.seqBase =
        Number(unit.seat?.retryItem?.seq) || seqCursor;
      seqCursor = Math.max(seqCursor, unit.seqBase + 1);
    }
  }

  const nestedInitial = await mapPool(
    workUnits,
    genConcurrency(),
    async (unit) => {
      if (unit.kind === "pack") {
        return generatePackUnit(unit, unit.seqBase, 1, exclude);
      }

      const seat = {
        ...unit.seat,
        seatMode: unit.seat?.seatMode || "standalone",
      };
      const seqNum = unit.seqBase;

      // Resume path: re-verify a previously failed stem once before generating a replacement.
      const retry = seat?.retryItem;
      if (retry && (retry.locked || retry.raw)) {
        const retryItem = {
          ...retry,
          seq: seqNum,
          type: seat.type,
          subject: normalizeSubject(seat.slot?.subject || retry.subject),
          topicId: seat.slot?.topicId || retry.topicId || "",
          chapter: seat.slot?.chapter || retry.chapter || "",
          conceptSlot:
            seat.slot?.conceptSlot ||
            retry.conceptSlot ||
            retry.hardArchetype ||
            "",
          stage: "generated_ok",
          locked: retry.locked || retry.raw,
          attempt: (Number(retry.attempt) || 1) + 1,
          failureReason: undefined,
          failureDetail: undefined,
        };
        pipelineLog?.("QUESTION_RESUME_REVERIFY", {
          seq: seqNum,
          topicId: retryItem.topicId,
          subject: retryItem.subject,
          priorFailure: retry.failureReason || null,
        });
        try {
          const res = await verifySeatWithO3Budget(
            retryItem,
            o3CtxEarly,
            stampTrust
          );
          if (res?.ok && res.item?.locked) {
            return [{ __preVerified: true, item: res.item }];
          }
        } catch (err) {
          if (
            isOpenAiAuthError(err) ||
            isProviderCreditsExhausted(err) ||
            err?.fatal
          ) {
            throw err;
          }
          pipelineLog?.("QUESTION_RESUME_REVERIFY_FAIL", {
            seq: seqNum,
            error: err?.message || String(err),
          });
        }
        // Re-verify failed → generate a NEW unique stem for the same subject/topic.
        exclude.push(stemSnippet(retry.locked || retry.raw));
      }

      return [
        await generateOne(
          seat,
          seqNum,
          (Number(retry?.attempt) || 0) + 1,
          exclude
        ),
      ];
    }
  );
  const initial = nestedInitial.flat();
  seq = seqCursor;

  for (const item of initial) {
    if (item?.__preVerified && item.item?.locked) {
      preVerified.push(item.item);
      exclude.push(stemSnippet(item.item.locked));
      continue;
    }
    if (
      item?.locked &&
      (item.stage === "generated_ok" || item.stage === "generated")
    ) {
      working.push(item);
      exclude.push(stemSnippet(item.locked));
    } else if (item && !item.__preVerified) {
      failures.push(item);
    }
  }

  // Soft fill for schema/dup fails only — capped by quality replace budget later shared pool
  const schemaFillMax = Math.min(
    needSeats,
    Number(
      process.env.PAPER_SCHEMA_REPLACE_MAX ??
        process.env.JEE_ADV_SCHEMA_REPLACE_MAX ??
        needSeats
    ) || needSeats
  );
  let schemaFills = 0;
  while (
    working.length + preVerified.length < needSeats &&
    schemaFills < schemaFillMax
  ) {
    schemaFills += 1;
    let seat;
    if (unusedPool.length > 0 && unusedCursor < unusedPool.length) {
      seat = { ...unusedPool[unusedCursor++], seatMode: "standalone" };
    } else if (unusedPool.length > 0) {
      seat = {
        ...unusedPool[(unusedCursor++) % unusedPool.length],
        seatMode: "standalone",
      };
    } else if (seats.length > 0) {
      seat = {
        ...seats[schemaFills % seats.length],
        seatMode: "standalone",
      };
    } else {
      break;
    }
    const item = await generateOne(seat, seq++, schemaFills + 1, exclude);
    if (item?.locked && item.stage === "generated_ok") {
      working.push(item);
      exclude.push(stemSnippet(item.locked));
    } else {
      failures.push(item);
    }
  }

  onProgress?.({
    phase: "o3_verify",
    message: `Parallel o3 solve+verify+solution ×${working.length}`,
    questions: dedupePaperQuestionsByStem(
      [...preVerified, ...working].map((it) => toUiQuestion(it.locked, config))
    ),
    items: [...keptBySeq.values(), ...preVerified, ...working, ...failures],
    failures,
  });

  const replaceBudget = qualityReplaceMax(needSeats);
  const o3Ctx = { ...ctx, checkpointItem, pipelineLog };
  const o3Results = await mapPool(working, o3Concurrency(), async (item) => {
    try {
      return await verifySeatWithO3Budget(item, o3Ctx, stampTrust);
    } catch (err) {
      if (isOpenAiAuthError(err) || isProviderCreditsExhausted(err) || err?.fatal) {
        throw err;
      }
      return {
        ok: false,
        item,
        kind: isInfraError(err) ? "infra" : "quality",
        detail: err?.message || String(err),
      };
    }
  });

  working = [...preVerified];
  const pendingSeats = [];
  for (const res of o3Results) {
    if (res?.ok && res.item?.locked) {
      working.push(res.item);
      continue;
    }
    const kind = res?.kind || "quality";
    const reason =
      kind === "infra"
        ? "o3_infra_exhausted"
        : kind === "uncertain"
          ? "o3_uncertain_exhausted"
          : "o3_fail";
    failures.push(await failItem(res.item, reason, res.detail || res.item?.o3));
    if (res?.item) {
      const failedPassage = String(
        res.item.locked?.passage || res.item.raw?.passage || ""
      ).trim();
      pendingSeats.push({
        type: res.item.type,
        slot: {
          subject: res.item.subject,
          topicId: res.item.topicId,
          chapter: res.item.chapter,
          conceptSlot: res.item.conceptSlot,
        },
        lockedPassage: failedPassage,
        connectedGroup:
          res.item.locked?._connectedGroup || res.item.raw?._connectedGroup || "",
        seatMode: failedPassage ? "passage_followup" : "standalone",
        failedCount: 1,
      });
    }
  }

  // Parallel Gemini can land same-template clones with different topic codes.
  // Drop extras now and requeue seats so the replace loop fills unique slots.
  {
    const uniqueLocked = dedupePaperQuestionsByStem(
      working.map((it) => it.locked).filter(Boolean)
    );
    const keepLocked = new Set(uniqueLocked);
    const pruned = [];
    for (const it of working) {
      if (it?.locked && keepLocked.has(it.locked)) {
        pruned.push(it);
        continue;
      }
      failures.push(
        await failItem(
          it,
          "duplicate_stem",
          "near-duplicate collapsed after verify — regenerating unique replacement"
        )
      );
      const failedPassage = String(
        it.locked?.passage || it.raw?.passage || ""
      ).trim();
      pendingSeats.push({
        type: it.type,
        slot: {
          subject: it.subject,
          topicId: it.topicId,
          chapter: it.chapter,
          conceptSlot: it.conceptSlot,
        },
        lockedPassage: failedPassage,
        connectedGroup:
          it.locked?._connectedGroup || it.raw?._connectedGroup || "",
        seatMode: failedPassage ? "passage_followup" : "standalone",
        failedCount: 1,
      });
      exclude.push(stemSnippet(it.locked || it.raw));
    }
    if (pruned.length < working.length) {
      pipelineLog?.("NEAR_DUPE_PRUNE", {
        before: working.length,
        after: pruned.length,
        requeued: working.length - pruned.length,
      });
    }
    working = pruned;
  }

  let qualityReplacesUsed = 0;
  let replaceAttempts = 0;
  const maxReplaceAttempts = Math.max(replaceBudget * 3, expectedTotal * 3, 100);

  const getUniqueCount = () =>
    dedupePaperQuestionsByStem(
      [...keptBySeq.values(), ...working].map((it) => it.locked).filter(Boolean)
    ).length;

  const isCancelled = () => {
    if (getProviderFatalAbort(jobId)?.error) return true;
    if (!jobId) return false;
    const j = getGenerationJob(jobId);
    const status = String(j?.status || "").toLowerCase();
    return status === "cancelled" || status === "failed" || status === "paused";
  };

  while (
    !isCancelled() &&
    getUniqueCount() < expectedTotal &&
    replaceAttempts < maxReplaceAttempts
  ) {
    replaceAttempts += 1;
    let seatEntry = pendingSeats.shift();
    let seat;
    if (seatEntry) {
      // If this specific topic slot has failed repeatedly (>= 3 times), swap with an alternate unused slot in same subject if available
      if (seatEntry.failedCount >= 3) {
        const altIndex = unusedPool.findIndex(
          (u) =>
            u.type === seatEntry.type &&
            normalizeSubject(u.slot.subject) ===
              normalizeSubject(seatEntry.slot.subject)
        );
        if (altIndex >= 0) {
          const [alt] = unusedPool.splice(altIndex, 1);
          seat = {
            ...alt,
            lockedPassage: seatEntry.lockedPassage || "",
            connectedGroup: seatEntry.connectedGroup || "",
            seatMode: seatEntry.seatMode || "standalone",
          };
          pipelineLog?.("TOPIC_FALLBACK_SWAP", {
            seq,
            fromTopic: seatEntry.slot.topicId,
            toTopic: alt.slot.topicId,
            failedCount: seatEntry.failedCount,
          });
        } else {
          seat = {
            type: seatEntry.type,
            slot: seatEntry.slot,
            lockedPassage: seatEntry.lockedPassage || "",
            connectedGroup: seatEntry.connectedGroup || "",
            seatMode: seatEntry.seatMode || "standalone",
          };
        }
      } else {
        seat = {
          type: seatEntry.type,
          slot: seatEntry.slot,
          lockedPassage: seatEntry.lockedPassage || "",
          connectedGroup: seatEntry.connectedGroup || "",
          seatMode: seatEntry.seatMode || "standalone",
        };
      }
    } else if (unusedPool.length > 0 && unusedCursor < unusedPool.length) {
      seat = { ...unusedPool[unusedCursor++], seatMode: "standalone" };
    } else if (unusedPool.length > 0) {
      seat = {
        ...unusedPool[(unusedCursor++) % unusedPool.length],
        seatMode: "standalone",
      };
    } else if (seats.length > 0) {
      seat = {
        ...seats[replaceAttempts % seats.length],
        seatMode: "standalone",
      };
    } else {
      break;
    }

    const currentCount = getUniqueCount();
    pipelineLog?.("QUALITY_REPLACE", {
      used: qualityReplacesUsed,
      budget: replaceBudget,
      working: currentCount,
      needSeats: expectedTotal,
      attempt: replaceAttempts,
      pendingCount: pendingSeats.length,
    });
    onProgress?.({
      phase: "o3_repair",
      message: `Quality replace attempt ${replaceAttempts} — ${currentCount}/${expectedTotal}`,
    });

    let item = await generateOne(
      seat,
      seq++,
      (seatEntry?.failedCount || 0) + 1,
      exclude
    );
    if (!(item?.locked && item.stage === "generated_ok")) {
      failures.push(item);
      pendingSeats.push({
        type: seat.type,
        slot: seat.slot,
        lockedPassage: seat.lockedPassage || "",
        connectedGroup: seat.connectedGroup || "",
        seatMode: seat.seatMode || "standalone",
        failedCount: (seatEntry?.failedCount || 0) + 1,
      });
      continue;
    }

    const res = await verifySeatWithO3Budget(item, o3Ctx, stampTrust);
    if (res.ok && res.item?.locked) {
      working.push(res.item);
      exclude.push(String(res.item.locked.questionText || "").slice(0, 180));
      qualityReplacesUsed += 1;
    } else {
      const kind = res?.kind || "quality";
      failures.push(
        await failItem(
          res.item,
          kind === "infra"
            ? "o3_infra_exhausted"
            : kind === "uncertain"
              ? "o3_uncertain_exhausted"
              : "o3_fail",
          res.detail || res.item?.o3
        )
      );
      // Never regenerate the same failed stem on the next replace attempt.
      exclude.push(stemSnippet(res.item?.locked || res.item?.raw || item.locked));
      const keepPassage = String(
        seat.lockedPassage ||
          res.item?.locked?.passage ||
          res.item?.raw?.passage ||
          ""
      ).trim();
      // Requeue slot back into pendingSeats so it will be retried with a NEW stem
      pendingSeats.push({
        type: seat.type,
        slot: seat.slot,
        lockedPassage: keepPassage,
        connectedGroup:
          seat.connectedGroup ||
          res.item?.locked?._connectedGroup ||
          res.item?.raw?._connectedGroup ||
          "",
        seatMode: keepPassage ? "passage_followup" : "standalone",
        failedCount: (seatEntry?.failedCount || 0) + 1,
      });
      if (kind !== "infra") {
        qualityReplacesUsed += 1;
      }
    }
  }

  const finalItems = [...keptBySeq.values(), ...working];
  const allLocked = finalItems
    .map((it) => it.locked)
    .filter(Boolean);
  const uniqueFinal = dedupePaperQuestionsByStem(allLocked).slice(0, expectedTotal);

  const byType = { single: [], multiple: [], integer: [], match: [] };
  for (const q of uniqueFinal) {
    const t = String(q._advancedType || q.questionType || "single").toLowerCase();
    if (byType[t]) byType[t].push(q);
  }

  const counts = {
    single: byType.single.length,
    multiple: byType.multiple.length,
    integer: byType.integer.length,
    match: byType.match.length,
    total: uniqueFinal.length,
    expected: expectedTotal,
    qualityReplacesUsed,
    qualityReplaceBudget: replaceBudget,
  };

  const isFullyComplete = uniqueFinal.length >= expectedTotal;
  // When a seat was replaced successfully, the old o3_fail must not surface in
  // the UI as "Dropped / failed" — only report unresolved gaps on partial papers.
  const unresolvedFailures = isFullyComplete ? [] : failures;
  const resultItems = isFullyComplete
    ? finalItems
    : [...finalItems, ...failures];

  onProgress?.({
    phase: isFullyComplete ? "done" : "partial",
    message: isFullyComplete
      ? `Paper ready — ${uniqueFinal.length}/${expectedTotal} (Gemini→o3)`
      : `Partial — ${uniqueFinal.length}/${expectedTotal} o3-verified. Click Resume to complete.`,
    questions: uniqueFinal.map((q) => toUiQuestion(q, config)),
    items: resultItems,
    failures: unresolvedFailures,
    counts,
  });

  return {
    plan,
    questions: uniqueFinal.map((q) => toUiQuestion(q, config)),
    raw: uniqueFinal,
    items: resultItems,
    failures: unresolvedFailures,
    paperAudit: null,
    tokenUsage: deps.readTokenSummary?.(jobId)?.byModel || {},
    counts,
    completionStatus:
      uniqueFinal.length >= expectedTotal
        ? "completed"
        : uniqueFinal.length > 0
          ? "partially_completed"
          : "failed",
  };
};

export default {
  mapPool,
  o3VerifyCompact,
  schemaOkForO3,
  runParallelPaperPipeline,
};
