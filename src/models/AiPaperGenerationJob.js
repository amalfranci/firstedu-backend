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
    jobId: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "running",
      index: true,
    },
    phase: { type: String, default: "queued" },
    message: { type: String, default: "" },
    error: { type: String, default: "" },
    errorDetail: { type: mongoose.Schema.Types.Mixed, default: null },
    resumable: { type: Boolean, default: false },
    resumeCount: { type: Number, default: 0 },
    logDir: { type: String, default: "" },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    tokenUsage: { type: mongoose.Schema.Types.Mixed, default: {} },
    tokenCalls: { type: [tokenCallSchema], default: [] },
    failures: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, collection: "ai_paper_generation_jobs" }
);

export default mongoose.models.AiPaperGenerationJob ||
  mongoose.model("AiPaperGenerationJob", schema);
