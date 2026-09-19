/**
 * Resolve the user-selected exam for paper generation prompts.
 * Always prefer the wizard config's examLabel / examType — never hardcode
 * "JEE Advanced" when another exam was selected.
 */

import { getExamLabel } from "./examPromptContext.service.js";

/**
 * @param {string|{examType?: string, examLabel?: string}|null|undefined} configOrType
 * @returns {{ examType: string, examLabel: string }}
 */
export const resolvePaperExam = (configOrType = {}) => {
  const examType = String(
    typeof configOrType === "string"
      ? configOrType
      : configOrType?.examType || ""
  )
    .toLowerCase()
    .trim();

  const fromConfig =
    typeof configOrType === "object" && configOrType?.examLabel
      ? String(configOrType.examLabel).trim()
      : "";

  const examLabel =
    fromConfig ||
    (examType ? getExamLabel(examType) : "") ||
    (examType ? examType.replace(/_/g, " ") : "") ||
    "Exam";

  return {
    examType: examType || "competitive",
    examLabel,
  };
};

/** Score floor used by the paper writer for this exam (keep in sync with hardness lock). */
export const paperScoreFloor = (examType) => {
  const type = String(examType || "").toLowerCase();
  if (type === "jee_advanced") return 75;
  if (type === "jee_main" || type === "neet") return 70;
  return 68;
};

/**
 * Default questionKind stamped on generated seats.
 * Advanced pipeline historically forced multi_concept; Main must not.
 */
export const paperDefaultQuestionKind = (examType) => {
  const type = String(examType || "").toLowerCase();
  if (type === "jee_advanced") return "multi_concept";
  if (type === "jee_main" || type === "neet") return "direct";
  return "direct";
};

/**
 * Hardness guidance parameterized by the selected exam name.
 * Score bands + style rules differ by exam profile; wording is always dynamic.
 */
export const buildWriterHardnessLock = (examType, examLabel) => {
  const label = examLabel || "Exam";
  const type = String(examType || "").toLowerCase();
  const floor = paperScoreFloor(type);
  const band =
    type === "jee_advanced"
      ? { target: "78–88", floor }
      : type === "jee_main" || type === "neet"
        ? { target: "70–82", floor }
        : { target: "68–80", floor };

  if (type === "jee_main") {
    return `**JEE MAIN HARDNESS LOCK (NTA screening test — speed & accuracy)**
- Exam purpose: **screen** ~1.4M candidates — test speed, accuracy, broad coverage. NOT IIT selection depth.
- Solve-time target: **about 2–3 minutes** with a standard algorithm / short derivation.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: **ONE primary chapter concept** + short calculation (typically 2–4 clean steps). Topics stay in **silos**.
- Prefer **direct / single-idea** stems. Pattern recognition + computational speed are OK.
- **Banned for JEE Main (these are Advanced — do NOT write them):**
  - Coupled multi-equilibrium / simultaneous constraint puzzles (mass+charge balance as the core ask).
  - Multi-domain fusion (e.g. probability + positive-definite matrices; orbital energy + eccentricity + angular-momentum chain).
  - Non-routine “first principles” insight puzzles that need 2–3 major techniques fused.
- Allowed Main hardness: non-obvious setup **inside ONE chapter** (e.g. Ksp OR Ka separately; circular-orbit speed/energy one-hop; one counting inequality).
- Stay inside the assigned chapter. Set conceptSlot to a short slug of the ONE concept used.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "neet") {
    return `**NEET HARDNESS LOCK (NTA medical UG — accuracy & NCERT depth)**
- Exam purpose: **select** medical aspirants — test precise NCERT application, not IIT multi-technique fusion.
- Solve-time target: **about 1–2 minutes** with one clear concept + short calculation or elimination.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: **ONE primary chapter idea** with clinical/biological/chemical fidelity. Prefer direct MCQs.
- **Banned for NEET:** JEE Advanced-style multi-domain fusion, coupled constraint puzzles, integer/match formats unless the paper pattern explicitly requests them.
- Stay inside the assigned chapter; set conceptSlot to a short slug of the ONE concept used.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "jee_advanced") {
    return `**JEE ADVANCED HARDNESS LOCK (IIT selection test — depth & synthesis)**
- Exam purpose: **select** top qualifiers for IIT — test deep problem-solving, conceptual clarity, non-routine thinking. NOT Main speed drills.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**. If you cannot reach ${band.floor}, invent a harder stem — do not emit a soft item.
- Structure: **multi-concept integration / multi-step derivation** from first principles (not one formula plug-in).
- Prefer a **non-obvious first move** (substitution, hidden invariant, coupled constraint, case split). Pure plug-in = FAIL.
- Prefer **fusion of 2 major techniques** (optionally a tight third link). Never 4+ unrelated mini-problems glued together.
- Subject cues (Advanced style):
  - Chemistry: coupled equilibria / simultaneous constraints when appropriate.
  - Mathematics: intentional multi-domain links (e.g. algebra/matrix constraint → counting) when chapter-faithful.
  - Physics: dynamic state change (vector shift → energy/momentum → new orbit) rather than only $v=\\sqrt{GM/r}$.
- For **multiple-correct**: prefer 2–3 correct with attractive wrong options; not all A–D unless each needs a different argument.
- For **match**: List-I items share one conceptual spine; ban copy-paste clones that only change numbers.
- For **integer**: multi-step derivation (not a one-line count).
- Stay inside the assigned chapter. Stretch hardness by **idea**, not denser LaTeX.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "cat") {
    return `**CAT HARDNESS LOCK (IIMs — aptitude speed & logic)**
- Exam purpose: **screen** for IIMs — timed VARC / DILR / Quant with traps, not school homework.
- Solve-time target: **about 1–2 minutes** for a hard single item (sets/passages follow section norms).
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: exam-faithful CAT reasoning — one clear skill focus (quant trick, DI logic, RC inference). Prefer single-correct unless pattern says otherwise.
- **Banned:** JEE Advanced multi-concept fusion, physics/chem stems, Match-the-Following / multi-correct IIT formats.
- Stretch hardness by **trap options and non-obvious setup**, not denser notation.
- Stay inside the assigned section/topic; set conceptSlot to a short slug.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "gmat") {
    return `**GMAT FOCUS HARDNESS LOCK (graduate aptitude — reasoning & data)**
- Exam purpose: **measure** business-school readiness — Quantitative, Verbal, Data Insights under time.
- Solve-time target: **about 1.5–2 minutes** for a hard item.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: GMAT-faithful — clean stem, one primary skill, attractive wrong answers that catch common errors.
- **Banned:** JEE/IIT multi-technique fusion, Match-the-Following, multi-correct physics/chem puzzles.
- Prefer data sufficiency / problem solving / critical reasoning / DI style matching the assigned topic.
- Stay inside the assigned topic; set conceptSlot to a short slug.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "clat") {
    return `**CLAT UG HARDNESS LOCK (law entrance — comprehension & reasoning)**
- Exam purpose: **select** for NLUs — passage-based legal/current-affairs reasoning, not rote law codes.
- Solve-time target: **about 1–2 minutes** per MCQ within a passage set.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: CLAT-faithful — inference from passage, careful language, one clear skill.
- **Banned:** JEE Advanced STEM fusion, integer/match IIT formats, pure formula drills.
- Stay inside the assigned section/topic; set conceptSlot to a short slug.
- Questions must be independently solvable and verifiable.
- Prefer $...$ only if needed; no real newlines inside JSON strings.`;
  }

  if (type === "ibps" || type === "ssc_cgl_tier1" || type === "ssc_cgl_tier2") {
    return `**${String(label).toUpperCase()} HARDNESS LOCK (government aptitude — speed & accuracy)**
- Exam purpose: **screen** large candidate pools — timed Quant / Reasoning / English / GA as per section.
- Solve-time target: **under ~1 minute** for a hard single item (Tier-2 may allow slightly longer multi-step Quant).
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: exam-faithful banking/SSC style — one primary skill, clean calculation or logic chain.
- **Banned:** JEE Advanced multi-concept STEM fusion, Match-the-Following / multi-correct IIT formats unless the official pattern uses them.
- Stretch hardness by **speed traps and multi-step arithmetic/logic**, not denser LaTeX.
- Stay inside the assigned section/topic; set conceptSlot to a short slug.
- Questions must be independently solvable and verifiable.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
  }

  if (type === "upsc") {
    return `**UPSC CSE PRELIMS HARDNESS LOCK (civil services — conceptual GS)**
- Exam purpose: **screen** for Mains — test conceptual clarity across GS, not IIT problem-solving depth.
- Solve-time target: **about 1 minute** per hard MCQ with elimination.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**.
- Structure: UPSC Prelims-faithful — precise statement testing, current+static blend when topic allows, one clear ask.
- **Banned:** JEE Advanced multi-technique STEM puzzles, integer/match IIT formats, denser math for its own sake.
- Stay inside the assigned topic; set conceptSlot to a short slug.
- Questions must be independently solvable and verifiable.
- Prefer $...$ only if needed; no real newlines inside JSON strings.`;
  }

  return `**${String(label).toUpperCase()} HARDNESS LOCK (strict — hard seat)**
- Target: real ${label} hard — NOT routine school/homework drills, and NOT JEE Advanced fusion depth.
- difficultySelfScore target **${band.target}**; never below **${band.floor}**. If you cannot reach ${band.floor}, invent a harder stem — do not emit a soft item.
- Prefer exam-faithful single-skill reasoning for ${label}. Avoid pure plug-in one-liners and IIT multi-domain fusion.
- Stretch hardness by **idea and setup**, not denser LaTeX or longer arithmetic.
- Stay inside the assigned chapter/topic. If a conceptSlot is provided in TOPIC CONTEXT, use it; otherwise choose ONE Preferred hard concept slot and set conceptSlot to a short slug of that choice.
- Respect all banned templates.
- Questions must be independently solvable and verifiable.
- Avoid near-duplicate structure across questions.
- Do not artificially increase difficulty through ambiguity.
- Inside JSON strings use \\\\frac{a}{b}; prefer $...$; no real newlines.`;
};
