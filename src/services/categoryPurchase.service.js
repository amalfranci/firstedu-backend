import { ApiError } from "../utils/ApiError.js";
import Category from "../models/Category.js";
import categoryPurchaseRepository from "../repository/categoryPurchase.repository.js";
import categoryRepository from "../repository/category.repository.js";
import razorpayOrderIntentRepository from "../repository/razorpayOrderIntent.repository.js";
import couponService from "./coupon.service.js";
import walletService from "./wallet.service.js";
import pointsService from "./points.service.js";
import { createRazorpayOrder, verifyPaymentSignature } from "../utils/razorpayUtils.js";
import { getAmountToCharge } from "../utils/offerUtils.js";
import Offer from "../models/Offer.js";
import offerRepository from "../repository/offer.repository.js";
import { getCategoryRevenueSourceType, logTransaction } from "./adminRevenue.service.js";
import Test from "../models/Test.js";

const fetchDescendantIds = async (categoryId) => {
  const children = await categoryRepository.findChildren(categoryId);
  let ids = [];
  for (const child of children) {
    ids.push(child._id);
    const subIds = await fetchDescendantIds(child._id);
    ids = ids.concat(subIds);
  }
  return ids;
};

const awardPointsForUnlockedItems = async (studentId, categoryId, unlockedIds) => {
  try {
    const allCategoryIds = [categoryId, ...unlockedIds];
    const categories = await Category.find({ _id: { $in: allCategoryIds } }).select("name");
    const tests = await Test.find({ categoryId: { $in: allCategoryIds }, isPublished: true }).select("title");
    
    // Award points for all categories concurrently
    await Promise.all(
      categories.map(cat => pointsService.awardCategoryPurchasePoints(studentId, cat._id, cat.name))
    );
    
    // Award points for all tests (50 points per test as requested) concurrently
    await Promise.all(
      tests.map(t => pointsService.awardTestPurchasePoints(studentId, t._id, t.title, 50))
    );
  } catch (e) {
    console.error("Points Error:", e);
  }
};

export const initiatePurchase = async (categoryId, studentId, paymentMethod, options = {}) => {
  const { couponCode } = options;
  
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");
  if (category.status !== "Public") throw new ApiError(400, "Category is not available for purchase");
  if (category.isPredefined) throw new ApiError(400, "You cannot purchase the top-level pillar category directly.");

  const existingAccess = await categoryPurchaseRepository.checkAccess(studentId, categoryId);
  if (existingAccess) throw new ApiError(400, "You already have access to this category");

  const price = category.discountedPrice !== null && category.discountedPrice !== undefined ? category.discountedPrice : category.price;
  
  const rootTypeMap = {
    "School": "School", "Competitive": "Competitive", "Skill Development": "Skill Development", "Olympiads": "Olympiads"
  };
  const moduleName = rootTypeMap[category.rootType] || "Category";
  
  let amountToCharge = price;
  let appliedOffer = null;
  let appliedCoupon = null;
  let couponId = null;

  if (category.discountedPrice === null || category.discountedPrice === undefined) {
    let resolvedOffer = null;
    
    if (category.offerPolicy !== "none") {
      if (category.offerOverrideId) {
        // TIER 1: Subcategory-specific offer override
        const specificOffer = await Offer.findById(category.offerOverrideId).lean();
        if (specificOffer && specificOffer.status === "active") {
          resolvedOffer = specificOffer;
        }
      }
      if (!resolvedOffer) {
        // TIER 3: Global pillar offer
        resolvedOffer = await offerRepository.getActiveOffer(moduleName);
      }
    }

    if (resolvedOffer) {
      const discountAmount = resolvedOffer.discountType === "percentage" 
        ? (price * resolvedOffer.discountValue) / 100 
        : Math.min(resolvedOffer.discountValue, price);
      amountToCharge = Math.round(Math.max(0, price - discountAmount));
      appliedOffer = {
        _id: resolvedOffer._id,
        offerName: resolvedOffer.offerName,
        applicableOn: resolvedOffer.applicableOn,
        discountType: resolvedOffer.discountType,
        discountValue: resolvedOffer.discountValue,
        description: resolvedOffer.description,
        validTill: resolvedOffer.validTill,
      };
    }
  }

  // Apply Coupon (if not blocked)
  if (couponCode && String(couponCode).trim() && category.couponPolicy !== "none") {
    const result = await couponService.validateCoupon(couponCode.trim(), amountToCharge, moduleName, categoryId);
    amountToCharge = Math.round(Math.max(0, amountToCharge - result.discount));
    appliedCoupon = { _id: result.coupon._id, code: result.coupon.code, discountType: result.coupon.discountType, discountValue: result.coupon.discountValue };
    couponId = result.coupon._id;
  }

  if (category.isFree || paymentMethod === "free") {
    if (amountToCharge > 0 && !category.isFree) {
      throw new ApiError(400, "This category is paid. Use paymentMethod: wallet or razorpay.");
    }
    const unlockedIds = await fetchDescendantIds(categoryId);
    const purchase = await categoryPurchaseRepository.createPurchase({
      student: studentId,
      categoryId,
      pillarType: category.rootType,
      unlockedCategoryIds: unlockedIds,
      purchasePrice: 0,
      paymentMethod: "free",
      paymentId: "free",
      paymentStatus: "completed"
    });
    
    await Category.updateMany({ _id: { $in: [categoryId, ...unlockedIds] } }, { $inc: { purchaseCount: 1 } });
    await logTransaction({
      studentId,
      amount: 0,
      sourceType: getCategoryRevenueSourceType(category.rootType),
      itemId: category._id,
      itemName: category.name,
      categoryId: category._id,
      paymentId: "free",
    });
    await awardPointsForUnlockedItems(studentId, category._id, unlockedIds);
    
    return { purchase, completed: true };
  }

  if (paymentMethod === "wallet") {
    if (amountToCharge < 1) throw new ApiError(400, "This category is free. Use paymentMethod: free.");
    
    await walletService.deductMonetaryBalance(studentId, amountToCharge, "User");
    const unlockedIds = await fetchDescendantIds(categoryId);
    const purchase = await categoryPurchaseRepository.createPurchase({
      student: studentId,
      categoryId,
      pillarType: category.rootType,
      unlockedCategoryIds: unlockedIds,
      purchasePrice: amountToCharge,
      paymentMethod: "wallet",
      paymentId: "wallet",
      paymentStatus: "completed"
    });
    
    if (couponId) await couponService.incrementCouponUsedCount(couponId);
    await Category.updateMany({ _id: { $in: [categoryId, ...unlockedIds] } }, { $inc: { purchaseCount: 1 } });
    await logTransaction({
      studentId,
      amount: amountToCharge,
      sourceType: getCategoryRevenueSourceType(category.rootType),
      itemId: category._id,
      itemName: category.name,
      categoryId: category._id,
      paymentId: "wallet",
    });
    await awardPointsForUnlockedItems(studentId, category._id, unlockedIds);
    
    return { purchase, completed: true };
  }

  if (paymentMethod === "razorpay") {
    if (amountToCharge < 1) throw new ApiError(400, "This category is free.");
    
    const receipt = `cat_${categoryId}_${studentId}_${Date.now()}`.substring(0, 40);
    const order = await createRazorpayOrder(amountToCharge, receipt);
    
    await razorpayOrderIntentRepository.create({
      orderId: order.orderId,
      studentId,
      type: "categoryNode",
      entityId: categoryId,
      entityModel: "Category",
      amountPaise: order.amount,
      currency: order.currency || "INR",
      receipt,
      couponId: couponId || undefined,
    });
    
    return {
      completed: false,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      categoryId,
      title: category.name,
      appliedOffer,
      appliedCoupon,
      originalPrice: Math.round(price),
      discountedPrice: Math.round(amountToCharge),
    };
  }

  throw new ApiError(400, "Invalid paymentMethod. Use: free, wallet, or razorpay.");
};

export const confirmPurchase = async (categoryId, studentId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  const category = await Category.findById(categoryId);
  if (!category || category.status !== "Public") throw new ApiError(404, "Categor not found or not public");
  if (category.isPredefined) throw new ApiError(400, "You cannot purchase the top-level pillar category directly.");

  const existingAccess = await categoryPurchaseRepository.checkAccess(studentId, categoryId);
  if (existingAccess) throw new ApiError(400, "You already have access to this category");

  const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) throw new ApiError(400, "Payment verification failed");

  const intent = await razorpayOrderIntentRepository.findByOrderId(razorpayOrderId);
  if (!intent) throw new ApiError(400, "Invalid order or payment already used");
  if (intent.studentId?.toString?.() !== studentId?.toString?.()) throw new ApiError(403, "Payment user mismatch");
  if (intent.type !== "categoryNode" || intent.entityId?.toString?.() !== categoryId?.toString?.()) throw new ApiError(400, "Payment entity mismatch");

  const purchasePrice = intent.amountPaise / 100;
  const unlockedIds = await fetchDescendantIds(categoryId);

  const purchase = await categoryPurchaseRepository.createPurchase({
    student: studentId,
    categoryId,
    pillarType: category.rootType,
    unlockedCategoryIds: unlockedIds,
    purchasePrice,
    paymentId: razorpayPaymentId,
    paymentMethod: "razorpay",
    paymentStatus: "completed"
  });

  await razorpayOrderIntentRepository.markReconciled(razorpayOrderId, razorpayPaymentId);
  if (intent.couponId) await couponService.incrementCouponUsedCount(intent.couponId);
  
  await Category.updateMany({ _id: { $in: [categoryId, ...unlockedIds] } }, { $inc: { purchaseCount: 1 } });
  await logTransaction({
    studentId,
    amount: purchasePrice,
    sourceType: getCategoryRevenueSourceType(category.rootType),
    itemId: category._id,
    itemName: category.name,
    categoryId: category._id,
    paymentId: razorpayPaymentId,
  });
  await awardPointsForUnlockedItems(studentId, category._id, unlockedIds);

  return purchase;
};

export const checkAccess = async (studentId, categoryId) => {
  return await categoryPurchaseRepository.checkAccess(studentId, categoryId);
};

export const getMyPurchases = async (studentId, pillarType = null) => {
  return await categoryPurchaseRepository.findByStudent(studentId, pillarType);
};

export const reconcileWebhookPurchase = async (categoryId, studentId, intent) => {
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(404, "Category not found");

  const existingAccess = await categoryPurchaseRepository.checkAccess(studentId, categoryId);
  if (existingAccess) {
    return {
      reconciled: true,
      reason: "already_purchased",
      categoryName: category.name,
      pillarType: category.rootType,
    };
  }

  const purchasePrice = intent.amountPaise / 100;
  const unlockedIds = await fetchDescendantIds(categoryId);

  const purchase = await categoryPurchaseRepository.createPurchase({
    student: studentId,
    categoryId,
    pillarType: category.rootType,
    unlockedCategoryIds: unlockedIds,
    purchasePrice,
    paymentId: intent.paymentId, // Will be passed as populated parameter if needed or assumed
    paymentMethod: "razorpay",
    paymentStatus: "completed"
  });

  if (intent.couponId) await couponService.incrementCouponUsedCount(intent.couponId);
  
  await Category.updateMany({ _id: { $in: [categoryId, ...unlockedIds] } }, { $inc: { purchaseCount: 1 } });
  await awardPointsForUnlockedItems(studentId, category._id, unlockedIds);

  return {
    reconciled: true,
    reason: "created",
    categoryName: category.name,
    pillarType: category.rootType,
  };
};

export default {
  initiatePurchase,
  confirmPurchase,
  checkAccess,
  getMyPurchases,
  reconcileWebhookPurchase,
};
