import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jeeMainCompetitivePaperService from "../services/jeeMainCompetitivePaper.service.js";
import jeeAdvancedCompetitivePaperService from "../services/jeeAdvancedCompetitivePaper.service.js";
import neetCompetitivePaperService from "../services/neetCompetitivePaper.service.js";
import clatCompetitivePaperService from "../services/clatCompetitivePaper.service.js";
import ibpsCompetitivePaperService from "../services/ibpsCompetitivePaper.service.js";
import gmatCompetitivePaperService from "../services/gmatCompetitivePaper.service.js";
import sscCglTier1CompetitivePaperService from "../services/sscCglTier1CompetitivePaper.service.js";
import sscCglTier2CompetitivePaperService from "../services/sscCglTier2CompetitivePaper.service.js";
import upscCompetitivePaperService from "../services/upscCompetitivePaper.service.js";
import catCompetitivePaperService from "../services/catCompetitivePaper.service.js";

export const listJeeMainPapersAdmin = asyncHandler(async (req, res) => {
  const papers = await jeeMainCompetitivePaperService.listJeeMainPapers({
    includeAnswers: false,
  });
  return res
    .status(200)
    .json(ApiResponse.success(papers, "JEE Main papers fetched successfully"));
});

export const getJeeMainPaperAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ApiError(400, "Paper id is required");
  const paper = await jeeMainCompetitivePaperService.getJeeMainPaperById(id, {
    includeAnswers: true,
  });
  return res
    .status(200)
    .json(ApiResponse.success(paper, "JEE Main paper fetched successfully"));
});

export const listJeeMainPapersStudent = asyncHandler(async (req, res) => {
  const { categoryId, search } = req.query;
  const result = await jeeMainCompetitivePaperService.listJeeMainPapersForStudent(
    req.user._id,
    { categoryId, search }
  );
  return res.status(200).json(
    ApiResponse.success(result.papers, "JEE Main papers fetched successfully", {
      ...result.pagination,
      hasAccess: result.hasAccess,
      upgradable: result.upgradable,
      upgradeCost: result.upgradeCost,
      isFreeUpgrade: result.isFreeUpgrade,
      hasNewContent: result.hasNewContent,
    })
  );
});

export const getJeeMainPaperStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new ApiError(400, "Paper id is required");
  const paper = await jeeMainCompetitivePaperService.getJeeMainPaperById(id, {
    includeAnswers: false,
  });
  return res
    .status(200)
    .json(ApiResponse.success(paper, "JEE Main paper fetched successfully"));
});

const parseExcludeIds = (value) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((id) => id.trim()).filter(Boolean);
  }
  return [];
};

const parseGenerateOptions = (body = {}) => {
  const count = Number.parseInt(body.count, 10);
  const typeCounts = body.typeCounts && typeof body.typeCounts === "object"
    ? {
        single: Number(body.typeCounts.single) || 0,
        multiple: Number(body.typeCounts.multiple) || 0,
        trueFalse: Number(body.typeCounts.trueFalse) || 0,
      }
    : null;
  return {
    subject: body.subject ? String(body.subject).trim() : null,
    count: Number.isFinite(count) && count > 0 ? count : null,
    typeCounts,
    allowedTypes: Array.isArray(body.allowedTypes)
      ? body.allowedTypes.map(String)
      : null,
  };
};

export const getJeeMainGeneratorSummary = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(
    req.query.excludeQuestionIds || req.body?.excludeQuestionIds
  );
  const summary = await jeeMainCompetitivePaperService.getJeeMainGeneratorSummary(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(summary, "JEE Main generator summary fetched"));
});

export const generateJeeMainQuestionSet = asyncHandler(async (req, res) => {
  const paper = await jeeMainCompetitivePaperService.generateJeeMainQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateJeeAdvancedQuestionSet = asyncHandler(async (req, res) => {
  const paper =
    await jeeAdvancedCompetitivePaperService.generateJeeAdvancedQuestionSet(
      parseExcludeIds(req.body?.excludeQuestionIds),
      parseGenerateOptions(req.body)
    );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateNeetQuestionSet = asyncHandler(async (req, res) => {
  const paper = await neetCompetitivePaperService.generateNeetQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateClatQuestionSet = asyncHandler(async (req, res) => {
  const paper = await clatCompetitivePaperService.generateClatQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateIbpsQuestionSet = asyncHandler(async (req, res) => {
  const paper = await ibpsCompetitivePaperService.generateIbpsQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateGmatQuestionSet = asyncHandler(async (req, res) => {
  const paper = await gmatCompetitivePaperService.generateGmatQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateSscCglTier1QuestionSet = asyncHandler(async (req, res) => {
  const paper = await sscCglTier1CompetitivePaperService.generateSscCglTier1QuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res.status(200).json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateSscCglTier2QuestionSet = asyncHandler(async (req, res) => {
  const paper = await sscCglTier2CompetitivePaperService.generateSscCglTier2QuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res.status(200).json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateUpscQuestionSet = asyncHandler(async (req, res) => {
  const paper = await upscCompetitivePaperService.generateUpscQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res.status(200).json(ApiResponse.success(paper, "New question paper generated"));
});

export const generateCatQuestionSet = asyncHandler(async (req, res) => {
  const paper = await catCompetitivePaperService.generateCatQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds),
    parseGenerateOptions(req.body)
  );
  return res.status(200).json(ApiResponse.success(paper, "New question paper generated"));
});
