import JeeExamSyllabus from "../models/JeeExamSyllabus.js";
import { detectExamProfile } from "./examDifficultyCalibration.js";
import { resolveGenerationSubject } from "./subjectDetection.js";
import { getExamLabel } from "./examPromptContext.service.js";

const SEEDED_EXAM_TYPES = new Set(["jee_main", "jee_advanced"]);
const GENERIC_EXAM_PROFILES = new Set(["competitive", "board"]);

const SUBJECT_CANONICAL = {
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  physics: "Physics",
  chemistry: "Chemistry",
};

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const normalizeExamType = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (
    raw === "jee_main" ||
    raw === "jeemain" ||
    raw === "main" ||
    raw === "jee_mains"
  ) {
    return "jee_main";
  }
  if (
    raw === "jee_advanced" ||
    raw === "jeeadvanced" ||
    raw === "jee_advance" ||
    raw === "advance" ||
    raw === "advanced"
  ) {
    return "jee_advanced";
  }
  if (raw === "neet" || raw === "neet_ug" || raw === "neetug") return "neet";
  if (raw === "cat") return "cat";
  if (raw === "clat") return "clat";
  if (raw === "upsc") return "upsc";
  if (raw === "ibps" || raw === "banking") return "banking";
  return raw;
};

export const asQueryList = (value) => {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(asQueryList);
  return String(value)
    .split(/\s*\|\s*|,/)
    .map((part) => part.trim())
    .filter(Boolean);
};

export const canonicalizeSubject = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "");
  if (SUBJECT_CANONICAL[key]) return SUBJECT_CANONICAL[key];
  if (SUBJECT_CANONICAL[raw.toLowerCase()]) return SUBJECT_CANONICAL[raw.toLowerCase()];
  return raw.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
};

export const inferPaperNumber = ({
  paper,
  paperNumber,
  categoryPath,
  categoryPaths,
  bankName,
  topic,
} = {}) => {
  const explicit = paperNumber ?? paper;
  if (explicit != null && String(explicit).trim() !== "") {
    if (String(explicit).toLowerCase().includes("2") || Number(explicit) === 2) {
      return 2;
    }
    if (String(explicit).toLowerCase().includes("1") || Number(explicit) === 1) {
      return 1;
    }
  }
  const paths = [...asQueryList(categoryPath), ...asQueryList(categoryPaths)];
  const hay = `${paths.join(" ")} ${bankName || ""} ${topic || ""}`.toLowerCase();
  if (/paper\s*[_\s-]*2\b|paper_2|\bp2\b/.test(hay)) return 2;
  if (/paper\s*[_\s-]*1\b|paper_1|\bp1\b/.test(hay)) return 1;
  return null;
};

export const inferExamAndSubject = ({
  examType,
  exam,
  subject,
  categoryPath,
  categoryPaths,
  paper,
  paperNumber,
} = {}) => {
  const paths = [...asQueryList(categoryPath), ...asQueryList(categoryPaths)];
  const hay = paths[0] || "";
  const detectedExam = detectExamProfile({
    bankName: hay,
    topic: hay,
    categoryPaths: paths,
  });
  const resolvedSubject = resolveGenerationSubject({
    bankName: hay,
    topic: "",
    categoryPaths: paths,
  });

  const explicitExam = normalizeExamType(examType || exam);
  const inferredExam =
    detectedExam && !GENERIC_EXAM_PROFILES.has(detectedExam)
      ? detectedExam
      : null;

  const explicitSubject = canonicalizeSubject(subject);
  const inferredSubject =
    canonicalizeSubject(resolvedSubject?.label) ||
    canonicalizeSubject(resolvedSubject?.id);

  return {
    examType: explicitExam || inferredExam || null,
    subject: explicitSubject || inferredSubject || null,
    paperNumber: inferPaperNumber({
      paper,
      paperNumber,
      categoryPath,
      categoryPaths,
      bankName: hay,
    }),
    categoryPaths: paths,
  };
};

const mapTopic = (topic, subject) => ({
  topicId: topic?.topicId || null,
  unit: topic?.unit || null,
  title: String(topic?.title || "").trim(),
  content: String(topic?.content || "").trim(),
  branch: topic?.branch || null,
  classLevel: topic?.classLevel || null,
  subtopics: Array.isArray(topic?.subtopics) ? topic.subtopics : [],
  order: Number.isFinite(Number(topic?.order)) ? Number(topic.order) : 0,
  subject,
  label: String(topic?.title || "").trim(),
});

const summarizeAvailableExams = (docs = []) => {
  const byExam = new Map();
  for (const doc of docs) {
    if (!doc?.examType) continue;
    if (!byExam.has(doc.examType)) {
      byExam.set(doc.examType, {
        examType: doc.examType,
        examLabel: doc.examLabel || getExamLabel(doc.examType),
        subjects: [],
      });
    }
    const entry = byExam.get(doc.examType);
    if (doc.subject && !entry.subjects.includes(doc.subject)) {
      entry.subjects.push(doc.subject);
    }
  }
  return [...byExam.values()];
};

export const getAiPoweredTestExamTopics = async (query = {}) => {
  const inferred = inferExamAndSubject(query);
  const { examType, subject } = inferred;

  const availableDocs = await JeeExamSyllabus.find({ isActive: true })
    .select("examType examLabel subject")
    .sort({ examType: 1, subject: 1 })
    .lean();
  const availableExams = summarizeAvailableExams(availableDocs);

  if (!examType) {
    return {
      examType: null,
      examLabel: null,
      subject: null,
      year: null,
      paper: "",
      hasSeededTopics: availableExams.length > 0,
      subjects: [],
      topics: [],
      availableExams,
    };
  }

  if (!SEEDED_EXAM_TYPES.has(examType)) {
    return {
      examType,
      examLabel: getExamLabel(examType),
      subject,
      year: null,
      paper: "",
      hasSeededTopics: false,
      subjects: [],
      topics: [],
      availableExams,
    };
  }

  const filter = { examType, isActive: true };
  if (subject) {
    filter.subject = new RegExp(`^${escapeRegex(subject)}$`, "i");
  }

  const docs = await JeeExamSyllabus.find(filter)
    .sort({ subject: 1 })
    .lean();

  const subjects = docs.map((doc) => ({
    subject: doc.subject,
    paper: doc.paper || "",
    year: doc.year || null,
    source: doc.source || "",
    topicCount: doc.topicCount || (doc.topics || []).length,
    topics: (doc.topics || [])
      .map((topic) => mapTopic(topic, doc.subject))
      .filter((topic) => topic.title),
  }));

  const topics = subjects.flatMap((entry) => entry.topics);

  return {
    examType,
    examLabel: docs[0]?.examLabel || getExamLabel(examType),
    subject,
    year: docs[0]?.year || null,
    paper: docs[0]?.paper || "",
    hasSeededTopics: topics.length > 0,
    subjects,
    topics,
    availableExams,
  };
};

export default getAiPoweredTestExamTopics;
