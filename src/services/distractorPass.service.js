/**
 * Phase C — Dedicated distractor generator + validator.
 * Correct answer is locked; distractors are generated/validated separately.
 */

import { parseJsonArrayFromAIText } from "../utils/aiJsonRepair.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";

export const isDistractorPassEnabled = () => {
    const flag = process.env.AI_QB_DISTRACTOR_PASS;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const letter = (i) => String.fromCharCode(65 + Number(i));

const optionText = (o) =>
    typeof o === "object" && o !== null ? String(o.text ?? "") : String(o ?? "");

/**
 * Deterministic distractor quality checks.
 */
export const validateDistractors = (options = [], correctIndex = 0) => {
    const opts = (options || []).map(optionText).map((t) => t.trim());
    const issues = [];
    if (opts.length !== 4) {
        issues.push(`Expected 4 options, got ${opts.length}`);
    }
    const norm = opts.map((t) => t.toLowerCase().replace(/\s+/g, " "));
    if (new Set(norm.filter(Boolean)).size < opts.filter(Boolean).length) {
        issues.push("Duplicate distractors");
    }
    if (!Number.isFinite(correctIndex) || correctIndex < 0 || correctIndex >= opts.length) {
        issues.push("Invalid correctIndex");
    } else if (!opts[correctIndex]) {
        issues.push("Correct option empty");
    }
    // Obvious-wrong heuristic: empty or single-char fillers
    opts.forEach((t, i) => {
        if (i === correctIndex) return;
        if (!t || t.length < 1) issues.push(`Empty distractor at ${letter(i)}`);
        if (/^(n\/a|none|xxx|asdf)$/i.test(t)) {
            issues.push(`Placeholder distractor at ${letter(i)}`);
        }
    });
    return { ok: issues.length === 0, issues };
};

export const buildDistractorGenerationPrompt = ({
    questionText = "",
    correctOption = "",
    correctIndex = 0,
    topic = "",
    difficulty = "hard",
    existingOptions = [],
} = {}) => {
    const others = (existingOptions || [])
        .map(optionText)
        .filter((_, i) => i !== correctIndex);
    return `You write high-quality MCQ distractors for competitive exams.

Topic: ${topic || "(general)"}
Difficulty: ${difficulty}
Stem:
${questionText}

Correct answer (LOCKED — do not change):
${letter(correctIndex)}) ${correctOption}

Current other options (improve if weak):
${others.map((t, i) => `- ${t}`).join("\n") || "(none)"}

TASK: Return exactly 3 plausible WRONG options that:
- Are close to the correct answer (common mistakes, sign errors, adjacent concepts)
- Are NOT obviously absurd
- Are distinct from each other and from the correct answer
- Match the same units/format as the correct answer

Return ONLY JSON:
[{"distractors":["...","...","..."]}]`;
};

export const parseDistractorResponse = (rawText) => {
    const rows = parseJsonArrayFromAIText(rawText) || [];
    const first = rows[0] || {};
    const list = Array.isArray(first.distractors)
        ? first.distractors
        : Array.isArray(first)
          ? first
          : [];
    return list.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 3);
};

/**
 * Rebuild options: keep correct at correctIndex, replace others with new distractors.
 */
export const combineCorrectWithDistractors = (
    correctOption,
    distractors = [],
    correctIndex = 0
) => {
    const d = [...distractors].filter(Boolean).slice(0, 3);
    while (d.length < 3) d.push(`Alt ${d.length + 1}`);
    const options = [];
    let di = 0;
    for (let i = 0; i < 4; i++) {
        options.push(i === correctIndex ? correctOption : d[di++]);
    }
    return options;
};

/**
 * Run distractor pass over a batch of single questions.
 */
export const runDistractorPass = async (
    questions = [],
    { topic = "", callLlm } = {}
) => {
    if (!isDistractorPassEnabled() || typeof callLlm !== "function") {
        return { questions, improved: 0, failed: 0 };
    }

    let improved = 0;
    let failed = 0;
    const next = [];

    for (const q of questions) {
        const type = String(q?.questionType || "single").toLowerCase();
        if (type !== "single") {
            next.push(q);
            continue;
        }
        const opts = (q.options || []).map(optionText);
        const correctIndex = Number.isFinite(q.correctIndex)
            ? Number(q.correctIndex)
            : 0;
        const correctOption = opts[correctIndex] || "";
        if (!correctOption) {
            next.push(q);
            failed++;
            continue;
        }

        try {
            const raw = await callLlm(
                buildDistractorGenerationPrompt({
                    questionText: q.questionText,
                    correctOption,
                    correctIndex,
                    topic,
                    difficulty: q.difficulty || q.difficultyTier || "hard",
                    existingOptions: opts,
                })
            );
            const distractors = parseDistractorResponse(raw);
            if (distractors.length < 3) {
                next.push(q);
                failed++;
                continue;
            }
            const combined = combineCorrectWithDistractors(
                correctOption,
                distractors,
                correctIndex
            );
            const check = validateDistractors(combined, correctIndex);
            if (!check.ok) {
                pipelineTrace("DISTRACTOR_PASS_REJECT", {
                    issues: check.issues,
                    stem: String(q.questionText || "").slice(0, 80),
                });
                next.push(q);
                failed++;
                continue;
            }
            next.push({
                ...q,
                options: combined,
                _distractorPass: true,
            });
            improved++;
        } catch (err) {
            pipelineTrace("DISTRACTOR_PASS_FAILED", {
                error: err?.message || String(err),
            });
            next.push(q);
            failed++;
        }
    }

    pipelineTrace("DISTRACTOR_PASS_DONE", { improved, failed });
    return { questions: next, improved, failed };
};
