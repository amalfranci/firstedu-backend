import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema(
  {
    id: { type: Number },
    name: { type: String, trim: true },
    count: { type: Number, required: true, min: 1 },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      required: true,
    },
    timeMinutes: { type: Number, min: 0, default: 0 },
    negativeMarks: { type: Number, min: 0, default: 1 },
    contentType: {
      type: String,
      enum: ["text", "image"],
      default: "text",
    },
  },
  { _id: false }
);

const aiQuestionBankSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /** Opaque id for this generation run — allows many banks for the same exam/subject. */
    generationId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
    },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    overallDifficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    useSectionWise: {
      type: Boolean,
      default: false,
    },
    /** Applied to every question when useSectionWise is false. */
    negativeMarks: { type: Number, min: 0, default: 1 },
    sections: [sectionSchema],
    aiProvider: {
      type: String,
      default: "gemini",
      trim: true,
    },
    generationTopic: {
      type: String,
      trim: true,
      default: null,
    },
    questionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }
);

aiQuestionBankSchema.index({ categories: 1 });
aiQuestionBankSchema.index({ createdBy: 1, createdAt: -1 });
aiQuestionBankSchema.index({ createdBy: 1, name: 1 });

export default mongoose.models.AiQuestionBank ||
  mongoose.model("AiQuestionBank", aiQuestionBankSchema);
