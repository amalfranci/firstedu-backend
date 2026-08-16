import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    paperKey: { type: String, required: true, unique: true, trim: true },
    sourcePaperId: { type: String, trim: true, default: "" },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    examType: { type: String, default: "jee_advanced", trim: true },
    pillar: { type: String, default: "Competitive", trim: true },
    subjects: { type: [String], default: ["Mathematics", "Physics", "Chemistry"] },
    durationMinutes: { type: Number, default: 180, min: 1 },
    totalQuestions: { type: Number, default: 0, min: 0 },
    totalMarks: { type: Number, default: 0, min: 0 },
    marksPerQuestion: { type: Number, default: 4 },
    negativeMarks: { type: Number, default: 1 },
    sourceFile: { type: String, trim: true, default: "" },
    isPublished: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

schema.index({ examType: 1, isPublished: 1 });
schema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.models.JeeAdvancedCompetitivePaper ||
  mongoose.model("JeeAdvancedCompetitivePaper", schema);
