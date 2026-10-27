import { ApiError } from "../utils/ApiError.js";
import Certificate from "../models/Certificate.js";
import User from "../models/Student.js";
import Course from "../models/Course.js";
import { uploadPDFToCloudinary, sanitizeFileName } from "../utils/s3Upload.js";
import certificateTemplateService from "./certificateTemplate.service.js";
import courseTestLinkRepository from "../repository/courseTestLink.repository.js";
import orderRepository from "../repository/order.repository.js";
import { sendNotificationToStudent } from "./notification.service.js";
import examSessionRepository from "../repository/examSession.repository.js";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Build a friendly PDF label (e.g. jee-certificate.pdf) from section title or explicit name.
 * @param {string|null} title - e.g. "JEE", "NEET"
 * @param {string|null} explicitFileName - optional body field `fileName` from admin (e.g. jee-certificate.pdf)
 */
export const buildCertificateDisplayFileName = (title, explicitFileName) => {
  if (explicitFileName && String(explicitFileName).trim()) {
    let n = sanitizeFileName(String(explicitFileName).trim());
    if (!n.toLowerCase().endsWith(".pdf")) n = `${n}.pdf`;
    return n;
  }
  if (title && String(title).trim()) {
    const slug = sanitizeFileName(String(title).trim()).replace(/\.pdf$/i, "") || "certificate";
    return `${slug}-certificate.pdf`;
  }
  return "certificate.pdf";
};

/**
 * Base segment for S3 key (readable path; uniqueness via nanoid inside upload).
 */
const buildFriendlyBaseForS3 = (displayFileName) => {
  return sanitizeFileName(displayFileName).replace(/\.pdf$/i, "") || "certificate";
};

/**
 * Upload certificate PDF for a student (admin sends PDF generated from frontend)
 * @param {string|null} explicitFileName - optional `fileName` in form (e.g. jee-certificate.pdf)
 */
export const uploadCertificate = async (
  studentId,
  pdfBuffer,
  originalName,
  adminId,
  title = null,
  explicitFileName = null
) => {
  const student = await User.findById(studentId).select("name email");
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new ApiError(400, "PDF file is required");
  }

  const displayFileName = buildCertificateDisplayFileName(title, explicitFileName);
  const friendlyBase = buildFriendlyBaseForS3(displayFileName);

  const pdfUrl = await uploadPDFToCloudinary(
    pdfBuffer,
    originalName || displayFileName,
    "certificates",
    {
      friendlyBaseName: friendlyBase,
      contentDispositionFilename: displayFileName,
      contentDispositionAttachment: true,
    }
  );

  const certificate = await Certificate.create({
    student: studentId,
    pdfUrl,
    issuedBy: adminId,
    title: title || null,
    fileName: displayFileName,
  });

  return await Certificate.findById(certificate._id)
    .populate("student", "name email")
    .populate("issuedBy", "name email")
    .select("-fileName");
};

/**
 * Get all issued certificates
 */
export const getCertificates = async (page = 1, limit = 10, studentId = null, search = null) => {
  const query = studentId ? { student: studentId } : {};
  if (search && String(search).trim()) {
    const regex = { $regex: String(search).trim(), $options: "i" };
    query.$or = [{ title: regex }, { pdfUrl: regex }];
  }
  const skip = (page - 1) * limit;
  const [certificates, total] = await Promise.all([
    Certificate.find(query)
      .select("-fileName")
      .populate("student", "name email")
      .populate("issuedBy", "name email")
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(limit),
    Certificate.countDocuments(query),
  ]);
  return {
    certificates,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
};

/**
 * Get certificate by ID
 */
export const getCertificateById = async (certificateId) => {
  const certificate = await Certificate.findById(certificateId)
    .select("-fileName")
    .populate("student", "name email")
    .populate("issuedBy", "name email");
  if (!certificate) {
    throw new ApiError(404, "Certificate not found");
  }
  return certificate;
};

/**
 * Issue course-completion certificate for a certification course when all linked tests are completed.
 * Idempotent: if a certificate already exists for (student, course), it does nothing.
 */
export const issueCourseCompletionCertificate = async (studentId, testId) => {

  const student = await User.findById(studentId).select("name email");
  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  // Find purchased certification courses for this student that link the given test
  const coursePurchases = await orderRepository.findCoursePurchases(studentId);
  const courseIds = coursePurchases
    .map((p) => p.course?._id || p.course)
    .filter(Boolean);
  if (courseIds.length === 0) return null;

  const links = await courseTestLinkRepository.findAll({
    course: { $in: courseIds },
    test: testId,
  });
  if (!links || links.length === 0) return null;

  const now = new Date();
  const results = [];

  for (const link of links) {
    const courseId = link.course?._id || link.course;
    if (!courseId) continue;

    const course = await Course.findById(courseId);
    if (!course || !course.isCertification) continue;

    // Idempotency: skip if certificate already issued for this course & student
    const existing = await Certificate.findOne({
      student: studentId,
      title: `${course.title} - Completion`,
    });
    if (existing) {
      continue;
    }

    // Check that all tests linked to this course have a completed exam session for this student
    const courseLinks = await courseTestLinkRepository.findAll({
      course: courseId,
    });
    const allTestIds = courseLinks
      .map((l) => l.test?._id || l.test)
      .filter(Boolean);
    if (allTestIds.length === 0) continue;

    const sessions = await examSessionRepository.findCompletedSessionsForStudentAndTests(
      studentId,
      allTestIds
    );
    const completedTestIdSet = new Set(
      sessions.map((s) => s.test?.toString?.()).filter(Boolean)
    );
    const allCompleted = allTestIds.every((id) =>
      completedTestIdSet.has(id.toString())
    );
    if (!allCompleted) continue;

    // Generate certificate PDF from template
    const template = await certificateTemplateService.getActiveCertificateTemplate();

    const response = await fetch(template.pdfTemplateUrl);
    const arrayBuffer = await response.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const page = pdfDoc.getPage(0);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const emphasizedFont = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    const { width, height } = page.getSize();

    const layout = template.textLayout || {};
    const resolveTextColor = (colorVal, fallbackColor) => {
      const map = {
        white: rgb(1, 1, 1),
        darkBlue: rgb(0.09, 0.18, 0.52),
        darkYellow: rgb(1, 0.66, 0),
        black: rgb(0, 0, 0),
        gold: rgb(0.83, 0.68, 0.21),
        navy: rgb(0, 0.12, 0.38),
        crimson: rgb(0.86, 0.08, 0.24),
        emerald: rgb(0.06, 0.46, 0.43),
      };

      if (colorVal && map[colorVal]) return map[colorVal];

      // Support 3-digit and 6-digit hex color strings (e.g. #FFFFFF, #172554, #EAB308, #000)
      if (typeof colorVal === "string") {
        const hex = colorVal.trim().replace(/^#/, "");
        if (hex.length === 6 && /^[0-9A-Fa-f]{6}$/.test(hex)) {
          const r = parseInt(hex.slice(0, 2), 16) / 255;
          const g = parseInt(hex.slice(2, 4), 16) / 255;
          const b = parseInt(hex.slice(4, 6), 16) / 255;
          return rgb(r, g, b);
        } else if (hex.length === 3 && /^[0-9A-Fa-f]{3}$/.test(hex)) {
          const r = parseInt(hex[0] + hex[0], 16) / 255;
          const g = parseInt(hex[1] + hex[1], 16) / 255;
          const b = parseInt(hex[2] + hex[2], 16) / 255;
          return rgb(r, g, b);
        }
      }

      return fallbackColor;
    };
    // The frontend coordinates assume a standard A4 Landscape (842 x 595 pt).
    // The actual uploaded template may be a completely different resolution or aspect ratio.
    const TEMPLATE_ASSUMED_W = 842;
    const TEMPLATE_ASSUMED_H = 595;
    
    // Compute scaling factors to project coordinates accurately
    const scaleX = width / TEMPLATE_ASSUMED_W;
    const scaleY = height / TEMPLATE_ASSUMED_H;
    
    const studentPosRaw = layout.studentName || { x: TEMPLATE_ASSUMED_W / 2, y: TEMPLATE_ASSUMED_H / 2 };
    const coursePosRaw = layout.courseTitle || { x: TEMPLATE_ASSUMED_W / 2, y: TEMPLATE_ASSUMED_H / 2 - 40 };
    const datePosRaw = layout.issuedAt || { x: TEMPLATE_ASSUMED_W / 2, y: 60 };
    const signaturePosRaw = layout.signature || { x: 690, y: 92, size: 12 };

   
    const studentSize = (studentPosRaw.size || 18) * Math.min(scaleX, scaleY);
     const studentX =studentPosRaw.x * scaleX;
    const studentY = (studentPosRaw.y+studentSize )* scaleY;

    const studentNameText = student.name || "Student";
    const studentNameWidth = emphasizedFont.widthOfTextAtSize(studentNameText, studentSize);

    const textColor = rgb(255/255, 255/255, 255/255); // White text (pdf-lib uses 0-1 range)

    page.drawText(studentNameText, {
      x: studentX - studentNameWidth / 2,
      y: studentY,
      size: studentSize,
      font: emphasizedFont,
      color: resolveTextColor(studentPosRaw.color, textColor),
    });

    const courseSize = (coursePosRaw.size || 16) * Math.min(scaleX, scaleY);
     const courseX = coursePosRaw.x * scaleX;
    const courseY = (coursePosRaw.y * scaleY+courseSize);
    const courseTitleText = course.title || "Course";
    const courseTitleWidth = emphasizedFont.widthOfTextAtSize(courseTitleText, courseSize);

    page.drawText(courseTitleText, {
      x: courseX - courseTitleWidth / 2,
      y: courseY,
      size: courseSize,
      font: emphasizedFont,
      color: resolveTextColor(coursePosRaw.color, rgb(1, 1, 0)),
    });

    
    const dateSize = (datePosRaw.size || 12) * Math.min(scaleX, scaleY);
     const dateX =( datePosRaw.x-12) * scaleX;
    const dateY = (datePosRaw.y-dateSize)* scaleY;

    const dateText = now.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
    const fullDateText = `Date: ${dateText}`;
    const dateWidth = font.widthOfTextAtSize(fullDateText, dateSize);

    page.drawText(fullDateText, {
      x: dateX - dateWidth / 2,
      y: dateY,
      size: dateSize,
      font,
      color: resolveTextColor(datePosRaw.color, textColor),
    });

    const signatureText = String(layout?.signature?.text || "").trim().slice(0, 80);
    if (signatureText) {
      const signatureFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
      const signatureSize = (signaturePosRaw.size || 12) * Math.min(scaleX, scaleY) * 1.12;
      const signatureX = (signaturePosRaw.x+12) * scaleX;
      const signatureY = ((signaturePosRaw.y) * scaleY);
      const signatureWidth = signatureFont.widthOfTextAtSize(signatureText, signatureSize);
      const signatureColor = resolveTextColor(signaturePosRaw.color, rgb(1, 0.66, 0));

      // Two-pass draw keeps pen-like weight while maintaining straight orientation.
      page.drawText(signatureText, {
        x: signatureX - signatureWidth / 2 + 0.45,
        y: signatureY + 0.2,
        size: signatureSize,
        font: signatureFont,
        color: signatureColor,
        rotate: degrees(0),
        opacity: 0.45,
      });

      page.drawText(signatureText, {
        x: signatureX - signatureWidth / 2,
        y: signatureY,
        size: signatureSize,
        font: signatureFont,
        color: signatureColor,
        rotate: degrees(0),
      });
    }

    const pdfBytes = await pdfDoc.save();

    const title = `${course.title || "Course"} - Completion`;
    const displayFileName = buildCertificateDisplayFileName(title, null);
    const friendlyBase = buildFriendlyBaseForS3(displayFileName);

    const pdfUrl = await uploadPDFToCloudinary(
      Buffer.from(pdfBytes),
      displayFileName,
      "certificates",
      {
        friendlyBaseName: friendlyBase,
        contentDispositionFilename: displayFileName,
        contentDispositionAttachment: true,
      }
    );

    const cert = await Certificate.create({
      student: studentId,
      pdfUrl,
      issuedBy: null,
      title,
      fileName: displayFileName,
    });

    // Notify student (in-app + push)
    try {
      await sendNotificationToStudent(
        studentId,
        "Course Completed! 🎉",
        `Congratulations! You have successfully completed the course "${course.title}". We respect your efforts and dedication. Please head to the certification section and get your certificate!`,
        {
          type: "course",
          courseId: courseId.toString(),
          certificateId: cert._id.toString(),
        },
        null
      );
    } catch (e) {
      // Log only; do not break issuance
      console.error("Failed to send certificate notification:", e);
    }
    results.push(cert);
  }
 
  return results;
};

export default {
  uploadCertificate,
  getCertificates,
  getCertificateById,
  issueCourseCompletionCertificate,
};
