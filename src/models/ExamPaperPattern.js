import mongoose from "mongoose";

/**
 * Multi-exam official paper pattern / session blueprint.
 * Seeded for JEE Advanced Paper 1 & Paper 2 (2026); reusable for other exams.
 */

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    type: {
      type: String,
      trim: true,
      required: true,
      // single | multi | integer | match | paragraph | trueFalse | ...
    },
    label: { type: String, trim: true, default: "" },
    questions: { type: Number, default: 0, min: 0 },
    options: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const examPaperPatternSchema = new mongoose.Schema(
  {
    examType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    examLabel: { type: String, required: true, trim: true },
    year: { type: Number, required: true, index: true },
    paperNumber: { type: Number, required: true, min: 1, index: true },
    paperKey: { type: String, required: true, trim: true },
    paperLabel: { type: String, required: true, trim: true },
    session: {
      type: String,
      trim: true,
      default: "",
      // morning | afternoon | ...
    },
    examDate: { type: String, trim: true, default: "" }, // YYYY-MM-DD
    examDateLabel: { type: String, trim: true, default: "" },
    startTime: { type: String, trim: true, default: "" }, // HH:mm
    endTime: { type: String, trim: true, default: "" },
    durationMinutes: { type: Number, default: 180, min: 1 },
    totalMarks: { type: Number, default: 0, min: 0 },
    totalQuestions: { type: Number, default: 0, min: 0 },
    questionsPerSubject: { type: Number, default: 0, min: 0 },
    subjects: {
      type: [String],
      default: ["Physics", "Chemistry", "Mathematics"],
    },
    formats: { type: [String], default: [] },
    overallDifficulty: { type: String, trim: true, default: "" },
    mandatoryBothPapers: { type: Boolean, default: false },
    sections: { type: [sectionSchema], default: [] },
    /** Denormalized type counts for one subject. */
    typeCounts: {
      single: { type: Number, default: 0 },
      multi: { type: Number, default: 0 },
      integer: { type: Number, default: 0 },
      match: { type: Number, default: 0 },
      paragraph: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    source: { type: String, trim: true, default: "" },
    dataProvenance: { type: String, trim: true, default: "" },
    quickComparison: { type: mongoose.Schema.Types.Mixed, default: undefined },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

examPaperPatternSchema.index(
  { examType: 1, year: 1, paperNumber: 1 },
  { unique: true }
);

export default mongoose.models.ExamPaperPattern ||
  mongoose.model("ExamPaperPattern", examPaperPatternSchema);
