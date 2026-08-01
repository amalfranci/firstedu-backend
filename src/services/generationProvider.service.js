import { ApiError } from "../utils/ApiError.js";

export const GENERATION_PROVIDER_IDS = ["gemini", "openai", "claude"];

/**
 * Providers permitted at runtime. Default is OpenAI + Gemini only — the Claude
 * route currently 404s on model resolution (see scripts/smoke_test_models.mjs),
 * so leaving it selectable silently degraded generation to a dead provider.
 *
 * Claude is NOT removed: the admin model-picker route still lists it. To turn it
 * back on once the model map is fixed:
 *     AI_QB_ALLOWED_PROVIDERS=openai,gemini,claude
 */
const DEFAULT_ALLOWED_PROVIDERS = ["openai", "gemini"];

export const getAllowedGenerationProviders = () => {
    const raw = String(process.env.AI_QB_ALLOWED_PROVIDERS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => GENERATION_PROVIDER_IDS.includes(s));
    return raw.length ? raw : DEFAULT_ALLOWED_PROVIDERS;
};

export const isGenerationProviderAllowed = (provider) =>
    getAllowedGenerationProviders().includes(
        String(provider || "").trim().toLowerCase()
    );

/** First allowed provider that actually has a key — used when one is disallowed. */
const firstUsableAllowedProvider = () => {
    const allowed = getAllowedGenerationProviders();
    for (const p of allowed) {
        if (p === "openai" && process.env.OPENAI_API_KEY) return p;
        if (p === "gemini" && process.env.GEMINI_API_KEY) return p;
        if (p === "claude" && getAnthropicApiKey()) return p;
    }
    return allowed[0] || "openai";
};

/** @param {string} [provider] */
export const normalizeGenerationProvider = (provider) => {
    const raw = String(provider || "").trim().toLowerCase();
    const p =
        raw === "openai" || raw === "claude" || raw === "gemini" ? raw : "gemini";
    // Redirect a disallowed provider instead of returning a dead route.
    if (!isGenerationProviderAllowed(p)) return firstUsableAllowedProvider();
    return p;
};

export const assertGenerationProviderConfigured = (provider) => {
    const requested = String(provider || "").trim().toLowerCase();
    if (
        GENERATION_PROVIDER_IDS.includes(requested) &&
        !isGenerationProviderAllowed(requested)
    ) {
        throw new ApiError(
            500,
            `Generation provider "${requested}" is disabled. Allowed: ${getAllowedGenerationProviders().join(
                ", "
            )} (override with AI_QB_ALLOWED_PROVIDERS)`
        );
    }
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
 *
 * Ideal routing (budget-aware):
 *   solver / solver_b → OpenAI o-series when key present
 *   difficulty_judge / audit → GPT-4o family
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

    // Solver defaults to OpenAI (o-series) when available — calculation/reasoning gate.
    const preferOpenAi =
        stage === "solver" ||
        stage === "solver_b" ||
        stage === "difficulty_judge" ||
        stage === "audit";

    // Secondary solver: prefer a second OpenAI reasoning model when unset.
    const autoSecondary =
        stage === "solver_b" && !raw
            ? process.env.OPENAI_API_KEY
                ? "openai"
                : process.env.GEMINI_API_KEY
                  ? "gemini"
                  : fallback
            : null;

    const candidate = raw
        ? normalizeGenerationProvider(raw)
        : autoSecondary
          ? normalizeGenerationProvider(autoSecondary)
          : preferOpenAi && process.env.OPENAI_API_KEY
            ? "openai"
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

/**
 * Model id for a verification stage (OpenAI). Reasoning models for solver;
 * GPT-4o for final audit / difficulty judge.
 */
export const resolveVerificationStageModel = (stage = "solver") => {
    if (stage === "solver") {
        return (
            String(process.env.OPENAI_SOLVER_MODEL || process.env.AI_QB_SOLVER_MODEL || "")
                .trim() || "o3"
        );
    }
    if (stage === "solver_b") {
        return (
            String(
                process.env.OPENAI_SOLVER_MODEL_B ||
                    process.env.AI_QB_SOLVER_MODEL_B ||
                    ""
            ).trim() ||
            String(process.env.OPENAI_SOLVER_MODEL || "").trim() ||
            "o4-mini"
        );
    }
    if (stage === "difficulty_judge") {
        return (
            String(
                process.env.OPENAI_DIFFICULTY_JUDGE_MODEL ||
                    process.env.AI_QB_DIFFICULTY_JUDGE_MODEL ||
                    ""
            ).trim() ||
            String(process.env.OPENAI_AUDIT_MODEL || "").trim() ||
            "gpt-4o"
        );
    }
    if (stage === "audit") {
        return (
            String(process.env.OPENAI_AUDIT_MODEL || process.env.OPENAI_CORRECTNESS_AUDIT_MODEL || "")
                .trim() || "gpt-4o"
        );
    }
    return (
        String(process.env.OPENAI_QB_GENERATION_MODEL || process.env.OPENAI_CHAT_MODEL || "")
            .trim() || "gpt-4o-mini"
    );
};

/** True for OpenAI o-series / reasoning models that reject temperature + json_object quirks. */
export const isOpenAIReasoningModel = (model = "") =>
    /^(o[0-9]|o[0-9]-|gpt-5)/i.test(String(model || "").trim());

/**
 * reasoning_effort for o-series. Hard STEM → high; otherwise medium.
 * Override with OPENAI_REASONING_EFFORT=low|medium|high.
 */
export const resolveReasoningEffort = ({
    difficulty = "",
    subject = "",
    sectionName = "",
} = {}) => {
    const forced = String(process.env.OPENAI_REASONING_EFFORT || "")
        .trim()
        .toLowerCase();
    if (forced === "low" || forced === "medium" || forced === "high") {
        return forced;
    }
    // Default medium for reliability; set OPENAI_REASONING_EFFORT=high for max depth.
    const diff = String(difficulty || "").toLowerCase();
    const stem = `${subject || ""} ${sectionName || ""}`.toLowerCase();
    const hardStem =
        diff.includes("hard") &&
        /physics|chemistry|math|algebra|calculus|mathematics/.test(stem);
    return hardStem ? "high" : "medium";
};

/**
 * Solver model fallback: stay on reasoning models before gpt-4o.
 * Default: primary → o4-mini → o3-mini → (optional gpt-4o if AI_QB_SOLVER_ALLOW_GPT4O_FALLBACK=1)
 */
export const resolveSolverFallbackChain = (primaryModel = "o3") => {
    const primary = String(primaryModel || "o3").trim() || "o3";
    const envChain = String(process.env.OPENAI_SOLVER_FALLBACK_CHAIN || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const defaults = [
        String(process.env.OPENAI_SOLVER_FALLBACK_MODEL || "o4-mini").trim(),
        "o3-mini",
        "o4-mini",
    ].filter(Boolean);
    const allowGpt4o =
        process.env.AI_QB_SOLVER_ALLOW_GPT4O_FALLBACK === "1" ||
        process.env.AI_QB_SOLVER_ALLOW_GPT4O_FALLBACK === "true";
    const chain = [];
    const push = (m) => {
        if (m && !chain.includes(m)) chain.push(m);
    };
    push(primary);
    (envChain.length ? envChain : defaults).forEach(push);
    if (allowGpt4o) push("gpt-4o");
    return chain;
};
