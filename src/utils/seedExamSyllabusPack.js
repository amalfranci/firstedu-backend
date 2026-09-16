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
  return key.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

const normalizeRelevance = (value) => {
  const r = String(value || "")
    .trim()
    .toLowerCase();
  if (r === "high" || r === "medium" || r === "low") return r;
  return null;
};

/**
 * Map Advanced scoring JSON entry → embedded scoring subdoc.
 * Keeps advancedRelevance for pack parity; relevance is the portable lock field.
 */
export const mapScoringEntry = (raw = null) => {
  if (!raw || typeof raw !== "object") return undefined;
  const advancedRelevance = normalizeRelevance(raw.advanced_relevance);
  const relevance = advancedRelevance || normalizeRelevance(raw.relevance);
  const split = raw.difficulty_split || raw.difficultySplit || null;
  return {
    relevance,
    advancedRelevance,
    freqBand: raw.jee_main_freq_band || raw.freq_band || raw.freqBand || null,
    avgQPerSession:
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
      title: String(topic.chapter || topic.title || "").trim(),
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

const seedAdvancedSubject = async ({
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
    examType: "jee_advanced",
    examLabel: "JEE Advanced",
      paper: "Both papers (Paper 1 & Paper 2)",
    subject: titleCaseSubject(subject),
    year: 2026,
    source: syllabus.source_note || syllabusRel,
    scoringSource: scoringPath
      ? scoringRel
      : scoring
        ? scoringRel
        : "",
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

/**
 * Seed multi-exam syllabus packs with scoring.
 * Currently: JEE Advanced Mathematics / Physics / Chemistry.
 * Chemistry has syllabus only (no scoring file yet).
 */
export const seedExamSyllabusPack = async () => {
  const results = [];

  const maths = await seedAdvancedSubject({
    subject: "Mathematics",
    syllabusRel: "jee_advanced/maths_syllabus.json",
    scoringRel: "jee_advanced/maths_scoring.json",
  });
  if (maths) results.push(maths);

  const physics = await seedAdvancedSubject({
    subject: "Physics",
    syllabusRel: "jee_advanced/physics/physics_syllabus.json",
    scoringRel: "jee_advanced/physics/physics_scoring.json",
  });
  if (physics) results.push(physics);

  const chemistry = await seedAdvancedSubject({
    subject: "Chemistry",
    syllabusRel: "jee_advanced/chemistry/chemistry_syllabus.json",
    scoringRel: null,
  });
  if (chemistry) results.push(chemistry);

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
