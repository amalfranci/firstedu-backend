import mongoose from "mongoose";

const testSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    questionBank: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuestionBank",
      default: null,
    },
    aiQuestionBank: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiQuestionBank",
      default: null,
    },
    jeeMainPaper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JeeMainCompetitivePaper",
      default: null,
    },
    paperSource: {
      type: String,
      enum: ["manual", "ai", "jee_main_db"],
      default: "manual",
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    proctoringInstructions: {
      type: String,
      trim: true,
      default:
        "Please do not switch tabs or minimize the browser window during the test. Any suspicious activity will be logged.",
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    applicableFor: {
      type: String,
      enum: [
        "test",
        "testBundle",
        "tournament",
        "challenge_yourself",
        "challenge_your_friend",
        "everyday_challenge",
        "competition_sector",
        "Olympiads",
        "School",
        "Competitive",
        "Skill Development",
        "certificate",
        "trending_test"
      ],
      default: "test",
      index: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    upgradeNotificationSent: {
      type: Boolean,
      default: false,
    },
    rewardPoints: {
      type: Number,
      default: 0,
    },
    gamificationLevel: {
      type: Number,
      default: null,
    },
    passingPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
  },
);

testSchema.index({ title: 1, createdBy: 1 });
testSchema.index({ questionBank: 1 });
testSchema.index({ aiQuestionBank: 1 });
testSchema.index({ jeeMainPaper: 1 });

testSchema.pre("validate", function validateBankLink(next) {
  const hasManual = !!this.questionBank;
  const hasAi = !!this.aiQuestionBank;
  const hasJeeMain = !!this.jeeMainPaper;
  const sourceCount = [hasManual, hasAi, hasJeeMain].filter(Boolean).length;
  if (sourceCount > 1) {
    return next(
      new Error("Test cannot link more than one question source")
    );
  }
  if (sourceCount === 0) {
    return next(new Error("Test must link a question bank"));
  }
  this.paperSource = hasAi ? "ai" : hasJeeMain ? "jee_main_db" : "manual";
  next();
});

export default mongoose.models.Test || mongoose.model("Test", testSchema);
