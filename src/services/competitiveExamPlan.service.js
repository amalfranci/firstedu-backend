import { detectCatSection, detectExamProfile } from "./examDifficultyCalibration.js";
import {
    allocateDifficultyMix,
    normalizeBankDifficulty,
    buildDifficultyAuditRubricsBlock,
} from "./difficultyMix.service.js";
import { resolveGenerationDifficulty } from "./examGenerationDifficulty.service.js";
import {
    isJeeFullPaperTopic,
    CAT_VARC_DEFAULT_TOPIC_SCOPE,
    isGmatStyleVarcTopic,
    getExamLabel,
    buildExamSyllabusCoverageBlock,
    resolveExamPromptContext,
} from "./examPromptContext.service.js";
import {
    countSelectableFromPlan,
    normalizeInferredPlan,
    MAX_API_ITEMS_PER_REQUEST,
    MAX_TOTAL_API_ITEMS,
} from "./aiQuestionCountInference.service.js";
import { parseCategoryScope, resolveGenerationSubject } from "./subjectDetection.js";

const COMPETITIVE_EXAM_PROFILES = new Set([
    "jee_main",
    "jee_advanced",
    "neet",
    "cat",
    "competitive",
]);

/** All exam profiles the planning AI may return. */
export const VALID_EXAM_PROFILES = new Set([
    "cat",
    "jee_main",
    "jee_advanced",
    "neet",
    "board",
    "competitive",
    ...COMPETITIVE_EXAM_PROFILES,
]);

export const VALID_CAT_SECTIONS = new Set([
    "cat_varc",
    "cat_dilr",
    "cat_qa",
    "cat_general",
]);

export const shouldUseCompetitiveExamPlan = (examProfile) =>
    COMPETITIVE_EXAM_PROFILES.has(String(examProfile || "").toLowerCase());

const buildFallbackParams = ({
    bankName = "",
    topic = "",
    subject = "",
    sectionName = "",
    categoryPaths = [],
} = {}) => ({ bankName, topic, subject, sectionName, categoryPaths });

/** Detect Paper 1 / Paper 2 from section, topic, or category path. */
export const detectPaperNumber = ({
    sectionName = "",
    topic = "",
    bankName = "",
    categoryPaths = [],
} = {}) => {
    const hay = `${sectionName} ${topic} ${bankName} ${(categoryPaths || []).join(" ")}`.toLowerCase();
    if (/\bpaper\s*2\b|\bpaper\s*ii\b|\bp2\b/.test(hay)) return 2;
    if (/\bpaper\s*1\b|\bpaper\s*i\b(?!\w)|\bp1\b/.test(hay)) return 1;
    return null;
};

export const normalizePaperNumberFromAI = (raw, fallbackParams = {}) => {
    const n = Number(raw);
    if (n === 1 || n === 2) return n;
    return detectPaperNumber(fallbackParams);
};

const isJeeExamProfile = (examProfile) =>
    ["jee_main", "jee_advanced"].includes(String(examProfile || "").toLowerCase());

/**
 * Ensure JEE plans include multi-correct and passages when AI returns all-singles.
 * No integer type — uses single/multiple/connected only.
 */
export const enforceJeeFormatDefaults = (typePlan, examProfile, slotTarget) => {
    const target = Math.max(1, slotTarget);
    const profile = String(examProfile || "").toLowerCase();
    if (!isJeeExamProfile(profile)) return typePlan;

    let plan = {
        ...typePlan,
        trueFalseCount: 0,
        passageMultipleCount: typePlan.passageMultipleCount || 0,
        passageTrueFalseCount: 0,
    };

    if (plan.singleCount > 0 && plan.trueFalseCount) {
        plan.singleCount += plan.trueFalseCount;
    }
    plan.trueFalseCount = 0;

    const selectable = () => countSelectableFromPlan(plan);

    if (profile === "jee_advanced") {
        if ((plan.multipleCount || 0) < 1 && target >= 4) {
            plan.multipleCount = Math.max(1, Math.round(target * 0.32));
        }
        if ((plan.passageCount || 0) < 1 && target >= 6) {
            plan.passageCount = 1;
            plan.passageSingleCount = Math.max(2, Math.min(3, Math.round(target * 0.15)));
        }
    } else if (profile === "jee_main") {
        if ((plan.multipleCount || 0) < 1 && target >= 8) {
            plan.multipleCount = Math.max(1, Math.round(target * 0.12));
        }
        if ((plan.passageCount || 0) < 1 && target >= 8) {
            plan.passageCount = 1;
            plan.passageSingleCount = 2;
        }
    }

    if (selectable() < 1) {
        plan.singleCount = target;
        plan.multipleCount = 0;
        plan.passageCount = 0;
        plan.passageSingleCount = 0;
    }

    let guard = 0;
    while (selectable() > target && guard < 50) {
        guard += 1;
        if ((plan.multipleCount || 0) > 0) {
            plan.multipleCount -= 1;
        } else if ((plan.passageCount || 0) > 0) {
            plan.passageCount -= 1;
            plan.passageSingleCount = 0;
        } else if ((plan.singleCount || 0) > 1) {
            plan.singleCount -= 1;
        } else {
            break;
        }
    }

    guard = 0;
    while (selectable() < target && guard < 50) {
        guard += 1;
        plan.singleCount = (plan.singleCount || 0) + 1;
    }

    return plan;
};

/**
 * CAT VARC: ~65% RC (passages) + ~35% VA singles (parajumbles, odd sentence, para summary).
 * Converts all-single plans into passage + VA mix.
 */
export const enforceCatVarcFormatDefaults = (typePlan, slotTarget) => {
    const target = Math.max(1, slotTarget);
    let plan = {
        ...typePlan,
        multipleCount: 0,
        trueFalseCount: 0,
        passageMultipleCount: 0,
        passageTrueFalseCount: 0,
    };

    if (plan.singleCount > 0 && plan.trueFalseCount) {
        plan.singleCount += plan.trueFalseCount;
    }
    plan.trueFalseCount = 0;

    const selectable = () => countSelectableFromPlan(plan);
    const currentSelectable = selectable();

    if (currentSelectable === target && (plan.passageCount || 0) > 0) {
        return plan;
    }

    const rcShare = 0.65;
    let rcQuestions = Math.max(4, Math.round(target * rcShare));
    let vaQuestions = Math.max(1, target - rcQuestions);
    const subsPerPassage = 4;
    let passageCount = Math.max(1, Math.round(rcQuestions / subsPerPassage));
    let passageSingleCount = subsPerPassage;

    let plannedRc = passageCount * passageSingleCount;
    if (plannedRc + vaQuestions > target) {
        vaQuestions = Math.max(1, target - plannedRc);
    } else if (plannedRc + vaQuestions < target) {
        vaQuestions = target - plannedRc;
    }

    plan.passageCount = passageCount;
    plan.passageSingleCount = passageSingleCount;
    plan.singleCount = vaQuestions;

    let guard = 0;
    while (selectable() > target && guard < 40) {
        guard += 1;
        if ((plan.singleCount || 0) > 1) {
            plan.singleCount -= 1;
        } else if ((plan.passageCount || 0) > 1) {
            plan.passageCount -= 1;
        } else if ((plan.passageSingleCount || 0) > 2) {
            plan.passageSingleCount -= 1;
        } else {
            break;
        }
    }

    guard = 0;
    while (selectable() < target && guard < 40) {
        guard += 1;
        if ((plan.singleCount || 0) < Math.ceil(target * 0.4)) {
            plan.singleCount = (plan.singleCount || 0) + 1;
        } else {
            plan.passageSingleCount = (plan.passageSingleCount || 2) + 1;
        }
    }

    return plan;
};

/** Normalize topic scope for any exam — exam-specific overrides when needed. */
export const resolveExamTopicScope = ({
    topicScope = "",
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    examProfile = "competitive",
    catSection = null,
    subjects = [],
} = {}) => {
    if (catSection === "cat_varc") {
        return resolveCatVarcTopicScope({
            topicScope,
            topic,
            bankName,
            sectionName,
        });
    }

    const scope = String(topicScope || "").trim();
    if (scope.length >= 16 && !isGmatStyleVarcTopic(scope)) {
        return scope;
    }

    const examLabel = getExamLabel(examProfile, catSection);
    const subjectPart =
        subjects.length > 0
            ? subjects.map((s) => s.label).join(", ")
            : sectionName || "full syllabus";
    const focus = String(topic || bankName || sectionName || "").trim();
    const trail = (categoryPaths || []).filter(Boolean).slice(-1)[0] || "";

    if (focus && focus.length > 8 && !/^competitive\b/i.test(focus)) {
        return `${examLabel} — hard-caliber mix across ${subjectPart}; cover distinct syllabus areas for: ${focus}`;
    }
    if (trail) {
        return `${examLabel} — hard-caliber questions spanning major ${subjectPart} units (${trail})`;
    }
    return `${examLabel} — hard-caliber questions across ${subjectPart}, with breadth across all relevant syllabus topics`;
};

/** Normalize topic scope for CAT VARC — reject GMAT-style scopes. */
export const resolveCatVarcTopicScope = ({
    topicScope = "",
    topic = "",
    bankName = "",
    sectionName = "",
} = {}) => {
    const scope = String(topicScope || "").trim();
    const hay = `${scope} ${topic} ${bankName} ${sectionName}`;
    if (scope && !isGmatStyleVarcTopic(scope)) return scope;
    if (!isGmatStyleVarcTopic(hay) && /\b(?:rc|reading comprehension|parajumble|para jumble|odd sentence|para summary|varc)\b/i.test(hay)) {
        return scope || CAT_VARC_DEFAULT_TOPIC_SCOPE;
    }
    return CAT_VARC_DEFAULT_TOPIC_SCOPE;
};

/** Normalize AI-detected exam profile; regex fallback when invalid or missing. */
export const normalizeExamProfileFromAI = (rawProfile, fallbackParams = {}) => {
    const normalized = String(rawProfile || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/-/g, "_");
    if (VALID_EXAM_PROFILES.has(normalized)) return normalized;
    return detectExamProfile(buildFallbackParams(fallbackParams));
};

/** Normalize AI-detected CAT section; regex fallback for CAT exams. */
export const normalizeCatSectionFromAI = (
    rawSection,
    examProfile,
    fallbackParams = {}
) => {
    const normalized = String(rawSection || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_");
    if (VALID_CAT_SECTIONS.has(normalized)) return normalized;
    if (String(examProfile || "").toLowerCase() === "cat") {
        return detectCatSection(buildFallbackParams(fallbackParams));
    }
    return null;
};

/** Prefer AI plan context; fall back to regex heuristics when no plan exists. */
export const resolveExamContextForGeneration = ({
    competitiveExamPlan = null,
    bankName = "",
    topic = "",
    subject = "",
    sectionName = "",
    categoryPaths = [],
} = {}) => {
    const fallbackParams = buildFallbackParams({
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });

    if (competitiveExamPlan?.examProfile) {
        return {
            examProfile: competitiveExamPlan.examProfile,
            catSection:
                competitiveExamPlan.catSection ??
                (competitiveExamPlan.examProfile === "cat"
                    ? detectCatSection(fallbackParams)
                    : null),
            isFullPaper: Boolean(competitiveExamPlan.isFullPaper),
            topicScope: String(competitiveExamPlan.topicScope || "").trim(),
            paperNumber: competitiveExamPlan.paperNumber ?? null,
            source: "ai_plan",
        };
    }

    return {
        examProfile: detectExamProfile(fallbackParams),
        catSection: detectCatSection(fallbackParams),
        isFullPaper: isJeeFullPaperTopic(fallbackParams),
        topicScope: "",
        source: "regex",
    };
};

const clampInt = (n, min, max) =>
    Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

const normalizeSubjectId = (value) =>
    String(value || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");

const labelForSubjectId = (id) => {
    const map = {
        physics: "Physics",
        chemistry: "Chemistry",
        mathematics: "Mathematics",
        biology: "Biology",
        botany: "Botany",
        zoology: "Zoology",
        verbal: "Verbal Ability & Reading Comprehension",
        dilr: "Data Interpretation & Logical Reasoning",
        qa: "Quantitative Aptitude",
    };
    return map[id] || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

/** Rescale subject counts so they sum to targetSelectable. */
const rescaleSubjectCounts = (subjects, targetSelectable) => {
    const target = Math.max(1, targetSelectable);
    if (!subjects.length) return subjects;

    let list = subjects.map((s) => ({
        id: s.id,
        label: s.label,
        count: Math.max(0, s.count),
    }));

    let sum = list.reduce((a, s) => a + s.count, 0);
    if (sum < 1) {
        list[0].count = target;
        return list;
    }

    if (sum !== target) {
        const scaled = list.map((s) => ({
            ...s,
            count: Math.max(1, Math.round((s.count / sum) * target)),
        }));
        let scaledSum = scaled.reduce((a, s) => a + s.count, 0);
        let i = 0;
        while (scaledSum > target && scaled.some((s) => s.count > 1)) {
            if (scaled[i].count > 1) {
                scaled[i].count -= 1;
                scaledSum -= 1;
            }
            i = (i + 1) % scaled.length;
        }
        while (scaledSum < target) {
            scaled[scaledSum % scaled.length].count += 1;
            scaledSum += 1;
        }
        list = scaled;
    }

    return list.filter((s) => s.count > 0);
};

/**
 * Minimal subject fallback when the planning step omits subjects or Gemini is unavailable.
 * Does NOT infer competitive exam splits — that is Step 1 AI's job (buildCompetitiveExamPlanPrompt).
 */
export const suggestMinimalSubjectFallback = ({
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
    subject = "",
    selectableTarget = 10,
    catSection = null,
} = {}) => {
    const target = Math.max(1, selectableTarget);

    if (catSection === "cat_varc") {
        return [
            {
                id: "verbal",
                label: labelForSubjectId("verbal"),
                count: target,
            },
        ];
    }
    if (catSection === "cat_qa") {
        return [{ id: "qa", label: labelForSubjectId("qa"), count: target }];
    }
    if (catSection === "cat_dilr") {
        return [{ id: "dilr", label: labelForSubjectId("dilr"), count: target }];
    }

    const resolved = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    if (resolved.id) {
        return [
            {
                id: resolved.id,
                label: resolved.label || labelForSubjectId(resolved.id),
                count: target,
            },
        ];
    }

    return [{ id: "general", label: "General", count: target }];
};

/** @deprecated Use suggestMinimalSubjectFallback — kept as alias for callers. */
export const suggestDefaultSubjectMix = suggestMinimalSubjectFallback;

export const normalizeCompetitiveExamPlan = (
    raw = {},
    {
        maxApiItems = MAX_TOTAL_API_ITEMS,
        maxSelectableSlots = 10,
        topic = "",
        bankName = "",
        categoryPaths = [],
        sectionName = "",
        subject = "",
        bankDifficulty = "medium",
    } = {}
) => {
    const fallbackParams = buildFallbackParams({
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });

    const examProfile = normalizeExamProfileFromAI(raw.examProfile, fallbackParams);
    const catSection = normalizeCatSectionFromAI(raw.catSection, examProfile, fallbackParams);
    const isFullPaper =
        typeof raw.isFullPaper === "boolean"
            ? raw.isFullPaper
            : isJeeFullPaperTopic(fallbackParams);
    const paperNumber = normalizePaperNumberFromAI(raw.paperNumber, fallbackParams);

    const typePlan = normalizeInferredPlan(raw, maxApiItems, {
        maxSelectableSlots,
        singleChoiceOnly: !isJeeExamProfile(examProfile),
    });
    let enforcedTypePlan = isJeeExamProfile(examProfile)
        ? enforceJeeFormatDefaults(typePlan, examProfile, maxSelectableSlots)
        : catSection === "cat_varc"
          ? enforceCatVarcFormatDefaults(typePlan, maxSelectableSlots)
          : typePlan;
    const selectableTarget = countSelectableFromPlan(enforcedTypePlan);

    let subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
        .map((s) => {
            const id = normalizeSubjectId(s.id || s.label);
            return {
                id: id || "general",
                label: String(s.label || labelForSubjectId(id)).trim(),
                count: clampInt(s.count, 0, maxApiItems),
            };
        })
        .filter((s) => s.label && s.count > 0);

    if (!subjects.length) {
        console.warn(
            "[competitive-exam-plan] AI plan missing subjects — using minimal fallback (category/topic subject or General only)"
        );
        subjects = suggestMinimalSubjectFallback({
            topic,
            bankName,
            categoryPaths,
            sectionName,
            subject,
            selectableTarget,
            catSection,
        });
    } else {
        subjects = rescaleSubjectCounts(subjects, selectableTarget);
    }

    // Passage length is DECIDED BY THE PLANNING AI from the exam's authentic RC
    // format (not hardcoded). Sanitize to a clean "min–max" (or single) word count.
    const passageWordTarget = sanitizePassageWordTarget(raw.passageWordTarget);

    const rationale = String(raw.rationale || typePlan.rationale || "").trim();
    const bankDiff = normalizeBankDifficulty(raw.bankDifficulty || bankDifficulty);
    const difficultyMix = allocateDifficultyMix(selectableTarget, bankDiff);

    const topicScope = resolveExamTopicScope({
        topicScope: String(raw.topicScope || "").trim(),
        topic,
        bankName,
        sectionName,
        categoryPaths,
        examProfile,
        catSection,
        subjects,
    });

    return {
        ...enforcedTypePlan,
        examProfile,
        catSection,
        isFullPaper,
        topicScope,
        paperNumber,
        subjects,
        bankDifficulty: bankDiff,
        difficultyMix,
        rationale:
            rationale ||
            `Planned ${selectableTarget} question(s) across ${subjects.map((s) => s.label).join(", ")}.`,
        selectableTotal: selectableTarget,
        passageWordTarget,
    };
};

/** Normalize an AI-provided passage word target to a clean "min–max" (or single number), or null. */
const sanitizePassageWordTarget = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const range = s.match(/(\d{2,4})\s*(?:[-–—]|to)\s*(\d{2,4})/);
    if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (lo > 0 && hi >= lo && hi <= 2000) return `${lo}–${hi}`;
    }
    const single = s.match(/\d{2,4}/);
    if (single) {
        const n = Number(single[0]);
        if (n > 0 && n <= 2000) return String(n);
    }
    return null;
};

export const buildCompetitiveExamPlanPrompt = ({
    topic,
    bankName = "",
    difficulty = "medium",
    sectionName = "",
    subject = "",
    categoryPaths = [],
    maxApiItems = MAX_TOTAL_API_ITEMS,
    maxSelectableSlots = 10,
} = {}) => {
    const slotTarget = Math.max(
        1,
        Math.min(maxApiItems, Number(maxSelectableSlots) || 10)
    );
    const { trail } = parseCategoryScope(categoryPaths || []);
    const mix = allocateDifficultyMix(slotTarget, difficulty);
    const { examProfile: detectedProfile, catSection: detectedCatSection } =
        resolveExamPromptContext({
            bankName,
            topic,
            sectionName,
            categoryPaths,
            subject,
        });
    const syllabusCoverageBlock = buildExamSyllabusCoverageBlock({
        examProfile: detectedProfile,
        catSection: detectedCatSection,
        batchSize: slotTarget,
        bankDifficulty: difficulty,
    });

    return `You are planning a question batch for an Indian ed-tech platform.

**STEP 1 ONLY — detect exam type, topic scope, subjects, and counts. Do NOT write any questions.**

**Inputs (use all of these together):**
- **Topic / bank name:** ${topic || bankName}
- **Bank name (display):** ${bankName || topic}
- **Bank difficulty profile:** ${difficulty} — NOT uniform tier; generation will use per-question mix **${mix.ratioLabel}** easy:medium:hard per 10 (${mix.easy} easy-tier + ${mix.medium} medium-tier + ${mix.hard} hard-tier for ${slotTarget} slot(s)). **Upscaled tiers:** easy-tier = exam medium, medium-tier = exam hard, hard-tier = extra hard.
- **Section name:** ${sectionName || "(none)"}
- **Explicit subject hint:** ${subject || "(none)"}
- **Category path:** ${trail || "(none)"}
- **Empty bank slots:** ${slotTarget} selectable question(s) must be filled

**Your job (in order):**

1. **Detect exam type** from category path, bank name, topic, and section.
   Choose exactly one \`examProfile\`:
   - \`jee_main\` — JEE Main, NTA, JEE Mains
   - \`jee_advanced\` — JEE Advanced, IIT-JEE Advanced (including "JEE-advance", "JEE-advanced", hyphenated variants)
   - \`neet\` — NEET, AIPMT, medical entrance
   - \`cat\` — CAT, Common Admission Test, MBA entrance (also set catSection below)
   - \`board\` — CBSE, ICSE, state board, class 9–12 school exams
   - \`competitive\` — other entrance exams (KVPY, NTSE, olympiad, generic competitive)

2. **If examProfile is cat**, set \`catSection\`: \`cat_varc\` | \`cat_dilr\` | \`cat_qa\` | \`cat_general\` (or null if unclear)

3. **Determine topic scope:**
   - \`isFullPaper\`: true if this is a full mock / full paper spanning multiple subjects (e.g. JEE full paper → PCM mix; NEET full paper → PCB)
   - \`topicScope\`: one sentence for THIS batch — **hard topics first, but cover all relevant syllabus areas** (see rule 4)

4. **Topic coverage rule (all exams):**
   - **~70% hard / peak-caliber:** multi-step, linked concepts, exam-style traps for the detected profile.
   - **~30% syllabus breadth:** ensure **distinct units/chapters** are represented — no batch stuck on one micro-topic.
   - Name 2–4 syllabus bands in \`topicScope\` when the bank is broad (e.g. "JEE Main Physics — mechanics + EM + modern, hard shift-paper caliber").
   - Use **authentic question types for the detected exam** (infer from profile + section + category path — not a generic school test).

${syllabusCoverageBlock}

5. **Plan subjects and counts** for the detected exam and scope:
   - JEE full paper → Physics + Chemistry + Mathematics (PCM)
   - JEE single-subject topic → that subject only
   - NEET → PCB as appropriate
   - CAT → set \`catSection\`; match section format (VARC: RC passages + VA singles; QA: aptitude singles; DILR: linked sets)
   - Board → match the subject/topic in the category path

6. **If JEE Advanced or JEE Main**, set \`paperNumber\`: 1 | 2 | null (from section name e.g. "Paper 1", or topic)

7. **Plan question FORMAT mix** (backend supports \`single\`, \`multiple\`, \`connected\` only — **NO integer-type**):
   - **JEE Advanced:** MUST include \`multipleCount\` (multi-correct) ≥ ~30% of batch; \`passageCount\` ≥ 1 for batches ≥6 (paragraph/comprehension sets); rest \`single\` (incl. match-column style). Never plan 100% singles.
   - **JEE Main:** Mostly \`single\` (~70–85%); optional \`multipleCount\` (~10%); \`passageCount\` for paragraph sets; note in rationale that ~30% of singles simulate Section B numerics (four numeric options, still \`single\`).
   - **Section name "Section B" or "Numerical":** plan all items as \`single\` with numerical-as-MCQ style in rationale.

8. **Decide passage length** (only when \`passageCount\` > 0): set \`passageWordTarget\` to the authentic per-passage word count a REAL paper of this exam/section uses — a "min-max" range (e.g. reading-comprehension exams like CLAT, CAT VARC, UPSC CSAT, and IBPS/SBI banking RC use long multi-paragraph passages; JEE/NEET numeric context blocks are short). Base it on the actual exam's format, not a generic default. Omit if there are no passages.

**Count rules:**
- API items = singleCount + multipleCount + passageCount (each passage = 1 API item)
- selectable total = singleCount + multipleCount + passageCount × passageSingleCount ≤ ${slotTarget}
- trueFalseCount must be 0 for JEE
- passage sub-questions: use passageSingleCount (single sub-Qs) or passageMultipleCount (multi-correct sub-Qs for Advanced)
- subjects[].count must sum to the selectable total
- Do NOT under-fill — plan for all ${slotTarget} slot(s)

Return ONLY valid JSON:
{
  "plan": {
    "examProfile": "jee_advanced",
    "catSection": null,
    "paperNumber": 1,
    "isFullPaper": true,
    "topicScope": "JEE Advanced Paper 1 — PCM with multi-correct and passage sets",
    "subjects": [
      { "id": "physics", "label": "Physics", "count": 3 },
      { "id": "chemistry", "label": "Chemistry", "count": 4 },
      { "id": "mathematics", "label": "Mathematics", "count": 3 }
    ],
    "singleCount": 5,
    "multipleCount": 3,
    "trueFalseCount": 0,
    "passageCount": 1,
    "passageSingleCount": 2,
    "passageMultipleCount": 0,
    "passageTrueFalseCount": 0,
    "passageWordTarget": "450-550",
    "rationale": "One sentence: exam type, format mix, and subject split"
  }
}`;
};

/** Injected into the generation prompt after planning. */
export const buildCompetitiveExamPlanGenerationBlock = (plan) => {
    if (!plan?.subjects?.length) return "";

    const subjectLines = plan.subjects
        .map((s) => `- **${s.label}:** ${s.count} question(s)`)
        .join("\n");
    const total =
        plan.selectableTotal ??
        countSelectableFromPlan(plan) ??
        plan.subjects.reduce((a, s) => a + s.count, 0);

    const passageLenNote =
        (plan.passageCount || 0) > 0 && plan.passageWordTarget
            ? ` — each passage **${plan.passageWordTarget} words** (exam-authentic length; do NOT write short)`
            : "";
    const formatNote =
        (plan.passageCount || 0) > 0
            ? `- Format: ${plan.singleCount || 0} single + ${plan.multipleCount || 0} multi-correct + ${plan.passageCount} passage(s) × ${plan.passageSingleCount || 0} sub(s)${plan.passageMultipleCount ? ` + ${plan.passageMultipleCount} multi sub/passage` : ""}${passageLenNote}`
            : plan.multipleCount > 0
              ? `- Format: ${plan.singleCount || 0} single + ${plan.multipleCount} multi-correct`
              : `- Format: ${plan.singleCount || total} standalone single-choice MCQ(s)`;

    const paperLine =
        plan.paperNumber === 1 || plan.paperNumber === 2
            ? `- **Paper:** ${plan.paperNumber}`
            : "";

    const examLine = plan.examProfile
        ? `- **Detected exam:** ${plan.examProfile}${plan.catSection ? ` (${plan.catSection})` : ""}${plan.isFullPaper ? ", full paper" : ""}`
        : "";
    const scopeLine = plan.topicScope ? `- **Topic scope:** ${plan.topicScope}` : "";

    return `
**EXAM PLAN (from AI planning step — mandatory distribution):**
This batch was planned in a prior step. Follow this subject split **exactly**.

${examLine}
${paperLine}
${scopeLine}
${subjectLines}
- **Total selectable:** ${total}
${formatNote}
${plan.rationale ? `- **Planner rationale:** ${plan.rationale}` : ""}

**Generation rules:**
- Author exactly the counts above per subject — do not collapse into one subject.
- Spread subjects through the batch (avoid long runs of the same subject when possible).
- **Hard-first + full coverage:** ~70% peak-difficulty items; remaining slots must still hit **different syllabus units** — not the same chapter/template repeated.
- Each question must match its assigned subject's syllabus and ${plan.rationale ? "exam" : "topic"} rigor.
- **Uniqueness:** No two questions in this batch may test the same micro-topic or reuse the same numerical setup (e.g. do not repeat first-order kinetics with the same rate constant).`;
};

/** Human-readable block for evaluation prompts — score against THIS brief only. */
export const buildEvaluationConstraintsBlock = (plan = null) => {
    if (!plan || typeof plan !== "object") {
        return `
**GENERATION CONSTRAINTS:** Not provided — use exam profile inferred from topic only. Do NOT require integer-type or matrix-match inputs (not supported by this platform).`;
    }

    const profile = String(plan.examProfile || "competitive").toLowerCase();
    const paper =
        plan.paperNumber === 1 || plan.paperNumber === 2
            ? `Paper ${plan.paperNumber}`
            : "";
    const single = plan.singleCount || 0;
    const multiple = plan.multipleCount || 0;
    const passage = plan.passageCount || 0;
    const passageSub = plan.passageSingleCount || 0;
    const passageMultiSub = plan.passageMultipleCount || 0;
    const subjects = (plan.subjects || [])
        .map((s) => `${s.count} ${s.label}`)
        .join(", ");
    const mix = plan.difficultyMix;
    const allHardMix =
        mix && Number(mix.easy) === 0 && Number(mix.medium) === 0 && Number(mix.hard) > 0;
    const mixLine = mix
        ? plan.examCalibrated && allHardMix
            ? `- **Difficulty:** exam-native **ALL HARD** (${mix.hard} slot(s) at peak ${profile === "jee_advanced" ? "Advanced" : "Main"} shift-paper caliber — no easy/medium slots)`
            : `- **Difficulty mix (bank "${plan.bankDifficulty || "medium"}"):** ${mix.ratioLabel} easy:medium:hard → ${mix.easy} easy-tier + ${mix.medium} medium-tier + ${mix.hard} hard-tier (see tier definitions below)`
        : plan.bankDifficulty
          ? `- **Bank difficulty profile:** ${plan.bankDifficulty}`
          : "";
    const bankAnchor =
        plan.examCalibrated && profile.startsWith("jee")
            ? `- **Difficulty anchor:** JEE ${profile === "jee_advanced" ? "Advanced" : "Main"} **exam-native ALL HARD** — every slot is peak shift-paper / extra-hard; formula drills and chapter-test templates score below 60 on difficulty.`
            : plan.bankDifficulty && profile.startsWith("jee")
              ? plan.bankDifficulty === "easy"
                  ? `- **Difficulty anchor:** JEE ${profile === "jee_advanced" ? "Advanced" : "Main"} **upscaled easy bank** — easy-tier slots at old medium band; no Section A / homework ease.`
                  : plan.bankDifficulty === "hard"
                    ? `- **Difficulty anchor:** JEE ${profile === "jee_advanced" ? "Advanced" : "Main"} **extra hard mock** — hard-tier = peak / beyond late-section; formula drills fail.`
                    : `- **Difficulty anchor:** JEE ${profile === "jee_advanced" ? "Advanced" : "Main"} **upscaled medium bank** — medium-tier at old hard band; balanced tough shift.`
              : "";

    const typeLines = [
        `- **Exam profile:** ${profile}${plan.catSection ? ` (${plan.catSection})` : ""}${paper ? ` — ${paper}` : ""}`,
        plan.topicScope ? `- **Topic scope:** ${plan.topicScope}` : "",
        plan.isFullPaper ? `- **Full paper:** yes (multi-subject mix expected)` : "",
        subjects ? `- **Subject split:** ${subjects}` : "",
        mixLine,
        bankAnchor,
        `- **Requested format (evaluate against THIS only):**`,
        `  - ${single} standalone \`single\` (single-correct MCQ)`,
        multiple > 0
            ? `  - ${multiple} standalone \`multiple\` (multi-correct)`
            : `  - 0 standalone multi-correct (do NOT penalize absence of multi-correct)`,
        passage > 0
            ? `  - ${passage} \`connected\` passage(s) × ${passageSub} single sub(s)${passageMultiSub ? ` + ${passageMultiSub} multi sub(s)/passage` : ""} each`
            : `  - 0 connected passages (do NOT penalize absence of paragraph sets)`,
        `- **NOT requested / NOT supported:** integer-type input, decimal-type input, matrix-match input fields — never penalize for missing these.`,
    ]
        .filter(Boolean)
        .join("\n");

  const profileRules =
        profile === "jee_advanced"
            ? `
**Advanced-specific evaluation rules:**
- Score difficulty vs **JEE Advanced** depth (insight, multi-step), NOT JEE Main speed/breadth.
- If multi-correct was requested, penalize heavily if sample has none.
- If only singles were requested, do NOT penalize for lacking multi-correct.
- Penalize Main-level formula plug-ins only when Advanced depth was requested.`
            : profile === "jee_main"
              ? `
**Main-specific evaluation rules:**
- Score vs **JEE Main** shift-paper breadth; numerical Section B may be simulated as single MCQs with 4 numeric options.
- If Section B / numerical style was requested, check numeric-option singles — not integer input boxes.
- If only singles were requested, do NOT require multi-correct or passages.`
              : "";

    const tierDefinitionsBlock =
        profile.startsWith("jee") || profile === "neet" || profile === "cat"
            ? buildDifficultyAuditRubricsBlock({
                  examProfile: profile,
                  tiers: allHardMix
                      ? ["hard"]
                      : mix
                        ? ["easy", "medium", "hard"]
                        : ["easy", "medium", "hard"],
                  hardOnly: Boolean(plan.examCalibrated && allHardMix),
              })
            : "";

    return `
**GENERATION CONSTRAINTS (authoritative — evaluate ONLY against what was requested below):**
${typeLines}
${profileRules}
**Pattern compliance:** Compare delivered question types in the sample to the counts above. Mismatch = style/pattern issue, not topic issue.
**Difficulty mix compliance:** Score each item against its **assigned difficultyTier** using the tier definitions below — same criteria used during generation. easy-tier = exam medium band · medium-tier = exam hard · hard-tier = extra hard.
${tierDefinitionsBlock}`;
};

/** Count top-level and sub-question types in a validation payload. */
export const countDeliveredQuestionTypes = (questions = []) => {
    let single = 0;
    let multiple = 0;
    let connected = 0;
    let passageSubSingle = 0;
    let passageSubMultiple = 0;

    for (const q of questions || []) {
        const type = String(q.questionType || "single").toLowerCase();
        if (type === "connected" || q.passage) {
            connected += 1;
            const subs = q.subQuestions || q.connectedQuestions || [];
            for (const sub of subs) {
                if (String(sub.questionType || "single").toLowerCase() === "multiple") {
                    passageSubMultiple += 1;
                } else {
                    passageSubSingle += 1;
                }
            }
            if (!subs.length) passageSubSingle += 1;
        } else if (type === "multiple") {
            multiple += 1;
        } else {
            single += 1;
        }
    }

    const selectable =
        single + multiple + passageSubSingle + passageSubMultiple;

    return {
        single,
        multiple,
        connected,
        passageSubSingle,
        passageSubMultiple,
        selectable,
    };
};

/** Deterministic check: did delivery match the generation plan's format? */
export const auditPatternCompliance = (plan, questions = []) => {
    if (!plan || typeof plan !== "object") {
        return { patternComplianceScore: null, issues: [] };
    }

    const actual = countDeliveredQuestionTypes(questions);
    const issues = [];
    const plannedSingle = plan.singleCount || 0;
    const plannedMultiple = plan.multipleCount || 0;
    const plannedPassage = plan.passageCount || 0;
    const plannedPassageSub =
        (plan.passageSingleCount || 0) + (plan.passageMultipleCount || 0);

    if (plannedMultiple > 0 && actual.multiple < 1) {
        issues.push({
            questionNumber: 0,
            issue: `Pattern mismatch: generation requested ${plannedMultiple} multi-correct question(s) but sample has ${actual.multiple}.`,
            severity: "major",
            category: "style",
        });
    }
    if (plannedPassage > 0 && actual.connected < 1) {
        issues.push({
            questionNumber: 0,
            issue: `Pattern mismatch: generation requested ${plannedPassage} connected passage(s) but sample has ${actual.connected}.`,
            severity: "major",
            category: "style",
        });
    }
    if (plannedSingle > 0 && actual.single + actual.multiple < 1 && actual.connected < 1) {
        issues.push({
            questionNumber: 0,
            issue: "Pattern mismatch: generation requested standalone questions but sample has none.",
            severity: "critical",
            category: "style",
        });
    }

    const plannedApiItems = plannedSingle + plannedMultiple + plannedPassage;
    const actualApiItems = actual.single + actual.multiple + actual.connected;
    if (plannedApiItems > 0 && actualApiItems > 0) {
        const typeMismatch =
            (plannedMultiple === 0 && actual.multiple > 0 && plannedSingle > 0) ||
            (plannedPassage === 0 && actual.connected > 0);
        if (typeMismatch && plannedMultiple === 0) {
            issues.push({
                questionNumber: 0,
                issue: `Pattern mismatch: generation requested singles only but sample includes ${actual.multiple} multi-correct without plan.`,
                severity: "minor",
                category: "style",
            });
        }
    }

    let patternComplianceScore = 100;
    if (issues.length) {
        const penalty = issues.reduce(
            (sum, i) => sum + (i.severity === "critical" ? 35 : i.severity === "major" ? 25 : 10),
            0
        );
        patternComplianceScore = Math.max(0, 100 - penalty);
    }

    return { patternComplianceScore, issues, actual, planned: plan };
};

/** Merge explicit API counts into a plan-shaped object for evaluation. */
export const buildGenerationPlanForEvaluation = ({
    competitiveExamPlan = null,
    singleCount = 0,
    multipleCount = 0,
    trueFalseCount = 0,
    passageCount = 0,
    passageSingleCount = 0,
    passageMultipleCount = 0,
    passageTrueFalseCount = 0,
    bankName = "",
    topic = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
    difficulty = "medium",
} = {}) => {
    if (competitiveExamPlan && typeof competitiveExamPlan === "object") {
        return competitiveExamPlan;
    }

    const hasExplicitCounts =
        singleCount + multipleCount + trueFalseCount + passageCount > 0;
    if (!hasExplicitCounts) return null;

    const ctx = resolveExamContextForGeneration({
        bankName,
        topic,
        subject,
        sectionName,
        categoryPaths,
    });

    const slotTotal =
        singleCount +
        multipleCount +
        trueFalseCount +
        passageCount *
            (passageSingleCount + passageMultipleCount + passageTrueFalseCount);

    const difficultyResolution = resolveGenerationDifficulty({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
        userDifficulty: difficulty,
        generateIntent: "initial",
    });

    const bankDifficulty = difficultyResolution.generationDifficulty;
    const difficultyMix = allocateDifficultyMix(slotTotal, bankDifficulty, {
        examProfile: ctx.examProfile,
        examCalibrated: difficultyResolution.examCalibrated,
    });

    return {
        examProfile: ctx.examProfile,
        catSection: ctx.catSection,
        isFullPaper: ctx.isFullPaper,
        topicScope: ctx.topicScope || "",
        paperNumber: detectPaperNumber({ sectionName, topic, bankName, categoryPaths }),
        singleCount: singleCount + trueFalseCount,
        multipleCount,
        trueFalseCount: 0,
        passageCount,
        passageSingleCount: passageSingleCount + passageTrueFalseCount,
        passageMultipleCount,
        passageTrueFalseCount: 0,
        bankDifficulty,
        examCalibrated: difficultyResolution.examCalibrated,
        difficultySource: difficultyResolution.source,
        difficultyRationale: difficultyResolution.rationale,
        difficultyMix,
        rationale: difficultyResolution.examCalibrated
            ? difficultyResolution.rationale
            : "Explicit generation counts from client request.",
    };
};

/** @deprecated Exam profile is now AI-detected in the planning call. Regex fallback only. */
export const getCompetitiveExamPlanningContext = (params = {}) => {
    const resolvedSubject = resolveGenerationSubject(params);
    const ctx = resolveExamContextForGeneration({
        bankName: params.bankName,
        topic: params.topic,
        subject: resolvedSubject.id || params.subject,
        sectionName: params.sectionName,
        categoryPaths: params.categoryPaths,
    });
    return { resolvedSubject, examProfile: ctx.examProfile, catSection: ctx.catSection };
};
