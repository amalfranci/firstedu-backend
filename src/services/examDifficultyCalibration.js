/**
 * Exam-aware difficulty calibration for AI question prompts.
 * Addresses skew toward easy textbook/chapter-test questions vs shift-paper standard.
 */

import { detectSubjectHint, resolveGenerationSubject } from "./subjectDetection.js";
import { EXAM_PAPER_IMAGE_GENERATION_BLOCK } from "./examPaperImageStyle.js";

export { detectSubjectHint };

/** @returns {'cat_varc'|'cat_dilr'|'cat_qa'|'cat_general'|null} */
export const detectCatSection = ({
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
} = {}) => {
    const hay = `${topic} ${bankName} ${sectionName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    if (!/\bcat\b|common admission test|\biim\b/i.test(hay)) return null;
    if (/\bvarc\b|verbal|reading comprehension|\brc\b/i.test(hay)) return "cat_varc";
    if (/\bdilr\b|data interpretation|logical reasoning/i.test(hay)) return "cat_dilr";
    if (/\bqa\b|quant|quantitative|apptitude|aptitude/i.test(hay)) return "cat_qa";
    return "cat_general";
};

/** @returns {'cat'|'jee_main'|'jee_advanced'|'neet'|'board'|'competitive'} */
export const detectExamProfile = ({
    bankName = "",
    topic = "",
    subject = "",
    classLevel = "",
    sectionName = "",
    categoryPaths = [],
} = {}) => {
    const haystack = `${bankName} ${topic} ${subject} ${classLevel} ${sectionName} ${(categoryPaths || []).join(" ")}`.toLowerCase();

    if (/\bcat\b|common admission test|\biim\b|\bmba\s*entrance\b/i.test(haystack)) {
        return "cat";
    }
    if (
        /\bclat\b|common law admission|\bnlu\b|\bconsortium of nlus\b/i.test(
            haystack
        )
    ) {
        return "clat";
    }
    if (/\bupsc\b|civil services prelim|\bcsat\b|\bgs paper\b/i.test(haystack)) {
        return "upsc";
    }
    if (
        /\bibps\b|\bsbi\b|\brbi\b|\bbank(?:ing)?\s*(?:po|clerk|exam|so)\b|\brrb\b|\bnabard\b|\bbank\s*probationary\b/i.test(
            haystack
        )
    ) {
        return "banking";
    }
    if (/\bjee\s*adv(?:anced)?\b|iit\s*-?\s*jee\s*adv/i.test(haystack)) {
        return "jee_advanced";
    }
    if (/\bneet\b|\baipmt\b|\bmedical\s*entrance\b/i.test(haystack)) {
        return "neet";
    }
    if (
        /\bjee\s*main\b|\bjee\s*mains\b|\bnational\s*testing\s*agency\b|\bnta\b/i.test(
            haystack
        ) ||
        (/\bjee\b/i.test(haystack) && !/\badv/i.test(haystack))
    ) {
        return "jee_main";
    }
    if (/\bcbse\b|\bicse\b|\bstate\s*board\b|\bclass\s*(?:9|10|11|12)\b/i.test(haystack)) {
        return "board";
    }
    if (
        /\bcompetitive\b|\bentrance\b|\biit\b|\bkvpy\b|\bntse\b|\bolympiad\b/i.test(
            haystack
        )
    ) {
        return "competitive";
    }
    return "competitive";
};

const normalizeDifficulty = (d) => String(d || "medium").trim().toLowerCase();

const tierBlock = (difficulty, lines) => {
    const tier = normalizeDifficulty(difficulty);
    const tierLines = lines[tier] || lines.medium || [];
    return tierLines.map((l) => `- ${l}`).join("\n");
};

const subjectFocusLine = (subjectLabel) =>
    subjectLabel
        ? `\n**Subject calibration:** Apply the standards above to **${subjectLabel}** at this exam's shift-paper level — subject-specific patterns come from the exam reference brief and topic, not static templates.`
        : `\n**Subject calibration:** Apply standards to the subject implied by the topic and category path (see exam context block).`;

const DIFFICULTY_FLOOR_PREAMBLE = (difficulty, examLabel) => {
    const tier = normalizeDifficulty(difficulty);
    return `
**DIFFICULTY MINIMUM — ${examLabel} (bank profile "${tier}"):**
Bank "${tier}" sets the **overall paper** weighting. Each question must meet **its assigned difficultyTier slot** (easy/medium/hard per ASSIGNED SLOTS) — not one uniform tier for every item.
Under-shooting any slot's tier → rewrite harder before output.`;
};

const JEE_MAIN_CALIBRATION = ({ difficulty, subjectLabel = "", batchSize = 1 }) => {
    const tier = normalizeDifficulty(difficulty);
    const multiConceptPct = tier === "easy" ? "50%" : tier === "hard" ? "90%" : "80%";

    const batchMix =
        batchSize > 3
            ? `
**Batch mix (this response has ${batchSize} standalone items) — shift-paper density:**
- **Zero** single-formula/template questions (no "maximum power when R=r", no "P=P1+P2 lens add", no "frequency when k doubles").
- At least **${Math.ceil(batchSize * 0.6)}** questions need **3+ distinct reasoning/calculation steps** (~2.5–4 min solve).
- At least **${Math.max(2, Math.ceil(batchSize * 0.3))}** questions must **link 2+ chapters/units**.
- At least **1** question with a multi-condition setup (parameters, interval, or constraints to verify).
- Spread micro-topics — no two questions testing the same one-liner trick.`
            : "";

    return `
${DIFFICULTY_FLOOR_PREAMBLE(difficulty, "JEE Main")}
**DIFFICULTY CALIBRATION — JEE Main shift-paper standard (2024–25 era, NOT coaching chapter test):**
Target **JEE Main January 2024–2025 shift-paper** rigor for the subject — national NTA entrance, not NCERT end-of-chapter or board level.

**BANNED — too easy for medium/hard (rewrite if your draft matches):**
- One-line definition or "which formula is correct?" recall.
- Single-step plug-in (one formula → answer in 30 seconds).
- Named-theorem recognition without setup (max power transfer, lens power add, SHM energy ∝ A², stretched wire → 4R, coin-toss probability, perpendicular slopes).
- "Find derivative of …" when it is a standard identity with no twist.
- Absurd distractors (e.g. 47 m/s² when others are 2–8) — all four options must tempt a partial solve.

**REQUIRED for medium/hard:**
- Stems: **2–4 sentences** of setup (values, conditions, interval, constraints) before the ask.
- At least ${multiConceptPct} of items integrate **2+ concepts** OR need **3+ reasoning steps**.
- Distractors from **incomplete** solutions — wrong branch, missed constraint, sign/unit error, stopped one step early.
- Cognitive load comparable to mid-to-late section of a real Main paper for this subject.
${subjectFocusLine(subjectLabel)}
${batchMix}

**Tier "${tier}" within JEE Main (UPSCALED — easy=medium, medium=hard, hard=extra hard):**
${tierBlock(difficulty, {
    easy: [
        "**Upscaled easy = old Main medium** — 3+ steps or 2 linked topics; ~2.5–3.5 min; shift mid-section.",
        "NOT early Section A / 2-step — that is below upscaled easy.",
    ],
    medium: [
        "**Upscaled medium = old Main hard** — late-section / Slot-2 caliber; 4+ steps; ~3.5–5 min.",
        "Multi-condition stem; planning required.",
    ],
    hard: [
        "**Upscaled hard = extra hard Main** — peak shift, Advanced-leaning fusion; ~5–7 min.",
        "Beyond typical late-section; still one definite MCQ answer.",
    ],
})}`;
};

const JEE_ADVANCED_CALIBRATION = ({ difficulty, subjectLabel = "", batchSize = 1 }) => {
    const tier = normalizeDifficulty(difficulty);
    const multiConceptPct = tier === "easy" ? "70%" : tier === "hard" ? "95%" : "85%";
    const minMultiStep =
        batchSize > 3
            ? Math.max(2, Math.ceil(batchSize * (tier === "hard" ? 0.75 : 0.6)))
            : 1;

    const batchMix =
        batchSize > 3
            ? `
**Batch mix (${batchSize} items) — real JEE Advanced paper density:**
- **Zero** questions solvable in under 90 seconds by one formula substitution.
- At least **${minMultiStep}** questions need **4+ distinct reasoning steps** (~4–7 min solve).
- At least **${Math.max(1, Math.ceil(batchSize * 0.4))}** must **link 2+ chapters** or use non-routine insight (not template recognition).
- At least **1** question must test **deep conceptual intricacy** on a favourite Advanced topic (rotation + energy, electrostatics + calculus, organic mechanism + stereochemistry, etc.).
- **No overlap with JEE Main tone** — if unchanged it could sit in a Main paper, rewrite with Advanced depth.`
            : "";

    return `
${DIFFICULTY_FLOOR_PREAMBLE(difficulty, "JEE Advanced")}
**DIFFICULTY CALIBRATION — JEE Advanced (IIT entrance, NOT JEE Main):**
Target **real JEE Advanced Paper 1/2** rigor — tests **conceptual depth and insight**, not syllabus breadth or speed.

**BANNED — too easy / Main-level (rewrite immediately):**
- Single-formula plug-in solvable in under 2 minutes.
- "Which formula is correct?" or bare theorem recall without setup.
- Questions that only need memorised formulas with no constraint analysis.
- Main-shift templates (simple max power, lens add, SHM ω=√(k/m), coin toss, perpendicular slopes).
- Stems under 2 sentences with no multi-condition setup at medium/hard.

**REQUIRED for medium/hard:**
- Stems: **3–5 sentences** with parameters, constraints, intervals, or cases before the ask.
- At least ${multiConceptPct} integrate **2+ ideas** OR need **4+ reasoning steps**.
- Distractors from **wrong branch, missed constraint, partial integration, sign/unit error** — all four must tempt a partial solve.
- Cognitive load: **mid-to-late Advanced paper** — planning and insight, not drill.
${subjectFocusLine(subjectLabel)}
${batchMix}

**Tier "${tier}" within JEE Advanced (UPSCALED):**
${tierBlock(difficulty, {
    easy: [
        "**Upscaled easy = old Advanced medium** — 4–5 steps or 2–3 linked concepts; ~4–5 min.",
        "Not Main-level or accessible Advanced one-liner.",
    ],
    medium: [
        "**Upscaled medium = old Advanced hard** — late-paper insight; 5–7 min; multi-concept fusion.",
    ],
    hard: [
        "**Upscaled hard = extra hard Advanced** — Paper 2 peak; 6+ steps; deepest IIT MCQ insight.",
    ],
})}`;
};

const NEET_CALIBRATION = ({ difficulty, subjectLabel = "", batchSize = 1 }) => {
    const batchMix =
        batchSize > 3
            ? `
**Batch mix (${batchSize} questions):**
- Cover at least 3 distinct NCERT chapters/units — no duplicate micro-topic.
- Vary stem style: direct MCQ, application, one "identify incorrect statement" at most per batch if used.`
            : "";

    return `
${DIFFICULTY_FLOOR_PREAMBLE(difficulty, "NEET UG")}
**DIFFICULTY CALIBRATION — NEET (UG) shift-paper standard:**
Target NEET UG MCQ difficulty — NCERT-rooted, NTA-style, NOT school unit test and NOT JEE Advanced.

**What to avoid:**
- Bare "What is…?" / one-line definition recall unless difficulty is easy.
- Factually wrong stems (wrong pacemaker, wrong ATP/NADPH counts, misspelled taxa).
- Marked answer that disagrees with your own explanation.
- JEE Main/Advanced depth, long derivations, or combo options with ambiguous multiple statements.
- "Match the following" with garbled option text — if used, options must be complete clear matchings.

**What to include:**
- NCERT Class 11/12 facts only; medium stems need context or 2-step reasoning.
- Plausible distractors from common student misconceptions (NCERT slips).
- Every explanation: 1–3 sentences showing why the marked option is correct per official syllabus for this exam.
${subjectFocusLine(subjectLabel)}
${batchMix}

**Tier "${normalizeDifficulty(difficulty)}" within NEET:**
${tierBlock(difficulty, {
    easy: [
        "Direct NCERT recall in context; ~45–60 second solve.",
        "Still frame as application or identification, not naked trivia.",
    ],
    medium: [
        "NCERT application or data-based; 2 clear reasoning steps; ~1.5–2 minute solve.",
        "Typical NEET shift-paper mid-section — not coaching chapter drill.",
    ],
    hard: [
        "Linked NCERT concepts or multi-statement analysis; NEET Slot-2 caliber.",
        "Must remain NCERT-accurate — if unsure of a fact, use a different chapter.",
    ],
})}`;
};

const BOARD_CALIBRATION = ({ difficulty, batchSize = 1 }) => {
    const tier = normalizeDifficulty(difficulty);
    const batchMix =
        batchSize > 3
            ? `
**Batch mix (${batchSize} questions) — board sample-paper density:**
- At least **${Math.ceil(batchSize * 0.5)}** questions need **2+ reasoning steps** or application beyond direct book lines.
- Cover **at least 3 distinct syllabus units** — no duplicate micro-topic.
- **Zero** naked one-line definition recall at medium/hard — frame as application or numerical setup.`
            : "";

    return `
${DIFFICULTY_FLOOR_PREAMBLE(difficulty, "Board exam (CBSE/ICSE)")}
**DIFFICULTY CALIBRATION — Board exam (CBSE/ICSE style):**
- Tier "${tier}" is a **minimum** — match or exceed official board sample paper rigor; never school homework ease.
- Medium/hard: **application, numerical, or case-based** stems with 2–4 sentences of setup — not only direct textbook lines.
- Distractors from common board-level slips (sign, unit, incomplete reasoning) — not joke values.
- ICSE/CBSE Class 11–12: multi-concept links acceptable; still board tone, not JEE-only depth unless topic says JEE.
${batchMix}
**Tier "${tier}" within board exams:**
${tierBlock(difficulty, {
    easy: [
        "Direct syllabus recall in short context — still board MCQ tone, not primary-school drill.",
        "~60–90 s solve with one clear idea.",
    ],
    medium: [
        "**Typical board sample-paper mid-section** — 2+ steps or applied concept; ~2–3 min solve.",
        "If it feels like an end-of-chapter exercise, add constraints or a second condition.",
    ],
    hard: [
        "Board exam hard section / case-based — linked concepts or multi-condition numerical.",
        "Never easier than medium — if borderline, add setup rather than simplify.",
    ],
})}`;
};

const CAT_VARC_CALIBRATION = ({ difficulty }) => `
**DIFFICULTY CALIBRATION — CAT VARC (NOT GMAT / school English):**
- **Reading Comprehension:** 450–750 words; inference, tone, author's view — not literal recall or grammar.
- **Para Jumbles:** logical sequencing of 4–5 sentences; CAT speed.
- **Odd Sentence Out:** coherence judgment across five sentences.
- **Para Summary:** central idea vs detail trap.
- **Forbidden:** grammar correction, vocabulary, sentence improvement, critical-reasoning definition drills without passages.

**Tier "${normalizeDifficulty(difficulty)}":**
${tierBlock(difficulty, {
    easy: ["Shorter RC or simpler VA sequencing — still CAT format, not school worksheet."],
    medium: ["Standard CAT RC — 2+ inference steps; VA items with plausible distractors."],
    hard: ["Dense RC or abstract theme; VA with close options — typical CAT Slot-2 VARC."],
})}`;

const CAT_QA_CALIBRATION = ({ difficulty }) => `
**DIFFICULTY CALIBRATION — CAT QA (NOT JEE/engineering math):**
- Aptitude math: arithmetic, ratios, percentages, TSD, logs, basic algebra/geometry — with clever traps.
- Questions reward insight and shortcuts; stems are compact but NOT single-formula plug-in.
- Avoid: JEE calculus, long derivations, NCERT chapter exercises, or multi-page numericals.

**Tier "${normalizeDifficulty(difficulty)}":**
${tierBlock(difficulty, {
    easy: ["Direct but still CAT-flavored — not Class 8 arithmetic drill."],
    medium: ["2-step setup with a logical trap; ~2 min solve — typical CAT QA."],
    hard: ["Non-obvious setup or elegant insight; CAT Slot-2 QA caliber."],
})}`;

const CAT_DILR_CALIBRATION = ({ difficulty }) => `
**DIFFICULTY CALIBRATION — CAT DILR:**
- Linked question sets from tables, charts, scheduling, or logic puzzles — 4–6 questions per set.
- Requires constraint tracking and case analysis; partial information is common.
- Avoid: standalone arithmetic with no data set; school logic puzzles.

**Tier "${normalizeDifficulty(difficulty)}":**
${tierBlock(difficulty, {
    easy: ["Small table/set with straightforward constraints."],
    medium: ["Multi-variable set; typical CAT DILR section."],
    hard: ["Dense constraint puzzle; Slot-2 DILR caliber."],
})}`;

const CAT_GENERAL_CALIBRATION = ({ difficulty, catSection }) => {
    if (catSection === "cat_varc") return CAT_VARC_CALIBRATION({ difficulty });
    if (catSection === "cat_qa") return CAT_QA_CALIBRATION({ difficulty });
    if (catSection === "cat_dilr") return CAT_DILR_CALIBRATION({ difficulty });
    return `
**DIFFICULTY CALIBRATION — CAT (Common Admission Test):**
- National MBA entrance — VARC, DILR, and QA each have distinct styles (see section if named).
- Overall: high difficulty, time pressure, insight-based — NOT school or JEE coaching chapter tests.
**Tier "${normalizeDifficulty(difficulty)}":** match real CAT section difficulty, not generic aptitude worksheets.`;
};

const COMPETITIVE_CALIBRATION = ({ difficulty, batchSize }) => `
${DIFFICULTY_FLOOR_PREAMBLE(difficulty, "Competitive entrance")}
**DIFFICULTY CALIBRATION — Competitive entrance (general):**
- Tier "${normalizeDifficulty(difficulty)}" is a **minimum** — never chapter-test or tutorial easiness at medium/hard.
- Avoid single-concept plug-in; use multi-step and linked concepts with plausible distractors.
- Medium-length stems with real traps from incomplete solutions.
${batchSize > 3 ? `- Vary demand across the ${batchSize} questions — at least ${Math.ceil(batchSize * 0.5)} need 2+ steps; no filler-easy items.` : ""}
**Tier "${normalizeDifficulty(difficulty)}":** national entrance standard, not school homework.`;

const IMAGE_JEE_CALIBRATION = ({ difficulty }) => `
**Image question difficulty (JEE Main standard):**
- The visual must be necessary; question should not be solvable without the figure.
- At medium/hard: combine visual interpretation with a second concept (e.g. read chart + apply formula).
- Avoid trivial "identify the color" or single-glance questions at medium/hard.
- Figures must match real JEE Main question papers: schematic line diagrams, accurate relative sizes/counts/angles from the stem.
**Tier "${normalizeDifficulty(difficulty)}":** match JEE Main diagram/data-interpretation questions, not primary-school worksheets.`;

const IMAGE_EXAM_PAPER_STYLE = `
**Figure style for all image questions:**
- Draw exactly like figures in exam question papers (JEE, NEET, CBSE) — schematic line diagrams on white, not child-friendly art.
- Relative relationships in questionText (taller, more, smaller, angle value, count) must be visually exact in the figure.
${EXAM_PAPER_IMAGE_GENERATION_BLOCK}`;

/**
 * @param {object} opts
 * @param {string} [opts.bankName]
 * @param {string} [opts.topic]
 * @param {string} [opts.subject]
 * @param {string} [opts.classLevel]
 * @param {string} [opts.difficulty]
 * @param {number} [opts.batchSize] - standalone question count in this generation
 * @param {'text'|'image'} [opts.mode]
 */
export const buildDifficultyCalibrationBlock = ({
    bankName = "",
    topic = "",
    subject = "",
    classLevel = "",
    difficulty = "medium",
    batchSize = 1,
    mode = "text",
    categoryPaths = [],
    sectionName = "",
    catSection = null,
} = {}) => {
    const profile = detectExamProfile({ bankName, topic, subject, classLevel, sectionName, categoryPaths });
    const resolvedCatSection =
        catSection ||
        detectCatSection({ bankName, topic, sectionName, categoryPaths });
    const subjectLabel =
        resolveGenerationSubject({
            bankName,
            topic,
            subject,
            categoryPaths,
            sectionName,
        }).label || "";

    if (mode === "image") {
        const base =
            profile === "jee_main" || profile === "jee_advanced"
                ? IMAGE_JEE_CALIBRATION({ difficulty })
                : COMPETITIVE_CALIBRATION({ difficulty, batchSize: 1 });
        return `${IMAGE_EXAM_PAPER_STYLE}\n${base}`;
    }

    switch (profile) {
        case "jee_main":
            return JEE_MAIN_CALIBRATION({ difficulty, subjectLabel, batchSize });
        case "jee_advanced":
            return JEE_ADVANCED_CALIBRATION({ difficulty, subjectLabel, batchSize });
        case "neet":
            return NEET_CALIBRATION({ difficulty, subjectLabel, batchSize });
        case "board":
            return BOARD_CALIBRATION({ difficulty, batchSize });
        case "cat":
            return CAT_GENERAL_CALIBRATION({ difficulty, catSection: resolvedCatSection });
        default:
            return COMPETITIVE_CALIBRATION({ difficulty, batchSize });
    }
};

export const getFormatOnlyExampleNote = (profile, catSection = null) => {
    if (profile === "cat") {
        if (catSection === "cat_varc") {
            return `**Example below shows JSON FORMAT only.** Actual questions must follow CAT VARC calibration and the exam reference brief — use reading passages for RC, not trivial grammar MCQs.`;
        }
        if (catSection === "cat_qa") {
            return `**Example below shows JSON FORMAT only.** Actual questions must follow CAT QA calibration — aptitude traps, NOT JEE-style engineering math or the trivial "2+2" style.`;
        }
        return `**Example below shows JSON FORMAT only.** Actual difficulty must match CAT section standards — NOT school worksheets or JEE coaching drills.`;
    }
    if (profile === "jee_main" || profile === "jee_advanced") {
        return `**Example below shows JSON FORMAT only.** Actual questions must follow the JEE difficulty calibration above — NOT the trivial "2+2" style.`;
    }
    if (profile === "neet") {
        return `**Example below shows JSON FORMAT only.** Actual questions must follow NEET NCERT calibration above — NOT trivial recall or the "2+2" style.`;
    }
    return `**Example below shows JSON FORMAT only.** Actual difficulty must match the calibration above.`;
};

export const getNeetFormatExample = () => ({
    questionType: "single",
    questionText:
        "During muscle contraction, which of the following events occurs immediately after the action potential spreads to the interior of the muscle fibre via the T-tubules?",
    options: [
        "Release of Ca²⁺ from the sarcoplasmic reticulum",
        "Binding of ATP to the myosin head only",
        "Sliding of actin filaments without cross-bridge formation",
        "Breakdown of acetylcholine at the neuromuscular junction",
    ],
    correctAnswer: "A",
    explanation:
        "T-tubule depolarisation triggers Ca²⁺ release from the sarcoplasmic reticulum, which allows cross-bridge cycling. ACh breakdown occurs at the junction, not as the immediate next step after T-tubule spread.",
});

export const getJeeMainFormatExample = () => ({
    questionType: "single",
    questionText:
        "Let f(x) = x³ + ax² + bx + c satisfy f(0) = 0, f(1) = 1, and f(-1) = -1. If the roots of f(x) = 0 are in arithmetic progression, find f(2).",
    options: ["6", "8", "10", "12"],
    correctAnswer: "C",
    explanation:
        "From f(0)=0, c=0. From f(1)=1 and f(-1)=-1, solving gives a=0, b=1, so f(x)=x³+x. Then f(2)=8+2=10.",
});
