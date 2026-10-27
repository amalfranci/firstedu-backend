import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendPipelineEvent } from './pipelineEventStore.js';

const LOG_ROOT = path.join(process.cwd(), 'temp', 'ai-api-logs');
const SESSION_TTL_MS = Number(process.env.AI_API_LOG_SESSION_TTL_MS || 30 * 60 * 1000);
const BASE_URL = process.env.AI_API_LOG_BASE_URL || `http://localhost:${process.env.PORT || 8001}`;

/** @type {Map<string, { filePath: string; createdAt: number }>} */
const activeSessions = new Map();

const isEnabled = () => process.env.AI_API_LOG_ENABLED !== '0';

export const getAiApiLogRoot = () => LOG_ROOT;

export const isAiApiLogEnabled = isEnabled;

const logDateFolder = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getLogDir = (date = new Date()) =>
  path.join(LOG_ROOT, logDateFolder(date));

const ensureLogDir = (date = new Date()) => {
  const dir = getLogDir(date);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const topicSlug = (topic) => {
  const s = String(topic || 'unknown')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'unknown').slice(0, 140);
};

/** Timestamp prefix: HH-mm-dd-MM-yy (24h hour, minute, day, month, 2-digit year) */
export const buildLogTimestampPrefix = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${hh}-${min}-${dd}-${MM}-${yy}`;
};

/** e.g. 13-25-30-06-26-competitive-engineering-jee-physics.txt */
export const buildLogFileName = (topic, date = new Date(), duplicateIndex = 0) => {
  const prefix = buildLogTimestampPrefix(date);
  const slug = topicSlug(topic);
  const dup = duplicateIndex > 0 ? `-${duplicateIndex}` : '';
  return `${prefix}-${slug}${dup}.txt`;
};

const getTopicFromBody = (requestBody) =>
  String(requestBody?.topic || requestBody?.bankName || '').trim();

export const getWorkflowLogKey = (requestBody = {}) =>
  String(requestBody?.workflowLogKey || '').trim();

const getSessionKey = (req, topic, workflowLogKey = '') => {
  const user = String(req.user?._id || req.ip || 'anonymous');
  const wf = workflowLogKey || '_default';
  return `${user}::${topicSlug(topic)}::${wf}`;
};

const pruneExpiredSessions = () => {
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      activeSessions.delete(key);
    }
  }
};

const getValidCachedSession = (sessionKey) => {
  const cached = activeSessions.get(sessionKey);
  if (!cached || Date.now() - cached.createdAt > SESSION_TTL_MS) return null;
  return cached;
};

/**
 * Resolve (or create) the workflow log file for this user/topic/workflow key.
 * Reuses the active session whenever possible so one generation run → one txt file.
 */
const resolveLogFile = async (
  req,
  topic,
  { workflowLogKey = '', forceReplace = false } = {}
) => {
  ensureLogDir();
  pruneExpiredSessions();

  const sessionKey = getSessionKey(req, topic, workflowLogKey);
  const cached = getValidCachedSession(sessionKey);

  if (cached && !forceReplace) {
    return { filePath: cached.filePath, sessionKey, isNew: false };
  }

  if (cached && forceReplace) {
    activeSessions.delete(sessionKey);
  }

  const now = new Date();
  let duplicateIndex = 0;
  let fileName = buildLogFileName(topic, now, duplicateIndex);
  let filePath = path.join(getLogDir(now), fileName);

  while (duplicateIndex < 60) {
    try {
      await fs.promises.access(filePath);
      duplicateIndex += 1;
      fileName = buildLogFileName(topic, now, duplicateIndex);
      filePath = path.join(getLogDir(now), fileName);
    } catch {
      break;
    }
  }

  activeSessions.set(sessionKey, { filePath, createdAt: Date.now() });
  return { filePath, sessionKey, isNew: true };
};

/** Shared workflow log file for API blocks + pipeline trace (same session). */
export const getOrCreateWorkflowLogFile = async (
  req,
  topic,
  { workflowLogKey = '', forceReplace = false } = {}
) => resolveLogFile(req, topic, { workflowLogKey, forceReplace });

const pipelineStore = new AsyncLocalStorage();

export const getActiveWorkflowLogKey = () => {
    const ctx = pipelineStore.getStore();
    return String(ctx?.meta?.workflowLogKey || "").trim();
};

/** Bank empty-slot cap for the active generation run (0 = uncapped). */
export const getPipelineMaxSelectableSlots = () => {
    const ctx = pipelineStore.getStore();
    const n = Number(ctx?.meta?.maxSelectableSlots);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const pipelineMetaRows = (meta = {}) =>
  [
    ['intent', meta.intent],
    ['provider', meta.provider],
    ['difficulty', meta.difficulty],
    ['singleCount', meta.singleCount],
    ['multipleCount', meta.multipleCount],
    ['trueFalseCount', meta.trueFalseCount],
    ['passageCount', meta.passageCount],
    ['allowContinuation', meta.allowContinuation],
    ['workflowLogKey', meta.workflowLogKey],
    ['solveFirst', meta.solveFirstEnabled !== false ? 'enabled' : 'disabled'],
    ['chunkSize', meta.chunkSize],
    ['maxSelectableSlots', meta.maxSelectableSlots],
    ['questionCount', meta.questionCount],
  ]
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);

const pipelineHeader = (topic, meta = {}) =>
  [
    '',
    '='.repeat(72),
    `PIPELINE TRACE — ${topic}`,
    `Started: ${new Date().toISOString()}`,
    ...pipelineMetaRows(meta),
    '='.repeat(72),
    '',
  ].join('\n');

const pipelineIntentSection = (topic, meta = {}) => {
  const intent = String(meta.intent || 'step').toUpperCase();
  return [
    '',
    '-'.repeat(72),
    `PIPELINE ${intent} — ${topic}`,
    `Started: ${new Date().toISOString()}`,
    ...pipelineMetaRows(meta),
    '-'.repeat(72),
    '',
  ].join('\n');
};

const pipelineContinuationLine = (meta = {}) => {
  const parts = [meta.chunkLabel, meta.intent].filter(Boolean).join(' ');
  return `[${new Date().toISOString()}] CONTINUATION${parts ? ` ${parts}` : ''}\n`;
};

const pipelineFooter = (summary = {}) => {
  const lines = [
    '',
    '-'.repeat(72),
    `PIPELINE COMPLETE — ${new Date().toISOString()}`,
  ];
  for (const [k, v] of Object.entries(summary)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  lines.push('-'.repeat(72), '');
  return lines.join('\n');
};

const resolvePipelineLogFile = async (req, topic, meta = {}) => {
  const workflowLogKey = String(meta.workflowLogKey || '').trim();
  const forceReplace =
    !workflowLogKey &&
    Boolean(meta.startNewSession) &&
    !meta.allowContinuation &&
    meta.intent !== 'validate';

  return getOrCreateWorkflowLogFile(req, topic, { workflowLogKey, forceReplace });
};

/**
 * Run generation (or validation) with pipeline events appended to the workflow log txt.
 * Uses the same temp/ai-api-logs/{date}/{timestamp}-{topic}.txt file as API request/response logs.
 */
export const runWithPipelineTrace = async (req, topic, meta, fn) => {
  if (!isEnabled()) return fn();

  const resolvedTopic = String(topic || '').trim();
  if (!resolvedTopic) return fn();

  const { filePath, isNew } = await resolvePipelineLogFile(req, resolvedTopic, meta || {});
  const ctx = { filePath, topic: resolvedTopic, meta: meta || {} };

  if (meta?.allowContinuation && !isNew) {
    await fs.promises.appendFile(filePath, pipelineContinuationLine(meta), 'utf8');
  } else if (isNew) {
    await fs.promises.appendFile(filePath, pipelineHeader(resolvedTopic, meta), 'utf8');
    console.log(`[ai-api-log] pipeline trace → ${filePath}`);
  } else {
    await fs.promises.appendFile(
      filePath,
      pipelineIntentSection(resolvedTopic, meta),
      'utf8'
    );
  }

  return pipelineStore.run(ctx, async () => {
    try {
      const result = await fn();
      const footerSummary =
        result?.pipelineSummary ||
        (result?.overallScore != null
          ? {
              overallScore: result.overallScore,
              correctnessScore: result.correctnessScore,
              topicRelevanceScore: result.topicRelevanceScore,
            }
          : {});
      await fs.promises.appendFile(
        filePath,
        pipelineFooter({
          success: true,
          intent: meta?.intent,
          questionCount: result?.questions?.length,
          ...footerSummary,
        }),
        'utf8'
      );
      return result;
    } catch (err) {
      await fs.promises.appendFile(
        filePath,
        pipelineFooter({
          success: false,
          intent: meta?.intent,
          error: err?.message || String(err),
        }),
        'utf8'
      );
      throw err;
    }
  });
};

/** Append one pipeline event line to the active workflow log (no-op if tracing off). */
export const pipelineTrace = (event, details = {}) => {
  const ctx = pipelineStore.getStore();
  const ts = new Date().toISOString();
  const detailStr =
    details && Object.keys(details).length > 0
      ? ` ${JSON.stringify(details)}`
      : '';
  const line = `[${ts}] ${event}${detailStr}`;

  console.log(`[pipeline] ${event}`, details);

  const workflowLogKey = String(ctx?.meta?.workflowLogKey || '').trim();
  if (workflowLogKey) {
    appendPipelineEvent(workflowLogKey, event, details);
  }

  if (!ctx || !isEnabled()) {
    return;
  }
  void fs.promises.appendFile(ctx.filePath, `${line}\n`, 'utf8').catch((err) => {
    console.warn('[pipeline] write failed:', err?.message || err);
  });
};

export const pipelineTraceSection = (title, lines = []) => {
  pipelineTrace(`--- ${title} ---`);
  for (const line of lines) {
    pipelineTrace('  ', { line: String(line) });
  }
};

const formatLogBlock = (endpointPath, requestBody, responseBody) => {
  const url = `${BASE_URL}${endpointPath}`;
  const reqLine = JSON.stringify(requestBody ?? {});
  const resLine = JSON.stringify(responseBody ?? {}, null, 4);
  return `${url}\n\n${reqLine}\n\n${resLine}\n\n`;
};

const writeLogBlock = async (req, topic, endpointPath, requestBody, responseBody, label) => {
  if (!isEnabled()) return null;

  const resolvedTopic = topic || getTopicFromBody(requestBody);
  if (!resolvedTopic) {
    console.warn(`[ai-api-log] skipped ${label} — missing topic`);
    return null;
  }

  try {
    const workflowLogKey = getWorkflowLogKey(requestBody);
    const forceReplace =
      !workflowLogKey &&
      (label === 'infer-competitive-plan' || label === 'infer-counts');

    const { filePath, sessionKey, isNew } = await resolveLogFile(req, resolvedTopic, {
      workflowLogKey,
      forceReplace,
    });
    const block = formatLogBlock(endpointPath, requestBody, responseBody);

    if (isNew) {
      await fs.promises.writeFile(filePath, block, 'utf8');
      console.log(`[ai-api-log] started ${label} log → ${filePath}`);
    } else {
      await fs.promises.appendFile(filePath, block, 'utf8');
      activeSessions.set(sessionKey, { filePath, createdAt: Date.now() });
      console.log(`[ai-api-log] appended ${label} → ${filePath}`);
    }

    return filePath;
  } catch (err) {
    console.error(`[ai-api-log] failed to save ${label}:`, err?.message || err);
    return null;
  }
};

/**
 * Log generate-question-bank-suggestions (frontend + scripts).
 * Filename: {HH}-{mm}-{dd}-{MM}-{yy}-{topic-slug}.txt under temp/ai-api-logs/{YYYY-MM-DD}/
 */
export const logGenerateQuestionBankSuggestions = async (req, requestBody, responseBody) => {
  const intent = String(requestBody?.generateIntent || 'initial').trim();
  const label =
    intent === 'evaluation_regen'
      ? 'regenerate'
      : requestBody?.allowContinuation
        ? 'generate-more'
        : 'generate';

  return writeLogBlock(
    req,
    getTopicFromBody(requestBody),
    '/admin/ai/generate-question-bank-suggestions',
    requestBody,
    responseBody,
    label
  );
};

/**
 * Log validate-question-topic-relevance — appends to the active workflow log file.
 */
export const logValidateQuestionTopicRelevance = async (req, requestBody, responseBody) =>
  writeLogBlock(
    req,
    getTopicFromBody(requestBody),
    '/admin/ai/validate-question-topic-relevance',
    requestBody,
    responseBody,
    'validate'
  );

/**
 * Log competitive exam plan (subjects + counts) — step 1 before generation.
 */
export const logInferCompetitiveExamPlan = async (req, requestBody, responseBody) =>
  writeLogBlock(
    req,
    getTopicFromBody(requestBody),
    '/admin/ai/infer-competitive-exam-plan',
    requestBody,
    responseBody,
    'infer-competitive-plan'
  );

/**
 * Log count inference — starts a new timed workflow log file when infer runs first.
 */
export const logInferQuestionBankCounts = async (req, requestBody, responseBody) =>
  writeLogBlock(
    req,
    getTopicFromBody(requestBody),
    '/admin/ai/infer-question-bank-counts',
    requestBody,
    responseBody,
    'infer-counts'
  );

export default {
  logGenerateQuestionBankSuggestions,
  logInferQuestionBankCounts,
  logInferCompetitiveExamPlan,
  logValidateQuestionTopicRelevance,
  buildLogFileName,
  buildLogTimestampPrefix,
  topicSlug,
  getWorkflowLogKey,
  runWithPipelineTrace,
  pipelineTrace,
  pipelineTraceSection,
  getAiApiLogRoot,
  isAiApiLogEnabled,
};
