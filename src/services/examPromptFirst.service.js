/**
 * Prompt-first question generation — builds an exam-setter prompt (CLAT-style)
 * then calls Gemini directly. Bypasses solve-first / JEE veteran blocks.
 */

import { detectExamProfile, detectCatSection } from "./examDifficultyCalibration.js";
import { getExamLabel } from "./examPromptContext.service.js";

export const GENERATION_MODES = {
    DEFAULT: "default",
    PROMPT_FIRST: "prompt_first",
    PAPER_REFERENCE: "paper_reference",
    QUESTION_RAG: "question_rag",
};

export const isPromptFirstGenerationMode = (mode) =>
    String(mode || GENERATION_MODES.DEFAULT).toLowerCase() ===
    GENERATION_MODES.PROMPT_FIRST;

export const isPaperReferenceGenerationMode = (mode) =>
    String(mode || GENERATION_MODES.DEFAULT).toLowerCase() ===
    GENERATION_MODES.PAPER_REFERENCE;

/** default + style/pattern grounding retrieved from previously confirmed questions (questionCorpusRag.service.js) */
export const isQuestionRagGenerationMode = (mode) =>
    String(mode || GENERATION_MODES.DEFAULT).toLowerCase() ===
    GENERATION_MODES.QUESTION_RAG;

/**
 * Fallback-only reference range. The passage length is DECIDED BY THE AI from the
 * exam's authentic format (see the generation prompt), not hardcoded here — these
 * values are only a last-resort hint for the older composer/prompt-first paths.
 */
export const passageWordRangeFor = (examProfile, catSection) => {
    if (examProfile === "clat") return "380–500";
    if (examProfile === "cat" && catSection === "cat_varc") return "400–650";
    if (examProfile === "upsc") return "400–550";
    if (examProfile === "jee_main" || examProfile === "jee_advanced") {
        return "120–220 (stem-style context blocks for numerical sets, not RC)";
    }
    return "300–450";
};

/** Exported so solve-first (standalone, non-passage generation) can reuse
 * the same CLAT/CAT/UPSC/NEET/JEE authoring guidance instead of duplicating
 * this text — this module's one-shot prompt was the only caller before. */
export const buildExamSpecificRules = ({
    examProfile,
    catSection,
    sectionName,
    passageCount,
}) => {
    const section = String(sectionName || "").toLowerCase();

    if (examProfile === "clat") {
        const clatSection =
            /legal/i.test(section)
                ? "Legal Reasoning"
                : /english|language/i.test(section)
                  ? "English Language"
                  : /current|affairs|gk|ga/i.test(section)
                    ? "Current Affairs & General Knowledge"
                    : /logical/i.test(section)
                      ? "Logical Reasoning"
                      : /quant|qt/i.test(section)
                        ? "Quantitative Techniques"
                        : sectionName || "CLAT section";
        return `
**CLAT UG (2020-pattern) — ${clatSection}:**
- Passage-based, comprehension-driven — NOT rote-recall or bare legal knowledge.
- Write each passage ORIGINALLY (do not copy real articles, judgments, or editorials).
- **Legal Reasoning:** state the legal principle explicitly in the passage; questions answerable from principle + facts ONLY.
- **Current Affairs:** use only facts you are confident are real and correctly dated; omit if uncertain.
- **English / LR:** argument, inference, and tone — not vocabulary-definition drills.
- **Quantitative Techniques:** short data/context setups; one definite numerical or logical answer per question.`;
    }

    if (examProfile === "cat") {
        const catLabel =
            catSection === "cat_varc"
                ? "VARC (Reading Comprehension + Verbal Ability)"
                : catSection === "cat_dilr"
                  ? "DILR (Data Interpretation & Logical Reasoning sets)"
                  : catSection === "cat_qa"
                    ? "QA (Quantitative Ability)"
                    : "CAT section";
        return `
**CAT — ${catLabel}:**
- Authentic ${catLabel} register and difficulty (moderate-to-hard, not homework).
- VARC: RC passages with inference, para-jumble logic, or critical reasoning — not grammar definitions.
- DILR: self-contained data sets or puzzles; all information needed is in the passage/set.
- QA: one definite answer; trap distractors from common calculation errors.`;
    }

    if (examProfile === "jee_main" || examProfile === "jee_advanced") {
        return `
**${getExamLabel(examProfile)}:**
- Multi-step numerical / conceptual problems; linked constraints where appropriate.
- Solve completely BEFORE writing options; correct answer must match one option verbatim.
- Four distinct options; explanation derives the marked answer only — no meta commentary.
- Indian entrance standard (NTA shift-paper caliber for assigned difficulty).`;
    }

    if (examProfile === "neet") {
        return `
**NEET UG:**
- NCERT-consistent facts and numerics; clear single best answer.
- Biology: counting/enumeration in explanation must match marked option.
- Chemistry/Physics: units consistent across all four options.`;
    }

    if (examProfile === "upsc") {
        return `
**UPSC Prelims-style:**
- Analytical, multi-layered passages; options require elimination, not guesswork.
- Factual anchors must be defensible; avoid controversial or unverifiable claims.
- Questions must require reading the passage — not general knowledge alone.`;
    }

    if (passageCount > 0) {
        return `
**Passage-based competitive section:**
- Each passage is a self-contained reading set; sub-questions answerable ONLY from the passage.
- State principles, data, or argument structure clearly before asking questions.`;
    }

    return `
**Competitive entrance standard:**
- Exam-authentic stems and distractors for the topic and section named below.
- One unambiguous correct option per single-choice item.`;
};

const buildDifficultyCalibrationBlock = (examProfile, difficulty = "medium") => {
    const isHard = String(difficulty || "").toLowerCase() === "hard";

    if (isHard) {
        // Hard-tier requests must not be diluted by "spread it out" language —
        // the HARD-TIER QUALITY GATES in the JSON appendix are the controlling
        // instruction for this batch; keep this block short and non-contradictory.
        return `
**DIFFICULTY CALIBRATION:**
This batch is HARD tier — skew the distribution toward hard, multi-step items. See the mandatory HARD-TIER QUALITY GATES below for the exact bar; do not soften it with an easy/moderate spread.`;
    }

    if (examProfile === "clat" || examProfile === "cat" || examProfile === "upsc") {
        return `
**DIFFICULTY CALIBRATION (do NOT make everything maximally hard):**
Within each passage's question set, distribute difficulty realistically:
- ~30% direct/inference-light (careful reading, one elimination step)
- ~50% moderate (connect two parts of passage, or eliminate two close distractors)
- ~20% hard (precise scope-reading, negation, or multi-step elimination)
Match a real exam gradient — not a flat "everything extreme" ceiling.`;
    }
    return `
**DIFFICULTY CALIBRATION:**
Match the requested difficulty tier with a realistic spread — include some accessible items and some challenging ones, not uniform max difficulty.`;
};

export const buildJsonOutputBlock = ({
    singleCount,
    multipleCount,
    trueFalseCount,
    passageCount,
    passageSingleCount,
    passageMultipleCount,
    passageTrueFalseCount,
    passageWordRange,
    requestedDifficulty = "medium",
    examProfile = "",
}) => {
    const passageSubPerPassage =
        passageSingleCount + passageMultipleCount + passageTrueFalseCount;
    const passageSubTotal = passageCount * passageSubPerPassage;

    const normalizedDifficulty = String(requestedDifficulty || "medium").toLowerCase();
    const isHard = normalizedDifficulty === "hard";
    const hardGateBlock = isHard
        ? `
**HARD-TIER QUALITY GATES (mandatory):**
- At least 70% of items must require 2+ reasoning steps (not single-formula substitution).
- At least 40% of items must integrate 2 concepts/chapters in one stem.
- Keep purely qualitative/definition-only items to at most 10%.
- Explanations must show the decisive derivation/check, not only the final statement.
`
        : "";
    const jeeHardGateBlock =
        isHard && (examProfile === "jee_main" || examProfile === "jee_advanced")
            ? `
**JEE HARD-SPECIFIC GATES (mandatory):**
- Do not output shortcut/proportionality-only questions as "Hard".
- For numerical/value options, compute the final value explicitly and ensure it appears verbatim in exactly one option.
- All 4 options must be pairwise distinct (no duplicates, near-duplicates, or algebraic restatements of the same value).
- Use NTA-style distractors from realistic mistakes (sign, factor, unit, frame, boundary-condition errors).
`
            : "";

    return `
**OUTPUT — RETURN ONLY A VALID JSON ARRAY (no markdown, no commentary):**

Counts required in this response:
- Standalone single: ${singleCount} | multiple: ${multipleCount} | true/false: ${trueFalseCount}
- Connected passages: ${passageCount}
- Per passage: ${passageSingleCount} single, ${passageMultipleCount} multiple, ${passageTrueFalseCount} true/false sub-questions (${passageSubTotal} passage sub-questions total)

**Passage length:** each \`passage\` field must be **${passageWordRange} words** (count substantively — not padding).
**Requested difficulty for this batch:** ${requestedDifficulty}
${hardGateBlock}${jeeHardGateBlock}

**JSON rules:**
1. questionType: "single" | "multiple" | "true_false" | "connected"
2. Standalone items: questionType, difficultyTier, questionText, options (4 for single/multiple), correctAnswer, explanation
3. connected items: title, passage, subQuestions[] — each sub-question answerable ONLY from its passage
4. single → correctAnswer is one letter "A"–"D"; multiple → array of EXACTLY 2 letters (never 3, never all 4 — exactly 2 correct and 2 wrong); true_false → "True" or "False"
5. options[] = answer text only — no "A)" prefixes
6. explanation: 2–4 sentences; why correct + why each distractor fails (for passage items)
7. Plain text in strings — no markdown, no LaTeX backslashes; valid JSON only
8. For single/multiple questions, options must be unique and non-redundant
9. Final answer consistency: explanation-derived result must match marked correctAnswer and one option exactly

Return ONLY the JSON array.`;
};

/**
 * Build the full exam-setter prompt for prompt-first generation.
 */
export const buildPromptFirstQuestionBankPrompt = ({
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
    difficulty = "medium",
    singleCount = 0,
    multipleCount = 0,
    trueFalseCount = 0,
    passageCount = 0,
    passageSingleCount = 0,
    passageMultipleCount = 0,
    passageTrueFalseCount = 0,
    excludeQuestionTexts = [],
} = {}) => {
    const examProfile = detectExamProfile({
        topic,
        bankName,
        subject,
        sectionName,
        categoryPaths,
    });
    const catSection = detectCatSection({
        topic,
        bankName,
        sectionName,
        categoryPaths,
    });
    const examLabel = getExamLabel(examProfile, catSection);
    const passageWordRange = passageWordRangeFor(examProfile, catSection);
    const selectableTotal =
        singleCount +
        multipleCount +
        trueFalseCount +
        passageCount *
            (passageSingleCount + passageMultipleCount + passageTrueFalseCount);

    const excludeBlock =
        excludeQuestionTexts.length > 0
            ? `
**ALREADY SHOWN — do not duplicate or closely paraphrase:**
${excludeQuestionTexts
    .slice(0, 40)
    .map((t, i) => `${i + 1}. ${String(t).slice(0, 200)}`)
    .join("\n")}`
            : "";

    return `ROLE: You are an expert ${examLabel} question paper setter with 15+ years of experience. You write in the exact register, difficulty curve, and structure of the real exam — not textbook homework.

TASK: Generate exam questions for the bank below as a single JSON array (see OUTPUT section).

**Topic / bank:** ${topic || bankName}
**Section:** ${sectionName || "(default)"}
**Difficulty profile:** ${difficulty}
**Target selectable questions in this response:** ${selectableTotal}

**BLUEPRINT:**
- Standalone single-answer: ${singleCount}
- Standalone multiple-correct: ${multipleCount}
- Standalone true/false: ${trueFalseCount}
- Reading passages: ${passageCount}
- Questions per passage: ${passageSingleCount} single, ${passageMultipleCount} multiple, ${passageTrueFalseCount} true/false
${buildExamSpecificRules({ examProfile, catSection, sectionName, passageCount })}
${buildDifficultyCalibrationBlock(examProfile, difficulty)}

**QUESTION CONSTRUCTION RULES:**
- Write each question as a real exam item. Do NOT invent an answer and reverse-engineer the passage to fit it.
- Exactly one correct option per single-choice item. Before finalizing, verify why each of the other three options fails.
- Distractors: plausible, same register/length as the correct answer, wrong for a specific reason.
- No "partially correct" options — answers must be unambiguous once the passage is read correctly.
- Avoid negative-stacked phrasing, ambiguous hinge words, and questions answerable without reading the passage.
- Every explanation must agree with the marked correctAnswer — no contradictory final values.
${excludeBlock}

${buildJsonOutputBlock({
    singleCount,
    multipleCount,
    trueFalseCount,
    passageCount,
    passageSingleCount,
    passageMultipleCount,
    passageTrueFalseCount,
    passageWordRange,
    requestedDifficulty: difficulty,
    examProfile,
})}`;
};
