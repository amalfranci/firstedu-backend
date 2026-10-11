import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import categoryValidator from "../validation/category.validator.js";
import offerRepository from "../repository/offer.repository.js";
import couponRepository from "../repository/coupon.repository.js";
import categoryRepository from "../repository/category.repository.js";
import categoryService from "../services/category.service.js";
import { uploadImageToCloudinary } from "../utils/s3Upload.js";
import Coupon from "../models/Coupon.js";
import Offer from "../models/Offer.js";
import { resolveAccessStatus, resolveBulkAccessStatus } from "../utils/categoryAccessUtils.js";

// ── Fields that were removed from the schema but may persist in old DB documents ──
const DEPRECATED_FIELDS = ['about', 'markingScheme', 'rankingCriteria', 'examDatesAndDetails', 'awards', 'rules'];

/**
 * Strip deprecated fields from a category object and its children recursively (mutates in place).
 */
function stripDeprecatedFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // Strip from current level
  DEPRECATED_FIELDS.forEach(f => delete obj[f]);

  // Recursively strip from children if they exist
  if (obj.children && Array.isArray(obj.children)) {
    obj.children.forEach(stripDeprecatedFields);
  }

  return obj;
}

function hasGamificationStageConfig(obj) {
  return (
    Number(obj?.totalLevels || 0) > 0 ||
    (Array.isArray(obj?.levels) && obj.levels.length > 0)
  );
}

function stripEmptyGamificationStageFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (obj.children && Array.isArray(obj.children)) {
    obj.children.forEach(stripEmptyGamificationStageFields);
  }

  if (obj.kind === 'GamificationNode' && !hasGamificationStageConfig(obj)) {
    delete obj.maxLevels;
    delete obj.totalLevels;
    delete obj.levels;
    delete obj.gamificationRules;
  }

  return obj;
}

export const createCategory = asyncHandler(async (req, res) => {
  const { error, value } = categoryValidator.createCategory.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }
  const created = await categoryService.createCategory(value, req.user._id);
  return res
    .status(201)
    .json(ApiResponse.success(created, "Category created successfully"));
});

export const getCategories = asyncHandler(async (req, res) => {
  const { page, limit, search, parent, isActive, sortBy, sortOrder } =
    req.query;
  const result = await categoryService.getCategories({
    page,
    limit,
    search,
    parent,
    isActive,
    sortBy,
    sortOrder,
  });
  return res.status(200).json(
    ApiResponse.success(
      result.items,
      "Categories fetched successfully",
      result.pagination
    )
  );
});

export const getCategoryTree = asyncHandler(async (req, res) => {
  const { rootType } = req.query;
  const filter = rootType ? { rootType } : {};
  const tree = await categoryService.getCategoryTree(filter);
  return res
    .status(200)
    .json(ApiResponse.success(tree, "Category tree fetched successfully"));
});

export const getGamificationCategoryByType = asyncHandler(async (req, res) => {
  const { type } = req.params; // 'challenge_yourself' or 'challenge_your_friend'
  const tree = await categoryService.getCategoryTree({ rootType: 'Gamification' });
  const gamificationRoot = tree.find(node => node.rootType === 'Gamification');

  if (!gamificationRoot || !gamificationRoot.children) {
    return res.status(200).json(ApiResponse.success(null, "No gamification data found"));
  }

  const gamTypeMap = {
    'challenge_yourself': 'Challenge Yourself',
    'challenge_your_friend': 'Challenge Your Friend'
  };
  const targetName = gamTypeMap[type];

  const specificPillar = gamificationRoot.children.find(
    child => child.name === targetName || child.gamificationType === type
  );

  const cleaned = specificPillar
    ? stripEmptyGamificationStageFields({ ...specificPillar })
    : null;

  return res.status(200).json(ApiResponse.success(cleaned, "Gamification category fetched successfully"));
});

/**
 * Normalizes a category slug or name for URL/path resolution.
 * Decodes URL encodings (e.g. %28, %29), strips accents, and replaces
 * any sequence of non-alphanumeric characters with a single hyphen.
 */
export const normalizeCategorySlug = (str) => {
  if (!str || typeof str !== "string") return "";
  let clean = str;
  try {
    clean = decodeURIComponent(clean);
  } catch (_) {}
  return clean
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
};

export const resolveCategoryPathForStudent = asyncHandler(async (req, res) => {
  const { path, rootType } = req.query; // e.g. path = 'engineering/jee', rootType = 'Competitive'

  if (!rootType) {
    throw new ApiError(400, "rootType is required for path resolution");
  }

  // Get full tree from pricing-enriched service
  const tree = await categoryService.getCategoriesForStudent({ rootType, format: "tree" });
  const root = tree[0];

  if (!path) {
    // If no path, return root level children
    const immediateChildren = root && root.children ? root.children.map(c => {
      const obj = c.toObject ? c.toObject() : { ...c };
      const childNodes = obj.children || [];
      const isSecondSubcategory = childNodes.length > 0 && childNodes.every(child => !child.children || child.children.length === 0);

      const { children, ...rest } = obj;
      rest.childCount = childNodes.length;
      rest.isLeaf = rest.childCount === 0;
      rest.isSecondSubcategory = isSecondSubcategory;
      rest.slug = normalizeCategorySlug(rest.name);
      return stripDeprecatedFields(rest);
    }) : [];

    const studentId = req.user?._id;
    let enrichedChildren = immediateChildren;

    if (studentId) {
      // Bulk: 2 fixed DB queries instead of N×5
      enrichedChildren = await resolveBulkAccessStatus(studentId, immediateChildren, tree);
    }

    return res.json(ApiResponse.success({
      node: null,
      children: enrichedChildren,
      breadcrumb: []
    }, "Root level fetched"));
  }

  let cleanPath = String(path || "");
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch (_) {}
  cleanPath = cleanPath.replace(/%2f/gi, "/");
  const slugs = cleanPath.split("/").filter(Boolean);
  let currentLayer = root ? root.children : [];
  let currentNode = null;
  const breadcrumb = [];

  for (const slug of slugs) {
    const normalizedInputSlug = normalizeCategorySlug(slug);
    const rawLowerSlug = slug.toLowerCase().trim();

    const found = currentLayer.find((n) => {
      if (!n) return false;
      const nId = n._id ? n._id.toString() : "";
      if (nId && (nId === slug || nId === rawLowerSlug)) return true;

      const normalizedNodeSlug = normalizeCategorySlug(n.name || "");
      if (normalizedInputSlug && normalizedNodeSlug === normalizedInputSlug) return true;

      // Fallback: match raw lowercase or if client passed space-to-dash name
      const nodeLowerName = (n.name || "").toLowerCase().trim();
      if (rawLowerSlug && (nodeLowerName === rawLowerSlug || nodeLowerName.replace(/\s+/g, '-') === rawLowerSlug)) return true;

      return false;
    });

    if (!found) {
      return res.status(404).json(ApiResponse.error({}, "Path not found"));
    }

    currentNode = found;
    currentLayer = found.children || [];
    const canonicalSlug = normalizeCategorySlug(found.name) || slug;
    breadcrumb.push({ _id: found._id, name: found.name, slug: canonicalSlug });
  }

  // Optimize payload: Strip deep children off to ensure network responsiveness
  const immediateChildren = currentLayer.map(child => {
    const obj = child.toObject ? child.toObject() : { ...child };
    const childNodes = obj.children || [];
    const isSecondSubcategory = childNodes.length > 0 && childNodes.every(c => !c.children || c.children.length === 0);

    const { children, ...rest } = obj; // rip out nested children safely
    rest.childCount = childNodes.length;
    rest.isLeaf = rest.childCount === 0;
    rest.isSecondSubcategory = isSecondSubcategory;
    rest.slug = normalizeCategorySlug(rest.name);
    return stripDeprecatedFields(rest);
  });

  const studentId = req.user?._id;
  let enrichedChildren = immediateChildren;
  let enrichedNode = currentNode ? currentNode.toObject ? currentNode.toObject() : { ...currentNode } : null;

  if (studentId) {
    // Bulk: 2 fixed DB queries instead of N×5
    enrichedChildren = await resolveBulkAccessStatus(studentId, immediateChildren, tree);


    if (enrichedNode) {
      const status = await resolveAccessStatus(studentId, enrichedNode._id);
      enrichedNode = { ...enrichedNode, ...status };
    }
  }

  if (enrichedNode) {
    delete enrichedNode.children;
    enrichedNode.slug = normalizeCategorySlug(enrichedNode.name);
    stripDeprecatedFields(enrichedNode);
  }

  return res.json(ApiResponse.success({
    node: enrichedNode,
    children: enrichedChildren,
    breadcrumb
  }, "Path resolved successfully"));
});

/**
 * Student-facing: Get all categories (tree or flat) with optional filter.
 * Query: linkedTo=all|questionBank|test|testBundle|both|olympiad|tournament, format=tree|flat
 * - all: union of test + testBundle + olympiad + tournament
 * - questionBank: categories on any question bank
 * - test: only categories used by published tests
 * - testBundle: only categories used by tests inside active test bundles
 * - both: union of test + testBundle
 * - olympiad: categories used by published olympiads (via their test's question bank)
 * - tournament: categories used by published tournaments (via stage tests' question banks)
 */
export const getCategoriesForStudent = asyncHandler(async (req, res) => {
  const { linkedTo, format = "tree", rootType, isCertification, excludeGamification } = req.query;
  const studentId = req.user?._id;

  const validLinkedTo = ["all", "questionBank", "test", "testBundle", "both", "olympiad", "tournament", "examhall", "course", "challenge"].includes(linkedTo)
    ? linkedTo
    : null;
  const validFormat = ["tree", "flat"].includes(format) ? format : "tree";

  let result = await categoryService.getCategoriesForStudent({
    linkedTo: validLinkedTo,
    format: validFormat,
    rootType,
    studentId,
    isCertification: isCertification === 'true' || isCertification === true,
  });

  if (excludeGamification === 'true' && Array.isArray(result)) {
    const isGamification = n => /challenge\s*yourself/i.test(n?.name ?? n?.label ?? '');
    
    if (validFormat === "tree") {
      const filterTree = nodes =>
        nodes
          .filter(n => !isGamification(n))
          .map(n => {
            const obj = { ...n };
            if (obj.children) obj.children = filterTree(obj.children);
            return obj;
          });
      result = filterTree(result);
    } else {
      result = result.filter(n => !isGamification(n));
    }
  }

  // Strip deprecated legacy fields from the entire tree/flat list
  if (Array.isArray(result)) {
    result.forEach(node => stripDeprecatedFields(node));
  } else if (result && typeof result === 'object') {
    stripDeprecatedFields(result);
  }

  return res.status(200).json(
    ApiResponse.success(
      result,
      validLinkedTo && validLinkedTo !== "all"
        ? `Categories filtered by ${validLinkedTo} fetched successfully`
        : "Categories fetched successfully"
    )
  );
});

export const getCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await categoryService.getCategoryById(id);
  return res
    .status(200)
    .json(ApiResponse.success(item, "Category fetched successfully"));
});

export const getCategoryDetailForStudent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await categoryService.getCategoryById(id);

  // Enrich with computed pricing so frontend needs zero math ────────────────
  let result = item?.toObject ? item.toObject() : { ...item };

  if (result.price != null && result.rootType) {
    const PILLAR_MAP = {
      "School": "School",
      "Competitive": "Competitive",
      "Skill Development": "Skill Development",
    };
    const applicableOn = PILLAR_MAP[result.rootType];
    const basePrice = Number(result.price) || 0;

    if (applicableOn) {
      let activeOffer = null;
      if (result.offerPolicy !== "none") {
        const globalOffer = await offerRepository.getActiveOffer(applicableOn);
        let customOffer = null;
        if (result.offerOverrideId) {
          customOffer = await Offer.findOne({ _id: result.offerOverrideId, status: "active" }).lean();
        }
        activeOffer = customOffer || globalOffer;
      }

      if (result.isFree || basePrice === 0) {
        result.originalPrice = basePrice;
        result.effectivePrice = 0;
        result.discountedPrice = 0;
      } else if (result.discountedPrice !== null && result.discountedPrice !== undefined) {
        // Admin set a specific node-level discount. It overrides global offer completely.
        result.originalPrice = basePrice;
        result.effectivePrice = result.discountedPrice;
      } else if (activeOffer) {
        let discountAmount = 0;
        if (activeOffer.discountType === "percentage") {
          discountAmount = (basePrice * activeOffer.discountValue) / 100;
        } else {
          discountAmount = Math.min(activeOffer.discountValue, basePrice);
        }
        const discountedPrice = Math.max(0, basePrice - discountAmount);
        result.originalPrice = basePrice;
        result.discountedPrice = discountedPrice;
        result.effectivePrice = discountedPrice;
        result.discountAmount = discountAmount;
        result.appliedOffer = {
          _id: activeOffer._id,
          offerName: activeOffer.offerName,
          applicableOn: activeOffer.applicableOn,
          discountType: activeOffer.discountType,
          discountValue: activeOffer.discountValue,
          description: activeOffer.description,
          validTill: activeOffer.validTill,
        };
      } else {
        result.originalPrice = basePrice;
        result.effectivePrice = basePrice;
        result.discountedPrice = basePrice;
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Upgrade signal: detect new child subcategories added after purchase ──
  // Only computed if the student is logged in (req.user is always present on student routes)
  const upgradeStatus = await resolveAccessStatus(req.user._id, id);
  result.hasAccess = upgradeStatus.hasAccess;
  result.upgradable = upgradeStatus.upgradable;
  result.upgradeCost = upgradeStatus.upgradeCost;
  result.isFreeUpgrade = upgradeStatus.isFreeUpgrade;
  result.newChildrenCount = upgradeStatus.newCategoryIds.length;
  // ────────────────────────────────────────────────────────────────────────

  // Strip deprecated fields that may persist in old DB documents
  stripDeprecatedFields(result);

  return res
    .status(200)
    .json(ApiResponse.success(result, "Category details fetched successfully"));
});

export const getCategoryChildren = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parentId = id === "root" || id === "null" || !id ? null : id;
  const children = await categoryService.getChildren(parentId);
  return res.status(200).json(
    ApiResponse.success(children, "Child categories fetched successfully")
  );
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await categoryService.getCategoryById(id);
  if (existing.isPredefined) {
    throw new ApiError(403, "Cannot modify name of predefined category. Use pricing endpoint for prices.");
  }
  const { error, value } = categoryValidator.updateCategory.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }
  const updated = await categoryService.updateCategory(id, value);
  return res
    .status(200)
    .json(ApiResponse.success(updated, "Category updated successfully"));
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await categoryService.getCategoryById(id);
  if (existing.isPredefined) {
    throw new ApiError(403, "Cannot delete predefined categories.");
  }
  await categoryService.deleteCategory(id);
  return res
    .status(200)
    .json(ApiResponse.success(null, "Category deleted successfully"));
});

export const updateCategoryPricing = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await categoryService.getCategoryById(id);
  if (existing.isPredefined) {
    throw new ApiError(403, "Cannot modify pricing or discounts for predefined categories.");
  }

  if (existing.rootType === 'Olympiads') {
    throw new ApiError(403, "Pricing and purchases are not supported for Olympiad subcategories.");
  }

  // Handle file upload if present
  if (req.file) {
    const imageUrl = await uploadImageToCloudinary(
      req.file.buffer,
      req.file.originalname,
      "categories/banners",
      req.file.mimetype
    );
    req.body.bannerImg = imageUrl;
  }

  // Parse types from multipart/form-data
  if (req.body.isFree === "true") req.body.isFree = true;
  if (req.body.isFree === "false") req.body.isFree = false;
  if (req.body.price) req.body.price = Number(req.body.price);
  if (req.body.capacity) req.body.capacity = Number(req.body.capacity);
  if (req.body.discountedPrice) req.body.discountedPrice = Number(req.body.discountedPrice);
  if (req.body.subjects) {
    if (typeof req.body.subjects === 'string') {
      try { req.body.subjects = JSON.parse(req.body.subjects); } catch (e) { req.body.subjects = [req.body.subjects]; }
    }
  }
  if (req.body.tags) {
    if (typeof req.body.tags === 'string') {
      try { req.body.tags = JSON.parse(req.body.tags); } catch (e) { req.body.tags = [req.body.tags]; }
    }
  }


  const { error, value } = categoryValidator.updateCategoryPricing.validate(req.body);
  if (error) {
    throw new ApiError(
      400,
      "Validation Error",
      error.details.map((x) => x.message)
    );
  }
  const updated = await categoryService.updateCategoryPricing(id, value);
  return res
    .status(200)
    .json(ApiResponse.success(updated, "Category pricing updated successfully"));
});

// Category Specific Offers
export const createCategoryOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { offerName, discountType, discountValue, validTill, description } = req.body;

  const category = await categoryService.getCategoryById(id);
  if (!category) throw new ApiError(404, "Category not found");
  if (category.rootType === 'Olympiads') {
    throw new ApiError(403, "Offers are not supported for Olympiad subcategories.");
  }

  const offerData = {
    offerName,
    applicableOn: category.rootType || "CompetitionCategory", // dummy, validation requirement
    entityId: category._id,
    entityModel: "Category",
    discountType,
    discountValue,
    validTill: validTill || null,
    status: "active",
    description
  };

  const offer = await offerRepository.createOffer(offerData);
  // 'custom' policy means this category has its own override; global pillar offer is blocked
  await categoryRepository.updateById(id, { offerOverrideId: offer._id, offerPolicy: "custom" });

  return res.status(201).json(ApiResponse.success(offer, "Subcategory offer created"));
});

export const removeCategoryOffer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const category = await categoryService.getCategoryById(id);
  if (!category) throw new ApiError(404, "Category not found");
  if (category.rootType === 'Olympiads') {
    throw new ApiError(403, "Offers are not supported for Olympiad subcategories.");
  }

  if (category.offerOverrideId) {
    await offerRepository.deleteOffer(category.offerOverrideId);
    // Reset back to inherit so global pillar offer applies again
    await categoryRepository.updateById(id, { offerOverrideId: null, offerPolicy: "inherit" });
  }

  return res.status(200).json(ApiResponse.success(null, "Offer removed successfully"));
});

// Category Specific Coupons
export const createCategoryCoupon = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { code, description, discountType, discountValue, validFrom, validUntil, usageLimit, isActive } = req.body;

  const category = await categoryService.getCategoryById(id);
  if (!category) throw new ApiError(404, "Category not found");
  if (category.rootType === 'Olympiads') {
    throw new ApiError(403, "Coupons are not supported for Olympiad subcategories.");
  }

  const couponData = {
    code, description, discountType, discountValue, validFrom, validUntil, usageLimit, isActive,
    applicableTo: "all",
    applicableCategoryId: id
  };

  const coupon = await couponRepository.createCoupon(couponData);

  return res.status(201).json(ApiResponse.success(coupon, "Subcategory coupon created"));
});

export const getCategoryCoupons = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupons = await Coupon.find({ applicableCategoryId: id }).sort({ createdAt: -1 });
  return res.status(200).json(ApiResponse.success(coupons, "Coupons fetched"));
});

export const deleteCategoryCoupon = asyncHandler(async (req, res) => {
  const { couponId } = req.params;
  await couponRepository.deleteCoupon(couponId);
  return res.status(200).json(ApiResponse.success(null, "Coupon removed"));
});
