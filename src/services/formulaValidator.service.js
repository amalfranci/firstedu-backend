/**
 * Phase C — Formula allow-list validator for Math / Physics topics.
 */

import { pipelineTrace } from "../utils/aiApiCallLogger.js";

/** Topic keyword → allowed formula name patterns (substring match, case-insensitive). */
export const FORMULA_ALLOWLIST = {
    kinematics: [
        "v=u+at",
        "s=ut",
        "v^2",
        "u^2+2as",
        "s=ut+1/2at^2",
        "average velocity",
    ],
    "projectile motion": [
        "range",
        "r=u^2sin",
        "h=u^2sin",
        "time of flight",
        "tmax",
    ],
    "circular motion": [
        "centripetal",
        "mv^2/r",
        "omega",
        "angular",
        "a=v^2/r",
    ],
    gravitation: [
        "newton",
        "gmm/r^2",
        "escape",
        "orbital",
        "kepler",
        "potential",
    ],
    electrostatics: [
        "coulomb",
        "kq1q2/r^2",
        "e=kq/r^2",
        "potential",
        "gauss",
        "capacitance",
    ],
    "current electricity": [
        "ohm",
        "v=ir",
        "kirchhoff",
        "power",
        "p=vi",
        "resist",
    ],
    magnetism: [
        "biot",
        "ampere",
        "f=ilb",
        "lorentz",
        "flux",
        "faraday",
        "lenz",
    ],
    optics: [
        "lens",
        "1/v-1/u=1/f",
        "mirror",
        "snell",
        "n1sin",
        "diffraction",
        "young",
        "interference",
    ],
    "modern physics": [
        "einstein",
        "photoelectric",
        "e=hf",
        "de broglie",
        "bohr",
        "half-life",
        "radioactive",
    ],
    thermodynamics: [
        "pv=nrt",
        "first law",
        "delta u=q-w",
        "carnot",
        "entropy",
        "enthalpy",
    ],
    "simple harmonic": ["shm", "omega=sqrt", "t=2pi", "energy", "amplitude"],
    integration: [
        "integral",
        "definite",
        "indefinite",
        "by parts",
        "substitution",
        "fundamental theorem",
    ],
    differentiation: [
        "derivative",
        "dy/dx",
        "chain rule",
        "product rule",
        "maxima",
        "minima",
    ],
    "quadratic equation": [
        "discriminant",
        "b^2-4ac",
        "roots",
        "sum of roots",
        "product of roots",
    ],
    probability: [
        "p(a)",
        "conditional",
        "bayes",
        "combination",
        "permutation",
        "binomial",
    ],
    matrices: ["determinant", "inverse", "adjoint", "eigen", "trace", "rank"],
    vectors: ["dot product", "cross product", "magnitude", "unit vector", "projection"],
};

const IMPOSSIBLE_PATTERNS = [
    /divide by zero/i,
    /1\/0\b/,
    /sin\s*\(\s*90\s*\+\s*i/i, // nonsense complex trig often hallucinated wrong
    /mass\s*=\s*0\s*kg.*acceleration/i,
];

export const isFormulaValidatorEnabled = () => {
    const flag = process.env.AI_QB_FORMULA_VALIDATOR;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const detectTopicKey = (topic = "", concept = "") => {
    const hay = `${topic} ${concept}`.toLowerCase();
    for (const key of Object.keys(FORMULA_ALLOWLIST)) {
        if (hay.includes(key)) return key;
    }
    return null;
};

/**
 * Soft validation: flag impossible equations; check allow-list presence when topic known.
 */
export const validateQuestionFormulas = (question = {}, { topic = "" } = {}) => {
    const text = [
        question.questionText,
        question.explanation,
        ...(question._solveSteps || []),
        question.concept || "",
        question._conceptSlot || "",
    ]
        .map(String)
        .join("\n");

    const issues = [];
    for (const re of IMPOSSIBLE_PATTERNS) {
        if (re.test(text)) {
            issues.push(`Impossible / invalid pattern: ${re}`);
        }
    }

    const topicKey = detectTopicKey(
        topic || question.topic || "",
        question._conceptSlot || question.concept || ""
    );
    let allowlistHit = null;
    if (topicKey) {
        const allowed = FORMULA_ALLOWLIST[topicKey] || [];
        const lower = text.toLowerCase().replace(/\s+/g, "");
        allowlistHit = allowed.some((f) =>
            lower.includes(String(f).toLowerCase().replace(/\s+/g, ""))
        );
        // Soft: only warn when explanation claims a formula but none match allow-list
        if (
            /\b(?:formula|equation|using)\b/i.test(text) &&
            !allowlistHit &&
            allowed.length
        ) {
            issues.push(
                `No allow-listed ${topicKey} formula markers found in solution`
            );
        }
    }

    return {
        ok: issues.length === 0,
        issues,
        topicKey,
        allowlistHit,
    };
};

export const runFormulaValidationPass = (questions = [], { topic = "" } = {}) => {
    if (!isFormulaValidatorEnabled()) {
        return { questions, rejected: [], checked: 0 };
    }
    const kept = [];
    const rejected = [];
    for (const q of questions) {
        const type = String(q?.questionType || "single").toLowerCase();
        if (type !== "single") {
            kept.push(q);
            continue;
        }
        const result = validateQuestionFormulas(q, { topic });
        if (!result.ok) {
            // Soft fail for allow-list miss; hard fail for impossible patterns
            const hard = result.issues.some((i) => /Impossible/i.test(i));
            if (hard) {
                rejected.push({ question: q, issues: result.issues });
                pipelineTrace("FORMULA_VALIDATOR_REJECT", {
                    issues: result.issues,
                    stem: String(q.questionText || "").slice(0, 80),
                });
                kept.push({
                    ...q,
                    _formulaValidation: result,
                    _verification: {
                        ...(q._verification || {}),
                        formulaOk: false,
                        status: "stripped",
                        ruleFailures: [
                            ...((q._verification?.ruleFailures) || []),
                            "formula_validation_failed",
                        ],
                    },
                });
                continue;
            }
            kept.push({
                ...q,
                _formulaValidation: result,
                _verification: {
                    ...(q._verification || {}),
                    formulaOk: true,
                },
            });
        } else {
            kept.push({
                ...q,
                _formulaValidation: result,
                _verification: {
                    ...(q._verification || {}),
                    formulaOk: true,
                },
            });
        }
    }
    pipelineTrace("FORMULA_VALIDATOR_DONE", {
        checked: questions.length,
        rejected: rejected.length,
    });
    return { questions: kept, rejected, checked: questions.length };
};
