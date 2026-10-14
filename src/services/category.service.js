import { ApiError } from "../utils/ApiError.js";
import Category from "../models/Category.js";
import categoryRepository from "../repository/category.repository.js";
import QuestionBank from "../models/QuestionBank.js";
import Test from "../models/Test.js";
import TestBundle from "../models/TestBundle.js";
import Tournament from "../models/Tournament.js";
import orderRepository from "../repository/order.repository.js";
import eventRegistrationRepository from "../repository/eventRegistration.repository.js";
import tournamentRepository from "../repository/tournament.repository.js";
import { getApplicableOfferDetails } from "../utils/offerUtils.js";
import Offer from "../models/Offer.js";
import offerRepository from "../repository/offer.repository.js";
import { assertSubtreeNotPurchased } from "../utils/purchaseGuard.js";
import { sendUpgradeNotificationForCategory, sendRenameNotificationForCategory } from "./notification.service.js";

/**
 * Recursively create children under a parent category.
 * Supports unlimited nesting: School -> Classes -> Class 1 -> Subjects -> Math -> Geometry, etc.
 */
const createChildrenRecursive = async (children, parentId, createdBy, rootType, orderStart = 0) => {
  const created = [];
  let order = orderStart;
  for (const child of children) {
    const { name, children: nestedChildren } = child;
    const defaultStatus = rootType === "Olympiads" ? "Public" : "Draft";
    const payload = {
      name,
      parent: parentId,
      order: order++,
      createdBy,
      status: child.status || defaultStatus,
    };
    if (rootType && rootType !== "custom") {
      payload.rootType = rootType;
    }
    const category = await categoryRepository.create(payload);
    created.push(category);

    if (nestedChildren && nestedChildren.length > 0) {
      await createChildrenRecursive(
        nestedChildren,
        category._id,
        createdBy,
        rootType,
        0
      );
    }
  }
  return created;
};

/**
 * Create category - single or with unlimited nested children.
 * - Single: { name: "School" } or { name: "Classes", parent: "parentId" }
 * - Nested: { name: "School", children: [{ name: "Classes", children: [{ name: "Class 1", children: [...] }] }] }
 */
export const createCategory = async (data, createdBy) => {
  // --- Validation: Check for duplicate name at the same level ---
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(`^${escapeRegExp(data.name.trim())}$`, "i");
  const duplicateQuery = {
    parent: data.parent || null,
    name: nameRegex,
  };
  const duplicate = await Category.findOne(duplicateQuery);
  if (duplicate) {
    throw new ApiError(
      400,
      `A category/subcategory with the name "${data.name}" already exists at this level.`
    );
  }

  // Validate nested children payload for duplicates before performing any inserts
  if (data.children && data.children.length > 0) {
    const validateNoDuplicatesInPayload = (node) => {
      if (node.children && node.children.length > 0) {
        const seen = new Set();
        for (const child of node.children) {
          if (!child.name || typeof child.name !== 'string') {
            throw new ApiError(400, "Child category must have a valid name");
          }
          const nameLower = child.name.trim().toLowerCase();
          if (seen.has(nameLower)) {
            throw new ApiError(
              400,
              `Duplicate subcategory name "${child.name}" found under "${node.name}" in the request payload.`
            );
          }
          seen.add(nameLower);
          validateNoDuplicatesInPayload(child);
        }
      }
    };
    validateNoDuplicatesInPayload(data);
  }
  // -------------------------------------------------------------

  let parentNode = null;
  if (data.parent) {
    parentNode = await categoryRepository.findById(data.parent);
    if (!parentNode) throw new ApiError(404, "Parent category not found");

    if (["School", "Competitive", "Skill Development"].includes(parentNode.rootType)) {
      const qBanks = await QuestionBank.find({ categories: parentNode._id }).select('_id');
      if (qBanks.length > 0) {
        const tests = await Test.exists({ questionBank: { $in: qBanks.map(qb => qb._id) } });
        if (tests) {
          throw new ApiError(400, "Cannot add subcategories to a node that already contains tests.");
        }
      }
    }
  }

  let resolvedRootType = data.rootType || "custom";
  if (!data.rootType && parentNode && parentNode.rootType && parentNode.rootType !== "custom") {
    resolvedRootType = parentNode.rootType;
  }

  const defaultStatus = resolvedRootType === "Olympiads" ? "Public" : "Draft";
  const payload = {
    name: data.name,
    parent: data.parent || null,
    order: data.order ?? 0,
    createdBy,
    rootType: resolvedRootType,
    status: data.status || defaultStatus,
    ...(data.isPredefined !== undefined && { isPredefined: data.isPredefined }),
  };

  // Check discriminator type
  if (resolvedRootType === "Gamification") {
    payload.kind = "GamificationNode";
    // Also we can safely pull any gamification specifics from data
    if (data.gamificationType) payload.gamificationType = data.gamificationType;
  }

  const created = await categoryRepository.create(payload);

  if (data.children && data.children.length > 0) {
    const children = await createChildrenRecursive(
      data.children,
      created._id,
      createdBy,
      resolvedRootType,
      0
    );

    if (data.parent) {
      sendUpgradeNotificationForCategory(data.parent, data.name, "category", createdBy).catch(err => {
        console.error("Failed to send upgrade notification for category:", err);
      });
    }

    return { category: created, children };
  }

  if (data.parent) {
    sendUpgradeNotificationForCategory(data.parent, data.name, "category", createdBy).catch(err => {
      console.error("Failed to send upgrade notification for category:", err);
    });
  }

  return created;
};

export const getCategories = async (options = {}) => {
  options.sortBy = options.sortBy || "createdAt";
  options.sortOrder = options.sortOrder || "asc";
  return await categoryRepository.findAll({}, options);
};

export const getCategoryIdsWithTests = async () => {
  const allBankIds = await QuestionBank.find({}).select('categories _id');
  const allTestBanks = await Test.find({}).select('questionBank categoryId').lean();
  const bankIdsWithTests = new Set(allTestBanks.map(t => t.questionBank?.toString()).filter(Boolean));

  const categoryIdsWithTests = new Set();
  allBankIds.forEach(qb => {
    if (bankIdsWithTests.has(qb._id.toString())) {
      (qb.categories || []).forEach(cid => categoryIdsWithTests.add(cid.toString()));
    }
  });
  allTestBanks.forEach(test => {
    if (test.categoryId) {
      categoryIdsWithTests.add(test.categoryId.toString());
    }
  });
  return categoryIdsWithTests;
};

export const syncUpperCategoryStatuses = async (tree, categoryIdsWithTests) => {
  for (const pillarRoot of tree) {
    if (!pillarRoot.children?.length) continue;
    const rootType = pillarRoot.rootType;

    for (const level1 of pillarRoot.children) {
      if (level1.isPredefined) continue;

      const children = level1.children || [];
      let isLevel1Active = false;

      if (['School', 'Competitive', 'Olympiads'].includes(rootType)) {
        // Level 1: Folder (Engineering, Class 10)
        // Level 2: Exam / Main (JEE Mains, Class 10 Board)
        // Level 3: Subject Leaf (Chemistry, Physics)
        for (const exam of children) {
          const examStatus = String(exam.status || '').toLowerCase();
          if (examStatus === 'public') {
            const subjects = exam.children || [];
            if (subjects.length > 0) {
              const hasActiveSubject = subjects.some(sub =>
                String(sub.status || '').toLowerCase() === 'public' &&
                (categoryIdsWithTests.has(sub._id?.toString?.() || String(sub._id)) || sub.hasTests || sub.hasSeededSubjectPapers)
              );
              if (hasActiveSubject) {
                isLevel1Active = true;
                break;
              }
            } else {
              if (categoryIdsWithTests.has(exam._id?.toString?.() || String(exam._id)) || exam.hasTests || exam.hasSeededPapers) {
                isLevel1Active = true;
                break;
              }
            }
          }
        }
      } else {
        // Skill Development / Other
        // Level 1: Speed Tests (no edit button)
        // Level 2: Mathematics (no edit button)
        // Level 3: Addition, Subtraction (leaves with edit button)
        for (const child of children) {
          const isChildLeaf = !child.children || child.children.length === 0;
          if (isChildLeaf) {
            const childStatus = String(child.status || '').toLowerCase();
            if (childStatus === 'public') {
              if (categoryIdsWithTests.has(child._id?.toString?.() || String(child._id)) || child.hasTests) {
                isLevel1Active = true;
              }
            }
          } else {
            // Level 2 has children (e.g. Mathematics -> Addition, Subtraction)
            // Level 2 in Skill Development has NO edit button, so its status is determined by whether any child leaf is Public with tests!
            const hasActiveDescendant = (child.children || []).some(leaf =>
              String(leaf.status || '').toLowerCase() === 'public' &&
              (categoryIdsWithTests.has(leaf._id?.toString?.() || String(leaf._id)) || leaf.hasTests)
            );

            const desiredChildStatus = hasActiveDescendant ? 'Public' : 'Draft';
            if (child.status !== desiredChildStatus) {
              child.status = desiredChildStatus;
              await Category.findByIdAndUpdate(child._id, { status: desiredChildStatus });
            }

            if (hasActiveDescendant) {
              isLevel1Active = true;
            }
          }
        }
      }

      const desiredStatus = isLevel1Active ? 'Public' : 'Draft';
      if (level1.status !== desiredStatus) {
        level1.status = desiredStatus;
        await Category.findByIdAndUpdate(level1._id, { status: desiredStatus });
      }
    }
  }
};

export const getCategoryTree = async (filter = {}) => {
  // Ensure the 4 predefined pillar roots are always marked correctly.
  // This is a lightweight idempotent upsert that runs on every tree fetch.
  const PILLAR_ROOTS = [
    { name: "Competitive", rootType: "Competitive", order: 1 },
    { name: "School", rootType: "School", order: 2 },
    { name: "Skill Development", rootType: "Skill Development", order: 3 },
    { name: "Olympiads", rootType: "Olympiads", order: 4 },
    {
      name: "Gamification", rootType: "Gamification", order: 5, predefinedChildren: [
        { name: "Tournaments", order: 1 },
        { name: "Challenge Your Friend", order: 2 },
        { name: "Challenge Yourself", order: 3 },
        { name: "Everyday Challenge", order: 4 }
      ]
    }
  ];

  for (const pillar of PILLAR_ROOTS) {
    let parentId = null;
    const existing = await Category.findOne({ rootType: pillar.rootType, parent: null });
    if (existing) {
      const updates = { isPredefined: true };
      if (existing.name !== pillar.name) updates.name = pillar.name;
      if (existing.order !== pillar.order) updates.order = pillar.order;
      await Category.updateOne({ _id: existing._id }, updates);
      parentId = existing._id;
    } else {
      const byName = await Category.findOne({ name: pillar.name, parent: null });
      if (byName) {
        await Category.updateOne({ _id: byName._id }, { rootType: pillar.rootType, isPredefined: true, order: pillar.order });
        parentId = byName._id;
      } else {
        const createdPillar = await categoryRepository.create({
          name: pillar.name,
          parent: null,
          order: pillar.order,
          rootType: pillar.rootType,
          status: "Public",
          isPredefined: true,
          createdBy: null
        });
        parentId = createdPillar._id;
      }
    }

    if (pillar.predefinedChildren && parentId) {
      for (const childObj of pillar.predefinedChildren) {
        const childExist = await Category.findOne({ name: childObj.name, parent: parentId });
        if (!childExist) {
          const gamTypeMap = {
            "Challenge Yourself": "challenge_yourself",
            "Challenge Your Friend": "challenge_your_friend"
          };
          await categoryRepository.create({
            name: childObj.name,
            parent: parentId,
            order: childObj.order,
            rootType: pillar.rootType,
            status: "Public",
            isPredefined: true,
            createdBy: null,
            kind: "GamificationNode",
            gamificationType: gamTypeMap[childObj.name] || "base_pillar"
          });
        } else {
          const childUpdates = {};
          if (childExist.order !== childObj.order) childUpdates.order = childObj.order;
          if (Object.keys(childUpdates).length > 0) {
            await Category.updateOne({ _id: childExist._id }, childUpdates);
          }
        }
      }
    }
  }

  // Ensure any Olympiad category/subcategory is always marked Public (since pricing/details editing is disabled for Olympiads)
  await Category.updateMany(
    { rootType: "Olympiads", status: { $ne: "Public" } },
    { $set: { status: "Public" } }
  );

  const fullTree = await categoryRepository.findTree({});

  const categoryIdsWithTests = await getCategoryIdsWithTests();

  // Competitive: also flag exam nodes that have seeded *CompetitivePaper docs
  // so the pillar taxonomy can hide empty exams / subject leaves without papers.
  try {
    const { annotateTreeWithSeededPapers } = await import(
      "./seededCompetitivePapers.service.js"
    );
    await annotateTreeWithSeededPapers(fullTree);
    const { annotateCompetitiveSubjectTests } = await import(
      "./competitiveTest.service.js"
    );
    await annotateCompetitiveSubjectTests(fullTree);
  } catch (err) {
    console.warn(
      "getCategoryTree: seeded-paper annotate skipped:",
      err?.message || err
    );
  }

  const attachHasTests = (nodes) => {
    nodes.forEach(node => {
      const isLeaf = !node.children || node.children.length === 0;
      if (node.children?.length) {
        attachHasTests(node.children);
      }
      if (isLeaf) {
        node.hasTests = categoryIdsWithTests.has(node._id.toString()) ||
          Boolean(node.hasSeededSubjectPapers);
      } else {
        node.hasTests = categoryIdsWithTests.has(node._id.toString()) ||
          Boolean(node.hasSeededPapers) ||
          node.children.some(c => c.hasTests);
      }
    });
  };
  attachHasTests(fullTree);

  // Automatically determine and sync status for Level 1 folder categories (e.g. Engineering)
  // that do not have their own edit button.
  await syncUpperCategoryStatuses(fullTree, categoryIdsWithTests);

  if (filter && filter.rootType) {
    const requestedRoot = fullTree.find(n => n.rootType === filter.rootType);
    return requestedRoot ? [requestedRoot] : [];
  }

  return fullTree;
};

export const getCategoryById = async (id) => {
  const item = await categoryRepository.findById(id);
  if (!item) throw new ApiError(404, "Category not found");

  const obj = typeof item.toObject === "function" ? item.toObject() : { ...item };

  // ── Enrich: Node-type metadata (isLeaf / isSecondSubcategory / linkedSubjects) ──
  const children = await categoryRepository.findChildren(id);

  const childMeta = await Promise.all(
    children.map(async (child) => ({
      name: child.name,
      hasChildren: await categoryRepository.hasChildren(child._id),
    }))
  );

  const isLeaf = children.length === 0;
  const isSecondSubcategory = children.length > 0 && childMeta.every((c) => !c.hasChildren);

  const SUBJECT_PILLARS = ["School", "Competitive", "Olympiads"];
  const linkedSubcategories = isSecondSubcategory && SUBJECT_PILLARS.includes(obj.rootType)
    ? childMeta.map((c) => c.name)
    : [];

  const categoryIdsWithTests = await getCategoryIdsWithTests();
  const directHasTests = categoryIdsWithTests.has(id.toString());

  if (isLeaf) {
    obj.hasTests = directHasTests;
    // Auto-demote to Draft if a leaf has 0 tests but is currently Public in the database
    if (!directHasTests && String(obj.status || '').toLowerCase() === 'public') {
      obj.status = 'Draft';
      await Category.findByIdAndUpdate(id, { status: 'Draft' });
      await syncAncestorsStatusOnUpdate(id);
    }
  } else {
    const childDocs = await Category.find({ parent: id }).select('_id status').lean();
    const publicChildrenWithTests = childDocs.filter(c =>
      String(c.status || '').toLowerCase() === 'public' &&
      categoryIdsWithTests.has(c._id.toString())
    );
    obj.publicChildrenCount = publicChildrenWithTests.length;
    obj.hasTests = publicChildrenWithTests.length > 0 || directHasTests;
  }

  obj.isLeaf = isLeaf;
  obj.isSecondSubcategory = isSecondSubcategory;
  obj.linkedSubcategories = linkedSubcategories;

  // ── Enrich: Parent Category Status for Publish Permission check in UI ────────
  const parentNode = obj.parent
    ? (typeof obj.parent === 'object' && obj.parent.name
      ? obj.parent
      : await Category.findById(obj.parent).select("name status isPredefined").lean())
    : null;
  obj.parentCategory = parentNode
    ? {
      _id: parentNode._id?.toString?.() || parentNode._id,
      name: parentNode.name,
      status: parentNode.status,
      isPredefined: parentNode.isPredefined,
    }
    : null;
  obj.isParentDraft =
    parentNode &&
    !parentNode.isPredefined &&
    String(parentNode.status || '').toLowerCase() === 'draft';

  // ── Enrich: Global pillar-level offer (for Mode A display in UI) ────────────────
  const PILLAR_TO_APPLICABLE_ON = {
    "School": "School",
    "Competitive": "Competitive",
    "Skill Development": "Skill Development",
  };
  const applicableOn = PILLAR_TO_APPLICABLE_ON[obj.rootType];
  obj.globalOffer = applicableOn
    ? (await Offer.findOne({ applicableOn, status: "active" }).lean()) ?? null
    : null;

  // ── Enrich: Category-specific override offer (for Mode B display in UI) ─────────
  obj.overrideOffer = obj.offerOverrideId
    ? (await Offer.findById(obj.offerOverrideId).lean()) ?? null
    : null;
  // ─────────────────────────────────────────────────────────────────────────────────

  return obj;
};

export const getChildren = async (parentId) => {
  return await categoryRepository.findChildren(parentId);
};

const getConnectedCategoryIds = async (linkedTo, studentId, isCertification) => {
  if (!linkedTo) return null;

  let categoryIds = new Set();

  if (linkedTo === "course") {
    const Course = (await import("../models/Course.js")).default;
    const query = { isPublished: true };
    if (typeof isCertification !== "undefined") {
      query.isCertification = isCertification;
    }
    const fromCourses = await Course.find(query).distinct("categoryIds");
    fromCourses.forEach((id) => categoryIds.add(id?.toString?.() || id));
  }

  const DIRECT_PURCHASABLE_TEST_TYPES = [
    "test",
    "challenge_yourself",
    "challenge_your_friend",
    "competitive",
    "school",
    "skill development",
    "skill",
    "competition_sector",
    "trending_test"
  ];

  if (linkedTo === "questionBank") {
    const fromBanks = await QuestionBank.distinct("categories");
    fromBanks.forEach((id) => categoryIds.add(id?.toString?.() || id));
  }

  if (linkedTo === "test" || linkedTo === "both") {
    const publishedTests = await Test.find({
      isPublished: true,
      applicableFor: { $in: DIRECT_PURCHASABLE_TEST_TYPES }
    }).select("questionBank categoryId").lean();

    const publishedBankIds = [...new Set(publishedTests.map(t => t.questionBank?.toString()).filter(Boolean))];
    const directCategoryIds = [...new Set(publishedTests.map(t => t.categoryId?.toString()).filter(Boolean))];

    if (publishedBankIds.length > 0) {
      const fromTests = await QuestionBank.find({ _id: { $in: publishedBankIds } }).distinct("categories");
      fromTests.forEach((id) => categoryIds.add(id?.toString?.() || id));
    }
    directCategoryIds.forEach((id) => categoryIds.add(id));
  }

  if (linkedTo === "all" || linkedTo === "testBundle" || linkedTo === "both") {
    const activeBundles = await TestBundle.find({ isActive: true }).select("tests").lean();
    const allTestIds = activeBundles.flatMap((b) => b.tests || []);
    if (allTestIds.length > 0) {
      const bundleTests = await Test.find({ _id: { $in: allTestIds } }).select("questionBank categoryId").lean();

      const bankIdsFromBundles = [...new Set(bundleTests.map(t => t.questionBank?.toString()).filter(Boolean))];
      const directCategoryIdsFromBundles = [...new Set(bundleTests.map(t => t.categoryId?.toString()).filter(Boolean))];

      if (bankIdsFromBundles.length > 0) {
        const fromBundles = await QuestionBank.find({ _id: { $in: bankIdsFromBundles } }).distinct("categories");
        fromBundles.forEach((id) => categoryIds.add(id?.toString?.() || id));
      }
      directCategoryIdsFromBundles.forEach((id) => categoryIds.add(id));
    }
  }

  if (linkedTo === "all" || linkedTo === "tournament") {
    const publishedTournaments = await Tournament.find({ isPublished: true }).select("stages").lean();
    const testIds = publishedTournaments.flatMap((t) => (t.stages || []).map((s) => s.test).filter(Boolean));
    const uniqueTestIds = [...new Set(testIds)];
    if (uniqueTestIds.length > 0) {
      const bankIds = await Test.find({ _id: { $in: uniqueTestIds } }).distinct("questionBank");
      if (bankIds.length > 0) {
        const fromTournaments = await QuestionBank.find({ _id: { $in: bankIds } }).distinct("categories");
        fromTournaments.forEach((id) => categoryIds.add(id?.toString?.() || id));
      }
    }
  }

  if (linkedTo === "all" || linkedTo === "olympiad") {
    const Olympiad = (await import("../models/OlympiadTest.js")).default;
    const olympiads = await Olympiad.find({}).select("testId categoryId").lean();

    // Add direct categoryIds from the Olympiad model itself
    olympiads.forEach(o => {
      if (o.categoryId) categoryIds.add(o.categoryId.toString());
    });

    const olympiadTestIds = olympiads.map(o => o.testId).filter(Boolean);
    if (olympiadTestIds.length > 0) {
      const tests = await Test.find({ _id: { $in: olympiadTestIds } }).select("questionBank categoryId").lean();

      const bankIds = [...new Set(tests.map(t => t.questionBank?.toString()).filter(Boolean))];
      const directTestCategoryIds = [...new Set(tests.map(t => t.categoryId?.toString()).filter(Boolean))];

      if (bankIds.length > 0) {
        const fromOlympiads = await QuestionBank.find({ _id: { $in: bankIds } }).distinct("categories");
        fromOlympiads.forEach((id) => categoryIds.add(id?.toString?.() || id));
      }
      directTestCategoryIds.forEach((id) => categoryIds.add(id));
    }
  }

  if (linkedTo === "challenge") {
    if (!studentId) return categoryIds.size > 0 ? categoryIds : new Set();
    const Challenge = (await import("../models/Challenge.js")).default;
    const completedTestIds = await Challenge.find({
      "participants.student": studentId,
      roomStatus: "completed"
    }).distinct("test");

    if (completedTestIds.length > 0) {
      const challengeTests = await Test.find({
        _id: { $in: completedTestIds }
      }).select("questionBank categoryId").lean();

      const bankIds = [...new Set(challengeTests.map(t => t.questionBank?.toString()).filter(Boolean))];
      const directCategoryIds = [...new Set(challengeTests.map(t => t.categoryId?.toString()).filter(Boolean))];

      if (bankIds.length > 0) {
        const fromChallenges = await QuestionBank.find({ _id: { $in: bankIds } }).distinct("categories");
        fromChallenges.forEach((id) => categoryIds.add(id?.toString?.() || id));
      }
      directCategoryIds.forEach((id) => categoryIds.add(id));
    }
  }

  if (linkedTo === "examhall") {
    if (!studentId) {
      return new Set();
    }

    // 1) Purchased tests / bundles (from exam hall purchases helper)
    const purchases = await orderRepository.findTestPurchasesForExamHall(studentId);
    const bankIdsFromPurchases = new Set();
    purchases.forEach((p) => {
      if (p.test?.questionBank?._id || p.test?.questionBank) {
        const qb = p.test.questionBank;
        const qbId = qb._id?.toString?.() || qb.toString?.();
        if (qbId) bankIdsFromPurchases.add(qbId);
      }
      if (p.testBundle?.tests?.length) {
        p.testBundle.tests.forEach((t) => {
          const qb = t?.questionBank;
          const qbId = qb?._id?.toString?.() || qb?.toString?.();
          if (qbId) bankIdsFromPurchases.add(qbId);
        });
      }
    });

    // 2) Registered tournaments (from event registrations)
    const regs = await eventRegistrationRepository.find(
      {
        student: studentId,
        eventType: "tournament",
        paymentStatus: "completed",
      },
      { limit: 500 }
    );

    const tournamentIds = [
      ...new Set(regs.filter((r) => r.eventType === "tournament").map((r) => r.eventId).filter(Boolean)),
    ];

    const eventBankIds = new Set();

    if (tournamentIds.length > 0) {
      const tournaments = await tournamentRepository.find(
        { _id: { $in: tournamentIds } },
        {
          populate: [
            {
              path: "stages.test",
              select: "questionBank",
              populate: { path: "questionBank", select: "categories" },
            },
          ],
          limit: 500,
        }
      );
      tournaments.forEach((t) => {
        (t.stages || []).forEach((s) => {
          const qb = s?.test?.questionBank;
          const qbId = qb?._id?.toString?.() || qb?.toString?.();
          if (qbId) eventBankIds.add(qbId);
        });
      });
    }

    const allBankIds = new Set([...bankIdsFromPurchases, ...eventBankIds]);
    if (allBankIds.size > 0) {
      const fromExamHall = await QuestionBank.find({ _id: { $in: [...allBankIds] } }).distinct("categories");
      fromExamHall.forEach((id) => categoryIds.add(id?.toString?.() || id));
    }
  }

  return categoryIds.size > 0 ? categoryIds : new Set();
};

/**
 * Build id -> parentId map from tree (for ancestor lookup).
 */
const buildIdToParentFromTree = (nodes, map = new Map()) => {
  nodes.forEach((node) => {
    const id = node._id?.toString?.();
    const parentId = node.parent?._id?.toString?.() || node.parent?.toString?.() || null;
    if (id) map.set(id, parentId);
    if (node.children?.length) buildIdToParentFromTree(node.children, map);
  });
  return map;
};

/**
 * Include category and all its ancestors (for path context).
 */
const getAncestorIds = (categoryId, idToParent) => {
  const ids = new Set();
  let current = categoryId?.toString?.();
  while (current) {
    ids.add(current);
    current = idToParent.get(current) || null;
  }
  return ids;
};

/**
 * Filter tree to keep only nodes that are connected (or ancestors of connected).
 */
const filterTreeByConnected = (nodes, allowedIds) => {
  if (!allowedIds || allowedIds.size === 0) return nodes;

  return nodes
    .map((node) => {
      const id = node._id?.toString?.();
      const filteredChildren = node.children?.length
        ? filterTreeByConnected(node.children, allowedIds)
        : [];
      const hasRelevantDescendant = filteredChildren.length > 0;
      const isRelevant = allowedIds.has(id) || hasRelevantDescendant;

      if (!isRelevant) return null;
      return { ...node, children: filteredChildren };
    })
    .filter(Boolean);
};

/**
 * Prune tree for student UI:
 * - Omit any node with status "Draft" or "Private"
 * - Omit any leaf node that has 0 tests associated with it (e.g. Mathematics)
 * - Omit any parent node that has 0 valid child branches (e.g. Engineering or JEE Mains if no tests under them)
 */
export const pruneTreeForStudent = (nodes, categoryIdsWithTests) => {
  if (!Array.isArray(nodes)) return [];
  const result = [];

  for (const rawNode of nodes) {
    const node = rawNode.toObject ? rawNode.toObject() : { ...rawNode };
    const status = String(node.status || '').trim().toLowerCase();

    // 1. If this node itself is Draft (and not predefined root) -> exclude
    if (!node.isPredefined && (status === 'draft' || status === 'private')) {
      continue;
    }

    // 2. Recursively prune children first (bottom-up)
    const prunedChildren = (node.children && node.children.length > 0)
      ? pruneTreeForStudent(node.children, categoryIdsWithTests)
      : [];

    const isLeaf = !node.children || node.children.length === 0;

    if (isLeaf) {
      // Leaf node: MUST have tests associated with it!
      const hasTests = categoryIdsWithTests.has(node._id?.toString?.() || String(node._id)) ||
        Boolean(node.hasTests) ||
        Boolean(node.hasSeededSubjectPapers);

      if (!hasTests) {
        continue; // 0 tests -> pruned! (e.g. Mathematics)
      }
      result.push({ ...node, children: [] });
    } else {
      // Parent node: MUST have at least 1 valid pruned child!
      // (Unless it's the top-level predefined root, e.g. Competitive pillar root)
      if (prunedChildren.length === 0 && !node.isPredefined) {
        continue; // No valid children -> pruned! (e.g. Engineering or JEE Mains)
      }
      result.push({ ...node, children: prunedChildren });
    }
  }

  return result;
};

/**
 * Student-facing: Get all categories (tree) with optional filter by question bank / test / test bundle.
 * linkedTo: "questionBank" | "test" | "testBundle" | "both" | omit = show all
 * - test: only categories used by published tests
 * - testBundle: only categories used by tests that are in an active test bundle
 * - both: union of test + testBundle
 * format: "tree" | "flat"
 * prune: only true for resolveCategoryPathForStudent (hierarchical path resolution)
 */
export const getCategoriesForStudent = async (options = {}) => {
  const { linkedTo, format = "tree", rootType, studentId, isCertification, prune = false } = options;

  const filter = rootType ? { rootType } : {};
  let tree = await categoryRepository.findTree(filter);

  // Bottom-up pruning: filter out Draft nodes, 0-test leaves, and empty parent paths
  // ONLY applied when prune === true (e.g. for resolveCategoryPathForStudent)
  if (prune) {
    const categoryIdsWithTests = await getCategoryIdsWithTests();
    tree = pruneTreeForStudent(tree, categoryIdsWithTests);
  }

  if (linkedTo) {
    const connectedIds = await getConnectedCategoryIds(linkedTo, studentId, isCertification);
    if (connectedIds && connectedIds.size > 0) {
      const idToParent = buildIdToParentFromTree(tree);
      const allowedIds = new Set(connectedIds);
      for (const cid of connectedIds) {
        const ancestors = getAncestorIds(cid, idToParent);
        ancestors.forEach((a) => allowedIds.add(a));
      }
      tree = filterTreeByConnected(tree, allowedIds);
    } else {
      tree = [];
    }
  }

  // ── Attach computed prices to all subcategory nodes so frontend needs zero math ──
  const PILLAR_TO_APPLICABLE_ON = {
    "School": "School",
    "Competitive": "Competitive",
    "Skill Development": "Skill Development",
  };
  const applicableOn = rootType ? PILLAR_TO_APPLICABLE_ON[rootType] : null;

  if (applicableOn) {
    // Fetch the single active global offer for this pillar once (1 DB query for ALL nodes)
    const globalOffer = await offerRepository.getActiveOffer(applicableOn);

    // Fetch any custom override offers used by nodes in the tree efficiently
    const overrideIds = new Set();
    const collectIds = (node) => {
      if (node.offerOverrideId) overrideIds.add(node.offerOverrideId.toString());
      if (node.children?.length) node.children.forEach(collectIds);
    };
    tree.forEach(collectIds);

    const overrideMap = {};
    if (overrideIds.size > 0) {
      const activeOverrides = await Offer.find({ _id: { $in: Array.from(overrideIds) }, status: "active" }).lean();
      activeOverrides.forEach(o => overrideMap[o._id.toString()] = o);
    }

    const enrichNode = (node) => {
      if (node.price != null) {
        const basePrice = Number(node.price) || 0;

        let activeOffer = null;
        if (node.offerPolicy !== "none") {
          activeOffer = (node.offerOverrideId && overrideMap[node.offerOverrideId.toString()])
            ? overrideMap[node.offerOverrideId.toString()]
            : globalOffer;
        }

        if (node.isFree || basePrice === 0) {
          node.originalPrice = basePrice;
          node.effectivePrice = 0;
          node.discountedPrice = 0;
        } else if (node.discountedPrice !== null && node.discountedPrice !== undefined) {
          // Admin set a specific node-level discount. It overrides global offer completely.
          node.originalPrice = basePrice;
          const dp = Math.round(Number(node.discountedPrice) || 0);
          node.discountedPrice = dp;
          node.effectivePrice = dp;
        } else if (activeOffer) {
          let discountAmount = 0;
          if (activeOffer.discountType === "percentage") {
            discountAmount = (basePrice * activeOffer.discountValue) / 100;
          } else {
            discountAmount = Math.min(activeOffer.discountValue, basePrice);
          }
          const discountedPrice = Math.max(0, basePrice - discountAmount);
          node.originalPrice = basePrice;
          node.discountedPrice = Math.round(discountedPrice);
          node.effectivePrice = Math.round(discountedPrice);
          node.discountAmount = Math.round(discountAmount);
          node.appliedOffer = {
            _id: activeOffer._id,
            offerName: activeOffer.offerName,
            applicableOn: activeOffer.applicableOn,
            discountType: activeOffer.discountType,
            discountValue: activeOffer.discountValue,
            description: activeOffer.description,
            validTill: activeOffer.validTill,
          };
        } else {
          // No active offer (global or override) — pass through as-is
          node.originalPrice = basePrice;
          node.effectivePrice = basePrice;
          node.discountedPrice = basePrice;
        }
      }
      if (node.children?.length) node.children.forEach(enrichNode);
    };
    tree.forEach(enrichNode);
  }
  // ──────────────────────────────────────────────────────────────────────────────

  if (format === "flat") {
    const flatten = (nodes, acc = []) => {
      nodes.forEach((n) => {
        acc.push(n);
        if (n.children?.length) flatten(n.children, acc);
      });
      return acc;
    };
    return flatten(tree);
  }

  return tree;
};

export const updateCategory = async (id, updateData) => {
  const existing = await categoryRepository.findById(id);
  if (!existing) throw new ApiError(404, "Category not found");

  // --- Validation: Check for duplicate name at the same level ---
  const newName = updateData.name !== undefined ? updateData.name : existing.name;

  const existingParentId = existing.parent
    ? (existing.parent._id?.toString?.() || existing.parent.toString?.())
    : null;

  const newParentId = updateData.parent !== undefined
    ? (updateData.parent === "null" || updateData.parent === "" ? null : updateData.parent)
    : existingParentId;

  if (updateData.name !== undefined || updateData.parent !== undefined) {
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`^${escapeRegExp(newName.trim())}$`, "i");

    const duplicateQuery = {
      _id: { $ne: id },
      parent: newParentId || null,
      name: nameRegex,
    };

    const duplicate = await Category.findOne(duplicateQuery);
    if (duplicate) {
      throw new ApiError(
        400,
        `A category/subcategory with the name "${newName}" already exists at this level.`
      );
    }
  }
  // --------------------------------------------------------------

  // Edit allowed even if purchased.
  // Notification is sent if the name changed.
  if (updateData.parent !== undefined) {
    if (updateData.parent === id) {
      throw new ApiError(400, "Category cannot be its own parent");
    }
    if (updateData.parent) {
      const parent = await categoryRepository.findById(updateData.parent);
      if (!parent) throw new ApiError(404, "Parent category not found");
      if (parent.rootType && parent.rootType !== "custom") {
        updateData.rootType = parent.rootType;
      }
    }
  }
  const updated = await categoryRepository.updateById(id, updateData);

  // If the name changed, send a notification asynchronously
  if (updateData.name && updateData.name !== existing.name) {
    sendRenameNotificationForCategory(id, existing.name, updateData.name).catch(err => {
      console.error("Failed to send rename notification:", err);
    });
  }

  return updated;
};

/**
 * Automatically syncs the status of ancestor categories up the chain
 * when a category's status is updated (Draft or Public).
 *
 * Rules:
 * 1. Skill Development:
 *    - Level 2 (Mathematics) and Level 1 (Speed Tests) have NO edit button.
 *    - Auto-promotes to 'Public' when any child leaf has tests and is Public.
 *    - Auto-demotes to 'Draft' ONLY IF ALL sibling leaves are Draft or have 0 tests.
 * 2. School, Competitive, Olympiads:
 *    - Level 2 (Class 1, JEE Mains) HAS ITS OWN EDIT BUTTON and pricing.
 *    - MUST NOT be auto-promoted to 'Public' when a child leaf is published!
 *      Admin must manually publish Level 2.
 *    - Auto-demotes to 'Draft' if parent was 'Public' and now has 0 active public subjects with tests.
 * 3. Level 1 Folders (CBSE, Engineering, Speed Tests):
 *    - Have no edit button in any pillar.
 *    - School/Competitive: active ONLY IF at least one Level 2 child is BOTH manually Public AND has active subjects with tests.
 *    - Skill Development: active if any Level 2 child is Public with tests.
 */
export const syncAncestorsStatusOnUpdate = async (nodeId) => {
  const node = await Category.findById(nodeId).select('_id parent rootType status').lean();
  if (!node || !node.parent) return;

  const categoryIdsWithTests = await getCategoryIdsWithTests();
  let currentParentId = node.parent;

  while (currentParentId) {
    const parent = await Category.findById(currentParentId).select('_id parent rootType status isPredefined').lean();
    if (!parent || parent.isPredefined) break;

    // Check grandParent to determine if `parent` is Level 1 folder or Level 2 intermediate node
    const grandParent = parent.parent
      ? await Category.findById(parent.parent).select('_id isPredefined').lean()
      : null;
    const isLevel1 = !grandParent || Boolean(grandParent.isPredefined);

    // Fetch all immediate children of this parent
    const children = await Category.find({ parent: parent._id }).select('_id status').lean();

    if (isLevel1) {
      // ── Level 1 Folder (CBSE, Engineering, Speed Tests) ──────────────────────
      // Level 1 NEVER has an edit button in any pillar. Its status is auto-derived.
      let isLevel1Active = false;

      if (['School', 'Competitive', 'Olympiads'].includes(parent.rootType)) {
        // Active ONLY IF at least one Level 2 child is BOTH manually Public AND has active public subjects with tests
        for (const child of children) {
          const childStatus = String(child.status || '').toLowerCase();
          if (childStatus === 'public') {
            const grandChildren = await Category.find({ parent: child._id }).select('_id status').lean();
            if (grandChildren.length > 0) {
              const hasActiveSubject = grandChildren.some(gc =>
                String(gc.status || '').toLowerCase() === 'public' &&
                categoryIdsWithTests.has(gc._id.toString())
              );
              if (hasActiveSubject) {
                isLevel1Active = true;
                break;
              }
            } else {
              // Direct leaf test under exam
              if (categoryIdsWithTests.has(child._id.toString())) {
                isLevel1Active = true;
                break;
              }
            }
          }
        }
      } else {
        // Skill Development / Other
        // Active if any child (or descendant leaf) is Public with tests
        for (const child of children) {
          const childStatus = String(child.status || '').toLowerCase();
          const grandChildren = await Category.find({ parent: child._id }).select('_id status').lean();
          if (grandChildren.length === 0) {
            if (childStatus === 'public' && categoryIdsWithTests.has(child._id.toString())) {
              isLevel1Active = true;
              break;
            }
          } else {
            const hasActiveDescendant = grandChildren.some(gc =>
              String(gc.status || '').toLowerCase() === 'public' &&
              categoryIdsWithTests.has(gc._id.toString())
            );
            if (hasActiveDescendant) {
              isLevel1Active = true;
              break;
            }
          }
        }
      }

      const desiredStatus = isLevel1Active ? 'Public' : 'Draft';
      if (parent.status !== desiredStatus) {
        parent.status = desiredStatus;
        await Category.findByIdAndUpdate(parent._id, { status: desiredStatus });
      }
    } else {
      // ── Level 2 Node (Class 1, JEE Mains, Mathematics) ──────────────────────
      // Check if any child leaf has tests and is Public
      let hasActiveChildLeaf = false;
      for (const child of children) {
        const childStatus = String(child.status || '').toLowerCase();
        if (childStatus === 'public' && categoryIdsWithTests.has(child._id.toString())) {
          hasActiveChildLeaf = true;
          break;
        }
      }

      if (parent.rootType === 'Skill Development') {
        // In Skill Development, Level 2 (Mathematics) has NO edit button.
        // It strictly auto-syncs with its leaves!
        const desiredStatus = hasActiveChildLeaf ? 'Public' : 'Draft';
        if (parent.status !== desiredStatus) {
          parent.status = desiredStatus;
          await Category.findByIdAndUpdate(parent._id, { status: desiredStatus });
        }
      } else {
        // In School, Competitive, Olympiads:
        // Level 2 (Class 1, JEE Mains) HAS ITS OWN EDIT BUTTON!
        // Admin must manually publish Level 2.
        // Rule: NEVER auto-promote from 'Draft' to 'Public'!
        // Downside Draft Rule: If parent was 'Public' but now has 0 active children with tests,
        // it auto-demotes to 'Draft'.
        if (parent.status === 'Public' && !hasActiveChildLeaf) {
          parent.status = 'Draft';
          await Category.findByIdAndUpdate(parent._id, { status: 'Draft' });
        }
        // If parent is 'Draft', it REMAINS 'Draft' (do NOT auto-promote to 'Public'!)
      }
    }

    currentParentId = parent.parent;
  }
};

export const updateCategoryPricing = async (id, updateData) => {
  const existing = await categoryRepository.findById(id);
  if (!existing) throw new ApiError(404, "Category not found");
  // Permitting editing of price, offer, coupon even when purchased
  const payload = { ...updateData };
  if (payload.price !== undefined && payload.price !== null) {
    payload.price = Math.round(Number(payload.price) || 0);
  }
  if (payload.discountedPrice !== undefined && payload.discountedPrice !== null) {
    payload.discountedPrice = Math.round(Number(payload.discountedPrice) || 0);
  }

  // ── Validation when publishing ──────────────────────────────────────────────
  if (payload.status === "Public") {
    const categoryIdsWithTests = await getCategoryIdsWithTests();
    const children = await Category.find({ parent: id }).select('_id status').lean();
    const isLeaf = children.length === 0;

    if (isLeaf) {
      const hasTests = categoryIdsWithTests.has(id.toString());
      if (!hasTests) {
        throw new ApiError(
          400,
          `Cannot publish "${existing.name}" because no tests or papers are associated with it. Please add at least 1 test before publishing.`
        );
      }
    } else {
      // Exam / class node (e.g. JEE Mains): must have at least 1 child subject that is Public with tests
      const hasPublicChildWithTests = children.some(c =>
        String(c.status || '').toLowerCase() === 'public' &&
        categoryIdsWithTests.has(c._id.toString())
      );
      if (!hasPublicChildWithTests) {
        throw new ApiError(
          400,
          `Cannot publish "${existing.name}" because none of its child subcategories are published with tests. Please publish at least one child subject first.`
        );
      }
    }
  }

  const updated = await categoryRepository.updateById(id, payload);

  // Status cascade / auto-decision logic
  if (payload.status) {
    await syncAncestorsStatusOnUpdate(id);
  }

  return updated;
};

export const getNodeWithEffectivePrice = async (id) => {
  const node = await categoryRepository.findById(id);
  if (!node) throw new ApiError(404, "Category not found");

  const obj = typeof node.toObject === "function" ? node.toObject() : { ...node };

  if (obj.isFree) {
    obj.effectivePrice = 0;
    return obj;
  }

  if (obj.discountedPrice !== null && obj.discountedPrice !== undefined) {
    // Admin set a specific node-level discount. It overrides global offer completely.
    obj.effectivePrice = Math.round(Number(obj.discountedPrice) || 0);
    return obj;
  }

  // Fallback to global offer
  const rootTypeMap = {
    "School": "School",
    "Competitive": "Competitive",
    "Skill Development": "Skill Development"
  };
  const moduleName = rootTypeMap[obj.rootType] || "Category";

  const offerDetails = await getApplicableOfferDetails(moduleName, obj.price || 0);

  obj.appliedOffer = offerDetails.appliedOffer;
  obj.originalPrice = offerDetails.originalPrice;
  obj.discountedPrice = offerDetails.discountedPrice;
  obj.discountAmount = offerDetails.discountAmount;
  obj.effectivePrice = offerDetails.discountedPrice;

  if (!offerDetails.appliedOffer) {
    delete obj.appliedOffer;
    delete obj.discountAmount;
    obj.effectivePrice = obj.originalPrice;
  }

  return obj;
};

export const deleteCategory = async (id, cascade = true) => {
  const existing = await categoryRepository.findById(id);
  if (!existing) throw new ApiError(404, "Category not found");
  await assertSubtreeNotPurchased(id, "delete");
  if (cascade) {
    return await categoryRepository.deleteByIdCascade(id);
  }
  const hasChild = await categoryRepository.hasChildren(id);
  if (hasChild) {
    throw new ApiError(
      400,
      "Cannot delete category with subcategories. Use cascade delete or delete children first."
    );
  }
  return await categoryRepository.deleteById(id);
};

/**
 * Automatically demotes a subcategory to 'Draft' when its last test is deleted.
 * Also cascades status check up to ancestors via syncAncestorsStatusOnUpdate.
 */
export const syncCategoryAfterTestDeleted = async (doc) => {
  if (!doc) return;
  try {
    const targetCategoryIds = new Set();
    if (doc.categoryId) {
      targetCategoryIds.add(doc.categoryId.toString());
    }
    if (doc.questionBank) {
      const qb = await QuestionBank.findById(doc.questionBank).select('categories').lean();
      if (qb?.categories?.length) {
        qb.categories.forEach(cid => targetCategoryIds.add(cid.toString()));
      }
    }

    if (targetCategoryIds.size === 0) return;

    for (const cid of targetCategoryIds) {
      const hasDirectTest = await Test.exists({ categoryId: cid });
      let hasBankTest = false;
      if (!hasDirectTest) {
        const banksWithCategory = await QuestionBank.find({ categories: cid }).select('_id').lean();
        if (banksWithCategory.length > 0) {
          const bankIds = banksWithCategory.map(b => b._id);
          hasBankTest = await Test.exists({ questionBank: { $in: bankIds } });
        }
      }

      const hasRemainingTests = Boolean(hasDirectTest || hasBankTest);

      if (!hasRemainingTests) {
        const cat = await Category.findById(cid).select('_id status').lean();
        if (cat && String(cat.status || '').toLowerCase() === 'public') {
          await Category.findByIdAndUpdate(cid, { status: 'Draft' });
        }
        await syncAncestorsStatusOnUpdate(cid);
      }
    }
  } catch (err) {
    console.error('syncCategoryAfterTestDeleted error:', err);
  }
};

export default {
  createCategory,
  getCategories,
  getCategoryTree,
  getCategoryById,
  getChildren,
  getCategoriesForStudent,
  getCategoryIdsWithTests,
  pruneTreeForStudent,
  syncUpperCategoryStatuses,
  syncAncestorsStatusOnUpdate,
  syncCategoryAfterTestDeleted,
  updateCategory,
  updateCategoryPricing,
  getNodeWithEffectivePrice,
  deleteCategory,
};
