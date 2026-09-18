import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExamSyllabusPack from "../models/ExamSyllabusPack.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveExisting = (candidates) =>
  candidates.find((p) => fs.existsSync(p)) || null;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const titleCaseSubject = (value) => {
  const key = String(value || "").trim();
  if (/^math/i.test(key)) return "Mathematics";
  if (/^phys/i.test(key)) return "Physics";
  if (/^chem/i.test(key)) return "Chemistry";
  if (/^bot/i.test(key)) return "Botany";
  if (/^zoo/i.test(key)) return "Zoology";
  if (/^bio/i.test(key)) return "Biology";
  if (/^varc$/i.test(key)) return "VARC";
  if (/^dilr$/i.test(key)) return "DILR";
  if (/^qa$/i.test(key)) return "QA";
  if (/^quantitative aptitude\s*\(\s*qa\s*\)$/i.test(key)) return "QA";
  if (/^quantitative ability$/i.test(key)) return "QA";
  if (/^quant$/i.test(key) || /^quantitative reasoning/i.test(key))
    return "Quant";
  if (/^verbal$/i.test(key) || /^verbal reasoning/i.test(key)) return "Verbal";
  if (/^di$/i.test(key) || /^data insights/i.test(key)) return "Data Insights";
  if (/^english(\s+language)?$/i.test(key)) return "English";
  if (/^current affairs/i.test(key) || /^gk$/i.test(key) || /^general knowledge/i.test(key))
    return "Current Affairs";
  if (/^legal(\s+reasoning)?$/i.test(key)) return "Legal Reasoning";
  if (/^logical(\s+reasoning)?$/i.test(key)) return "Logical Reasoning";
  if (/^quantitative techniques$/i.test(key)) return "Quantitative Techniques";
  if (/^quantitative aptitude$/i.test(key)) return "Quantitative Aptitude";
  if (/^reasoning(\s+ability)?$/i.test(key)) return "Reasoning Ability";
  if (
    /^general intelligence/i.test(key) ||
    /^gir$/i.test(key)
  ) {
    return "Reasoning";
  }
  if (/^general awareness$/i.test(key) || /^ga$/i.test(key))
    return "General Awareness";
  if (/^english comprehension$/i.test(key)) return "English Comprehension";
  if (/^mathematical abilities$/i.test(key)) return "Mathematical Abilities";
  if (/^english language/i.test(key)) return "English Language";
  if (/^computer knowledge$/i.test(key) || /^computer$/i.test(key))
    return "Computer Knowledge";
  if (/^reasoning and general intelligence$/i.test(key)) return "Reasoning";
  if (/^history$/i.test(key)) return "History";
  if (/^polity$/i.test(key)) return "Polity";
  if (/^geography$/i.test(key)) return "Geography";
  if (/^economy$/i.test(key)) return "Economy";
  if (/^environment$/i.test(key)) return "Environment";
  if (/^science(\s*&\s*technology)?$/i.test(key)) return "Science";
  if (/verbal ability|reading comprehension/i.test(key)) return "VARC";
  if (/^dilr\b|data interpretation and logical reasoning/i.test(key))
    return "DILR";
  if (/quantitative ability/i.test(key)) return "QA";
  return key.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

const normalizeRelevance = (value) => {
  const r = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/-/g, " ");
  if (r === "very high" || r === "veryhigh") return "high";
  if (r === "high" || r === "medium" || r === "low") return r;
  if (r === "medium high" || r === "mediumhigh") return "medium";
  if (r === "low medium" || r === "lowmedium") return "low";
  return null;
};

/**
 * Map scoring JSON entry → embedded scoring subdoc.
 * Supports Advanced, Main, NEET, CAT, GMAT, CLAT, IBPS, SSC CGL, and UPSC (freq band / relevance_tier).
 */
export const mapScoringEntry = (raw = null) => {
  if (!raw || typeof raw !== "object") return undefined;
  const advancedRelevance = normalizeRelevance(raw.advanced_relevance);
  const relevance =
    advancedRelevance ||
    normalizeRelevance(raw.relevance) ||
    normalizeRelevance(raw.relevance_tier) ||
    normalizeRelevance(raw.jee_main_freq_band) ||
    normalizeRelevance(raw.neet_freq_band) ||
    normalizeRelevance(raw.cat_freq_band) ||
    normalizeRelevance(raw.gmat_freq_band) ||
    normalizeRelevance(raw.clat_freq_band) ||
    normalizeRelevance(raw.ibps_freq_band) ||
    normalizeRelevance(raw.ssc_freq_band) ||
    normalizeRelevance(raw.prelims_freq_band) ||
    normalizeRelevance(raw.upsc_freq_band) ||
    normalizeRelevance(raw.freq_band) ||
    normalizeRelevance(raw.freqBand);
  const split = raw.difficulty_split || raw.difficultySplit || null;
  return {
    relevance,
    advancedRelevance: advancedRelevance || null,
    freqBand:
      raw.prelims_freq_band ||
      raw.upsc_freq_band ||
      raw.ssc_freq_band ||
      raw.ibps_freq_band ||
      raw.clat_freq_band ||
      raw.gmat_freq_band ||
      raw.relevance_tier ||
      raw.cat_freq_band ||
      raw.neet_freq_band ||
      raw.jee_main_freq_band ||
      raw.freq_band ||
      raw.freqBand ||
      null,
    avgQPerSession:
      raw.avg_q_per_paper ||
      raw.avg_q_per_slot ||
      raw.avg_q_per_session_neet ||
      raw.avg_q_per_session_jee_main ||
      raw.avg_q_per_session ||
      raw.avgQPerSession ||
      null,
    difficultySplit: split
      ? {
          easy: Number.isFinite(Number(split.easy)) ? Number(split.easy) : null,
          medium: Number.isFinite(Number(split.medium))
            ? Number(split.medium)
            : null,
          hard: Number.isFinite(Number(split.hard)) ? Number(split.hard) : null,
        }
      : undefined,
    notes: String(raw.notes || "").trim(),
  };
};

const flattenAdvancedTopics = (topics = [], scoringById = {}) =>
  topics.map((topic, index) => {
    const topicId = topic.topic_id || topic.topicId || null;
    const scoring = mapScoringEntry(
      (topicId && scoringById[topicId]) || topic.scoring || null
    );
    return {
      topicId,
      unit: topicId,
      title: String(
        topic.chapter || topic.area || topic.topic || topic.title || ""
      ).trim(),
      content: Array.isArray(topic.subtopics) ? topic.subtopics.join("; ") : "",
      branch: topic.branch ? String(topic.branch).trim() : null,
      classLevel: topic.class_level
        ? String(topic.class_level)
        : topic.classLevel
          ? String(topic.classLevel)
          : null,
      subtopics: Array.isArray(topic.subtopics) ? topic.subtopics : [],
      order: index,
      ...(scoring ? { scoring } : {}),
    };
  });

const upsertPack = async (payload) => {
  const highRelevanceCount = (payload.topics || []).filter(
    (t) => String(t.scoring?.relevance || "").toLowerCase() === "high"
  ).length;
  const doc = {
    ...payload,
    topicCount: (payload.topics || []).length,
    highRelevanceCount,
  };
  return ExamSyllabusPack.findOneAndUpdate(
    {
      examType: doc.examType,
      subject: doc.subject,
      paper: doc.paper || "",
      year: doc.year,
    },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const packPaths = (relativeSyllabus, relativeScoring = null) => {
  const root = path.resolve(__dirname, "../..");
  const syllabus = resolveExisting([
    path.resolve(process.cwd(), relativeSyllabus),
    path.join(root, relativeSyllabus),
  ]);
  const scoring = relativeScoring
    ? resolveExisting([
        path.resolve(process.cwd(), relativeScoring),
        path.join(root, relativeScoring),
      ])
    : null;
  return { syllabus, scoring };
};

const seedSubjectPack = async ({
  examType,
  examLabel,
  paper,
  subject,
  syllabusRel,
  scoringRel = null,
}) => {
  const { syllabus: syllabusPath, scoring: scoringPath } = packPaths(
    syllabusRel,
    scoringRel
  );
  if (!syllabusPath) {
    console.warn(`ExamSyllabusPack: missing syllabus file ${syllabusRel}`);
    return null;
  }
  const syllabus = readJson(syllabusPath);
  const scoring = scoringPath ? readJson(scoringPath) : null;
  const scoringById =
    scoring?.topics && typeof scoring.topics === "object" ? scoring.topics : {};
  const topics = flattenAdvancedTopics(syllabus.topics || [], scoringById).filter(
    (t) => t.title
  );

  const doc = await upsertPack({
    examType,
    examLabel,
    paper: paper || "",
    subject: titleCaseSubject(subject),
    year: 2026,
    source: syllabus.source_note || syllabusRel,
    scoringSource: scoringPath ? scoringRel : "",
    examContext: scoring?.exam_context || "",
    dataProvenance: scoring?.data_provenance || "",
    topics,
    isActive: true,
  });

  return {
    examType: doc.examType,
    subject: doc.subject,
    topics: doc.topicCount,
    high: doc.highRelevanceCount,
    scoringAttached: Boolean(scoringPath),
  };
};

/** @deprecated use seedSubjectPack — kept name for callers */
const seedAdvancedSubject = async ({ subject, syllabusRel, scoringRel = null }) =>
  seedSubjectPack({
    examType: "jee_advanced",
    examLabel: "JEE Advanced",
    paper: "Both papers (Paper 1 & Paper 2)",
    subject,
    syllabusRel,
    scoringRel,
  });

const MAIN_SEED_DIR = "jee main exam all seed files";
const NEET_SEED_DIR = "NEET EXAM ALL SEED REQUIRED FILES";
const CAT_SEED_DIR = "CAT exam seed files";
const GMAT_SEED_DIR = "GMAT EXAM  SEED DATA";

const GMAT_SECTION_SUBJECT = {
  Q: "Quant",
  V: "Verbal",
  DI: "Data Insights",
};

/** GMAT Focus: one combined syllabus JSON → 3 section packs; scoring from quotas relevance_tier. */
const seedGmatSectionPacks = async () => {
  const syllabusRel = `${GMAT_SEED_DIR}/gmat_syllabus_2026.json`;
  const quotasRel = `${GMAT_SEED_DIR}/gmat_question_type_quotas_2026.json`;
  const scoringRel = `${GMAT_SEED_DIR}/gmat_scoring_2026.json`;
  const { syllabus: syllabusPath, scoring: quotasPath } = packPaths(
    syllabusRel,
    quotasRel
  );
  const scoringMetaPath = packPaths(scoringRel).syllabus;
  if (!syllabusPath) {
    console.warn(`ExamSyllabusPack: missing GMAT syllabus ${syllabusRel}`);
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringMeta = scoringMetaPath ? readJson(scoringMetaPath) : null;
  const out = [];

  for (const section of syllabus.sections || []) {
    const sectionId = String(section.section_id || "").toUpperCase();
    const subject =
      GMAT_SECTION_SUBJECT[sectionId] ||
      titleCaseSubject(section.section_name || sectionId);
    const quotaTopics =
      quotas?.sections?.[sectionId]?.topics ||
      quotas?.sections?.[section.section_id]?.topics ||
      {};
    const scoringById = {};
    for (const [topicId, row] of Object.entries(quotaTopics)) {
      scoringById[topicId] = {
        relevance_tier: row.relevance_tier || row.relevance || null,
        gmat_freq_band: row.relevance_tier || null,
        notes: row.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(
      section.topics || [],
      scoringById
    ).filter((t) => t.title);

    const doc = await upsertPack({
      examType: "gmat",
      examLabel: "GMAT Focus Edition",
      paper: "GMAT Focus Edition",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: quotasPath ? quotasRel : "",
      examContext: scoringMeta?.exam_context || "",
      dataProvenance: scoringMeta?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(quotasPath),
    });
  }

  return out;
};

const CLAT_SEED_DIR = "CLAT EXAM SEED FILES";

const CLAT_SECTION_SUBJECT = {
  ENG: "English",
  CA: "Current Affairs",
  LEGAL: "Legal Reasoning",
  LOGIC: "Logical Reasoning",
  QUANT: "Quantitative Techniques",
};

/** CLAT UG: one combined syllabus JSON → 5 section packs; section-level relevance_tier. */
const seedClatSectionPacks = async () => {
  const syllabusRel = `${CLAT_SEED_DIR}/clat_syllabus_2026.json`;
  const quotasRel = `${CLAT_SEED_DIR}/clat_question_type_quotas_2026.json`;
  const scoringRel = `${CLAT_SEED_DIR}/clat_scoring_2026.json`;
  const { syllabus: syllabusPath, scoring: quotasPath } = packPaths(
    syllabusRel,
    quotasRel
  );
  const scoringMetaPath = packPaths(scoringRel).syllabus;
  if (!syllabusPath) {
    console.warn(`ExamSyllabusPack: missing CLAT syllabus ${syllabusRel}`);
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringMeta = scoringMetaPath ? readJson(scoringMetaPath) : null;
  const out = [];

  for (const section of syllabus.sections || []) {
    const sectionId = String(section.section_id || "").toUpperCase();
    const subject =
      CLAT_SECTION_SUBJECT[sectionId] ||
      titleCaseSubject(section.section_name || sectionId);
    const sectionQuota =
      quotas?.sections?.[sectionId] ||
      quotas?.sections?.[section.section_id] ||
      {};
    const sectionRelevance =
      sectionQuota.relevance_tier || sectionQuota.relevance || null;
    const scoringById = {};
    for (const topic of section.topics || []) {
      const topicId = topic.topic_id || topic.topicId;
      if (!topicId) continue;
      scoringById[topicId] = {
        relevance_tier: sectionRelevance,
        clat_freq_band: sectionRelevance,
        notes: sectionQuota.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(
      section.topics || [],
      scoringById
    ).filter((t) => t.title);

    const doc = await upsertPack({
      examType: "clat",
      examLabel: "CLAT UG",
      paper: "CLAT UG Paper",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: quotasPath ? quotasRel : "",
      examContext: scoringMeta?.exam_context || "",
      dataProvenance: scoringMeta?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(quotasPath),
    });
  }

  return out;
};

const IBPS_SEED_DIR = "IBPS PO prelims syllabus and seed file";

const IBPS_SECTION_SUBJECT = {
  ENG: "English",
  QUANT: "Quantitative Aptitude",
  REASON: "Reasoning Ability",
};

/** IBPS PO Prelims: one combined syllabus JSON → 3 section packs; topic/section relevance_tier. */
const seedIbpsSectionPacks = async () => {
  const syllabusRel = `${IBPS_SEED_DIR}/ibps_po_prelims_syllabus_2026.json`;
  const quotasRel = `${IBPS_SEED_DIR}/ibps_po_prelims_question_type_quotas_2026.json`;
  const scoringRel = `${IBPS_SEED_DIR}/ibps_po_prelims_scoring_2026.json`;
  const { syllabus: syllabusPath, scoring: quotasPath } = packPaths(
    syllabusRel,
    quotasRel
  );
  const scoringMetaPath = packPaths(scoringRel).syllabus;
  if (!syllabusPath) {
    console.warn(`ExamSyllabusPack: missing IBPS syllabus ${syllabusRel}`);
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringMeta = scoringMetaPath ? readJson(scoringMetaPath) : null;
  const out = [];

  for (const section of syllabus.sections || []) {
    const sectionId = String(section.section_id || "").toUpperCase();
    const subject =
      IBPS_SECTION_SUBJECT[sectionId] ||
      titleCaseSubject(section.section_name || sectionId);
    const sectionQuota =
      quotas?.sections?.[sectionId] ||
      quotas?.sections?.[section.section_id] ||
      {};
    const sectionRelevance =
      sectionQuota.relevance_tier || sectionQuota.relevance || null;
    const quotaTopics = sectionQuota.topics || {};
    const scoringById = {};
    for (const topic of section.topics || []) {
      const topicId = topic.topic_id || topic.topicId;
      if (!topicId) continue;
      const row = quotaTopics[topicId] || {};
      const relevance =
        row.relevance_tier || row.relevance || sectionRelevance || null;
      scoringById[topicId] = {
        relevance_tier: relevance,
        ibps_freq_band: relevance,
        notes: row.notes || sectionQuota.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(
      section.topics || [],
      scoringById
    ).filter((t) => t.title);

    const doc = await upsertPack({
      examType: "ibps",
      examLabel: "IBPS PO Prelims",
      paper: "IBPS PO Prelims",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: quotasPath ? quotasRel : "",
      examContext: scoringMeta?.exam_context || "",
      dataProvenance: scoringMeta?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(quotasPath),
    });
  }

  return out;
};

const SSC_CGL_T1_SEED_DIR = "ssc cgl tier 1 question paper";

const SSC_CGL_T1_SECTION_SUBJECT = {
  GIR: "Reasoning",
  GA: "General Awareness",
  QA: "Quantitative Aptitude",
  ENG: "English Comprehension",
};

/** SSC CGL Tier 1: one combined syllabus JSON → 4 section packs. */
const seedSscCglTier1SectionPacks = async () => {
  const syllabusRel = `${SSC_CGL_T1_SEED_DIR}/ssc_cgl_tier1_syllabus_2026.json`;
  const quotasRel = `${SSC_CGL_T1_SEED_DIR}/ssc_cgl_tier1_question_type_quotas_2026.json`;
  const scoringRel = `${SSC_CGL_T1_SEED_DIR}/ssc_cgl_tier1_scoring_2026.json`;
  const { syllabus: syllabusPath, scoring: quotasPath } = packPaths(
    syllabusRel,
    quotasRel
  );
  const scoringMetaPath = packPaths(scoringRel).syllabus;
  if (!syllabusPath) {
    console.warn(
      `ExamSyllabusPack: missing SSC CGL Tier 1 syllabus ${syllabusRel}`
    );
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringMeta = scoringMetaPath ? readJson(scoringMetaPath) : null;
  const out = [];

  for (const section of syllabus.sections || []) {
    const sectionId = String(section.section_id || "").toUpperCase();
    const subject =
      SSC_CGL_T1_SECTION_SUBJECT[sectionId] ||
      titleCaseSubject(section.section_name || sectionId);
    const sectionQuota =
      quotas?.sections?.[sectionId] ||
      quotas?.sections?.[section.section_id] ||
      {};
    const sectionRelevance =
      sectionQuota.relevance_tier || sectionQuota.relevance || null;
    const quotaTopics = sectionQuota.topics || {};
    const scoringById = {};
    for (const topic of section.topics || []) {
      const topicId = topic.topic_id || topic.topicId;
      if (!topicId) continue;
      const row = quotaTopics[topicId] || {};
      const relevance =
        row.relevance_tier || row.relevance || sectionRelevance || null;
      scoringById[topicId] = {
        relevance_tier: relevance,
        ssc_freq_band: relevance,
        notes: row.notes || sectionQuota.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(
      section.topics || [],
      scoringById
    ).filter((t) => t.title);

    const doc = await upsertPack({
      examType: "ssc_cgl_tier1",
      examLabel: "SSC CGL Tier 1",
      paper: "SSC CGL Tier 1",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: quotasPath ? quotasRel : "",
      examContext: scoringMeta?.exam_context || "",
      dataProvenance: scoringMeta?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(quotasPath),
    });
  }

  return out;
};

const SSC_CGL_T2_SEED_DIR = "ssc cgl tier 2 question paper";

const SSC_CGL_T2_SECTION_SUBJECT = {
  MATH: "Mathematical Abilities",
  REASON: "Reasoning",
  ENG: "English Language",
  GA: "General Awareness",
  COMP: "Computer Knowledge",
};

/** SSC CGL Tier 2 Paper I: one combined syllabus JSON → 5 section packs. */
const seedSscCglTier2SectionPacks = async () => {
  const syllabusRel = `${SSC_CGL_T2_SEED_DIR}/ssc_cgl_tier2_syllabus_2026.json`;
  const quotasRel = `${SSC_CGL_T2_SEED_DIR}/ssc_cgl_tier2_question_type_quotas_2026.json`;
  const scoringRel = `${SSC_CGL_T2_SEED_DIR}/ssc_cgl_tier2_scoring_2026.json`;
  const { syllabus: syllabusPath, scoring: quotasPath } = packPaths(
    syllabusRel,
    quotasRel
  );
  const scoringMetaPath = packPaths(scoringRel).syllabus;
  if (!syllabusPath) {
    console.warn(
      `ExamSyllabusPack: missing SSC CGL Tier 2 syllabus ${syllabusRel}`
    );
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringMeta = scoringMetaPath ? readJson(scoringMetaPath) : null;
  const out = [];

  for (const section of syllabus.sections || []) {
    const sectionId = String(section.section_id || "").toUpperCase();
    const subject =
      SSC_CGL_T2_SECTION_SUBJECT[sectionId] ||
      titleCaseSubject(section.section_name || sectionId);
    const sectionQuota =
      quotas?.sections?.[sectionId] ||
      quotas?.sections?.[section.section_id] ||
      {};
    const sectionRelevance =
      sectionQuota.relevance_tier || sectionQuota.relevance || null;
    const quotaTopics = sectionQuota.topics || {};
    const scoringById = {};
    for (const topic of section.topics || []) {
      const topicId = topic.topic_id || topic.topicId;
      if (!topicId) continue;
      const row = quotaTopics[topicId] || {};
      const relevance =
        row.relevance_tier || row.relevance || sectionRelevance || null;
      scoringById[topicId] = {
        relevance_tier: relevance,
        ssc_freq_band: relevance,
        notes: row.notes || sectionQuota.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(
      section.topics || [],
      scoringById
    ).filter((t) => t.title);

    const doc = await upsertPack({
      examType: "ssc_cgl_tier2",
      examLabel: "SSC CGL Tier 2",
      paper: "SSC CGL Tier 2 Paper I",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: quotasPath ? quotasRel : "",
      examContext: scoringMeta?.exam_context || "",
      dataProvenance: scoringMeta?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(quotasPath),
    });
  }

  return out;
};

/** Trailing space matches on-disk seed folder name. */
const UPSC_SEED_DIR = "UPSC CSE Prelims ";

const UPSC_CATEGORY_ORDER = [
  "History",
  "Polity",
  "Geography",
  "Economy",
  "Environment",
  "Science",
  "Current Affairs",
];

/** UPSC CSE Prelims GS Paper I: flat topic list → one pack per GS category. */
const seedUpscCategoryPacks = async () => {
  const syllabusRel = `${UPSC_SEED_DIR}/upsc_gs_syllabus.json`;
  const scoringRel = `${UPSC_SEED_DIR}/upsc_gs_scoring.json`;
  const quotasRel = `${UPSC_SEED_DIR}/upsc_gs_question_type_quotas.json`;
  const { syllabus: syllabusPath, scoring: scoringPath } = packPaths(
    syllabusRel,
    scoringRel
  );
  const quotasPath = packPaths(quotasRel).syllabus;
  if (!syllabusPath) {
    console.warn(`ExamSyllabusPack: missing UPSC syllabus ${syllabusRel}`);
    return [];
  }

  const syllabus = readJson(syllabusPath);
  const scoring = scoringPath ? readJson(scoringPath) : null;
  const quotas = quotasPath ? readJson(quotasPath) : null;
  const scoringTopics =
    scoring?.topics && typeof scoring.topics === "object" ? scoring.topics : {};
  const quotaTopics =
    quotas?.topics && typeof quotas.topics === "object" ? quotas.topics : {};

  const byCategory = new Map();
  for (const topic of syllabus.topics || []) {
    const category = titleCaseSubject(topic.category || "General Studies");
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(topic);
  }

  const ordered = [
    ...UPSC_CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !UPSC_CATEGORY_ORDER.includes(c)),
  ];

  const out = [];
  for (const subject of ordered) {
    const rows = byCategory.get(subject) || [];
    const scoringById = {};
    for (const topic of rows) {
      const topicId = topic.topic_id || topic.topicId;
      if (!topicId) continue;
      const fromScoring = scoringTopics[topicId] || {};
      const fromQuota = quotaTopics[topicId] || {};
      scoringById[topicId] = {
        ...fromQuota,
        ...fromScoring,
        advanced_relevance:
          fromScoring.advanced_relevance ||
          fromQuota.advanced_relevance ||
          null,
        prelims_freq_band:
          fromScoring.prelims_freq_band ||
          fromQuota.prelims_freq_band ||
          null,
        notes: fromScoring.notes || fromQuota.notes || "",
      };
    }
    const topics = flattenAdvancedTopics(rows, scoringById).filter(
      (t) => t.title
    );

    const doc = await upsertPack({
      examType: "upsc",
      examLabel: "UPSC CSE Prelims",
      paper: "UPSC CSE Prelims GS Paper I",
      subject,
      year: 2026,
      source: syllabus.source_note || syllabusRel,
      scoringSource: scoringPath ? scoringRel : quotasPath ? quotasRel : "",
      examContext: scoring?.exam_context || "",
      dataProvenance: scoring?.data_provenance || "",
      topics,
      isActive: true,
    });

    out.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: doc.topicCount,
      high: doc.highRelevanceCount,
      scoringAttached: Boolean(scoringPath || quotasPath),
    });
  }

  return out;
};

/**
 * Seed multi-exam syllabus packs with scoring.
 * - JEE Advanced / JEE Main / NEET / CAT / GMAT / CLAT / IBPS / SSC CGL Tier 1+2 / UPSC
 */
export const seedExamSyllabusPack = async () => {
  const results = [];

  const advanced = [
    {
      subject: "Mathematics",
      syllabusRel: "jee_advanced/maths_syllabus.json",
      scoringRel: "jee_advanced/maths_scoring.json",
    },
    {
      subject: "Physics",
      syllabusRel: "jee_advanced/physics/physics_syllabus.json",
      scoringRel: "jee_advanced/physics/physics_scoring.json",
    },
    {
      subject: "Chemistry",
      syllabusRel: "jee_advanced/chemistry/chemistry_syllabus.json",
      scoringRel: null,
    },
  ];

  for (const row of advanced) {
    const seeded = await seedAdvancedSubject(row);
    if (seeded) results.push(seeded);
  }

  const mainSubjects = [
    {
      subject: "Mathematics",
      syllabusRel: `${MAIN_SEED_DIR}/maths_syllabus_jee_main.json`,
      scoringRel: `${MAIN_SEED_DIR}/maths_scoring_jee_main.json`,
    },
    {
      subject: "Physics",
      syllabusRel: `${MAIN_SEED_DIR}/physics_syllabus_jee_main.json`,
      scoringRel: `${MAIN_SEED_DIR}/physics_scoring_jee_main.json`,
    },
    {
      subject: "Chemistry",
      syllabusRel: `${MAIN_SEED_DIR}/chemistry_syllabus_jee_main.json`,
      scoringRel: `${MAIN_SEED_DIR}/chemistry_scoring_jee_main.json`,
    },
  ];

  for (const row of mainSubjects) {
    const seeded = await seedSubjectPack({
      examType: "jee_main",
      examLabel: "JEE Main",
      paper: "Paper 1 (B.E./B.Tech)",
      ...row,
    });
    if (seeded) results.push(seeded);
  }

  const neetSubjects = [
    {
      subject: "Physics",
      syllabusRel: `${NEET_SEED_DIR}/neet_syllabus_physics.json`,
      scoringRel: `${NEET_SEED_DIR}/neet_scoring_physics.json`,
    },
    {
      subject: "Chemistry",
      syllabusRel: `${NEET_SEED_DIR}/neet_syllabus_chemistry.json`,
      scoringRel: `${NEET_SEED_DIR}/neet_scoring_chemistry.json`,
    },
    {
      subject: "Botany",
      syllabusRel: `${NEET_SEED_DIR}/neet_syllabus_botany.json`,
      scoringRel: `${NEET_SEED_DIR}/neet_scoring_botany.json`,
    },
    {
      subject: "Zoology",
      syllabusRel: `${NEET_SEED_DIR}/neet_syllabus_zoology.json`,
      scoringRel: `${NEET_SEED_DIR}/neet_scoring_zoology.json`,
    },
  ];

  for (const row of neetSubjects) {
    const seeded = await seedSubjectPack({
      examType: "neet",
      examLabel: "NEET UG",
      paper: "NEET UG Paper",
      ...row,
    });
    if (seeded) results.push(seeded);
  }

  const catSubjects = [
    {
      subject: "VARC",
      syllabusRel: `${CAT_SEED_DIR}/cat_syllabus_varc.json`,
      scoringRel: `${CAT_SEED_DIR}/cat_scoring_varc.json`,
    },
    {
      subject: "DILR",
      syllabusRel: `${CAT_SEED_DIR}/cat_syllabus_dilr.json`,
      scoringRel: `${CAT_SEED_DIR}/cat_scoring_dilr.json`,
    },
    {
      subject: "QA",
      syllabusRel: `${CAT_SEED_DIR}/cat_syllabus_qa.json`,
      scoringRel: `${CAT_SEED_DIR}/cat_scoring_qa.json`,
    },
  ];

  for (const row of catSubjects) {
    const seeded = await seedSubjectPack({
      examType: "cat",
      examLabel: "CAT",
      paper: "CAT Slot Paper",
      ...row,
    });
    if (seeded) results.push(seeded);
  }

  const gmatPacks = await seedGmatSectionPacks();
  results.push(...gmatPacks);

  const clatPacks = await seedClatSectionPacks();
  results.push(...clatPacks);

  const ibpsPacks = await seedIbpsSectionPacks();
  results.push(...ibpsPacks);

  const sscT1Packs = await seedSscCglTier1SectionPacks();
  results.push(...sscT1Packs);

  const sscT2Packs = await seedSscCglTier2SectionPacks();
  results.push(...sscT2Packs);

  const upscPacks = await seedUpscCategoryPacks();
  results.push(...upscPacks);

  console.log(
    `Seeded ExamSyllabusPack: ${results
      .map(
        (r) =>
          `${r.examType}/${r.subject} (${r.topics} topics, ${r.high} HIGH${
            r.scoringAttached ? ", scoring" : ", no scoring"
          })`
      )
      .join("; ") || "none"}`
  );

  return { seeded: true, packs: results };
};

export default seedExamSyllabusPack;
