/**
 * Dynamic exam-aware prompt blocks — no hardcoded subject lists.
 * Subject, syllabus scope, and exam style come from topic, category path,
 * detected exam profile, and the web-grounded exam reference brief.
 */

import { detectExamProfile, detectCatSection } from "./examDifficultyCalibration.js";
import { parseCategoryScope, matchSubjectInText } from "./subjectDetection.js";
import { getHardMandateFloors } from "./hardQuestionMandate.service.js";

export const EXAM_PROFILE_LABELS = {
    cat: "CAT (Common Admission Test)",
    gmat: "GMAT Focus Edition",
    clat: "CLAT UG (Common Law Admission Test)",
    ibps: "IBPS PO Prelims",
    banking: "IBPS PO Prelims",
    ssc_cgl_tier1: "SSC CGL Tier 1",
    ssc_cgl_tier2: "SSC CGL Tier 2",
    upsc: "UPSC CSE Prelims",
    jee_main: "JEE Main",
    jee_advanced: "JEE Advanced",
    neet: "NEET UG",
    board: "Board exam (CBSE/ICSE style)",
    competitive: "Competitive entrance exam",
};

const CAT_SECTION_LABELS = {
    cat_varc: "VARC",
    cat_dilr: "DILR",
    cat_qa: "QA",
};

export const getExamLabel = (examProfile, catSection = null) => {
    const base = EXAM_PROFILE_LABELS[examProfile] || EXAM_PROFILE_LABELS.competitive;
    if (examProfile === "cat" && catSection && CAT_SECTION_LABELS[catSection]) {
        return `${base} — ${CAT_SECTION_LABELS[catSection]}`;
    }
    return base;
};

/**
 * Core dynamic context injected for every exam generation call.
 * AI + exam reference brief handle subject-specific depth — not static prompt branches.
 */
export const buildExamGenerationContextBlock = ({
    examProfile = "competitive",
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    resolvedSubject = null,
    difficulty = "medium",
    catSection = null,
    batchSize = 0,
} = {}) => {
    const examLabel = getExamLabel(examProfile, catSection);
    const { trail, paths } = parseCategoryScope(categoryPaths);
    const syllabusFocus = getGenerationTopicFocus({ topic, sectionName, bankName });

    const fullPaper = isJeeFullPaperTopic({
        topic,
        sectionName,
        bankName,
        categoryPaths,
    });

    const subjectLine = fullPaper
        ? `**Subject focus:** JEE **full paper** — mixed **Physics + Chemistry + Mathematics (PCM)**. Follow the PCM quota in the full-paper block below; never output all questions from one subject.`
        : resolvedSubject?.label
          ? `**Subject focus:** ${resolvedSubject.label} (from ${resolvedSubject.source === "topic" ? "topic" : resolvedSubject.source || "topic"})`
          : sectionName?.trim()
            ? `**Subject focus:** ${sectionName.trim()} — derive syllabus from the **topic** above; do not infer a different subject from category tags alone.`
            : `**Subject focus:** Derive **only** from the topic / syllabus focus line above — category tags are navigation, not syllabus.`;

    const categoryBlock = trail
        ? `**Category (bank navigation only — does NOT override topic):** ${trail}${paths.length > 1 ? `\n**Also tagged:** ${paths.slice(1).join("; ")}` : ""}`
        : "";

    const sectionLine = sectionName?.trim()
        ? `**Section:** ${sectionName.trim()}`
        : "";

    const syllabusCoverageBlock =
        batchSize > 0
            ? buildExamSyllabusCoverageBlock({
                  examProfile,
                  catSection,
                  batchSize,
                  bankDifficulty: difficulty,
              })
            : "";

    return `
**EXAM CONTEXT (syllabus scope = TOPIC first — not category path):**
- **Exam:** ${examLabel}
- **Topic / syllabus focus (PRIMARY — generate for this):** ${syllabusFocus || "(not set)"}
- **Bank name:** ${bankName || "(not set)"}
${sectionLine}
${categoryBlock}
${subjectLine}
- **Difficulty tier:** ${difficulty} — **floor, not ceiling**: every question must be **at or above** this tier for ${examLabel}; never easier than requested.
- Use the **exam reference brief** below for real paper format, toughness, stem style, and anti-patterns for this exam.
- Generate only content aligned with the **topic / syllabus focus** and reference brief — category path is for bank organization only.
- If unsure between an easy draft and a harder one, **choose the harder** draft that still meets solve-then-write rules.
${syllabusCoverageBlock}`;
};

/** Canonical CAT VARC scope — RC + VA types; not GMAT grammar/vocab drills. */
export const CAT_VARC_DEFAULT_TOPIC_SCOPE =
    "CAT VARC — Reading Comprehension (passage-based), Para Jumbles, Odd Sentence Out, and Para Summary";

const GMAT_STYLE_VARC_TOPIC_RE =
    /\b(?:grammar correction|vocabulary|synonym|antonym|critical reasoning definition|sentence correction|subject[\s-]verb|wren\s*&?\s*martin|gmat|fill in the blank|parts of speech)\b/i;

export const isGmatStyleVarcTopic = (text = "") =>
    GMAT_STYLE_VARC_TOPIC_RE.test(String(text || ""));

/**
 * General syllabus strategy for any exam — hard-first with full-topic coverage.
 */
export const buildExamSyllabusCoverageBlock = ({
    examProfile = "competitive",
    catSection = null,
    batchSize = 10,
    bankDifficulty = "medium",
} = {}) => {
    const examLabel = getExamLabel(examProfile, catSection);
    const n = Math.max(1, batchSize);
    const hardSlots = Math.max(1, Math.ceil(n * 0.7));
    const breadthSlots = Math.max(1, n - hardSlots);

    return `
**SYLLABUS COVERAGE — ${examLabel} (all exams — mandatory):**
1. **Hard-first (~${hardSlots}/${n} items):** Prioritize exam-difficult micro-topics — multi-step, linked concepts, trap-prone areas typical of ${examLabel}. Bank profile "${bankDifficulty}" sets tier mix; lean hard when in doubt.
2. **Full syllabus breadth (~${breadthSlots}/${n} items):** Each question must use a **different micro-topic** from the syllabus scope. Span distinct units/chapters — do not cluster the whole batch on one chapter or one template.
3. **Exam-native format:** Match the detected exam's real question types (infer from exam profile, section, and reference brief) — not school homework, not a different exam's style.
4. **No filler easy:** Never pad count with trivial drills; if a slot needs an easier item, still use exam-appropriate wording and distractors.`;
};

/** Authoring block — authentic CAT VARC question types (not GMAT verbal). */
export const buildCatVarcAuthoringBlock = ({
    passageCount = 0,
    singleCount = 0,
    passageSingleCount = 0,
} = {}) => {
    const hasRc = passageCount > 0;
    const vaSingles = singleCount || 0;
    return `
**CAT VARC AUTHORING (mandatory — NOT GMAT / school English):**
Real CAT VARC is dominated by **four types only**. Your batch must use these — not grammar drills, vocabulary MCQs, or critical-reasoning definition items.

**1. Reading Comprehension (${hasRc ? `${passageCount} passage(s) × ${passageSingleCount || 4} sub-Q each` : "use connected passages when plan requests RC"}):**
- Passage **450–750 words** on humanities, business, science, or society — CAT editorial tone.
- Each sub-question: inference, tone, author's view, or implicit meaning — **not** literal keyword match.
- Four options are **close paraphrases**; one unambiguous best answer.
- Use \`questionType: "connected"\` with \`passage\` + \`subQuestions\` (single-choice only).

**2. Para Jumbles (${vaSingles > 0 ? "include 2–4 standalone singles" : "standalone singles"}):**
- Present **4–5 shuffled sentences** (label A–E); ask for the **correct logical order** (e.g. "Which sequence is correct?").
- Options: four permutations like "ACBDE", "BACED" — not grammar correction.

**3. Odd Sentence Out:**
- Five sentences on a theme; **four form a coherent paragraph** — find the sentence that does not belong.
- Stem lists all five; options name the odd sentence (e.g. "Sentence 3", "C").

**4. Para Summary:**
- Short paragraph (80–150 words); choose the option that **best captures the central idea** — not a detail trap.

**FORBIDDEN (auto-reject — these are GMAT/school, not CAT VARC):**
- Grammar correction, sentence improvement, error spotting, fill-in-the-blanks
- Vocabulary / synonym-antonym / word-meaning MCQs
- "Identify the logical flaw" / critical-reasoning definition drills without a passage
- Underline-the-error, parts of speech, Wren & Martin style items

**Mix guidance:** ~60–70% RC (passages) + ~30–40% VA singles (parajumbles, odd sentence, para summary) for a full section; match the requested counts.`;
};

export const buildCatSectionAuthoringBlock = ({
    catSection = null,
    passageCount = 0,
    singleCount = 0,
    passageSingleCount = 0,
} = {}) => {
    if (catSection === "cat_varc") {
        return buildCatVarcAuthoringBlock({
            passageCount,
            singleCount,
            passageSingleCount,
        });
    }
    return "";
};

/** Universal authoring standard — exam-specific facts come from reference brief + topic. */
export const buildExamAuthoringBlock = ({ examProfile = "competitive" } = {}) => {
    const examLabel = getExamLabel(examProfile);

    return `
**AUTHORING STANDARD — ${examLabel} (mandatory):**
Your JSON output is final. Author publishable questions in one pass — no correction step after you respond.
**Output ONLY questions that pass every correctness check below. If a draft fails any check, discard it and write a different question — never return a known-broken item.**

**For EACH question:**
1. **Scope:** Pick a fact/problem type valid for the topic, category path, and exam reference brief.
2. **Stem:** Write in the real exam's stem style (length, setup, constraints) for this difficulty tier.
3. **Solve:** Work to one definite answer (value, expression, or unambiguous choice).
4. **Options:** Four **distinct** answer texts only. The solved result must match **one option verbatim** (same number, unit, and form).
5. **correctAnswer:** Letter of that option only.
6. **Explanation:** Same solve, same conclusion as the marked option — max 3 sentences, proof only. Forbidden: "re-evaluating", "recomputing", "correcting", "adjusting", "my mistake", "editing option", "wait", "none match", "let's check".

**If solve ≠ any option, options duplicate, or explanation ≠ marked answer → discard and write a different question. Never ship a mismatch.**`;
};

/**
 * Prominent correctness gate for initial generation — mirrors what the post-gen auditor flags.
 * Placed at the top of the generation prompt so the model treats correctness as non-negotiable.
 */
export const buildCorrectnessFirstGenerationBlock = ({
    examProfile = "competitive",
    catSection = null,
} = {}) => {
    const profileNote =
        catSection === "cat_varc"
            ? `
**CAT VARC:** RC answers come from passage inference — explanation must quote reasoning from the passage, not grammar rules. VA items (parajumble, odd sentence, para summary) must have one unambiguous correct option. Never ship grammar/vocabulary/critical-reasoning-definition drills.`
            : examProfile === "cat"
            ? `
**CAT QA / aptitude:** Solve work-rate, TSD, and % problems to **one** final answer before options. Stem may mention intermediate values as traps — that is fine — but \`correctAnswer\` and explanation must agree on the same final value. Never use two identical option strings.`
            : examProfile === "jee_main" || examProfile === "jee_advanced"
              ? `
**JEE / NTA:** Numerical result must appear **verbatim** in exactly one option (with units). Optics/fringe: compute position fully before options. No duplicate or indistinguishable options (e.g. two "butene"). **Organic chemistry:** each option must be a **distinct** IUPAC name — never repeat the same compound in two letters (e.g. identical "iodo-1-methylcyclopentane" for C and D); position prefixes (1-/2-/3-/ortho/meta/para) must differ across all four options. Explanation must conclude the **same** name as the marked option — not a different positional isomer. Chemistry: mixing molarity = total moles ÷ total L; pH 0–14; Arrhenius two-T problems must end at **time** in options, not intermediate k. Use standard scientific notation in options (e.g. \`1.0 × 10⁻⁵ M\`), never \`0 x 10^-2\`.`
              : examProfile === "neet"
                ? `
**NEET:** NCERT-consistent numerics; explanation must derive the marked option only — no alternate conclusion in the text.`
                : "";

    return `
**CORRECTNESS FIRST — NON-NEGOTIABLE (every MCQ must pass before you add it to JSON):**
You are generating **publishable** exam questions. The automated factual auditor rejects: wrong answer keys, explanation≠marked answer, values not among options, and duplicate options. **Do not output questions that would fail that audit.**

**Per-question gate (all must pass):**
1. **Solve-then-write:** Complete the full calculation or reasoning to ONE definite answer **before** writing options.
2. **Option match:** That answer must appear **verbatim** in exactly one \`options[]\` entry (same value, unit, and quantity type — not approximate, not a different form).
3. **Answer key:** \`correctAnswer\` must point to that option only (for "multiple", every listed letter must be correct).
4. **Explanation lock:** The explanation must derive the **same** final value as the marked option — last stated number/expression must match. No meta-commentary ("wait", "re-evaluating", "correcting", "adjusting parameters", "recomputing", "nearest option").
5. **Distinct options:** All four options must be **different** text — no identical duplicates (exact same string twice).
6. **Internal consistency:** Never state in the explanation that a different option or value is correct than \`correctAnswer\`.
${profileNote}
**Hard stop:** If any gate fails while authoring → **discard that draft** and pick a different problem. Return **only** questions you have verified end-to-end. Never pad the batch with knowingly broken items.

**Additional gates (automated auditor rejects these):**
7. **Combinatorial / counting:** If you enumerate N cases in the explanation (e.g. "4 valid arrangements"), the marked answer must be N — not N−1 or a different count.
8. **Stem integrity:** Do not copy an option's text into the stem in a way that makes one distractor trivially obvious (e.g. coordinates already in the equation, or the stem states the answer).
9. **Near-duplicate options:** Options must differ clearly — not two strings that differ only by a prefix (e.g. "butene" vs "1-butene" without clear labels) or differ by <10% of characters.
10. **Context lock:** Every number, name, and scenario in the stem must match the explanation — no references to values or setups not in the question.`;
};

/** Zero-tolerance mandates — same bar as evaluation regen, applied on first pass. */
export const buildGenerationCorrectnessMandatesBlock = ({
    examProfile = "competitive",
} = {}) => {
    if (examProfile === "cat") {
        return `
**CORRECTNESS MANDATES (zero tolerance — factual auditor checks every item):**
1. **Solve-then-write:** Derive each answer fully BEFORE writing options; the computed value must appear verbatim in exactly one option.
2. **Answer key lock:** \`correctAnswer\` and explanation must agree on the same final value (e.g. do not explain 20 days but mark 16 days).
3. **Distinct options:** No two options with identical text; no near-identical percentage or ratio strings.
4. **Explanation:** Final sentence must match the marked option; no "Wait", "correcting", "re-evaluating", or draft meta-commentary.
5. **Discard broken drafts** — if solve ≠ any option, write a different problem from scratch; never ship a mismatch.`;
    }

    return `
**CORRECTNESS MANDATES (zero tolerance — factual auditor checks every item):**
1. **Solve-then-write:** Derive each answer fully BEFORE writing options; the computed value must appear verbatim in exactly one option.
2. **Option integrity:** All four options same type/unit; no duplicate, identical, or indistinguishable text.
3. **Explanation lock:** Final sentence must match the marked option; no "Wait", "correcting", "re-evaluating", "adjusting parameters", or draft meta-commentary.
4. **No broken numerics:** If your solved value is not among the four options, discard and use a different problem — never round into a wrong key.
5. **Combinatorial consistency:** Counting/enumeration in the explanation must match the marked option exactly.
6. **Discard any draft** that fails a gate — author a new stem; do not lightly edit a broken question.`;
};

/** Explicit list of defects the post-generation auditor auto-rejects — mirror in authoring. */
export const buildAutomatedAuditorDefectsBlock = ({
    examProfile = "competitive",
} = {}) => {
    const profileExamples =
        examProfile === "cat"
            ? `
- Work-rate/TSD: explanation ends at 20 days but \`correctAnswer\` marks 16 days.
- Two options both say "25%" with identical text.`
            : examProfile === "jee_main" || examProfile === "jee_advanced"
              ? `
- Fringe/optics: explanation derives 12.5 mm but options are 10, 15, 20, 25 and none match.
- Chemistry: two options both "butene" or indistinguishable isomers without clear labels.
- Malformed scientific notation in options (e.g. \`0 x 10^-5\`).
- **Gas law / total pressure:** explanation derives 4.926 atm but options list 926 atm — keep decimal precision in the option text.
- **Ratio questions:** explanation 4:1 but all options are "1" — use distinct ratio strings (2:1, 4:1, etc.).
- **Mixing molarity:** explanation says "Molarity = 6 M" but options are 0.16 M, 0.32 M, 0.35 M — use total moles ÷ total volume (L).
- **pH / buffer:** invalid option like **347** or **44** — pH must be **0–14** (e.g. 4.28, 4.46).
- **Arrhenius / two-temperature rate:** explanation ends at **1.0705** (intermediate k or ln term) but options are **1155 s**, **577 s** — the **final time** must be in one option.
- **Molality:** explanation gives **1.506 m** but one option is bare **1.506** without unit while others have **m** — keep units consistent across all four options.`
              : examProfile === "neet"
                ? `
- Biology counting: explanation lists 5 structures but marked answer is 4.
- pH/Ka options in wrong scale (bare 74 instead of 4.74).`
                : "";

    return `
**AUTOMATED DEFECTS — your JSON is scanned for these; any hit is rejected:**
- **Answer-key mismatch:** Explanation's final computed value or stated correct option ≠ \`correctAnswer\`.
- **Value not in options:** Solved result does not appear verbatim in any \`options[]\` entry.
- **Duplicate options:** Two or more options with the same text.
- **Near-duplicate options:** Options so similar a student cannot distinguish them (substring match, >92% similarity).
- **Stem leaks answer:** Option text trivially embedded in the question stem.
- **Draft explanation:** Contains "wait", "re-evaluating", "correcting", "my mistake", "none match", "let us use option".
- **Vague justification:** "hence the answer follows", "logic suggests", "adjusting for specific fringe count" without derivation.
- **Malformed options:** Invalid scientific notation, all options starting with 0, or mixed unit types.
${profileExamples}
**If you would trigger any rule above → discard that question and write a new one before output.**`;
};

/** Explicit lock: explanation final value MUST match the marked option (top failure mode). */
export const buildExplanationOptionLockBlock = ({
    examProfile = "competitive",
} = {}) => {
    const chemNote =
        examProfile === "jee_main" ||
        examProfile === "jee_advanced" ||
        examProfile === "neet"
            ? `
**Chemistry numerics (reject if violated):**
- **pH / buffer / Henderson–Hasselbalch:** every numeric option must be **0–14** (e.g. 4.28, 9.26) — never bare 44, 74, or 347.
- **Molarity / molality:** include unit in options when stem uses units (0.32 M, 1.506 m) — explanation's last value must match the marked option **with the same unit**.
- **ΔG°, rate constants, mole fractions:** solve once; the number in the explanation's **last sentence** must appear **verbatim** in one option.`
            : "";

    return `
**EXPLANATION ↔ OPTION LOCK (most common auto-reject — verify on EVERY question):**
1. Solve completely → write four options → pick \`correctAnswer\` → then write explanation.
2. The explanation's **final numeric value** (last "= …" or "therefore …") must be **identical** to the marked option text (same digits, unit, and scale).
3. **Forbidden:** explanation derives **6** or **1.0705** while options show **0.32 M** or **1.506 m** — if solve changed, **rewrite options** to include your final value, then mark that option.
4. **Forbidden:** computing one value (e.g. √66 ≈ 8.12 or P = 0.375) then switching the last line to a different option (7.35 / 0.4286) to "match the key". Code will **reject** that — never force-align.
5. **Forbidden:** meta-text ("re-evaluating", "adjusting", "let us use option B", "for the specific distractor set") — explanation is student-facing proof only.
6. Before JSON output: for each item, read the marked option aloud and confirm the explanation ends at that exact text.
${chemNote}
**If explanation ≠ marked option → discard the entire question and author a new one.**`;
};

/** Second-pass self-check — model re-solves each draft before returning JSON. */
export const buildPostSolveSelfCheckBlock = () => `
**INDEPENDENT RE-SOLVE (run on EVERY question after drafting — before adding to JSON):**
1. Cover options and correctAnswer; re-solve using **only** the stem and given data.
2. Does the fresh answer match the marked option **character-for-character** (digits, unit, scale)?
3. Does the explanation's **last** numeric value match that same option — not an intermediate (k, ln ratio, unfinished M)?
4. Are all four options **unique** and on the **same unit scale** (all include "min", all include "m", or all bare pH)?
If any step fails → **discard** that question and author a different one. Do not patch by changing correctAnswer to match a wrong explanation.`;

/** Solve-first skeleton step — code builds options from finalAnswer; steps must agree. */
export const buildSolveFirstSkeletonCorrectnessBlock = ({
    examCalibrated = false,
} = {}) => {
    const floors = getHardMandateFloors({ examCalibrated });
    const minSteps = floors.minSolveSteps ?? 3;
    const minLines = floors.minSolutionLines ?? 4;

    return `
**SOLVE-FIRST SKELETON RULES (code builds options from \`finalAnswer\` — mismatches are auto-rejected):**
1. \`finalAnswer.display\` = your **final** solved value with unit (e.g. "0.32 M", "4.28 m/s", "28.5 kJ/mol") — this becomes the correct option.
2. \`solveSteps\` must derive **the same** \`finalAnswer.display\` in the **last** step — write **${minLines}+ complete derivation sentences** (≥${minSteps} solveSteps minimum); these become the full explanation shown to students.
3. **Arithmetic lock:** Solve from stem givens first. The numeric in the last solveStep must **match** \`finalAnswer.display\` exactly. Code independently re-verifies from the stem — if it computes a different value (e.g. steps say 0.0102 but finalAnswer is 0.082), the skeleton is **rejected**.
4. \`distractorValues\` = 3 **distinct** plausible wrong values, same type/unit as finalAnswer; for pH use values between 0 and 14 only.
5. Double-check arithmetic before output — wrong \`finalAnswer\` poisons the whole batch.
6. Do not put any distractor value that appears verbatim as a given in the stem.
7. **No meta in solveSteps** — never write "Re-calculating", "Correction:", or "Wait"; solve once cleanly.
8. **EM power:** ε = BLv, then P = ε²/R = I²R — do not confuse ε with I or halve P incorrectly.
9. **Hard-tier gate:** ≥2 concepts in stem, ≥${minSteps} solve steps, ≥${minLines} derivation lines, no direct single-formula substitution.`;
};

/** Final checklist — placed near JSON output rules so the model re-verifies before returning. */
export const buildPreOutputCorrectnessChecklist = ({
    examProfile = "competitive",
} = {}) => {
    const rejectExamples =
        examProfile === "cat"
            ? "e.g. explanation concludes 20 days but marks 16 days; two options both say \"25%\" identically"
            : examProfile === "jee_main" || examProfile === "jee_advanced"
              ? "e.g. derives 12.5 mm but options are 10/15/20/25; duplicate option text; explanation jumps to a different value than marked; counts 4 cases but marks 3"
              : "e.g. wrong answer key, explanation≠marked answer, duplicate options, computed value not in options";

    return `
**PRE-OUTPUT FACTUAL CHECKLIST — run on EVERY question before adding to the JSON array:**
□ Independently solved → one definite answer
□ That answer appears **verbatim** in exactly one \`options[]\` entry (same number, unit, form)
□ \`correctAnswer\` points only to that option (all letters correct for "multiple")
□ Explanation's final value/choice = marked option **character-for-character** (same number + unit)
□ All four \`options[]\` strings are **unique** — no duplicates or near-duplicates
□ Stem does not trivially embed one option's text
□ If counting/enumerating cases, marked answer = that count
□ Explanation references only values and setup from the stem

**Do NOT return items that fail** — ${rejectExamples}. Replace with a new question instead of shipping a defect.`;
};

/** Universal floor — each question must meet its assigned difficultyTier slot (see ASSIGNED SLOTS). */
export const buildExamDifficultyFloorBlock = ({
    examProfile = "competitive",
    difficulty = "medium",
    catSection = null,
} = {}) => {
    const examLabel = getExamLabel(examProfile, catSection);
    const bank = String(difficulty || "medium").toLowerCase();

    return `
**DIFFICULTY FLOOR — ${examLabel} (bank profile "${bank}") — UPSCALED TIERS:**
**easy-tier = exam medium · medium-tier = exam hard · hard-tier = extra hard.** Bank "${bank}" sets overall mix; each slot must hit its upscaled band.

**Mis-calibration failures — rewrite:**
- **easy-tier** feels like old exam-easy / Section A / 2-step (below upscaled easy).
- **medium-tier** feels like old mid-section only (below upscaled medium).
- **hard-tier** feels like old late-section only without extra fusion/insight.
- Single-step plug-in or naked recall at any tier.`;
};

/**
 * Audience calibration — items must challenge repeaters and coaching veterans,
 * not only first-time qualifiers.
 */
export const buildVeteranExamineeCaliberBlock = ({
    examProfile = "competitive",
    catSection = null,
} = {}) => {
    const examLabel = getExamLabel(examProfile, catSection);
    return `
**VETERAN EXAMINEE CALIBER (mandatory audience test — ${examLabel}):**
Write for the candidate who has **already cleared this exam many times** — repeaters, droppers, and coaching veterans who have solved thousands of prior-year and mock papers.
- Such a student must **still need careful multi-step reasoning** (typically **4–6 minutes** per item on JEE Main hard slots). If a veteran can solve it in under **90 seconds** with one memorized formula, the item is **too easy — rewrite harder**.
- Do **not** target NCERT-only, board-level, or first-attempt ease. Assume the reader has seen every standard template and shortcut.
- Difficulty must come from **linked concepts, non-obvious constraints, coupled subsystems, and tight distractors** — not obscure trivia, trick wording, or unreadable stems.
- A veteran should **respect** the problem; they should not dismiss it as a drill or homework exercise.
- **Reject self:** "Would a student in their 3rd year of JEE coaching yawn at this?" If yes → add a second constraint, coupled quantity, or non-standard setup.`;
};

/** Exam-profile toughness floors — no per-subject static lists. */
export const buildExamToughnessBlock = ({
    examProfile = "competitive",
    batchSize = 10,
    difficulty = "medium",
    catSection = null,
} = {}) => {
    const n = Math.max(1, batchSize);
    const tier = String(difficulty || "medium").toLowerCase();
    const examLabel = getExamLabel(examProfile, catSection);
    const threeStepMin = Math.ceil(n * (tier === "easy" ? 0.3 : tier === "hard" ? 0.75 : 0.6));

    const profileNote =
        examProfile === "jee_advanced"
            ? `- **JEE Advanced** rigor: insight + multi-concept; 4+ step solves; never Main-level formula drills.`
            : examProfile === "jee_main"
              ? `- **JEE Main** shift-paper rigor: multi-step or multi-topic; tight numeric distractors; breadth across syllabus.`
              : examProfile === "neet"
              ? `- NCERT-rooted application stems; plausible distractors from common syllabus slips — not coaching trivia.`
              : examProfile === "cat"
                ? `- CAT section style from reference brief — not school worksheets or engineering coaching drills.`
                : examProfile === "board"
                  ? `- Official board sample-paper tone; application and reasoning typical of the class/board in the path.`
                  : `- National entrance standard — linked concepts and exam-style traps, not homework drills.`;

    return `
**TOUGHNESS FLOOR — ${examLabel} (batch of ${n}, tier "${tier}" — minimum difficulty):**
- Difficulty may be **equal or higher** than "${tier}" — **never lower**.
- At least **${threeStepMin}** questions need **3+ reasoning/calculation steps** (or linked sub-ideas).
- Stems must include setup/conditions — not naked one-line recall unless tier is easy.
- All four options must be **plausible** — distractors from partial/wrong-branch work, not joke values.
${profileNote}
- If a draft feels like a chapter exercise, **add constraints or a second idea** — do not ship it as-is.
- **Zero tolerance** for "filler easy" questions to complete the count — replace with harder items.
${buildVeteranExamineeCaliberBlock({ examProfile, catSection })}`;
};

export const buildExamSolveThenWriteBlock = () => `
**SOLVE-THEN-WRITE (every MCQ — do this mentally before writing JSON):**
1. **Solve first** — complete the full calculation or reasoning to ONE definite answer.
2. **Write options second** — four distinct, plausible answer texts; put your solved result verbatim in exactly one option.
3. **Set correctAnswer** — letter of that option only.
4. **Write explanation last** — same derivation, same final value as the marked option (max 3 sentences).

**Hard stops (if any apply, discard the draft and pick a different problem):**
- Your solved value is not among the four options.
- explanation ends at a different value or option than correctAnswer.
- You would write meta text in explanation (forbidden: "wait", "re-evaluating", "recomputing", "correcting", "adjustment", "my mistake", "editing option", "none match", "checking again").

Do all verification before output. Your JSON is the final product — there is no correction step.`;

export const buildExamAnswerKeyLockBlock = () => `
**FINAL CHECK — each MCQ before adding to JSON:**
1. Solve → one final answer (number, expression, or choice text).
2. That answer must appear **verbatim** in exactly one options[] entry — not approximate, not a different form.
3. correctAnswer letter must point to that option.
4. explanation must derive the same answer — proof only, zero draft commentary.
5. All four options must be **distinct** (no duplicates).
6. If any check fails → discard that question and author a different one.`;

/** True when generation target is Mathematics (topic, category leaf, or resolved subject). */
export const isMathematicsGenerationSubject = ({
    resolvedSubject = null,
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
} = {}) => {
    if (
        isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName })
    ) {
        return false;
    }
    if (String(resolvedSubject?.id || "").toLowerCase() === "mathematics") return true;
    const hay = `${topic} ${bankName} ${sectionName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    return /\b(?:mathematics|maths?)\b/i.test(hay);
};

/**
 * Mathematics difficulty floor — prevents chapter-test easiness on JEE/board math.
 */
export const buildMathematicsDifficultyBlock = ({
    examProfile = "competitive",
    difficulty = "medium",
} = {}) => {
    const examLabel = getExamLabel(examProfile);
    const tier = String(difficulty || "medium").toLowerCase();

    return `
**MATHEMATICS DIFFICULTY FLOOR — ${examLabel} (tier "${tier}" minimum):**
- No naked formula plug-in, standard derivative/integral identity, or one-line algebra at medium/hard.
- Prefer **multi-step** setups: parameters, constraints, intervals, or **two linked ideas** (e.g. quadratic + progression, coordinate geometry + calculus).
- Stems: **2–4 sentences** of conditions before the ask — not "find the value of …" with no setup.
- Distractors: tight numeric/expression values from **partial solves** (sign error, wrong branch, stopped one step early).
- If solvable in under 90s via one memorized template → **rewrite harder** before output.
- Tier "${tier}" means **at least** shift-paper ${tier} rigor — never Class 10 drill or NCERT end-of-chapter ease.`;
};

/** True when generation target is Chemistry (topic, category leaf, or resolved subject). */
export const isChemistryGenerationSubject = ({
    resolvedSubject = null,
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
} = {}) => {
    if (
        isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName })
    ) {
        return false;
    }
    if (String(resolvedSubject?.id || "").toLowerCase() === "chemistry") return true;
    const hay = `${topic} ${bankName} ${sectionName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    return /\bchemistry\b/i.test(hay);
};

/**
 * Chemistry numerical integrity — Ka, pH, E°cell, rate laws, molar conductivity, etc.
 */
export const buildChemistryNumericalAuthoringBlock = ({
    examProfile = "competitive",
} = {}) => {
    const examLabel = getExamLabel(examProfile);
    return `
**CHEMISTRY NUMERICAL INTEGRITY — ${examLabel} (mandatory for every chemistry MCQ):**
Most chemistry defects are **correct math, wrong option text or wrong marked letter**.

**Scientific notation & numeric options:**
- Use standard form: **1.0 × 10⁻⁵**, **3.67 × 10⁻⁴** — never \`0 x 10^-5\` or malformed leading zeros.
- All four options must be **distinct** numeric values in the **same unit/scale** (all pH, all V, all mol L⁻¹ s⁻¹).
- pH options must be in **0–14** (e.g. 4.74, 5.04) — never bare integers like 74 or 44 for a buffer pH question.
- **Ratio / integer answers:** if the answer is a ratio (4:1) or bond order (2.5), every option must be a **different** ratio or value — never four copies of "1".

**Quantity type — do not confuse:**
- **E°cell** (volts, typically 0.1–3 V) ≠ random large integers (10 V is almost never correct).
- **Ka / Ksp** — match the calculated order of magnitude in one option.
- **Rate-law factor** (dimensionless) ≠ concentration units.
- **Molar conductivity** (S cm² mol⁻¹) — keep units consistent across options.
- **Nernst Ecell** — solve fully; last value in explanation must match the marked option in volts.

**Organic / nomenclature:**
- IUPAC names must be **fully distinct** across options (not two identical "hydroxybutanal").
- Use 1-/2-/3- prefixes to distinguish isomers (1-butene vs 2-butene).

**High-frequency chemistry traps (auto-rejected if violated):**
- **Mixing two solutions:** nᵢ = Mᵢ × Vᵢ (V in L); M_final = Σnᵢ / ΣVᵢ. If the solve is **0.32 M**, one option must read **0.32 M** — never leave **6 M** in the explanation while marking 0.32 M.
- **w/w % → molality:** on 100 g basis, molality = (mass solute / M) / (mass solvent in kg). All four options must use the same unit (**m**).
- **Buffer + strong acid/base:** update moles after neutralization, then Henderson–Hasselbalch; pH options **0–14** only.
- **Arrhenius at two temperatures:** compute k₂ from Ea, then integrated rate law for fractional conversion; **final time in seconds** must appear verbatim in one option — not an intermediate k or ln value.

**Discipline before JSON:**
1. Solve with given data → one final value with correct unit.
2. Write four **distinct** plausible distractors; place the solved value verbatim in exactly one.
3. Set correctAnswer to that letter; explanation derives the **same** final value (max 3 sentences, no "wait"/"re-evaluating").
4. Do not embed any option text in the question stem.

**If options would duplicate, use wrong notation, or math ≠ any option → discard and pick a simpler problem.**`;
};

/** True when generation target is Physics (topic, category leaf, or resolved subject). */
export const isPhysicsGenerationSubject = ({
    resolvedSubject = null,
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
} = {}) => {
    if (
        isJeeFullPaperTopic({ topic, bankName, categoryPaths, sectionName })
    ) {
        return false;
    }
    if (String(resolvedSubject?.id || "").toLowerCase() === "physics") return true;
    const hay = `${topic} ${bankName} ${sectionName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    return /\bphysics\b/i.test(hay);
};

/**
 * Physics numerical integrity — targets answer-key vs unit/quantity mismatches
 * that pass generic solve-then-write but fail on first generate.
 */
export const buildPhysicsNumericalAuthoringBlock = ({
    examProfile = "competitive",
} = {}) => {
    const examLabel = getExamLabel(examProfile);
    return `
**PHYSICS NUMERICAL INTEGRITY — ${examLabel} (mandatory for every physics MCQ):**
Generic solve-then-write is not enough for physics. Most defects are **right math, wrong marked quantity or unit**.

**Units & magnitude (every numeric question):**
- State given values **with units** in the stem; use the **same unit** in the correct option.
- Do not mix scales across options (e.g. 1.66 eV next to 6575 eV) unless the stem explicitly uses both.
- **Ideal gas / total pressure:** if the solve is 4.926 atm, one option must read **4.93 atm** or **4.926 atm** — never drop the decimal (926 atm is wrong).
- **Ratio questions (Bohr orbits, etc.):** options must be distinct ratios (1:2, 2:1, 4:1) — never four identical integers.
- eV, keV, MeV, J — convert once, solve once, write the option in the unit the question asks for.
- Wavelength options: all in nm, or all in Å, or all in m — never mixed.

**Quantity type — do not confuse (common first-pass failures):**
- **Focal length f** ≠ image distance v ≠ object distance u ≠ bench position.
- **Harmonic number** (1st, 3rd, 5th) ≠ frequency in Hz ≠ wavelength.
- **Optical power (D)** vs **focal length (cm/m)** — if the ask is focal length, options in length units, not diopters.
- **Orbital radius** = distance from Earth's **center** (r = R + h), not height h alone.
- **Equivalent resistance / capacitance** vs **branch current / voltage** — mark what was asked.

**Multi-step mechanics, optics, modern physics:**
- Non-uniform circular motion: find a_t and a_c separately, then a = √(a_t² + a_c²); the option must be this resultant with correct units.
- Photoelectric effect: E_photon and Φ in eV → KE_max in eV (typical 0–10 eV range, not thousands).
- Lens/mirror: finish by answering exactly what the stem requests (f, v, u, magnification, or power).
- **Motional EMF / induced current:** ε = BLv, I = ε/R, **P = I²R = ε²/R** — verify all three before marking; common error is marking ε×I or ε²/(2R).

**Discipline before JSON:**
1. List givens with units → solve → one final value with unit.
2. Place that exact value (and unit if options include units) in **one** option.
3. explanation's **last stated value** must match the marked option — same number, same unit, same quantity type.
4. All four options must be **distinct** and physically plausible.

**If unit, scale, or quantity type does not line up → discard and pick a simpler numerical problem.**`;
};

/** Compact PCM authoring rules when generating multi-subject / full-paper batches. */
export const buildPcmAuthoringBlock = ({ examProfile = "competitive" } = {}) =>
    [
        buildChemistryNumericalAuthoringBlock({ examProfile }),
        buildPhysicsNumericalAuthoringBlock({ examProfile }),
        buildMathematicsDifficultyBlock({ examProfile }),
    ].join("\n");

/** True for JEE "Full paper" / mock-test category — requires PCM mix, not one subject. */
const FULL_PAPER_PATTERN =
    /\bfull\s*paper\b|\bfull\s*mock\b|\bcomplete\s*paper\b|\bmock\s*test\b|\bpractice\s*paper\b|\bmodel\s*paper\b/i;

/**
 * Full-paper PCM mix applies only when the **topic** (or section) says so.
 * Category/bank tags like "Full paper" do not override a subject-specific topic
 * (e.g. topic "JEE — Maths" under a Full paper category → Mathematics only).
 */
export const isJeeFullPaperTopic = ({
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
} = {}) => {
    const focusHay = [topic, sectionName].filter(Boolean).join(" ").toLowerCase();

    if (matchSubjectInText(focusHay)) {
        return false;
    }

    if (focusHay.trim()) {
        return FULL_PAPER_PATTERN.test(focusHay);
    }

    const fallbackHay = `${bankName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    return FULL_PAPER_PATTERN.test(fallbackHay);
};

/** Primary syllabus string for prompts — topic wins over bank/category. */
export const getGenerationTopicFocus = ({
    topic = "",
    sectionName = "",
    bankName = "",
} = {}) => {
    const t = String(topic || "").trim();
    if (t) return t;
    const section = String(sectionName || "").trim();
    if (section) return section;
    return String(bankName || "").trim();
};

/** Split batch size across Physics, Chemistry, Mathematics (sum = batchSize). */
export const allocateJeeFullPaperSubjectCounts = (batchSize = 10) => {
    const n = Math.max(3, Math.round(Number(batchSize) || 10));
    const base = Math.floor(n / 3);
    const mathematics = base;
    const physics = base;
    const chemistry = n - mathematics - physics;
    return { physics, chemistry, mathematics, total: n };
};

export const buildJeeFullPaperMixBlock = ({
    examProfile = "jee_main",
    batchSize = 10,
    difficulty = "medium",
} = {}) => {
    const examLabel = getExamLabel(examProfile);
    const tier = String(difficulty || "medium").toLowerCase();
    const { physics, chemistry, mathematics, total } =
        allocateJeeFullPaperSubjectCounts(batchSize);

    return `
**JEE FULL PAPER — PCM MIX (mandatory for "${examLabel}" full-paper / mock topic):**
This is a **mixed-subject** JEE paper, NOT a Physics-only or single-subject drill.

**Subject quota for ${total} question(s) — exact counts:**
- **Physics:** ${physics} question(s) — mechanics, E&M, optics, modern physics, thermodynamics, etc.
- **Chemistry:** ${chemistry} question(s) — physical, organic, and inorganic (spread across sub-areas).
- **Mathematics:** ${mathematics} question(s) — algebra, calculus, coordinate geometry, vectors, probability, etc.

**Rules:**
- Tag each question internally while authoring; **no two consecutive questions** from the same subject when possible.
- Do **not** output ${total} Physics questions — that fails a full-paper brief.
- Each subject at **≥ ${tier}** ${examProfile === "jee_advanced" ? "JEE Advanced (IIT) paper" : "JEE Main shift-paper"} rigor — ${examProfile === "jee_advanced" ? "depth and insight, not Main speed/breadth" : "multi-step where appropriate"}.
- Chemistry: use proper IUPAC names; distinguish isomers (1-butene vs 2-butene).
- Mathematics: no naked one-line formula drills at medium/hard${examProfile === "jee_main" ? " — include some late-section hard maths items" : " — Advanced-level multi-concept problems"}.
- Physics: units in stem and options; solve-then-write.`;
};

export const buildJeeMainAuthenticityGenerationBlock = ({
    difficulty = "medium",
    batchSize = 10,
    sectionName = "",
} = {}) => {
    const tier = String(difficulty || "medium").toLowerCase();
    const n = Math.max(1, batchSize);
    const multiConceptMin = Math.ceil(
        n * (tier === "hard" ? 0.7 : tier === "medium" ? 0.45 : 0.35)
    );
    const minFourStep = Math.ceil(n * (tier === "hard" ? 0.6 : 0.35));
    const isSectionB = /\bsection\s*b\b|\bnumerical\b/i.test(sectionName || "");

    return `
**JEE MAIN AUTHENTICITY — NTA shift-paper style (NOT Advanced, NOT coaching worksheet):**
Real JEE Main tests **breadth + speed** with mixed difficulty — Section A single-correct, Section B numerical (simulated below without integer type).

**Question types available (backend):** \`single\`, \`multiple\` (multi-correct), \`connected\` (passage + sub-questions). **No integer-type field** — simulate Section B numerics as **single** MCQs whose four options are **four distinct numeric values** (with units).

**Pattern mix for this batch (${n} items):**
${isSectionB
    ? `- **Section B style (numerical-as-MCQ):** Every item is \`single\` with 4 numeric options; stems need 2–4 min calculation; no trivial plug-in.`
    : `- **~65–75%** \`single\` — standard single-correct MCQs (+4/−1 marking tone).
- **~10–15%** \`multiple\` — multi-correct where appropriate (partial marking tone in explanation).
- **~10–20%** \`connected\` — 1–2 reading/passage sets with 2–3 sub-questions (paragraph/comprehension or data-based linked set).
- **~25–35% of singles** must be **numerical-as-MCQ** (four numeric options) — simulates Section B without integer type.
- Include **match-the-column style** as \`single\`: stem "Match List I with List II", options are four complete matching pairs.`}

**BANNED templates:** SHM bare ω=√(k/m), fringe without position math, half-life plug-in only, bare Class 11 area integral, indistinguishable "butene" options.

**REQUIRED at tier "${tier}"${tier === "hard" ? " — EVERY hard question, not batch average" : ""}:**
- At least **${multiConceptMin}** questions link **2+ syllabus ideas** AND need **≥3 distinct solving steps** with **≥4 derivation lines** each.
- **No direct substitution** — intermediate reasoning required; single-formula plug-ins fail.
- At least **${minFourStep}** questions need **4+ minute solve depth** (not 30-second plug-ins).
- **Mathematics:** at least ${Math.max(1, Math.ceil(n * 0.25))} moderate-to-hard items (late Main section caliber).
- **Chemistry:** mix easy + moderate + at least ${Math.max(1, Math.ceil(n * 0.2))} moderate/tough application items.
- Spread **distinct micro-topics** — no duplicate one-liner tricks.
- Distractors from incomplete solves — all four plausible; **no stem-embedded option values**.`;
};

export const buildJeeAdvancedAuthenticityGenerationBlock = ({
    difficulty = "medium",
    batchSize = 10,
    paperNumber = null,
} = {}) => {
    const tier = String(difficulty || "medium").toLowerCase();
    const n = Math.max(1, batchSize);
    const multiConceptMin = Math.ceil(n * (tier === "hard" ? 0.7 : 0.55));
    const paperNote =
        paperNumber === 1
            ? "Paper 1 — often slightly more concept-heavy setup."
            : paperNumber === 2
              ? "Paper 2 — often slightly more calculation-intensive; still insight-based."
              : "";

    return `
**JEE ADVANCED AUTHENTICITY — IIT Advanced Paper style (NOT JEE Main):**
Advanced difficulty comes from **pattern + depth**, not just harder numbers. ${paperNote}

**Question types available (backend):** \`single\`, \`multiple\` (multi-correct), \`connected\` (passage/paragraph + sub-questions). **No integer/decimal/matrix input types** — use supported types only.

**Mandatory pattern mix for ${n} items (vary types — never all single-correct):**
- **~35–45%** \`single\` — single-correct (+3/−1 tone); include **match-the-column** and **assertion-reason** styled as single with four statement pairs as options.
- **~30–40%** \`multiple\` — **multi-correct** (+4/+2/−1 partial marking tone); at least ${Math.max(1, Math.ceil(n * 0.3))} required in this batch.
- **~15–25%** \`connected\` — paragraph/data/comprehension sets with 2–3 sub-questions per passage (+3/−1 per sub).
- **Zero** batches that are 100% single-correct — that is Main pattern, not Advanced.

**BANNED (Main-level / too easy):**
- Formula recall without multi-step setup; solvable in under 2 minutes.
- Questions identical in spirit to typical JEE Main shift papers.
- All four options from one-line substitution.

**REQUIRED at tier "${tier}":**
- At least **${multiConceptMin}** questions with **4+ reasoning steps** or **deep intricacy** on favourite Advanced topics.
- Test **insight and constraint analysis** — not syllabus coverage alone.
- Multi-correct: 2–3 correct options typically; distractors from partial cases.
- If it feels like Main → rewrite with Advanced linking and tougher pattern.`;
};

export const buildJeeAuthenticityGenerationBlock = ({
    examProfile = "jee_main",
    difficulty = "medium",
    batchSize = 10,
    sectionName = "",
    paperNumber = null,
} = {}) =>
    examProfile === "jee_advanced"
        ? buildJeeAdvancedAuthenticityGenerationBlock({ difficulty, batchSize, paperNumber })
        : buildJeeMainAuthenticityGenerationBlock({ difficulty, batchSize, sectionName });

/** Pattern block injected when plan specifies counts — reinforces planned type mix. */
export const buildJeeExamPatternFromPlanBlock = (plan = {}) => {
    const profile = String(plan.examProfile || "").toLowerCase();
    if (profile !== "jee_main" && profile !== "jee_advanced") return "";

    const single = plan.singleCount || 0;
    const multiple = plan.multipleCount || 0;
    const passage = plan.passageCount || 0;
    const passageSub = plan.passageSingleCount || 0;
    const paper =
        plan.paperNumber === 1 || plan.paperNumber === 2
            ? ` Paper ${plan.paperNumber}.`
            : "";

    if (profile === "jee_advanced") {
        return `
**PLANNED JEE ADVANCED FORMAT${paper} (mandatory — use exact counts):**
- **${single}** standalone \`single\` (include match-column / assertion-reason style among these)
- **${multiple}** standalone \`multiple\` (multi-correct — essential for Advanced authenticity)
- **${passage}** \`connected\` passage(s) × **${passageSub || 2}** sub-question(s) each
Do not convert multi-correct into single-correct to simplify.`;
    }

    return `
**PLANNED JEE MAIN FORMAT${paper} (mandatory — use exact counts):**
- **${single}** standalone \`single\` (include numerical-as-four-options MCQs for Section B simulation)
- **${multiple}** standalone \`multiple\` (multi-correct where planned)
- **${passage}** \`connected\` passage(s) × **${passageSub || 2}** sub-question(s) each
Section A tone: conceptual + application singles. Numerical Section B tone: singles with 4 numeric options.`;
};

/** Short hint for count-inference — dynamic from context, not subject catalogs. */
export const buildExamCountStyleHint = ({
    examProfile = "competitive",
    catSection = null,
    topic = "",
    categoryTrail = "",
    subjectLabel = "",
    categoryPaths = [],
    bankName = "",
    sectionName = "",
} = {}) => {
    const examLabel = getExamLabel(examProfile, catSection);
    const scope = getGenerationTopicFocus({ topic, sectionName, bankName }) || categoryTrail || "the stated topic";
    if (
        isJeeFullPaperTopic({ topic, sectionName, bankName, categoryPaths })
    ) {
        if (examProfile === "jee_advanced") {
            return `${examLabel} full paper: PCM mix + **pattern variety** (single + multi-correct + connected passages) — Advanced depth, not Main formula drills. ${scope}`;
        }
        return `${examLabel} full paper: PCM mix + singles (incl. numerical-as-MCQ) + some multi-correct + optional passages — Main shift-paper breadth. ${scope}`;
    }
    if (examProfile === "jee_advanced") {
        return `${examLabel}: multi-correct + match-column singles + connected sets — Advanced insight/depth, NOT Main speed. Topic: "${scope}".`;
    }
    if (examProfile === "jee_main") {
        return `${examLabel}: singles (incl. numerical-as-four-options for Section B style) + optional multi-correct + passages — Main shift breadth. Topic: "${scope}".`;
    }
    if (catSection === "cat_varc") {
        return `${examLabel}: RC passages (connected) + VA singles (para jumbles, odd sentence out, para summary) — NOT grammar/vocab/GMAT drills. Topic: "${scope}".`;
    }
    return `${examLabel}: infer question types and counts from real ${examLabel} pattern for topic "${scope}"${subjectLabel ? ` (${subjectLabel})` : ""} — match exam reference, fill available slots, solve-then-write each item.`;
};

// Back-compat aliases (call sites may still import old names)
export const buildNeetAuthoringBlock = (opts = {}) =>
    buildExamAuthoringBlock({ examProfile: "neet", ...opts });
export const buildJeeAuthoringBlock = (opts = {}) =>
    buildExamAuthoringBlock({ examProfile: opts.examProfile || "jee_main", ...opts });
export const buildJeeToughnessBlock = (opts = {}) =>
    buildExamToughnessBlock({ examProfile: opts.examProfile || "jee_main", ...opts });
export const buildJeeAnswerKeyLockBlock = buildExamAnswerKeyLockBlock;
export const buildNeetFirstPassQualityBlock = buildNeetAuthoringBlock;

export const resolveExamPromptContext = ({
    bankName = "",
    topic = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
} = {}) => {
    const examProfile = detectExamProfile({
        bankName,
        topic,
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
    return { examProfile, catSection };
};

export { parseCategoryScope } from "./subjectDetection.js";
