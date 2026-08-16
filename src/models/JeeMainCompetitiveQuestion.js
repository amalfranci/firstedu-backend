import mongoose from "mongoose";

const optionSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true },
    text: { type: String, required: true, trim: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

const jeeMainCompetitiveQuestionSchema = new mongoose.Schema(
  {
    paper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JeeMainCompetitivePaper",
      required: true,
      index: true,
    },
    paperKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    questionNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    section: {
      type: String,
      trim: true,
      default: null,
    },
    questionText: {
      type: String,
      required: true,
      trim: true,
    },
    topic: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    questionType: {
      type: String,
      enum: ["single", "multiple", "true_false"],
      default: "single",
    },
    options: {
      type: [optionSchema],
      default: [],
    },
    correctAnswer: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    explanation: {
      type: String,
      trim: true,
      default: "",
    },
    marks: {
      type: Number,
      default: 4,
    },
    negativeMarks: {
      type: Number,
      default: 1,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    sectionIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    orderInPaper: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

jeeMainCompetitiveQuestionSchema.index({ paper: 1, orderInPaper: 1 });
jeeMainCompetitiveQuestionSchema.index({ paper: 1, subject: 1, questionNumber: 1 });
jeeMainCompetitiveQuestionSchema.index({ paperKey: 1, orderInPaper: 1 });

export default mongoose.models.JeeMainCompetitiveQuestion ||
  mongoose.model("JeeMainCompetitiveQuestion", jeeMainCompetitiveQuestionSchema);
