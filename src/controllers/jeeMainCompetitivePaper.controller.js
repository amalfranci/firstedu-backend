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
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper = await jeeMainCompetitivePaperService.generateJeeMainQuestionSet(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "JEE Main combined paper generated"));
});

export const generateJeeAdvancedQuestionSet = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper =
    await jeeAdvancedCompetitivePaperService.generateJeeAdvancedQuestionSet(
      excludeQuestionIds
    );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "JEE Advanced combined paper generated"));
});

export const generateNeetQuestionSet = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper = await neetCompetitivePaperService.generateNeetQuestionSet(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "NEET combined paper generated"));
});

export const generateClatQuestionSet = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper = await clatCompetitivePaperService.generateClatQuestionSet(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "CLAT combined paper generated"));
});

export const generateIbpsQuestionSet = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper = await ibpsCompetitivePaperService.generateIbpsQuestionSet(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "IBPS combined paper generated"));
});

export const generateGmatQuestionSet = asyncHandler(async (req, res) => {
  const excludeQuestionIds = parseExcludeIds(req.body?.excludeQuestionIds);
  const paper = await gmatCompetitivePaperService.generateGmatQuestionSet(
    excludeQuestionIds
  );
  return res
    .status(200)
    .json(ApiResponse.success(paper, "GMAT combined paper generated"));
});

export const generateSscCglTier1QuestionSet = asyncHandler(async (req, res) => {
  const paper = await sscCglTier1CompetitivePaperService.generateSscCglTier1QuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds)
  );
  return res.status(200).json(ApiResponse.success(paper, "SSC CGL Tier 1 paper generated"));
});

export const generateSscCglTier2QuestionSet = asyncHandler(async (req, res) => {
  const paper = await sscCglTier2CompetitivePaperService.generateSscCglTier2QuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds)
  );
  return res.status(200).json(ApiResponse.success(paper, "SSC CGL Tier 2 paper generated"));
});

export const generateUpscQuestionSet = asyncHandler(async (req, res) => {
  const paper = await upscCompetitivePaperService.generateUpscQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds)
  );
  return res.status(200).json(ApiResponse.success(paper, "UPSC GS paper generated"));
});

export const generateCatQuestionSet = asyncHandler(async (req, res) => {
  const paper = await catCompetitivePaperService.generateCatQuestionSet(
    parseExcludeIds(req.body?.excludeQuestionIds)
  );
  return res.status(200).json(ApiResponse.success(paper, "CAT paper generated"));
});
