import mongoose from "mongoose";

/**
 * Caches embeddings for AiQuestion documents used by question-corpus RAG
 * retrieval (questionCorpusRag.service.js). Kept as a separate collection
 * rather than a field on AiQuestion to avoid migration risk on a model
 * already in production use.
 */
const questionEmbeddingCacheSchema = new mongoose.Schema(
    {
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AiQuestion",
            required: true,
            unique: true,
        },
        embedding: { type: [Number], required: true },
        embeddingModel: { type: String, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.models.QuestionEmbeddingCache ||
    mongoose.model("QuestionEmbeddingCache", questionEmbeddingCacheSchema);
