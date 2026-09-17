/**
 * Admin AI-powered-test exam blueprint.
 * Builds syllabus topics + paper pattern from seeded JeeExamSyllabus +
 * JEE Advanced pattern totals (file-backed).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JeeExamSyllabus from "../models/JeeExamSyllabus.js";
import { parseCategoryScope, matchSubjectInText } from "./subjectDetection.js";
import { detectPaperNumber } from "./competitiveExamPlan.service.js";
import { getAdvancedPhysicsPaperTypeCounts } from "./jeeAdvancedPhysics.service.js";
import { getAdvancedPaperTypeCounts } from "./jeeAdvancedMaths.service.js";
import { EXAM_PROFILE_LABELS } from "./examPromptContext.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADVANCED_SCORING_PATHS = {
  Physics: [
    path.resolve(process.cwd(), "jee_advanced/physics/physics_scoring.json"),
    path.resolve(__dirname, "../../jee_advanced/physics/physics_scoring.json"),
  ],
  Mathematics: [
    path.resolve(process.cwd(), "jee_advanced/maths_scoring.json"),
    path.resolve(__dirname, "../../jee_advanced/maths_scoring.json"),
  ],
};

const JEE_MAIN_PER_SUBJECT = {
  single: 20,
  multi: 0,
  integer: 5,
  match: 0,
  total: 25,
};

const ADVANCED_PAPER_SESSIONS = [
  {
    paperNumber: 1,
    paperLabel: "Paper 1",
    startTime: "09:00",
    endTime: "12:00",
    totalMarks: 180,
    totalQuestions: 51,
    questionsPerSubject: 17,
  },
  {
    paperNumber: 2,
    paperLabel: "Paper 2",
    startTime: "14:30",
    endTime: "17:30",
    totalMarks: 180,
    totalQuestions: 51,
    questionsPerSubject: 17,
  },
];

const MAIN_PAPER_SESSION = {
  paperNumber: 1,
  paperLabel: "JEE Main",
  startTime: "09:00",
  endTime: "12:00",
  totalMarks: 300,
  totalQuestions: 75,
  questionsPerSubject: 25,
};

const readJsonIfExists = (candidates = []) => {
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }
  return null;
};

const normalizeExamType = (value) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw === "jee_main" || raw === "jeemain" || raw === "main") return "jee_main";
  if (
    raw === "jee_advanced" ||
    raw === "jeeadvanced" ||
    raw === "jee_advance" ||
    raw === "jeeadvance" ||
    raw === "advance" ||
    raw === "advanced"
  ) {
    return "jee_advanced";
  }
  return raw;
};

const detectExamTypeFromText = (text = "") => {
  const hay = String(text || "").toLowerCase();
  if (/\bjee\s*adv(?:ance|anced)?\b|\biit\s*-?\s*jee\s*adv/i.test(hay)) {
    return "jee_advanced";
  }
  if (/\bjee\s*mains?\b|\bnational\s*testing\s*agency\b|\bnta\b/i.test(hay)) {
    return "jee_main";
  }
  if (/\bjee\b/i.test(hay) && /\badv/i.test(hay)) return "jee_advanced";
  if (/\bjee\b/i.test(hay)) return "jee_main";
  return null;
};

const normalizeSubjectLabel = (value) => {
  const key = String(value || "").trim();
  if (!key) return null;
  if (/^math/i.test(key)) return "Mathematics";
  if (/^phys/i.test(key)) return "Physics";
  if (/^chem/i.test(key)) return "Chemistry";
  const matched = matchSubjectInText(key);
  if (matched?.label) return matched.label;
  return key.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

const splitCategoryPaths = (query = {}) => {
  const collected = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    String(value || "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => collected.push(part));
  };

  push(query.categoryPath);
  push(query.categoryPaths);
  return [...new Set(collected)];
};

const loadAdvancedRelevanceMap = (subject) => {
  const scoring = readJsonIfExists(ADVANCED_SCORING_PATHS[subject] || []);
  const topics = scoring?.topics || {};
  const map = new Map();
  for (const [topicId, meta] of Object.entries(topics)) {
    const relevance = String(meta?.advanced_relevance || "medium").toLowerCase();
    map.set(String(topicId).toUpperCase(), relevance);
  }
  return map;
};

const mapSyllabusTopics = (docs = [], examType = "jee_advanced") => {
  const relevanceBySubject = new Map();
  if (examType === "jee_advanced") {
    for (const subject of ["Physics", "Mathematics"]) {
      relevanceBySubject.set(subject, loadAdvancedRelevanceMap(subject));
    }
  }

  const subjects = [];
  const topics = [];

  for (const doc of docs) {
    const subject = normalizeSubjectLabel(doc.subject) || doc.subject;
    const relevanceMap = relevanceBySubject.get(subject) || new Map();
    const subjectTopics = (doc.topics || []).map((topic, index) => {
      const topicId = topic.topicId || topic.unit || null;
      const relevance =
        examType === "jee_advanced"
          ? relevanceMap.get(String(topicId || "").toUpperCase()) || "medium"
          : "medium";
      const mapped = {
        topicId,
        unit: topic.unit || topicId,
        title: topic.title,
        subject,
        branch: topic.branch || null,
        classLevel: topic.classLevel || null,
        content: topic.content || "",
        subtopics: Array.isArray(topic.subtopics) ? topic.subtopics : [],
        relevance,
        highLock: relevance === "high",
        order: topic.order ?? index,
      };
      topics.push(mapped);
      return mapped;
    });

    subjects.push({
      subject,
      topicCount: subjectTopics.length,
      topics: subjectTopics,
    });
  }

  return { subjects, topics };
};

const getPaperTypeCounts = ({ examType, subject, paper }) => {
  if (examType === "jee_advanced") {
    if (/^phys/i.test(subject || "")) {
      return getAdvancedPhysicsPaperTypeCounts({ paper });
    }
    return getAdvancedPaperTypeCounts({ paper });
  }
  return { ...JEE_MAIN_PER_SUBJECT };
};

const buildQuestionTypes = (counts = {}) => [
  {
    id: "single",
    label: "Single correct",
    group: "standalone",
    enabled: true,
    paperCount: counts.single ?? 0,
  },
  {
    id: "multiple",
    label: "Multiple correct",
    group: "standalone",
    enabled: true,
    paperCount: counts.multi ?? 0,
  },
  {
    id: "integer",
    label: "Numerical / Integer",
    group: "standalone",
    enabled: true,
    paperCount: counts.integer ?? 0,
  },
  {
    id: "match",
    label: "Match list",
    group: "standalone",
    enabled: true,
    paperCount: counts.match ?? 0,
  },
];

const buildExamPapers = (examType, questionsPerSubject) => {
  if (examType === "jee_advanced") {
    return {
      papers: ADVANCED_PAPER_SESSIONS.map((paper) => ({
        ...paper,
        questionsPerSubject: questionsPerSubject || paper.questionsPerSubject,
      })),
    };
  }
  return {
    papers: [
      {
        ...MAIN_PAPER_SESSION,
        questionsPerSubject: questionsPerSubject || MAIN_PAPER_SESSION.questionsPerSubject,
      },
    ],
  };
};

/**
 * Resolve examType / subject / paper from query + category path trail.
 */
export const resolveExamBlueprintScope = (query = {}) => {
  const categoryPaths = splitCategoryPaths(query);
  const { trail, leafLabel, segments } = parseCategoryScope(categoryPaths);
  const hay = [
    query.examType,
    query.exam,
    query.subject,
    trail,
    categoryPaths.join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  const examType =
    normalizeExamType(query.examType || query.exam) ||
    detectExamTypeFromText(hay) ||
    null;

  const subject =
    normalizeSubjectLabel(query.subject) ||
    normalizeSubjectLabel(leafLabel) ||
    normalizeSubjectLabel(
      [...(segments || [])].reverse().find((seg) => matchSubjectInText(seg))
    ) ||
    null;

  const paperFromQuery = Number(query.paper ?? query.paperNumber);
  const selectedPaper =
    paperFromQuery === 1 || paperFromQuery === 2
      ? paperFromQuery
      : detectPaperNumber({
          topic: trail,
          bankName: trail,
          categoryPaths,
          sectionName: leafLabel || "",
        }) || 1;

  return {
    examType,
    subject,
    selectedPaper,
    categoryPaths,
    trail,
    leafLabel,
  };
};

/**
 * Build the admin exam-blueprint payload used by the AI question-bank UI.
 */
export const getExamBlueprint = async (query = {}) => {
  const scope = resolveExamBlueprintScope(query);

  if (!scope.examType || !["jee_main", "jee_advanced"].includes(scope.examType)) {
    return {
      examType: scope.examType,
      examLabel: scope.examType
        ? EXAM_PROFILE_LABELS[scope.examType] || scope.examType
        : null,
      subject: scope.subject,
      selectedPaper: scope.selectedPaper,
      hasSeededTopics: false,
      hideTrueFalse: true,
      hidePassages: scope.examType === "jee_advanced",
      difficulty: {
        examNative: false,
        default: "medium",
        label: "Medium",
      },
      paperPattern: null,
      questionTypes: [],
      examPapers: { papers: [] },
      subjects: [],
      topics: [],
      categoryPaths: scope.categoryPaths,
      message:
        "No seeded exam blueprint for this category. Pick a JEE Main or JEE Advanced path.",
    };
  }

  const filter = { examType: scope.examType, isActive: true };
  if (scope.subject) {
    filter.subject = new RegExp(`^${scope.subject}$`, "i");
  }

  const docs = await JeeExamSyllabus.find(filter).sort({ subject: 1 }).lean();
  const { subjects, topics } = mapSyllabusTopics(docs, scope.examType);
  const subjectLabel =
    scope.subject ||
    subjects[0]?.subject ||
    normalizeSubjectLabel(scope.leafLabel) ||
    null;

  const counts = getPaperTypeCounts({
    examType: scope.examType,
    subject: subjectLabel,
    paper: scope.selectedPaper,
  });

  const examLabel =
    docs[0]?.examLabel ||
    EXAM_PROFILE_LABELS[scope.examType] ||
    (scope.examType === "jee_advanced" ? "JEE Advanced" : "JEE Main");

  return {
    examType: scope.examType,
    examLabel,
    subject: subjectLabel,
    selectedPaper: scope.selectedPaper,
    year: docs[0]?.year || null,
    hasSeededTopics: topics.length > 0,
    hideTrueFalse: true,
    hidePassages: scope.examType === "jee_advanced",
    difficulty: {
      examNative: true,
      default: scope.examType === "jee_advanced" ? "hard" : "medium",
      label:
        scope.examType === "jee_advanced"
          ? "Hard (exam-native)"
          : "Medium (exam-native)",
    },
    paperPattern: {
      paper: scope.selectedPaper,
      single: counts.single,
      multi: counts.multi,
      integer: counts.integer,
      match: counts.match,
      total: counts.total,
    },
    questionTypes: buildQuestionTypes(counts),
    examPapers: buildExamPapers(scope.examType, counts.total),
    subjects,
    topics,
    categoryPaths: scope.categoryPaths,
    categoryTrail: scope.trail || null,
  };
};

export default { getExamBlueprint, resolveExamBlueprintScope };
