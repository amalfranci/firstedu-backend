import Question from "../models/Question.js";
import AiQuestion from "../models/AiQuestion.js";
import JeeMainCompetitiveQuestion from "../models/JeeMainCompetitiveQuestion.js";

/**
 * Fetch questions by id from either manual, AI, or JEE Main collections.
 * Returns plain objects shaped like manual questions for scoring/exam code.
 */
export const findQuestionsByIds = async (ids, questionModelsById = null) => {
  if (!ids?.length) return [];

  const idStrings = ids.map((id) => id?.toString?.() || String(id));
  const manualIds = [];
  const aiIds = [];
  const jeeMainIds = [];

  if (questionModelsById instanceof Map) {
    idStrings.forEach((id) => {
      const model = questionModelsById.get(id) || "Question";
      if (model === "AiQuestion") aiIds.push(id);
      else if (model === "JeeMainCompetitiveQuestion") jeeMainIds.push(id);
      else manualIds.push(id);
    });
  } else {
    manualIds.push(...idStrings);
  }

  const [manualQuestions, aiQuestions, jeeMainQuestions] = await Promise.all([
    manualIds.length
      ? Question.find({ _id: { $in: manualIds } }).lean()
      : [],
    aiIds.length ? AiQuestion.find({ _id: { $in: aiIds } }).lean() : [],
    jeeMainIds.length
      ? JeeMainCompetitiveQuestion.find({ _id: { $in: jeeMainIds } }).lean()
      : [],
  ]);

  return [...manualQuestions, ...aiQuestions, ...jeeMainQuestions];
};

export const findQuestionById = async (id, questionModel = "Question") => {
  if (questionModel === "AiQuestion") {
    return AiQuestion.findById(id).lean();
  }
  if (questionModel === "JeeMainCompetitiveQuestion") {
    return JeeMainCompetitiveQuestion.findById(id).lean();
  }
  return Question.findById(id).lean();
};
