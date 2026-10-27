import JeeExamSyllabus from "../models/JeeExamSyllabus.js";
import ExamSyllabusPack from "../models/ExamSyllabusPack.js";
import { detectExamProfile } from "./examDifficultyCalibration.js";
import { resolveGenerationSubject } from "./subjectDetection.js";
import { getExamLabel } from "./examPromptContext.service.js";

const SEEDED_EXAM_TYPES = new Set([
  "jee_main",
  "jee_advanced",
  "neet",
  "cat",
  "gmat",
  "clat",
  "ibps",
  "ssc_cgl_tier1",
  "ssc_cgl_tier2",
  "upsc",
]);
const GENERIC_EXAM_PROFILES = new Set(["competitive", "board"]);

const SUBJECT_CANONICAL = {
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
  physics: "Physics",
  chemistry: "Chemistry",
  botany: "Botany",
  zoology: "Zoology",
  biology: "Biology",
  varc: "VARC",
  dilr: "DILR",
  qa: "QA",
  "quantitativeability": "QA",
  "quantitative ability": "QA",
  "quantitativeaptitude(qa)": "QA",
  "quantitative aptitude (qa)": "QA",
  "verbalabilityandreadingcomprehension": "VARC",
  "verbal ability and reading comprehension": "VARC",
  "datainterpretationandlogicalreasoning": "DILR",
  "data interpretation and logical reasoning": "DILR",
  quant: "Quant",
  quantitative: "Quant",
  "quantitativereasoning": "Quant",
  "quantitative reasoning": "Quant",
  verbal: "Verbal",
  "verbalreasoning": "Verbal",
  "verbal reasoning": "Verbal",
  "datainsights": "Data Insights",
  "data insights": "Data Insights",
  di: "Data Insights",
  english: "English",
  "englishlanguage": "English Language",
  "english language": "English Language",
  "currentaffairs": "Current Affairs",
  "current affairs": "Current Affairs",
  gk: "Current Affairs",
  "generalknowledge": "Current Affairs",
  "general knowledge": "Current Affairs",
  "currentaffairsincludinggeneralknowledge": "Current Affairs",
  "current affairs including general knowledge": "Current Affairs",
  legal: "Legal Reasoning",
  "legalreasoning": "Legal Reasoning",
  "legal reasoning": "Legal Reasoning",
  logical: "Logical Reasoning",
  "logicalreasoning": "Logical Reasoning",
  "logical reasoning": "Logical Reasoning",
  "quantitativetechniques": "Quantitative Techniques",
  "quantitative techniques": "Quantitative Techniques",
  "quantitativeaptitude": "Quantitative Aptitude",
  "quantitative aptitude": "Quantitative Aptitude",
  reasoning: "Reasoning Ability",
  "reasoningability": "Reasoning Ability",
  "reasoning ability": "Reasoning Ability",
  "generalintelligenceandreasoning": "Reasoning",
  "general intelligence and reasoning": "Reasoning",
  gir: "Reasoning",
  "generalawareness": "General Awareness",
  "general awareness": "General Awareness",
  ga: "General Awareness",
  "englishcomprehension": "English Comprehension",
  "english comprehension": "English Comprehension",
  "mathematicalabilities": "Mathematical Abilities",
  "mathematical abilities": "Mathematical Abilities",
  "englishlanguageandcomprehension": "English Language",
  "english language and comprehension": "English Language",
  "computerknowledge": "Computer Knowledge",
  "computer knowledge": "Computer Knowledge",
  computer: "Computer Knowledge",
  "reasoningandgeneralintelligence": "Reasoning",
  "reasoning and general intelligence": "Reasoning",
  history: "History",
  polity: "Polity",
  "indianpolity": "Polity",
  "indian polity": "Polity",
  geography: "Geography",
  economy: "Economy",
  "indianeconomy": "Economy",
  "indian economy": "Economy",
  environment: "Environment",
  ecology: "Environment",
  science: "Science",
  "scienceandtechnology": "Science",
  "science & technology": "Science",
  "science and technology": "Science",
};

const CANONICAL_SUBJECT_VALUES = new Set(Object.values(SUBJECT_CANONICAL));

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
  if (raw === "cat" || raw === "common_admission_test") return "cat";
  if (
    raw === "gmat" ||
    raw === "gmat_focus" ||
    raw === "gmat_focus_edition" ||
    raw === "gmatfocus"
  ) {
    return "gmat";
  }
  if (
    raw === "clat" ||
    raw === "clat_ug" ||
    raw === "clatug" ||
    raw === "common_law_admission_test"
  ) {
    return "clat";
  }
  if (
    raw === "ibps" ||
    raw === "ibps_po" ||
    raw === "ibps_po_prelims" ||
    raw === "ibpspoprelims" ||
    raw === "banking" ||
    raw === "bank_po"
  ) {
    return "ibps";
  }
  if (
    raw === "ssc_cgl_tier2" ||
    raw === "ssc_cgl_t2" ||
    raw === "ssccgltier2" ||
    raw === "ssc_cgl_tier_2" ||
    raw === "cgl_tier2" ||
    raw === "cgl_tier_2"
  ) {
    return "ssc_cgl_tier2";
  }
  if (
    raw === "ssc_cgl" ||
    raw === "ssc_cgl_tier1" ||
    raw === "ssc_cgl_t1" ||
    raw === "ssccgltier1" ||
    raw === "ssc_cgl_tier_1" ||
    raw === "cgl_tier1" ||
    raw === "cgl_tier_1"
  ) {
    return "ssc_cgl_tier1";
  }
  if (
    raw === "upsc" ||
    raw === "upsc_cse" ||
    raw === "upsc_cse_prelims" ||
    raw === "upsc_prelims" ||
    raw === "upscprelims" ||
    raw === "civil_services" ||
    raw === "civil_services_prelims"
  ) {
    return "upsc";
  }
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

export const isFullPaperOrMockLabel = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return (
    /^all\s*subjects$/i.test(raw) ||
    /^full\s*paper$/i.test(raw) ||
    /\bfull\s*mock\b/i.test(raw) ||
    /\bfull\s*mock\s*papers?\b/i.test(raw) ||
    /\bmock\s*papers?\b/i.test(raw) ||
    /\bmock\s*practice\b/i.test(raw) ||
    /\bmodel\s*paper\b/i.test(raw)
  );
};

export const canonicalizeSubject = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  // "All subjects" / full-paper leaves are not a subject filter.
  if (isFullPaperOrMockLabel(raw)) return null;
  const compact = raw.toLowerCase().replace(/[\s-]+/g, "");
  const spaced = raw.toLowerCase();
  if (SUBJECT_CANONICAL[compact]) return SUBJECT_CANONICAL[compact];
  if (SUBJECT_CANONICAL[spaced]) return SUBJECT_CANONICAL[spaced];

  // CAT section labels that include a parenthetical short name.
  if (/^quantitative\s+aptitude\s*\(\s*qa\s*\)$/i.test(raw)) return "QA";
  if (/^verbal\s+ability.*reading\s+comprehension/i.test(raw)) return "VARC";
  if (/^data\s+interpretation.*logical\s+reasoning/i.test(raw)) return "DILR";

  // UI sometimes sends the exam name as "subject" (e.g. CAT / CAT).
  const asExam = normalizeExamType(raw);
  if (asExam && SEEDED_EXAM_TYPES.has(asExam)) return null;

  return raw.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
};

/** Alternate subject labels stored on syllabus packs for the same section. */
export const subjectLookupAliases = (subject, examType = null) => {
  const canonical = canonicalizeSubject(subject) || String(subject || "").trim();
  if (!canonical) return [];
  const aliases = new Set([canonical, String(subject || "").trim()]);
  const exam = normalizeExamType(examType);

  if (/reasoning/i.test(canonical) || /logical/i.test(canonical)) {
    aliases.add("Reasoning");
    aliases.add("Reasoning Ability");
    aliases.add("Logical Reasoning");
    aliases.add("General Intelligence and Reasoning");
    aliases.add("General Intelligence & Reasoning");
    aliases.add("DILR");
  }
  if (/quant/i.test(canonical) || /math/i.test(canonical) || canonical === "QA") {
    aliases.add("QA");
    aliases.add("Qa");
    aliases.add("Quantitative Aptitude");
    aliases.add("Quantitative Ability");
    aliases.add("Quantitative Aptitude (QA)");
    aliases.add("Mathematical Abilities");
    aliases.add("Mathematics");
    aliases.add("Quant");
  }
  if (/english/i.test(canonical) || /verbal/i.test(canonical) || canonical === "VARC") {
    aliases.add("VARC");
    aliases.add("Varc");
    aliases.add("English Comprehension");
    aliases.add("English Language");
    aliases.add("English");
    aliases.add("Verbal Ability and Reading Comprehension");
  }
  if (/awareness|knowledge|gk|ga/i.test(canonical)) {
    aliases.add("General Awareness");
    aliases.add("General Knowledge");
    aliases.add("GA");
    aliases.add("Current Affairs");
    aliases.add("Computer Knowledge");
  }

  return [...aliases].filter(Boolean);
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
  subjects,
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
  const currentExam = explicitExam || inferredExam || null;

  // Extract candidate subjects from query and leaf segments of each category path
  const candidateSubjects = [];
  for (const raw of [...asQueryList(subjects), ...asQueryList(subject)]) {
    const can = canonicalizeSubject(raw);
    if (can && normalizeExamType(can) !== currentExam) {
      candidateSubjects.push(can);
    }
  }

  for (const p of paths) {
    const parts = String(p || "")
      .split(/[>›/|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) continue;
    const leaf = parts[parts.length - 1];
    const can = canonicalizeSubject(leaf);
    if (can && normalizeExamType(can) !== currentExam) {
      candidateSubjects.push(can);
    }
  }

  const uniqueSubjects = [...new Set(candidateSubjects)];

  let explicitSubject = canonicalizeSubject(subject);
  // Drop subject if it merely repeats the exam name.
  if (
    explicitSubject &&
    !CANONICAL_SUBJECT_VALUES.has(explicitSubject) &&
    normalizeExamType(explicitSubject) === currentExam
  ) {
    explicitSubject = null;
  }

  let finalSubject = null;
  let finalSubjects = uniqueSubjects;

  // Explicit canonical subject (e.g. wizard subject=Chemistry) wins over a
  // conflicting leaf in categoryPath (e.g. "... > Physics").
  if (explicitSubject && CANONICAL_SUBJECT_VALUES.has(explicitSubject)) {
    finalSubject = explicitSubject;
    finalSubjects = uniqueSubjects.includes(explicitSubject)
      ? uniqueSubjects
      : [explicitSubject, ...uniqueSubjects];
  } else if (uniqueSubjects.length === 1) {
    finalSubject = uniqueSubjects[0];
  } else if (uniqueSubjects.length > 1) {
    // Multiple distinct subjects selected
    finalSubject = null;
    finalSubjects = uniqueSubjects;
  } else {
    // If the path was explicitly a full-mock / all-subjects leaf, do not infer a single subject
    const isMockPath = paths.some(p => {
      const parts = String(p || "").split(/[>›/|]/).map(s => s.trim()).filter(Boolean);
      return parts.length && isFullPaperOrMockLabel(parts[parts.length - 1]);
    });
    if (isMockPath) {
      finalSubject = null;
      finalSubjects = [];
    } else {
      // No subjects from paths/query, fallback to single resolved subject if any
      const inferredSubject =
        canonicalizeSubject(resolvedSubject?.label) ||
        canonicalizeSubject(resolvedSubject?.id);
      finalSubject = explicitSubject || inferredSubject || null;
      finalSubjects = finalSubject ? [finalSubject] : [];
    }
  }

  return {
    examType: currentExam,
    subject: finalSubject,
    subjects: finalSubjects,
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
  relevance: topic?.scoring?.relevance
    ? String(topic.scoring.relevance).toLowerCase()
    : topic?.relevance
      ? String(topic.relevance).toLowerCase()
      : null,
  highLock:
    String(topic?.scoring?.relevance || topic?.relevance || "").toLowerCase() ===
    "high",
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

const docsToSubjectsPayload = (docs = []) => {
  // Dedupe by subject — seeders can upsert multiple packs when `paper` labels differ.
  const bySubject = new Map();
  for (const doc of docs || []) {
    const key = String(doc?.subject || "").trim();
    if (!key) continue;
    const prev = bySubject.get(key);
    const topicCount = doc.topicCount || (doc.topics || []).length || 0;
    if (
      !prev ||
      topicCount > (prev.topicCount || (prev.topics || []).length || 0)
    ) {
      bySubject.set(key, doc);
    }
  }
  return [...bySubject.values()].map((doc) => ({
    subject: doc.subject,
    paper: doc.paper || "",
    year: doc.year || null,
    source: doc.source || "",
    topicCount: doc.topicCount || (doc.topics || []).length,
    topics: (doc.topics || [])
      .map((topic) => mapTopic(topic, doc.subject))
      .filter((topic) => topic.title),
  }));
};

/**
 * Prefer ExamSyllabusPack (Main / NEET / CAT / Advanced scoring packs).
 * Fall back to legacy JeeExamSyllabus for older JEE-only seeds.
 */
const loadSeededSyllabusDocs = async (
  examType,
  subject = null,
  requestedSubjects = []
) => {
  const packFilter = { examType, isActive: true };
  const subjectsToFilter =
    Array.isArray(requestedSubjects) && requestedSubjects.length > 0
      ? requestedSubjects
      : subject
        ? [subject]
        : [];

  if (subjectsToFilter.length > 0) {
    const allAliases = subjectsToFilter.flatMap((s) =>
      subjectLookupAliases(s, examType)
    );
    const uniqueAliases = [...new Set(allAliases)].filter(Boolean);
    packFilter.subject =
      uniqueAliases.length > 1
        ? { $in: uniqueAliases }
        : new RegExp(`^${escapeRegex(uniqueAliases[0] || subjectsToFilter[0])}$`, "i");
  }
  let docs = await ExamSyllabusPack.find(packFilter)
    .sort({ subject: 1 })
    .lean();

  // Normalize CAT section labels onto wizard subject keys (QA / VARC / DILR).
  if (examType === "cat" && docs.length) {
    docs = docs.map((doc) => {
      const canonical = canonicalizeSubject(doc.subject) || doc.subject;
      return canonical && canonical !== doc.subject
        ? { ...doc, subject: canonical }
        : doc;
    });
  }

  if (docs.length) return docs;

  // Legacy JEE-only collection (enum: jee_main | jee_advanced).
  if (examType !== "jee_main" && examType !== "jee_advanced") return [];

  const legacyFilter = { examType, isActive: true };
  if (subjectsToFilter.length > 0) {
    legacyFilter.subject =
      subjectsToFilter.length > 1
        ? { $in: subjectsToFilter.map((s) => new RegExp(`^${escapeRegex(s)}$`, "i")) }
        : new RegExp(`^${escapeRegex(subjectsToFilter[0])}$`, "i");
  }
  return JeeExamSyllabus.find(legacyFilter).sort({ subject: 1 }).lean();
};

export const getAiPoweredTestExamTopics = async (query = {}) => {
  const inferred = inferExamAndSubject(query);
  const { examType, subject, subjects: requestedSubjects } = inferred;

  const [packDocs, legacyDocs] = await Promise.all([
    ExamSyllabusPack.find({ isActive: true })
      .select("examType examLabel subject")
      .sort({ examType: 1, subject: 1 })
      .lean(),
    JeeExamSyllabus.find({ isActive: true })
      .select("examType examLabel subject")
      .sort({ examType: 1, subject: 1 })
      .lean(),
  ]);
  const availableExams = summarizeAvailableExams([...packDocs, ...legacyDocs]);

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

  const docs = await loadSeededSyllabusDocs(examType, subject, requestedSubjects);
  let subjects = docsToSubjectsPayload(docs);
  if (requestedSubjects && requestedSubjects.length > 1) {
    subjects.sort((a, b) => {
      const idxA = requestedSubjects.indexOf(a.subject);
      const idxB = requestedSubjects.indexOf(b.subject);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });
  }
  const topics = subjects.flatMap((entry) => entry.topics);

  return {
    examType,
    examLabel: docs[0]?.examLabel || getExamLabel(examType),
    subject,
    subjectsRequested: requestedSubjects || [],
    year: docs[0]?.year || null,
    paper: docs[0]?.paper || "",
    hasSeededTopics: topics.length > 0,
    subjects,
    topics,
    availableExams,
  };
};

export default getAiPoweredTestExamTopics;
