import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import JeeExamSyllabus from "../models/JeeExamSyllabus.js";

const normalizeExamType = (value) => {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "jee_main" || raw === "jeemain" || raw === "main") return "jee_main";
  if (
    raw === "jee_advanced" ||
    raw === "jeeadvanced" ||
    raw === "jee_advance" ||
    raw === "advance" ||
    raw === "advanced"
  ) {
    return "jee_advanced";
  }
  return raw || null;
};

export const listJeeExamSyllabus = asyncHandler(async (req, res) => {
  const examType = normalizeExamType(req.query.examType || req.query.exam);
  const subject = req.query.subject ? String(req.query.subject).trim() : "";
  const filter = { isActive: true };
  if (examType) filter.examType = examType;
  if (subject) filter.subject = new RegExp(`^${subject}$`, "i");

  const docs = await JeeExamSyllabus.find(filter)
    .sort({ examType: 1, subject: 1 })
    .lean();

  return res.status(200).json(
    ApiResponse.success(
      docs,
      "JEE syllabus fetched successfully",
      { total: docs.length }
    )
  );
});

export const getJeeExamSyllabusByExam = asyncHandler(async (req, res) => {
  const examType = normalizeExamType(req.params.examType);
  if (!examType || !["jee_main", "jee_advanced"].includes(examType)) {
    throw new ApiError(400, "examType must be jee_main or jee_advanced");
  }

  const docs = await JeeExamSyllabus.find({ examType, isActive: true })
    .sort({ subject: 1 })
    .lean();

  if (!docs.length) {
    throw new ApiError(404, "No syllabus found for this exam");
  }

  return res.status(200).json(
    ApiResponse.success(
      {
        examType,
        examLabel: docs[0].examLabel,
        year: docs[0].year,
        subjects: docs,
      },
      "JEE syllabus fetched successfully"
    )
  );
});
