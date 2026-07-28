/**
 * Shared Gemini embedding utility for RAG retrieval (question-corpus RAG, and
 * future topic-content RAG). Thin wrapper over genAI.models.embedContent —
 * own client instance (not the private one in aiQuestion.service.js), same
 * precedent as examReferenceResearch.service.js instantiating independently.
 *
 * This module is allowed to throw (ApiError) — fail-open behavior belongs to
 * the RAG retrieval services that call it, not baked in here.
 */

import { GoogleGenAI } from "@google/genai";
import { ApiError } from "../utils/ApiError.js";
import { resolveGeminiEmbeddingModel } from "./geminiEmbeddingModels.js";

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

/** Gemini embedContent hard limit — verified live: >100 contents in one call returns a 400. */
const MAX_EMBED_BATCH_SIZE = 100;

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

/** Embed a single string. Default taskType suits short query-like text. */
export const getEmbedding = async (text, { taskType = "RETRIEVAL_QUERY" } = {}) => {
    const values = await getEmbeddingsBatch([text], { taskType });
    return values[0];
};

const embedContentBatch = async (texts, taskType) => {
    const model = resolveGeminiEmbeddingModel();
    let response;
    try {
        response = await genAI.models.embedContent({
            model,
            contents: texts,
            config: { taskType },
        });
    } catch (err) {
        throw new ApiError(
            502,
            `Gemini embedContent call failed (model "${model}"): ${err?.message || err}`
        );
    }

    const embeddings = response?.embeddings || [];
    if (embeddings.length !== texts.length) {
        throw new ApiError(
            502,
            `Gemini embedContent returned ${embeddings.length} embeddings for ${texts.length} inputs.`
        );
    }
    return embeddings.map((e) => e?.values || []);
};

/**
 * Embed multiple strings, chunked to respect Gemini's ${MAX_EMBED_BATCH_SIZE}-per-call
 * limit. Default taskType suits corpus/document text — Gemini's asymmetric retrieval
 * embedding ranks better when documents are embedded with RETRIEVAL_DOCUMENT and
 * queries with RETRIEVAL_QUERY.
 */
export const getEmbeddingsBatch = async (texts = [], { taskType = "RETRIEVAL_DOCUMENT" } = {}) => {
    if (!process.env.GEMINI_API_KEY) {
        throw new ApiError(500, "GEMINI_API_KEY is not configured — embedding unavailable.");
    }
    const cleaned = (texts || []).map((t) => String(t ?? "").trim()).filter(Boolean);
    if (!cleaned.length) return [];

    const batches = chunk(cleaned, MAX_EMBED_BATCH_SIZE);
    const results = [];
    for (const batch of batches) {
        results.push(...(await embedContentBatch(batch, taskType)));
    }
    return results;
};

/** Cosine similarity between two equal-length numeric vectors. */
export const cosineSimilarity = (a = [], b = []) => {
    const len = Math.min(a.length, b.length);
    if (!len) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
