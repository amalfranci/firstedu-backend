import mongoose from "mongoose";

/**
 * Multi-exam syllabus + scoring pack.
 *
 * One document per examType × subject × year × paper.
 * Designed for JEE Advanced now; examType is an open string so NEET / CAT / etc.
 * can reuse the same collection later without a new model.
 */

const difficultySplitSchema = new mongoose.Schema(
  {
    easy: { type: Number, default: null },
    medium: { type: Number, default: null },
    hard: { type: Number, default: null },
  },
  { _id: false }
);

const topicScoringSchema = new mongoose.Schema(
  {
    /** Normalized relevance used for topic locks (high | medium | low). */
    relevance: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true,
    },
    /** Original Advanced field name (kept for pack parity). */
    advancedRelevance: { type: String, trim: true, lowercase: true, default: null },
    freqBand: { type: String, trim: true, default: null },
    avgQPerSession: { type: String, trim: true, default: null },
    difficultySplit: { type: difficultySplitSchema, default: undefined },
    notes: { type: String, trim: true, default: "" },
    /** Escape hatch for exam-specific scoring keys (NEET weightage, etc.). */
    extras: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const topicSchema = new mongoose.Schema(
  {
    topicId: { type: String, trim: true, default: null, index: true },
    unit: { type: String, trim: true, default: null },
    title: { type: String, required: true, trim: true },
    content: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: null },
    classLevel: { type: String, trim: true, default: null },
    subtopics: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    scoring: { type: topicScoringSchema, default: undefined },
  },
  { _id: false }
);

const examSyllabusPackSchema = new mongoose.Schema(
  {
    examType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    examLabel: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    year: {
      type: Number,
      default: 2026,
      index: true,
    },
    paper: {
      type: String,
      trim: true,
      default: "",
    },
    source: {
      type: String,
      trim: true,
      default: "",
    },
    scoringSource: {
      type: String,
      trim: true,
      default: "",
    },
    examContext: {
      type: String,
      trim: true,
      default: "",
    },
    dataProvenance: {
      type: String,
      trim: true,
      default: "",
    },
    topicCount: {
      type: Number,
      default: 0,
    },
    highRelevanceCount: {
      type: Number,
      default: 0,
    },
    topics: {
      type: [topicSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

examSyllabusPackSchema.index(
  { examType: 1, subject: 1, paper: 1, year: 1 },
  { unique: true }
);

export default mongoose.models.ExamSyllabusPack ||
  mongoose.model("ExamSyllabusPack", examSyllabusPackSchema);
