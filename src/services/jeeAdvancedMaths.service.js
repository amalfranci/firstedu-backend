/**
 * JEE Advanced Mathematics — file-backed knowledge pack.
 *
 * Data root: `jee_advanced/` (project root)
 *   - maths_syllabus.json              official Advanced topic map (M01–M19)
 *   - maths_ncert_context.json         concepts / formulas / hard archetypes / banned easy
 *   - maths_scoring.json               advanced_relevance + difficulty splits
 *   - maths_question_type_quotas.json  bank quotas by type × difficulty
 *   - jee_advanced_pattern_totals.json paper section pattern (single/multi/integer/match)
 *
 * Prefer these over JEE Main scoring/syllabus when examProfile === "jee_advanced".
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getExamSyllabusPackTopics } from "./examSyllabusPack.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, "..", "..", "jee_advanced");

const PATHS = {
    syllabus: join(DATA_ROOT, "maths_syllabus.json"),
    ncert: join(DATA_ROOT, "maths_ncert_context.json"),
    scoring: join(DATA_ROOT, "maths_scoring.json"),
    quotas: join(DATA_ROOT, "maths_question_type_quotas.json"),
    pattern: join(DATA_ROOT, "jee_advanced_pattern_totals.json"),
};

const cache = new Map();
/** When set, overrides file scoring from ExamSyllabusPack (Mongo). */
let dbScoringByTopicId = null;

const loadJson = (key) => {
    if (cache.has(key)) return cache.get(key);
    const filePath = PATHS[key];
    if (!filePath || !existsSync(filePath)) {
        cache.set(key, null);
        return null;
    }
    try {
        const data = JSON.parse(readFileSync(filePath, "utf8"));
        cache.set(key, data);
        return data;
    } catch {
        cache.set(key, null);
        return null;
    }
};

const isMathSubject = (subject = "") =>
    /\bmath(?:s|ematics)?\b/i.test(String(subject || ""));

const isAdvancedProfile = (examProfile = "") =>
    String(examProfile || "").toLowerCase() === "jee_advanced";

const normalizeForMatch = (text = "") =>
    String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const bullets = (items = [], max = 0) => {
    const list = (Array.isArray(items) ? items : []).map(String).filter(Boolean);
    const shown = max > 0 ? list.slice(0, max) : list;
    return shown.map((s) => `  - ${s}`).join("\n");
};

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export const isJeeAdvancedMathsDataAvailable = () =>
    Boolean(loadJson("syllabus")?.topics?.length && loadJson("ncert")?.topics);

export const loadJeeAdvancedPattern = () => loadJson("pattern");
export const loadJeeAdvancedSyllabus = () => loadJson("syllabus");
export const loadJeeAdvancedNcert = () => loadJson("ncert");
export const loadJeeAdvancedScoring = () => loadJson("scoring");
export const loadJeeAdvancedQuotas = () => loadJson("quotas");

/**
 * Prefer Mongo ExamSyllabusPack scoring when seeded.
 * Call after mongoose.connect (scripts / API startup).
 */
export const hydrateJeeAdvancedMathsScoringFromDb = async () => {
    try {
        const topics = await getExamSyllabusPackTopics({
            examType: "jee_advanced",
            subject: "Mathematics",
        });
        if (!topics.length) {
            dbScoringByTopicId = null;
            return false;
        }
        dbScoringByTopicId = new Map(
            topics
                .filter((t) => t.topicId && t.scoring)
                .map((t) => [String(t.topicId), t.scoring])
        );
        return dbScoringByTopicId.size > 0;
    } catch {
        dbScoringByTopicId = null;
        return false;
    }
};

/** All Advanced maths topics: { topicId, chapter, classLevel, subtopics, scoring, ncert, quotas } */
export const getJeeAdvancedMathTopics = () => {
    const syllabus = loadJson("syllabus");
    const ncert = loadJson("ncert");
    const scoring = loadJson("scoring");
    const quotas = loadJson("quotas");
    if (!syllabus?.topics?.length) return [];

    return syllabus.topics.map((t) => {
        const id = String(t.topic_id || "").trim();
        return {
            topicId: id,
            chapter: String(t.chapter || "").trim(),
            classLevel: String(t.class_level || "").trim(),
            subtopics: Array.isArray(t.subtopics) ? t.subtopics : [],
            scoring:
                (dbScoringByTopicId && dbScoringByTopicId.get(id)) ||
                scoring?.topics?.[id] ||
                null,
            ncert: ncert?.topics?.[id] || null,
            quotas: quotas?.topics?.[id] || null,
            scoringSource:
                dbScoringByTopicId && dbScoringByTopicId.has(id)
                    ? "exam_syllabus_pack"
                    : "file",
        };
    });
};

export const listJeeAdvancedChapterLabels = () =>
    getJeeAdvancedMathTopics().map((t) => t.chapter);

export const getHighRelevanceAdvancedTopics = () =>
    getJeeAdvancedMathTopics().filter(
        (t) => String(t.scoring?.advanced_relevance || "").toLowerCase() === "high"
    );

export const getMediumPlusAdvancedTopics = () =>
    getJeeAdvancedMathTopics().filter((t) => {
        const r = String(t.scoring?.advanced_relevance || "").toLowerCase();
        return r === "high" || r === "medium";
    });

/**
 * Soft-match chapter / slot text → Advanced topic entry.
 */
export const matchJeeAdvancedTopic = (chapterOrSlot = "") => {
    const topics = getJeeAdvancedMathTopics();
    if (!topics.length) return null;
    const needle = normalizeForMatch(chapterOrSlot);
    if (!needle) return null;

    let best = null;
    let bestScore = 0;
    for (const t of topics) {
        const chapter = normalizeForMatch(t.chapter);
        const id = normalizeForMatch(t.topicId);
        let score = 0;
        if (chapter && (needle.includes(chapter) || chapter.includes(needle))) {
            score = 100;
        } else if (id && needle.includes(id)) {
            score = 90;
        } else {
            const tokens = chapter.split(" ").filter((x) => x.length > 3);
            const hit = tokens.filter(
                (tok) => needle.includes(tok) || tok.includes(needle.split(" ")[0] || "")
            ).length;
            score = tokens.length ? (hit / tokens.length) * 80 : 0;
            // Concept vocabulary boost
            const vocab = [
                ...(t.ncert?.concepts || []),
                ...(t.ncert?.hard_archetypes || []),
                ...(t.subtopics || []),
            ]
                .join(" ")
                .toLowerCase();
            const contentHits = needle
                .split(" ")
                .filter((w) => w.length > 4 && vocab.includes(w)).length;
            score += Math.min(25, contentHits * 5);
        }
        if (score > bestScore) {
            bestScore = score;
            best = t;
        }
    }
    return bestScore >= 35 ? best : null;
};

export const resolveJeeAdvancedTopics = (chaptersOrIds = []) => {
    const requested = (Array.isArray(chaptersOrIds) ? chaptersOrIds : [chaptersOrIds])
        .map((c) => String(c || "").trim())
        .filter(Boolean);
    const matched = [];
    const unmatched = [];
    const seen = new Set();
    for (const name of requested) {
        // Direct topic id
        const byId = getJeeAdvancedMathTopics().find(
            (t) => t.topicId.toLowerCase() === name.toLowerCase()
        );
        const hit = byId || matchJeeAdvancedTopic(name);
        if (!hit) {
            unmatched.push(name);
            continue;
        }
        if (seen.has(hit.topicId)) continue;
        seen.add(hit.topicId);
        matched.push(hit);
    }
    return { matched, unmatched };
};

/**
 * Infer topics from planned slots (labels / conceptSlot / chapter field).
 */
export const inferJeeAdvancedTopicsFromSlots = (slots = []) => {
    const topics = getJeeAdvancedMathTopics();
    if (!topics.length) return [];

    const index = topics.map((t) => {
        const vocab = new Set();
        for (const list of [
            t.ncert?.concepts,
            t.ncert?.hard_archetypes,
            t.ncert?.methods,
            t.subtopics,
            [t.chapter],
        ]) {
            for (const item of Array.isArray(list) ? list : []) {
                for (const tok of normalizeForMatch(item)
                    .split(" ")
                    .filter((w) => w.length > 3)) {
                    vocab.add(tok);
                }
            }
        }
        return { topic: t, vocab };
    });

    const hits = new Map();
    const bump = (id, topic, score) => {
        const prev = hits.get(id);
        if (!prev || score > prev.score) hits.set(id, { topic, score });
        else prev.score += score * 0.25;
    };

    for (const slot of slots || []) {
        const explicit =
            typeof slot === "object"
                ? String(slot.chapter || slot.topicId || slot.topic_id || "").trim()
                : "";
        if (explicit) {
            const direct =
                getJeeAdvancedMathTopics().find(
                    (t) =>
                        t.topicId.toLowerCase() === explicit.toLowerCase() ||
                        normalizeForMatch(t.chapter) === normalizeForMatch(explicit)
                ) || matchJeeAdvancedTopic(explicit);
            if (direct) {
                bump(direct.topicId, direct, 10);
                continue;
            }
        }
        const text =
            typeof slot === "string"
                ? slot
                : [
                      slot.label,
                      slot.conceptSlot,
                      slot.description,
                      slot.blueprint?.pattern,
                      slot.blueprint?.required,
                  ]
                      .filter(Boolean)
                      .join(" ");
        const tokens = normalizeForMatch(text)
            .split(" ")
            .filter((w) => w.length > 3);
        if (!tokens.length) continue;
        let best = null;
        let bestScore = 0;
        for (const { topic, vocab } of index) {
            const overlap = tokens.filter((t) => vocab.has(t)).length;
            if (overlap > bestScore) {
                bestScore = overlap;
                best = topic;
            }
        }
        if (best && bestScore >= 2) bump(best.topicId, best, bestScore);
    }

    return [...hits.values()]
        .sort((a, b) => b.score - a.score)
        .map((h) => h.topic);
};

// ---------------------------------------------------------------------------
// Paper pattern helpers
// ---------------------------------------------------------------------------

/**
 * Default paper-section mix for one subject one paper (from pattern file).
 * Returns { single, multi, integer, match, paragraph, total, ...meta }.
 */
export const getAdvancedPaperTypeCounts = ({
    paper = 1,
    scale = 1,
} = {}) => {
    const pattern = loadJson("pattern");
    const key = Number(paper) === 2 ? "Paper_2" : "Paper_1";
    const sec = pattern?.structure_per_subject_per_paper?.[key];
    if (!sec) {
        const isP2 = Number(paper) === 2;
        return {
            single: Math.max(1, Math.round(4 * scale)),
            multi: Math.max(0, Math.round((isP2 ? 4 : 3) * scale)),
            integer: Math.max(0, Math.round(6 * scale)),
            match: Math.max(0, Math.round((isP2 ? 0 : 3) * scale)),
            paragraph: Math.max(0, Math.round((isP2 ? 4 : 0) * scale)),
            total: Math.max(1, Math.round((isP2 ? 18 : 16) * scale)),
            questionsPerSubject: isP2 ? 18 : 16,
            paperTotalQuestions: isP2 ? 54 : 48,
            totalMarks: 180,
        };
    }
    const single = Math.round((sec.section_1_single_correct?.questions || 0) * scale);
    const multi = Math.round((sec.section_2_multi_correct?.questions || 0) * scale);
    const integer = Math.round((sec.section_3_numerical?.questions || 0) * scale);
    const match = Math.round((sec.section_4_match_list?.questions || 0) * scale);
    const paragraph = Math.round((sec.section_5_paragraph?.questions || 0) * scale);
    return {
        single,
        multi,
        integer,
        match,
        paragraph,
        total: single + multi + integer + match + paragraph,
        questionsPerSubject: Number(sec.questions_per_subject || 0) || undefined,
        paperTotalQuestions: Number(sec.total_questions || 0) || undefined,
        totalMarks: Number(sec.total_marks || 0) || undefined,
        startTime: sec.start_time || undefined,
        endTime: sec.end_time || undefined,
        session: sec.session || undefined,
        formats: Array.isArray(sec.formats) ? sec.formats : undefined,
    };
};

/**
 * Build a small hard bank plan: only hard singles from high-relevance topics
 * (quality-first Stage A). Paper-mode expands later.
 */
export const buildAdvancedHardSlotTargets = ({
    count = 10,
    highOnly = true,
    hardOnly = true,
} = {}) => {
    const pool = highOnly
        ? getHighRelevanceAdvancedTopics()
        : getMediumPlusAdvancedTopics();
    const topics = pool.length ? pool : getJeeAdvancedMathTopics();
    if (!topics.length) return [];

    const targets = [];
    for (let i = 0; i < count; i += 1) {
        const t = topics[i % topics.length];
        const ncert = t.ncert || {};
        const archetype =
            (ncert.hard_archetypes || [])[i % Math.max(1, (ncert.hard_archetypes || []).length)] ||
            t.chapter;
        targets.push({
            topicId: t.topicId,
            chapter: t.chapter,
            questionKind: "multi_concept",
            difficulty: hardOnly ? "hard" : "hard",
            questionType: "single",
            conceptSlot: `${t.topicId.toLowerCase()}_${String(i + 1).padStart(2, "0")}`,
            label: `${t.chapter} — ${String(archetype).slice(0, 80)}`,
            hardArchetype: archetype,
            bannedEasy: ncert.banned_easy_templates || [],
        });
    }
    return targets;
};

// ---------------------------------------------------------------------------
// Prompt blocks
// ---------------------------------------------------------------------------

export const buildJeeAdvancedSyllabusPlanningBlock = ({
    subject = "",
    examProfile = "",
    topicFilter = null,
    maxSubtopics = 4,
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject)) return "";
    const topics = topicFilter?.length
        ? resolveJeeAdvancedTopics(topicFilter).matched
        : getJeeAdvancedMathTopics();
    if (!topics.length) return "";

    const lines = topics.map((t, i) => {
        const subs = (t.subtopics || [])
            .slice(0, maxSubtopics)
            .map((s) => String(s).slice(0, 90))
            .join("; ");
        const rel = t.scoring?.advanced_relevance || "?";
        return `${i + 1}. **${t.topicId} — ${t.chapter}** [Advanced relevance: ${rel}] Class ${t.classLevel || "?"}${subs ? `\n     Subtopics: ${subs}` : ""}`;
    });

    return `
**OFFICIAL JEE ADVANCED 2026 MATHEMATICS SYLLABUS — AUTHORITATIVE (file-backed, not model memory):**
Source: ${loadJson("syllabus")?.source_note || "JEE Advanced 2026 syllabus PDF"}.
Every planned slot MUST map to one of these topic ids (M01–M19). Put anything outside this list in \`excludedTopics\`.
Do **not** use JEE Main-only unit boundaries when they conflict — Advanced splits (e.g. Circles vs Conics, AOD vs LCD) win.

${lines.join("\n")}
`;
};

export const buildJeeAdvancedSyllabusWriterBlock = ({
    subject = "",
    examProfile = "",
    topicIds = [],
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject)) return "";
    const topics = topicIds?.length
        ? resolveJeeAdvancedTopics(topicIds).matched
        : getJeeAdvancedMathTopics();
    if (!topics.length) return "";

    return `
**JEE ADVANCED 2026 syllabus lock (Mathematics):** Generate ONLY within these topics — ${topics
        .map((t) => `${t.topicId} ${t.chapter}`)
        .join("; ")}.
Depth must match **IIT Advanced** (insight + multi-stage fusion), not JEE Main speed drills.
`;
};

/**
 * Design-quality lock from live paper review (2026-08): dual-lock can make keys
 * correct while stems stay "apply known formula" (Main-ish). Advanced depth =
 * hidden insight first, then computation — not longer arithmetic alone.
 */
export const buildJeeAdvancedDesignQualityBlock = ({
    examProfile = "",
    subject = "",
} = {}) => {
    if (examProfile && !isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject) && examProfile) {
        // allow when profile is Advanced even if subject label is odd
        if (!isAdvancedProfile(examProfile)) return "";
    }
    return `
**JEE ADVANCED DESIGN QUALITY (target ~9.2 authentic Advanced — not olympiad-overstack):**
Correct keys alone are NOT enough. Every stem must force **discovery**, not memorized plug-in.

DO (Advanced authenticity):
1. **Hidden first step / "aha"** — student spends minutes deciding *what* to do (invariant, symmetry, substitution, geometric interpretation, state model) before routine algebra.
2. **Multi-layer reasoning** — fuse **exactly 2 techniques** (occasionally 3 max). Intermediate result re-used non-obviously.
3. **DEPTH GOVERNOR (critical for correctness):** Real Advanced Paper-1/2 hard items usually stop after **2–3 major ideas**. Do NOT stack 4+ independent constructions (e.g. focal chord + tangents + normals + diameter circle + locus + area all in one stem). Prefer one clear chain of length 2–3.
4. **Non-telegraphed ask** — do NOT ask only for the quantity that the standard formula names. Prefer a property that follows from one core observation.
5. **Minimal but meaningful calculation** — challenge from structure, not giant expressions. Prefer answers that are dual-solvable in one focused derivation.
6. **Explanations must derive** — insight first, then steps; state theorems when used.

DO NOT (quality / hardness / correctness breaks):
- Commuting-matrix compare-entries with no second layer (Main drill).
- Pure dy/dx = (dy/dt)/(dx/dt) option pick with no further idea.
- Single formula recall only.
- **Over-ambition:** four major geometric engines in one multi-correct (kills verifiability).
- Stretch difficulty only by longer arithmetic / denser LaTeX.
- One-line explanations without the core derivation.

Self-check before emit (reject & rewrite if any fail):
- [ ] Top Main scorer still needs a non-obvious idea? If no → rewrite.
- [ ] Major technique count is 2–3 (not 4+)? If 4+ → simplify stem.
- [ ] Can an independent solver verify the key in a focused derivation? If no → simplify.
- [ ] For multi: options share a core intermediate (coupled), not four mini-papers.
`;
};

export const buildJeeAdvancedScoringPlanningBlock = ({
    subject = "",
    examProfile = "",
    bankDifficulty = "hard",
    highOnly = true,
    count = 10,
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject)) return "";

    const preferHard =
        String(bankDifficulty || "").toLowerCase().includes("hard") || highOnly;
    let pool = preferHard
        ? getHighRelevanceAdvancedTopics()
        : getMediumPlusAdvancedTopics();
    if (!pool.length) pool = getJeeAdvancedMathTopics();
    if (!pool.length) return "";

    // Sort high first, then by quota_weight if present
    pool = [...pool].sort((a, b) => {
        const ra = a.scoring?.advanced_relevance === "high" ? 2 : 1;
        const rb = b.scoring?.advanced_relevance === "high" ? 2 : 1;
        if (rb !== ra) return rb - ra;
        return (b.quotas?.quota_weight || 0) - (a.quotas?.quota_weight || 0);
    });

    const top = pool.slice(0, Math.min(16, Math.max(10, count * 2)));
    const lines = top.map((t, i) => {
        const d = t.scoring?.difficulty_split || {};
        const notes = t.scoring?.notes ? ` — ${t.scoring.notes}` : "";
        return `${i + 1}. [${t.scoring?.advanced_relevance || "?"}] **${t.topicId} ${t.chapter}** (E${d.easy ?? "?"}/M${d.medium ?? "?"}/H${d.hard ?? "?"}; quota_weight ${t.quotas?.quota_weight ?? "?"})${notes}`;
    });

    const broad = loadJson("scoring")?.broad_category_weightage_pct;
    const broadLine = broad
        ? `Broad category share (trend): Calculus ${broad.Calculus || "?"}, CoordGeo ${broad.Coordinate_Geometry || "?"}, Algebra ${broad.Algebra || "?"}, Vectors/3D ${broad.Vectors_and_3D || "?"}, Trig ${broad.Trigonometry || "?"}.`
        : "";

    return `
**JEE ADVANCED hard-topic scoring lock (file-backed — prefer HIGH advanced_relevance):**
${loadJson("scoring")?.data_provenance || "PYQ-trend grounded scoring for Advanced planning."}
Because bank difficulty is **hard / Advanced**, plan slots ONLY from the high/medium-high list below — never Statistics-only fluff or easy plug-in chapters as the main ask.
${broadLine}

**ALLOWED Advanced hard topics (use for includedTopics / conceptSlot / chapter):**
${lines.join("\n")}

Rules:
- Every slot maps to a topic_id above (e.g. M17 Integral Calculus).
- Prefer **hard_archetypes** from the Advanced NCERT context pack for that topic_id.
- Fuse ≥2 concepts for multi_concept slots (classic Advanced depth).
- Do NOT plan banned_easy_templates as the main ask.
`;
};

const topicNcertSection = (t, { compact = false } = {}) => {
    const d = t.ncert || {};
    const parts = [`### ${t.topicId} — ${t.chapter}`];
    if (d.concepts?.length) {
        parts.push(
            `**In-scope concepts:**\n${bullets(d.concepts, compact ? 6 : 0)}`
        );
    }
    if (d.formulas?.length) {
        parts.push(
            `**Formulas (use exact forms):**\n${bullets(d.formulas, compact ? 6 : 0)}`
        );
    }
    if (d.methods?.length) {
        parts.push(
            `**Allowed methods:**\n${bullets(d.methods, compact ? 4 : 0)}`
        );
    }
    if (d.out_of_scope?.length) {
        parts.push(
            `**OUT OF SCOPE — must NOT be required:**\n${bullets(d.out_of_scope)}`
        );
    }
    if (d.traps?.length) {
        parts.push(
            `**Traps (build distractors from these; do not commit them):**\n${bullets(d.traps, compact ? 4 : 0)}`
        );
    }
    if (d.hard_archetypes?.length) {
        parts.push(
            `**HARD ARCHETYPES (prefer as main ask):**\n${bullets(d.hard_archetypes, compact ? 3 : 0)}`
        );
    }
    if (d.banned_easy_templates?.length) {
        parts.push(
            `**BANNED EASY TEMPLATES (never main ask for Advanced hard):**\n${bullets(d.banned_easy_templates, compact ? 3 : 0)}`
        );
    }
    return parts.join("\n");
};

export const buildJeeAdvancedHardArchetypePlanBlock = ({
    subject = "",
    examProfile = "",
    topicFilter = null,
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject)) return "";
    const topics = topicFilter?.length
        ? resolveJeeAdvancedTopics(topicFilter).matched
        : getHighRelevanceAdvancedTopics().length
          ? getHighRelevanceAdvancedTopics()
          : getJeeAdvancedMathTopics();
    if (!topics.length) return "";

    const sections = topics.map((t) => {
        const d = t.ncert || {};
        const lines = [
            `### ${t.topicId} ${t.chapter} (advanced_relevance: ${t.scoring?.advanced_relevance || "?"})`,
        ];
        if (d.hard_archetypes?.length) {
            lines.push(`Prefer hard archetypes:\n${bullets(d.hard_archetypes)}`);
        }
        if (d.banned_easy_templates?.length) {
            lines.push(
                `Do NOT plan slots whose main ask is:\n${bullets(d.banned_easy_templates)}`
            );
        }
        return lines.join("\n");
    });

    return `
**JEE ADVANCED HARD ARCHETYPE PLAN (file-backed — concentrated IIT Advanced Maths):**
Every planned hard slot MUST map to a hard_archetype below (or equal multi-step fusion). Never plan banned easy templates. Keep solutions dual-solvable with a unique correct key.

${sections.join("\n\n")}
`;
};

/**
 * Full writer-facing Advanced NCERT context for topics touched by this batch.
 */
export const buildJeeAdvancedNcertWriterBlock = ({
    subject = "",
    examProfile = "",
    topics = [],
    slots = [],
    compact = false,
    includeDesignQuality = true,
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    if (subject && !isMathSubject(subject)) return "";

    let matched = [];
    if (topics?.length) {
        matched = resolveJeeAdvancedTopics(topics).matched;
    }
    if (!matched.length && slots?.length) {
        matched = inferJeeAdvancedTopicsFromSlots(slots);
    }
    if (!matched.length && !compact && !topics?.length) {
        // Fallback: high-relevance pack so writer still has hard guidance
        matched = getHighRelevanceAdvancedTopics().slice(0, 6);
    }
    if (!matched.length) return "";

    const design =
        includeDesignQuality
            ? `\n${buildJeeAdvancedDesignQualityBlock({ examProfile: "jee_advanced", subject })}\n`
            : "";
    const rules = compact
        ? `Use listed concepts/formulas only. Do not require OUT OF SCOPE. Prefer hard archetypes; never use banned easy templates as the main ask.`
        : `Rules (priority order):
1. Every question MUST be solvable with listed concepts/formulas/methods only.
2. Techniques under OUT OF SCOPE must NOT be required.
3. Prefer HARD ARCHETYPES; never use BANNED EASY TEMPLATES as the main ask.
4. Advanced depth = multi-condition stem + ≥2 technique fusion + non-telegraphed setup — not Main-level one-liners.
5. Build distractors from listed traps.
6. Design quality: hidden insight first; explanations must fully derive (see DESIGN QUALITY block).`;

    return `
**JEE ADVANCED NCERT/TOPIC CONTEXT — AUTHORITATIVE (file-backed, not model memory):**
${compact ? "" : loadJson("ncert")?.schema_note || ""}
${rules}
${design}
${matched.map((t) => topicNcertSection(t, { compact })).join("\n\n")}
`;
};

/**
 * Compact solver-facing formula/method lock.
 */
export const buildJeeAdvancedNcertSolverBlock = ({
    subject = "",
    examProfile = "",
    topics = [],
    slots = [],
} = {}) => {
    // Solver may not pass examProfile; still emit when we have Advanced slots
    // if subject is math and topics resolve against Advanced pack.
    if (examProfile && !isAdvancedProfile(examProfile) && examProfile !== "") {
        // If explicitly non-advanced, skip
        if (String(examProfile).toLowerCase() !== "jee_advanced") return "";
    }
    if (subject && !isMathSubject(subject) && !/\badvanced\b/i.test(String(subject))) {
        // still allow when slots map to advanced topics
    }

    let matched = [];
    if (topics?.length) matched = resolveJeeAdvancedTopics(topics).matched;
    if (!matched.length && slots?.length) {
        matched = inferJeeAdvancedTopicsFromSlots(slots);
    }
    if (!matched.length) return "";

    const sections = matched.map((t) => {
        const d = t.ncert || {};
        const lines = [`### ${t.topicId} — ${t.chapter}`];
        if (d.formulas?.length) lines.push(`Formulas:\n${bullets(d.formulas)}`);
        if (d.methods?.length) lines.push(`Allowed methods:\n${bullets(d.methods)}`);
        if (d.traps?.length) {
            lines.push(`Traps to avoid while solving:\n${bullets(d.traps)}`);
        }
        return lines.join("\n");
    });

    return `
**JEE ADVANCED TOPIC REFERENCE FOR RE-DERIVATION (authoritative):**
Solve using only the methods/formulas below. If derivation needs something not listed, re-identify the concept and restart. Verify final answer against listed traps before committing.

${sections.join("\n\n")}
`;
};

export const buildJeeAdvancedPatternAuthoringBlock = ({
    examProfile = "",
    paper = 1,
} = {}) => {
    if (!isAdvancedProfile(examProfile)) return "";
    const counts = getAdvancedPaperTypeCounts({ paper });
    const pattern = loadJson("pattern");
    return `
**JEE ADVANCED PAPER PATTERN (subject × paper — reference, year may vary):**
${pattern?.data_provenance || ""}
${pattern?.important_caveat || ""}
Paper ${paper} per subject (approx): single ${counts.single} · multi-correct ${counts.multi} · numerical/integer ${counts.integer} · match-list ${counts.match}${counts.paragraph ? ` · paragraph ${counts.paragraph}` : ""} (total ~${counts.total}).
Option rules: single/multi = 4 options; integer = no options (numeric answer); match = 4 arrangement options; paragraph = comprehension-linked MCQs.
When generating a **hard quality bank** (not full paper), prefer single-correct multi-concept items first for dual-lock accuracy; expand multi/integer only when type mix is requested.
`;
};

/**
 * Composite planner injection when exam is Advanced Maths.
 */
export const buildJeeAdvancedPlannerInjection = (opts = {}) => {
    if (!isAdvancedProfile(opts.examProfile)) return "";
    if (opts.subject && !isMathSubject(opts.subject) && !isMathSubject(opts.subjectId)) {
        return "";
    }
    return [
        buildJeeAdvancedSyllabusPlanningBlock(opts),
        buildJeeAdvancedScoringPlanningBlock(opts),
        buildJeeAdvancedHardArchetypePlanBlock(opts),
        buildJeeAdvancedPatternAuthoringBlock(opts),
    ]
        .filter(Boolean)
        .join("\n");
};
