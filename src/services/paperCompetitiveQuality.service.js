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

/** Multiple Correct is allowed for all AI Powered Test exams when selected. */
export const examAllowsMultiple = (_examType = "") => true;

/** Match List removed platform-wide. */
export const examAllowsMatch = (_examType = "") => false;

/** Numerical / TITA removed platform-wide. */
export const examAllowsInteger = (_examType = "", _subject = "") => false;

/**
 * Seat type policy for AI Powered Test (all exams):
 * - Only `single` and `multiple`
 * - `integer` / `match` / unknown → remapped to `single`
 */
export const resolveCompetitiveSeatType = ({
  examType = "",
  subject = "",
  fallbackType = "single",
} = {}) => {
  void examType;
  void subject;
  const rawType = String(fallbackType || "single").toLowerCase();
  if (rawType === "multiple" || rawType === "multi") return "multiple";
  // integer, match, connected leftovers, etc. → single MCQ
  return "single";
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

  if (verbal) {
    parts.push(`
**VERBAL / READING SECTION LOCK (${subject || "Verbal"}):**
- Output ONLY qualitative language / comprehension / reasoning-from-text items.
- NEVER output numerical calculation / DI / QA / scoring stems (tax bills, carbon offsets, PHM points, fee discounts, weighted indexes, "compute the value").
- No TITA / integer / Match List items — only Single or Multiple Correct MCQs.
`);
  }

  parts.push(`
**OPTION LOCK:** Every MCQ must ship with a full option set (at least 4 options). Never return a stem with empty or missing options.
- Single Correct: exactly one correct option.
- Multiple Correct: at least two correct options.
- Never generate Numerical/TITA or Match List questions.
`);

  return parts.join("\n");
};

/**
 * Extra writer guidance from wizard questionStructure.
 * Passages are NOT counted as questions — only linked items are.
 */
export const buildQuestionStructureLock = (
  questionStructure = "both",
  {
    passageCount = 0,
    questionsPerPassage = 0,
    passageBasedQuestions = 0,
    standaloneQuestions = 0,
  } = {}
) => {
  const s = String(questionStructure || "both").toLowerCase();
  const passages = Math.max(0, Number(passageCount) || 0);
  const per = Math.max(0, Number(questionsPerPassage) || 0);
  const passageQs =
    Math.max(0, Number(passageBasedQuestions) || 0) || passages * per;
  const standaloneQs = Math.max(0, Number(standaloneQuestions) || 0);

  if (s === "passage") {
    return `
**QUESTION STRUCTURE LOCK — PASSAGE-BASED:**
- Plan: **${passages} passage(s)** × **${per} linked question(s)** each (= ${passageQs} questions).
- Prefer Reading Comprehension / shared-passage style items.
- One passage may support multiple linked questions; do not count the passage itself as a question.
- CRITICAL: Each passage set must reuse ONE shared passage across its ${per} questions (Excel Connected Group). Never one orphan passage per MCQ.
- Do not invent Numerical/TITA or Match List formats.
`;
  }
  if (s === "standalone") {
    return `
**QUESTION STRUCTURE LOCK — STANDALONE:**
- Write independent stems (no shared RC passage required).
- Do not invent Numerical/TITA or Match List formats.
`;
  }
  return `
**QUESTION STRUCTURE LOCK — MIXED:**
- Passage pack: **${passages} passage(s)** × **${per}** linked Qs (= ${passageQs} passage-based questions).
- Standalone questions: **${standaloneQs}**.
- Passages are not questions; only the linked items count toward the paper total.
- CRITICAL: Never invent one unique RC passage per question. Linked questions must share the SAME passage (Excel Connected Group style).
- Do not invent Numerical/TITA or Match List formats.
`;
};
