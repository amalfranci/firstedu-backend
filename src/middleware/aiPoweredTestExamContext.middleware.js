import { asyncHandler } from "../utils/asyncHandler.js";
import { getAiPoweredTestExamBlueprint } from "../services/aiPoweredTestExamBlueprint.service.js";

/** Keys the AI Powered Test client sends that the generation schemas don't accept. */
const CLIENT_ONLY_KEYS = ["paper", "paperNumber", "examType", "exam"];

const COUNT_KEYS = [
  "singleCount",
  "multipleCount",
  "trueFalseCount",
  "connectedCount",
  "passageCount",
  "passageSingleCount",
  "passageMultipleCount",
  "passageTrueFalseCount",
];

const asPathList = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const allCountsZero = (body) =>
  COUNT_KEYS.every((key) => !(Number(body[key]) > 0));

/**
 * Locks an AI Powered Test request to the paper the admin selected.
 *
 * The client only sends the category path (e.g. "… > JEE Advance Paper 1 >
 * Chemistry"); this resolves the blueprint for it and fills in the parts of
 * the request that belong to the exam, not the admin: exam-native difficulty,
 * subject, and the question formats the paper actually uses. The resolved
 * blueprint is left on `req.aiPoweredTestBlueprint` for the controller.
 */
export const attachAiPoweredTestExamContext = asyncHandler(
  async (req, _res, next) => {
    const body = req.body && typeof req.body === "object" ? { ...req.body } : {};
    const paper = body.paper ?? body.paperNumber ?? null;
    for (const key of CLIENT_ONLY_KEYS) delete body[key];

    const categoryPaths = asPathList(body.categoryPaths);
    if (categoryPaths.length) body.categoryPaths = categoryPaths;

    let blueprint = null;
    if (categoryPaths.length) {
      try {
        blueprint = await getAiPoweredTestExamBlueprint({
          categoryPaths,
          paper,
        });
      } catch (err) {
        console.warn(
          `[ai-powered-test] blueprint lookup failed: ${err?.message || err}`
        );
      }
    }

    if (blueprint?.examType) {
      if (blueprint.difficulty?.examNative && blueprint.difficulty.default) {
        body.difficulty = blueprint.difficulty.default;
      }
      if (!String(body.subject || "").trim() && blueprint.subject) {
        body.subject = blueprint.subject;
      }
      if (blueprint.hideTrueFalse) {
        body.trueFalseCount = 0;
        body.passageTrueFalseCount = 0;
      }
      if (blueprint.hidePassages) {
        body.passageCount = 0;
        body.connectedCount = 0;
        body.passageSingleCount = 0;
        body.passageMultipleCount = 0;
      }
    }

    // "Leave counts at 0 and the AI decides" is the default in the UI.
    if (allCountsZero(body) && Number(body.maxSelectableSlots) > 0) {
      body.inferCountsIfMissing = true;
    }

    req.aiPoweredTestBlueprint = blueprint;
    req.body = body;
    return next();
  }
);

export default attachAiPoweredTestExamContext;
