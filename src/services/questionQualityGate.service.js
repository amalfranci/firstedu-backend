/**
 * Common quality-control gates for JEE Advanced paper generation.
 * Subject-agnostic engine + hooks into questionDomainRules.
 *
 * Stages:
 *   structure → duplicate (exact/near/template) → difficulty → explanation → paper distribution
 */

import crypto from "crypto";
import { codeValidateQuestion } from "./paperCodeValidation.service.js";
import {
  normalizeSubjectName,
  DIFFICULTY_RUBRIC,
} from "./questionDomainRules.service.js";

const asText = (v) => String(v ?? "").trim();

const TYPE_MIN_EXPLANATION = {
  single: 220,
  multiple: 280,
  integer: 200,
  match: 260,
};

/** Normalize stem for exact-duplicate hashing. */
export const normalizeStemForHash = (stem) =>
  asText(stem)
    .toLowerCase()
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/^[a-d][).:\s]+/gim, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const stemHash = (stem) => {
  const norm = normalizeStemForHash(stem);
  if (!norm) return "";
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 24);
};

const significantTokens = (stem) => {
  const stop = new Set([
    "a",
    "an",
    "the",
    "of",
    "and",
    "or",
    "to",
    "in",
    "for",
    "is",
    "are",
    "be",
    "with",
    "by",
    "from",
    "that",
    "this",
    "as",
    "at",
    "on",
    "if",
    "then",
    "find",
    "which",
    "following",
    "correct",
    "option",
    "options",
  ]);
  return normalizeStemForHash(stem)
    .split(" ")
    .filter((t) => t.length > 2 && !stop.has(t));
};

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
};

const extractNumbers = (stem) =>
  (asText(stem).match(/-?\d+(?:\.\d+)?/g) || []).slice(0, 12).join(",");

export const templateIdOf = (q = {}) => {
  const raw =
    q._templateId ||
    q.templateId ||
    q._conceptSlot ||
    q.conceptSlot ||
    q.hardArchetype ||
    "";
  return asText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
};

export const conceptKeyOf = (q = {}) => {
  const raw = q._conceptSlot || q.conceptSlot || q._chapter || q.chapter || "";
  return asText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 80);
};

/**
 * Level 1–3 duplicate detection against existing paper items / stems.
 * @param {object} q - candidate question
 * @param {object[]} existing - prior locked/raw items or question objects
 */
export const validateDuplicate = (q, existing = []) => {
  const errors = [];
  const stem = q?.questionText || q?.text || q?.locked?.questionText || "";
  const hash = stemHash(stem);
  const tokens = significantTokens(stem);
  const nums = extractNumbers(stem);
  const template = templateIdOf(q);
  const concept = conceptKeyOf(q);

  for (const other of existing) {
    const oq = other?.locked || other?.raw || other;
    if (!oq) continue;
    const ostem = oq.questionText || oq.text || "";
    const ohash = stemHash(ostem);
    if (hash && ohash && hash === ohash) {
      errors.push(`EXACT_DUPLICATE:seq=${other.seq ?? "?"}`);
      break;
    }
    const otokens = significantTokens(ostem);
    const sim = jaccard(tokens, otokens);
    const onums = extractNumbers(ostem);
    if (sim >= 0.72 && (!nums || !onums || nums === onums || sim >= 0.85)) {
      errors.push(
        `NEAR_DUPLICATE:seq=${other.seq ?? "?"}jaccard=${sim.toFixed(2)}`
      );
      break;
    }
    const oTemplate = templateIdOf(oq);
    if (template && oTemplate && template === oTemplate) {
      errors.push(`TEMPLATE_DUPLICATE:${template}:seq=${other.seq ?? "?"}`);
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    meta: { hash, template, concept },
  };
};

export const validateQuestionStructure = (q, typeHint = null) => {
  const cv = codeValidateQuestion(q, typeHint);
  return {
    valid: cv.ok,
    errors: cv.issues || [],
    type: cv.type,
  };
};

/**
 * Cheap post-expand explanation check (no LLM).
 */
export const validateExplanation = (question, explanationIn) => {
  const errors = [];
  const q = question || {};
  const type = String(q._advancedType || q.questionType || "single").toLowerCase();
  const explanation = asText(explanationIn ?? q.explanation);
  const lockedKey = q.correctAnswer ?? q.finalAnswer ?? q.answerDisplay ?? null;
  const insight = asText(q._insight || q.insight);
  const steps = Array.isArray(q._solveSteps) ? q._solveSteps : [];

  if (!explanation) errors.push("EXPLANATION_EMPTY");
  if (lockedKey == null || lockedKey === "") errors.push("LOCKED_KEY_MISSING");

  const minLen = TYPE_MIN_EXPLANATION[type] || 220;
  if (explanation && explanation.length < minLen) {
    errors.push("EXPLANATION_TOO_THIN");
  }

  if (!insight && !/\binsight\b/i.test(explanation)) {
    errors.push("INSIGHT_MISSING");
  }

  if (steps.length < 2 && explanation.length < minLen + 80) {
    errors.push("SOLVE_STEPS_THIN");
  }

  if (explanation && lockedKey != null && lockedKey !== "") {
    if (!containsFinalAnswer(explanation, lockedKey, type)) {
      errors.push("EXPLANATION_KEY_MISMATCH");
    }
  }

  // Contradictory alternate keys (heuristic)
  if (
    type !== "integer" &&
    /correct option(?:\(s\))?\s*:\s*[A-D]/i.test(explanation)
  ) {
    const m = explanation.match(/correct option(?:\(s\))?\s*:\s*([A-D,\s]+)/i);
    if (m && lockedKey) {
      const claimed = m[1]
        .toUpperCase()
        .split(/[^A-D]+/)
        .filter(Boolean)
        .sort()
        .join(",");
      const want = String(lockedKey)
        .toUpperCase()
        .split(/[^A-D]+/)
        .filter(Boolean)
        .sort()
        .join(",");
      if (claimed && want && claimed !== want) {
        errors.push("EXPLANATION_CONTRADICTS_KEY");
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

export const containsFinalAnswer = (explanation, lockedKey, type = "single") => {
  const text = asText(explanation);
  if (!text || lockedKey == null || lockedKey === "") return false;
  if (type === "integer") {
    const n = Number(lockedKey);
    if (!Number.isFinite(n)) return text.includes(String(lockedKey));
    return (
      new RegExp(`(?:FINAL_ANSWER|final answer|answer)\\s*[:=]?\\s*${n}\\b`, "i").test(
        text
      ) ||
      text.includes(String(n))
    );
  }
  const letters = String(lockedKey)
    .toUpperCase()
    .split(/[^A-D]+/)
    .filter((s) => /^[A-D]$/.test(s));
  if (!letters.length) return text.includes(String(lockedKey));
  // Prefer explicit ending mention; fallback: any mention of the letter set
  const joined = letters.join("[,\\s]*");
  if (
    new RegExp(
      `(?:correct option|FINAL_ANSWER|locked key|answer)\\s*[:=(]?\\s*${joined}`,
      "i"
    ).test(text)
  ) {
    return true;
  }
  return letters.every((L) => new RegExp(`\\b${L}\\b`).test(text));
};

export const isTooShort = (explanation, questionType) => {
  const min = TYPE_MIN_EXPLANATION[String(questionType || "single").toLowerCase()] || 220;
  return asText(explanation).length < min;
};

/**
 * Interpret o3 (or verifier) JSON into PASS | FAIL | UNCERTAIN.
 *
 * Hard acceptance uses validation fields — NOT confidence alone.
 * FAIL with empty fail_reasons is remapped to UNCERTAIN (retry same seat).
 */
export const validateAnswerGate = (parsed = {}, { type, proposed, subject } = {}) => {
  const derived =
    parsed.derived_answer ??
    parsed.independentAnswer ??
    parsed.answer ??
    null;

  const mathematical_correct =
    parsed.mathematical_correct === true ||
    parsed.calculationCorrect === true;
  const scientific_correct =
    parsed.scientific_correct === true ||
    parsed.physical_correct === true ||
    parsed.chemical_correct === true ||
    mathematical_correct;
  const calculationCorrect =
    parsed.calculationCorrect === true || mathematical_correct === true;
  const proposed_key_match =
    parsed.proposed_key_match === true ||
    parsed.answerMatches === true;
  const chapter_match = parsed.chapter_match !== false;
  const concept_match = parsed.concept_match !== false;
  const difficulty_match = parsed.difficulty_match !== false;
  const ambiguity = parsed.ambiguity === true || parsed.ambiguous === true;
  const format_valid = parsed.format_valid !== false;
  const questionValid = parsed.questionValid !== false;

  const modelReasons = [
    ...(Array.isArray(parsed.fail_reasons) ? parsed.fail_reasons : []),
    ...(Array.isArray(parsed.issues) ? parsed.issues : []),
  ]
    .map((r) => String(r || "").trim())
    .filter(Boolean);

  const confidence =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : String(parsed.confidence || "").toLowerCase() === "high"
        ? 0.9
        : String(parsed.confidence || "").toLowerCase() === "low"
          ? 0.4
          : String(parsed.confidence || "").toLowerCase() === "medium"
            ? 0.65
            : 0.7;

  let verdict = String(parsed.verdict || "")
    .trim()
    .toUpperCase();
  if (verdict === "UNKNOWN") verdict = "UNCERTAIN";

  // Inconsistent model output: FAIL without reasons → cannot hard-drop
  if (verdict === "FAIL" && modelReasons.length === 0) {
    verdict = "UNCERTAIN";
  }

  const hardFailReasons = [];
  if (!proposed_key_match) hardFailReasons.push("proposed_key_mismatch");
  if (!calculationCorrect && !scientific_correct) {
    hardFailReasons.push("calculation_or_domain_incorrect");
  }
  if (!questionValid) hardFailReasons.push("question_invalid");
  if (ambiguity) hardFailReasons.push("ambiguous");
  if (!format_valid) hardFailReasons.push("format_invalid");
  if (parsed.chapter_match === false) hardFailReasons.push("chapter_mismatch");
  if (parsed.concept_match === false) hardFailReasons.push("concept_mismatch");
  if (parsed.difficulty_match === false) hardFailReasons.push("difficulty_mismatch");

  const fail_reasons = [...new Set([...hardFailReasons, ...modelReasons])];

  /** Explicit PASS + hard gates → accept (confidence is supporting only). */
  const hardPass =
    (verdict === "PASS" || verdict === "") &&
    proposed_key_match === true &&
    calculationCorrect === true &&
    questionValid === true &&
    hardFailReasons.length === 0;

  let outcome = "FAIL";
  if (verdict === "UNCERTAIN") {
    outcome = "UNCERTAIN";
  } else if (hardPass) {
    // Extremely low confidence with hard PASS → retry same seat (suspicious)
    if (confidence > 0 && confidence < 0.25) {
      outcome = "UNCERTAIN";
      fail_reasons.push("low_confidence_suspicious");
    } else {
      outcome = "PASS";
    }
  } else if (hardFailReasons.length > 0 && (verdict === "FAIL" || modelReasons.length > 0)) {
    outcome = "FAIL";
  } else if (!hardPass && fail_reasons.length === 0) {
    outcome = "UNCERTAIN";
  } else if (!hardPass) {
    outcome = "FAIL";
  }

  const pass = outcome === "PASS";
  const uncertain = outcome === "UNCERTAIN";

  return {
    pass,
    uncertain,
    infra: false,
    outcome,
    result: {
      verdict: outcome,
      mathematical_correct,
      scientific_correct,
      physical_correct: parsed.physical_correct === true,
      proposed_key_match,
      chapter_match,
      concept_match,
      difficulty_match,
      ambiguity,
      format_valid,
      derived_answer: derived,
      proposedKey: proposed,
      fail_reasons,
      confidence,
      issues: fail_reasons,
      subject: normalizeSubjectName(subject) || subject || "",
      type,
      independentAnswer: derived,
      answerMatches: proposed_key_match,
      calculationCorrect,
      explanationCorrect: parsed.explanationCorrect !== false,
      questionValid,
    },
  };
};

/**
 * Paper-level distribution / template uniqueness (backend, before or after Luna).
 */
export const validatePaperDistribution = (
  items = [],
  {
    maxSameTemplate = 1,
    maxSameConcept = Number(process.env.PAPER_MAX_SAME_CONCEPT || 2),
    expectedTotal = null,
    requiredTypeCounts = null,
  } = {}
) => {
  const errors = [];
  const templateCounts = new Map();
  const conceptCounts = new Map();
  const typeCounts = { single: 0, multiple: 0, integer: 0, match: 0 };

  for (const it of items) {
    const q = it?.locked || it?.raw || it;
    const t = String(it?.type || q?._advancedType || q?.questionType || "single").toLowerCase();
    if (typeCounts[t] != null) typeCounts[t] += 1;
    const template = templateIdOf(q);
    const concept = conceptKeyOf(q);
    if (template) {
      templateCounts.set(template, (templateCounts.get(template) || 0) + 1);
    }
    if (concept) {
      conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
    }
  }

  for (const [tpl, n] of templateCounts) {
    if (n > maxSameTemplate) {
      errors.push(`TEMPLATE_OVERUSE:${tpl}×${n}`);
    }
  }
  for (const [c, n] of conceptCounts) {
    if (n > maxSameConcept) {
      errors.push(`CONCEPT_OVERUSE:${c}×${n}`);
    }
  }

  if (expectedTotal != null && items.length < expectedTotal) {
    errors.push(`SHORT_PAPER:${items.length}/${expectedTotal}`);
  }

  if (requiredTypeCounts && typeof requiredTypeCounts === "object") {
    for (const t of ["single", "multiple", "integer", "match"]) {
      const need = Number(requiredTypeCounts[t]) || 0;
      const have = typeCounts[t] || 0;
      if (need > 0 && have < need) {
        errors.push(`TYPE_SHORTFALL:${t}:${have}/${need}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    typeCounts,
    templateCounts: Object.fromEntries(templateCounts),
    conceptCounts: Object.fromEntries(conceptCounts),
  };
};

export const validateProductionReady = ({
  completedQuestions,
  totalQuestions,
  typeCounts = {},
  requiredTypeCounts = null,
  paperDistributionOk = true,
}) => {
  const countOk =
    Number(completedQuestions) === Number(totalQuestions) &&
    Number(totalQuestions) > 0;
  let typesOk = true;
  if (requiredTypeCounts) {
    for (const t of ["single", "multiple", "integer", "match"]) {
      const need = Number(requiredTypeCounts[t]) || 0;
      if (need > 0 && (Number(typeCounts[t]) || 0) < need) typesOk = false;
    }
  }
  const complete = countOk && typesOk && paperDistributionOk;
  return {
    complete,
    status: complete
      ? "completed"
      : Number(completedQuestions) > 0
        ? "partially_completed"
        : "failed",
    countOk,
    typesOk,
  };
};

export const DIFFICULTY_RUBRIC_TEXT = DIFFICULTY_RUBRIC;

export default {
  normalizeStemForHash,
  stemHash,
  templateIdOf,
  conceptKeyOf,
  validateDuplicate,
  validateQuestionStructure,
  validateExplanation,
  containsFinalAnswer,
  isTooShort,
  validateAnswerGate,
  validatePaperDistribution,
  validateProductionReady,
};
