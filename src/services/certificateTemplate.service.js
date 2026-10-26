import CertificateTemplate from "../models/CertificateTemplate.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadPDFToCloudinary } from "../utils/s3Upload.js";

export const uploadCertificateTemplate = async (pdfBuffer, originalName, textLayout = {}) => {
  let pdfUrl;
  
  if (pdfBuffer && pdfBuffer.length > 0) {
    pdfUrl = await uploadPDFToCloudinary(
      pdfBuffer,
      originalName || "certificate-template.pdf",
      "certificate-templates"
    );
  }

  const existingTemplate = await CertificateTemplate.findOne({ isActive: true });

  if (!pdfUrl && !existingTemplate) {
    throw new ApiError(400, "Template PDF file is required for initial setup");
  }

  if (pdfUrl) {
    // Deactivate existing templates if uploading a new PDF
    await CertificateTemplate.updateMany({}, { $set: { isActive: false } });

    return await CertificateTemplate.create({
      pdfTemplateUrl: pdfUrl,
      textLayout: textLayout || {},
      isActive: true,
    });
  } else {
    // Update layout of existing active template
    existingTemplate.textLayout = textLayout || {};
    existingTemplate.markModified("textLayout");
    await existingTemplate.save();
    return existingTemplate;
  }
};

export const getActiveCertificateTemplate = async () => {
  const tpl = await CertificateTemplate.findOne({ isActive: true })
    .sort({ updatedAt: -1 })
    .lean();
  if (!tpl) {
    throw new ApiError(404, "No active certificate template configured");
  }
  return tpl;
};

export default {
  uploadCertificateTemplate,
  getActiveCertificateTemplate,
};

