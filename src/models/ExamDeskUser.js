import mongoose from "mongoose";

const examDeskUserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, trim: true },
    username: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },
  },
  { timestamps: true }
);

const ExamDeskUser =
  mongoose.models.ExamDeskUser ||
  mongoose.model("ExamDeskUser", examDeskUserSchema);

export default ExamDeskUser;
