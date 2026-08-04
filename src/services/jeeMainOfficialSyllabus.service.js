/**
 * Official JEE (Main) 2026 syllabus (Paper 1 B.E./B.Tech.) — file-backed.
 * Prefer this over model memory when planning or validating in-scope topics.
 *
 * Data: files/jee-main-syllabus/jee-main-2026-official.json
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(
    __dirname,
    "..",
    "..",
    "files",
    "jee-main-syllabus",
    "jee-main-2026-official.json"
);

let cached = null;

const normalizeSubjectKey = (subject = "") => {
    const s = String(subject || "").toLowerCase();
    if (/\bmath/.test(s)) return "MATHEMATICS";
    if (/\bphys/.test(s)) return "PHYSICS";
    if (/\bchem/.test(s)) return "CHEMISTRY";
    if (s === "mathematics" || s === "maths" || s === "math") return "MATHEMATICS";
    if (s === "physics") return "PHYSICS";
    if (s === "chemistry") return "CHEMISTRY";
    return "";
};

export const loadJeeMainOfficialSyllabus = (filePath = DEFAULT_PATH) => {
    if (cached && cached.path === filePath) return cached.data;
    if (!existsSync(filePath)) {
        cached = { path: filePath, data: null };
        return null;
    }
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    cached = { path: filePath, data };
    return data;
};

export const isJeeMainOfficialSyllabusAvailable = () =>
    Boolean(loadJeeMainOfficialSyllabus());

const getPaper1 = (data) =>
    (data?.papers || []).find((p) =>
        /paper\s*1|b\.?e\.?\/?\s*b\.?tech/i.test(String(p.paper || ""))
    ) || null;

/**
 * Flat unit list for Paper 1 subject: { unit, title, content, branch? }
 */
export const getOfficialSyllabusUnits = (subject = "") => {
    const data = loadJeeMainOfficialSyllabus();
    const paper1 = getPaper1(data);
    if (!paper1?.subjects?.length) return [];
    const key = normalizeSubjectKey(subject);
    if (!key) return [];

    const subj = paper1.subjects.find(
        (s) => String(s.subject || "").toUpperCase() === key
    );
    if (!subj) return [];

    if (Array.isArray(subj.units) && subj.units.length) {
        return subj.units.map((u) => ({
            unit: u.unit,
            title: String(u.title || "").trim(),
            content: String(u.content || "").trim(),
            branch: null,
        }));
    }

    const out = [];
    for (const section of subj.sections || []) {
        const branch = String(section.branch || "").trim() || null;
        for (const u of section.units || []) {
            out.push({
                unit: u.unit,
                title: String(u.title || "").trim(),
                content: String(u.content || "").trim(),
                branch,
            });
        }
    }
    return out;
};

const normalizeForMatch = (text = "") =>
    String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Soft match a chapter/concept name against official unit titles + content.
 * Returns best unit or null.
 */
export const matchOfficialSyllabusUnit = (subject = "", chapterOrConcept = "") => {
    const units = getOfficialSyllabusUnits(subject);
    if (!units.length) return null;
    const needle = normalizeForMatch(chapterOrConcept);
    if (!needle) return null;

    let best = null;
    let bestScore = 0;
    for (const u of units) {
        const title = normalizeForMatch(u.title);
        const content = normalizeForMatch(u.content).slice(0, 800);
        let score = 0;
        if (title && (needle.includes(title) || title.includes(needle))) {
            score = 100;
        } else {
            const titleTokens = title.split(" ").filter((t) => t.length > 3);
            const hit = titleTokens.filter((t) => needle.includes(t)).length;
            if (titleTokens.length) score = (hit / titleTokens.length) * 70;
            if (score < 40) {
                const contentHits = titleTokens.filter((t) =>
                    content.includes(t)
                ).length;
                // also try needle tokens in content
                const needleTokens = needle
                    .split(" ")
                    .filter((t) => t.length > 4)
                    .slice(0, 8);
                const inContent = needleTokens.filter((t) =>
                    content.includes(t)
                ).length;
                score = Math.max(
                    score,
                    (inContent / Math.max(1, needleTokens.length)) * 55
                );
                void contentHits;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            best = u;
        }
    }
    return bestScore >= 35 ? best : null;
};

export const isChapterInOfficialSyllabus = (subject = "", chapter = "") =>
    Boolean(matchOfficialSyllabusUnit(subject, chapter));

/**
 * Planner block: AUTHORITATIVE official syllabus units (not model memory).
 */
export const buildOfficialSyllabusPlanningBlock = ({
    subject = "",
    examProfile = "",
    maxContentChars = 220,
} = {}) => {
    const profile = String(examProfile || "").toLowerCase();
    if (profile !== "jee_main" && profile !== "jee_advanced") return "";

    // Advanced Maths syllabus is file-backed in jee_advanced/ (M01–M19).
    // Planner injects that pack separately — do not double-inject Main units.
    if (profile === "jee_advanced") return "";

    const units = getOfficialSyllabusUnits(subject);
    if (!units.length) return "";

    const subjectLabel = normalizeSubjectKey(subject) || "SUBJECT";
    const lines = units.map((u, i) => {
        const branch = u.branch ? ` [${u.branch}]` : "";
        const content = String(u.content || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, maxContentChars);
        const more = String(u.content || "").length > maxContentChars ? "…" : "";
        return `${i + 1}. ${u.unit}${branch} — **${u.title}**: ${content}${more}`;
    });

    return `
**OFFICIAL JEE (Main) 2026 syllabus — AUTHORITATIVE (file from NTA; do NOT invent or expand beyond this):**
Title: Syllabus for JEE (Main) - 2026 | Paper 1 (B.E./B.Tech.) | Subject: ${subjectLabel}
Every planned slot MUST map to one of these units. Anything not covered below is **out of syllabus** — put it in \`excludedTopics\` and never plan it.
If model memory conflicts with this list (deleted chapters, extra college topics), **this list wins**.

${lines.join("\n")}
`;
};

/**
 * Compact writer-facing syllabus lock.
 */
export const buildOfficialSyllabusWriterBlock = ({
    subject = "",
    examProfile = "",
} = {}) => {
    const profile = String(examProfile || "").toLowerCase();
    if (profile !== "jee_main" && profile !== "jee_advanced") return "";
    // Advanced writer uses jeeAdvancedMaths syllabus block instead.
    if (profile === "jee_advanced") return "";
    const units = getOfficialSyllabusUnits(subject);
    if (!units.length) return "";

    return `
**OFFICIAL JEE Main 2026 syllabus lock (Paper 1):** Generate ONLY within these units — ${units
        .map((u) => u.title)
        .join("; ")}.
Do not invent topics deleted from the rationalized syllabus or college-only extensions.
`;
};
