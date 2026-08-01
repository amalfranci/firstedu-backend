/**
 * Weighted difficulty score (0–100) from measurable factors.
 *
 * Factor                    Weight   What is measured
 * ────────────────────────  ──────   ─────────────────────────────────────
 * Concept Difficulty        15%      Basic vs advanced concept markers
 * Number of Concepts        15%      Single vs multi-concept / fusion
 * Reasoning Depth           20%      Logical steps, constraints, inference
 * Calculation Complexity    15%      Length / nested ops / multi-stage calc
 * Trickiness / Insight      15%      Key observation / identity / case split
 * Option Quality            10%      Plausible, distinct distractors
 * Estimated Time            10%      Expected JEE solve time proxy
 *
 * Used as a deterministic gate + diagnostic breakdown. LLM self-audit remains
 * the holistic judge; this score is the measurable floor / report surface.
 */

import { normalizeQuestionTier } from "./difficultyMix.service.js";

/** Weights must sum to 1. */
export const DIFFICULTY_FACTOR_WEIGHTS = Object.freeze({
    conceptDifficulty: 0.15,
    numberOfConcepts: 0.15,
    reasoningDepth: 0.2,
    calculationComplexity: 0.15,
    trickinessInsight: 0.15,
    optionQuality: 0.1,
    estimatedTime: 0.1,
});

/** Minimum total (0–100) to pass deterministic weighted gate by assigned tier. */
export const WEIGHTED_DIFFICULTY_FLOORS = Object.freeze({
    easy: Number(process.env.AI_QB_WEIGHTED_DIFF_FLOOR_EASY || 32),
    medium: Number(process.env.AI_QB_WEIGHTED_DIFF_FLOOR_MEDIUM || 48),
    hard: Number(process.env.AI_QB_WEIGHTED_DIFF_FLOOR_HARD || 70),
});

/** Env kill-switch (default ON). */
export const isWeightedDifficultyScoreEnabled = () => {
    const flag = process.env.AI_QB_WEIGHTED_DIFFICULTY_SCORE;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

const getStem = (q = {}) =>
    String(q.questionText || q.text || q.stem || "").trim();

const getOptions = (q = {}) => {
    const opts = q.options || q.choices || [];
    if (!Array.isArray(opts)) return [];
    return opts.map((o) => {
        if (o == null) return "";
        if (typeof o === "string") return o.trim();
        return String(o.text || o.label || o.value || "").trim();
    });
};

const getSolveSteps = (q = {}) => {
    let steps = q.solveSteps || q._solveSteps || [];
    if (!Array.isArray(steps) || !steps.length) {
        const expl = String(q.explanation || "").trim();
        if (expl) {
            steps = expl
                .split(/(?<=[.!?])\s+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 12);
        }
    }
    return (Array.isArray(steps) ? steps : []).map((s) => String(s || "").trim()).filter(Boolean);
};

const countNumericGivens = (text = "") => {
    const matches =
        String(text || "").match(
            /\d+(?:\.\d+)?(?:\s*(?:×|x|\*)\s*10\s*(?:\^|⁻)?[-−]?\d+|\s*\/\s*\d+)?/gi
        ) || [];
    return new Set(matches.map((m) => m.replace(/\s+/g, "").toLowerCase())).size;
};

// ── Concept difficulty (basic vs advanced) ──────────────────────────────────

const BASIC_CONCEPT_RE =
    /\b(?:definition of|simply|directly|find the value of|evaluate|compute|calculate the|basic|standard form of|first principles only)\b/i;

const ADVANCED_CONCEPT_RE =
    /\b(?:locus|family of|parameter|piecewise|implicit|integrating factor|skew|triple product|bayes|conditional|general solution|principal value|adjoint|consistency|homogeneous|king'?s property|partial fraction|logarithmic differentiation|multi[- ]?angle|coplanarity|equivalence relation|onto functions?|discriminant)\b/i;

const ADVANCED_MATH_MARKERS =
    /\b(?:case\s*(?:i|ii|1|2)|λ|lambda|parameter|constraint|simultaneously|respectively|under the condition)\b/i;

export const scoreConceptDifficulty = (q = {}) => {
    const stem = getStem(q);
    const steps = getSolveSteps(q).join(" ");
    const hay = `${stem}\n${steps}`;
    let score = 40;

    if (BASIC_CONCEPT_RE.test(stem) && !ADVANCED_CONCEPT_RE.test(stem)) score -= 18;
    if (ADVANCED_CONCEPT_RE.test(hay)) score += 28;
    if (ADVANCED_MATH_MARKERS.test(hay)) score += 12;
    if (/\b(?:and then|first .+ then|using .+ and)\b/i.test(stem)) score += 10;
    if (stem.length >= 220) score += 8;
    if (stem.length < 90) score -= 12;
    if (q._conceptFusion || q.conceptFusion) score += 8;

    // Easy-template penalty (align with hard ban list spirit)
    if (
        /lim\s*.*sin.*\/\s*x|centre and radius|C\(\s*\d+\s*,\s*\d+\s*\)|sin\s*\(?\s*30|order and degree only/i.test(
            stem
        )
    ) {
        score -= 25;
    }

    return clamp100(score);
};

// ── Number of concepts ──────────────────────────────────────────────────────

const CONCEPT_CLUSTER_RES = [
    { id: "limits", re: /\b(limit|indeterminate|lhl|rhl|continuity)\b/i },
    { id: "derivatives", re: /\b(derivative|differentiat|dy\/dx|maxima|minima|tangent|implicit)\b/i },
    { id: "integrals", re: /\b(integral|integrat|antiderivative|area bounded|by parts)\b/i },
    { id: "coord", re: /\b(circle|parabola|ellipse|hyperbola|locus|chord|straight line|coordinate)\b/i },
    { id: "matrices", re: /\b(matrix|matrices|determinant|adjoint|inverse)\b/i },
    { id: "de", re: /\b(differential equation|integrating factor|homogeneous|variable separable)\b/i },
    { id: "trig", re: /\b(trigonometr|sin|cos|tan|identity|multi[- ]?angle)\b/i },
    { id: "series", re: /\b(sequence|series|arithmetic|geometric|binomial)\b/i },
    { id: "complex", re: /\b(complex|argand|modulus|argument)\b/i },
    { id: "vectors", re: /\b(vector|dot product|cross product|triple product)\b/i },
    { id: "3d", re: /\b(direction cosine|skew|three dimensional|3d)\b/i },
    { id: "prob", re: /\b(probability|bayes|permutation|combination|conditional)\b/i },
    { id: "sets", re: /\b(sets?|relation|function|one[- ]one|onto|bijective)\b/i },
    { id: "phys_energy", re: /\b(energy|work|power|kinetic|potential)\b/i },
    { id: "phys_em", re: /\b(magnetic|electric|emf|capacitor|circuit)\b/i },
    { id: "phys_mech", re: /\b(friction|torque|momentum|collision|projectile)\b/i },
];

export const scoreNumberOfConcepts = (q = {}) => {
    const stem = getStem(q);
    const fusion = String(q._conceptFusion || q.conceptFusion || "");
    const steps = getSolveSteps(q).join(" ");
    const hay = `${stem}\n${fusion}\n${steps}`;

    const hits = CONCEPT_CLUSTER_RES.filter((c) => c.re.test(hay)).map((c) => c.id);
    const unique = new Set(hits);
    // Also count explicit fusion separators
    const fusionParts = fusion
        ? fusion.split(/\+|\/|&|\band\b|,/i).map((s) => s.trim()).filter((s) => s.length > 2)
        : [];
    const n = Math.max(unique.size, fusionParts.length || 0);

    let score = 20;
    if (n <= 0) score = 25;
    else if (n === 1) score = 38;
    else if (n === 2) score = 72;
    else if (n === 3) score = 88;
    else score = 96;

    if (/\b(?:simultaneously|linked|combined|coupled|fusion|both .+ and)\b/i.test(stem)) {
        score = Math.min(100, score + 8);
    }
    // multi_concept tag only boosts when stem/fusion actually shows ≥2 clusters
    if (
        String(q._questionKind || q.questionKind || "").toLowerCase() === "multi_concept" &&
        n >= 2
    ) {
        score = Math.max(score, 70);
    }
    if (String(q._questionKind || q.questionKind || "").toLowerCase() === "direct") {
        score = Math.min(score, 50);
    }

    return clamp100(score);
};

// ── Reasoning depth ─────────────────────────────────────────────────────────

const HIDDEN_CONSTRAINT_RE =
    /\b(?:neglect|ignore|assume|ideal|provided that|given that|only when|unless|approximat|small angle|initially|at rest|piecewise)\b/i;
const MULTI_STEP_RE =
    /\b(?:first|then|next|after|hence|therefore|thus|substitut|rearrang|equating|combining|case)\b/i;
const INDIRECT_RE =
    /\b(?:infer|deduce|imply|must be|cannot be|which of the following|consistent with|not possible)\b/i;
const MULTI_CONCEPT_RE =
    /\b(?:and|while|simultaneously|both|combined|linked|respectively|using .+ and)\b/i;

export const scoreReasoningDepthFactor = (q = {}) => {
    const stem = getStem(q);
    const steps = getSolveSteps(q);
    const stepText = steps.join(" ");
    let score = 28;

    if (HIDDEN_CONSTRAINT_RE.test(stem)) score += 16;
    if (MULTI_CONCEPT_RE.test(stem)) score += 14;
    if (INDIRECT_RE.test(stem)) score += 12;
    if (MULTI_STEP_RE.test(stem)) score += 10;
    if (steps.length >= 5) score += 16;
    else if (steps.length >= 4) score += 12;
    else if (steps.length >= 3) score += 8;
    else if (steps.length >= 2) score += 4;
    if (HIDDEN_CONSTRAINT_RE.test(stepText)) score += 6;
    if (INDIRECT_RE.test(stepText)) score += 5;
    if (q._conceptFusion || q.conceptFusion) score += 8;
    if (stem.length >= 180) score += 6;
    if (/single.?formula|plug.?in|direct substitution/i.test(stem)) score -= 14;

    return clamp100(score);
};

// ── Calculation complexity ──────────────────────────────────────────────────

export const scoreCalculationComplexity = (q = {}) => {
    const stem = getStem(q);
    const steps = getSolveSteps(q);
    const body = `${stem}\n${steps.join(" ")}`;
    const kind = String(q._questionKind || q.questionKind || "").toLowerCase();

    // Theory: low calc is fine — score on conceptual algebra in explanation only.
    if (kind === "theory") {
        const equals = (body.match(/=/g) || []).length;
        return clamp100(equals >= 2 ? 45 : 30);
    }

    let score = 22;
    const nums = countNumericGivens(stem);
    if (nums >= 5) score += 18;
    else if (nums >= 3) score += 12;
    else if (nums >= 2) score += 6;

    const equals = (body.match(/=/g) || []).length;
    if (equals >= 6) score += 18;
    else if (equals >= 4) score += 12;
    else if (equals >= 2) score += 6;

    // Nested algebra / multi-stage signals
    if (/[√∛∫∑]|sqrt|integral|determinant|matrix|cross product|partial fraction/i.test(body)) {
        score += 12;
    }
    if (/\^|²|³|frac|\\frac|\/\s*\(/i.test(body)) score += 6;
    if (steps.length >= 4) score += 12;
    else if (steps.length >= 3) score += 8;

    const totalStepChars = steps.reduce((a, s) => a + s.length, 0);
    if (totalStepChars >= 400) score += 10;
    else if (totalStepChars >= 220) score += 6;

    // Short plug-in
    if (steps.length <= 2 && equals <= 2 && nums <= 2) score -= 15;

    return clamp100(score);
};

// ── Trickiness / insight ────────────────────────────────────────────────────

const INSIGHT_RE =
    /\b(?:observe that|note that|key|clever|identity|trick|symmetric|complement|king'?s|property|without loss of generality|wlog|substitute u\s*=|let t\s*=|consider the|remarkable|non-obvious|hidden)\b/i;
const CASE_SPLIT_RE =
    /\b(?:case\s*(?:1|2|i|ii)|if .+ otherwise|when .+ when|two cases|three cases|depending on)\b/i;
const PARAMETER_RE =
    /\b(?:parameter|λ|lambda|for all|exists|find the range of|values of k|such that)\b/i;

export const scoreTrickinessInsight = (q = {}) => {
    const stem = getStem(q);
    const steps = getSolveSteps(q).join(" ");
    const hay = `${stem}\n${steps}`;
    let score = 30;

    if (INSIGHT_RE.test(hay)) score += 22;
    if (CASE_SPLIT_RE.test(hay)) score += 18;
    if (PARAMETER_RE.test(hay)) score += 14;
    if (HIDDEN_CONSTRAINT_RE.test(stem)) score += 10;
    if (/\b(?:not|except|incorrect|cannot|least|maximum|minimum)\b/i.test(stem)) score += 6;
    // Multi-constraint geometry / elimination often needs a key observation even without the word "observe"
    if (
        /\b(?:locus|eliminate|family of|chord of|mid[- ]?point|diameter|perpendicular to)\b/i.test(
            stem
        )
    ) {
        score += 16;
    }
    if (/direct plug|simply substitute|obviously/i.test(hay)) score -= 20;
    if (stem.length < 100 && getSolveSteps(q).length <= 2) score -= 15;

    return clamp100(score);
};

// ── Option quality ──────────────────────────────────────────────────────────

export const scoreOptionQuality = (q = {}) => {
    const options = getOptions(q);
    if (options.length < 2) {
        // Skeleton / pre-option stage — neutral mid score (not penalize hard stems early)
        return 55;
    }

    let score = 40;
    const nonempty = options.filter((o) => o.length > 0);
    if (nonempty.length >= 4) score += 15;
    else if (nonempty.length >= 3) score += 8;
    else score -= 20;

    const norm = nonempty.map((o) => o.replace(/\s+/g, " ").toLowerCase());
    const unique = new Set(norm);
    if (unique.size === nonempty.length) score += 15;
    else score -= 25;

    // Length diversity (plausible distractors usually similar form)
    const lens = nonempty.map((o) => o.length);
    const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
    const variance =
        lens.reduce((a, b) => a + (b - avg) ** 2, 0) / (lens.length || 1);
    if (avg >= 3 && variance < avg * avg * 4) score += 10; // not wild length scatter
    if (nonempty.every((o) => o.length >= 1 && o.length <= 80)) score += 8;

    // Placeholder / junk options
    if (nonempty.some((o) => /^(n\/a|none|xxx|todo|option\s*[a-d])$/i.test(o))) {
        score -= 30;
    }

    // Numeric proximity heuristic: if ≥2 options share similar magnitude → plausible
    const nums = nonempty
        .map((o) => {
            const m = o.match(/-?\d+(?:\.\d+)?/);
            return m ? Number(m[0]) : null;
        })
        .filter((n) => n != null && Number.isFinite(n));
    if (nums.length >= 3) {
        const sorted = [...nums].sort((a, b) => a - b);
        let closePairs = 0;
        for (let i = 1; i < sorted.length; i++) {
            const a = Math.abs(sorted[i]);
            const d = Math.abs(sorted[i] - sorted[i - 1]);
            if (d <= Math.max(1, 0.35 * (a || 1))) closePairs++;
        }
        if (closePairs >= 1) score += 12;
    }

    if (q._distractorPass) score += 8;

    return clamp100(score);
};

// ── Estimated time (JEE student proxy, minutes → 0–100 difficulty contrib) ───

/**
 * Estimate solve time in minutes for a prepared JEE student (heuristic).
 * Maps to difficulty contribution: longer → higher score contribution.
 */
export const estimateSolveTimeMinutes = (q = {}) => {
    const stem = getStem(q);
    const steps = getSolveSteps(q);
    const kind = String(q._questionKind || q.questionKind || "").toLowerCase();
    const tier = normalizeQuestionTier(q.difficultyTier || q.difficulty) || "";

    // Base on real work signals — do not inflate short textbook drills via tags alone.
    let mins = 0.9;
    mins += Math.min(2.0, stem.length / 180);
    mins += Math.min(2.2, steps.length * 0.35);
    mins += Math.min(1.0, countNumericGivens(stem) * 0.12);

    const fusion = String(q._conceptFusion || q.conceptFusion || "");
    const multiReal =
        kind === "multi_concept" &&
        (fusion.length > 8 ||
            ADVANCED_CONCEPT_RE.test(stem) ||
            stem.length >= 160 ||
            steps.length >= 4);
    if (multiReal) mins += 0.9;
    if (kind === "theory") mins = Math.max(0.9, mins * 0.75);
    if (kind === "direct") mins = Math.min(mins, 2.4);

    if (ADVANCED_CONCEPT_RE.test(stem)) mins += 0.5;
    if (CASE_SPLIT_RE.test(stem) || PARAMETER_RE.test(stem)) mins += 0.45;
    // Only nudge hard-tier if the stem already looks non-trivial
    if (tier === "hard" && (stem.length >= 140 || steps.length >= 3)) mins += 0.35;
    if (tier === "easy") mins = Math.min(mins, 2.2);

    // Classic one-liner drills
    if (stem.length < 80 && steps.length <= 2) mins = Math.min(mins, 1.5);

    return Math.round(Math.max(0.8, Math.min(8, mins)) * 10) / 10;
};

export const scoreEstimatedTime = (q = {}) => {
    const mins = estimateSolveTimeMinutes(q);
    // Map minutes → 0–100: ~1 min = easy, ~2–3 medium, ~3.5–5 hard, 6+ very hard
    if (mins <= 1.2) return 22;
    if (mins <= 1.8) return 38;
    if (mins <= 2.5) return 52;
    if (mins <= 3.2) return 65;
    if (mins <= 4.0) return 78;
    if (mins <= 5.0) return 88;
    return 95;
};

// ── Composite ───────────────────────────────────────────────────────────────

/**
 * @returns {{
 *   total: number,
 *   factors: Record<string, number>,
 *   weights: typeof DIFFICULTY_FACTOR_WEIGHTS,
 *   estimatedTimeMinutes: number,
 *   meetsFloor: boolean,
 *   floor: number,
 *   tier: string,
 *   breakdown: string
 * }}
 */
export const computeWeightedDifficultyScore = (q = {}, { assignedTier = "" } = {}) => {
    const tier =
        normalizeQuestionTier(assignedTier || q.difficultyTier || q.difficulty) ||
        "medium";

    const factors = {
        conceptDifficulty: scoreConceptDifficulty(q),
        numberOfConcepts: scoreNumberOfConcepts(q),
        reasoningDepth: scoreReasoningDepthFactor(q),
        calculationComplexity: scoreCalculationComplexity(q),
        trickinessInsight: scoreTrickinessInsight(q),
        optionQuality: scoreOptionQuality(q),
        estimatedTime: scoreEstimatedTime(q),
    };

    let total = 0;
    for (const [key, w] of Object.entries(DIFFICULTY_FACTOR_WEIGHTS)) {
        total += (factors[key] || 0) * w;
    }
    total = clamp100(total);

    const floor = WEIGHTED_DIFFICULTY_FLOORS[tier] ?? WEIGHTED_DIFFICULTY_FLOORS.medium;
    const estimatedTimeMinutes = estimateSolveTimeMinutes(q);
    const meetsFloor = total >= floor;

    const breakdown = Object.entries(factors)
        .map(([k, v]) => {
            const w = DIFFICULTY_FACTOR_WEIGHTS[k];
            return `${k}=${v}(×${Math.round(w * 100)}%→${Math.round(v * w)})`;
        })
        .join(" ");

    return {
        total,
        factors,
        weights: { ...DIFFICULTY_FACTOR_WEIGHTS },
        estimatedTimeMinutes,
        meetsFloor,
        floor,
        tier,
        breakdown,
    };
};

/**
 * Issue object for deterministic difficulty audit when below tier floor.
 * Returns null when disabled, when non-STEM theory skip, or when score meets floor.
 */
export const detectWeightedDifficultyIssue = (
    q = {},
    {
        assignedTier = "medium",
        examProfile = "",
        sampleNumber = null,
    } = {}
) => {
    if (!isWeightedDifficultyScoreEnabled()) return null;

    const kind = String(q._questionKind || q.questionKind || "").toLowerCase();
    // Direct slots on non-hard banks: don't force multi-concept weighted bar
    const tier = normalizeQuestionTier(assignedTier || q.difficultyTier) || "medium";
    if (kind === "direct" && tier !== "hard") return null;
    if (kind === "theory" && tier !== "hard") return null;

    const result = computeWeightedDifficultyScore(q, { assignedTier: tier });
    if (result.meetsFloor) return null;

    const weak = Object.entries(result.factors)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");

    return {
        questionNumber: sampleNumber ?? q.sampleNumber ?? q.questionNumber,
        issue: `Weighted difficulty ${result.total}/100 below ${tier}-tier floor ${result.floor} (weak: ${weak}; est. ~${result.estimatedTimeMinutes} min).`,
        severity: tier === "hard" ? "major" : "minor",
        confidence: "confirmed",
        category: "difficulty",
        weightedDifficulty: result,
    };
};

/** Compact prompt block for writer / auditor (optional inject). */
export const buildWeightedDifficultyRubricBlock = () => `
**WEIGHTED DIFFICULTY SCORE (0–100, deterministic factors):**
| Factor | Weight | Target for HARD |
|--------|--------|-----------------|
| Concept difficulty | 15% | Advanced / multi-condition concepts (not basic definition) |
| Number of concepts | 15% | ≥2 syllabus clusters fused |
| Reasoning depth | 20% | Hidden constraints + multi-step logic |
| Calculation complexity | 15% | Multi-stage algebra, not one plug-in |
| Trickiness / insight | 15% | Key observation, case split, or non-obvious identity |
| Option quality | 10% | 4 distinct plausible distractors |
| Estimated time | 10% | ~3.5–5+ min for a prepared JEE student |

Hard-tier floor ≈ **${WEIGHTED_DIFFICULTY_FLOORS.hard}/100**. Easy drills fail even if stem is long.
`;

export default {
    DIFFICULTY_FACTOR_WEIGHTS,
    WEIGHTED_DIFFICULTY_FLOORS,
    computeWeightedDifficultyScore,
    detectWeightedDifficultyIssue,
    estimateSolveTimeMinutes,
    isWeightedDifficultyScoreEnabled,
    buildWeightedDifficultyRubricBlock,
};
