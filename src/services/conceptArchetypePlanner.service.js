/**
 * AI-driven concept-slot steering — plans diverse hard archetypes + per-slot blueprints
 * for each generation batch. Falls back to the static catalog when disabled or on failure.
 */

import {
    buildScoringConceptPlanningBlock,
    allocateScoringConceptSlots,
    isJeeMainScoringConceptsAvailable,
} from "./jeeMainScoringConcept.service.js";
import {
    buildOfficialSyllabusPlanningBlock,
} from "./jeeMainOfficialSyllabus.service.js";
import { buildNcertHardArchetypePlanBlock } from "./ncertChapterReference.service.js";
import {
    buildJeeAdvancedPlannerInjection,
    isJeeAdvancedMathsDataAvailable,
} from "./jeeAdvancedMaths.service.js";
import {
    buildJeeAdvancedPhysicsPlannerInjection,
    isJeeAdvancedPhysicsDataAvailable,
} from "./jeeAdvancedPhysics.service.js";

/**
 * Known-deleted / out-of-scope topics per subject+exam, seeded into the planning
 * prompt so the model doesn't rely solely on its own (possibly stale) syllabus
 * knowledge. Keyed by subjectId; applies to JEE-style engineering entrances.
 */
const SYLLABUS_EXCLUSION_SEED = {
    physics: [
        "Carnot engine / Carnot cycle efficiency (deleted from rationalized NCERT)",
        "Radioactivity — decay law, half-life, activity (deleted from rationalized NCERT)",
        "Doppler effect in sound/waves (deleted from rationalized NCERT)",
        "Earth's magnetism — dip, declination, neutral points (deleted from rationalized NCERT)",
        "Special relativity — time dilation, length contraction, relativistic momentum (outside JEE syllabus)",
        "Advanced ordinary differential equations as a solving method (college-level, outside JEE syllabus)",
        "Infinite 2D resistor/capacitor networks (college-level, outside JEE syllabus)",
    ],
};

const getSyllabusExclusionSeed = (subjectId = "") =>
    SYLLABUS_EXCLUSION_SEED[String(subjectId).toLowerCase().trim()] || [];

/**
 * Question-kind taxonomy. A real paper is not one bucket — it mixes:
 *  - theory        : pure conceptual / assertion-reason (no computation)
 *  - direct        : direct single-formula / single-concept numerical MCQ
 *  - multi_concept : moderate/multi-step, multi-concept application (peak hard)
 */
export const QUESTION_KINDS = ["theory", "direct", "multi_concept"];

/**
 * Default composition per exam profile — fractions (summing to ~1) of slots that
 * should be theory / direct / multi_concept. Used to steer the planner prompt and to
 * allocate kinds deterministically in the catalog fallback. These mirror real paper
 * norms (e.g. a JEE Main paper skews to direct formula items with a multi-concept tail
 * and a few pure-theory questions); the AI overrides them per exam when steering is on.
 */
const DEFAULT_COMPOSITION = {
    jee_main: { theory: 0.12, direct: 0.5, multi_concept: 0.38 },
    jee_advanced: { theory: 0.08, direct: 0.32, multi_concept: 0.6 },
    neet: { theory: 0.3, direct: 0.45, multi_concept: 0.25 },
    board: { theory: 0.35, direct: 0.4, multi_concept: 0.25 },
    cat: { theory: 0.2, direct: 0.35, multi_concept: 0.45 },
    competitive: { theory: 0.2, direct: 0.4, multi_concept: 0.4 },
};

const CAT_SECTION_COMPOSITION = {
    cat_varc: { theory: 0.8, direct: 0.1, multi_concept: 0.1 },
    cat_qa: { theory: 0.05, direct: 0.45, multi_concept: 0.5 },
    cat_dilr: { theory: 0.1, direct: 0.25, multi_concept: 0.65 },
};

/**
 * Whether a paper is theory-heavy or calculation-heavy is driven by the
 * SUBJECT, not just the exam. A NEET Botany paper is ~mostly theory while NEET
 * Physics is calculation-heavy — yet both share the `neet` profile. These
 * subject rules override the profile default so the composition (and the anchor
 * the planner LLM is steered with) reflects the actual subject. First match wins.
 */
const SUBJECT_COMPOSITION_RULES = [
    {
        // Biology / life sciences — overwhelmingly conceptual.
        re: /\b(botany|zoology|biolog(?:y|ical)?|life\s*science|micro\s*biolog|physiolog|anatomy|ecolog|genetics)\b/i,
        comp: { theory: 0.8, direct: 0.12, multi_concept: 0.08 },
    },
    {
        // Humanities / GK / verbal / law — theory-dominant.
        re: /\b(history|polit(?:y|ical)|civics|geograph|econom|general\s*(?:knowledge|studies|awareness)|gk|current\s*affairs|law|legal|english|verbal|comprehension|literatur|environment)\b/i,
        comp: { theory: 0.78, direct: 0.12, multi_concept: 0.1 },
    },
    {
        // Math / quantitative — calculation-dominant.
        re: /\b(math(?:s|ematic)?|quant(?:itative)?|aptitude|arithmetic|algebra|calculus|trigonometry|mensuration)\b/i,
        comp: { theory: 0.05, direct: 0.45, multi_concept: 0.5 },
    },
    {
        // Physics — calculation-heavy with a small conceptual tail.
        re: /\b(physics|mechanics|electrodynamics|electrostatics|optics|thermodynamics)\b/i,
        comp: { theory: 0.12, direct: 0.5, multi_concept: 0.38 },
    },
    {
        // Chemistry — mixed: physical chem is numeric, organic/inorganic is theory.
        re: /\b(chemistry|chemical|organic|inorganic)\b/i,
        comp: { theory: 0.4, direct: 0.35, multi_concept: 0.25 },
    },
];

const getSubjectComposition = (subject = "") => {
    const s = String(subject || "");
    if (!s.trim()) return null;
    for (const rule of SUBJECT_COMPOSITION_RULES) {
        if (rule.re.test(s)) return rule.comp;
    }
    return null;
};

/**
 * Optional overrides that force a fixed theory/direct/multi_concept mix.
 * AI_QB_FORCE_ALL_MULTI=1 → 100% multi_concept (max difficulty).
 * AI_QB_HARD_MULTI_HEAVY=1 (default for exam-calibrated via getDefaultComposition
 * when examCalibrated is passed) → mostly multi, few theory, almost no direct.
 */
/** Exam-calibrated hard banks: multi-concept heavy (not 50% direct easy drills). */
const EXAM_HARD_MULTI_HEAVY = {
    theory: 0.05,
    direct: 0.1,
    multi_concept: 0.85,
};

const ALL_MULTI = { theory: 0, direct: 0, multi_concept: 1 };

const getDefaultComposition = (
    examProfile = "",
    catSection = "",
    subject = "",
    { examCalibrated = false, bankDifficulty = "" } = {}
) => {
    const key = String(examProfile || "").toLowerCase().trim();
    // Read env at call time so scripts can set AI_QB_FORCE_ALL_MULTI before generation.
    if (
        process.env.AI_QB_FORCE_ALL_MULTI === "1" ||
        process.env.AI_QB_FORCE_ALL_MULTI === "true"
    ) {
        if (key === "jee_main" || key === "jee_advanced" || key === "neet" || !key) {
            return ALL_MULTI;
        }
    }

    const hardTier =
        examCalibrated ||
        String(bankDifficulty || "").toLowerCase().includes("hard");
    const multiHeavy =
        process.env.AI_QB_HARD_MULTI_HEAVY === "1" ||
        process.env.AI_QB_HARD_MULTI_HEAVY === "true" ||
        // Default ON for JEE/NEET hard/exam-calibrated — was shipping ~50% direct Easy.
        (hardTier &&
            (key === "jee_main" || key === "jee_advanced" || key === "neet") &&
            process.env.AI_QB_HARD_MULTI_HEAVY !== "0" &&
            process.env.AI_QB_HARD_MULTI_HEAVY !== "false");

    if (multiHeavy && (key === "jee_main" || key === "jee_advanced" || key === "neet")) {
        return EXAM_HARD_MULTI_HEAVY;
    }

    const section = String(catSection || "").toLowerCase();
    if (CAT_SECTION_COMPOSITION[section]) return CAT_SECTION_COMPOSITION[section];
    // Subject character (theory vs calculation) takes precedence over the
    // exam-level default so e.g. NEET Botany is theory-heavy, NEET Physics is not.
    const bySubject = getSubjectComposition(subject);
    if (bySubject) return bySubject;
    return DEFAULT_COMPOSITION[key] || DEFAULT_COMPOSITION.competitive;
};

/**
 * Public: subject-aware integer theory/direct/multi_concept counts for a batch.
 * Lets non-archetype generation paths (e.g. full-paper combined generation, which
 * bypasses solve-first) enforce the same composition the planner uses.
 */
export const getKindCompositionCounts = ({
    examProfile = "",
    subject = "",
    catSection = "",
    count = 10,
    examCalibrated = false,
    bankDifficulty = "",
} = {}) =>
    compositionToCounts(
        getDefaultComposition(examProfile, catSection, subject, {
            examCalibrated,
            bankDifficulty,
        }),
        Math.max(1, Number(count) || 1)
    );

/** Turn a composition (fractions) into integer slot counts that sum to n. */
const compositionToCounts = (composition, n) => {
    const kinds = QUESTION_KINDS;
    const raw = kinds.map((k) => ({ k, exact: (composition[k] || 0) * n }));
    const counts = raw.map((r) => ({ k: r.k, n: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
    let assigned = counts.reduce((a, c) => a + c.n, 0);
    // Distribute the remainder to the largest fractional parts.
    const order = [...counts].sort((a, b) => b.frac - a.frac);
    let i = 0;
    while (assigned < n && order.length) {
        order[i % order.length].n += 1;
        assigned += 1;
        i += 1;
    }
    return Object.fromEntries(counts.map((c) => [c.k, c.n]));
};

import { parseJsonObjectFromAIText } from "../utils/aiJsonRepair.js";
import {
    allocateRankedConceptSlots,
    getArchetypeBlueprint,
    enrichBlueprintWithConceptFusion,
    getSubjectLabelForArchetypes,
} from "./conceptArchetypeGuidance.service.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { isVeteranDifficultyEnabled } from "./hardQuestionMandate.service.js";
import {
    buildVeteranExamineeCaliberBlock,
    getExamLabel,
} from "./examPromptContext.service.js";

/** Default ON — set AI_QB_ARCHETYPE_STEERING=0 to use static catalog only. */
export const isAiArchetypeSteeringEnabled = () => {
    const flag = process.env.AI_QB_ARCHETYPE_STEERING;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const slugify = (text = "") =>
    String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 64);

const normalizeBlueprint = (raw = {}) => ({
    pattern: String(raw.pattern || raw.problemPattern || "").trim(),
    required: String(raw.required || raw.requirements || "").trim(),
    banned: String(raw.banned || raw.forbidden || "").trim(),
    stemHint: String(raw.stemHint || raw.exampleStem || "").trim(),
});

/**
 * Normalize a planned slot's question kind into the 3-way taxonomy.
 * Unknown/empty → multi_concept (preserves the legacy peak-hard "calculative" behavior).
 */
export const normalizeQuestionKind = (raw = "") => {
    const v = String(raw || "").toLowerCase().trim();
    if (/theor|concept(?!.*multi)|qualitativ|assertion|reason|statement/.test(v)) {
        // "conceptual" reads as theory unless it's "multi-concept"
        if (/multi|application|fus/.test(v)) return "multi_concept";
        return "theory";
    }
    if (/direct|single[-_\s]?(formula|step|concept)|formula[-_\s]?based|plug/.test(v)) {
        return "direct";
    }
    if (/multi|application|fus|calculativ|numeric/.test(v)) return "multi_concept";
    return "multi_concept";
};

const normalizeSlotPlan = (raw = {}, index = 0) => {
    const label = String(raw.label || raw.title || raw.topic || "").trim();
    const conceptSlot =
        String(raw.conceptSlot || raw.id || "").trim() ||
        slugify(label) ||
        `ai_slot_${index + 1}`;
    const blueprint = enrichBlueprintWithConceptFusion(
        conceptSlot,
        normalizeBlueprint(raw)
    );
    return {
        conceptSlot,
        label: label || conceptSlot.replace(/_/g, " "),
        questionKind: normalizeQuestionKind(
            raw.questionKind || raw.kind || raw.type
        ),
        blueprint,
    };
};

export const buildArchetypePlanningPrompt = ({
    topic = "",
    bankName = "",
    subject = "",
    subjectId = "",
    examProfile = "competitive",
    catSection = null,
    bankDifficulty = "hard",
    count = 10,
    excludeArchetypes = [],
    excludeQuestionTexts = [],
    examCalibrated = false,
    topicRelevanceFeedback = null,
    generateIntent = "initial",
    planningFeedback = "",
    adminExcludeTopics = [],
    examReferenceBlock = "",
} = {}) => {
    const n = Math.max(1, count);
    const subjectLabel = getSubjectLabelForArchetypes(subjectId || subject);
    const examLabel = getExamLabel(examProfile, catSection);
    const defComp = getDefaultComposition(
        examProfile,
        catSection,
        `${subjectId || ""} ${subject || ""}`,
        { examCalibrated, bankDifficulty }
    );
    const sc = compositionToCounts(defComp, n);
    const referenceBlock = String(examReferenceBlock || "").trim()
        ? `\n**Real-paper reference (researched — use it to set the composition):**\n${String(
              examReferenceBlock
          )
              .trim()
              .slice(0, 2500)}\n`
        : "";
    const forcedAllHard = defComp.theory === 0 && defComp.direct === 0;
    const kindMixBlock = forcedAllHard
        ? `
**Question composition — MANDATORY, NOT A SUGGESTION:**
Every one of the ${n} slots MUST be tagged \`questionKind: "multi_concept"\` — **zero** \`theory\`, **zero** \`direct\`. This bank is explicitly configured for maximum difficulty, overriding what a "typical" ${examLabel} paper looks like. Each slot must fuse **≥2 concepts** and require a **multi-step derivation** (≥4 solve steps) that a well-prepared veteran repeater with 1000+ mock attempts would need several minutes on, and a meaningful share should be hard enough that even a strong veteran cannot reliably solve it within the time limit. Do not tag anything \`theory\` or \`direct\` — that guidance does not apply to this bank. Still write each slot's \`pattern\`/\`required\`/\`banned\` at multi_concept depth (fused, multi-step).
${referenceBlock}`
        : `
**Question composition (determine the mix for THIS exam from authentic recent papers, then tag every slot):**
A real ${examLabel} ${subjectLabel} paper is **not** one bucket. Set \`questionKind\` on each slot to exactly one of:
- \`theory\` — pure conceptual / qualitative: assertion–reason, statement-correctness, match-the-column reasoning, mechanism/definition discrimination. **No numeric givens, no calculation.** Still **hard** for this exam (close distractors, multi-statement traps) — theory ≠ easy.
- \`direct\` — a **direct single-formula / single-concept numerical** MCQ: one clean formula or one concept applied in ~1–2 steps. Still **hard** (non-obvious application, careful units/limits) — direct ≠ easy drill.
- \`multi_concept\` — **multi-step, multi-concept** application: ≥2 fused concepts, ≥3 solve steps — the fused/peak items.

**Hard difficulty ≠ all multi_concept.** Do NOT tag every slot \`multi_concept\` just because the bank is hard. Hard means each kind is exam-caliber within its type. Target mix for ${n} slots ≈ **${sc.theory} theory · ${sc.direct} direct · ${sc.multi_concept} multi_concept** (adjust for subject: Biology/GK → more theory; Advanced Maths → more multi_concept). Write each slot's \`pattern\`/\`required\`/\`banned\` to match its kind.
${referenceBlock}`;
    const tierNote = examCalibrated
        ? "Slots are **exam-native hard** for this profile across ALL kinds — `multi_concept` = fused multi-step, `direct` = hard single-concept numericals (not easy drills), `theory` = hard conceptual (not trivia). Never collapse the whole plan to multi_concept only."
        : `Bank difficulty profile: **${bankDifficulty}** — calibrate each slot to real ${examLabel} **hard** depth for its kind (theory / direct / multi_concept). Hard does not mean every slot is multi_concept.`;

    const excludeArchetypeBlock = excludeArchetypes.length
        ? `\n**Already used in this question bank (do NOT repeat these problem types or near-clones):**\n${[
              ...new Set(excludeArchetypes.map(String).filter(Boolean)),
          ]
              .slice(0, 40)
              .map((a) => `- ${a}`)
              .join("\n")}\n`
        : "";

    const excludeStemBlock = excludeQuestionTexts.length
        ? `\n**Excluded stems / structures (different setup, not same logic with new numbers):**\n${excludeQuestionTexts
              .slice(0, 20)
              .map((t, i) => `${i + 1}. ${String(t).slice(0, 180)}`)
              .join("\n")}\n`
        : "";

    const regenBlock =
        generateIntent === "evaluation_regen" && topicRelevanceFeedback
            ? `\n**EVALUATION REGENERATION — fix these gaps from prior audit:**\n${String(
                  topicRelevanceFeedback.regenerationInstructions ||
                      topicRelevanceFeedback.summary ||
                      ""
              ).slice(0, 1500)}\nDifficulty match was ${topicRelevanceFeedback.difficultyMatchScore ?? topicRelevanceFeedback?.dimensionScores?.difficultyMatch ?? "low"} — plan slots that score 80+ on shift-paper depth.\n`
            : "";

    const exclusionSeed = getSyllabusExclusionSeed(subjectId || subject);
    const adminExcluded = [
        ...new Set((adminExcludeTopics || []).map(String).map((t) => t.trim()).filter(Boolean)),
    ].slice(0, 40);
    const seededExclusions = [...exclusionSeed, ...adminExcluded];
    const syllabusExclusionBlock = seededExclusions.length
        ? `\n**Known excluded topics (never plan a slot on these):**\n${seededExclusions
              .map((t) => `- ${t}`)
              .join("\n")}\n`
        : "";

    // Admin re-planning: the reviewer looked at the last topic plan and asked
    // for changes (include X, drop Y, more of Z). This overrides the model's
    // own topic choices where it conflicts.
    const planningFeedbackBlock = String(planningFeedback || "").trim()
        ? `\n**REVIEWER FEEDBACK — re-plan the topic list to honor this (highest priority):**\n${String(
              planningFeedback
          )
              .trim()
              .slice(0, 1500)}\nApply it exactly: add any topics the reviewer asked for, drop any they rejected (also add rejected ones to \`excludedTopics\`), and keep the rest of the plan fresh — do not simply repeat the previous slots.\n`
        : "";

    const isAdvMaths =
        String(examProfile || "").toLowerCase() === "jee_advanced" &&
        isJeeAdvancedMathsDataAvailable() &&
        /\bmath/i.test(
            `${subjectId || ""} ${subject || ""} ${topic || ""} ${bankName || ""}`
        );
    const isAdvPhysics =
        String(examProfile || "").toLowerCase() === "jee_advanced" &&
        isJeeAdvancedPhysicsDataAvailable() &&
        /\bphysics\b/i.test(
            `${subjectId || ""} ${subject || ""} ${topic || ""} ${bankName || ""}`
        );
    const isAdvSubjectPack = isAdvMaths || isAdvPhysics;

    // JEE Advanced Maths/Physics: prefer dedicated Advanced pack (syllabus +
    // hard archetypes + scoring). Fall back to Main packs only if Advanced data missing.
    const advancedPlannerBlock = isAdvMaths
        ? buildJeeAdvancedPlannerInjection({
              subject: subjectId || subject,
              subjectId: subjectId || subject,
              examProfile,
              bankDifficulty,
              count: n,
              highOnly:
                  String(bankDifficulty || "").toLowerCase().includes("hard") ||
                  examCalibrated,
          })
        : isAdvPhysics
          ? buildJeeAdvancedPhysicsPlannerInjection({
                subject: subjectId || subject,
                subjectId: subjectId || subject,
                examProfile,
                bankDifficulty,
                count: n,
                highOnly:
                    String(bankDifficulty || "")
                        .toLowerCase()
                        .includes("hard") || examCalibrated,
            })
          : "";

    const scoringConceptBlock = isAdvSubjectPack
        ? ""
        : buildScoringConceptPlanningBlock({
              subject: subjectId || subject,
              examProfile,
              bankDifficulty,
              examCalibrated,
              count: n,
          });

    const officialSyllabusBlock = isAdvSubjectPack
        ? ""
        : buildOfficialSyllabusPlanningBlock({
              subject: subjectId || subject,
              examProfile,
          });

    // File-backed hard archetypes — Advanced Maths/Physics packs already inject them.
    const ncertHardArchetypeBlock =
        !isAdvSubjectPack &&
        (String(bankDifficulty || "").toLowerCase().includes("hard") ||
            examCalibrated)
            ? buildNcertHardArchetypePlanBlock({
                  subject: subjectId || subject || topic || bankName,
              })
            : "";

    const advSyllabusStep0Header = isAdvPhysics
        ? `**Step 0 — official JEE Advanced Physics syllabus lock (file-backed):**
Use the JEE Advanced Physics topic list (P01–P19) and hard-topic scoring below as the only in-scope source. Put anything outside that list in \`excludedTopics\`. Prefer HIGH advanced_relevance topics for hard banks.`
        : `**Step 0 — official JEE Advanced Mathematics syllabus lock (file-backed):**
Use the JEE Advanced topic list (M01–M19) and hard-topic scoring below as the only in-scope source. Put anything outside that list in \`excludedTopics\`. Prefer HIGH advanced_relevance topics for hard banks.`;

    const syllabusStep0 = advancedPlannerBlock
        ? `${advSyllabusStep0Header}
${advancedPlannerBlock}`
        : officialSyllabusBlock
          ? `**Step 0 — official syllabus lock (file-backed, not model memory):**
Use the OFFICIAL JEE (Main) 2026 unit list below as the only in-scope source. Put anything outside that list in \`excludedTopics\`. Do not rely on memorized/deleted chapters.
${officialSyllabusBlock}`
          : `**Step 0 — determine syllabus scope first:**
Before planning any slot, work out what is actually in-scope for the **current ${examLabel} syllabus** on this topic (rationalized NCERT / current exam pattern). List any topic you are deliberately leaving out — recently deleted chapters, or topics that read as this subject but are outside this exam's syllabus (e.g. college-level material) — in \`excludedTopics\`. Then plan every slot ONLY from what remains in scope. If you are unsure whether a topic was deleted, treat it as excluded rather than risk an out-of-syllabus question.
${syllabusExclusionBlock}`;

    return `You are a senior ${examLabel} ${subjectLabel} paper setter. Plan **${n} distinct question archetypes** for the next generation batch, composed like a real ${examLabel} paper (mix of theory / direct / multi-concept — see composition below).

**Topic / syllabus context:** ${topic || bankName}
**Subject: ${subjectLabel}** — every slot must be pure ${subjectLabel} content. Do NOT invent a slot from a different subject (e.g. no Physics archetype/conceptFusion in a Chemistry plan, no Chemistry in a Maths plan) even though this is a combined exam — the bank being planned is ${subjectLabel}-only.
**Exam:** ${examLabel}
${tierNote}
${buildVeteranExamineeCaliberBlock({ examProfile })}

Your output steers a downstream question writer. Plan **exam-native items** (mixed by kind per the composition below) spread across the **full syllabus** for this topic — not one chapter only.

${syllabusStep0}
${officialSyllabusBlock || advancedPlannerBlock ? syllabusExclusionBlock : ""}
${planningFeedbackBlock}
${excludeArchetypeBlock}${excludeStemBlock}${regenBlock}
${scoringConceptBlock}
${ncertHardArchetypeBlock}
${kindMixBlock}

**Planning rules:**
1. **${n} unique slots** — different micro-topic, setup, and solving chain; no near-duplicate templates.
2. **Match the composition above + full coverage:** assign each slot's \`questionKind\` so the batch mix reflects a real ${examLabel} paper (see composition block). Spread \`multi_concept\`, \`direct\`, and \`theory\` across **different syllabus units** so all major topic areas get a slot when batch size allows.
3. **Syllabus breadth** — spread across major ${subjectLabel} areas appropriate to the topic and exam (do not cluster on one unit), and only within the official/in-scope units from Step 0. When a scoring-concept list is provided above, prefer those high-weightage chapters **only if they also appear in the official syllabus**.
${
    String(bankDifficulty || "").toLowerCase() === "hard" || examCalibrated
        ? `3b. **Hard-topic lock:** Because difficulty is **hard**, every included topic / \`conceptSlot\` MUST come from the hard-leaning scoring list (Hard>0 or predominantly-hard). Do **not** include predominantly-easy / easy-only chapters in \`includedTopics\`. Put easy-only chapters in \`excludedTopics\` if they appear in your reasoning.\n`
        : ""
}4. **Depth per kind:** \`multi_concept\` = ≥2 linked concepts (state fusion in \`conceptFusion\`), ≥3 solve steps, no single-formula plug-in. \`direct\` = ONE clean formula/concept, ~1–2 steps (single-formula is correct — do NOT force fusion). \`theory\` = conceptual depth + close distractors, no computation.
5. **conceptFusion** = the fused ideas for a \`multi_concept\` slot (e.g. "rotation + friction"); optional for \`direct\`/\`theory\`.
6. **conceptSlot** = short snake_case id you invent (e.g. \`rolling_threshold_mu\`, \`ohms_law_direct\`).
7. **pattern** = what problem shape to write (1–2 sentences), matching the slot's kind.
8. **required** = mandatory stem/solve constraints for that kind (1–2 sentences).
9. **banned** = templates to reject (1 sentence).
10. **stemHint** = one example stem shape — writer must create a NEW problem, not copy verbatim.

Return ONLY valid JSON (set \`questionKind\` — one of "theory" | "direct" | "multi_concept" — on every slot):
{
  "excludedTopics": ["Carnot engine — deleted from rationalized NCERT", "Special relativity — outside JEE syllabus"],
  "composition": { "theory": ${sc.theory}, "direct": ${sc.direct}, "multi_concept": ${sc.multi_concept} },
  "slots": [
    {
      "conceptSlot": "rolling_threshold_mu",
      "questionKind": "multi_concept",
      "conceptFusion": "rolling motion + friction threshold",
      "label": "Rolling threshold on rough incline",
      "pattern": "Solid body rolling without slipping on incline — find μ threshold or acceleration with torque + friction.",
      "required": "Link rotation and translation; friction appears in both force and torque equations.",
      "banned": "Bare τ = Iα with all values listed; single energy conservation line only.",
      "stemHint": "A solid sphere on a rough incline of angle θ — find minimum μ for pure rolling."
    },
    {
      "conceptSlot": "lens_formula_direct",
      "questionKind": "direct",
      "label": "Direct thin-lens image distance",
      "pattern": "One clean application of the thin-lens formula — given object distance and focal length, find the image distance.",
      "required": "Single formula, ~1–2 steps; a straightforward numerical MCQ with a clear numeric answer.",
      "banned": "Multi-lens systems; combined mirror+lens; anything needing fused concepts.",
      "stemHint": "A convex lens of focal length 20 cm forms an image of an object placed 30 cm away — find the image distance."
    },
    {
      "conceptSlot": "em_induction_assertion_reason",
      "questionKind": "theory",
      "conceptFusion": "Lenz's law + induced-current direction reasoning",
      "label": "Assertion–reason on induced current direction",
      "pattern": "Assertion–reason or statement-correctness item probing conceptual understanding; no numbers to plug in.",
      "required": "Discriminate a subtly wrong reason from a correct one; test the concept, not a formula.",
      "banned": "Any numeric given; any single-fact restatement that is trivially true.",
      "stemHint": "Assertion: induced current opposes the change in flux. Reason: ... — judge both and their link."
    }
  ]
}`;
};

export const parseArchetypePlanResponse = (rawText, expectedCount = 1) => {
    const parsed = parseJsonObjectFromAIText(rawText);
    const rows = Array.isArray(parsed?.slots)
        ? parsed.slots
        : Array.isArray(parsed)
          ? parsed
          : [];
    const excludedTopics = Array.isArray(parsed?.excludedTopics)
        ? parsed.excludedTopics.map(String).filter(Boolean).slice(0, 30)
        : [];
    const plans = rows
        .map((row, i) => normalizeSlotPlan(row, i))
        .filter((p) => p.blueprint.pattern || p.blueprint.required);
    const seen = new Set();
    const unique = [];
    for (const plan of plans) {
        const key = plan.conceptSlot.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(plan);
    }
    const result = unique.slice(0, Math.max(1, expectedCount));
    result.excludedTopics = excludedTopics;
    return result;
};

/**
 * If the planner tagged nearly everything multi_concept (common when "hard"
 * is misread as "all multi"), redistribute kinds to match the exam/subject
 * composition. Preserves labels/blueprints; only rewrites questionKind.
 */
export const rebalanceSlotPlanKinds = (
    slotPlans = [],
    {
        examProfile = "",
        catSection = "",
        subject = "",
        force = false,
    } = {}
) => {
    const plans = Array.isArray(slotPlans) ? [...slotPlans] : [];
    if (plans.length < 2) return plans;

    const target = compositionToCounts(
        getDefaultComposition(examProfile, catSection, subject),
        plans.length
    );
    // Forced all-multi profiles keep the AI tags as-is.
    if (target.theory === 0 && target.direct === 0) return plans;

    const counts = { theory: 0, direct: 0, multi_concept: 0 };
    for (const p of plans) {
        const k = normalizeQuestionKind(p.questionKind);
        counts[k] = (counts[k] || 0) + 1;
    }
    const multiShare = counts.multi_concept / plans.length;
    const needsRebalance =
        force ||
        (multiShare >= 0.85 && (target.direct > 0 || target.theory > 0)) ||
        (counts.direct === 0 && target.direct >= 2) ||
        (counts.theory === 0 && target.theory >= 1);

    if (!needsRebalance) return plans;

    const desiredKinds = [];
    for (let i = 0; i < (target.theory || 0); i++) desiredKinds.push("theory");
    for (let i = 0; i < (target.direct || 0); i++) desiredKinds.push("direct");
    while (desiredKinds.length < plans.length) desiredKinds.push("multi_concept");

    const rebalanced = plans.map((p, i) => ({
        ...p,
        questionKind: desiredKinds[i] || "multi_concept",
    }));
    pipelineTrace("TOPIC_KIND_REBALANCE", {
        before: counts,
        after: {
            theory: desiredKinds.filter((k) => k === "theory").length,
            direct: desiredKinds.filter((k) => k === "direct").length,
            multi_concept: desiredKinds.filter((k) => k === "multi_concept")
                .length,
        },
        reason: force ? "forced" : "planner_over_multi",
    });
    return rebalanced;
};

const buildFallbackSteering = ({
    count,
    examProfile,
    subjectId,
    slotOffset,
    subjects,
    bankDifficulty,
    preferPeak,
    excludeArchetypes,
    examCalibrated = false,
}) => {
    const profile = String(examProfile || "").toLowerCase();
    const useScoringFallback =
        (profile === "jee_main" || profile === "jee_advanced") &&
        isJeeMainScoringConceptsAvailable() &&
        (preferPeak ||
            examCalibrated ||
            String(bankDifficulty || "").toLowerCase() === "hard");
    const scoringSlots = useScoringFallback
        ? allocateScoringConceptSlots(count, {
              subject: subjectId,
              slotOffset,
              preferHard: true,
              hardTopicsOnly: true,
          })
        : [];
    const conceptSlots =
        scoringSlots.length === Math.max(1, count)
            ? scoringSlots
            : allocateRankedConceptSlots(count, {
                  examProfile,
                  subjectId,
                  slotOffset,
                  subjects,
                  preferPeak,
                  bankDifficulty,
                  excludeArchetypes,
                  maxPerArchetype:
                      isVeteranDifficultyEnabled() && examCalibrated ? 1 : 2,
              });
    // Deterministically assign a kind to each slot so the batch matches the profile's
    // default composition (theory / direct / multi_concept). Uses the global index
    // (slotOffset + i) so the mix stays consistent when filling a partial chunk. The
    // pattern is: multi_concept is the base; interleave direct and theory at their
    // share so they spread evenly rather than clustering.
    const comp = getDefaultComposition(
        examProfile,
        null,
        `${subjectId || ""} ${Array.isArray(subjects) ? subjects.join(" ") : subjects || ""}`
    );
    const risesAt = (frac, globalIndex) =>
        Math.floor((globalIndex + 1) * frac) > Math.floor(globalIndex * frac);
    const kindAt = (globalIndex) => {
        // theory takes priority, then direct, else multi_concept.
        if (risesAt(comp.theory || 0, globalIndex)) return "theory";
        if (risesAt(comp.direct || 0, globalIndex)) return "direct";
        return "multi_concept";
    };
    const theoryBlueprint = (conceptSlot) => ({
        conceptSlot,
        label: conceptSlot.replace(/_/g, " "),
        questionKind: "theory",
        blueprint: {
            pattern:
                "Conceptual/assertion-reason item on this slot — probe understanding, no numeric givens.",
            required:
                "Test the concept via close distractors or statement analysis; no computation.",
            banned: "Any numeric given or single-formula solve; trivially-true restatement.",
            stemHint: "",
        },
    });
    const directBlueprint = (conceptSlot) => ({
        conceptSlot,
        label: conceptSlot.replace(/_/g, " "),
        questionKind: "direct",
        blueprint: {
            pattern:
                "Direct single-formula / single-concept numerical MCQ on this slot — one clean solve.",
            required:
                "Apply one formula/concept in ~1–2 steps; clear numeric answer among the options.",
            banned: "Multi-concept fusion; ≥3-step derivations; anything needing linked concepts.",
            stemHint: "",
        },
    });
    const slotPlans = conceptSlots.map((conceptSlot, i) => {
        const questionKind = kindAt((slotOffset || 0) + i);
        if (questionKind === "theory") return theoryBlueprint(conceptSlot);
        if (questionKind === "direct") return directBlueprint(conceptSlot);
        const bp = getArchetypeBlueprint(conceptSlot);
        return {
            conceptSlot,
            label: conceptSlot.replace(/_/g, " "),
            questionKind,
            blueprint: bp
                ? {
                      pattern: bp.pattern,
                      required: bp.required,
                      banned: bp.banned,
                      stemHint: bp.stemHint || "",
                  }
                : {
                      pattern: "Multi-condition entrance numerical with linked concepts.",
                      required:
                          "≥2 concepts, ≥3 solve steps, constraint before the ask.",
                      banned: "Single-formula plug-in or chapter-test template.",
                      stemHint: "",
                  },
        };
    });
    return {
        conceptSlots,
        slotPlans,
        source: "catalog",
    };
};

/**
 * Resolve concept slots + blueprints for a batch — AI-first, catalog fallback.
 * @param {{ callLlm: (prompt: string) => Promise<string> }} deps
 */
export const resolveConceptArchetypeSteering = async (
    {
        count = 10,
        topic = "",
        bankName = "",
        subject = "",
        subjectId = "",
        examProfile = "competitive",
        catSection = null,
        bankDifficulty = "hard",
        examCalibrated = false,
        excludeArchetypes = [],
        excludeQuestionTexts = [],
        slotOffset = 0,
        subjects = null,
        preferPeak = false,
        topicRelevanceFeedback = null,
        generateIntent = "initial",
        planningFeedback = "",
        adminExcludeTopics = [],
        examReferenceBlock = "",
    },
    { callLlm } = {}
) => {
    const n = Math.max(1, count);
    const fallback = () =>
        buildFallbackSteering({
            count: n,
            examProfile,
            subjectId,
            slotOffset,
            subjects,
            bankDifficulty,
            preferPeak,
            excludeArchetypes,
            examCalibrated,
        });

    if (!isAiArchetypeSteeringEnabled() || typeof callLlm !== "function") {
        const result = fallback();
        pipelineTrace("ARCHETYPE_STEERING", {
            source: result.source,
            slotCount: result.conceptSlots.length,
        });
        return result;
    }

    try {
        const prompt = buildArchetypePlanningPrompt({
            topic,
            bankName,
            subject,
            subjectId,
            examProfile,
            catSection,
            bankDifficulty,
            count: n,
            excludeArchetypes,
            excludeQuestionTexts,
            examCalibrated,
            topicRelevanceFeedback,
            generateIntent,
            planningFeedback,
            adminExcludeTopics,
            examReferenceBlock,
        });
        const rawText = await callLlm(prompt);
        let slotPlans = parseArchetypePlanResponse(rawText, n);
        const excludedTopics = slotPlans.excludedTopics || [];

        if (slotPlans.length < n) {
            const need = n - slotPlans.length;
            const filler = buildFallbackSteering({
                count: need,
                examProfile,
                subjectId,
                slotOffset: slotOffset + slotPlans.length,
                subjects,
                bankDifficulty,
                preferPeak,
                excludeArchetypes: [
                    ...excludeArchetypes,
                    ...slotPlans.map((p) => p.conceptSlot),
                ],
            });
            slotPlans = [...slotPlans, ...filler.slotPlans];
        }

        slotPlans = rebalanceSlotPlanKinds(slotPlans.slice(0, n), {
            examProfile,
            catSection,
            subject: `${subjectId || ""} ${subject || ""}`,
        });

        const conceptSlots = slotPlans.map((p) => p.conceptSlot);
        pipelineTrace("ARCHETYPE_STEERING", {
            source: "ai",
            slotCount: conceptSlots.length,
            slots: conceptSlots.slice(0, 12),
            kinds: {
                theory: slotPlans.filter((p) => p.questionKind === "theory")
                    .length,
                direct: slotPlans.filter((p) => p.questionKind === "direct")
                    .length,
                multi_concept: slotPlans.filter(
                    (p) => p.questionKind === "multi_concept"
                ).length,
            },
            excludedTopics,
        });
        return {
            conceptSlots,
            slotPlans,
            excludedTopics,
            source: "ai",
        };
    } catch (err) {
        pipelineTrace("ARCHETYPE_STEERING_FALLBACK", {
            error: err?.message || String(err),
        });
        const result = fallback();
        return { ...result, source: "catalog_fallback" };
    }
};

export default {
    isAiArchetypeSteeringEnabled,
    buildArchetypePlanningPrompt,
    parseArchetypePlanResponse,
    rebalanceSlotPlanKinds,
    resolveConceptArchetypeSteering,
};
