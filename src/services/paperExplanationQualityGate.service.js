/**
 * Final automated checks after o3 + Luna prose polish.
 * Auto-fixes corrupted tails + wrong option verdicts (deterministic).
 * Hard-fails orphan stems / unresolved verdicts / broken analysis walkthroughs.
 */

import {
  alignExplanationToMarkedAnswer,
  extractOptionAnalysisBlocks,
  finalizeExplanationForPublish,
  normalizeMarkedLetters,
  stripCorruptedOptionFragments,
  stripOptionLabelPrefix,
} from "../utils/explanationAnswerAlign.js";

const hasCorruptedTail = (text = "") =>
  /(?:\s*,?\s*and\s+[A-D]\.){2,}/i.test(text) ||
  /(?:^|[\s(])nd\s+[A-D]\./i.test(text) ||
  /(Therefore,\s+the\s+correct\s+options?\s+(?:is|are)\s+[A-D][^.]*\.)\s*,?\s*and\s+[A-D]\./i.test(
    text
  );

/** Single or multi: any "Option X is correct" where X is not in the key set. */
export const hasWrongOptionVerdict = (text = "", marked = "") => {
  const ans = normalizeMarkedLetters(marked);
  if (!ans) return false;
  const keySet = new Set(ans.split(",").filter((L) => /^[A-D]$/.test(L)));
  if (!keySet.size) return false;
  const re =
    /\bOption\s+([A-D])\s+is\s+(?:therefore\s+)?(?:the\s+)?(?<!in)correct(?:\s+answer|\s+option|\s+choice)?\b/gi;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const letter = String(m[1] || "").toUpperCase();
    if (letter && !keySet.has(letter)) return true;
  }
  return false;
};

const hasDuplicateCloser = (text = "") => {
  const matches =
    String(text || "").match(
      /\bTherefore,\s+the\s+correct\s+options?\s+(?:is|are)\s+[A-D]/gi
    ) || [];
  return matches.length > 1;
};

/** First-mention order of "Option X" headings in the explanation. */
export const optionMentionOrder = (text = "") => {
  const order = [];
  const re = /\bOption\s+([A-D])\b/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const L = String(m[1] || "").toUpperCase();
    if (/^[A-D]$/.test(L) && !order.includes(L)) order.push(L);
  }
  return order;
};

const hasOutOfOrderOptions = (text = "") => {
  const order = optionMentionOrder(text);
  if (order.length < 2) return false;
  const expected = [...order].sort();
  return order.join("") !== expected.join("");
};

const hasDuplicateOrMissingAnalysisLetters = (text = "", optionCount = 4) => {
  const blocks = extractOptionAnalysisBlocks(text);
  if (blocks.length < 2) return null;
  const letters = blocks.map((b) => b.letter);
  const uniq = new Set(letters);
  if (uniq.size !== letters.length) return "explanation_duplicate_analysis_letter";
  if (blocks.length >= 3 && optionCount >= 3) {
    const expected = "ABCD".slice(0, Math.min(4, optionCount)).split("");
    const missing = expected.filter((L) => !uniq.has(L));
    if (blocks.length >= Math.min(4, optionCount) && missing.length) {
      return `explanation_missing_analysis_letter:${missing.join("")}`;
    }
  }
  return null;
};

const missingSubjectOrTopic = (q = {}) => {
  const subject = String(q.subject || q._subject || "").trim();
  const topic = String(q.topic || q.chapter || q._chapter || "").trim();
  const stem = String(q.questionText || q.text || "").toLowerCase();
  const looksRc =
    /passage|according to the (passage|author)|read the (following )?(passage|excerpt)/i.test(
      stem
    ) || Boolean(String(q.passage || q.passageText || "").trim());
  if (!looksRc) return false;
  if (!subject || /^general$/i.test(subject)) return true;
  if (!topic) return true;
  return false;
};

/**
 * Stem leans on "the author/passage/this strategy" but has no passage and no
 * embedded source. Catches truncated confirm exports for any exam.
 */
export const isOrphanAuthorOrPassageStem = (q = {}) => {
  const stem = String(q.questionText || q.text || "");
  const explLead = String(q.explanation || "").slice(0, 280);
  const passage = String(q.passage || q.passageText || q.paragraph || "").trim();
  if (passage.length >= 80) return false;

  const refsAuthorOrPassage =
    /\b(the author|the passage|based on the passage|according to the (author|passage)|author'?s (core |ultimate |nuanced )?(argument|critique|prescription|claim|perspective)|this strategy|this (?:argument|concept|framework|model)|soft algorithmic control|reached in the passage)\b/i.test(
      stem
    ) ||
    /\b(the author|the passage|this strategy)\b/i.test(explLead);

  if (!refsAuthorOrPassage) return false;

  const hasEmbeddedSource =
    /\b(Read the (short |following )?(passage|excerpt|text|argument)|Consider the following|Argument\s*:|Five sentences|excerpt analyzing|Passage\s*:|Passage snippet)\b/i.test(
      stem
    ) ||
    (stem.match(/["“][^"”]{200,}["”]/) &&
      true) ||
    stem.length >= 450;

  return !hasEmbeddedSource;
};

const optionMissingArticle = (opts = []) => {
  const plain = (opts || []).map((o) =>
    stripOptionLabelPrefix(typeof o === "string" ? o : o?.text || "")
  );
  const re =
    /^(financial|corporate|tech|manufacturing|municipal|national|logistics|biotech|marketing|digital|smart|decentralized|venture|traditional|film|robust|fitness|software|social|firm)\b/i;
  return plain.some((o) => re.test(o) && !/^(An?|The)\s/i.test(o));
};

/**
 * @param {object} q locked question
 * @returns {{ ok: boolean, issues: string[], cleanedExplanation?: string }}
 */
export const validateExplanationQuality = (q = {}) => {
  const issues = [];
  const marked = q.correctAnswer ?? q.answerKey;
  const raw = String(q.explanation || "").trim();

  // Flag issues on the pre-clean draft, then finalize.
  if (hasCorruptedTail(raw)) {
    issues.push("explanation_corrupted_option_tail");
  }
  if (hasWrongOptionVerdict(raw, marked)) {
    issues.push("explanation_wrong_option_verdict");
  }
  if (hasOutOfOrderOptions(raw)) {
    issues.push(
      `explanation_option_order:${optionMentionOrder(raw).join("")}`
    );
  }

  const finalized = finalizeExplanationForPublish(q);
  let explanation = String(finalized.explanation || "").trim();

  if (!explanation || explanation.length < 40) {
    issues.push("explanation_missing_or_short");
  }

  explanation = stripCorruptedOptionFragments(explanation);
  explanation = alignExplanationToMarkedAnswer(explanation, marked);
  explanation = stripCorruptedOptionFragments(explanation);

  if (hasWrongOptionVerdict(explanation, marked)) {
    issues.push("explanation_wrong_option_verdict_unresolved");
  }
  if (hasDuplicateCloser(explanation)) {
    issues.push("explanation_duplicate_closer");
    explanation = alignExplanationToMarkedAnswer(explanation, marked);
  }

  const opts = Array.isArray(q.options) ? q.options : [];
  const walkthroughIssue = hasDuplicateOrMissingAnalysisLetters(
    explanation,
    opts.length || 4
  );
  if (walkthroughIssue) issues.push(walkthroughIssue);

  if (hasOutOfOrderOptions(explanation)) {
    issues.push("explanation_option_order_unresolved");
  }
  if (
    /\b(?:Locked answer|FINAL_ANSWER|independentAnswer)\b/i.test(explanation)
  ) {
    issues.push("explanation_internal_marker");
  }
  if (missingSubjectOrTopic(q)) {
    issues.push("metadata_rc_missing_subject_or_topic");
  }
  if (isOrphanAuthorOrPassageStem({ ...q, explanation })) {
    issues.push("stem_orphan_author_or_passage");
  }
  if (opts.length && opts.length < 2) {
    issues.push("options_incomplete");
  }
  if (optionMissingArticle(opts)) {
    issues.push("options_missing_article");
  }

  const hard = issues.filter((i) =>
    /unresolved|missing_or_short|options_incomplete|internal_marker|stem_orphan|duplicate_analysis_letter|missing_analysis_letter/.test(
      i
    )
  );

  return {
    ok: hard.length === 0,
    issues,
    cleanedExplanation: explanation,
  };
};

/**
 * Apply deterministic cleanups; flag remaining hard failures so the paper
 * is not treated as fully ready without review.
 */
export const applyExplanationQualityGate = (locked = {}) => {
  const result = validateExplanationQuality(locked);
  const next = {
    ...locked,
    explanation: result.cleanedExplanation || locked.explanation,
    _qualityGateIssues: result.issues,
    _qualityGateOk: result.ok,
  };
  if (result.issues.some((i) => i.startsWith("explanation_option_order"))) {
    next._qualityGateOptionOrder = result.issues.find((i) =>
      i.startsWith("explanation_option_order")
    );
  }
  if (!result.ok) {
    next._needsReview = true;
    next._qualityGateNeedsReview = true;
    next._productionReady = false;
  }
  return { locked: next, ...result };
};

export default {
  validateExplanationQuality,
  applyExplanationQualityGate,
  optionMentionOrder,
  hasWrongOptionVerdict,
  isOrphanAuthorOrPassageStem,
};
