/** Gemini text models for question generation (generateContent + JSON). */

/** Retired June 2026 — map old .env values to current models */
const RETIRED_GEMINI_TEXT_MODEL_ALIASES = {
    "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
    "gemini-2.0-flash-lite-001": "gemini-3.1-flash-lite",
    "gemini-2.0-flash": "gemini-2.5-flash-lite",
    "gemini-2.0-flash-001": "gemini-2.5-flash-lite",
    "gemini-1.5-flash": "gemini-2.5-flash-lite",
    "gemini-1.5-flash-001": "gemini-2.5-flash-lite",
    "gemini-1.5-flash-002": "gemini-2.5-flash-lite",
};

export const GEMINI_TEXT_MODEL_OPTIONS = [
    {
        id: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        traffic: "low",
        description:
            "Lowest latency and cost — recommended default (replaces 2.0 Flash Lite)",
    },
    {
        id: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash Lite",
        traffic: "low",
        description: "Lightweight 2.5 tier — good when 3.1 is unavailable",
    },
    {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        traffic: "high",
        description: "Higher quality MCQs; may hit capacity during peak hours",
    },
    {
        id: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        traffic: "medium",
        description: "Newer balanced model — quality between lite and 2.5 Flash",
    },
];

export const GEMINI_TEXT_MODEL_IDS = GEMINI_TEXT_MODEL_OPTIONS.map((m) => m.id);

/** Default tuned for availability; override with GEMINI_TEXT_MODEL in .env */
export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite";

/**
 * Hard / exam-calibrated generation must not use flash-lite — multi-step JEE
 * arithmetic error rates are too high. Override with GEMINI_HARD_TEXT_MODEL.
 * Prefer 3.5-flash when available; fall back to 2.5-flash.
 */
export const DEFAULT_GEMINI_HARD_TEXT_MODEL = "gemini-3.5-flash";

export const getGeminiTextModelOptions = () => GEMINI_TEXT_MODEL_OPTIONS;

export const getGeminiTextModelMeta = (modelId) =>
    GEMINI_TEXT_MODEL_OPTIONS.find((m) => m.id === modelId) || null;

const normalizeGeminiTextModelId = (modelId) => {
    const trimmed = String(modelId || "").trim();
    const mapped = RETIRED_GEMINI_TEXT_MODEL_ALIASES[trimmed];
    if (mapped && mapped !== trimmed) {
        console.warn(
            `[gemini] model "${trimmed}" is retired — using "${mapped}" instead`
        );
        return mapped;
    }
    return trimmed;
};

export const resolveGeminiTextModel = (requestedModel) => {
    const fallback = normalizeGeminiTextModelId(
        process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_TEXT_MODEL
    );
    const model = normalizeGeminiTextModelId(requestedModel || fallback);
    if (!GEMINI_TEXT_MODEL_IDS.includes(model)) {
        throw new Error(
            `Unsupported Gemini text model "${model}". Choose one of: ${GEMINI_TEXT_MODEL_IDS.join(", ")}`
        );
    }
    return model;
};

/**
 * Pick generation model by difficulty tier.
 * Hard / exam-calibrated → GEMINI_HARD_TEXT_MODEL (default gemini-3.5-flash).
 * Easy/medium → GEMINI_TEXT_MODEL (default flash-lite).
 */
export const resolveGeminiTextModelForTier = ({
    difficulty = "",
    examCalibrated = false,
    requestedModel = null,
} = {}) => {
    if (requestedModel) {
        try {
            return resolveGeminiTextModel(requestedModel);
        } catch {
            /* fall through */
        }
    }

    const tier = String(difficulty || "").toLowerCase();
    const needsHardModel =
        examCalibrated ||
        tier === "hard" ||
        tier.includes("hard") ||
        tier === "veteran";

    if (needsHardModel) {
        const hardCandidates = [
            process.env.GEMINI_HARD_TEXT_MODEL,
            DEFAULT_GEMINI_HARD_TEXT_MODEL,
            "gemini-2.5-flash",
            process.env.GEMINI_TEXT_MODEL,
            DEFAULT_GEMINI_TEXT_MODEL,
        ]
            .map((s) => normalizeGeminiTextModelId(s))
            .filter(Boolean);

        for (const candidate of hardCandidates) {
            if (GEMINI_TEXT_MODEL_IDS.includes(candidate)) {
                return candidate;
            }
        }
    }

    return resolveGeminiTextModel();
};
