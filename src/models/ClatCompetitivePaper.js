import mongoose from "mongoose";

const SUBJECTS = [
  "English Language",
  "Current Affairs including General Knowledge",
  "Legal Reasoning",
  "Logical Reasoning",
  "Quantitative Techniques",
];

const schema = new mongoose.Schema(
  {
    paperKey: { type: String, required: true, unique: true, trim: true },
    sourcePaperId: { type: String, trim: true, default: "" },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    examType: { type: String, default: "clat", trim: true },
    pillar: { type: String, default: "Competitive", trim: true },
    subjects: { type: [String], default: SUBJECTS },
    durationMinutes: { type: Number, default: 120, min: 1 },
    totalQuestions: { type: Number, default: 0, min: 0 },
    totalMarks: { type: Number, default: 0, min: 0 },
    marksPerQuestion: { type: Number, default: 1 },
    negativeMarks: { type: Number, default: 0.25 },
    sourceFile: { type: String, trim: true, default: "" },
    isPublished: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

schema.index({ examType: 1, isPublished: 1 });
schema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.models.ClatCompetitivePaper ||
  mongoose.model("ClatCompetitivePaper", schema);
