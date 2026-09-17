import mongoose from "mongoose";

const tokenCallSchema = new mongoose.Schema(
  {
    provider: String,
    model: String,
    kind: String,
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    reasoningTokens: { type: Number, default: 0 },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, index: true },
    seq: { type: Number, required: true },
    subject: { type: String, default: "" },
    topicId: { type: String, default: "" },
    chapter: { type: String, default: "" },
    questionType: { type: String, default: "single" },
    stage: {
      type: String,
      enum: ["queued", "generated", "locked", "expanded", "dropped", "failed"],
      default: "queued",
      index: true,
    },
    failureReason: { type: String, default: "" },
    failureDetail: { type: mongoose.Schema.Types.Mixed, default: null },
    questionText: { type: String, default: "" },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
    locked: { type: mongoose.Schema.Types.Mixed, default: null },
    tokenCalls: { type: [tokenCallSchema], default: [] },
    tokenTotals: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "ai_paper_generation_questions" }
);

schema.index({ jobId: 1, seq: 1 }, { unique: true });

export default mongoose.models.AiPaperGenerationQuestion ||
  mongoose.model("AiPaperGenerationQuestion", schema);
