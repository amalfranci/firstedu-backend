/**
 * Loads April-2026 JEE Main most-scoring / high-weightage concept analysis and
 * steers archetype planning + hard generation toward real exam-frequency topics
 * (especially chapters with a non-trivial Hard split).
 *
 * Data: files/jee-main-scoring-concepts/april-2026-most-scoring-concepts.json
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
    isChapterInOfficialSyllabus,
    isJeeMainOfficialSyllabusAvailable,
} from "./jeeMainOfficialSyllabus.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(
    __dirname,
    "..",
    "..",
    "files",
    "jee-main-scoring-concepts",
    "april-2026-most-scoring-concepts.json"
);

let cached = null;

const normalizeSubject = (subject = "") => {
    const s = String(subject || "").toLowerCase();
    if (/\bmath/.test(s)) return "Mathematics";
    if (/\bphys/.test(s)) return "Physics";
    if (/\bchem/.test(s)) return "Chemistry";
    if (s === "mathematics" || s === "maths" || s === "math") return "Mathematics";
    if (s === "physics") return "Physics";
    if (s === "chemistry") return "Chemistry";
    return "";
};

const importanceScore = (importance = "") => {
    const i = String(importance || "").toLowerCase();
    if (i === "high") return 30;
    if (i === "medium") return 12;
    return 0;
};

const hardBiasScore = (rec, preferHard) => {
    const d = rec.difficulty || {};
    const hard = Number(d.hard) || 0;
    const medium = Number(d.medium) || 0;
    const easy = Number(d.easy) || 0;
    const total = Math.max(1, hard + medium + easy);
    const hardShare = hard / total;
    const tags = Array.isArray(rec.tags) ? rec.tags : [];
    let score = hard * 12 + medium * 1.2 - easy * 1.5 + hardShare * 50;
    if (tags.includes("predominantly-hard")) score += 55;
    if (tags.includes("predominantly-medium") && preferHard) score += 6;
    if (tags.includes("predominantly-easy") && preferHard) score -= 45;
    if (preferHard && hard === 0) score -= 35;
    if (tags.includes("high-weightage-chapter")) score += 12;
    if (tags.includes("high-frequency-concept")) score += 10;
    return score;
};

const rankScore = (rec, { preferHard = true } = {}) => {
    const base =
        (Number(rec.concept_frequency) || 0) * (preferHard ? 6 : 10) +
        (Number(rec.chapter_weightage) || 0) * (preferHard ? 1.2 : 1.5) +
        importanceScore(rec.importance) +
        hardBiasScore(rec, preferHard) +
        Math.max(0, 25 - (Number(rec.chapter_rank) || 25));
    return base;
};

export const loadJeeMainScoringConcepts = (filePath = DEFAULT_PATH) => {
    if (cached && cached.path === filePath) return cached.data;
    if (!existsSync(filePath)) {
        cached = { path: filePath, data: null };
        return null;
    }
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    cached = { path: filePath, data };
    return data;
};

export const isJeeMainScoringConceptsAvailable = () =>
    Boolean(loadJeeMainScoringConcepts()?.records?.length);

/**
 * Ranked concept records for a subject. When preferHard, chapters with Hard>0
 * and predominantly-hard tags rise; predominantly-easy chapters sink.
 *
 * When hardTopicsOnly (hard bank / exam-native), ONLY keep concepts that appear
 * in hard questions (Hard>0) or are tagged predominantly-hard — easy-only chapters
 * are excluded from the topic plan.
 */
export const getRankedScoringConcepts = (
    subject = "",
    {
        preferHard = true,
        limit = 24,
        minFrequency = 1,
        requireHardChapter = false,
        hardTopicsOnly = false,
        requireOfficialSyllabus = true,
    } = {}
) => {
    const data = loadJeeMainScoringConcepts();
    if (!data?.records?.length) return [];
    const subjectKey = normalizeSubject(subject);
    const lockSyllabus =
        requireOfficialSyllabus && isJeeMainOfficialSyllabusAvailable();
    const strictHard = Boolean(hardTopicsOnly || requireHardChapter);

    let rows = data.records.filter((r) => {
        if (subjectKey && r.subject !== subjectKey) return false;
        if ((Number(r.concept_frequency) || 0) < minFrequency) return false;
        const hard = Number(r.difficulty?.hard) || 0;
        const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
        if (strictHard) {
            const hardLean =
                hard > 0 || tags.includes("predominantly-hard");
            if (!hardLean) return false;
            // Never plan predominantly-easy chapters for a hard bank.
            if (tags.includes("predominantly-easy") && hard === 0) return false;
        } else if (requireHardChapter && !hard) {
            return false;
        }
        if (
            lockSyllabus &&
            !isChapterInOfficialSyllabus(subjectKey || subject, r.chapter) &&
            !isChapterInOfficialSyllabus(subjectKey || subject, r.concept)
        ) {
            return false;
        }
        return true;
    });

    // Soft fallback: if strict hard filter emptied the pool, relax to Hard>0 only.
    if (!rows.length && strictHard) {
        rows = data.records.filter((r) => {
            if (subjectKey && r.subject !== subjectKey) return false;
            if ((Number(r.concept_frequency) || 0) < minFrequency) return false;
            if (!(Number(r.difficulty?.hard) || 0)) return false;
            if (
                lockSyllabus &&
                !isChapterInOfficialSyllabus(subjectKey || subject, r.chapter) &&
                !isChapterInOfficialSyllabus(subjectKey || subject, r.concept)
            ) {
                return false;
            }
            return true;
        });
    }

    rows = [...rows].sort(
        (a, b) => rankScore(b, { preferHard: preferHard || strictHard }) - rankScore(a, { preferHard: preferHard || strictHard })
    );
    return rows.slice(0, Math.max(1, limit));
};

const slugConcept = (concept = "") =>
    String(concept || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48) || "scoring_concept";

/**
 * Catalog-fallback conceptSlot ids derived from scoring data (hard-biased).
 */
export const allocateScoringConceptSlots = (
    count,
    { subject = "", slotOffset = 0, preferHard = true, hardTopicsOnly = false } = {}
) => {
    const n = Math.max(1, count);
    const ranked = getRankedScoringConcepts(subject, {
        preferHard,
        hardTopicsOnly: hardTopicsOnly || preferHard,
        requireHardChapter: hardTopicsOnly || preferHard,
        limit: Math.max(n * 3, 40),
        minFrequency: 1,
    });
    if (!ranked.length) return [];
    const offset = Math.max(0, Number(slotOffset) || 0);
    const slots = [];
    for (let i = 0; i < n; i += 1) {
        const rec = ranked[(offset + i) % ranked.length];
        slots.push(`${slugConcept(rec.concept)}_${(offset + i) % 97}`);
    }
    return slots;
};

/**
 * Prompt block for the archetype planner — anchors slots on real April-2026
 * high-weightage / high-frequency concepts, with hard chapters preferred.
 */
export const buildScoringConceptPlanningBlock = ({
    subject = "",
    examProfile = "",
    bankDifficulty = "hard",
    examCalibrated = false,
    count = 10,
} = {}) => {
    const profile = String(examProfile || "").toLowerCase();
    if (profile !== "jee_main" && profile !== "jee_advanced") return "";

    // Advanced Maths scoring lives in jee_advanced/ — handled by planner injection.
    // Avoid double-injecting Main April-2026 scoring into Advanced plans.
    if (profile === "jee_advanced") return "";

    const preferHard =
        examCalibrated || String(bankDifficulty || "").toLowerCase() === "hard";

    // Hard bank → topic plan must come from hard-leaning concepts only.
    const top = getRankedScoringConcepts(subject, {
        preferHard,
        hardTopicsOnly: preferHard,
        requireHardChapter: preferHard,
        limit: Math.min(28, Math.max(14, count * 2)),
        minFrequency: 1,
    });
    if (!top.length) return "";

    const hardChapterPool = getRankedScoringConcepts(subject, {
        preferHard: true,
        hardTopicsOnly: true,
        requireHardChapter: true,
        limit: 16,
        minFrequency: 1,
    });

    const formatRow = (r, i) => {
        const d = r.difficulty || {};
        return `${i + 1}. [${r.importance}] ${r.chapter} (wt ${r.chapter_weightage}, rank #${r.chapter_rank}) → **${r.concept}** (freq ${r.concept_frequency}; E${d.easy || 0}/M${d.medium || 0}/H${d.hard || 0})`;
    };

    const hardHint = preferHard
        ? `
**HARD TOPIC LOCK (bank difficulty = hard — critical):**
- Plan **ONLY** from the hard-leaning list below (Hard count > 0 and/or \`predominantly-hard\`).
- **Do NOT** pick predominantly-easy / easy-only chapters as included topics.
- Every slot's \`conceptSlot\` / label must map to one of these hard concepts (or a close hard variant).
- High frequency alone is not enough — if Hard=0 and tag is predominantly-easy, skip it.
- For \`multi_concept\`, fuse two hard-list concepts (same or linked high-weightage chapter).
- Avoid textbook one-liners / single-plug formula stems — write shift-paper depth.
`
        : `
Use these concepts as the primary syllabus anchors for this batch (high scoring / high weightage in recent JEE Main analysis).
`;

    const hardList =
        hardChapterPool.length > 0
            ? `\n**ALLOWED hard topics only (use these for includedTopics / conceptSlot):**\n${hardChapterPool
                  .slice(0, 14)
                  .map((r, i) => formatRow(r, i))
                  .join("\n")}\n`
            : "";

    return `
**JEE Main April 2026 most-scoring / high-weightage concepts (empirical — use as primary topic anchors):**
Source: ${top[0]?.source || "April 2026 scoring analysis"}. ${preferHard ? "Because bank difficulty is **hard**, plan slots ONLY from hard-leaning concepts." : "Plan the majority of slots from this list (or close variants)."}
${hardHint}
**Ranked ${preferHard ? "hard-only " : ""}concepts for ${normalizeSubject(subject) || "this subject"}:**
${top.map((r, i) => formatRow(r, i)).join("\n")}
${hardList}`;
};

/**
 * Compact writer-facing block so solve-first skeletons stay on scoring topics
 * at hard depth.
 */
export const buildScoringConceptWriterBlock = ({
    subject = "",
    examProfile = "",
    difficulty = "hard",
    examCalibrated = false,
} = {}) => {
    const profile = String(examProfile || "").toLowerCase();
    if (profile !== "jee_main" && profile !== "jee_advanced") return "";

    // Advanced: writer already gets hard archetypes from jeeAdvancedMaths pack.
    if (profile === "jee_advanced") {
        return `
**JEE ADVANCED HARDNESS LOCK:** Write IIT Advanced multi-step depth (insight, multi-condition stems, fused concepts). JEE Main one-line formula drills will be rejected even if the arithmetic is correct. Prefer HIGH advanced_relevance topics and hard_archetypes from the Advanced context pack.
`;
    }

    const preferHard =
        examCalibrated || String(difficulty || "").toLowerCase() === "hard";
    const top = getRankedScoringConcepts(subject, {
        preferHard,
        hardTopicsOnly: preferHard,
        requireHardChapter: preferHard,
        limit: 10,
        minFrequency: 1,
    });
    if (!top.length) return "";

    return `
**SCORING-CONCEPT HARDNESS (April 2026 analysis):** ${preferHard ? "Hard bank — use ONLY hard-leaning concepts below (Hard>0 / predominantly-hard)." : "Target high-weightage chapters/concepts below."} Correct-but-easy drills on these topics will be rejected — write shift-paper depth (constraints, linked ideas, non-obvious ask).
${top
    .map(
        (r, i) =>
            `${i + 1}. ${r.chapter} → ${r.concept} (freq ${r.concept_frequency}, chapter wt ${r.chapter_weightage}, hard ${r.difficulty?.hard || 0})`
    )
    .join("\n")}
`;
};
