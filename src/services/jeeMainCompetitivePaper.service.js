import Test from "../models/Test.js";
import Category from "../models/Category.js";
import ExamSession from "../models/ExamSession.js";
import { ApiError } from "../utils/ApiError.js";
import { generateUniqueCompetitivePaper } from "../utils/uniquePaperPicker.js";
import jeeMainCompetitivePaperRepository from "../repository/jeeMainCompetitivePaper.repository.js";

const SUBJECT_SECTION_INDEX = {
  mathematics: 0,
  maths: 0,
  math: 0,
  physics: 1,
  chemistry: 2,
};

export const isJeeMainCategoryName = (name = "") =>
  /jee\s*[-_]?\s*mains?/i.test(String(name));

const walkCategoryAncestors = async (startId) => {
  const nodes = [];
  let currentId = startId;
  const seen = new Set();
  for (let depth = 0; depth < 12 && currentId; depth++) {
    const key = currentId.toString();
    if (seen.has(key)) break;
    seen.add(key);
    const node = await Category.findById(currentId).select("name parent rootType isFree price").lean();
    if (!node) break;
    nodes.push(node);
    currentId = node.parent || null;
  }
  return nodes;
};

export const isJeeMainCategory = async (categoryId) => {
  if (!categoryId) return false;
  const ancestors = await walkCategoryAncestors(categoryId);
  return ancestors.some((node) => isJeeMainCategoryName(node.name));
};

const mapQuestionForApi = (question, { includeAnswers = false } = {}) => {
  const options = (question.options || []).map((opt) => {
    const mapped = {
      _id: opt._id,
      key: opt.key || null,
      text: opt.text,
    };
    if (includeAnswers) {
      mapped.isCorrect = Boolean(opt.isCorrect);
    }
    return mapped;
  });

  const payload = {
    _id: question._id,
    questionId: question._id,
    paper: question.paper,
    paperKey: question.paperKey,
    subject: question.subject,
    topic: question.topic || "",
    questionNumber: question.questionNumber,
    section: question.section,
    questionText: question.questionText,
    questionType: question.questionType || "single",
    options,
    explanation: includeAnswers ? question.explanation || "" : undefined,
    marks: question.marks ?? 4,
    negativeMarks: question.negativeMarks ?? 1,
    difficulty: question.difficulty || "medium",
    sectionIndex: question.sectionIndex ?? 0,
    orderInPaper: question.orderInPaper,
  };

  if (includeAnswers) {
    payload.correctAnswer = question.correctAnswer;
    payload.explanation = question.explanation || "";
  }

  return payload;
};

const mapPaperSummary = (paper, extras = {}) => ({
  _id: extras.testId || paper._id,
  paperId: paper._id,
  paperKey: paper.paperKey,
  title: paper.title,
  description:
    paper.description ||
    "Full-length JEE Main mock paper with Mathematics, Physics and Chemistry.",
  examType: paper.examType,
  pillar: paper.pillar,
  subjects: paper.subjects || [],
  durationMinutes: paper.durationMinutes || 180,
  totalQuestions: extras.totalQuestions ?? paper.totalQuestions ?? 0,
  totalMarks: extras.totalMarks ?? paper.totalMarks ?? 0,
  marksPerQuestion: paper.marksPerQuestion ?? 4,
  negativeMarks: paper.negativeMarks ?? 1,
  paperSource: "jee_main_db",
  price: extras.price ?? 0,
  originalPrice: extras.price ?? 0,
  effectivePrice: extras.price ?? 0,
  isPublished: paper.isPublished,
  categoryId: extras.categoryId || null,
  categoryPath: extras.categoryPath || "Competitive > JEE Main",
  sortOrder: paper.sortOrder,
  createdAt: paper.createdAt,
  updatedAt: paper.updatedAt,
});

const findLinkedTests = async (paperIds) => {
  if (!paperIds?.length) return [];
  return Test.find({
    jeeMainPaper: { $in: paperIds },
    applicableFor: "Competitive",
  })
    .select("_id title jeeMainPaper categoryId price durationMinutes isPublished")
    .lean();
};

export const listJeeMainPapers = async ({ includeAnswers = false } = {}) => {
  const papers = await jeeMainCompetitivePaperRepository.listPapers({
    isActive: true,
    isPublished: true,
  });
  const paperIds = papers.map((p) => p._id);
  const tests = await findLinkedTests(paperIds);
  const testByPaper = new Map(
    tests.map((t) => [String(t.jeeMainPaper), t])
  );

  return papers.map((paper) => {
    const test = testByPaper.get(String(paper._id));
    return mapPaperSummary(paper, {
      testId: test?._id,
      categoryId: test?.categoryId || null,
      price: test?.price ?? 0,
    });
  });
};

export const getJeeMainPaperById = async (id, { includeAnswers = false } = {}) => {
  let paper = await jeeMainCompetitivePaperRepository.findPaperById(id);
  if (!paper) {
    const test = await Test.findById(id).select("jeeMainPaper").lean();
    if (test?.jeeMainPaper) {
      paper = await jeeMainCompetitivePaperRepository.findPaperById(test.jeeMainPaper);
    }
  }
  if (!paper) {
    paper = await jeeMainCompetitivePaperRepository.findPaperByKey(id);
  }
  if (!paper || !paper.isActive) {
    throw new ApiError(404, "JEE Main paper not found");
  }

  const questions = await jeeMainCompetitivePaperRepository.getQuestionsByPaperId(
    paper._id
  );
  const tests = await findLinkedTests([paper._id]);
  const test = tests[0] || null;

  const summary = mapPaperSummary(paper, {
    testId: test?._id,
    categoryId: test?.categoryId || null,
    price: test?.price ?? 0,
    totalQuestions: questions.length,
    totalMarks: questions.reduce((sum, q) => sum + (q.marks || 0), 0),
  });

  const sections = (paper.subjects || ["Mathematics", "Physics", "Chemistry"]).map(
    (subject, index) => {
      const subjectQuestions = questions.filter((q) => {
        const mappedIndex =
          SUBJECT_SECTION_INDEX[String(q.subject || "").toLowerCase()] ??
          q.sectionIndex;
        return mappedIndex === index || q.subject === subject;
      });
      return {
        index,
        name: subject,
        count: subjectQuestions.length,
        timeMinutes: 0,
      };
    }
  );

  return {
    ...summary,
    sections,
    questions: questions.map((q) => mapQuestionForApi(q, { includeAnswers })),
  };
};

export const listJeeMainPapersForStudent = async (studentId, { categoryId, search } = {}) => {
  if (categoryId) {
    const allowed = await isJeeMainCategory(categoryId);
    if (!allowed) {
      return {
        papers: [],
        pagination: { page: 1, limit: 0, total: 0, pages: 1 },
        hasAccess: false,
      };
    }
  }

  let papers = await listJeeMainPapers();
  if (search) {
    const q = String(search).trim().toLowerCase();
    papers = papers.filter((p) => String(p.title || "").toLowerCase().includes(q));
  }

  const testIds = papers.map((p) => p._id).filter(Boolean);
  const examSessions = testIds.length
    ? await ExamSession.find({
        student: studentId,
        test: { $in: testIds },
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const sessionMap = {};
  for (const session of examSessions) {
    const key = String(session.test);
    if (!sessionMap[key]) sessionMap[key] = session;
  }

  const papersWithStatus = papers.map((paper) => {
    const session = sessionMap[String(paper._id)];
    return {
      ...paper,
      testStatus: session ? session.status : null,
      testSessionId: session ? session._id : null,
      isNew: false,
      isNewLocked: false,
      isPurchased: true,
    };
  });

  return {
    papers: papersWithStatus,
    pagination: {
      page: 1,
      limit: papersWithStatus.length,
      total: papersWithStatus.length,
      pages: 1,
    },
    hasAccess: true,
    upgradable: false,
    upgradeCost: 0,
    isFreeUpgrade: false,
    hasNewContent: false,
  };
};

const FULL_SET_COUNTS = {
  Mathematics: 25,
  Physics: 25,
  Chemistry: 25,
};

const SUBJECT_ORDER = ["Mathematics", "Physics", "Chemistry"];

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  return String(raw || "").trim();
};

const shuffle = (items = []) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const groupBySubject = (questions = []) => {
  const groups = { Mathematics: [], Physics: [], Chemistry: [] };
  questions.forEach((question) => {
    const subject = normalizeSubject(question.subject);
    if (groups[subject]) groups[subject].push(question);
  });
  return groups;
};

const countBySubject = (groups) =>
  Object.fromEntries(
    SUBJECT_ORDER.map((subject) => [subject, groups[subject]?.length || 0])
  );

const possibleSetsFromCounts = (counts) =>
  Math.min(
    ...SUBJECT_ORDER.map((subject) =>
      Math.floor((counts[subject] || 0) / FULL_SET_COUNTS[subject])
    )
  );

export const getJeeMainGeneratorSummary = async (excludeQuestionIds = []) => {
  const excluded = new Set((excludeQuestionIds || []).map((id) => String(id)));
  const all = await jeeMainCompetitivePaperRepository.getAllActiveQuestions();
  const unused = all.filter((q) => !excluded.has(String(q._id)));
  const groups = groupBySubject(unused);
  const remainingBySubject = countBySubject(groups);
  const bankBySubject = countBySubject(groupBySubject(all));

  return {
    exam: "JEE Main",
    examType: "jee_main",
    pattern: FULL_SET_COUNTS,
    totalQuestionsPerSet: 75,
    bankBySubject,
    remainingBySubject,
    bankTotal: all.length,
    remainingTotal: unused.length,
    possibleSets: possibleSetsFromCounts(bankBySubject),
    remainingSets: possibleSetsFromCounts(remainingBySubject),
    usedCount: excluded.size,
  };
};

export const generateJeeMainQuestionSet = async (
  excludeQuestionIds = [],
  options = {}
) =>
  generateUniqueCompetitivePaper({
    loadQuestions: () => jeeMainCompetitivePaperRepository.getAllActiveQuestions(),
    examType: "jee_main",
    examLabel: "JEE Main",
    counts: FULL_SET_COUNTS,
    durationMinutes: 180,
    marksPerQuestion: 4,
    negativeMarks: 1,
    normalizeSubject,
    excludeQuestionIds,
    subject: options.subject,
    count: options.count,
    typeCounts: options.typeCounts,
    allowedTypes: options.allowedTypes,
    mapQuestion: (question) =>
      mapQuestionForApi(question, { includeAnswers: true }),
  });

export default {
  listJeeMainPapers,
  getJeeMainPaperById,
  listJeeMainPapersForStudent,
  getJeeMainGeneratorSummary,
  generateJeeMainQuestionSet,
  isJeeMainCategory,
  isJeeMainCategoryName,
};
