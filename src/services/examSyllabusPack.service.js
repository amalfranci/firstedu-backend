import ExamSyllabusPack from "../models/ExamSyllabusPack.js";

/**
 * Multi-exam syllabus + scoring pack accessors (Mongo).
 * Generation file packs (ncert / quotas) stay file-backed; this layer owns
 * syllabus chapters + relevance scoring for any examType.
 */

const normalizeExamType = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeSubject = (value = "") => {
  const key = String(value || "").trim();
  if (/^math/i.test(key)) return "Mathematics";
  if (/^phys/i.test(key)) return "Physics";
  if (/^chem/i.test(key)) return "Chemistry";
  return key;
};

/** Map Mongo pack topic → generation-service shape used by Advanced maths/physics. */
export const mapPackTopicToGenerationShape = (topic = {}) => {
  const relevance =
    topic.scoring?.relevance ||
    topic.scoring?.advancedRelevance ||
    null;
  const scoring = topic.scoring
    ? {
        advanced_relevance: relevance,
        relevance,
        jee_main_freq_band: topic.scoring.freqBand || null,
        avg_q_per_session_jee_main: topic.scoring.avgQPerSession || null,
        difficulty_split: topic.scoring.difficultySplit
          ? {
              easy: topic.scoring.difficultySplit.easy,
              medium: topic.scoring.difficultySplit.medium,
              hard: topic.scoring.difficultySplit.hard,
            }
          : undefined,
        notes: topic.scoring.notes || "",
      }
    : null;

  return {
    topicId: topic.topicId || null,
    chapter: topic.title || "",
    classLevel: topic.classLevel || "",
    branch: topic.branch || null,
    subtopics: Array.isArray(topic.subtopics) ? topic.subtopics : [],
    unit: topic.unit || topic.topicId || null,
    content: topic.content || "",
    order: topic.order ?? 0,
    scoring,
    highLock: String(relevance || "").toLowerCase() === "high",
    relevance: relevance ? String(relevance).toLowerCase() : null,
  };
};

export const findExamSyllabusPack = async ({
  examType,
  subject,
  year = 2026,
  paper = null,
} = {}) => {
  const exam = normalizeExamType(examType);
  const subj = normalizeSubject(subject);
  if (!exam || !subj) return null;

  const query = {
    examType: exam,
    subject: subj,
    year: Number(year) || 2026,
    isActive: true,
  };
  if (paper != null && String(paper).trim() !== "") {
    query.paper = String(paper).trim();
  }

  let doc = await ExamSyllabusPack.findOne(query).lean();
  if (!doc && query.paper != null) {
    const { paper: _p, ...withoutPaper } = query;
    doc = await ExamSyllabusPack.findOne(withoutPaper)
      .sort({ updatedAt: -1 })
      .lean();
  }
  return doc;
};

export const getExamSyllabusPackTopics = async (opts = {}) => {
  const pack = await findExamSyllabusPack(opts);
  if (!pack?.topics?.length) return [];
  return pack.topics.map(mapPackTopicToGenerationShape);
};

export const getHighRelevancePackTopics = async (opts = {}) => {
  const topics = await getExamSyllabusPackTopics(opts);
  return topics.filter((t) => String(t.relevance || "").toLowerCase() === "high");
};

export const getMediumPlusPackTopics = async (opts = {}) => {
  const topics = await getExamSyllabusPackTopics(opts);
  return topics.filter((t) => {
    const r = String(t.relevance || "").toLowerCase();
    return r === "high" || r === "medium";
  });
};

export const listExamSyllabusPacks = async ({ examType = null } = {}) => {
  const query = { isActive: true };
  if (examType) query.examType = normalizeExamType(examType);
  return ExamSyllabusPack.find(query)
    .select(
      "examType examLabel subject year paper topicCount highRelevanceCount scoringSource updatedAt"
    )
    .sort({ examType: 1, subject: 1 })
    .lean();
};
