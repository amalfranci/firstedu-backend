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
    generationId: { type: String, index: true },
    /** Sequence within the paper (= seat order). */
    seq: { type: Number, required: true },
    sequence: { type: Number, default: null },
    subject: { type: String, default: "" },
    topicId: { type: String, default: "" },
    chapter: { type: String, default: "" },
    questionType: { type: String, default: "single" },
    status: {
      type: String,
      default: "queued",
      index: true,
    },
    stage: {
      type: String,
      enum: [
        "queued",
        "generating",
        "generated",
        "code_validating",
        "code_valid",
        "validating",
        "verified",
        "locked",
        "expanding",
        "expanded",
        "auditing",
        "ready_to_confirm",
        "dropped",
        "failed",
      ],
      default: "queued",
      index: true,
    },
    attempt: { type: Number, default: 1 },
    answerKey: { type: mongoose.Schema.Types.Mixed, default: null },
    conceptSlot: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    failureDetail: { type: mongoose.Schema.Types.Mixed, default: null },
    questionText: { type: String, default: "" },
    /** Full question payload (alias of locked/raw for client-facing schema). */
    questionData: { type: mongoose.Schema.Types.Mixed, default: null },
    verificationData: { type: mongoose.Schema.Types.Mixed, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
    locked: { type: mongoose.Schema.Types.Mixed, default: null },
    tokenCalls: { type: [tokenCallSchema], default: [] },
    tokenTotals: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "ai_paper_generation_questions" }
);

schema.index({ jobId: 1, seq: 1 }, { unique: true });
schema.index({ generationId: 1, sequence: 1 });

export default mongoose.models.AiPaperGenerationQuestion ||
  mongoose.model("AiPaperGenerationQuestion", schema);
