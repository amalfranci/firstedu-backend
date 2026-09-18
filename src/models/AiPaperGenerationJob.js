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
    /** Same as jobId (apt-…); exposed to clients as generationId. */
    jobId: { type: String, required: true, unique: true, index: true },
    generationId: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    exam: { type: String, default: "" },
    subject: { type: String, default: "" },
    totalQuestions: { type: Number, default: 0 },
    completedQuestions: { type: Number, default: 0 },
    failedQuestions: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "queued", "running", "completed", "failed"],
      default: "pending",
      index: true,
    },
    phase: { type: String, default: "queued" },
    message: { type: String, default: "" },
    error: { type: String, default: "" },
    errorDetail: { type: mongoose.Schema.Types.Mixed, default: null },
    resumable: { type: Boolean, default: false },
    resumeCount: { type: Number, default: 0 },
    runner: { type: String, default: "worker" },
    workerId: { type: String, default: "" },
    logDir: { type: String, default: "" },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    tokenUsage: { type: mongoose.Schema.Types.Mixed, default: {} },
    tokenCalls: { type: [tokenCallSchema], default: [] },
    failures: { type: [mongoose.Schema.Types.Mixed], default: [] },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "ai_paper_generation_jobs" }
);

schema.index({ generationId: 1, userId: 1 });

export default mongoose.models.AiPaperGenerationJob ||
  mongoose.model("AiPaperGenerationJob", schema);
