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
    const payload = {
      name,
      parent: parentId,
      order: order++,
      createdBy,
      status: child.status || "Draft",
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

  const payload = {
    name: data.name,
    parent: data.parent || null,
    order: data.order ?? 0,
    createdBy,
    rootType: resolvedRootType,
    status: data.status || "Draft",
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

  const fullTree = await categoryRepository.findTree({});

  // Attach hasTests boolean to nodes
  const allBankIds = await QuestionBank.find({}).select('categories _id');
  const allTestBanks = await Test.find({}).select('questionBank categoryId').lean();
  const bankIdsWithTests = new Set(allTestBanks.map(t => t.questionBank?.toString()));

  const categoryIdsWithTests = new Set();

  allBankIds.forEach(qb => {
    if (bankIdsWithTests.has(qb._id.toString())) {
      qb.categories.forEach(cid => categoryIdsWithTests.add(cid.toString()));
    }
  });

  // Also include direct links where Test natively defines categoryId
  allTestBanks.forEach(test => {
    if (test.categoryId) {
      categoryIdsWithTests.add(test.categoryId.toString());
    }
  });

  const attachHasTests = (nodes) => {
    nodes.forEach(node => {
      node.hasTests = categoryIdsWithTests.has(node._id.toString());
      if (node.children?.length) {
        attachHasTests(node.children);
      }
    });
  };
  attachHasTests(fullTree);

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

  obj.isLeaf = isLeaf;
  obj.isSecondSubcategory = isSecondSubcategory;
  obj.linkedSubcategories = linkedSubcategories;

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
 * Student-facing: Get all categories (tree) with optional filter by question bank / test / test bundle.
 * linkedTo: "questionBank" | "test" | "testBundle" | "both" | omit = show all
 * - test: only categories used by published tests
 * - testBundle: only categories used by tests that are in an active test bundle
 * - both: union of test + testBundle
 * format: "tree" | "flat"
 */
export const getCategoriesForStudent = async (options = {}) => {
  const { linkedTo, format = "tree", rootType, studentId, isCertification } = options;

  const filter = rootType ? { rootType } : {};
  let tree = await categoryRepository.findTree(filter);

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
          node.effectivePrice = node.discountedPrice;
        } else if (activeOffer) {
          let discountAmount = 0;
          if (activeOffer.discountType === "percentage") {
            discountAmount = (basePrice * activeOffer.discountValue) / 100;
          } else {
            discountAmount = Math.min(activeOffer.discountValue, basePrice);
          }
          const discountedPrice = Math.max(0, basePrice - discountAmount);
          node.originalPrice = basePrice;
          node.discountedPrice = discountedPrice;
          node.effectivePrice = discountedPrice;
          node.discountAmount = discountAmount;
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

export const updateCategoryPricing = async (id, updateData) => {
  const existing = await categoryRepository.findById(id);
  if (!existing) throw new ApiError(404, "Category not found");
  // Permitting editing of price, offer, coupon even when purchased
  return await categoryRepository.updateById(id, updateData);
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
    obj.effectivePrice = obj.discountedPrice;
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

export default {
  createCategory,
  getCategories,
  getCategoryTree,
  getCategoryById,
  getChildren,
  getCategoriesForStudent,
  updateCategory,
  updateCategoryPricing,
  getNodeWithEffectivePrice,
  deleteCategory,
};
