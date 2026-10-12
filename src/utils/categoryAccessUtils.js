/**
 * categoryAccessUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared utility for resolving post-purchase access status for all 3 pillars
 * (Competitive, School, Skill Development).
 *
 * Handles every edge-case scenario:
 *  1. Student never purchased → no access
 *  2. Student purchased, no new content, no price change → full access (no upgrade needed)
 *  3. Student purchased, new tests/sub-cats added, price same or LOWER → free upgrade
 *  4. Student purchased, admin RAISED price → diff = newPrice - paidSoFar (>0)
 *     4a. Old content stays unlocked regardless — only NEW content is gated
 *
 * Returns a rich AccessStatus object consumed by all 3 pillar test controllers
 * and getCategoryDetailForStudent.
 */

import Category from "../models/Category.js";
import CategoryPurchase from "../models/CategoryPurchase.js";
import categoryRepository from "../repository/category.repository.js";
import Test from "../models/Test.js";
import TestPurchase from "../models/TestPurchase.js";
import Offer from "../models/Offer.js";
import offerRepository from "../repository/offer.repository.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch ALL descendant category IDs under a given parent (recursive).
 * Uses a single DB round-trip per depth level (no N+1).
 */
export const fetchDescendantIds = async (categoryId) => {
  const children = await categoryRepository.findChildren(categoryId);
  let ids = [];
  for (const child of children) {
    ids.push(child._id.toString());
    const subIds = await fetchDescendantIds(child._id);
    ids = ids.concat(subIds);
  }
  return ids; // array of strings
};

/**
 * Get the effective price of a category (discountedPrice takes priority over price).
 * Returns 0 if the category is free.
 */
const getEffectivePrice = async (category) => {
  if (category.isFree || !category.price) return 0;

  const basePrice = Number(category.price) || 0;

  const PILLAR_MAP = {
    "School": "School",
    "Competitive": "Competitive",
    "Skill Development": "Skill Development",
  };
  const applicableOn = category.rootType ? PILLAR_MAP[category.rootType] : null;

  let activeOffer = null;
  if (category.offerOverrideId) {
    activeOffer = await Offer.findOne({ _id: category.offerOverrideId, status: "active" }).lean();
  }

  if (!activeOffer && applicableOn) {
    activeOffer = await offerRepository.getActiveOffer(applicableOn);
  }

  if (activeOffer) {
    let discountAmount = 0;
    if (activeOffer.discountType === "percentage") {
      discountAmount = (basePrice * activeOffer.discountValue) / 100;
    } else {
      discountAmount = Math.min(activeOffer.discountValue, basePrice);
    }
    return Math.round(Math.max(0, basePrice - discountAmount));
  }

  // Fallback to static discount or base price
  if (category.discountedPrice !== null && category.discountedPrice !== undefined) {
    return Math.round(category.discountedPrice);
  }
  return Math.round(basePrice);
};

// ─── Core Export ─────────────────────────────────────────────────────────────

/**
 * Resolve a student's complete access status for a given category node.
 *
 * @param {string|ObjectId} studentId
 * @param {string|ObjectId} categoryId
 * @returns {Promise<AccessStatus>}
 *
 * AccessStatus shape:
 * {
 *   hasAccess:        boolean   — student has any existing access to this category
 *   upgradable:       boolean   — an upgrade action is meaningful (new content exists)
 *   upgradeCost:      number    — 0 = free upgrade; >0 = pay this amount to unlock new content
 *   isFreeUpgrade:    boolean   — shortcut: upgradable && upgradeCost === 0
 *   newCategoryIds:   string[]  — descendant IDs added AFTER their purchase snapshot
 *   purchase:         doc|null  — the raw CategoryPurchase document (or null)
 *   paidSoFar:        number    — what the student paid originally (0 if no purchase)
 *   currentPrice:     number    — category's current effective price
 * }
 */
export const resolveAccessStatus = async (studentId, categoryId) => {
  const catIdStr = categoryId.toString();

  // ── 1. Check if student has any purchase that grants access ───────────────
  const purchase = await CategoryPurchase.findOne({
    student: studentId,
    paymentStatus: "completed",
    $or: [
      { categoryId: catIdStr },
      { unlockedCategoryIds: catIdStr },
    ],
  }).sort({ createdAt: -1 });

  // ── 2. No purchase at all → locked ────────────────────────────────────────
  if (!purchase) {
    return {
      hasAccess: false,
      upgradable: false,
      upgradeCost: 0,
      isFreeUpgrade: false,
      newCategoryIds: [],
      purchase: null,
      paidSoFar: 0,
      currentPrice: 0,
    };
  }

  // ── 3. Check the purchased category still exists ─────────────────────────
  const purchasedCategoryId = purchase.categoryId?.toString?.() || purchase.categoryId;
  const purchasedCategory = await Category.findById(purchasedCategoryId).lean();
  if (!purchasedCategory) {
    return {
      hasAccess: false,
      upgradable: false,
      upgradeCost: 0,
      isFreeUpgrade: false,
      newCategoryIds: [],
      purchase,
      paidSoFar: purchase.purchasePrice,
      currentPrice: 0,
    };
  }

  // ── Price comparison is against the VIEWED node's own price ───────────────
  // Correct scenario: student purchased RBSE (free, ₹0) which unlocked class1 (₹3000).
  // When admin adds a test to class1, upgrade cost must use class1's price (₹3000),
  // NOT RBSE's price (₹0). Otherwise isFreeUpgrade=true fires incorrectly.
  // If the viewed node IS the purchased node, reuse the already-fetched document.
  const viewedCategory = catIdStr === purchasedCategoryId
    ? purchasedCategory
    : await Category.findById(categoryId).lean();
  const currentPrice = Math.round(await getEffectivePrice(viewedCategory ?? purchasedCategory));

  const paidSoFar = Math.round(purchase.purchasePrice || 0);

  // ── 4. Determine price diff ───────────────────────────────────────────────
  // If diff <= 0 (price unchanged or admin actually lowered it) → free upgrade.
  // If diff > 0 → student owes the difference to unlock NEW content.
  const priceDiff = currentPrice - paidSoFar;
  const upgradeCost = Math.round(Math.max(0, priceDiff)); // never negative

  // ── 5. Find newly added descendant categories ─────────────────────────────
  // All current descendants
  const allCurrentDescendants = await fetchDescendantIds(categoryId);

  // What the student already has unlocked (snapshot from ALL purchases)
  const allStudentPurchases = await CategoryPurchase.find({ student: studentId, paymentStatus: "completed" }).select("unlockedCategoryIds").lean();
  const alreadyUnlocked = new Set();
  allStudentPurchases.forEach(p => {
    if (p.unlockedCategoryIds) {
      p.unlockedCategoryIds.forEach(id => alreadyUnlocked.add(id.toString()));
    }
  });

  // New descendants = exist now but were NOT in the purchase snapshot
  const newCategoryIds = allCurrentDescendants.filter(
    (id) => !alreadyUnlocked.has(id)
  );

  // ── 5.5 Find newly added Tests (tests created after purchase.lastUpgradedAt)
  const purchaseDate = purchase.lastUpgradedAt || purchase.createdAt;
  let hasNewTests = false;

  const boughtTests = await TestPurchase.find({ student: studentId, paymentStatus: "completed" }).select("test").lean();
  const boughtTestIds = boughtTests.filter(p => p && p.test).map(p => p.test.toString());

  const allCatIds = [categoryId.toString(), ...allCurrentDescendants];
  const newTestExists = await Test.exists({
    categoryId: { $in: allCatIds },
    isPublished: true,
    createdAt: { $gt: purchaseDate },
    _id: { $nin: boughtTestIds }
  });
  hasNewTests = !!newTestExists;

  const upgradable = (newCategoryIds.length > 0) || hasNewTests;

  // ── 6. Decide if upgrade UI is needed ─────────────────────────────────────
  const isFreeUpgrade = upgradable && upgradeCost === 0;

  return {
    hasAccess: true,
    upgradable,
    upgradeCost,
    isFreeUpgrade,
    newCategoryIds,
    purchase,
    paidSoFar,
    currentPrice,
    purchaseDate,
  };
};

/**
 * Bulk version of resolveAccessStatus — same output shape per node, but optimised:
 * - Fetches ALL student purchases in 1 query (instead of 1 per node)
 * - Fetches ALL test purchases in 1 query (instead of 1 per node)
 * - Resolves descendant IDs from the in-memory tree (no recursive DB calls)
 * - Reads effectivePrice from the already-enriched tree node (no Offer DB calls)
 * - Still runs 1 Test.exists per node that has a purchase (unavoidable per-node check)
 *
 * API response shape per node is identical to resolveAccessStatus so mobile + web are unaffected.
 *
 * @param {string|ObjectId} studentId
 * @param {Object[]}        nodes   — the immediate children to enrich (already have price fields)
 * @param {Object[]}        tree    — full enriched pillar tree (used for in-memory lookups)
 */
export const resolveBulkAccessStatus = async (studentId, nodes, tree) => {
  // ── 1. Single DB call: all completed purchases for this student ─────────────
  const purchases = await CategoryPurchase.find({
    student: studentId,
    paymentStatus: "completed",
  }).sort({ createdAt: -1 }).lean();

  // No purchases at all → all nodes locked, return immediately
  if (!purchases || purchases.length === 0) {
    return nodes.map((node) => ({
      ...node,
      hasAccess: false,
      upgradable: false,
      upgradeCost: 0,
      isFreeUpgrade: false,
      newCategoryIds: [],
      purchase: null,
      paidSoFar: 0,
      currentPrice: 0,
    }));
  }

  // ── 2. Single DB call: all bought test IDs ─────────────────────────────────
  const boughtTests = await TestPurchase.find({
    student: studentId,
    paymentStatus: "completed",
  }).select("test").lean();
  const boughtTestIds = boughtTests
    .filter((p) => p && p.test)
    .map((p) => p.test.toString());

  // ── 3. Build alreadyUnlocked set from all purchases (in memory) ────────────
  const alreadyUnlocked = new Set();
  purchases.forEach((p) => {
    if (p.unlockedCategoryIds) {
      p.unlockedCategoryIds.forEach((id) => alreadyUnlocked.add(id.toString()));
    }
  });

  // ── In-memory tree helpers ─────────────────────────────────────────────────

  /** Find any node anywhere in the tree by its _id string */
  const findNodeInTree = (targetId, layer) => {
    for (const item of layer) {
      if (item._id?.toString() === targetId) return item;
      if (item.children?.length) {
        const found = findNodeInTree(targetId, item.children);
        if (found) return found;
      }
    }
    return null;
  };

  /** Collect all descendant IDs of a tree node (in memory, no DB) */
  const getDescendantIdsInMemory = (node) => {
    const ids = [];
    const gather = (n) => {
      if (n.children?.length) {
        for (const child of n.children) {
          ids.push(child._id.toString());
          gather(child);
        }
      }
    };
    gather(node);
    return ids;
  };

  // ── 4. Process each node (only Test.exists is still per-node) ─────────────
  return Promise.all(
    nodes.map(async (node) => {
      const catIdStr = node._id.toString();

      // Find the purchase that grants access to this node
      const purchase = purchases.find(
        (p) =>
          p.categoryId?.toString() === catIdStr ||
          (p.unlockedCategoryIds &&
            p.unlockedCategoryIds.some((id) => id.toString() === catIdStr))
      );

      // No purchase → locked
      if (!purchase) {
        return {
          ...node,
          hasAccess: false,
          upgradable: false,
          upgradeCost: 0,
          isFreeUpgrade: false,
          newCategoryIds: [],
          purchase: null,
          paidSoFar: 0,
          currentPrice: 0,
        };
      }

      // ── Price comparison against the VIEWED node's own price ───────────────
      // node IS the viewed child (class1, bio etc.) — effectivePrice already enriched
      // by getCategoriesForStudent enrichNode(), no extra DB call needed.
      const currentPrice = Math.round(node.effectivePrice ?? node.price ?? 0);

      const paidSoFar = Math.round(purchase.purchasePrice || 0);
      const priceDiff = currentPrice - paidSoFar;
      const upgradeCost = Math.round(Math.max(0, priceDiff));

      // ── Descendant IDs: from in-memory tree (no recursive DB calls) ─────────
      const nodeInTree = findNodeInTree(catIdStr, tree);
      const allCurrentDescendants = nodeInTree
        ? getDescendantIdsInMemory(nodeInTree)
        : [];

      const newCategoryIds = allCurrentDescendants.filter(
        (id) => !alreadyUnlocked.has(id)
      );

      // ── New tests check: still one Test.exists per accessed node ────────────
      const purchaseDate = purchase.lastUpgradedAt || purchase.createdAt;
      const allCatIds = [catIdStr, ...allCurrentDescendants];
      const newTestExists = await Test.exists({
        categoryId: { $in: allCatIds },
        isPublished: true,
        createdAt: { $gt: purchaseDate },
        _id: { $nin: boughtTestIds },
      });
      const hasNewTests = !!newTestExists;

      const upgradable = newCategoryIds.length > 0 || hasNewTests;
      const isFreeUpgrade = upgradable && upgradeCost === 0;

      return {
        ...node,
        hasAccess: true,
        upgradable,
        upgradeCost,
        isFreeUpgrade,
        newCategoryIds,
        purchase,
        paidSoFar,
        currentPrice,
        purchaseDate,
      };
    })
  );
};

