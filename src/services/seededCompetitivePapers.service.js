import Category from "../models/Category.js";
import Test from "../models/Test.js";
import JeeMainCompetitivePaper from "../models/JeeMainCompetitivePaper.js";
import JeeMainCompetitiveQuestion from "../models/JeeMainCompetitiveQuestion.js";
import JeeAdvancedCompetitivePaper from "../models/JeeAdvancedCompetitivePaper.js";
import JeeAdvancedCompetitiveQuestion from "../models/JeeAdvancedCompetitiveQuestion.js";
import NeetCompetitivePaper from "../models/NeetCompetitivePaper.js";
import NeetCompetitiveQuestion from "../models/NeetCompetitiveQuestion.js";
import ClatCompetitivePaper from "../models/ClatCompetitivePaper.js";
import ClatCompetitiveQuestion from "../models/ClatCompetitiveQuestion.js";
import IbpsCompetitivePaper from "../models/IbpsCompetitivePaper.js";
import IbpsCompetitiveQuestion from "../models/IbpsCompetitiveQuestion.js";
import GmatCompetitivePaper from "../models/GmatCompetitivePaper.js";
import GmatCompetitiveQuestion from "../models/GmatCompetitiveQuestion.js";
import CatCompetitivePaper, {
  CatCompetitiveQuestion,
} from "../models/CatCompetitivePaper.js";
import SscCglTier1CompetitivePaper, {
  SscCglTier1CompetitiveQuestion,
} from "../models/SscCglTier1CompetitivePaper.js";
import SscCglTier2CompetitivePaper, {
  SscCglTier2CompetitiveQuestion,
} from "../models/SscCglTier2CompetitivePaper.js";
import UpscCompetitivePaper, {
  UpscCompetitiveQuestion,
} from "../models/UpscCompetitivePaper.js";

const isMockCategory = (name) => /mock/i.test(String(name || ""));

const EXAM_REGISTRY = [
  {
    examKey: "jee_main",
    label: "JEE Main",
    Paper: JeeMainCompetitivePaper,
    Question: JeeMainCompetitiveQuestion,
    subjects: ["Mathematics", "Physics", "Chemistry"],
    match: (name) =>
      !isMockCategory(name) && /^jee\s*mains?$/i.test(String(name || "").trim()),
  },
  {
    examKey: "jee_advanced",
    label: "JEE Advanced",
    Paper: JeeAdvancedCompetitivePaper,
    Question: JeeAdvancedCompetitiveQuestion,
    subjects: ["Mathematics", "Physics", "Chemistry"],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      if (/^jee\s*advanc(?:e|ed)\s*[12]$/i.test(n)) return false;
      return /jee\s*advanc(?:e|ed)/i.test(n);
    },
  },
  {
    examKey: "neet",
    label: "NEET",
    Paper: NeetCompetitivePaper,
    Question: NeetCompetitiveQuestion,
    subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return /\bneet\b/i.test(n) && !/\bpg\b/i.test(n);
    },
  },
  {
    examKey: "clat",
    label: "CLAT",
    Paper: ClatCompetitivePaper,
    Question: ClatCompetitiveQuestion,
    subjects: [
      "English",
      "Current Affairs",
      "Legal Reasoning",
      "Logical Reasoning",
      "Quantitative Techniques",
    ],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      if (/^clat[\s_-]*20\d{2}$/i.test(n)) return false;
      return /\bclat\b/i.test(n);
    },
  },
  {
    examKey: "ibps",
    label: "IBPS PO Prelims",
    Paper: IbpsCompetitivePaper,
    Question: IbpsCompetitiveQuestion,
    subjects: ["English", "Quantitative Aptitude", "Reasoning Ability"],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return /ibps(\s*po)?(\s*prelims)?/i.test(n);
    },
  },
  {
    examKey: "gmat",
    label: "GMAT",
    Paper: GmatCompetitivePaper,
    Question: GmatCompetitiveQuestion,
    subjects: ["Quant", "Verbal", "Data Insights"],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return /\bgmat\b/i.test(n);
    },
  },
  {
    examKey: "cat",
    label: "CAT",
    Paper: CatCompetitivePaper,
    Question: CatCompetitiveQuestion,
    subjects: [
      "Verbal Ability and Reading Comprehension",
      "Data Interpretation and Logical Reasoning",
      "Quantitative Ability",
    ],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return (
        /^cat$/i.test(n) || /\bcommon\s+admission\s+test\b/i.test(n)
      );
    },
  },
  {
    examKey: "ssc_cgl_tier2",
    label: "SSC CGL Tier 2",
    Paper: SscCglTier2CompetitivePaper,
    Question: SscCglTier2CompetitiveQuestion,
    subjects: [
      "Mathematical Abilities",
      "Reasoning and General Intelligence",
      "English Language and Comprehension",
      "General Awareness",
      "Computer Knowledge",
    ],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return /ssc\s*cgl.*tier\s*(2|ii)\b|\bcgl\s*tier\s*(2|ii)\b/i.test(n);
    },
  },
  {
    examKey: "ssc_cgl_tier1",
    label: "SSC CGL Tier 1",
    Paper: SscCglTier1CompetitivePaper,
    Question: SscCglTier1CompetitiveQuestion,
    subjects: [
      "General Intelligence and Reasoning",
      "General Awareness",
      "Quantitative Aptitude",
      "English Comprehension",
    ],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return (
        /ssc\s*cgl\b|\bcgl\s*tier\s*[i1]\b/i.test(n) &&
        !/tier\s*(2|ii)\b/i.test(n)
      );
    },
  },
  {
    examKey: "upsc",
    label: "UPSC Prelims",
    Paper: UpscCompetitivePaper,
    Question: UpscCompetitiveQuestion,
    subjects: [
      "History",
      "Polity",
      "Geography",
      "Economy",
      "Environment",
      "Science",
      "Current Affairs",
    ],
    match: (name) => {
      const n = String(name || "").trim();
      if (isMockCategory(n)) return false;
      return /\bupsc\b/i.test(n);
    },
  },
];

/** Used by seed-competitive-exam-subjects.mjs — PAUSED: no exam subjects auto-seeded */
export const COMPETITIVE_EXAM_SUBJECT_SEED = [];

/** Normalize subject labels so Maths ≡ Mathematics, etc. */
export const normalizeSubjectKey = (label = "") => {
  const n = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!n) return "";
  if (/data\s+insights/.test(n)) return "di";
  if (
    /^(maths|mathematics|mathematical\s+abilities|quantitative\s+aptitude|quantitative\s+ability|quant)$/.test(n) ||
    /quantitative\s+reasoning/.test(n)
  ) {
    return "math";
  }
  if (/^(physics)$/.test(n)) return "physics";
  if (/^(chemistry)$/.test(n)) return "chemistry";
  // Before the broad "reason" match, so "Verbal Reasoning" stays Verbal.
  if (/verbal|varc/.test(n)) return "english";
  if (/dilr|data\s+interpretation|logical\s+reasoning/.test(n) && !/legal/.test(n))
    return "dilr";
  if (/legal/.test(n)) return "legal";
  if (/reason/.test(n)) return "reasoning";
  if (/english|comprehension/.test(n) && !/general\s+awareness/.test(n))
    return "english";
  if (/general\s+awareness|^ga$/.test(n)) return "ga";
  if (/computer/.test(n)) return "computer";
  if (/botany/.test(n)) return "botany";
  if (/zoology/.test(n)) return "zoology";
  if (/current\s+affairs/.test(n)) return "ca";
  return n;
};

const subjectsMatch = (a, b) =>
  normalizeSubjectKey(a) &&
  normalizeSubjectKey(a) === normalizeSubjectKey(b);

const walkCategoryAncestors = async (startId) => {
  const nodes = [];
  let currentId = startId;
  const seen = new Set();
  for (let depth = 0; depth < 12 && currentId; depth += 1) {
    const key = String(currentId);
    if (seen.has(key)) break;
    seen.add(key);
    const node = await Category.findById(currentId)
      .select("name parent rootType")
      .lean();
    if (!node) break;
    nodes.push(node);
    currentId = node.parent || null;
  }
  return nodes;
};

export const resolveSeededExamFromCategory = async (categoryId) => {
  if (!categoryId) return null;
  const ancestors = await walkCategoryAncestors(categoryId);
  for (const node of ancestors) {
    for (const exam of EXAM_REGISTRY) {
      if (exam.match(node.name)) {
        return {
          examKey: exam.examKey,
          label: exam.label,
          categoryId: node._id,
          categoryName: node.name,
          Paper: exam.Paper,
          Question: exam.Question || null,
          subjects: exam.subjects || [],
          selectedNode: ancestors[0],
          isSubjectSelection:
            String(ancestors[0]?._id) !== String(node._id) &&
            !EXAM_REGISTRY.some((e) => e.match(ancestors[0]?.name)),
        };
      }
    }
  }
  return null;
};

const mapPaperAsTest = (
  paper,
  { categoryId, categoryPath, linkedTest, subjectFilter = null, subjectQuestionCount = null } = {}
) => {
  const testId = linkedTest?._id || null;
  const scoped =
    subjectFilter && Number.isFinite(subjectQuestionCount)
      ? {
          title: `${paper.title} — ${subjectFilter}`,
          description: `${paper.title} — ${subjectFilter} only (${subjectQuestionCount} questions).`,
          totalQuestions: subjectQuestionCount,
          subjects: [subjectFilter],
          filterSubject: subjectFilter,
        }
      : {
          title: paper.title,
          description:
            paper.description ||
            `${paper.title} — seeded competitive paper (${paper.examType || "exam"}).`,
          totalQuestions: paper.totalQuestions ?? 0,
          subjects: paper.subjects || [],
          filterSubject: null,
        };

  return {
    _id: subjectFilter
      ? `${paper._id}:${normalizeSubjectKey(subjectFilter)}`
      : testId || paper._id,
    title: scoped.title,
    description: scoped.description,
    durationMinutes: paper.durationMinutes || linkedTest?.durationMinutes || 0,
    price: linkedTest?.price ?? 0,
    originalPrice: linkedTest?.price ?? 0,
    effectivePrice: linkedTest?.price ?? 0,
    isPublished: paper.isPublished !== false,
    categoryId: linkedTest?.categoryId || categoryId || null,
    categoryPath: categoryPath || "",
    applicableFor: "Competitive",
    paperSource: `${paper.examType || "seeded"}_db`,
    examType: paper.examType || null,
    paperKey: paper.paperKey,
    paperId: paper._id,
    totalQuestions: scoped.totalQuestions,
    totalMarks: paper.totalMarks ?? 0,
    subjects: scoped.subjects,
    filterSubject: scoped.filterSubject,
    isSeededPaper: true,
    testId: testId
      ? {
          _id: linkedTest._id,
          title: linkedTest.title,
          durationMinutes: linkedTest.durationMinutes,
          price: linkedTest.price ?? 0,
          originalPrice: linkedTest.price ?? 0,
          effectivePrice: linkedTest.price ?? 0,
        }
      : null,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
  };
};

export const listSeededPapersForExam = async (examKey) => {
  const exam = EXAM_REGISTRY.find((e) => e.examKey === examKey);
  if (!exam) return [];
  return exam.Paper.find({ isActive: { $ne: false } })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
};

export const listSeededPapersForCategory = async (
  categoryId,
  { categoryPath = "" } = {}
) => {
  const resolved = await resolveSeededExamFromCategory(categoryId);
  if (!resolved) return { exam: null, papers: [], tests: [] };

  const papers = await resolved.Paper.find({ isActive: { $ne: false } })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  const subjectName = resolved.isSubjectSelection
    ? resolved.selectedNode?.name
    : null;

  const paperIds = papers.map((p) => p._id);
  const linkedTests =
    resolved.examKey === "jee_main" && paperIds.length && !subjectName
      ? await Test.find({
          jeeMainPaper: { $in: paperIds },
          applicableFor: "Competitive",
        })
          .select("_id title jeeMainPaper categoryId price durationMinutes")
          .lean()
      : [];

  const testByPaper = new Map(
    linkedTests.map((t) => [String(t.jeeMainPaper), t])
  );

  const tests = [];
  for (const paper of papers) {
    if (subjectName && resolved.Question) {
      const count = await resolved.Question.countDocuments({
        paper: paper._id,
        isActive: { $ne: false },
        subject: {
          $regex: new RegExp(
            `^${String(subjectName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        },
      });
      // Also try alias match (Maths ↔ Mathematics) via scanning distinct if zero
      let finalCount = count;
      let matchedSubject = subjectName;
      if (finalCount === 0) {
        const distinct = await resolved.Question.distinct("subject", {
          paper: paper._id,
          isActive: { $ne: false },
        });
        const alias = distinct.find((s) => subjectsMatch(s, subjectName));
        if (alias) {
          matchedSubject = alias;
          finalCount = await resolved.Question.countDocuments({
            paper: paper._id,
            isActive: { $ne: false },
            subject: alias,
          });
        }
      }
      if (finalCount <= 0) continue;
      tests.push(
        mapPaperAsTest(paper, {
          categoryId,
          categoryPath,
          linkedTest: null,
          subjectFilter: matchedSubject,
          subjectQuestionCount: finalCount,
        })
      );
      continue;
    }

    // Exam-level (or subject without Question model): full papers
    if (subjectName && !resolved.Question) {
      const listed = (paper.subjects || []).some((s) =>
        subjectsMatch(s, subjectName)
      );
      if (!listed) continue;
    }

    tests.push(
      mapPaperAsTest(paper, {
        categoryId: subjectName ? categoryId : resolved.categoryId,
        categoryPath,
        linkedTest: testByPaper.get(String(paper._id)) || null,
      })
    );
  }

  return {
    exam: {
      examKey: resolved.examKey,
      label: resolved.label,
      categoryId: resolved.categoryId,
      categoryName: resolved.categoryName,
      subjectFilter: subjectName || null,
    },
    papers,
    tests,
  };
};

export const listAllSeededPaperSummaries = async () => {
  const results = [];
  for (const exam of EXAM_REGISTRY) {
    const papers = await exam.Paper.find({ isActive: { $ne: false } })
      .select(
        "paperKey title examType totalQuestions totalMarks durationMinutes isPublished sortOrder createdAt"
      )
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    results.push({
      examKey: exam.examKey,
      label: exam.label,
      paperCount: papers.length,
      papers,
    });
  }
  return results;
};

export const getExamKeysWithSeededPapers = async () => {
  const withPapers = new Set();
  for (const exam of EXAM_REGISTRY) {
    const count = await exam.Paper.countDocuments({ isActive: { $ne: false } });
    if (count > 0) withPapers.add(exam.examKey);
  }
  return withPapers;
};

export const matchExamKeyFromCategoryName = (name) => {
  for (const exam of EXAM_REGISTRY) {
    if (exam.match(name)) return exam.examKey;
  }
  return null;
};

/** Subjects that have ≥1 seeded question under an exam key. */
const subjectKeysWithQuestionsByExam = async () => {
  const map = new Map(); // examKey -> Set(normalized subject keys + raw names)
  for (const exam of EXAM_REGISTRY) {
    const set = new Set();
    if (exam.Question) {
      const subjects = await exam.Question.distinct("subject", {
        isActive: { $ne: false },
      });
      for (const s of subjects || []) {
        if (!s) continue;
        set.add(String(s).trim().toLowerCase());
        set.add(normalizeSubjectKey(s));
      }
    } else {
      const papers = await exam.Paper.find({ isActive: { $ne: false } })
        .select("subjects")
        .lean();
      for (const p of papers) {
        for (const s of p.subjects || exam.subjects || []) {
          set.add(String(s).trim().toLowerCase());
          set.add(normalizeSubjectKey(s));
        }
      }
    }
    map.set(exam.examKey, set);
  }
  return map;
};

/**
 * Mark exam nodes with hasSeededPapers and subject children with
 * hasSeededSubjectPapers when that subject has questions in the seed DB.
 */
export const annotateTreeWithSeededPapers = async (nodes = []) => {
  const keys = await getExamKeysWithSeededPapers();
  const subjectMap = await subjectKeysWithQuestionsByExam();

  const walk = (list, parentExamKey = null) => {
    for (const node of list || []) {
      const examKey = matchExamKeyFromCategoryName(node?.name);
      node.hasSeededPapers = Boolean(examKey && keys.has(examKey));

      if (parentExamKey && !examKey) {
        const set = subjectMap.get(parentExamKey) || new Set();
        const raw = String(node?.name || "")
          .trim()
          .toLowerCase();
        const norm = normalizeSubjectKey(node?.name);
        node.hasSeededSubjectPapers = set.has(raw) || set.has(norm);
      } else {
        node.hasSeededSubjectPapers = false;
      }

      const nextExam = examKey || parentExamKey;
      if (node.children?.length) walk(node.children, nextExam);
    }
  };
  walk(nodes);
  return nodes;
};

export default {
  resolveSeededExamFromCategory,
  listSeededPapersForExam,
  listSeededPapersForCategory,
  listAllSeededPaperSummaries,
  getExamKeysWithSeededPapers,
  matchExamKeyFromCategoryName,
  annotateTreeWithSeededPapers,
  COMPETITIVE_EXAM_SUBJECT_SEED,
  normalizeSubjectKey,
};
