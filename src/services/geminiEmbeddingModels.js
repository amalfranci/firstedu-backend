/** Gemini embedding models for RAG retrieval (embedContent). */

/** Known-good ids as of this writing — override with GEMINI_EMBEDDING_MODEL in .env */
export const GEMINI_EMBEDDING_MODEL_IDS = [
    "gemini-embedding-001",
    "text-embedding-004",
];

export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";

export const resolveGeminiEmbeddingModel = () => {
    const model = String(
        process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL
    ).trim();
    if (!GEMINI_EMBEDDING_MODEL_IDS.includes(model)) {
        console.warn(
            `[embedding] "${model}" is not in the known-good list (${GEMINI_EMBEDDING_MODEL_IDS.join(", ")}) — using it anyway, verify it is enabled for this API key.`
        );
    }
    return model;
};
