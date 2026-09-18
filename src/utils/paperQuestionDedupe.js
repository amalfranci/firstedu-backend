/**
 * Stem-based dedupe for JEE Advanced paper questions.
 * Prevents mid-pipeline drafts + ready_to_confirm copies (or seat collisions)
 * from ever leaving the backend as duplicate stems.
 */

const normalizeStem = (q) =>
  String(q?.questionText || q?.text || q?.title || "")
    .replace(/\$[^$]*\$/g, " ") // ignore latex noise for near-dup
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\{|\}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 280);

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
  return [...byStem.values(), ...noStem];
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
  const terminal = ["completed", "partially_completed", "failed"].includes(
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
};
