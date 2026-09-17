/**
 * Per-paper-job artifacts:
 *   temp/paper-jobs/{jobId}/pipeline.jsonl   — every event
 *   temp/paper-jobs/{jobId}/questions/*.json — stage snapshots
 *   temp/paper-jobs/{jobId}/tokens.json      — running token totals
 *   temp/paper-jobs/{jobId}/generated-paper.json — rolling Q+A+explanation draft
 *   MongoDB ai_paper_generation_jobs / ai_paper_generation_questions
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { AsyncLocalStorage } from "node:async_hooks";
import AiPaperGenerationJob from "../models/AiPaperGenerationJob.js";
import AiPaperGenerationQuestion from "../models/AiPaperGenerationQuestion.js";

const ROOT = join(process.cwd(), "temp", "paper-jobs");
const questionCtx = new AsyncLocalStorage();

const jobDir = (jobId) => join(ROOT, safeId(jobId));
const questionsDir = (jobId) => join(jobDir(jobId), "questions");

const safeId = (id) =>
  String(id || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 120);

const ensureDir = (dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const writeJson = (filePath, data) => {
  try {
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch {
    // non-fatal
  }
};

/** Strip AI/provider secrets before writing logs or console output. */
const SECRET_STRING_RE =
  /\b(sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._\-+=\/]{8,})\b/gi;

const SENSITIVE_KEY_RE =
  /^(authorization|api[_-]?key|x-api-key|x-goog-api-key|openai[_-]?api[_-]?key|gemini[_-]?api[_-]?key|access[_-]?token|secret|password)$/i;

const redactString = (value) =>
  String(value || "").replace(SECRET_STRING_RE, "[REDACTED]");

export const sanitizeForLog = (value, seen = new WeakSet()) => {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (value instanceof Error) {
    return sanitizeForLog(
      {
        name: value.name,
        message: value.message,
        code: value.code,
        status: value.response?.status ?? value.status,
        stack: value.stack,
      },
      seen
    );
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, seen));
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    // Axios request config often embeds Authorization headers.
    if (key === "config" || key === "request" || key === "headers") {
      out[key] = sanitizeForLog(child, seen);
      continue;
    }
    out[key] = sanitizeForLog(child, seen);
  }
  return out;
};

const appendJsonl = (filePath, row) => {
  try {
    appendFileSync(
      filePath,
      `${JSON.stringify(sanitizeForLog(row))}\n`,
      "utf8"
    );
  } catch {
    // non-fatal
  }
};

const emptyTotals = () => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  calls: 0,
});

const addUsage = (bucket, usage = {}) => {
  bucket.promptTokens += Number(usage.promptTokens) || 0;
  bucket.completionTokens += Number(usage.completionTokens) || 0;
  bucket.totalTokens += Number(usage.totalTokens) || 0;
  bucket.reasoningTokens += Number(usage.reasoningTokens) || 0;
  bucket.calls += 1;
};

const summarizeCalls = (calls = []) => {
  const byModel = {};
  const total = emptyTotals();
  for (const call of calls) {
    const key = `${call.provider || "unknown"}:${call.model || "unknown"}`;
    if (!byModel[key]) byModel[key] = emptyTotals();
    addUsage(byModel[key], call);
    addUsage(total, call);
  }
  return { byModel, total };
};

export const extractGeminiUsage = (result, { model, kind } = {}) => {
  const u =
    result?.usageMetadata ||
    result?.response?.usageMetadata ||
    result?.usage ||
    {};
  const prompt = Number(u.promptTokenCount ?? u.prompt_tokens) || 0;
  const completion =
    Number(u.candidatesTokenCount ?? u.candidates_token_count) || 0;
  const thoughts = Number(u.thoughtsTokenCount ?? u.thoughts_token_count) || 0;
  const total = Number(u.totalTokenCount ?? u.total_tokens) || prompt + completion + thoughts;
  return {
    provider: "gemini",
    model: model || "gemini",
    kind: kind || "generate",
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    reasoningTokens: thoughts,
  };
};

export const extractOpenAIUsage = (response, { model, kind } = {}) => {
  const u = response?.data?.usage || response?.usage || {};
  const details = u.completion_tokens_details || {};
  return {
    provider: "openai",
    model: model || "openai",
    kind: kind || "solver",
    promptTokens: Number(u.prompt_tokens) || 0,
    completionTokens: Number(u.completion_tokens) || 0,
    totalTokens: Number(u.total_tokens) || 0,
    reasoningTokens: Number(details.reasoning_tokens) || 0,
  };
};

export const bindPaperJob = (jobId) => {
  if (!jobId) return null;
  const dir = jobDir(jobId);
  ensureDir(dir);
  ensureDir(questionsDir(jobId));
  return dir;
};

export const paperJobLogDir = (jobId) => jobDir(jobId);

export const runQuestionContext = (meta, fn) =>
  questionCtx.run({ ...meta, calls: [] }, fn);

export const getQuestionContext = () => questionCtx.getStore() || null;

export const recordModelUsage = (jobId, usage) => {
  if (!usage) return;
  const ctx = questionCtx.getStore();
  if (ctx) ctx.calls.push(usage);

  if (!jobId) return;
  bindPaperJob(jobId);
  const file = join(jobDir(jobId), "tokens.json");
  let state = { byModel: {}, total: emptyTotals(), calls: [] };
  try {
    if (existsSync(file)) {
      state = JSON.parse(readFileSync(file, "utf8"));
    }
  } catch {
    state = { byModel: {}, total: emptyTotals(), calls: [] };
  }
  if (!state.byModel) state.byModel = {};
  if (!state.total) state.total = emptyTotals();
  if (!Array.isArray(state.calls)) state.calls = [];
  const key = `${usage.provider || "unknown"}:${usage.model || "unknown"}`;
  if (!state.byModel[key]) state.byModel[key] = emptyTotals();
  addUsage(state.byModel[key], usage);
  addUsage(state.total, usage);
  state.calls.push({ ts: new Date().toISOString(), ...usage });
  writeJson(file, state);
  return state;
};

export const readTokenSummary = (jobId) => {
  const file = join(jobDir(jobId), "tokens.json");
  try {
    if (!existsSync(file)) return { byModel: {}, total: emptyTotals(), calls: [] };
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { byModel: {}, total: emptyTotals(), calls: [] };
  }
};

export const appendPaperLog = (jobId, event, payload = {}) => {
  if (!jobId) return;
  bindPaperJob(jobId);
  const row = sanitizeForLog({
    ts: new Date().toISOString(),
    jobId,
    event,
    ...payload,
  });
  appendJsonl(join(jobDir(jobId), "pipeline.jsonl"), row);
  const line = `[paper-job ${jobId}] ${event}${
    payload.reason ? ` — ${payload.reason}` : ""
  }`;
  try {
    console.log(line, JSON.stringify(row, null, 2));
  } catch {
    console.log(line);
  }
};

export const saveQuestionSnapshot = (jobId, item = {}) => {
  if (!jobId || item.seq == null) return;
  bindPaperJob(jobId);
  const name = `${String(item.seq).padStart(2, "0")}-${item.topicId || "topic"}-${item.stage || "open"}.json`;
  writeJson(join(questionsDir(jobId), name), {
    ts: new Date().toISOString(),
    jobId,
    ...item,
    tokenTotals: summarizeCalls(item.tokenCalls || []).total,
  });
};

/** Rolling full-paper draft. Temporary until the user confirms/saves the bank. */
export const saveGeneratedPaperDraft = (jobId, questions = [], extra = {}) => {
  if (!jobId) return;
  bindPaperJob(jobId);
  writeJson(join(jobDir(jobId), "generated-paper.json"), {
    ts: new Date().toISOString(),
    jobId,
    status: extra.status || "temporary",
    count: Array.isArray(questions) ? questions.length : 0,
    questions: questions || [],
    ...extra,
  });
};

export const persistJobRecord = async (jobId, patch = {}) => {
  if (!jobId) return;
  try {
    const tokens = readTokenSummary(jobId);
    await AiPaperGenerationJob.findOneAndUpdate(
      { jobId },
      {
        $set: {
          jobId,
          logDir: jobDir(jobId),
          tokenUsage: tokens.byModel,
          tokenCalls: (tokens.calls || []).slice(-80),
          ...patch,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn("[paper-job] DB job upsert failed:", err?.message || err);
  }
};

export const persistQuestionRecord = async (jobId, item = {}) => {
  if (!jobId || item.seq == null) return;
  const tokens = summarizeCalls(item.tokenCalls || []);
  const locked = item.locked || item.raw || null;
  try {
    await AiPaperGenerationQuestion.findOneAndUpdate(
      { jobId, seq: item.seq },
      {
        $set: {
          jobId,
          seq: item.seq,
          subject: item.subject || "",
          topicId: item.topicId || "",
          chapter: item.chapter || "",
          questionType: item.type || item.questionType || "single",
          stage: item.stage || "queued",
          failureReason: item.failureReason || "",
          failureDetail: item.failureDetail || null,
          questionText: String(
            locked?.questionText || item.raw?.questionText || ""
          ),
          raw: item.raw || null,
          locked: item.locked || null,
          tokenCalls: item.tokenCalls || [],
          tokenTotals: tokens.byModel,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn("[paper-job] DB question upsert failed:", err?.message || err);
  }
};

export const loadPersistedQuestions = async (jobId) => {
  try {
    return await AiPaperGenerationQuestion.find({ jobId }).sort({ seq: 1 }).lean();
  } catch {
    return [];
  }
};

export { summarizeCalls };
