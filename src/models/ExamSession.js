import mongoose from "mongoose";

const examSessionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    test: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Test",
      required: true,
    },
    challenge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Challenge",
      default: null,
    },
    competitionCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompetitionCategory",
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["in_progress", "paused", "completed", "expired", "abandoned"],
      default: "in_progress",
    },
    answers: [
      {
        questionId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          refPath: "answers.questionModel",
        },
        questionModel: {
          type: String,
          enum: ["Question", "AiQuestion", "JeeMainCompetitiveQuestion"],
          default: "Question",
        },
        answer: mongoose.Schema.Types.Mixed, // Can be string, array, boolean
        status: {
          type: String,
          enum: ["not_visited", "answered", "skipped", "marked_for_review"],
          default: "not_visited",
        },
        answeredAt: Date,
        questionTimeLimitMs: { type: Number, default: 0 },
        remainingTimeMs: { type: Number, default: 0 },
        timerStartedAt: { type: Date, default: null },
        timeExpiredAt: { type: Date, default: null },
      },
    ],
    activeQuestionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      default: null,
    },
    proctoringEvents: [
      {
        type: {
          type: String,
          enum: [
            "window_blur",
            "tab_switch",
            "fullscreen_exit",
            "visibility_change",
          ],
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        metadata: mongoose.Schema.Types.Mixed,
      },
    ],
    score: {
      type: Number,
      default: null,
    },
    maxScore: {
      type: Number,
      default: null,
    },
    correctCount: {
      type: Number,
      default: 0,
    },
    wrongCount: {
      type: Number,
      default: 0,
    },
    skippedCount: {
      type: Number,
      default: 0,
    },
    percentile: {
      type: Number,
      default: null,
    },
    topicAnalysis: [
      {
        topic: {
          type: String,
          required: true,
        },
        subject: {
          type: String,
          required: true,
        },
        totalQuestions: {
          type: Number,
          default: 0,
        },
        correctAnswers: {
          type: Number,
          default: 0,
        },
        wrongAnswers: {
          type: Number,
          default: 0,
        },
        skippedAnswers: {
          type: Number,
          default: 0,
        },
        marksObtained: {
          type: Number,
          default: 0,
        },
        maxMarks: {
          type: Number,
          default: 0,
        },
        accuracy: {
          type: Number,
          default: 0, // Percentage: (correctAnswers / totalQuestions) * 100
        },
      },
    ],
    subjectAnalysis: [
      {
        subject: {
          type: String,
          required: true,
        },
        totalQuestions: {
          type: Number,
          default: 0,
        },
        correctAnswers: {
          type: Number,
          default: 0,
        },
        wrongAnswers: {
          type: Number,
          default: 0,
        },
        skippedAnswers: {
          type: Number,
          default: 0,
        },
        marksObtained: {
          type: Number,
          default: 0,
        },
        maxMarks: {
          type: Number,
          default: 0,
        },
        accuracy: {
          type: Number,
          default: 0,
        },
        topics: [
          {
            topic: String,
            totalQuestions: Number,
            correctAnswers: Number,
            wrongAnswers: Number,
            skippedAnswers: Number,
            marksObtained: Number,
            maxMarks: Number,
            accuracy: Number,
          },
        ],
      },
    ],
    completedAt: {
      type: Date,
      default: null,
    },
    autoSubmitted: {
      type: Boolean,
      default: false,
    },
    autoSubmitReason: {
      type: String,
      enum: ["time_expired", "proctoring_violation", null],
      default: null,
    },
    pausedAt: { type: Date, default: null },
    remainingTimeAtPause: { type: Number, default: null }, // ms remaining when paused
  },
  {
    timestamps: true,
  },
);

// One active session per student per test & bundle context
examSessionSchema.index({ student: 1, test: 1, competitionCategory: 1, status: 1 });
examSessionSchema.index({ challenge: 1, student: 1, status: 1 });

export default mongoose.models.ExamSession ||
  mongoose.model("ExamSession", examSessionSchema);
