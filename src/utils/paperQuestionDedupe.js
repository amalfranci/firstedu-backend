/**
 * Stem-based dedupe for JEE Advanced paper questions.
 * Prevents mid-pipeline drafts + ready_to_confirm copies (or seat collisions)
 * from ever leaving the backend as duplicate stems.
 */

const stripDirectionPreamble = (raw) => {
  const text = String(raw || "");
  const stmtMatch = text.match(
    /((\*\*Statements:\*\*|\*\*Statements\*\*|Statements:)[\s\S]*)/i
  );
  if (stmtMatch) {
    return stmtMatch[0];
  }
  return text
    .replace(
      /^(directions?|direction\s*:|in the (following|question)[^:\n]*:?\s*)/i,
      ""
    )
    .replace(
      /^you have to take the given statements to be true[^:\n]*\n?/gi,
      ""
    )
    .trim();
};

const normalizeStem = (q) => {
  const rawText = String(q?.questionText || q?.text || q?.title || "");
  const cleaned = stripDirectionPreamble(rawText);
  const stem = cleaned
    .replace(/\$[^$]*\$/g, " ") // ignore latex noise for near-dup
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\{|\}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  let extra = "";
  if (Array.isArray(q?.options) && q.options.length > 0) {
    extra = q.options
      .map((o) =>
        String(o?.text || o || "")
          .replace(/\$[^$]*\$/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .slice(0, 40)
      )
      .join("|");
  } else if (Array.isArray(q?.listI) || Array.isArray(q?.listII)) {
    extra = [...(q.listI || []), ...(q.listII || [])].join("|");
  }

  const prefix = stem.length > 300 ? stem.slice(0, 300) : stem;
  const suffix = extra.slice(0, 100);
  return suffix ? `${prefix}##${suffix}` : prefix;
};

/**
 * Near-duplicate fingerprint helpers: topic + content tokens (numbers stripped).
 * Catches "same disc MOI template with different numbers / wording".
 */
const STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "into",
  "than",
  "then",
  "when",
  "where",
  "which",
  "while",
  "about",
  "after",
  "before",
  "under",
  "over",
  "between",
  "through",
  "during",
  "following",
  "given",
  "find",
  "located",
  "respectively",
  "correct",
  "option",
  "statement",
  "regarding",
  "based",
  "using",
  "value",
  "equal",
  "original",
  "uniform",
  "circular",
]);

const contentTokens = (q) => {
  const stem = normalizeStem(q)
    .replace(/\bcentre\b/g, "center")
    .replace(/\d+(\.\d+)?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  return [...new Set(stem)];
};

const jaccard = (a = [], b = []) => {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
};

const topicKey = (q) =>
  String(q?._topicId || q?.topicId || q?.topic || q?.chapter || "")
    .toLowerCase()
    .trim();

const subjectKey = (q) => String(q?.subject || q?._subject || "").toLowerCase().trim();

/**
 * Near-duplicate detection.
 * - Same topic: collapse at Jaccard ≥ 0.72
 * - Same subject, different/missing topic: collapse template clones (e.g. conducting
 *   rail + capacitor rewritten across M16/M17/M19) at ≥ 0.78
 * - Missing topic ids (save payload): use 0.72 so UI/save matches generation
 * - Cross-subject: only collapse at very high overlap (≥ 0.90)
 */
export const isNearDuplicate = (a, b) => {
  const score = jaccard(contentTokens(a), contentTokens(b));
  if (score < 0.72) return false;

  const topicA = topicKey(a);
  const topicB = topicKey(b);
  const subjectA = subjectKey(a);
  const subjectB = subjectKey(b);

  if (topicA && topicB && topicA === topicB) return score >= 0.72;
  if (subjectA && subjectB && subjectA === subjectB) return score >= 0.78;
  if (!topicA || !topicB) return score >= 0.72;
  return score >= 0.9;
};

/** True if `q` is a near-duplicate of any peer (excluding itself by reference). */
export const isNearDuplicateOfAny = (q, peers = []) => {
  if (!q || !Array.isArray(peers) || !peers.length) return false;
  return peers.some((other) => other && other !== q && isNearDuplicate(q, other));
};

const explanationScore = (q) => String(q?.explanation || "").length;

const trustScore = (q) => {
  let s = 0;
  if (q?._productionReady === true) s += 100;
  if (String(q?._trustBadge || "").includes("LUNA")) s += 50;
  if (String(q?._pipelineStage || q?.stage || "") === "ready_to_confirm") s += 40;
  if (q?._verifyPass === true) s += 20;
  s += Math.min(explanationScore(q), 5000) / 100;
  return s;
};

/**
 * Keep one question per stem. Prefer production-ready / Luna / longer explanation.
 * @param {object[]} questions
 * @returns {object[]}
 */
export const dedupePaperQuestionsByStem = (questions = []) => {
  if (!Array.isArray(questions) || questions.length < 2) {
    return Array.isArray(questions) ? questions.filter(Boolean) : [];
  }
  const byStem = new Map();
  const noStem = [];
  for (const q of questions) {
    if (!q) continue;
    const key = normalizeStem(q);
    if (!key) {
      noStem.push(q);
      continue;
    }
    const prev = byStem.get(key);
    if (!prev || trustScore(q) > trustScore(prev)) {
      byStem.set(key, q);
    }
  }
  // Second pass: drop near-duplicates (same topic + high token overlap).
  // Never near-dupe Connected Groups — each pack (P1/P2/…) must survive save.
  const kept = [];
  for (const q of byStem.values()) {
    if (String(q?.questionType || "").toLowerCase() === "connected") {
      kept.push(q);
      continue;
    }
    let replaced = false;
    for (let i = 0; i < kept.length; i += 1) {
      if (String(kept[i]?.questionType || "").toLowerCase() === "connected") {
        continue;
      }
      if (!isNearDuplicate(kept[i], q)) continue;
      if (trustScore(q) > trustScore(kept[i])) kept[i] = q;
      replaced = true;
      break;
    }
    if (!replaced) kept.push(q);
  }
  return [...kept, ...noStem];
};

/**
 * Pick the authoritative question list for API poll responses.
 * Never resurrect a longer temporary draft over a shorter terminal job list.
 */
export const pickAuthoritativePaperQuestions = ({
  jobQuestions = [],
  draftQuestions = [],
  draftStatus = "",
  jobStatus = "",
} = {}) => {
  const jobQs = Array.isArray(jobQuestions) ? jobQuestions.filter(Boolean) : [];
  const draftQs = Array.isArray(draftQuestions)
    ? draftQuestions.filter(Boolean)
    : [];
  const status = String(jobStatus || "").toLowerCase();
  const dStatus = String(draftStatus || "").toLowerCase();
  const terminal = ["completed", "partially_completed", "failed", "paused"].includes(
    status
  );

  let chosen;
  if (terminal) {
    // Terminal: job store wins; draft only if job empty and draft is final
    if (jobQs.length) chosen = jobQs;
    else if (
      draftQs.length &&
      (dStatus === "ready_to_confirm" ||
        dStatus === "completed" ||
        dStatus === "partially_completed")
    ) {
      chosen = draftQs;
    } else {
      chosen = jobQs;
    }
  } else {
    // Running: prefer longer list only if draft is not stale temporary overshoot
    // Prefer job when both exist and job is newer conceptually — use max of
    // unique stems after merge is unsafe; take the shorter of the two when
    // draft is temporary and longer than job (stale mid-Luna draft).
    if (!jobQs.length) chosen = draftQs;
    else if (!draftQs.length) chosen = jobQs;
    else if (dStatus === "temporary" && draftQs.length > jobQs.length) {
      chosen = jobQs;
    } else if (draftQs.length >= jobQs.length) {
      chosen = draftQs;
    } else {
      chosen = jobQs;
    }
  }

  return dedupePaperQuestionsByStem(chosen);
};

export default {
  dedupePaperQuestionsByStem,
  pickAuthoritativePaperQuestions,
  isNearDuplicate,
  isNearDuplicateOfAny,
};
