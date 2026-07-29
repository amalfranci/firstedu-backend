/**
 * Resolve which subject to generate when topic/bank name omit it.
 * Uses: explicit → section (multi-section banks) → topic RHS after "—" →
 * topic / bank → category (only if topic empty).
 *
 * Section wins over topic/bank because the UI topic is often
 * "{bankName} — {sectionName}" (e.g. "…Mathematics — Physics"), and
 * matchSubjectInText would otherwise lock onto the bank leaf subject.
 */

/** Parse category path segments for dynamic scope (no fixed subject catalog). */
export const parseCategoryScope = (categoryPaths = []) => {
    const paths = (categoryPaths || []).filter(Boolean);
    if (!paths.length) return { paths: [], leafLabel: null, trail: "" };

    const segments = paths[0]
        .split(/[>›]/)
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        paths,
        segments,
        leafLabel: segments.length ? segments[segments.length - 1] : null,
        trail: segments.join(" › "),
    };
};

const SUBJECT_DEFINITIONS = [
    {
        id: "mathematics",
        label: "Mathematics",
        patterns: [
            /\bmathematics\b/,
            /\bmaths?\b/,
            /\bcalculus\b/,
            /\balgebra\b/,
            /\bgeometry\b/,
            /\btrigonometry\b/,
            /\bcoordinate\b/,
            /\bstatistics\b/,
            /\bprobability\b/,
            /\barithmetic\b/,
        ],
    },
    {
        id: "physics",
        label: "Physics",
        patterns: [
            /\bphysics\b/,
            /\bmechanics\b/,
            /\boptics\b/,
            /\bthermodynamics?\b/,
            /\belectro(?:magnetism|statics)?\b/,
            /\bkinematics\b/,
            /\bwaves\b/,
            /\bnuclear\b/,
        ],
    },
    {
        id: "chemistry",
        label: "Chemistry",
        patterns: [
            /\bchemistry\b/,
            /\bchemical\b/,
            /\borganic\b/,
            /\binorganic\b/,
            /\bphysical\s+chemistry\b/,
            /\biupac\b/,
            /\bmole\s+concept\b/,
            /\bstoichiometry\b/,
        ],
    },
    {
        id: "biology",
        label: "Biology",
        patterns: [
            /\bbiology\b/,
            /\bbotany\b/,
            /\bzoology\b/,
            /\bgenetics\b/,
            /\becology\b/,
            /\bcell\s+biology\b/,
            /\bphysiology\b/,
            /\banatomy\b/,
        ],
    },
    {
        id: "verbal",
        label: "Verbal Ability & Reading Comprehension",
        patterns: [
            /\bvarc\b/,
            /\bverbal ability\b/,
            /\breading comprehension\b/,
            /\bparajumble/,
            /\bpara[\s-]?jumble/,
            /\bodd sentence\b/,
            /\bpara summary\b/,
            /\bpara completion\b/,
        ],
    },
    {
        id: "english",
        label: "English",
        patterns: [
            /\benglish\b/,
            /\bliterature\b/,
        ],
    },
    {
        id: "english_grammar",
        label: "English Grammar",
        patterns: [/\bgrammar\b/, /\bvocabulary\b/, /\bcomprehension\b/],
    },
    {
        id: "science",
        label: "General Science",
        patterns: [/\bgeneral\s+science\b/, /\bscience\b(?!\s+fiction)/],
    },
];

const SUBJECT_BY_ID = Object.fromEntries(
    SUBJECT_DEFINITIONS.map((d) => [d.id, d])
);

/** @returns {string|null} subject id */
export const matchSubjectInText = (text) => {
    const s = String(text || "").toLowerCase();
    if (!s.trim()) return null;

    for (const def of SUBJECT_DEFINITIONS) {
        if (def.patterns.some((p) => p.test(s))) return def.id;
    }
    return null;
};

/** All subject ids that match (definition order). */
export const matchAllSubjectsInText = (text) => {
    const s = String(text || "").toLowerCase();
    if (!s.trim()) return [];
    return SUBJECT_DEFINITIONS.filter((def) =>
        def.patterns.some((p) => p.test(s))
    ).map((def) => def.id);
};

/** Prefer the subject named after the last "—" / en-dash / hyphen separator. */
const matchSubjectFromCompoundTopic = (topic) => {
    const trimmed = String(topic || "").trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    return matchSubjectInText(parts[parts.length - 1]);
};

const labelFor = (id) => SUBJECT_BY_ID[id]?.label || null;

/**
 * @param {object} opts
 * @returns {{ id: string|null, label: string|null, source: string|null }}
 */
export const resolveGenerationSubject = ({
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
} = {}) => {
    const explicit = String(subject || "").trim().toLowerCase();
    if (explicit) {
        const id =
            matchSubjectInText(explicit) ||
            (SUBJECT_BY_ID[explicit] ? explicit : null);
        if (id) {
            return { id, label: labelFor(id), source: "explicit" };
        }
    }

    const topicTrimmed = String(topic || "").trim();

    const catVarcHay = `${sectionName} ${topicTrimmed} ${bankName} ${(categoryPaths || []).join(" ")}`;
    if (
        /\bvarc\b|verbal ability|reading comprehension|\bparajumble|\bpara jumble|odd sentence|para summary/i.test(
            catVarcHay
        )
    ) {
        return {
            id: "verbal",
            label: labelFor("verbal"),
            source: "cat_varc",
        };
    }

    // Section is authoritative for multi-section banks (Physics / Chem / Math).
    const fromSection = matchSubjectInText(sectionName);
    if (fromSection) {
        return { id: fromSection, label: labelFor(fromSection), source: "section" };
    }

    // Topic shaped like "{bank} — Physics" → use the RHS subject.
    const fromCompound = matchSubjectFromCompoundTopic(topicTrimmed);
    if (fromCompound) {
        return {
            id: fromCompound,
            label: labelFor(fromCompound),
            source: "topic-section",
        };
    }

    const topicHits = matchAllSubjectsInText(topicTrimmed);
    if (topicHits.length === 1) {
        return {
            id: topicHits[0],
            label: labelFor(topicHits[0]),
            source: "topic",
        };
    }

    const textBlob = [topic, bankName].filter(Boolean).join(" ");
    const blobHits = matchAllSubjectsInText(textBlob);
    if (blobHits.length === 1) {
        return {
            id: blobHits[0],
            label: labelFor(blobHits[0]),
            source: "topic",
        };
    }

    if (!topicTrimmed) {
        const categorySubjects = (categoryPaths || [])
            .map((p) => matchSubjectInText(p))
            .filter(Boolean);
        const unique = [...new Set(categorySubjects)];

        if (unique.length === 1) {
            return {
                id: unique[0],
                label: labelFor(unique[0]),
                source: "category",
            };
        }

        if (unique.length > 1) {
            const sectionPick = matchSubjectInText(sectionName);
            if (sectionPick && unique.includes(sectionPick)) {
                return {
                    id: sectionPick,
                    label: labelFor(sectionPick),
                    source: "section+category",
                };
            }
            const first = unique[0];
            return {
                id: first,
                label: labelFor(first),
                source: "category",
            };
        }
    }

    // Ambiguous multi-subject topic/bank with no usable section — do not guess.
    if (topicHits.length > 1 || blobHits.length > 1) {
        return { id: null, label: null, source: "ambiguous" };
    }

    return { id: null, label: null, source: null };
};

/** Back-compat wrapper used by difficulty calibration. */
export const detectSubjectHint = (opts = {}) => {
    const resolved = resolveGenerationSubject(opts);
    return resolved.id;
};

export const buildSubjectScopeBlock = (resolved) => {
    if (!resolved?.id || !resolved?.label) {
        return `**Subject:** Not stated in the topic — use the bank categories and section context if provided. Do NOT default to Mathematics unless the syllabus is clearly mathematical.`;
    }

    const sourceNote =
        resolved.source === "topic" || resolved.source === "topic-section"
            ? "mentioned in topic/bank name"
            : resolved.source === "section" || resolved.source === "section+category"
              ? "inferred from section name"
              : resolved.source === "category"
                ? "inferred from bank category tags"
                : resolved.source === "explicit"
                  ? "specified by the user"
                  : "auto-detected";

    return `**Subject: ${resolved.label}** (${sourceNote})
- Generate ONLY ${resolved.label} questions — syllabus, notation, and difficulty appropriate for this subject.
- Do NOT mix in questions from other subjects unless the topic explicitly requires interdisciplinary content.`;
};

const REGEN_REJECT_VERBS =
    /\b(reduce|avoid|less|fewer|remove|wrong|off[\s-]?topic|irrelevant|tangential|not|stop|eliminate|exclude|cut|drop)\b/i;

const SUBJECT_KEYWORDS = {
    biology: /\b(bio(?:logy)?|botany|zoology)\b/i,
    mathematics: /\b(math(?:ematics)?|maths?)\b/i,
    physics: /\bphysics\b/i,
    chemistry: /\bchem(?:istry)?\b/i,
    english: /\benglish\b/i,
    science: /\bscience\b/i,
};

const feedbackRejectsSubject = (feedbackText, subjectId) => {
    const pattern = SUBJECT_KEYWORDS[subjectId];
    if (!pattern || !pattern.test(String(feedbackText || ""))) return false;
    return REGEN_REJECT_VERBS.test(String(feedbackText || ""));
};

const feedbackTextFrom = (topicRelevanceFeedback) =>
    [
        topicRelevanceFeedback?.regenerationInstructions,
        topicRelevanceFeedback?.summary,
    ]
        .filter(Boolean)
        .join(" ");

/**
 * Subject resolution for evaluation_regen — topic and reviewer feedback override category tags.
 */
export const resolveRegenerationSubject = ({
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
    topicRelevanceFeedback = null,
} = {}) => {
    const feedbackText = feedbackTextFrom(topicRelevanceFeedback);
    const categoryResolved = resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });

    const fromFeedback = matchSubjectInText(feedbackText);
    if (fromFeedback && !feedbackRejectsSubject(feedbackText, fromFeedback)) {
        return {
            id: fromFeedback,
            label: labelFor(fromFeedback),
            source: "regen-feedback",
        };
    }

    const fromTopic = matchSubjectInText([topic, bankName, feedbackText].join(" "));
    if (fromTopic && !feedbackRejectsSubject(feedbackText, fromTopic)) {
        return {
            id: fromTopic,
            label: labelFor(fromTopic),
            source: "regen-topic",
        };
    }

    if (
        categoryResolved.id &&
        categoryResolved.source === "category" &&
        feedbackRejectsSubject(feedbackText, categoryResolved.id)
    ) {
        return { id: null, label: null, source: "regen-topic-override" };
    }

    if (categoryResolved.id && categoryResolved.source !== "category") {
        return categoryResolved;
    }

    return { id: null, label: null, source: "regen-topic-override" };
};

export const resolveSubjectForGeneration = ({
    generateIntent = "initial",
    topicRelevanceFeedback = null,
    topic = "",
    bankName = "",
    sectionName = "",
    categoryPaths = [],
    subject = "",
} = {}) => {
    if (generateIntent === "evaluation_regen" && topicRelevanceFeedback) {
        return resolveRegenerationSubject({
            topic,
            bankName,
            sectionName,
            categoryPaths,
            subject,
            topicRelevanceFeedback,
        });
    }
    return resolveGenerationSubject({
        topic,
        bankName,
        sectionName,
        categoryPaths,
        subject,
    });
};

export const buildRegenerationSubjectScopeBlock = ({
    topic = "",
    bankName = "",
    categoryPaths = [],
    topicRelevanceFeedback = null,
    examProfile = "competitive",
} = {}) => {
    const instructions = feedbackTextFrom(topicRelevanceFeedback).trim();
    const score = Number(topicRelevanceFeedback?.overallScore);
    const scoreNote = Number.isFinite(score)
        ? ` (prior set scored ${score}/100)`
        : "";

    const { trail } = parseCategoryScope(categoryPaths);
    const categoryNote = trail
        ? `\n- **Category path:** ${trail}${scoreNote}`
        : scoreNote
          ? `\n- Prior set scored ${score}/100.`
          : "";

    return `**Subject scope — REPLACEMENT GENERATION (topic alignment overrides categories):**
- **Topic / syllabus focus:** ${topic || bankName}
- Regenerate questions aligned with the topic and category path above — not off-syllabus content.${categoryNote}
- **Reviewer instructions:** ${instructions || "Align strictly with the topic; remove tangential content."}`;
};

export const buildSubjectScopeBlockForGeneration = ({
    generateIntent = "initial",
    topicRelevanceFeedback = null,
    resolvedSubject,
    topic = "",
    bankName = "",
    categoryPaths = [],
    examProfile = "competitive",
} = {}) => {
    if (generateIntent === "evaluation_regen" && topicRelevanceFeedback) {
        return buildRegenerationSubjectScopeBlock({
            topic,
            bankName,
            categoryPaths,
            topicRelevanceFeedback,
            examProfile,
        });
    }
    if (resolvedSubject?.id && resolvedSubject?.label) {
        return buildSubjectScopeBlock(resolvedSubject);
    }
    const topicTrimmed = String(topic || "").trim();
    if (topicTrimmed) {
        return `**Subject scope:** Derive from topic "${topicTrimmed}" only — ignore category/bank labels that suggest a different subject or full-paper PCM mix unless the topic itself says so.`;
    }
    return "";
};
