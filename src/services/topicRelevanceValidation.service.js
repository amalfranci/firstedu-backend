import { ApiError } from "../utils/ApiError.js";
import { parseJsonObjectFromAIText } from "../utils/aiJsonRepair.js";
import { detectExamProfile } from "./examDifficultyCalibration.js";
import { buildGenerationCorrectnessMandatesBlock } from "./examPromptContext.service.js";
import { buildEvaluationConstraintsBlock } from "./competitiveExamPlan.service.js";
import { normalizeQuestionTier } from "./difficultyMix.service.js";
import { stripMetaCommentary } from "../utils/stripMetaCommentary.js";
import { extractRegenerationTargetNumbers } from "./regenerationTargeting.service.js";

export const TOPIC_RELEVANCE_MAX_SAMPLE = 50;
export const TOPIC_RELEVANCE_PASS_SCORE = 80;
export const REGEN_TARGET_SCORE = 85;

/** Weight topic fit vs answer/explanation correctness when blending overallScore. */
export const TOPIC_RELEVANCE_BLEND_WEIGHT = 0.42;
export const CORRECTNESS_BLEND_WEIGHT = 0.58;

/** JEE: topic + factual correctness + authenticity (style craft via authenticity audit). */
export const JEE_TOPIC_BLEND_WEIGHT = 0.22;
export const JEE_CORRECTNESS_BLEND_WEIGHT = 0.45;
export const JEE_AUTHENTICITY_BLEND_WEIGHT = 0.33;

/** Per-question factual penalties (deduped — one slot per question). */
export const CORRECTNESS_CRITICAL_PENALTY = 14;
export const CORRECTNESS_MAJOR_PENALTY = 9;

/** Overall score ceilings when factual defects are confirmed. */
export const OVERALL_SCORE_CAPS = {
    ANSWER_NOT_IN_OPTIONS: 62,
    ONE_CRITICAL: 82,
    TWO_CRITICAL: 70,
    THREE_CRITICAL: 58,
    THREE_MAJOR_PLUS_CRITICAL: 60,
    LOW_STYLE: 72,
    /** Explanation quality below EXPLANATION_QUALITY_PASS_FLOOR. */
    LOW_EXPLANATION_QUALITY: 76,
    /** Difficulty match below 60 → overall cannot exceed 85. */
    LOW_DIFFICULTY_MATCH_60: 85,
    /** Difficulty match below 40 → overall cannot exceed 75. */
    LOW_DIFFICULTY_MATCH_40: 75,
};

/** Hard floor — sets below this fail validation / trigger regen. */
export const EXPLANATION_QUALITY_PASS_FLOOR = 55;

/** Difficulty-match thresholds for overall score caps. */
export const DIFFICULTY_MATCH_CAP_THRESHOLDS = {
    MID: 60,
    LOW: 40,
};

/** Non-JEE competitive: optional style dimension from classified issues. */
export const STYLE_BLEND_WEIGHT = 0.2;
export const TOPIC_STYLE_BLEND_WEIGHT = 0.3;
export const CORRECTNESS_STYLE_BLEND_WEIGHT = 0.5;

export const ISSUE_CATEGORY = {
    FACTUAL: "factual",
    STYLE: "style",
    DIVERSITY: "diversity",
    AUTHENTICITY: "authenticity",
    DIFFICULTY: "difficulty",
};

const ALL_ISSUE_CATEGORIES = new Set(Object.values(ISSUE_CATEGORY));

/** Classify audit issues into independent scoring dimensions. */
export const classifyIssueCategory = (issue) => {
    const explicit = String(issue?.category || "").toLowerCase();
    if (ALL_ISSUE_CATEGORIES.has(explicit)) {
        return explicit;
    }

    const text = String(issue?.issue || issue || "").toLowerCase();

    if (
        /deriv|contradict|does not appear among|not among any option|marked answer|self-correct|concludes .+ but marked|explains .+ but marked|invalid ph option|wrong answer|not present in any option|not among options|≠ marked|not match|independent solve disagrees|two or more options are identical|identical options|explanation states option [a-d]/i.test(
            text
        )
    ) {
        return ISSUE_CATEGORY.FACTUAL;
    }

    if (
        /near-duplicate of question|duplicate (?:question|stem)|same stem|repeats the same (?:logic|problem)|duplicate micro-topic|same problem/i.test(
            text
        )
    ) {
        return ISSUE_CATEGORY.DIVERSITY;
    }

    if (
        /requires deeper|deeper analysis|formula.?only|plug-in|too easy|too-easy|chapter-test|homework|main-level when advanced|lack(?:s)? multi-concept|single-formula|trivial one-step|insufficient depth|beyond formula application|formula application only/i.test(
            text
        )
    ) {
        return ISSUE_CATEGORY.DIFFICULTY;
    }

    if (
        /pattern:|requested \d+ multi-correct|nta-style|coaching|template|repetitive|non-jee|authenticity|option craft|distractor design|indistinguishable isomer/i.test(
            text
        )
    ) {
        return ISSUE_CATEGORY.AUTHENTICITY;
    }

    if (
        /formatting|number format|slightly vary|grammar|draft|meta commentary|vague justification|short explanation|lacks depth|explanation quality|hand-waving|weak explanation|brief explanation|near-duplicate options|trivially embedded|malformed scientific|option formatting|coaching-level template/i.test(
            text
        )
    ) {
        return ISSUE_CATEGORY.STYLE;
    }

    if (
        /near-duplicate|trivially embedded|vague justification|authenticity|template|indistinguishable|option craft|difficulty/i.test(
            text
        )
    ) {
        if (/difficulty|too easy|deeper/i.test(text)) {
            return ISSUE_CATEGORY.DIFFICULTY;
        }
        return ISSUE_CATEGORY.STYLE;
    }

    return ISSUE_CATEGORY.STYLE;
};

export const tagIssueCategories = (issues = []) =>
    (issues || []).map((item) => ({
        ...item,
        category: ALL_ISSUE_CATEGORIES.has(String(item.category || "").toLowerCase())
            ? String(item.category).toLowerCase()
            : classifyIssueCategory(item),
    }));

export const partitionIssuesByCategory = (issues = []) => {
    const tagged = tagIssueCategories(issues);
    return {
        tagged,
        factualIssues: tagged.filter((i) => i.category === ISSUE_CATEGORY.FACTUAL),
        styleIssues: tagged.filter(
            (i) =>
                i.category === ISSUE_CATEGORY.STYLE ||
                i.category === ISSUE_CATEGORY.DIVERSITY ||
                i.category === ISSUE_CATEGORY.AUTHENTICITY ||
                i.category === ISSUE_CATEGORY.DIFFICULTY
        ),
    };
};

/** Split issues into independent evaluation dimensions. */
export const partitionIssuesByDimension = (issues = []) => {
    const tagged = tagIssueCategories(issues);
    return {
        tagged,
        factualIssues: tagged.filter((i) => i.category === ISSUE_CATEGORY.FACTUAL),
        styleIssues: tagged.filter((i) => i.category === ISSUE_CATEGORY.STYLE),
        diversityIssues: tagged.filter((i) => i.category === ISSUE_CATEGORY.DIVERSITY),
        authenticityIssues: tagged.filter(
            (i) => i.category === ISSUE_CATEGORY.AUTHENTICITY
        ),
        difficultyIssues: tagged.filter((i) => i.category === ISSUE_CATEGORY.DIFFICULTY),
    };
};

const topicHaystack = (topic = "", bankName = "", sectionName = "") =>
    `${topic} ${bankName} ${sectionName}`.trim();

const isGenericRegenFeedback = (text) => {
    const s = String(text || "").trim().toLowerCase();
    if (!s) return true;
    if (/\binclude\b/.test(s) && /\bexclude\b/.test(s)) return false;
    if (/\binclude\b/.test(s) && /\bchapters?\b/.test(s)) return false;
    if (/\bexclude\b/.test(s) && s.length >= 45) return false;
    return (
        /stay strictly on the stated topic/.test(s) ||
        /remove tangential or generic/.test(s) ||
        /ensure (all )?questions are directly (related|relevant)/.test(s) ||
        /focus on core subjects/.test(s) ||
        /ensure all questions are directly related to the curriculum/.test(s) ||
        /focus more on questions specific to/.test(s) ||
        s.length < 40
    );
};

/** Parse actionable Include/Exclude lines from the OpenAI reviewer. */
export const parseRegenerationFeedbackDirectives = (instructions = "") => {
    const raw = String(instructions || "").trim();
    const includeMatch = raw.match(/\binclude[s]?\s+(.+?)(?=\s*exclude\b|$)/is);
    const excludeMatch = raw.match(/\bexclude[s]?\s+(.+?)$/is);
    const includeText = includeMatch
        ? includeMatch[1].trim().replace(/[.\s]+$/, "")
        : "";
    const excludeText = excludeMatch
        ? excludeMatch[1].trim().replace(/[.\s]+$/, "")
        : "";

    const includeHay = includeText || raw;
    const subjectHits = {
        physics: /\bphysics\b/i.test(includeHay),
        chemistry: /\bchemistry\b/i.test(includeHay),
        biology: /\bbiology\b/i.test(includeHay),
        mathematics: /\b(math(?:ematics)?|maths?)\b/i.test(includeHay),
    };
    const mentionedSubjects = Object.entries(subjectHits)
        .filter(([, hit]) => hit)
        .map(([id]) => id);
    const singleSubjectLock =
        mentionedSubjects.length === 1 ? mentionedSubjects[0] : null;

    const isSpecific =
        Boolean(includeText && excludeText) ||
        Boolean(includeText && /\bchapters?\b/i.test(includeText)) ||
        Boolean(excludeText && excludeText.length > 12 && /\binclude\b/i.test(raw));

    return {
        raw,
        includeText,
        excludeText,
        singleSubjectLock,
        isSpecific,
    };
};

const buildSpecificRegenerationInstructions = (
    directives,
    { topic = "", boardLabel = "", classLabel = "" } = {}
) => {
    const label = [boardLabel, classLabel].filter(Boolean).join(" ") || topic;
    const parts = [
        `**REVIEWER MANDATE (highest priority — overrides generic syllabus guesses):**`,
        directives.raw,
    ];

    if (directives.singleSubjectLock === "physics") {
        parts.push(
            `**Batch subject lock:** Every question must be **${label} Physics ONLY** — no Chemistry, Biology, Economics, CS/IT, or GK in this batch.`,
            directives.includeText
                ? `**Chapter targets (from reviewer):** ${directives.includeText}`
                : "",
            "Spread across at least 4 distinct Physics units (e.g. electrostatics, current electricity, EMI, AC circuits, optics, semiconductors, modern physics).",
            "Use ICSE board-exam MCQ style with numerical or application setups where appropriate."
        );
    } else if (directives.singleSubjectLock === "chemistry") {
        parts.push(
            `**Batch subject lock:** Every question must be **${label} Chemistry ONLY** for this batch.`,
            directives.includeText
                ? `**Chapter targets:** ${directives.includeText}`
                : ""
        );
    } else if (directives.singleSubjectLock === "biology") {
        parts.push(
            `**Batch subject lock:** Every question must be **${label} Biology ONLY** for this batch.`,
            directives.includeText
                ? `**Chapter targets:** ${directives.includeText}`
                : ""
        );
    } else if (directives.singleSubjectLock === "mathematics") {
        parts.push(
            `**Batch subject lock:** Every question must be **${label} Mathematics ONLY** for this batch.`,
            directives.includeText
                ? `**Chapter targets:** ${directives.includeText}`
                : ""
        );
    }

    if (directives.excludeText) {
        parts.push(
            `**Forbidden in this batch (one violation fails the set):** ${directives.excludeText}`,
            "Also forbidden unless explicitly included above: Java, Python, Computer Science, IT/data topics, Economics, Commerce, Civics, Law, and generic GK."
        );
    }

    parts.push(
        "Do not add other subjects to fill the question count.",
        "Before output, verify each draft against the INCLUDE and EXCLUDE rules; replace any item that fails."
    );

    return parts.filter(Boolean).join("\n");
};

/** Turn vague evaluator feedback into concrete generation directives. */
export const enrichRegenerationInstructions = ({
    instructions = "",
    examProfile = "competitive",
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
} = {}) => {
    const raw = String(instructions || "").trim();
    const hay = topicHaystack(topic, bankName, sectionName).toLowerCase();
    const profile =
        examProfile || detectExamProfile({ topic, bankName, sectionName });

    const directives = parseRegenerationFeedbackDirectives(raw);
    if (directives.isSpecific && raw && !isGenericRegenFeedback(raw)) {
        const board = /\bicse\b/.test(hay)
            ? "ICSE"
            : /\bcbse\b/.test(hay)
              ? "CBSE"
              : "";
        const classMatch = hay.match(/\bclass\s*(\d{1,2})\b/);
        return buildSpecificRegenerationInstructions(directives, {
            topic,
            boardLabel: board,
            classLabel: classMatch ? `Class ${classMatch[1]}` : "",
        });
    }

    if (profile === "board") {
        const board = /\bicse\b/.test(hay)
            ? "ICSE"
            : /\bcbse\b/.test(hay)
              ? "CBSE"
              : "school board";
        const classMatch = hay.match(/\bclass\s*(\d{1,2})\b/);
        const classLabel = classMatch ? `Class ${classMatch[1]}` : "";
        const label = [board, classLabel].filter(Boolean).join(" ");

        if (/\bicse\b/.test(hay) && /\bclass\s*12\b/.test(hay)) {
            return [
                raw && !isGenericRegenFeedback(raw) ? raw : "",
                `Generate ONLY ${label} prescribed syllabus questions from Physics, Chemistry, and Biology (science stream).`,
                "Use recognizable board chapters: electrostatics, EMI, optics, chemical kinetics, equilibrium, organic named reactions, cell biology, genetics, etc.",
                "STRICTLY EXCLUDE: Computer Science, Java, Python, IT/data concepts, Economics, Commerce, Civics, History, Law, Constitution, and generic GK trivia.",
                "Every stem must read like an ICSE Class 12 board exam MCQ — not university/JEE/NEET-only depth.",
                "Spread questions across at least 3 different syllabus units; no duplicate micro-topics.",
            ]
                .filter(Boolean)
                .join(" ");
        }

        return [
            raw && !isGenericRegenFeedback(raw) ? raw : "",
            `Generate ONLY ${label || "board"} syllabus-aligned questions for the stated topic.`,
            "Exclude unrelated subjects, generic GK, and entrance-exam-only drill unless the topic names JEE/NEET.",
            "Use board-typical chapter topics and application-style stems.",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (profile === "jee_main" || profile === "jee_advanced") {
        const label =
            profile === "jee_advanced" ? "JEE Advanced" : "JEE Main";
        return [
            raw && !isGenericRegenFeedback(raw) ? raw : "",
            `Generate ONLY ${label} Physics, Chemistry, or Mathematics questions aligned with the topic.`,
            "Exclude Biology, Botany, Zoology, and school-board-only trivia unless the topic explicitly requires them.",
            "Use multi-step numerical/conceptual stems typical of ${label} — not generic definition recall.",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (profile === "neet") {
        return [
            raw && !isGenericRegenFeedback(raw) ? raw : "",
            "Generate ONLY NEET-aligned Physics, Chemistry, or Biology for the topic.",
            "Exclude unrelated engineering/math drill and generic GK.",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (profile === "cat") {
        return [
            raw && !isGenericRegenFeedback(raw) ? raw : "",
            "Generate ONLY CAT-aligned questions for the stated section/topic — VARC uses RC passages, QA uses aptitude traps (not JEE math), DILR uses linked data sets.",
            "Match real CAT difficulty from the exam reference brief — not school worksheets or coaching chapter tests.",
        ]
            .filter(Boolean)
            .join(" ");
    }

    if (isGenericRegenFeedback(raw)) {
        const catHint = (categoryPaths || []).length
            ? ` Category context: ${categoryPaths.join("; ")}.`
            : "";
        return `Every question must directly test the topic "${topic}". Remove generic, tangential, or cross-subject trivia.${catHint} Use exam-appropriate chapter depth and application-style stems.`;
    }

    return raw;
};

export const buildRegenerationQualityGatesBlock = ({
    topic = "",
    bankName = "",
    examProfile = "competitive",
    topicRelevanceFeedback = null,
    maxSelectableSlots = 0,
    generateIntent = "regen",
} = {}) => {
    const isInitial = generateIntent === "initial";
    const score = Number(topicRelevanceFeedback?.overallScore);
    const countNote =
        Number(maxSelectableSlots) > 0
            ? ` All ${maxSelectableSlots} items must pass every gate below.`
            : "";
    const gateHeader = isInitial
        ? "**GENERATION QUALITY GATES (must pass before output — automated review rejects failures):**"
        : "**REGENERATION QUALITY GATES (must pass for 85+ re-review):**";

    const feedbackText =
        topicRelevanceFeedback?.regenerationInstructions ||
        topicRelevanceFeedback?.summary ||
        "";
    const directives = parseRegenerationFeedbackDirectives(feedbackText);
    const profile = examProfile || "competitive";

    if (profile === "board" && directives.singleSubjectLock === "physics") {
        return `
${gateHeader.replace(":**", " — PHYSICS-ONLY BATCH:**")}${countNote}
1. **100% Physics:** Every stem tests ICSE Class 12 Physics — electromagnetism, semiconductors, EMI, optics, electrostatics, current electricity, etc.
2. **Chapter anchor:** Each question names or clearly implies a Physics unit from the reviewer INCLUDE line.
3. **Zero forbidden topics:** No Java, Python, CS/IT, data management, Economics, Commerce, Chemistry, Biology, Civics, or GK.
4. **Board style:** ICSE Class 12 paper MCQs — not JEE-only tricks or university depth.
5. **Spread:** At least 4 distinct Physics chapters/units; no duplicate micro-topic.
6. **Self-check:** "Would an ICSE Physics teacher file this under Class 12 Physics?" — if no, replace.${
            Number.isFinite(score) && score < REGEN_TARGET_SCORE
                ? `\nPrior set scored **${score}/100** — this Physics-only batch must reach **${REGEN_TARGET_SCORE}+**.`
                : ""
        }`;
    }

    const gatesByProfile = {
        board: `
${gateHeader}${countNote}
1. **Syllabus lock:** Each question maps to a named chapter/unit on the official board syllabus for "${topic}".
2. **Subject lock:** Only subjects prescribed for this board class — no CS/Java/Python, Economics, Civics, Law, or GK unless the topic explicitly names them.
3. **Stem quality:** Board-exam style (application, numerical setup, or reasoning) — ban bare "What is…?" / "Which of the following is…?" definition recall unless the topic is narrow.
4. **Topic anchor:** A reviewer reading only the stem can identify "${topic}" without guessing.
5. **Diversity:** At least 3 distinct chapters/units; no two questions on the same micro-concept.
6. **Self-check before output:** For each draft ask: "Would this appear on an official ${topic} paper?" If unsure, replace it.`,
        jee_main: `
${gateHeader}${countNote}
1. **Subject lock:** Physics, Chemistry, or Mathematics only — match the topic.
2. **No biology/zoology** unless the topic explicitly requires it.
3. **JEE Main rigor:** Multi-step or linked-concept stems; plausible distractors from common slips.
4. **No school-board trivia** or unrelated GK.
5. **Answer integrity:** Marked answer must be factually correct; explanation must derive the same answer; computed values must appear among options verbatim.
6. **No duplicate/near-duplicate options** — distinct isomers, values, and expressions only.
7. **Self-check:** Each item should feel like a JEE Main shift-paper question for this topic.`,
        jee_advanced: `
${gateHeader}${countNote}
1. **Subject lock:** Physics, Chemistry, or Mathematics — JEE Advanced standard.
2. **Depth:** Non-trivial reasoning; avoid single-step plug-in drills.
3. **Self-check:** Each item belongs on a JEE Advanced paper for this topic.`,
        neet: `
${gateHeader}${countNote}
1. **Subject lock:** Physics, Chemistry, or Biology for NEET syllabus.
2. **NEET style:** NCERT-rooted concepts with clinical/biological application where relevant.
3. **Self-check:** No engineering math drills or unrelated GK.`,
        cat: `
${gateHeader}${countNote}
1. **Section lock:** Match CAT VARC / DILR / QA style for the topic — not JEE math, not school grammar worksheets.
2. **CAT rigor:** Insight-based aptitude; RC passages with inference; DILR linked sets where applicable.
3. **Self-check:** Each item should feel like a real CAT section question for this topic.`,
    };

    const gates =
        gatesByProfile[profile] ||
        `
${gateHeader}${countNote}
1. Every stem must unmistakably test "${topic}" — not a neighbouring chapter or subject.
2. Ban generic trivia, cross-curricular drift, and one-line definition recall.
3. Use at least 3 distinct subtopics from the syllabus scope.
4. **Answer integrity:** Marked answer correct; explanation supports it; no explanation/option mismatch.
5. **Self-check:** Replace any item a strict reviewer would call tangential or factually inconsistent.`;

    const gapNote =
        !isInitial &&
        Number.isFinite(score) &&
        score < REGEN_TARGET_SCORE
            ? `\nPrior set scored **${score}/100** — replacement must clear **${REGEN_TARGET_SCORE}+**. Incremental rewording is not enough; replace weak items entirely.\n`
            : "";

    return `${gapNote}${gates}`;
};

export const GENERATE_INTENTS = {
    INITIAL: "initial",
    EVALUATION_REGEN: "evaluation_regen",
};

/**
 * @returns {string|null} Error message when invalid, otherwise null.
 */
export function validateTopicRelevanceEvaluationWorkflow({
    alreadyEvaluated = false,
    evaluationProvider = null,
    questionCount = 0,
} = {}) {
    if (alreadyEvaluated) {
        const label =
            evaluationProvider === "gemini"
                ? "Gemini"
                : evaluationProvider === "openai"
                  ? "OpenAI"
                  : "this provider";
        return evaluationProvider
            ? `Topic relevance was already evaluated with ${label} for this question set`
            : "Topic relevance was already evaluated for this question set";
    }
    if (!questionCount || questionCount < 1) {
        return "At least one question is required for topic relevance validation";
    }
    return null;
}

/**
 * @returns {string|null} Error message when invalid, otherwise null.
 */
export function validateGenerationWorkflow({
    generateIntent = GENERATE_INTENTS.INITIAL,
    topicRelevanceEvaluated = false,
    topicRelevanceRegenerated = false,
    topicRelevanceFeedback = null,
    hasGeneratedQuestions = false,
    allowContinuation = false,
} = {}) {
    const intent =
        generateIntent === GENERATE_INTENTS.EVALUATION_REGEN
            ? GENERATE_INTENTS.EVALUATION_REGEN
            : GENERATE_INTENTS.INITIAL;

    if (intent === GENERATE_INTENTS.EVALUATION_REGEN) {
        if (!topicRelevanceEvaluated) {
            return "Generate questions and evaluate topic relevance before regenerating";
        }
        if (topicRelevanceRegenerated) {
            return "Evaluation-based regeneration was already used for this question set";
        }
        if (
            !topicRelevanceFeedback ||
            !Number.isFinite(Number(topicRelevanceFeedback.overallScore))
        ) {
            return "topicRelevanceFeedback with overallScore is required for evaluation regeneration";
        }
        const score = Number(topicRelevanceFeedback.overallScore);
        const confirmedIssues = (
            topicRelevanceFeedback.confirmedIssues ||
            topicRelevanceFeedback.correctnessIssues ||
            []
        ).filter(
            (item) =>
                item &&
                String(item.confidence || "confirmed").toLowerCase() !== "suspected"
        );
        const correctness = Number(topicRelevanceFeedback.correctnessScore);
        const topic = Number(topicRelevanceFeedback.topicRelevanceScore);
        const allowRegen =
            score < TOPIC_RELEVANCE_PASS_SCORE ||
            confirmedIssues.length > 0 ||
            (Number.isFinite(correctness) &&
                Number.isFinite(topic) &&
                correctness < topic - 5);
        if (!allowRegen) {
            return `Regeneration requires score below ${TOPIC_RELEVANCE_PASS_SCORE} or confirmed correctness issues from evaluation`;
        }
        return null;
    }

    if (
        !allowContinuation &&
        hasGeneratedQuestions &&
        !topicRelevanceEvaluated
    ) {
        return "Check topic relevance before generating more questions";
    }

    if (topicRelevanceFeedback && intent !== GENERATE_INTENTS.EVALUATION_REGEN) {
        return "topicRelevanceFeedback is only allowed with generateIntent evaluation_regen";
    }
    return null;
}

export function assertTopicRelevanceEvaluationAllowed(params) {
    const message = validateTopicRelevanceEvaluationWorkflow(params);
    if (message) {
        throw new ApiError(400, message);
    }
}

export function assertGenerationWorkflowAllowed(params) {
    const message = validateGenerationWorkflow(params);
    if (message) {
        throw new ApiError(400, message);
    }
}

const VERDICT_BY_SCORE = [
    { min: 90, verdict: "strong" },
    { min: 70, verdict: "moderate" },
    { min: 50, verdict: "weak" },
    { min: 0, verdict: "off-topic" },
];

const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

/** Infer solve steps from explanation when `_solveSteps` was stripped from the client payload. */
export const inferSolveStepsFromExplanation = (explanation = "") => {
    const text = String(explanation || "").trim();
    if (!text) return [];
    const beforeTherefore = (text.split(/\bTherefore\b/i)[0] || text).trim();
    const stepTagged = [
        ...beforeTherefore.matchAll(
            /Step\s+(\d+):\s*([\s\S]*?)(?=Step\s+\d+:|$)/gi
        ),
    ];
    if (stepTagged.length >= 2) {
        return stepTagged.map((m) => m[2].trim()).filter(Boolean);
    }
    const sentences = beforeTherefore
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 24);
    return sentences.slice(0, 6);
};

/** Restore solve-step metadata so OpenAI difficulty audit sees derivation depth. */
export const enrichQuestionsForDifficultyAudit = (questions = []) =>
    (Array.isArray(questions) ? questions : []).map((q) => {
        const explanation = q.explanation
            ? stripMetaCommentary(String(q.explanation))
            : q.explanation;
        const base = explanation !== q.explanation ? { ...q, explanation } : q;
        if (Array.isArray(base._solveSteps) && base._solveSteps.length >= 2) {
            return {
                ...base,
                _solveSteps: base._solveSteps.map(stripMetaCommentary).filter(Boolean),
            };
        }
        const steps = inferSolveStepsFromExplanation(explanation).map(stripMetaCommentary);
        if (steps.length >= 2) return { ...base, _solveSteps: steps };
        return base;
    });

/**
 * Pick up to `maxSample` questions, stratified by questionType when truncating.
 */
export const sampleQuestionsForValidation = (questions, maxSample = TOPIC_RELEVANCE_MAX_SAMPLE) => {
    const list = Array.isArray(questions) ? questions : [];
    const totalCount = list.length;
    if (totalCount <= maxSample) {
        return {
            sampled: list.map((q, i) => ({ ...q, sampleNumber: i + 1, originalIndex: i })),
            totalCount,
            sampleCount: totalCount,
        };
    }

    const buckets = new Map();
    for (let i = 0; i < list.length; i++) {
        const key = String(list[i]?.questionType || "single").toLowerCase();
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ q: list[i], originalIndex: i });
    }

    const picked = [];
    let remaining = maxSample;
    const bucketKeys = [...buckets.keys()];

    for (const key of bucketKeys) {
        const pool = buckets.get(key) || [];
        const quota = Math.max(1, Math.floor((pool.length / totalCount) * maxSample));
        const take = Math.min(quota, pool.length, remaining);
        shuffleInPlace(pool);
        for (let n = 0; n < take; n++) {
            const item = pool[n];
            picked.push({ ...item.q, originalIndex: item.originalIndex });
        }
        buckets.set(key, pool.slice(take));
        remaining -= take;
    }

    if (remaining > 0) {
        const leftovers = bucketKeys.flatMap((key) =>
            (buckets.get(key) || []).map(({ q, originalIndex }) => ({
                ...q,
                originalIndex,
            }))
        );
        shuffleInPlace(leftovers);
        while (remaining > 0 && leftovers.length) {
            picked.push(leftovers.pop());
            remaining--;
        }
    }

    return {
        sampled: picked.slice(0, maxSample).map((q, i) => ({
            ...q,
            sampleNumber: i + 1,
        })),
        totalCount,
        sampleCount: Math.min(maxSample, picked.length),
    };
};

const truncate = (text, maxLen) => {
    const s = String(text || "").trim();
    if (s.length <= maxLen) return s;
    return `${s.slice(0, Math.max(3, maxLen - 1))}…`;
};

const formatQuestionBlock = (q) => {
    const lines = [`#${q.sampleNumber} [${q.questionType || "single"}]`];
    const assignedTier = normalizeQuestionTier(q.difficultyTier || q.difficulty);
    if (assignedTier) {
        lines.push(`Assigned difficultyTier: ${assignedTier}`);
    }
    if (q.passage) {
        lines.push(`Passage excerpt: ${truncate(q.passage, 600)}`);
    }
    lines.push(`Question: ${truncate(q.questionText, 900)}`);
    const opts = (q.options || []).filter((o) => String(o || "").trim());
    if (opts.length) {
        opts.forEach((opt, i) => {
            lines.push(`${String.fromCharCode(65 + i)}. ${truncate(opt, 280)}`);
        });
    }
    if (q.correctAnswer) {
        lines.push(`Marked correct answer: ${truncate(q.correctAnswer, 320)}`);
    }
    const steps = q._solveSteps || q.solveSteps;
    if (Array.isArray(steps) && steps.length) {
        lines.push(`Solve steps (${steps.length}):`);
        steps.slice(0, 6).forEach((step, i) => {
            lines.push(`  ${i + 1}. ${truncate(step, 320)}`);
        });
    }
    if (q._conceptSlot || q.conceptSlot) {
        lines.push(`Archetype: ${q._conceptSlot || q.conceptSlot}`);
    }
    if (q.explanation) {
        lines.push(`Explanation: ${truncate(q.explanation, 900)}`);
    }
    return lines.join("\n");
};

const clampScore = (n) => {
    if (n == null || n === "") return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.min(100, Math.round(v)));
};

/** Blend topic-fit and correctness into one overall score. */
export const blendValidationScores = (
    topicRelevanceScore,
    correctnessScore,
    authenticityScore = null,
    styleScore = null,
    explanationQualityScore = null
) => {
    const topic = clampScore(topicRelevanceScore);
    const correctness = clampScore(correctnessScore);
    const authenticity = clampScore(authenticityScore);
    const style = clampScore(styleScore);
    const explanationQuality = clampScore(explanationQualityScore);

    let blended = null;
    if (authenticity != null && topic != null && correctness != null) {
        blended = Math.round(
            topic * JEE_TOPIC_BLEND_WEIGHT +
                correctness * JEE_CORRECTNESS_BLEND_WEIGHT +
                authenticity * JEE_AUTHENTICITY_BLEND_WEIGHT
        );
    } else if (style != null && topic != null && correctness != null) {
        blended = Math.round(
            topic * TOPIC_STYLE_BLEND_WEIGHT +
                correctness * CORRECTNESS_STYLE_BLEND_WEIGHT +
                style * STYLE_BLEND_WEIGHT
        );
    } else if (topic == null && correctness == null) {
        blended = null;
    } else if (topic == null) {
        blended = correctness;
    } else if (correctness == null) {
        blended = topic;
    } else {
        blended = Math.round(
            topic * TOPIC_RELEVANCE_BLEND_WEIGHT +
                correctness * CORRECTNESS_BLEND_WEIGHT
        );
    }

    if (blended != null && explanationQuality != null) {
        return Math.round(blended * 0.88 + explanationQuality * 0.12);
    }
    return blended;
};

/** Caps driven by factual defects, craft scores, and difficulty match. */
export const applyValidationScoreCaps = (
    overallScore,
    factualIssues = [],
    {
        styleScore = null,
        difficultyMatchScore = null,
        explanationQualityScore = null,
    } = {}
) => {
    let score = clampScore(overallScore) ?? 0;
    const critical = (factualIssues || []).filter(
        (i) => String(i.severity || "").toLowerCase() === "critical"
    );
    const major = (factualIssues || []).filter(
        (i) => String(i.severity || "").toLowerCase() === "major"
    );
    if (
        critical.some((i) =>
            /does not appear among any option|not among any option/i.test(i.issue)
        )
    ) {
        score = Math.min(score, OVERALL_SCORE_CAPS.ANSWER_NOT_IN_OPTIONS);
    }
    if (critical.length >= 1) score = Math.min(score, OVERALL_SCORE_CAPS.ONE_CRITICAL);
    if (critical.length >= 2) score = Math.min(score, OVERALL_SCORE_CAPS.TWO_CRITICAL);
    if (critical.length >= 3) score = Math.min(score, OVERALL_SCORE_CAPS.THREE_CRITICAL);
    if (major.length >= 3 && critical.length >= 1) {
        score = Math.min(score, OVERALL_SCORE_CAPS.THREE_MAJOR_PLUS_CRITICAL);
    }
    const style =
        styleScore != null && styleScore !== ""
            ? Number(styleScore)
            : NaN;
    if (Number.isFinite(style) && style < 45) {
        score = Math.min(score, OVERALL_SCORE_CAPS.LOW_STYLE);
    }
    const difficulty =
        difficultyMatchScore != null && difficultyMatchScore !== ""
            ? Number(difficultyMatchScore)
            : NaN;
    if (Number.isFinite(difficulty)) {
        if (difficulty < DIFFICULTY_MATCH_CAP_THRESHOLDS.LOW) {
            score = Math.min(score, OVERALL_SCORE_CAPS.LOW_DIFFICULTY_MATCH_40);
        } else if (difficulty < DIFFICULTY_MATCH_CAP_THRESHOLDS.MID) {
            score = Math.min(score, OVERALL_SCORE_CAPS.LOW_DIFFICULTY_MATCH_60);
        }
    }
    const explanationQuality =
        explanationQualityScore != null && explanationQualityScore !== ""
            ? Number(explanationQualityScore)
            : NaN;
    if (
        Number.isFinite(explanationQuality) &&
        explanationQuality < EXPLANATION_QUALITY_PASS_FLOOR
    ) {
        score = Math.min(score, OVERALL_SCORE_CAPS.LOW_EXPLANATION_QUALITY);
    }
    return score;
};

const normalizeCorrectnessIssues = (issues, { defaultSeverity = "major" } = {}) => {
    if (!Array.isArray(issues)) return [];
    return issues
        .map((item, idx) => {
            if (typeof item === "string") {
                const text = item.trim();
                return text
                    ? {
                          questionNumber: idx + 1,
                          issue: text,
                          severity: defaultSeverity,
                          confidence: "confirmed",
                      }
                    : null;
            }
            if (!item || typeof item !== "object") return null;
            const issue = String(item.issue || item.description || "").trim();
            if (!issue) return null;
            const qn = Number(item.questionNumber ?? item.sampleNumber);
            const confidence = String(
                item.confidence || (defaultSeverity === "suspected" ? "suspected" : "confirmed")
            ).toLowerCase();
            return {
                questionNumber: Number.isFinite(qn) ? qn : null,
                issue,
                severity: String(item.severity || defaultSeverity).toLowerCase(),
                confidence: confidence === "suspected" ? "suspected" : "confirmed",
                category: ALL_ISSUE_CATEGORIES.has(
                    String(item.category || "").toLowerCase()
                )
                    ? String(item.category).toLowerCase()
                    : classifyIssueCategory({ issue }),
            };
        })
        .filter(Boolean);
};

const severityRank = (item) =>
    ({ critical: 0, major: 1, suspected: 2 })[
        String(item?.severity || "major").toLowerCase()
    ] ?? 9;

/** One scoring penalty per question — avoids double-counting the same root bug. */
const dedupeIssuesByQuestionForScoring = (issues = []) => {
    const unnumbered = [];
    const byQ = new Map();
    for (const item of issues) {
        const qn = Number(item.questionNumber);
        if (!Number.isFinite(qn)) {
            unnumbered.push(item);
            continue;
        }
        const prev = byQ.get(qn);
        if (!prev || severityRank(item) < severityRank(prev)) {
            byQ.set(qn, item);
        }
    }
    return [...byQ.values(), ...unnumbered];
};

const scoreFromConfirmedIssues = (
    confirmedIssues = [],
    modelScore = null,
    {
        criticalPenalty = CORRECTNESS_CRITICAL_PENALTY,
        majorPenalty = CORRECTNESS_MAJOR_PENALTY,
        minorPenalty = null,
    } = {}
) => {
    const base = clampScore(modelScore) ?? 100;
    const forScoring = dedupeIssuesByQuestionForScoring(confirmedIssues);
    if (!forScoring.length) return base;
    const minorP = minorPenalty ?? Math.max(2, Math.round(majorPenalty * 0.35));
    let penalty = 0;
    for (const item of forScoring) {
        const sev = String(item.severity || "major").toLowerCase();
        if (sev === "critical") penalty += criticalPenalty;
        else if (sev === "minor" || sev === "suspected") penalty += minorP;
        else penalty += majorPenalty;
    }
    return Math.max(0, Math.min(base, 100 - penalty));
};

const styleRegenFooter = (examProfile = "competitive") => {
    if (examProfile === "cat") {
        return "Use plausible CAT-style distractors (trap values from partial work), distinct options, and concise explanations without draft commentary.";
    }
    if (examProfile === "jee_main" || examProfile === "jee_advanced") {
        return "Use NTA-style distractors, distinct options, and explanations without draft commentary.";
    }
    if (examProfile === "neet") {
        return "Use NCERT-plausible distractors, distinct options, and explanations without draft commentary.";
    }
    return "Use exam-appropriate plausible distractors, distinct options, and explanations without draft commentary.";
};

/** Per-dimension penalties (deduped — one slot per question per dimension). */
export const DIMENSION_PENALTIES = {
    factual: { critical: CORRECTNESS_CRITICAL_PENALTY, major: CORRECTNESS_MAJOR_PENALTY, minor: 3 },
    style: { critical: 8, major: 5, minor: 2 },
    diversity: { critical: 10, major: 6, minor: 3 },
    authenticity: { critical: 10, major: 6, minor: 3 },
    difficulty: { critical: 10, major: 6, minor: 3 },
};

/** Independent dimension scores from tagged issues (+ optional LLM subscores). */
export const computeDimensionalScores = (
    confirmedIssues = [],
    {
        modelCorrectnessScore = null,
        authenticityAuditScore = null,
        difficultyAuditScore = null,
        explanationQualityAuditScore = null,
        deterministicDifficultyScore = null,
    } = {}
) => {
    const {
        tagged,
        factualIssues,
        styleIssues,
        diversityIssues,
        authenticityIssues,
        difficultyIssues,
    } = partitionIssuesByDimension(confirmedIssues);

    const scoreDimension = (issues, penalties, modelScore = null) =>
        scoreFromConfirmedIssues(issues, modelScore, {
            criticalPenalty: penalties.critical,
            majorPenalty: penalties.major,
            minorPenalty: penalties.minor,
        });

    const correctnessScore = scoreDimension(
        factualIssues,
        DIMENSION_PENALTIES.factual,
        modelCorrectnessScore
    );
    const styleFromIssues = scoreDimension(styleIssues, DIMENSION_PENALTIES.style, 100);
    const diversityFromIssues = scoreDimension(
        diversityIssues,
        DIMENSION_PENALTIES.diversity,
        100
    );
    const authenticityFromIssues = scoreDimension(
        authenticityIssues,
        DIMENSION_PENALTIES.authenticity,
        100
    );
    const difficultyFromIssues = scoreDimension(
        difficultyIssues,
        DIMENSION_PENALTIES.difficulty,
        100
    );

    const explanationQualityScore =
        clampScore(explanationQualityAuditScore) ?? styleFromIssues;

    const styleScore =
        explanationQualityAuditScore != null
            ? Math.round(styleFromIssues * 0.55 + explanationQualityScore * 0.45)
            : styleFromIssues;

    const diversityScore =
        diversityIssues.length > 0 ? diversityFromIssues : 100;

    const authenticityScore =
        authenticityAuditScore != null
            ? Math.round(
                  clampScore(authenticityAuditScore) * 0.75 +
                      authenticityFromIssues * 0.25
              )
            : authenticityIssues.length > 0
              ? authenticityFromIssues
              : null;

    const difficultyMatchScore =
        difficultyAuditScore != null
            ? (() => {
                  const llm = clampScore(difficultyAuditScore);
                  const det = clampScore(deterministicDifficultyScore);
                  const core =
                      det != null
                          ? Math.round(llm * 0.4 + det * 0.6)
                          : llm;
                  return Math.round(core * 0.8 + difficultyFromIssues * 0.2);
              })()
            : deterministicDifficultyScore != null
              ? Math.round(
                    clampScore(deterministicDifficultyScore) * 0.8 +
                        difficultyFromIssues * 0.2
                )
              : difficultyIssues.length > 0
                ? difficultyFromIssues
                : null;

    return {
        correctnessScore,
        styleScore,
        diversityScore,
        authenticityScore,
        difficultyMatchScore,
        explanationQualityScore,
        factualIssues,
        styleIssues,
        diversityIssues,
        authenticityIssues,
        difficultyIssues,
        tagged,
    };
};

/** Factual correctness + style craft scores from tagged issues. */
export const computeSeparatedValidationScores = (
    confirmedIssues = [],
    modelCorrectnessScore = null
) => {
    const dimensional = computeDimensionalScores(confirmedIssues, {
        modelCorrectnessScore,
    });
    return {
        correctnessScore: dimensional.correctnessScore,
        styleScore: dimensional.styleScore,
        diversityScore: dimensional.diversityScore,
        authenticityScore: dimensional.authenticityScore,
        difficultyMatchScore: dimensional.difficultyMatchScore,
        factualIssues: dimensional.factualIssues,
        styleIssues: dimensional.styleIssues,
        diversityIssues: dimensional.diversityIssues,
        authenticityIssues: dimensional.authenticityIssues,
        difficultyIssues: dimensional.difficultyIssues,
        tagged: dimensional.tagged,
    };
};

/** Max length for regenerationInstructions in API payloads (evaluate → regen round-trip). */
export const REGENERATION_INSTRUCTIONS_MAX_CHARS = 2000;

const shortenIssueText = (issue) =>
    String(issue || "")
        .replace(/\s*— distinguish properly \(e\.g\. [^)]+\)\.?/gi, "")
        .replace(/\s*— not NTA-style distractor design\.?/gi, "")
        .trim()
        .slice(0, 140);

/** One compact line per question — avoids 800+ char regen payloads from duplicate issue spam. */
const groupIssuesForRegen = (issues = []) => {
    const byQ = new Map();
    for (const item of issues) {
        const qn = item.questionNumber;
        if (!Number.isFinite(qn)) continue;
        if (!byQ.has(qn)) byQ.set(qn, []);
        byQ.get(qn).push(item);
    }
    const severityRank = { critical: 0, major: 1, suspected: 2 };
    const lines = [];
    for (const qn of [...byQ.keys()].sort((a, b) => a - b)) {
        const sorted = [...byQ.get(qn)].sort(
            (a, b) =>
                (severityRank[String(a.severity || "").toLowerCase()] ?? 9) -
                (severityRank[String(b.severity || "").toLowerCase()] ?? 9)
        );
        const top = sorted
            .slice(0, 2)
            .map((i) => shortenIssueText(i.issue))
            .filter(Boolean);
        const unique = [...new Set(top)];
        if (unique.length) lines.push(`Q${qn}: ${unique.join("; ")}`);
    }
    return lines;
};

export const clampRegenerationInstructions = (
    text = "",
    maxLen = REGENERATION_INSTRUCTIONS_MAX_CHARS
) => {
    const trimmed = String(text || "").trim();
    if (trimmed.length <= maxLen) return trimmed;
    return `${trimmed.slice(0, maxLen - 3).trimEnd()}...`;
};

const buildCorrectnessRegenerationInstructions = (
    issues = [],
    { examProfile = "competitive" } = {}
) => {
    const {
        factualIssues,
        styleIssues,
        diversityIssues,
        authenticityIssues,
        difficultyIssues,
    } = partitionIssuesByDimension(issues);

    const factualLines = groupIssuesForRegen(factualIssues);
    const styleLines = groupIssuesForRegen(styleIssues);
    const diversityLines = groupIssuesForRegen(diversityIssues);
    const authenticityLines = groupIssuesForRegen(authenticityIssues);
    const difficultyLines = groupIssuesForRegen(difficultyIssues);

    if (
        !factualLines.length &&
        !styleLines.length &&
        !diversityLines.length &&
        !authenticityLines.length &&
        !difficultyLines.length
    ) {
        return "";
    }

    const parts = [];
    if (factualLines.length) {
        parts.push(
            "Fix factual and consistency defects:",
            ...factualLines.map((l) => `- ${l}`),
            "Verify each flawed item: marked answer correct, explanation derives it, computed value in options."
        );
    }
    if (styleLines.length) {
        parts.push(
            "Improve explanation quality and presentation:",
            ...styleLines.map((l) => `- ${l}`),
            styleRegenFooter(examProfile)
        );
    }
    if (diversityLines.length) {
        parts.push(
            "Increase batch diversity:",
            ...diversityLines.map((l) => `- ${l}`),
            "Use distinct stems, concepts, and setups — no near-duplicate questions in the same batch."
        );
    }
    if (authenticityLines.length) {
        parts.push(
            "Improve exam authenticity:",
            ...authenticityLines.map((l) => `- ${l}`),
            "Match NTA/JEE distractor design and avoid repetitive templates."
        );
    }
    if (difficultyLines.length) {
        parts.push(
            "Raise difficulty / depth to match the requested tier:",
            ...difficultyLines.map((l) => `- ${l}`),
            "Add multi-step reasoning beyond single-formula plug-in where the tier requires it."
        );
    }
    return clampRegenerationInstructions(parts.join("\n"));
};

/** Merge deterministic pre-audit with LLM correctness audit (stricter of the two). */
export const mergeCorrectnessAuditResults = (preAudit = {}, llmAudit = {}) => {
    const byKey = new Map();
    for (const item of [
        ...(preAudit.confirmedIssues || []),
        ...(llmAudit.confirmedIssues || []),
    ]) {
        const key = `${item.questionNumber ?? "?"}::${item.issue}`;
        if (!byKey.has(key)) byKey.set(key, item);
    }
    const confirmedIssues = tagIssueCategories([...byKey.values()]);
    const { factualIssues } = partitionIssuesByCategory(confirmedIssues);
    const modelFactual =
        factualIssues.length === 0
            ? Math.min(
                  clampScore(preAudit.correctnessScore) ?? 100,
                  clampScore(llmAudit.correctnessScore) ?? 100
              )
            : null;
    const separated = computeSeparatedValidationScores(
        confirmedIssues,
        modelFactual
    );
    return {
        correctnessScore: separated.correctnessScore,
        styleScore: separated.styleScore,
        factualIssues: separated.factualIssues,
        styleIssues: separated.styleIssues,
        confirmedIssues: separated.tagged,
        suspectedIssues: llmAudit.suspectedIssues || [],
    };
};

export const parseCorrectnessAuditResponse = (rawText) => {
    const parsed = parseJsonObjectFromAIText(rawText);
    const confirmedIssues = normalizeCorrectnessIssues(
        parsed.confirmedIssues || parsed.correctnessIssues || [],
        { defaultSeverity: "major" }
    ).map((item) => ({ ...item, confidence: "confirmed" }));

    const suspectedIssues = normalizeCorrectnessIssues(
        parsed.suspectedIssues || [],
        { defaultSeverity: "suspected" }
    ).map((item) => ({
        ...item,
        confidence: "suspected",
        severity: "suspected",
    }));

    const separated = computeSeparatedValidationScores(
        confirmedIssues,
        confirmedIssues.some((i) => i.category === ISSUE_CATEGORY.FACTUAL)
            ? null
            : parsed.correctnessScore
    );

    if (separated.correctnessScore == null) {
        throw new ApiError(500, "OpenAI returned an invalid correctness score");
    }

    return {
        correctnessScore: separated.correctnessScore,
        styleScore: separated.styleScore,
        factualIssues: separated.factualIssues,
        styleIssues: separated.styleIssues,
        confirmedIssues: separated.tagged,
        suspectedIssues,
    };
};

const isOpinionatedRegenFeedback = (text) => {
    const s = String(text || "").trim().toLowerCase();
    if (!s) return false;
    return (
        /\bconsider adding\b/.test(s) ||
        /\benhance variety\b/.test(s) ||
        /\bmaintaining the current emphasis\b/.test(s) ||
        /\bfocus more specifically\b/.test(s) ||
        (/\binclude additional\b/.test(s) && !/\bq\d+\b/.test(s)) ||
        (/\bexclude overly broad\b/.test(s) && !/\bwrong answer\b/.test(s))
    );
};

const isCoverageOnlyRegenFeedback = (text, { correctnessScore, topicRelevanceScore } = {}) => {
    const s = String(text || "").trim().toLowerCase();
    if (!s) return false;
    const correctness = Number(correctnessScore);
    const topic = Number(topicRelevanceScore);
    const correctnessWeak =
        Number.isFinite(correctness) &&
        Number.isFinite(topic) &&
        correctness < topic - 8;
    if (!correctnessWeak) return false;
    return (
        /\b(coverage|broader|more (questions|topics|chapters)|include more|focus more on)\b/.test(
            s
        ) &&
        !/\b(correct|explanation|contradict|wrong answer|mismatch|calculation|option)\b/.test(
            s
        )
    );
};

export const buildTopicRelevancePrompt = ({
    topic,
    bankName = "",
    subject = "",
    sectionName = "",
    difficulty = "",
    examProfile = "competitive",
    sampled,
    totalCount,
    sampleCount,
}) => {
    const context = [
        bankName ? `Bank: ${bankName}` : "",
        subject ? `Subject: ${subject}` : "",
        sectionName ? `Section: ${sectionName}` : "",
        difficulty ? `Difficulty: ${difficulty}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    const questionBlocks = sampled.map(formatQuestionBlock).join("\n\n");

    const boardTopicHint = /\b(icse|cbse|class\s*\d{1,2})\b/i.test(
        `${topic} ${bankName}`
    )
        ? `
**Board-topic note:** If the topic is a class/board label (e.g. ICSE Class 12) without a single subject, score DOWN topic relevance for: Computer Science/IT, Economics/Commerce, Civics/History/Law, generic GK, and university-only depth. Score UP for prescribed board science/math chapters.
**Low-score regeneration:** Prefer fixing factual/correctness defects first; only suggest broader syllabus coverage when topic relevance (not correctness) is the weak dimension.`
        : `
**Low-score regeneration:** If topic fit is strong but correctness is weak, target wrong answers and explanation mismatches — not broader coverage.`;

    return `You are an exam syllabus reviewer. Score how well this question SAMPLE matches the TOPIC.

Use **medium strictness** — fair but not harsh. Do NOT evaluate answer correctness here; another auditor handles that.

**TOPIC:**
${topic}
${context ? `\n**Context:**\n${context}` : ""}

**Sample (${sampleCount} of ${totalCount} questions):**
${questionBlocks}

**Topic relevance (topicRelevanceScore 0–100):**
- 90–100: Strong — almost all questions directly test the topic
- 75–89: Good — mostly on-topic; minor drift or one weak item
- 60–74: Moderate — mixed; several tangential or too broad items
- 40–59: Weak — partial overlap only
- 0–39: Poor/off-topic

**Rules:**
- Judge what each question tests (stem + options), not keywords alone
- Do NOT penalize for answer-key errors — only syllabus/topic fit
- Generic chapter drills that could fit any unit cap around 55–65
${
    examProfile === "cat"
        ? `
**CAT VARC note:** Penalize grammar/vocabulary/GMAT-style items when section is VARC. **All exams:** score by authentic question types for the detected profile; prioritize hard items but expect syllabus breadth across units. Do NOT lower topic relevance for trap setups on aptitude exams — those are correctness issues.`
        : ""
}
${boardTopicHint}

Return ONLY valid JSON:
{
  "topicRelevanceScore": 92,
  "regenerationInstructions": ""
}`;
};

/** Dedicated answer-key / explanation consistency audit (separate from topic fit). */
export const buildCorrectnessAuditPrompt = ({
    topic = "",
    difficulty = "",
    examProfile = "competitive",
    sampled,
    totalCount,
    sampleCount,
}) => {
    const questionBlocks = sampled.map(formatQuestionBlock).join("\n\n");
    const difficultyNote = difficulty
        ? `\n**Expected difficulty:** ${difficulty}`
        : "";
    const profileNote =
        examProfile === "cat"
            ? `
**CAT / aptitude context:** Work-rate, TSD, and percentage questions often mention intermediate values in the stem — do NOT flag as style issues when the marked answer is consistent. Percentage options (e.g. "25%") matching a rate in the stem are normal trap distractors, not defects. This leniency applies to **distractor craft and intermediate values only** — it does not relax protocol steps 5–6: a self-contradictory derivation or an ignored stem constraint is still a confirmed factual defect here, even when the marked option is right.`
            : examProfile === "jee_main" || examProfile === "jee_advanced"
              ? `
**JEE context:** Flag numerics not among options, duplicate options, and explanation/answer mismatches strictly.`
              : "";

    return `You are a strict MCQ answer-key auditor. Evaluate ONLY factual correctness and internal consistency — NOT topic coverage.
${profileNote}

**Topic context:** ${topic}${difficultyNote}

**Sample (${sampleCount} of ${totalCount} questions):**
${questionBlocks}

---

**VERIFICATION PROTOCOL — apply to EVERY question:**
1. Read stem and options. **Independently solve** or reason to your own answer (show key steps mentally).
2. Compare your answer to the **marked correct answer**.
3. If an **explanation** exists: verify it reaches the same conclusion as step 1.
4. For numerical questions: verify the final value appears among the options and matches the marked answer.
5. **Derivation self-consistency** — read the explanation as a chain of claims and check it never asserts something and then its opposite. Typical signatures:
   · A relation stated one way then reversed ("16 beats 1, 15 beats 2 …" followed by "1 beats 16, 2 beats 15 …").
   · A value derived, then silently replaced by a different one with no correction step.
   · A step that concedes the result is inconsistent ("this implies an overlap", "this contradicts …") and then proceeds anyway.
   · An empty or contentless step (e.g. a step that is just "." or a fragment).
6. **Stem-constraint compliance** — every condition stated in the stem must actually be used and satisfied. If the stem fixes a quantity ("exactly 10 students between A and B") and the explanation computes something different (17) and carries on regardless, that is a confirmed defect — either the stem or the reasoning is wrong.
7. **Functional-form / qualitative-conclusion consistency** — numbers matching isn't enough; check that the marked option's FORM follows from the derivation shown: the sign and exponent of a proportionality (e.g. a derivation showing T ∝ A⁻¹ but the marked option states T ∝ A¹), the direction of an inequality or trend (increasing vs decreasing, will-slip vs will-not-slip), and any named physical/logical condition asserted mid-derivation (e.g. "required friction is less than the maximum available, so it will NOT slip" — the marked option must not then claim slipping occurs). A numerically-labeled option can still be a confirmed factual defect if its qualitative claim contradicts the derivation's own stated conclusion.

**A contradiction is a defect even when the marked option is correct.** The explanation is what the student reads; a derivation that contradicts itself, ignores a stated constraint, or reaches the right answer by invalid reasoning must be flagged as **factual** (severity "major"). Do NOT excuse it under "informal wording" — that exemption covers phrasing only, never broken logic.

**Issue confidence — use ONLY two levels:**
- **confirmed** — You are confident the marked answer is wrong, OR the explanation derives a different value than marked, OR the explanation's result is not among any option, OR the explanation explicitly contradicts itself. You must be able to state your independent answer or the conflicting values.
- **suspected** — Possible error but ambiguous (rounding, notation, alternate valid method). **Do not penalize score for suspected items.**

**DO NOT flag as confirmed (common false positives):**
- Your independent derivation **agrees** with the marked answer **and** the explanation's reasoning is internally consistent
- Explanation **wording/phrasing** is informal or terse while the logic is sound and unbroken (this covers style of expression only — it does NOT cover a derivation that contradicts itself, skips a stated constraint, or contains an empty step; flag those per protocol steps 5–6)
- Minor rounding (e.g. 16.67 vs 16.7, sqrt(34) ≈ 5.83)
- Two equal sides in a triangle → isosceles is correct
- sin²θ + cos²θ = 1 identity applications that yield the marked value
- Flagging distractors when the marked answer is correct

**DO flag as confirmed — tag each issue with exactly one category:**

| Category | What belongs here | Examples |
|----------|-------------------|----------|
| **factual** | Wrong answer key, math errors, explanation ≠ marked answer, **self-contradictory derivation**, **stem constraint ignored**, empty/contentless step, **wrong functional form/sign/exponent or contradicted qualitative conclusion** | Derives 6 M but options show 0.32 M; value not in options; identical option text; "16 beats 1" then "1 beats 16"; stem says exactly 10 between A and B but explanation computes 17 and continues; derivation shows T ∝ A⁻¹ but marked option states T ∝ A; derivation concludes required friction < max available (no slipping) but marked option says the object slips |
| **style** | Explanation quality, formatting, draft wording (answer may still be correct) | Short/brief explanation; options vary in number formatting; vague hand-waving |
| **diversity** | Duplicate or near-duplicate questions in the batch | Same stem as Q5; repeats the same problem logic |
| **authenticity** | Non-exam templates, weak distractor craft, pattern mismatch | Repetitive formula template; coaching-style stem |
| **difficulty** | Too easy or too shallow for requested tier (answer may still be correct) | Requires deeper analysis beyond formula application; chapter-test easy |

**correctnessScore:** 0–100 for **category "factual" only**. Start at 100; subtract ~${CORRECTNESS_MAJOR_PENALTY} per confirmed major factual, ~${CORRECTNESS_CRITICAL_PENALTY} per critical factual.
**styleScore:** 0–100 for **category "style"** only (explanation depth, formatting, presentation).
**Do not** reduce correctnessScore for style, diversity, authenticity, or difficulty issues — use the matching category instead.

Return ONLY valid JSON:
{
  "correctnessScore": 80,
  "styleScore": 70,
  "confirmedIssues": [
    {
      "questionNumber": 8,
      "issue": "de Broglie λ ≈ 1.23 Å for 100 V; marked 23 Å; computed value not among options.",
      "severity": "critical",
      "confidence": "confirmed",
      "category": "factual",
      "independentAnswer": "≈1.23 Å"
    },
    {
      "questionNumber": 3,
      "issue": "Explanation is very short and lacks derivation depth.",
      "severity": "major",
      "confidence": "confirmed",
      "category": "style"
    }
  ],
  "suspectedIssues": []
}`;
};

/** JEE Main/Advanced authenticity — difficulty + style vs **generation constraints**. */
export const buildJeeAuthenticityAuditPrompt = ({
    topic = "",
    difficulty = "medium",
    examProfile = "jee_main",
    generationPlan = null,
    sampled,
    totalCount,
    sampleCount,
}) => {
    const questionBlocks = sampled.map(formatQuestionBlock).join("\n\n");
    const profile = String(examProfile || "jee_main").toLowerCase();
    const constraintsBlock = buildEvaluationConstraintsBlock(generationPlan);
    const examLabel =
        profile === "jee_advanced" ? "JEE Advanced (IIT)" : "JEE Main (NTA)";

    const difficultyGuide =
        profile === "jee_advanced"
            ? `Penalize heavily if items are Main-level formula plug-ins solvable in under 2 minutes, or lack multi-concept depth **when Advanced depth was requested**.`
            : `Penalize if items are chapter-test easy when Main shift-paper medium/hard was requested; reward breadth across syllabus.`;

    return `You are a ${examLabel} authenticity reviewer. Score how well this sample matches **what the generator was asked to produce** — NOT a generic rubric.

**Topic:** ${topic}
**Expected tier:** ${difficulty} (minimum — items below this are failures when that tier was requested)

${constraintsBlock}

**Sample (${sampleCount} of ${totalCount}):**
${questionBlocks}

---

**CRITICAL:** Evaluate pattern and difficulty ONLY against the GENERATION CONSTRAINTS above.
- Do NOT penalize for missing integer-type, decimal-type, or matrix-match inputs (never supported).
- Do NOT require multi-correct or passages if the constraints say 0 were requested.
- DO penalize if requested multi-correct or passages are missing from the sample.
- ${difficultyGuide}

**Score each dimension 0–100, then authenticityScore = rounded average:**

1. **patternMixScore** — does the sample's question types (single / multiple / connected) match what was **requested** in GENERATION CONSTRAINTS?

2. **difficultyScore** — Use the **tier definitions and scoring rubrics** in GENERATION CONSTRAINTS above. Score each item against its **Assigned difficultyTier** (shown per question), NOT subjective length or calculation heaviness alone. Lengthy single-formula work ≠ hard-tier unless it meets that tier's REQUIRED bars. Multi-concept fusion with hidden constraints = hard-tier when criteria are met. When constraints say **exam-native ALL HARD**, every item is hard-tier. **Near-duplicate stems** (same archetype/logic) count as too-easy repetition — penalize under difficulty AND diversity.

3. **multiConceptScore** — depth appropriate to ${examLabel}; penalize formula-only drills when depth was requested.

4. **optionCraftScore** — plausible distractors, no duplicate options, no answer embedded in stem.

5. **explanationQualityScore** — explanations support the marked answer; no vague hand-waving.

**confirmedIssues** — cite question numbers. Use category **"difficulty"** for too-easy / formula-only items, **"authenticity"** for pattern/template issues, **"style"** for explanation quality — not **"factual"** unless the answer key is wrong.

Return ONLY valid JSON:
{
  "authenticityScore": 58,
  "patternMixScore": 45,
  "difficultyScore": 55,
  "multiConceptScore": 50,
  "optionCraftScore": 60,
  "explanationQualityScore": 65,
  "confirmedIssues": [
    {
      "questionNumber": 0,
      "issue": "Pattern: requested 3 multi-correct but sample has 0.",
      "severity": "major"
    }
  ]
}`;
};

export const parseAuthenticityAuditResponse = (rawText) => {
    const parsed = parseJsonObjectFromAIText(rawText);
    const subscores = [
        clampScore(parsed.patternMixScore),
        clampScore(parsed.difficultyScore),
        clampScore(parsed.multiConceptScore),
        clampScore(parsed.optionCraftScore),
        clampScore(parsed.explanationQualityScore),
    ].filter((s) => s != null);
    const authenticityScore =
        clampScore(parsed.authenticityScore) ??
        (subscores.length
            ? Math.round(subscores.reduce((a, b) => a + b, 0) / subscores.length)
            : null);
    if (authenticityScore == null) {
        throw new ApiError(500, "OpenAI returned an invalid authenticity score");
    }
    const confirmedIssues = tagIssueCategories(
        normalizeCorrectnessIssues(parsed.confirmedIssues || [], {
            defaultSeverity: "major",
        }).map((item) => ({ ...item, confidence: "confirmed" }))
    );
    return {
        authenticityScore,
        difficultyScore: clampScore(parsed.difficultyScore),
        explanationQualityScore: clampScore(parsed.explanationQualityScore),
        patternMixScore: clampScore(parsed.patternMixScore),
        multiConceptScore: clampScore(parsed.multiConceptScore),
        optionCraftScore: clampScore(parsed.optionCraftScore),
        confirmedIssues,
    };
};

/** Prompt block for evaluation_regen — placed at top of generation prompt. */
export const buildRegenerationEscalationBlock = ({
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    examProfile = "competitive",
    topicRelevanceFeedback = null,
    maxSelectableSlots = 0,
} = {}) => {
    const score = Number(topicRelevanceFeedback?.overallScore);
    const verdict = String(topicRelevanceFeedback?.verdict || "").trim();
    const correctnessIssues = Array.isArray(topicRelevanceFeedback?.correctnessIssues)
        ? topicRelevanceFeedback.correctnessIssues
        : Array.isArray(topicRelevanceFeedback?.confirmedIssues)
          ? topicRelevanceFeedback.confirmedIssues
          : [];
    const profile =
        examProfile ||
        detectExamProfile({ topic, bankName, sectionName });

    const enrichedInstructions = enrichRegenerationInstructions({
        instructions:
            topicRelevanceFeedback?.regenerationInstructions ||
            topicRelevanceFeedback?.summary ||
            "",
        examProfile: profile,
        topic,
        bankName,
        sectionName,
        categoryPaths,
    });

    const slotNote =
        Number(maxSelectableSlots) > 0
            ? `\n- Output **exactly ${maxSelectableSlots} targeted replacement(s)** for failed question numbers only — do not regenerate passing items.`
            : "";

    const qualityGates = buildRegenerationQualityGatesBlock({
        topic,
        bankName,
        examProfile: profile,
        topicRelevanceFeedback,
        maxSelectableSlots,
    });

    const dims = topicRelevanceFeedback?.dimensionScores || {};
    const factualCorrectness = Number(
        dims.correctness ?? topicRelevanceFeedback?.correctnessScore
    );
    const styleDim = Number(dims.style ?? topicRelevanceFeedback?.styleScore);
    const diversityDim = Number(
        dims.diversity ?? topicRelevanceFeedback?.diversityScore
    );
    const difficultyDim = Number(
        dims.difficultyMatch ?? topicRelevanceFeedback?.difficultyMatchScore
    );
    const authenticityDim = Number(
        dims.authenticity ?? topicRelevanceFeedback?.authenticityScore
    );

    const dimensionNotes = [];
    if (Number.isFinite(factualCorrectness) && factualCorrectness < REGEN_TARGET_SCORE) {
        dimensionNotes.push(
            `**Correctness ${factualCorrectness}/100** — fix wrong answer keys, explanation/answer mismatches, values not in options only.`
        );
    }
    if (Number.isFinite(styleDim) && styleDim < REGEN_TARGET_SCORE) {
        dimensionNotes.push(
            `**Style ${styleDim}/100** — deepen explanations; fix formatting and draft wording.`
        );
    }
    if (Number.isFinite(diversityDim) && diversityDim < REGEN_TARGET_SCORE) {
        dimensionNotes.push(
            `**Diversity ${diversityDim}/100** — no duplicate or near-duplicate stems in the batch.`
        );
    }
    if (Number.isFinite(difficultyDim) && difficultyDim < REGEN_TARGET_SCORE) {
        dimensionNotes.push(
            `**Difficulty match ${difficultyDim}/100** — raise depth beyond formula plug-in for the requested tier.`
        );
    }
    if (Number.isFinite(authenticityDim) && authenticityDim < REGEN_TARGET_SCORE) {
        dimensionNotes.push(
            `**Authenticity ${authenticityDim}/100** — NTA/JEE distractor craft and pattern variety.`
        );
    }
    const correctnessNote = dimensionNotes.length
        ? `\n- ${dimensionNotes.join("\n- ")}`
        : "";
    const issueNote =
        correctnessIssues.length > 0
            ? `\n- Flagged items: ${correctnessIssues
                  .slice(0, 10)
                  .map(
                      (i) =>
                          `Q${i.questionNumber || "?"}: ${String(i.issue || "").slice(0, 120)}`
                  )
                  .join("; ")}`
            : "";

    const correctnessMandates = buildGenerationCorrectnessMandatesBlock({
        examProfile: profile,
    });

    return `
**EVALUATION REGENERATION — TARGETED REPLACEMENT (mandatory 85+ alignment)**
- Topic: **${topic || bankName}**
- Prior set scored **${Number.isFinite(score) ? `${score}/100` : "below threshold"}**${verdict ? ` (${verdict})` : ""}${correctnessNote}${issueNote} — each replacement must score **${REGEN_TARGET_SCORE}+** on the same reviewer rubric.
- Replace **only failed questions** — keep passing stems in the excluded list; do not rewrite the whole bank.${slotNote}

**Reviewer diagnosis (act on every point):**
${enrichedInstructions}

${qualityGates}
${correctnessMandates}

**Hard rules:**
- Do NOT copy or lightly rephrase excluded questions listed below.
- Do NOT pad with unrelated subjects to fill the count — fewer strong on-topic items beat a full set of drift.
- Before returning JSON, mentally score your draft; if any item would keep the set below ${REGEN_TARGET_SCORE}, replace it.
`;
};

/** Prompt block injected into Gemini generation after a low OpenAI relevance score. */
export const formatTopicRelevanceFeedbackBlock = (feedback) => {
    if (!feedback || typeof feedback !== "object") return "";
    const score = Number(feedback.overallScore);
    if (!Number.isFinite(score)) return "";

    const instructions = String(
        feedback.regenerationInstructions ||
            feedback.summary ||
            "Stay strictly on the stated topic. Remove tangential or generic questions."
    ).trim();

    return `

**TOPIC RELEVANCE REVIEW — REPLACEMENT GENERATION REQUIRED (prior set scored ${score}/100):**
${instructions}
**Generate a full REPLACEMENT set** that follows these instructions. Target 80+ topic alignment.
**Category tags must NOT override the topic** if they caused the low score.
`;
};

export const resolveVerdictFromScore = (score) => {
    const n = Number(score);
    if (!Number.isFinite(n)) return "weak";
    const clamped = Math.max(0, Math.min(100, Math.round(n)));
    for (const band of VERDICT_BY_SCORE) {
        if (clamped >= band.min) return band.verdict;
    }
    return "off-topic";
};

export const parseTopicRelevanceResponse = (
    rawText,
    { topic = "", bankName = "", sectionName = "" } = {}
) => {
    const parsed = parseJsonObjectFromAIText(rawText);
    const topicRelevanceScore =
        clampScore(parsed.topicRelevanceScore) ??
        clampScore(parsed.overallScore);

    if (topicRelevanceScore == null) {
        throw new ApiError(500, "OpenAI returned an invalid topic relevance score");
    }

    const rawInstructions = String(
        parsed.regenerationInstructions || parsed.summary || ""
    ).trim();

    let regenerationInstructions = "";
    if (
        rawInstructions &&
        !isGenericRegenFeedback(rawInstructions) &&
        !isOpinionatedRegenFeedback(rawInstructions)
    ) {
        regenerationInstructions = rawInstructions;
    } else if (topicRelevanceScore < TOPIC_RELEVANCE_PASS_SCORE) {
        regenerationInstructions = enrichRegenerationInstructions({
            instructions: rawInstructions,
            examProfile: detectExamProfile({ topic, bankName, sectionName }),
            topic,
            bankName,
            sectionName,
        });
    }

    return { topicRelevanceScore, regenerationInstructions };
};

export const countFactualErrorsBySeverity = (factualIssues = []) => {
    const forScoring = dedupeIssuesByQuestionForScoring(factualIssues || []);
    let criticalErrors = 0;
    let majorErrors = 0;
    let minorErrors = 0;
    const flawedQuestionNumbers = new Set();

    for (const item of forScoring) {
        const sev = String(item.severity || "major").toLowerCase();
        if (Number.isFinite(item.questionNumber)) {
            flawedQuestionNumbers.add(item.questionNumber);
        }
        if (sev === "critical") criticalErrors += 1;
        else if (sev === "major") majorErrors += 1;
        else minorErrors += 1;
    }

    return {
        criticalErrors,
        majorErrors,
        minorErrors,
        flawedQuestionNumbers,
        forScoring,
    };
};

/**
 * Human-readable correctness breakdown for API / UI.
 * @returns {{ questionsAudited: number, correctQuestions: number, criticalErrors: number, majorErrors: number, minorErrors: number, correctnessScore: number, derivation: string, penaltyTotal: number }}
 */
export const buildCorrectnessScoreBreakdown = ({
    factualIssues = [],
    questionsAudited = 0,
    correctnessScore = null,
} = {}) => {
    const audited = Math.max(0, Number(questionsAudited) || 0);
    const { criticalErrors, majorErrors, minorErrors, flawedQuestionNumbers, forScoring } =
        countFactualErrorsBySeverity(factualIssues);

    let penaltyTotal = 0;
    for (const item of forScoring) {
        const sev = String(item.severity || "major").toLowerCase();
        penaltyTotal +=
            sev === "critical" ? CORRECTNESS_CRITICAL_PENALTY : CORRECTNESS_MAJOR_PENALTY;
    }

    const computedScore = Math.max(0, Math.min(100, 100 - penaltyTotal));
    const score = clampScore(correctnessScore) ?? computedScore;
    const questionsWithErrors = flawedQuestionNumbers.size;
    const correctQuestions = Math.max(0, audited - questionsWithErrors);

    const penaltyParts = [];
    if (criticalErrors > 0) {
        penaltyParts.push(
            `${criticalErrors} critical × ${CORRECTNESS_CRITICAL_PENALTY} = −${criticalErrors * CORRECTNESS_CRITICAL_PENALTY}`
        );
    }
    if (majorErrors > 0) {
        penaltyParts.push(
            `${majorErrors} major × ${CORRECTNESS_MAJOR_PENALTY} = −${majorErrors * CORRECTNESS_MAJOR_PENALTY}`
        );
    }
    if (minorErrors > 0) {
        penaltyParts.push(
            `${minorErrors} minor/suspected × ${CORRECTNESS_MAJOR_PENALTY} = −${minorErrors * CORRECTNESS_MAJOR_PENALTY}`
        );
    }

    const derivation =
        penaltyParts.length === 0
            ? `No confirmed factual defects in the audited sample → correctness stays at ${score}/100 (${correctQuestions} of ${audited} question(s) clean). Style, diversity, and difficulty issues do not affect this score.`
            : `Correctness (factual only) starts at 100. ${penaltyParts.join("; ")} → ${computedScore}/100. ${correctQuestions} of ${audited} audited question(s) had no confirmed factual defect. Style/diversity/difficulty issues are scored separately.`;

    return {
        questionsAudited: audited,
        correctQuestions,
        criticalErrors,
        majorErrors,
        minorErrors,
        correctnessScore: score,
        penaltyTotal,
        derivation,
    };
};

/**
 * Explain how overallScore was blended and capped.
 */
export const buildOverallScoreBreakdown = ({
    topicRelevanceScore,
    correctnessScore,
    authenticityScore = null,
    styleScore = null,
    difficultyMatchScore = null,
    explanationQualityScore = null,
    blendedScore,
    overallScore,
    factualIssues = [],
} = {}) => {
    const topic = clampScore(topicRelevanceScore);
    const correctness = clampScore(correctnessScore);
    const authenticity = clampScore(authenticityScore);
    const style =
        styleScore != null && styleScore !== "" ? clampScore(styleScore) : null;
    const difficulty =
        difficultyMatchScore != null && difficultyMatchScore !== ""
            ? clampScore(difficultyMatchScore)
            : null;
    const explanationQuality =
        explanationQualityScore != null && explanationQualityScore !== ""
            ? clampScore(explanationQualityScore)
            : null;
    const blended = clampScore(blendedScore);
    const overall = clampScore(overallScore);
    const { criticalErrors } = countFactualErrorsBySeverity(factualIssues);
    const styleNum = style != null ? Number(style) : NaN;
    const difficultyNum = difficulty != null ? Number(difficulty) : NaN;
    const explanationNum =
        explanationQuality != null ? Number(explanationQuality) : NaN;

    let blendFormula = "";
    let blendWeights = null;
    if (authenticity != null && topic != null && correctness != null) {
        blendFormula = `(${topic}×${JEE_TOPIC_BLEND_WEIGHT} + ${correctness}×${JEE_CORRECTNESS_BLEND_WEIGHT} + ${authenticity}×${JEE_AUTHENTICITY_BLEND_WEIGHT})`;
        blendWeights = {
            topic: JEE_TOPIC_BLEND_WEIGHT,
            correctness: JEE_CORRECTNESS_BLEND_WEIGHT,
            authenticity: JEE_AUTHENTICITY_BLEND_WEIGHT,
        };
    } else if (style != null && topic != null && correctness != null) {
        blendFormula = `(${topic}×${TOPIC_STYLE_BLEND_WEIGHT} + ${correctness}×${CORRECTNESS_STYLE_BLEND_WEIGHT} + ${style}×${STYLE_BLEND_WEIGHT})`;
        blendWeights = {
            topic: TOPIC_STYLE_BLEND_WEIGHT,
            correctness: CORRECTNESS_STYLE_BLEND_WEIGHT,
            style: STYLE_BLEND_WEIGHT,
        };
    } else if (topic != null && correctness != null) {
        blendFormula = `(${topic}×${TOPIC_RELEVANCE_BLEND_WEIGHT} + ${correctness}×${CORRECTNESS_BLEND_WEIGHT})`;
        blendWeights = {
            topic: TOPIC_RELEVANCE_BLEND_WEIGHT,
            correctness: CORRECTNESS_BLEND_WEIGHT,
        };
    }

    const critical = (factualIssues || []).filter(
        (i) => String(i.severity || "").toLowerCase() === "critical"
    );
    const major = (factualIssues || []).filter(
        (i) => String(i.severity || "").toLowerCase() === "major"
    );

    let bindingCapNote = null;
    const caps = OVERALL_SCORE_CAPS;
    if (blended != null && overall != null && blended !== overall) {
        if (
            critical.some((i) =>
                /does not appear among any option|not among any option/i.test(i.issue)
            )
        ) {
            bindingCapNote = `answer not among options → cap ${caps.ANSWER_NOT_IN_OPTIONS}`;
        } else if (critical.length >= 3) {
            bindingCapNote = `≥3 critical factual → cap ${caps.THREE_CRITICAL}`;
        } else if (critical.length >= 2) {
            bindingCapNote = `≥2 critical factual → cap ${caps.TWO_CRITICAL}`;
        } else if (critical.length >= 1) {
            bindingCapNote = `≥1 critical factual → cap ${caps.ONE_CRITICAL}`;
        } else if (major.length >= 3 && critical.length >= 1) {
            bindingCapNote = `≥3 major + ≥1 critical → cap ${caps.THREE_MAJOR_PLUS_CRITICAL}`;
        } else if (
            Number.isFinite(difficultyNum) &&
            difficultyNum < DIFFICULTY_MATCH_CAP_THRESHOLDS.LOW
        ) {
            bindingCapNote = `difficulty match < ${DIFFICULTY_MATCH_CAP_THRESHOLDS.LOW} → cap ${caps.LOW_DIFFICULTY_MATCH_40}`;
        } else if (
            Number.isFinite(difficultyNum) &&
            difficultyNum < DIFFICULTY_MATCH_CAP_THRESHOLDS.MID
        ) {
            bindingCapNote = `difficulty match < ${DIFFICULTY_MATCH_CAP_THRESHOLDS.MID} → cap ${caps.LOW_DIFFICULTY_MATCH_60}`;
        } else if (Number.isFinite(styleNum) && styleNum < 45) {
            bindingCapNote = `style/authenticity < 45 → cap ${caps.LOW_STYLE}`;
        } else if (
            Number.isFinite(explanationNum) &&
            explanationNum < EXPLANATION_QUALITY_PASS_FLOOR
        ) {
            bindingCapNote = `explanation quality < ${EXPLANATION_QUALITY_PASS_FLOOR} → cap ${caps.LOW_EXPLANATION_QUALITY}`;
        } else {
            bindingCapNote = "score caps";
        }
    }

    const capNotes = [];
    if (
        critical.some((i) =>
            /does not appear among any option|not among any option/i.test(i.issue)
        )
    ) {
        capNotes.push(
            `answer not among options → overall capped at ${caps.ANSWER_NOT_IN_OPTIONS}`
        );
    }
    if (critical.length >= 1) {
        capNotes.push(`≥1 critical factual → cap ${caps.ONE_CRITICAL}`);
    }
    if (critical.length >= 2) {
        capNotes.push(`≥2 critical factual → cap ${caps.TWO_CRITICAL}`);
    }
    if (critical.length >= 3) {
        capNotes.push(`≥3 critical factual → cap ${caps.THREE_CRITICAL}`);
    }
    if (major.length >= 3 && critical.length >= 1) {
        capNotes.push(
            `≥3 major + ≥1 critical → cap ${caps.THREE_MAJOR_PLUS_CRITICAL}`
        );
    }
    if (Number.isFinite(styleNum) && styleNum < 45) {
        capNotes.push(`style/authenticity < 45 → cap ${caps.LOW_STYLE}`);
    }
    if (
        Number.isFinite(explanationNum) &&
        explanationNum < EXPLANATION_QUALITY_PASS_FLOOR
    ) {
        capNotes.push(
            `explanation quality < ${EXPLANATION_QUALITY_PASS_FLOOR} → cap ${caps.LOW_EXPLANATION_QUALITY}`
        );
    }
    if (
        Number.isFinite(difficultyNum) &&
        difficultyNum < DIFFICULTY_MATCH_CAP_THRESHOLDS.LOW
    ) {
        capNotes.push(
            `difficulty match < ${DIFFICULTY_MATCH_CAP_THRESHOLDS.LOW} → cap ${caps.LOW_DIFFICULTY_MATCH_40}`
        );
    } else if (
        Number.isFinite(difficultyNum) &&
        difficultyNum < DIFFICULTY_MATCH_CAP_THRESHOLDS.MID
    ) {
        capNotes.push(
            `difficulty match < ${DIFFICULTY_MATCH_CAP_THRESHOLDS.MID} → cap ${caps.LOW_DIFFICULTY_MATCH_60}`
        );
    }

    const appliedCaps = bindingCapNote ? [bindingCapNote] : [];

    let derivation = "";
    if (blendFormula && blended != null) {
        derivation = `Overall blends sub-scores: ${blendFormula} = ${blended}`;
        if (overall != null && blended !== overall && bindingCapNote) {
            derivation += `. Score caps applied (${bindingCapNote}) → ${overall}/100.`;
        } else if (overall != null) {
            derivation += ` → ${overall}/100.`;
        }
    } else if (overall != null) {
        derivation = `Overall score: ${overall}/100.`;
    }

    if (
        Number.isFinite(difficultyNum) &&
        difficultyNum < DIFFICULTY_MATCH_CAP_THRESHOLDS.MID &&
        overall != null
    ) {
        derivation += ` Difficulty match ${difficultyNum}/100 limits overall (too easy or formula-only for requested tier).`;
    }

    if (
        Number.isFinite(explanationNum) &&
        explanationNum < EXPLANATION_QUALITY_PASS_FLOOR &&
        overall != null
    ) {
        derivation += ` Explanation quality ${explanationNum}/100 is below floor ${EXPLANATION_QUALITY_PASS_FLOOR} — caps overall and triggers regen.`;
    }

    if (criticalErrors >= 1 && overall != null) {
        const weightPct = Math.round(
            (authenticity != null
                ? JEE_CORRECTNESS_BLEND_WEIGHT
                : CORRECTNESS_BLEND_WEIGHT) * 100
        );
        derivation += ` ${criticalErrors} critical factual error(s) heavily weight correctness (${weightPct}% of blend) and trigger overall caps.`;
    }

    return {
        overallScore: overall,
        blendedScore: blended,
        blendWeights,
        capNotes,
        derivation: derivation.trim(),
    };
};

export const mergeValidationResults = (
    topicResult,
    correctnessResult,
    { topic = "", bankName = "", sectionName = "" } = {},
    authenticityResult = null,
    patternComplianceResult = null,
    options = {}
) => {
    const { questionsAudited = null, totalCount = null } = options;
    const topicRelevanceScore = topicResult.topicRelevanceScore;
    let authenticityScore = authenticityResult?.authenticityScore ?? null;
    const patternComplianceScore =
        patternComplianceResult?.patternComplianceScore ?? null;

    if (
        patternComplianceScore != null &&
        authenticityScore != null
    ) {
        authenticityScore = Math.round(
            authenticityScore * 0.7 + patternComplianceScore * 0.3
        );
    } else if (patternComplianceScore != null && authenticityScore == null) {
        authenticityScore = patternComplianceScore;
    }

    const patternIssues = tagIssueCategories(
        (patternComplianceResult?.issues || []).map((item) => ({
            ...item,
            confidence: "confirmed",
            category: ISSUE_CATEGORY.AUTHENTICITY,
        }))
    );
    const authenticityAuditIssues = tagIssueCategories(
        (authenticityResult?.confirmedIssues || []).map((item) => ({
            ...item,
            confidence: "confirmed",
        }))
    );

    const correctnessConfirmed = tagIssueCategories(
        correctnessResult.confirmedIssues || []
    );

    const byIssueKey = new Map();
    for (const item of [
        ...correctnessConfirmed,
        ...authenticityAuditIssues,
        ...patternIssues,
    ]) {
        const key = `${item.questionNumber ?? "?"}::${item.issue}`;
        if (!byIssueKey.has(key)) byIssueKey.set(key, item);
    }
    const allConfirmed = [...byIssueKey.values()];
    const suspectedIssues = correctnessResult.suspectedIssues || [];

    const dimensional = computeDimensionalScores(allConfirmed, {
        modelCorrectnessScore: correctnessResult.correctnessScore,
        authenticityAuditScore: authenticityScore,
        difficultyAuditScore: authenticityResult?.difficultyScore ?? null,
        explanationQualityAuditScore:
            authenticityResult?.explanationQualityScore ?? null,
        deterministicDifficultyScore: options.deterministicDifficultyScore ?? null,
    });

    const factualIssues = dimensional.factualIssues;
    const mergedCorrectnessScore = dimensional.correctnessScore;
    const mergedStyleScore = dimensional.styleScore;
    const diversityScore = dimensional.diversityScore;
    const difficultyMatchScore = dimensional.difficultyMatchScore;
    const blendedAuthenticityScore =
        dimensional.authenticityScore ?? authenticityScore;

    const blended = blendValidationScores(
        topicRelevanceScore,
        mergedCorrectnessScore,
        blendedAuthenticityScore,
        blendedAuthenticityScore == null ? mergedStyleScore : null,
        dimensional.explanationQualityScore
    );
    const overallScore = applyValidationScoreCaps(blended, factualIssues, {
        styleScore: blendedAuthenticityScore ?? mergedStyleScore,
        difficultyMatchScore,
        explanationQualityScore: dimensional.explanationQualityScore,
    });

    const auditedCount =
        Number.isFinite(questionsAudited) && questionsAudited > 0
            ? questionsAudited
            : null;

    const correctnessBreakdown = buildCorrectnessScoreBreakdown({
        factualIssues,
        questionsAudited:
            auditedCount != null
                ? auditedCount
                : countFactualErrorsBySeverity(factualIssues).flawedQuestionNumbers
                      .size,
        correctnessScore: mergedCorrectnessScore,
    });

    const overallScoreBreakdown = buildOverallScoreBreakdown({
        topicRelevanceScore,
        correctnessScore: mergedCorrectnessScore,
        authenticityScore: blendedAuthenticityScore,
        styleScore: mergedStyleScore,
        difficultyMatchScore,
        explanationQualityScore: dimensional.explanationQualityScore,
        blendedScore: blended,
        overallScore,
        factualIssues,
    });

    const dimensionScores = {
        correctness: mergedCorrectnessScore,
        style: mergedStyleScore,
        authenticity: blendedAuthenticityScore,
        diversity: diversityScore,
        difficultyMatch: difficultyMatchScore,
        explanationQuality: dimensional.explanationQualityScore,
    };

    const issuesByDimension = {
        factual: factualIssues,
        style: dimensional.styleIssues,
        diversity: dimensional.diversityIssues,
        authenticity: dimensional.authenticityIssues,
        difficulty: dimensional.difficultyIssues,
    };

    const allStyleIssues = [
        ...dimensional.styleIssues,
        ...dimensional.diversityIssues,
        ...dimensional.authenticityIssues,
        ...dimensional.difficultyIssues,
    ];

    const verdict = resolveVerdictFromScore(overallScore);

    const needsFactualFix =
        factualIssues.length > 0 && mergedCorrectnessScore < REGEN_TARGET_SCORE;
    const needsCraftFix =
        dimensional.styleIssues.length > 0 ||
        dimensional.diversityIssues.length > 0 ||
        dimensional.authenticityIssues.length > 0 ||
        dimensional.difficultyIssues.length > 0;
    const needsExplanationFix =
        dimensional.explanationQualityScore != null &&
        dimensional.explanationQualityScore < EXPLANATION_QUALITY_PASS_FLOOR;
    const needsStyleFix =
        needsCraftFix &&
        (mergedStyleScore < REGEN_TARGET_SCORE ||
            diversityScore < REGEN_TARGET_SCORE ||
            needsExplanationFix ||
            (difficultyMatchScore != null &&
                difficultyMatchScore < REGEN_TARGET_SCORE) ||
            (blendedAuthenticityScore != null &&
                blendedAuthenticityScore < REGEN_TARGET_SCORE));

    const examProfile = detectExamProfile({ topic, bankName, sectionName });
    const correctnessRegen =
        (needsFactualFix || needsStyleFix) &&
        (mergedCorrectnessScore < topicRelevanceScore - 5 ||
            needsStyleFix ||
            (blendedAuthenticityScore != null &&
                blendedAuthenticityScore < 75))
            ? buildCorrectnessRegenerationInstructions(allConfirmed, {
                  examProfile,
              })
            : "";

    let regenerationInstructions = "";
    const needsCorrectnessFix =
        needsFactualFix || needsStyleFix || needsExplanationFix;
    if (overallScore < TOPIC_RELEVANCE_PASS_SCORE || needsCorrectnessFix) {
        const topicRegen = String(topicResult.regenerationInstructions || "").trim();
        const topicRegenUsable =
            topicRegen &&
            !isGenericRegenFeedback(topicRegen) &&
            !isOpinionatedRegenFeedback(topicRegen) &&
            !isCoverageOnlyRegenFeedback(topicRegen, {
                correctnessScore: mergedCorrectnessScore,
                topicRelevanceScore,
            });

        if (correctnessRegen) {
            regenerationInstructions = clampRegenerationInstructions(
                correctnessRegen
            );
            if (
                topicRegenUsable &&
                topicRelevanceScore < TOPIC_RELEVANCE_PASS_SCORE &&
                topicRelevanceScore < mergedCorrectnessScore
            ) {
                regenerationInstructions = clampRegenerationInstructions(
                    `${correctnessRegen}\n\n${topicRegen}`
                );
            }
        } else if (topicRegenUsable) {
            regenerationInstructions = clampRegenerationInstructions(topicRegen);
        } else if (topicRelevanceScore < TOPIC_RELEVANCE_PASS_SCORE) {
            regenerationInstructions = clampRegenerationInstructions(
                enrichRegenerationInstructions({
                    instructions: topicRegen,
                    examProfile: detectExamProfile({ topic, bankName, sectionName }),
                    topic,
                    bankName,
                    sectionName,
                })
            );
        }
    }

    return {
        overallScore,
        topicRelevanceScore,
        correctnessScore: mergedCorrectnessScore,
        styleScore: mergedStyleScore,
        authenticityScore: blendedAuthenticityScore,
        diversityScore,
        difficultyMatchScore,
        dimensionScores,
        issuesByDimension,
        patternComplianceScore,
        correctQuestions: correctnessBreakdown.correctQuestions,
        criticalErrors: correctnessBreakdown.criticalErrors,
        majorErrors: correctnessBreakdown.majorErrors,
        minorErrors: correctnessBreakdown.minorErrors,
        correctnessBreakdown,
        overallScoreBreakdown,
        totalQuestions: totalCount,
        factualIssues,
        styleIssues: allStyleIssues,
        correctnessIssues: [...allConfirmed, ...suspectedIssues],
        confirmedIssues: allConfirmed,
        suspectedIssues,
        verdict,
        regenerationInstructions,
        flawedQuestionNumbers: [
            ...extractRegenerationTargetNumbers({
                confirmedIssues: allConfirmed,
                correctnessIssues: [...allConfirmed, ...suspectedIssues],
                issuesByDimension,
            }),
        ],
    };
};
