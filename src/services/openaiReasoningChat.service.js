/**
 * OpenAI Chat Completions helpers tuned for o-series reasoning models.
 * - No temperature on reasoning models
 * - reasoning_effort: low|medium|high
 * - developer role (not system) for JSON instructions
 * - Fail-fast timeout (default 45s) + reasoning-model fallback chain
 */

import axios from "axios";
import { ApiError } from "../utils/ApiError.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import {
    isOpenAIReasoningModel,
    resolveSolverFallbackChain,
} from "./generationProvider.service.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Solver timeout. Default is fail-fast (45s) for short Main/UI calls.
 * Hard JEE Advanced Luna verify can take 1–3 min at high reasoning_effort.
 * Paper pipeline sets OPENAI_VERIFY_TIMEOUT_MS (falls back to OPENAI_SOLVER_TIMEOUT_MS).
 * Cap 300s so a stuck call cannot hang forever.
 */
export const getOpenAISolverTimeoutMs = () =>
    Math.max(
        10_000,
        Math.min(
            300_000,
            Number(process.env.OPENAI_SOLVER_TIMEOUT_MS || 45_000)
        )
    );

const ALLOWED_REASONING_EFFORT = new Set([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]);

export const buildOpenAIChatBody = ({
    model,
    prompt,
    temperature = 0.2,
    reasoningEffort,
    jsonMode = false,
    maxCompletionTokens,
    developerHint,
}) => {
    const reasoning = isOpenAIReasoningModel(model);
    const effort = String(reasoningEffort || "medium").toLowerCase();
    const body = { model };

    if (reasoning) {
        body.max_completion_tokens = Number(
            maxCompletionTokens ||
                process.env.OPENAI_SOLVER_MAX_TOKENS ||
                8000
        );
        if (ALLOWED_REASONING_EFFORT.has(effort)) {
            body.reasoning_effort = effort;
        }
        const hint =
            developerHint ||
            (jsonMode
                ? "Return ONLY valid JSON. No markdown fences, no commentary. Do not re-evaluate or self-correct mid-answer."
                : "Follow the user instructions exactly. Be concise.");
        body.messages = [
            { role: "developer", content: hint },
            { role: "user", content: String(prompt || "") },
        ];
    } else {
        body.temperature = temperature;
        body.messages = [{ role: "user", content: String(prompt || "") }];
        if (jsonMode) {
            body.response_format = { type: "json_object" };
        }
    }
    return body;
};

export const extractOpenAIChatText = (response) => {
    const msg = response?.data?.choices?.[0]?.message || {};
    return String(msg.content || msg.refusal || "").trim();
};

const postChat = async (apiKey, body, timeout) =>
    axios.post(OPENAI_CHAT_URL, body, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        timeout,
    });

export const extractOpenAIChatUsage = (response) => {
    const u = response?.data?.usage || {};
    const details = u.completion_tokens_details || {};
    return {
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        totalTokens: Number(u.total_tokens) || 0,
        reasoningTokens: Number(details.reasoning_tokens) || 0,
    };
};

const packJsonResult = (text, response, usedModel, { withUsage } = {}) => {
    if (withUsage) {
        return {
            text,
            usage: extractOpenAIChatUsage(response),
            model: usedModel,
        };
    }
    return text;
};

/**
 * JSON-mode chat with o-series-safe params + reasoning-model fallback chain.
 */
export const callOpenAIReasoningJson = async ({
    apiKey,
    prompt,
    model,
    reasoningEffort = "medium",
    callWithRetries,
    toError,
    timeoutMs,
    withUsage = false,
    disableFallback = false,
    maxCompletionTokens,
    developerHint,
}) => {
    if (!apiKey) {
        throw new ApiError(500, "OpenAI API key is not configured (OPENAI_API_KEY)");
    }
    const effort = String(reasoningEffort || "medium").toLowerCase();
    const primary = String(model || "gpt-5.6-luna").trim();
    const tryModels =
        disableFallback || !isOpenAIReasoningModel(primary)
            ? [primary]
            : resolveSolverFallbackChain(primary);
    const timeout = timeoutMs || getOpenAISolverTimeoutMs();

    let lastError = null;
    for (const candidate of tryModels) {
        try {
            const body = buildOpenAIChatBody({
                model: candidate,
                prompt,
                temperature: 0,
                reasoningEffort: effort,
                jsonMode: true,
                maxCompletionTokens,
                developerHint,
            });
            const response = await callWithRetries(() =>
                postChat(apiKey, body, timeout)
            );
            const text = extractOpenAIChatText(response);
            if (!text) {
                throw new ApiError(500, "OpenAI returned empty response");
            }
            if (candidate !== primary) {
                pipelineTrace("OPENAI_SOLVER_MODEL_FALLBACK", {
                    from: primary,
                    to: candidate,
                    reasoning_effort: body.reasoning_effort || null,
                    timeoutMs: timeout,
                });
            }
            return packJsonResult(text, response, candidate, { withUsage });
        } catch (error) {
            lastError = error;
            const msg = String(
                error?.response?.data?.error?.message ||
                    error?.message ||
                    error ||
                    ""
            );
            const isTimeout = /timeout|aborted|ECONNABORTED/i.test(msg);

            // developer role not accepted → retry user-only
            if (/developer|unsupported.*role|unknown.*role/i.test(msg)) {
                try {
                    const fallbackBody = {
                        model: candidate,
                        max_completion_tokens: Number(
                            maxCompletionTokens ||
                                process.env.OPENAI_SOLVER_MAX_TOKENS ||
                                8000
                        ),
                        messages: [
                            {
                                role: "user",
                                content: `${prompt}\n\nReturn ONLY valid JSON. No markdown fences.`,
                            },
                        ],
                    };
                    if (
                        isOpenAIReasoningModel(candidate) &&
                        ALLOWED_REASONING_EFFORT.has(effort) &&
                        effort !== "none"
                    ) {
                        fallbackBody.reasoning_effort = effort;
                    } else if (!isOpenAIReasoningModel(candidate)) {
                        fallbackBody.response_format = { type: "json_object" };
                        fallbackBody.temperature = 0;
                        delete fallbackBody.max_completion_tokens;
                    }
                    const response = await callWithRetries(() =>
                        postChat(apiKey, fallbackBody, timeout)
                    );
                    const text = extractOpenAIChatText(response);
                    if (text) return packJsonResult(text, response, candidate, { withUsage });
                } catch (err2) {
                    lastError = err2;
                }
            }

            if (/reasoning_effort/i.test(msg)) {
                try {
                    const noEffort = buildOpenAIChatBody({
                        model: candidate,
                        prompt,
                        jsonMode: true,
                        maxCompletionTokens,
                    });
                    delete noEffort.reasoning_effort;
                    const response = await callWithRetries(() =>
                        postChat(apiKey, noEffort, timeout)
                    );
                    const text = extractOpenAIChatText(response);
                    if (text) return packJsonResult(text, response, candidate, { withUsage });
                } catch (err3) {
                    lastError = err3;
                }
            }

            const retryable =
                isTimeout ||
                /model|not found|does not exist|unsupported|404|invalid_request|reasoning_effort|developer|role/i.test(
                    msg
                );
            if (!retryable || candidate === tryModels[tryModels.length - 1]) {
                throw toError(lastError || error);
            }
            pipelineTrace("OPENAI_SOLVER_MODEL_RETRY", {
                from: candidate,
                error: msg.slice(0, 160),
                timeoutMs: timeout,
            });
        }
    }
    throw toError(lastError);
};

export const callOpenAIReasoningText = async ({
    apiKey,
    prompt,
    model,
    temperature = 0.2,
    reasoningEffort = "medium",
    callWithRetries,
    toError,
    timeoutMs,
}) => {
    if (!apiKey) {
        throw new ApiError(500, "OpenAI API key is not configured (OPENAI_API_KEY)");
    }
    const timeout = timeoutMs || getOpenAISolverTimeoutMs();
    const body = buildOpenAIChatBody({
        model,
        prompt,
        temperature,
        reasoningEffort,
        jsonMode: false,
    });
    try {
        const response = await callWithRetries(() =>
            postChat(apiKey, body, timeout)
        );
        const text = extractOpenAIChatText(response);
        if (!text) {
            throw new ApiError(500, "OpenAI returned empty response");
        }
        return text;
    } catch (error) {
        throw toError(error);
    }
};
