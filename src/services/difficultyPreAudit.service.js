/**
 * Deterministic difficulty gate for initial generation — flags formula-only /
 * chapter-test items that fail upscaled tier calibration (target difficultyMatch ≥ 80).
 */

import { detectExamProfile } from "./examDifficultyCalibration.js";
import {
    ISSUE_CATEGORY,
    computeSeparatedValidationScores,
} from "./topicRelevanceValidation.service.js";
import { normalizeBankDifficulty, normalizeQuestionTier } from "./difficultyMix.service.js";
import { flattenQuestionBankForCorrectnessAudit } from "./correctnessPreAudit.service.js";
import { detectHardMandateIssues } from "./hardQuestionMandate.service.js";

/** Internal target — empirically ~20–30 pts above OpenAI validation difficultyMatch. */
export const INITIAL_GEN_DIFFICULTY_MATCH_TARGET = Number(
    process.env.AI_QB_INITIAL_DIFFICULTY_TARGET || 92
);

const countSentences = (text = "") => {
    const parts = String(text || "")
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8);
    return Math.max(1, parts.length);
};

const MIN_STEM_CHARS = { easy: 85, medium: 130, hard: 180 };
const MIN_SOLVE_STEPS = { easy: 2, medium: 3, hard: 4 };
const MIN_SENTENCES = { easy: 2, medium: 2, hard: 4 };

/** One-liner templates that are below upscaled tier bands for JEE/NEET STEM. */
const TOO_EASY_TEMPLATES = [
    {
        re: /de\s+broglie\s+wavelength.*(?:potential|accelerated|through\s+(?:a\s+)?\d+\s*v)/i,
        message:
            "Single-formula de Broglie plug-in — below upscaled tier; needs multi-step or comparative setup.",
        maxTier: "easy",
    },
    {
        re: /calculate the de\s+broglie wavelength|de\s+broglie wavelength associated with this electron/i,
        message:
            "Direct de Broglie numerical drill — below upscaled medium/hard band.",
        maxTier: "medium",
    },
    {
        re: /change in entropy.*isothermal.*(?:expansion|compression).*ln\s*\(/i,
        message:
            "Direct ΔS = nR ln(V₂/V₁) isothermal template — below medium/hard upscaled band.",
        maxTier: "easy",
    },
    {
        re: /reversible adiabatic.*(?:expansion|compression).*entropy/i,
        message:
            "Definition-recall adiabatic ΔS = 0 — too easy for medium/hard tier.",
        maxTier: "easy",
    },
    {
        re: /photoelectric.*work function.*(?:kinetic energy|maximum kinetic)/i,
        message:
            "Single-step photoelectric KE = hf − φ — below upscaled medium band.",
        maxTier: "easy",
    },
    {
        re: /rate law is rate\s*=\s*k\[/i,
        message:
            "Direct rate-law plug-in for k — chapter-test ease for medium/hard slots.",
        maxTier: "easy",
    },
    {
        re: /torque.*(?:loop|circular).*current.*magnetic field.*sin/i,
        message:
            "Single-formula τ = NIAB sin θ torque — below upscaled medium band.",
        maxTier: "easy",
    },
    {
        re: /projectile.*radius of curvature.*highest point/i,
        message:
            "Standard projectile R = v²/g at apex — one-formula template for medium/hard.",
        maxTier: "easy",
    },
    {
        re: /induced (?:current|emf).*d(?:Φ|phi)\/dt|dΦ\/dt/i,
        message:
            "Straightforward Faraday ε = |dΦ/dt| template — needs extra constraints for hard tier.",
        maxTier: "medium",
    },
    {
        re: /power\s+dissipat.*magnetic\s+field|ε\s*=\s*BLv.*power/i,
        message:
            "Bare motional-EMF power plug-in (ε = BLv, P = ε²/R) — below hard tier unless fused with another constraint.",
        maxTier: "medium",
    },
    {
        re: /ratio\s+of\s+the\s+de\s+broglie\s+wavelength/i,
        message:
            "Single-formula de Broglie ratio √(m_α q_α / m_e q_e) — below upscaled hard band without extra linkage.",
        maxTier: "medium",
    },
    {
        re: /young(?:'s)?\s+double[- ]slit|YDSE/i,
        message:
            "YDSE fringe-distance template — below hard tier unless combined with lens/medium change or non-standard geometry.",
        maxTier: "medium",
    },
    {
        re: /by what factor does the rate change/i,
        message:
            "Rate-factor plug-in without derivation setup — too easy for hard tier.",
        maxTier: "medium",
    },
    {
        re: /calculate the (?:de broglie|wavelength).*angstrom/i,
        message:
            "Short de Broglie numerical drill — below upscaled hard band.",
        maxTier: "easy",
    },
    {
        re: /van\s*der\s*waals|work done (?:on|by) the gas/i,
        message:
            "Van der Waals gas work template — coaching veterans solve by memorized W = −P_ext ΔV path.",
        maxTier: "medium",
    },
    {
        re: /compton\s+scattering|change in (?:the )?wavelength of (?:the )?(?:scattered )?photon/i,
        message:
            "Compton scattering Δλ template — familiar drill below veteran hard band.",
        maxTier: "medium",
    },
    {
        re: /binary\s+(?:star|system).*(?:potential energy|gravitational potential|mid[- ]?point)/i,
        message:
            "Binary-star gravitation template — overused in coaching; below veteran diversity bar.",
        maxTier: "medium",
    },
    {
        re: /capillary.*(?:rise|height).*(?:percentage|percent)/i,
        message:
            "Capillary rise percentage drill — chapter-test ease for veteran tier.",
        maxTier: "medium",
    },
];

const tierRank = (tier) =>
    tier === "hard" ? 3 : tier === "medium" ? 2 : 1;

const tierTooLow = (assignedTier, maxAllowedTier) =>
    tierRank(assignedTier) > tierRank(maxAllowedTier);

const MULTI_STEP_MARKERS =
    /\b(?:two|both|system|combination|respectively|first.*then|after|linked|simultaneously|constraint|interval|case|parameter|given|when|if|placed|determine|charged|particle|electron|proton|accelerated|through|medium|refractive|focal|equivalent|ratio|compared|while|where|between|using|minimum|maximum|find the .+ and|calculate the .+ and|at the instant|net|total|combined|contact with|in series|in parallel)\b/i;

const HIDDEN_CONSTRAINT_MARKERS =
    /\b(?:neglect|ignore|assume|ideal|frictionless|massless|uniform|steady|static|implicit|unless|only when|provided that|given that|approximat|small angle|large distance|in vacuum|in air|at rest|initially|suddenly|instantaneously)\b/i;

const INDIRECT_INFERENCE_MARKERS =
    /\b(?:infer|deduce|imply|implies|therefore|must be|cannot be|contradiction|which of the following|best describes|most appropriate|not possible|only possible|consistent with|inconsistent)\b/i;

const MULTI_CONCEPT_MARKERS =
    /\b(?:and|while|simultaneously|both|combined|coupled|interaction|respectively|linked|fusion|using .+ and|between .+ and)\b/i;

/** 0–100 reasoning depth — hidden constraints, multi-concept, indirect inference. */
export const scoreReasoningDepth = (q = {}) => {
    const stem = String(q.questionText || q.text || q.stem || "").trim();
    const solveSteps = q.solveSteps || q._solveSteps || [];
    const explanation = String(q.explanation || "").trim();
    const stepText = [
        ...solveSteps.map(String),
        explanation,
    ]
        .join(" ")
        .trim();

    let score = 28;
    if (HIDDEN_CONSTRAINT_MARKERS.test(stem)) score += 18;
    if (MULTI_CONCEPT_MARKERS.test(stem)) score += 16;
    if (INDIRECT_INFERENCE_MARKERS.test(stem)) score += 14;
    if (MULTI_STEP_MARKERS.test(stem)) score += 10;
    if (Array.isArray(solveSteps) && solveSteps.length >= 4) score += 12;
    else if (solveSteps.length >= 3) score += 8;
    else if (solveSteps.length >= 2) score += 4;
    if (HIDDEN_CONSTRAINT_MARKERS.test(stepText)) score += 8;
    if (INDIRECT_INFERENCE_MARKERS.test(stepText)) score += 6;
    if (q._conceptFusion || q.conceptFusion) score += 10;
    if (stem.length >= 180) score += 6;
    if (/single.formula|plug.in|direct substitution/i.test(stem)) score -= 12;

    return Math.max(0, Math.min(100, Math.round(score)));
};

const REASONING_DEPTH_FLOOR = { easy: 42, medium: 52, hard: 62 };

/**
 * Per-exam-profile difficulty calibration. The deterministic gate below is a
 * STEM (multi-step numeric) heuristic; applying one set of thresholds to every
 * exam pins non-JEE papers artificially low. Each exam gets floors scaled to
 * how it actually tests:
 *   - `stem: false` → verbal / reasoning exams (CLAT, CAT, UPSC, board): the
 *     STEM reasoning-depth + formula-template checks don't apply at all.
 *   - `applyTemplates` → whether the JEE/NEET too-easy formula templates and the
 *     hard-tier "multi-concept setup" check run (NEET has legitimate single-step
 *     application items, so it's off there).
 * Tune per exam here rather than in the detector body.
 */
const DIFFICULTY_PROFILE_CALIBRATION = {
    jee_advanced: {
        stem: true,
        applyTemplates: true,
        reasoningFloor: { easy: 42, medium: 52, hard: 62 },
        minChars: { easy: 85, medium: 130, hard: 180 },
        minSentences: { easy: 2, medium: 2, hard: 4 },
    },
    jee_main: {
        stem: true,
        applyTemplates: true,
        reasoningFloor: { easy: 36, medium: 44, hard: 52 },
        minChars: { easy: 70, medium: 110, hard: 150 },
        minSentences: { easy: 1, medium: 2, hard: 3 },
    },
    neet: {
        // Recall / application heavy — much lower reasoning-depth expectation,
        // and single-formula templates are legitimate at medium/hard.
        stem: true,
        applyTemplates: false,
        reasoningFloor: { easy: 30, medium: 36, hard: 44 },
        minChars: { easy: 60, medium: 95, hard: 130 },
        minSentences: { easy: 1, medium: 1, hard: 2 },
    },
    competitive: {
        stem: true,
        applyTemplates: true,
        reasoningFloor: { easy: 34, medium: 42, hard: 50 },
        minChars: { easy: 70, medium: 110, hard: 150 },
        minSentences: { easy: 1, medium: 2, hard: 3 },
    },
    // Non-STEM / verbal — judged on their own rubrics, not STEM depth.
    clat: { stem: false },
    cat: { stem: false },
    upsc: { stem: false },
    board: { stem: false },
};

export const getDifficultyCalibration = (examProfile) =>
    DIFFICULTY_PROFILE_CALIBRATION[String(examProfile || "").toLowerCase()] ||
    DIFFICULTY_PROFILE_CALIBRATION.competitive;

/** Issues that indicate an obvious template drill — block at generation time. */
const TEMPLATE_DRILL_ISSUE_RE =
    /plug-in|numerical drill|one-formula|one-step|definition-recall|chapter-test|template|too easy for medium/i;

export const isBlockingDifficultyIssue = (issueText = "") =>
    TEMPLATE_DRILL_ISSUE_RE.test(String(issueText || ""));

/**
 * @param {object} q
 * @returns {{ issue: object|null, blocking: boolean }}
 */
export const detectDifficultyIssue = (q, ctx = {}) => {
    const issue = detectTooEasyForTier(q, ctx);
    if (!issue) return { issue: null, blocking: false };

    const stem = String(q.questionText || q.text || "").trim();
    const solveSteps = q.solveSteps || q._solveSteps;
    const stepCount = Array.isArray(solveSteps) ? solveSteps.length : 0;
    const tier = normalizeQuestionTier(ctx.assignedTier || q.difficultyTier) || "medium";

    // Rich multi-step work → soften structural flags (not template drills)
    if (
        stepCount >= (tier === "hard" ? 4 : 3) &&
        !isBlockingDifficultyIssue(issue.issue)
    ) {
        return { issue, blocking: false };
    }

    // Long, multi-sentence stems with linked setup → soften multi-condition flag
    if (
        issue.issue?.includes("multi-condition") &&
        (MULTI_STEP_MARKERS.test(stem) ||
            stem.length >= (MIN_STEM_CHARS[tier] || 130) - 15)
    ) {
        return { issue, blocking: false };
    }

    const blocking =
        isBlockingDifficultyIssue(issue.issue) ||
        issue.issue?.includes("solve step") ||
        issue.issue?.includes("too short") && stem.length < (MIN_STEM_CHARS[tier] || 130) - 30;

    return { issue, blocking };
};

/**
 * @param {object} q — audit shape with questionText, sampleNumber, difficultyTier?
 * @param {object} ctx
 */
export const detectTooEasyForTier = (
    q,
    {
        assignedTier = "medium",
        bankDifficulty = "medium",
        examProfile = "competitive",
        examCalibrated = false,
    } = {}
) => {
    const tier = normalizeQuestionTier(assignedTier) || "medium";
    const bank = normalizeBankDifficulty(bankDifficulty);
    const stem = String(q.questionText || q.text || "").trim();
    // Theory (conceptual) and direct (single-formula numerical) items are not
    // peak-hard drills — the too-easy templates, multi-step-marker requirement, and
    // solve-step count all assume multi-step computation and would wrongly strip
    // valid theory/direct questions. A direct item is *meant* to be single-step;
    // theory has no computation. multi_concept keeps the full checks below.
    const kind = String(q._questionKind || q.questionKind || "").toLowerCase();
    if (kind === "theory" || kind === "direct") return null;

    // Exam-type-aware calibration: verbal/reasoning exams (CLAT, CAT, UPSC,
    // board) skip the STEM difficulty heuristics entirely; STEM exams get floors
    // scaled to how they actually test (see DIFFICULTY_PROFILE_CALIBRATION).
    const cal = getDifficultyCalibration(examProfile);
    if (!stem || !cal.stem) return null;

    if (cal.applyTemplates) {
        for (const tpl of TOO_EASY_TEMPLATES) {
            const maxTier = examCalibrated
                ? tier === "hard"
                    ? "medium"
                    : tpl.maxTier
                : tpl.maxTier;
            if (tpl.re.test(stem) && tierTooLow(tier, maxTier)) {
                return {
                    questionNumber: q.sampleNumber,
                    issue: tpl.message,
                    severity:
                        tier === "hard" || bank === "hard" ? "major" : "minor",
                    confidence: "confirmed",
                    category: ISSUE_CATEGORY.DIFFICULTY,
                };
            }
        }
    }

    const minChars = cal.minChars?.[tier] || MIN_STEM_CHARS[tier] || MIN_STEM_CHARS.medium;
    if (stem.length < minChars) {
        return {
            questionNumber: q.sampleNumber,
            issue: `Stem too short (${stem.length} chars) for ${tier}-tier upscaled calibration (need ~${minChars}+).`,
            severity: tier === "hard" ? "major" : "minor",
            confidence: "confirmed",
            category: ISSUE_CATEGORY.DIFFICULTY,
        };
    }

    const sentences = countSentences(stem);
    const minSent = cal.minSentences?.[tier] || MIN_SENTENCES[tier] || 2;
    if (sentences < minSent) {
        return {
            questionNumber: q.sampleNumber,
            issue: `Only ${sentences} setup sentence(s) for ${tier}-tier — need ${minSent}+ with conditions/constraints.`,
            severity: tier === "hard" ? "major" : "minor",
            confidence: "confirmed",
            category: ISSUE_CATEGORY.DIFFICULTY,
        };
    }

    if (
        cal.applyTemplates &&
        tier === "hard" &&
        !MULTI_STEP_MARKERS.test(stem) &&
        !/(?:lens|mirror|passage|system|loop.*field|convex.*concave|placed|combination|respectively|accelerated|ratio|magnetic field|refractive|wavelength|inclined|rolling|pulley|interference|entropy|adiabatic|isothermal)/i.test(
            stem
        )
    ) {
        return {
            questionNumber: q.sampleNumber,
            issue:
                "Hard-tier item lacks multi-condition / multi-concept setup — reads like single-template drill.",
            severity: "major",
            confidence: "confirmed",
            category: ISSUE_CATEGORY.DIFFICULTY,
        };
    }

    if (bank === "hard" && tier !== "easy") {
        const solveSteps = q.solveSteps || q._solveSteps;
        if (Array.isArray(solveSteps) && solveSteps.length > 0) {
            const minSteps = MIN_SOLVE_STEPS[tier] || 3;
            if (solveSteps.length < minSteps) {
                return {
                    questionNumber: q.sampleNumber,
                    issue: `Only ${solveSteps.length} solve step(s) for ${tier}-tier on hard bank (need ≥${minSteps}).`,
                    severity: "major",
                    confidence: "confirmed",
                    category: ISSUE_CATEGORY.DIFFICULTY,
                };
            }
        }
    }

    const reasoningDepth = scoreReasoningDepth(q);
    const depthFloor =
        cal.reasoningFloor?.[tier] ||
        REASONING_DEPTH_FLOOR[tier] ||
        REASONING_DEPTH_FLOOR.medium;
    if (reasoningDepth < depthFloor) {
        return {
            questionNumber: q.sampleNumber,
            issue: `Low reasoning depth (${reasoningDepth}/100) for ${tier}-tier — lacks hidden constraints, multi-concept linkage, or indirect inference (need ≥${depthFloor}).`,
            severity: tier === "hard" ? "major" : "minor",
            confidence: "confirmed",
            category: ISSUE_CATEGORY.DIFFICULTY,
        };
    }

    return null;
};

/**
 * @param {Array<object>} sampled — items with sampleNumber, questionText, optional difficultyTier
 */
export const runDeterministicDifficultyAudit = (
    sampled = [],
    {
        bankDifficulty = "medium",
        examProfile = "competitive",
        examCalibrated = false,
        tierSlots = [],
        subject = "",
    } = {}
) => {
    const confirmedIssues = [];
    const seen = new Set();

    sampled.forEach((q, i) => {
        const assignedTier =
            normalizeQuestionTier(q.difficultyTier || q.difficulty) ||
            tierSlots[i] ||
            "medium";
        const primary = detectTooEasyForTier(q, {
            assignedTier,
            bankDifficulty,
            examProfile,
            examCalibrated,
        });
        if (primary) {
            const key = `${primary.questionNumber}::${primary.issue}`;
            if (!seen.has(key)) {
                seen.add(key);
                confirmedIssues.push(primary);
            }
        }

        for (const extra of detectHardMandateIssues(q, {
            assignedTier,
            examCalibrated,
            examProfile,
            subject,
        })) {
            const key = `${extra.questionNumber}::${extra.issue}`;
            if (seen.has(key)) continue;
            seen.add(key);
            confirmedIssues.push(extra);
        }
    });

    const dimensional = computeSeparatedValidationScores(confirmedIssues);

    return {
        confirmedIssues: dimensional.tagged,
        difficultyIssues: dimensional.difficultyIssues,
        difficultyMatchScore: dimensional.difficultyMatchScore ?? 100,
    };
};

export const findDifficultyFlawedSampleNumbers = (
    sampled = [],
    ctx = {}
) => {
    const audit = runDeterministicDifficultyAudit(sampled, ctx);
    const flawed = new Set(
        (audit.difficultyIssues || [])
            .filter((i) =>
                ["critical", "major"].includes(
                    String(i.severity || "major").toLowerCase()
                )
            )
            .map((i) => i.questionNumber)
    );
    return { audit, flawedNumbers: flawed };
};

/** Remove standalone questions that fail major difficulty checks (initial generation). */
export const stripDifficultyFlawedQuestionBankEntries = (
    questions = [],
    ctx = {}
) => {
    const entries = flattenQuestionBankForCorrectnessAudit(questions);
    const sampled = entries.map((e) => {
        const { topIndex, subIndex } = e.ref;
        const q = questions[topIndex];
        const tier =
            subIndex != null
                ? q.subQuestions?.[subIndex]?.difficulty
                : q.difficulty;
        return {
            ...e.auditItem,
            difficultyTier: tier,
            _solveSteps: q._solveSteps,
            _questionKind: q._questionKind || q.questionKind,
        };
    });

    const { audit, flawedNumbers } = findDifficultyFlawedSampleNumbers(sampled, ctx);
    if (!flawedNumbers.size) {
        return { questions, strippedCount: 0, audit };
    }

    const flawedTop = new Set();
    for (const entry of entries) {
        if (flawedNumbers.has(entry.auditItem.sampleNumber)) {
            if (entry.ref.subIndex == null) flawedTop.add(entry.ref.topIndex);
        }
    }

    const kept = questions.filter((_, i) => !flawedTop.has(i));
    return {
        questions: kept,
        strippedCount: flawedTop.size,
        audit,
    };
};

export default {
    INITIAL_GEN_DIFFICULTY_MATCH_TARGET,
    scoreReasoningDepth,
    detectTooEasyForTier,
    detectDifficultyIssue,
    isBlockingDifficultyIssue,
    runDeterministicDifficultyAudit,
    findDifficultyFlawedSampleNumbers,
};
