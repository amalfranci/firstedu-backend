import {
  getAiPoweredTestExamTopics,
  inferExamAndSubject,
} from "./aiPoweredTestExamTopics.service.js";
import { getExamLabel } from "./examPromptContext.service.js";
import {
  getAdvancedPaperTypeCounts,
  getJeeAdvancedMathTopics,
  hydrateJeeAdvancedMathsScoringFromDb,
  isJeeAdvancedMathsDataAvailable,
} from "./jeeAdvancedMaths.service.js";
import {
  getJeeAdvancedPhysicsTopics,
  hydrateJeeAdvancedPhysicsScoringFromDb,
  isJeeAdvancedPhysicsDataAvailable,
} from "./jeeAdvancedPhysics.service.js";
import { getExamSyllabusPackTopics } from "./examSyllabusPack.service.js";
import {
  listExamPaperPatterns,
  summarizeExamPapers,
} from "./examPaperPattern.service.js";

const ADVANCED_QUALITY_MIX = {
  single: 0,
  multiple: 3,
  integer: 2,
  match: 1,
  paragraph: 0,
  trueFalse: 0,
  passageCount: 0,
};

const ADVANCED_PAPER2_QUALITY_MIX = {
  single: 0,
  multiple: 3,
  integer: 2,
  match: 0,
  paragraph: 1,
  trueFalse: 0,
  passageCount: 0,
};

const GENERIC_TYPES = [
  {
    id: "single",
    label: "Single correct",
    group: "standalone",
    paperCount: null,
    defaultCount: 0,
    enabled: true,
  },
  {
    id: "multiple",
    label: "Multiple correct",
    group: "standalone",
    paperCount: null,
    defaultCount: 0,
    enabled: true,
  },
  {
    id: "trueFalse",
    label: "True / False",
    group: "standalone",
    paperCount: null,
    defaultCount: 0,
    enabled: true,
  },
  {
    id: "passage",
    label: "Reading passage",
    group: "passage",
    paperCount: null,
    defaultCount: 0,
    enabled: true,
  },
];

const advancedQuestionTypes = (paperCounts, defaultMix = ADVANCED_QUALITY_MIX) => {
  const types = [
    {
      id: "single",
      label: "Single correct",
      group: "standalone",
      paperCount: paperCounts.single,
      defaultCount: defaultMix.single,
      enabled: (paperCounts.single || 0) > 0,
    },
    {
      id: "multiple",
      label: "Multi correct",
      group: "standalone",
      paperCount: paperCounts.multi,
      defaultCount: defaultMix.multiple,
      enabled: (paperCounts.multi || 0) > 0,
    },
    {
      id: "integer",
      label: "Numerical / integer",
      group: "standalone",
      paperCount: paperCounts.integer,
      defaultCount: defaultMix.integer,
      enabled: (paperCounts.integer || 0) > 0,
    },
    {
      id: "match",
      label: "Match list",
      group: "standalone",
      paperCount: paperCounts.match || 0,
      defaultCount: defaultMix.match || 0,
      enabled: (paperCounts.match || 0) > 0,
    },
    {
      id: "paragraph",
      label: "Comprehension / paragraph",
      group: "passage",
      paperCount: paperCounts.paragraph || 0,
      defaultCount: defaultMix.paragraph || 0,
      enabled: (paperCounts.paragraph || 0) > 0,
    },
  ];
  return types.filter((t) => t.enabled || t.id === "single" || t.id === "multiple" || t.id === "integer");
};

const mainQuestionTypes = () => [
  {
    id: "single",
    label: "Single correct",
    group: "standalone",
    paperCount: 20,
    defaultCount: 0,
    enabled: true,
  },
  {
    id: "integer",
    label: "Numerical / integer",
    group: "standalone",
    paperCount: 5,
    defaultCount: 0,
    enabled: true,
  },
];

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const packBySubject = (subject) => {
  const key = normalizeKey(subject);
  if (/\bmath/.test(key) && isJeeAdvancedMathsDataAvailable()) {
    return getJeeAdvancedMathTopics();
  }
  if (/\bphys/.test(key) && isJeeAdvancedPhysicsDataAvailable()) {
    return getJeeAdvancedPhysicsTopics();
  }
  return [];
};

const enrichTopicsWithPack = async (topics = [], subject = "", examType = "") => {
  // Prefer Mongo ExamSyllabusPack (syllabus + scoring) when seeded.
  let pack = [];
  if (examType === "jee_advanced" || !examType) {
    try {
      pack = await getExamSyllabusPackTopics({
        examType: examType || "jee_advanced",
        subject,
      });
    } catch {
      pack = [];
    }
  }
  if (!pack.length) {
    pack = packBySubject(subject);
  }
  if (!pack.length) {
    return topics.map((topic) => ({
      ...topic,
      relevance: null,
      highLock: false,
    }));
  }

  return topics.map((topic) => {
    const id = String(topic.topicId || topic.unit || "").trim();
    const titleKey = normalizeKey(topic.title);
    const hit =
      pack.find((p) => p.topicId === id) ||
      pack.find((p) => normalizeKey(p.chapter) === titleKey) ||
      null;
    const relevance =
      String(
        hit?.relevance ||
          hit?.scoring?.advanced_relevance ||
          hit?.scoring?.relevance ||
          ""
      )
        .trim()
        .toLowerCase() || null;
    return {
      ...topic,
      topicId: id || topic.topicId,
      subtopics: hit?.subtopics?.length ? hit.subtopics : topic.subtopics,
      relevance,
      highLock: relevance === "high",
      scoringSource: hit?.scoringSource || (hit?.scoring ? "exam_syllabus_pack" : null),
    };
  });
};

const buildDifficulty = (examType) => {
  if (examType === "jee_advanced") {
    return {
      default: "hard",
      examNative: true,
      options: ["hard"],
      label: "Hard (JEE Advanced exam-native)",
      skeletonMin: 70,
      lastAttemptFloor: 65,
    };
  }
  if (examType === "jee_main") {
    return {
      default: "hard",
      examNative: true,
      options: ["hard"],
      label: "Hard (JEE Main exam-native)",
      skeletonMin: 80,
      lastAttemptFloor: 72,
    };
  }
  return {
    default: "medium",
    examNative: false,
    options: ["easy", "medium", "hard"],
    label: "Medium",
    skeletonMin: null,
    lastAttemptFloor: null,
  };
};

const buildTypePlan = (examType, { paperNumber = 1 } = {}) => {
  if (examType === "jee_advanced") {
    const paper = getAdvancedPaperTypeCounts({ paper: paperNumber });
    const mix =
      Number(paperNumber) === 2
        ? { ...ADVANCED_PAPER2_QUALITY_MIX }
        : { ...ADVANCED_QUALITY_MIX };
    const hasParagraph = (paper.paragraph || 0) > 0;
    return {
      questionTypes: advancedQuestionTypes(paper, mix),
      paperPattern: {
        paper: Number(paperNumber) === 2 ? 2 : 1,
        ...paper,
      },
      defaultMix: mix,
      hidePassages: !hasParagraph,
      hideTrueFalse: true,
    };
  }
  if (examType === "jee_main") {
    return {
      questionTypes: mainQuestionTypes(),
      paperPattern: {
        paper: 1,
        single: 20,
        integer: 5,
        multiple: 0,
        match: 0,
        paragraph: 0,
        total: 25,
      },
      defaultMix: {
        single: 0,
        multiple: 0,
        integer: 0,
        match: 0,
        paragraph: 0,
        trueFalse: 0,
        passageCount: 0,
      },
      hidePassages: true,
      hideTrueFalse: true,
    };
  }
  return {
    questionTypes: GENERIC_TYPES,
    paperPattern: null,
    defaultMix: {
      single: 0,
      multiple: 0,
      integer: 0,
      match: 0,
      paragraph: 0,
      trueFalse: 0,
      passageCount: 0,
    },
    hidePassages: false,
    hideTrueFalse: false,
  };
};

const resolveRequestedPaper = (query = {}, inferredPaperNumber = null) => {
  const raw =
    query.paper ?? query.paperNumber ?? query.paperKey ?? inferredPaperNumber ?? 1;
  if (String(raw).toLowerCase().includes("2") || Number(raw) === 2) return 2;
  return 1;
};

const buildAdvancedPapersPayload = async (year = 2026) => {
  try {
    const seeded = await listExamPaperPatterns({
      examType: "jee_advanced",
      year,
    });
    if (seeded.length) return summarizeExamPapers(seeded);
  } catch {
    /* fall through to file */
  }

  const p1 = getAdvancedPaperTypeCounts({ paper: 1 });
  const p2 = getAdvancedPaperTypeCounts({ paper: 2 });
  return {
    examType: "jee_advanced",
    examLabel: "JEE Advanced 2026",
    year,
    examDate: "2026-05-17",
    examDateLabel: "17 May 2026",
    mandatoryBothPapers: true,
    subjects: ["Physics", "Chemistry", "Mathematics"],
    papers: [
      {
        paperNumber: 1,
        paperKey: "Paper_1",
        paperLabel: "Paper 1",
        session: p1.session || "morning",
        startTime: p1.startTime || "09:00",
        endTime: p1.endTime || "12:00",
        durationMinutes: 180,
        totalMarks: p1.totalMarks || 180,
        totalQuestions: p1.paperTotalQuestions || 48,
        questionsPerSubject: p1.questionsPerSubject || p1.total,
        formats: p1.formats || [
          "Single Correct",
          "Multi-Correct",
          "Numerical",
          "Match the Column",
        ],
        typeCounts: {
          single: p1.single,
          multi: p1.multi,
          integer: p1.integer,
          match: p1.match,
          paragraph: p1.paragraph || 0,
          total: p1.total,
        },
      },
      {
        paperNumber: 2,
        paperKey: "Paper_2",
        paperLabel: "Paper 2",
        session: p2.session || "afternoon",
        startTime: p2.startTime || "14:30",
        endTime: p2.endTime || "17:30",
        durationMinutes: 180,
        totalMarks: p2.totalMarks || 180,
        totalQuestions: p2.paperTotalQuestions || 54,
        questionsPerSubject: p2.questionsPerSubject || p2.total,
        formats: p2.formats || [
          "Single Correct",
          "Multi-Correct",
          "Numerical",
          "Comprehension/Paragraph",
        ],
        typeCounts: {
          single: p2.single,
          multi: p2.multi,
          integer: p2.integer,
          match: p2.match || 0,
          paragraph: p2.paragraph || 0,
          total: p2.total,
        },
      },
    ],
    quickComparison: null,
  };
};

const positive = (value) => Math.max(0, Number(value) || 0);

/**
 * Forces an AI-inferred question mix back onto the formats the selected paper
 * actually uses — the planner sometimes offers passages or True/False for
 * papers that have neither. Dropped slots are folded into single-correct so
 * the requested total is preserved.
 */
export const lockCountsToPaperFormats = (counts = {}, blueprint = null) => {
  if (!blueprint?.examType) return { ...counts };
  const locked = { ...counts };

  if (blueprint.hideTrueFalse) {
    locked.singleCount = positive(locked.singleCount) + positive(locked.trueFalseCount);
    locked.trueFalseCount = 0;
    locked.passageSingleCount =
      positive(locked.passageSingleCount) + positive(locked.passageTrueFalseCount);
    locked.passageTrueFalseCount = 0;
  }

  if (blueprint.hidePassages) {
    const perPassage =
      positive(locked.passageSingleCount) +
      positive(locked.passageMultipleCount) +
      positive(locked.passageTrueFalseCount);
    locked.singleCount =
      positive(locked.singleCount) + positive(locked.passageCount) * perPassage;
    locked.passageCount = 0;
    locked.connectedCount = 0;
    locked.passageSingleCount = 0;
    locked.passageMultipleCount = 0;
    locked.passageTrueFalseCount = 0;
  }

  locked.singleCount = Math.min(100, positive(locked.singleCount));
  return locked;
};

export const getAiPoweredTestExamBlueprint = async (query = {}) => {
  const inferred = inferExamAndSubject(query);
  const topicsPayload = await getAiPoweredTestExamTopics(query);
  const examType = inferred.examType || topicsPayload.examType;
  const subject = inferred.subject || topicsPayload.subject;
  const paperNumber = resolveRequestedPaper(query, inferred.paperNumber);
  const typePlan = buildTypePlan(examType, { paperNumber });
  const difficulty = buildDifficulty(examType);

  if (examType === "jee_advanced") {
    await Promise.all([
      hydrateJeeAdvancedMathsScoringFromDb(),
      hydrateJeeAdvancedPhysicsScoringFromDb(),
    ]);
  }

  const subjects = await Promise.all(
    (topicsPayload.subjects || []).map(async (entry) => {
      const topics = await enrichTopicsWithPack(
        entry.topics || [],
        entry.subject,
        examType
      );
      return {
        ...entry,
        topics,
        highRelevanceCount: topics.filter((t) => t.highLock).length,
      };
    })
  );
  const topics = subjects.flatMap((entry) => entry.topics);
  const highRelevanceTopicIds = topics
    .filter((t) => t.highLock && t.topicId)
    .map((t) => t.topicId);

  const examPapers =
    examType === "jee_advanced"
      ? await buildAdvancedPapersPayload(topicsPayload.year || 2026)
      : null;

  return {
    examType,
    examLabel: topicsPayload.examLabel || (examType ? getExamLabel(examType) : null),
    subject,
    year: topicsPayload.year || examPapers?.year || null,
    paper: topicsPayload.paper || "",
    selectedPaper: paperNumber,
    hasSeededTopics: topics.length > 0,
    difficulty,
    questionTypes: typePlan.questionTypes,
    paperPattern: typePlan.paperPattern,
    examPapers,
    defaultMix: typePlan.defaultMix,
    hidePassages: typePlan.hidePassages,
    hideTrueFalse: typePlan.hideTrueFalse,
    topicLock: {
      mode: examType === "jee_advanced" ? "high_relevance" : "full_syllabus",
      highOnly: examType === "jee_advanced",
    },
    highRelevanceTopicIds,
    subjects,
    topics,
    availableExams: topicsPayload.availableExams || [],
    qualityLock:
      examType === "jee_advanced" || examType === "jee_main"
        ? {
            deferValidation: true,
            stageAAnswerLock: true,
            curatedSlotsOnly: examType === "jee_advanced",
            source:
              examType === "jee_advanced"
                ? "jee_advanced_hard_maths_6_nonsingle"
                : "jee_main_hard_stage_a",
          }
        : null,
  };
};

export default getAiPoweredTestExamBlueprint;
