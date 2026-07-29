import { ApiError } from "../utils/ApiError.js";

export const GENERATION_PROVIDER_IDS = ["gemini", "openai", "claude"];

/** @param {string} [provider] */
export const normalizeGenerationProvider = (provider) => {
    const p = String(provider || "gemini").trim().toLowerCase();
    if (p === "openai" || p === "claude") return p;
    return "gemini";
};

export const assertGenerationProviderConfigured = (provider) => {
    const p = normalizeGenerationProvider(provider);
    if (p === "gemini" && !process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "Gemini API key is not configured (GEMINI_API_KEY)");
    }
    if (p === "openai" && !process.env.OPENAI_API_KEY) {
        throw new ApiError(500, "OpenAI API key is not configured (OPENAI_API_KEY)");
    }
    if (p === "claude" && !getAnthropicApiKey()) {
        throw new ApiError(
            500,
            "Anthropic API key is not configured (ANTHROPIC_API_KEY)"
        );
    }
    return p;
};

/** Supports standard API key; optional OAuth token for local/dev tooling. */
export const getAnthropicApiKey = () =>
    String(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN || "").trim() ||
    null;

export const resolveGenerationTemperature = (
    provider,
    { genTemperature, openaiDefault = 0.15, defaultTemp = 0.1 } = {}
) => {
    if (genTemperature != null && Number.isFinite(Number(genTemperature))) {
        return Number(genTemperature);
    }
    return normalizeGenerationProvider(provider) === "openai"
        ? openaiDefault
        : defaultTemp;
};

export const generationProviderLabel = (provider) => {
    const p = normalizeGenerationProvider(provider);
    if (p === "openai") return "OpenAI";
    if (p === "claude") return "Claude";
    return "Gemini";
};

/**
 * Phase C9 — route generation provider by difficulty tier.
 * Env:
 *   AI_QB_EASY_PROVIDER=gemini
 *   AI_QB_MEDIUM_PROVIDER=claude
 *   AI_QB_HARD_PROVIDER=openai
 * Falls back to fallbackProvider when unset / key missing.
 */
export const resolveProviderForDifficulty = (
    difficulty = "hard",
    fallbackProvider = "gemini"
) => {
    const tier = String(difficulty || "hard").toLowerCase().trim();
    const envKey =
        tier === "easy"
            ? "AI_QB_EASY_PROVIDER"
            : tier === "medium"
              ? "AI_QB_MEDIUM_PROVIDER"
              : "AI_QB_HARD_PROVIDER";
    const raw = String(process.env[envKey] || "").trim().toLowerCase();
    const fallback = normalizeGenerationProvider(fallbackProvider);
    if (!raw) return fallback;
    try {
        return assertGenerationProviderConfigured(raw);
    } catch {
        return fallback;
    }
};

/**
 * Per-stage provider override (solver / difficulty_judge / audit).
 * Falls back to generation provider when unset or key missing.
 */
export const resolveVerificationStageProvider = (
    stage,
    fallbackProvider = "gemini"
) => {
    const fallback = normalizeGenerationProvider(fallbackProvider);
    const envKey =
        stage === "solver"
            ? "AI_QB_SOLVER_PROVIDER"
            : stage === "solver_b"
              ? "AI_QB_SOLVER_PROVIDER_B"
              : stage === "difficulty_judge"
                ? "AI_QB_DIFFICULTY_JUDGE_PROVIDER"
                : stage === "audit"
                  ? "AI_QB_AUDIT_PROVIDER"
                  : stage === "planner"
                    ? "AI_QB_PLANNER_PROVIDER"
                    : null;
    const raw = envKey
        ? String(process.env[envKey] || "").trim().toLowerCase()
        : "";
    // Secondary solver: prefer a different configured provider; skip Claude by
    // default (billing failures are common). Fall back to same provider (gemini).
    const autoSecondary =
        stage === "solver_b" && !raw
            ? fallback === "gemini"
                ? process.env.OPENAI_API_KEY
                    ? "openai"
                    : "gemini"
                : fallback === "openai"
                  ? process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
                      ? "gemini"
                      : "openai"
                  : process.env.OPENAI_API_KEY
                    ? "openai"
                    : process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
                      ? "gemini"
                      : fallback
            : null;
    const candidate = raw
        ? normalizeGenerationProvider(raw)
        : autoSecondary
          ? normalizeGenerationProvider(autoSecondary)
          : stage === "difficulty_judge" || stage === "audit"
            ? process.env.OPENAI_API_KEY
                ? "openai"
                : fallback
            : fallback;

    try {
        return assertGenerationProviderConfigured(candidate);
    } catch {
        try {
            return assertGenerationProviderConfigured(fallback);
        } catch {
            return fallback;
        }
    }
};
