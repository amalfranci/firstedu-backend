import mongoose from "mongoose";

const topicSchema = new mongoose.Schema(
  {
    topicId: { type: String, trim: true, default: null },
    unit: { type: String, trim: true, default: null },
    title: { type: String, required: true, trim: true },
    content: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: null },
    classLevel: { type: String, trim: true, default: null },
    subtopics: { type: [String], default: [] },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const jeeExamSyllabusSchema = new mongoose.Schema(
  {
    examType: {
      type: String,
      enum: ["jee_main", "jee_advanced"],
      required: true,
      index: true,
    },
    examLabel: {
      type: String,
      required: true,
      trim: true,
    },
    paper: {
      type: String,
      trim: true,
      default: "",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    year: {
      type: Number,
      default: 2026,
    },
    source: {
      type: String,
      trim: true,
      default: "",
    },
    topicCount: {
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
    },
  },
  { timestamps: true }
);

jeeExamSyllabusSchema.index(
  { examType: 1, subject: 1, paper: 1, year: 1 },
  { unique: true }
);

export default mongoose.models.JeeExamSyllabus ||
  mongoose.model("JeeExamSyllabus", jeeExamSyllabusSchema);
