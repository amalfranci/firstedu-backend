import Test from "../models/Test.js";
import Category from "../models/Category.js";
import Question from "../models/Question.js";
import AiQuestion from "../models/AiQuestion.js";
import { attachOfferToList } from "../utils/offerUtils.js";
import categoryRepository from "../repository/category.repository.js";
import {
  listSeededPapersForCategory,
} from "./seededCompetitivePapers.service.js";

async function attachQuestionCounts(tests = []) {
  const manualIds = [];
  const aiIds = [];
  for (const test of tests) {
    if (!test || test.isSeededPaper || test.totalQuestions) continue;
    if (test.questionBank) manualIds.push(test.questionBank);
    if (test.aiQuestionBank) aiIds.push(test.aiQuestionBank);
  }
  if (!manualIds.length && !aiIds.length) return tests;

  const nonParentFilter = {
    isParent: { $ne: true },
  };

  const [manual, ai] = await Promise.all([
    manualIds.length
      ? Question.aggregate([
          { $match: { questionBank: { $in: manualIds }, ...nonParentFilter } },
          { $group: { _id: "$questionBank", total: { $sum: 1 } } },
        ])
      : [],
    aiIds.length
      ? AiQuestion.aggregate([
          { $match: { aiQuestionBank: { $in: aiIds }, ...nonParentFilter } },
          { $group: { _id: "$aiQuestionBank", total: { $sum: 1 } } },
        ])
      : [],
  ]);
  const counts = new Map();
  for (const row of [...manual, ...ai]) {
    counts.set(String(row._id), row.total || 0);
  }
  return tests.map((test) => {
    if (!test || test.totalQuestions) return test;
    const bankId = String(test.aiQuestionBank || test.questionBank || "");
    return { ...test, totalQuestions: counts.get(bankId) || 0 };
  });
}

/**
 * Walk the category tree upward from `startId` and return a
 * human-readable path string like "Competitive > JEE Main > Mathematics".
 */
async function buildCategoryPath(startId) {
  if (!startId) return '';
  const leaf = await Category.findById(startId).select('name parent').lean();
  if (!leaf) return '';

  const visited = new Map();
  visited.set(leaf._id.toString(), leaf);

  let idsToFetch = leaf.parent ? [leaf.parent] : [];
  for (let depth = 0; depth < 10; depth++) {
    if (!idsToFetch.length) break;
    const ancestors = await Category
      .find({ _id: { $in: idsToFetch } })
      .select('name parent')
      .lean();
    idsToFetch = [];
    for (const anc of ancestors) {
      visited.set(anc._id.toString(), anc);
      if (anc.parent && !visited.has(anc.parent.toString())) {
        idsToFetch.push(anc.parent);
      }
    }
  }

  const parts = [];
  let current = leaf;
  while (current) {
    parts.push(current.name);
    const parentId = current.parent ? current.parent.toString() : null;
    current = parentId ? visited.get(parentId) : null;
  }
  parts.reverse();
  return parts.join(' > ');
}

export const createCompetitiveTest = async (data) => {
  // Legacy bypass: Tests now structurally link directly via Test module
  return true;
};

export const getCompetitiveTests = async (options = {}) => {
  const {
    categoryId,
    page = 1,
    limit = 10,
    search,
    isPublished,
    includeSeededPapers = false,
  } = options;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const query = {};
  if (categoryId) {
    const descendantIds = await categoryRepository.findDescendantIds(categoryId);
    query.categoryId = { $in: descendantIds };
  }
  // When isPublished flag is provided, filter by publish status.
  // Student routes pass isPublished: true so draft tests are never exposed.
  // Admin routes omit this flag so all tests (including drafts) are returned.
  if (isPublished !== undefined) {
    query.isPublished = isPublished;
  }
  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }

  // Exclude seeded raw papers — tests must be linked to a real question bank
  query.paperSource = { $nin: ["jee_main_db"] };
  query.jeeMainPaper = null;
  query.$or = [
    { questionBank: { $ne: null } },
    { aiQuestionBank: { $ne: null } },
  ];

  // Build the full ancestor path once (all tests on this page share the same category)
  const categoryPath = await buildCategoryPath(categoryId);

  const [rawTests, manualTotal] = await Promise.all([
    Test.find(query).sort({ createdAt: -1 }).lean(),
    Test.countDocuments(query),
  ]);

  let tests = rawTests
    .map((t) => ({
      ...t,
      categoryPath,
      sourceType: (t.paperSource === "ai" || Boolean(t.aiQuestionBank)) ? "ai" : "manual",
      isSeededPaper: Boolean(t.jeeMainPaper) || String(t.paperSource || "").endsWith("_db"),
      paperId: t.jeeMainPaper || t.paperId || null,
      testId: {
        _id: t._id,
        title: t.title,
        durationMinutes: t.durationMinutes,
        price: t.price ?? 0,
        originalPrice: t.price ?? 0,
        effectivePrice: t.price ?? 0,
      },
    }))
    .filter((test) => !test.isSeededPaper && (test.questionBank || test.aiQuestionBank));

  // Admin competitive pillar: also surface seeded papers that only live in
  // *competitivepapers collections (NEET, CAT, …) and are not yet Test docs.
  if (includeSeededPapers && categoryId) {
    const seeded = await listSeededPapersForCategory(categoryId, {
      categoryPath,
    });
    if (seeded.tests?.length) {
      const seen = new Set(
        tests.map((t) => {
          if (t.jeeMainPaper) return `paper:${t.jeeMainPaper}`;
          if (t.paperId) return `paper:${t.paperId}`;
          return `test:${t._id}`;
        })
      );

      for (const seededTest of seeded.tests) {
        const paperKey = seededTest.paperId
          ? `paper:${seededTest.paperId}`
          : `test:${seededTest._id}`;
        if (seen.has(paperKey)) continue;
        if (seen.has(`test:${seededTest._id}`)) continue;
        if (search) {
          const hay = String(seededTest.title || "").toLowerCase();
          if (!hay.includes(String(search).toLowerCase())) continue;
        }
        if (
          isPublished !== undefined &&
          Boolean(seededTest.isPublished) !== Boolean(isPublished)
        ) {
          continue;
        }
        seen.add(paperKey);
        tests.push(seededTest);
      }
    }
  }

  tests.sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  const total = Math.max(manualTotal, tests.length);
  tests = tests.slice(skip, skip + limitNum);
  tests = await attachQuestionCounts(tests);

  if (tests.length > 0 && categoryId) {
    const category = await Category.findById(categoryId).lean();
    if (category?.isFree) {
      tests = tests.map(t => ({
        ...t,
        originalPrice: t.price || 0,
        discountedPrice: 0,
        effectivePrice: 0,
        discountAmount: t.price || 0,
      }));
    } else {
      // Use pillar-level offer (e.g. "Competitive") when available; "Test" as fallback
      const pillarModuleType = category?.rootType || "Test";
      tests = await attachOfferToList(tests, pillarModuleType, "price");
    }
  } else if (tests.length > 0) {
    tests = await attachOfferToList(tests, "Test", "price");
  }

  return {
    tests,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum) || 1,
    },
  };
};

export const updateCompetitiveTest = async (id, updateData) => {
  // Not used actively since edits hit the main Test Builder API
  return true;
};

export const deleteCompetitiveTest = async (id) => {
  return await Test.findByIdAndDelete(id);
};

export default {
  createCompetitiveTest,
  getCompetitiveTests,
  updateCompetitiveTest,
  deleteCompetitiveTest,
};
