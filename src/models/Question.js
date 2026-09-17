import mongoose from "mongoose";

const optionSchema = new mongoose.Schema({
  text: { type: String, trim: true },
  imageUrl: { type: String, trim: true },
  isCorrect: { type: Boolean, default: false },
});

const connectedSubQuestionSchema = new mongoose.Schema(
  {
    questionText: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      enum: ["single", "multiple", "true_false"],
      required: true,
    },
    options: { type: [optionSchema], default: [] },
    correctAnswer: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    explanation: { 
      type: String, 
      trim: true,
      required: [true, 'Explanation is required. Please provide a detailed solution explanation for this question.']
    },
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    imageUrl: [{ type: String, trim: true }],
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    // Basic question fields
    questionText: { type: String, required: true, trim: true },
    answer: { type: String },
    imageUrl: [{ type: String, trim: true }],
    questionType: {
      type: String,
      enum: ["single", "multiple", "true_false", "connected", "integer"],
      default: "single",
    },
    options: [optionSchema],
    correctAnswer: {
      type: mongoose.Schema.Types.Mixed, // Can be string, array, or boolean
      required: function () {
        return this.questionType !== "connected";
      },
    },
    explanation: { 
      type: String, 
      trim: true,
      required: function () {
        return this.questionType !== "connected";
      },
    },
    subject: { type: String, trim: true },
    questionBank: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuestionBank",
    },
    sectionIndex: { type: Number, min: 0 },
    orderInBank: { type: Number, min: 0 },
    topic: { type: String, trim: true },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "easy",
    },
    marks: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0 },
    tags: [{ type: String, trim: true }],

    // Connected Questions Support (Parent-Child relationship)
    isParent: { type: Boolean, default: false },
    parentQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      default: null,
    },
    passage: {
      type: String,
      trim: true,
      required: function () {
        return this.isParent === true;
      },
    },
    connectedQuestions: { type: [connectedSubQuestionSchema], default: [] },
    childQuestions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
      },
    ],

    // Analytics fields
    analytics: {
      pValue: { type: Number, default: null }, // Difficulty index (0-1, higher = easier)
      discriminationIndex: { type: Number, default: null }, // (-1 to 1, higher = better)
      totalAttempts: { type: Number, default: 0 },
      correctAttempts: { type: Number, default: 0 },
      lastCalculated: { type: Date, default: null },
    },

    // Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for better query performance
questionSchema.index({ subject: 1, topic: 1 });
questionSchema.index({ createdBy: 1 });
questionSchema.index({ parentQuestionId: 1 });
questionSchema.index({ isActive: 1 });
questionSchema.index({ questionBank: 1, orderInBank: 1 });

// Virtual to populate child questions
questionSchema.virtual("childQuestionsDetails", {
  ref: "Question",
  localField: "childQuestions",
  foreignField: "_id",
});

// Method to calculate P-Value (Difficulty)
questionSchema.methods.calculatePValue = function () {
  if (this.analytics.totalAttempts === 0) return null;
  return this.analytics.correctAttempts / this.analytics.totalAttempts;
};

// Method to calculate Discrimination Index
// DI = (Upper Group Correct % - Lower Group Correct %)
questionSchema.methods.calculateDiscriminationIndex = function (
  upperGroupCorrect,
  lowerGroupCorrect,
  upperGroupTotal,
  lowerGroupTotal
) {
  if (upperGroupTotal === 0 || lowerGroupTotal === 0) return null;
  const upperPercent = upperGroupCorrect / upperGroupTotal;
  const lowerPercent = lowerGroupCorrect / lowerGroupTotal;
  return upperPercent - lowerPercent;
};

export default mongoose.models.Question ||
  mongoose.model("Question", questionSchema);

