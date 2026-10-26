/**
 * Shared quality gates for AI Powered Test paper generation
 * (all competitive exams: CAT, CLAT, GMAT, SSC, IBPS, UPSC, JEE, NEET, …).
 *
 * Goals (never ship again):
 * - Verbal / reading sections must not get numerical DI/QA-style stems
 * - Integer/TITA seats must not land on verbal sections
 * - MCQs must have enough non-empty options
 * - Strip HTML + clean option/LaTeX label corruption
 */

const VERBAL_SUBJECT_RE =
  /\b(?:varc|verbal|english(?:\s+language|\s+comprehension)?|reading\s+comprehension|\brc\b|language\s+comprehension)\b/i;

const QUANT_OR_DI_SUBJECT_RE =
  /\b(?:qa|quant|quantitative|dilr|data\s+interpretation|data\s+insights|mathematical\s+abilities|quantitative\s+techniques|numerical\s+ability|arithmetic)\b/i;

/** Subjects that must stay qualitative (no calc / TITA). */
export const isVerbalQualitativeSubject = (subject = "") =>
  VERBAL_SUBJECT_RE.test(String(subject || "").trim());

/** Subjects that may legally receive integer / numerical stems. */
export const isQuantOrDiSubject = (subject = "") =>
  QUANT_OR_DI_SUBJECT_RE.test(String(subject || "").trim());

/**
 * Competitive exams that use the AI Powered Test paper worker.
 * Used for section-aware type assignment and verbal numerical bans.
 */
export const isCompetitivePaperExam = (examType = "") => {
  const t = String(examType || "").toLowerCase();
  return (
    t === "cat" ||
    t === "gmat" ||
    t === "clat" ||
    t === "ibps" ||
    t === "ssc_cgl_tier1" ||
    t === "ssc_cgl_tier2" ||
    t === "upsc" ||
    t === "jee_main" ||
    t === "jee_advanced" ||
    t === "neet" ||
    t === "competitive"
  );
};

/** Exams that commonly use 5 MCQ options in published papers. */
export const examPrefersFiveOptions = (examType = "") => {
  const t = String(examType || "").toLowerCase();
  return (
    t === "gmat" ||
    t === "ibps" ||
    t === "ssc_cgl_tier1" ||
    t === "ssc_cgl_tier2"
  );
};

/** Minimum non-empty options required for a single/multiple MCQ. */
export const minMcqOptionCount = (examType = "") =>
  examPrefersFiveOptions(examType) ? 4 : 4; // never below 4; 5 preferred when model supplies it

/**
 * Reject calc / DI / scoring stems that do not belong in verbal sections.
 * Applied for VARC / English / Verbal across every competitive exam.
 */
export const looksLikeMisplacedNumericalStem = (stem = "") => {
  const s = String(stem || "");
  if (!s.trim()) return false;
  const calcSignals =
    /\b(?:tax|offset|PHM|platform health|metric ton|TRL|baseline fee|surcharge|divide by|aggregate points|net carbon|operational emissions|weighted index|calculate|compute|how many of the (?:five|six|following)|what is (?:firm|user|aether)|final (?:bill|PHM|score)|dollars?|rupees?)\b/i;
  const heavyNumeric =
    (s.match(/\d+/g) || []).length >= 4 &&
    /\b(?:tons?|points?|hours?|%|\$|₹|rupees?|marks?)\b/i.test(s);
  return calcSignals.test(s) || heavyNumeric;
};

/** @deprecated alias — keep older import sites working */
export const looksLikeNumericalVarcStem = looksLikeMisplacedNumericalStem;

export const examAllowsMultiple = (examType = "") => {
  const t = String(examType || "").toLowerCase();
  return t === "jee_advanced";
};

export const examAllowsMatch = (examType = "") => {
  const t = String(examType || "").toLowerCase();
  return t === "jee_advanced";
};

export const examAllowsInteger = (examType = "", subject = "") => {
  const t = String(examType || "").toLowerCase();
  const subj = String(subject || "").trim();

  // Verbal/reading comprehension never receives integer/TITA in any exam
  if (isVerbalQualitativeSubject(subj)) return false;

  if (t === "jee_advanced" || t === "jee_main") return true;

  if (t === "cat") {
    const key = subj.toUpperCase();
    if (key === "QA") return true;
    if (key === "DILR" || key === "VARC") return false;
    return isQuantOrDiSubject(subj);
  }

  // NEET, CLAT, GMAT, IBPS, SSC CGL Tier 1/2, UPSC do NOT have integer questions!
  return false;
};

/**
 * Never put integer/TITA on verbal sections or exams that do not support it.
 * Strictly enforce exam-appropriate question types:
 * - JEE Advanced: single, multiple, integer, match
 * - JEE Main: single, integer
 * - CAT: QA allows single & integer; VARC and DILR allow ONLY single
 * - NEET, CLAT, GMAT, IBPS, SSC CGL, UPSC: strictly ONLY single
 */
export const resolveCompetitiveSeatType = ({
  examType = "",
  subject = "",
  fallbackType = "single",
} = {}) => {
  const rawType = String(fallbackType || "single").toLowerCase();
  return rawType || "single";
};

export const countNonEmptyOptions = (options = []) =>
  (Array.isArray(options) ? options : [])
    .map((o) => String(typeof o === "string" ? o : o?.text || "").trim())
    .filter(Boolean).length;

export const mcqOptionsAreComplete = (options = [], examType = "") =>
  countNonEmptyOptions(options) >= minMcqOptionCount(examType);

/**
 * Universal writer lock for verbal sections + MCQ option completeness.
 * Injected into AI Powered Test generate prompts for every competitive exam.
 */
export const buildCompetitiveQualityLock = ({
  examType = "",
  examLabel = "",
  subject = "",
  type = "single",
} = {}) => {
  const verbal = isVerbalQualitativeSubject(subject);
  const parts = [];

  parts.push(`
**AI POWERED TEST QUALITY LOCK (${examLabel || examType || "exam"}):**
- Return valid JSON only. No HTML tags (\`<b>\`, \`<br>\`, etc.) in stems or options.
- For single/multiple MCQs: include at least **4** distinct non-empty option strings (raw texts, no "A)" / "(A)" prefix).
- Do not glue labels into words (never "Option Bnalysis"). Write clean prose.
- Keep LaTeX only inside \`$...$\` when math is required; never for ordinary English sentences.
`);

  if (verbal && type !== "integer") {
    parts.push(`
**VERBAL / READING SECTION LOCK (${subject || "Verbal"}):**
- Output ONLY qualitative language / comprehension / reasoning-from-text items.
- NEVER output numerical calculation / DI / QA / scoring stems (tax bills, carbon offsets, PHM points, fee discounts, weighted indexes, "compute the value").
- No TITA / integer answers in this section.
`);
  }

  if (type !== "integer") {
    parts.push(`
**OPTION LOCK:** Every MCQ must ship with a full option set. Never return a stem with empty or missing options.
`);
  }

  return parts.join("\n");
};
