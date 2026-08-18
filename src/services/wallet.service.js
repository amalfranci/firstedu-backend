import { ApiError } from "../utils/ApiError.js";
import walletRepository from "../repository/wallet.repository.js";
import { createRazorpayOrder } from "../utils/razorpayUtils.js";
import razorpayOrderIntentRepository from "../repository/razorpayOrderIntent.repository.js";
import { verifyPaymentSignature } from "../utils/razorpayUtils.js";

/**
 * Get or create wallet for a user
 */
export const getOrCreateWallet = async (userId, userType = "User") => {
  let wallet = await walletRepository.findWallet(userId, userType);

  if (!wallet) {
    wallet = await walletRepository.createWallet({
      user: userId,
      userType,
      monetaryBalance: 0,
      rewardPoints: 0,
    });
  }

  return wallet;
};

/**
 * Get wallet balance
 */
export const getWalletBalance = async (userId, userType = "User") => {
  const wallet = await getOrCreateWallet(userId, userType);
  return {
    monetaryBalance: wallet.monetaryBalance,
    rewardPoints: wallet.rewardPoints,
  };
};

/**
 * Add monetary balance (for recharge)
 */
export const addMonetaryBalance = async (userId, amount, paymentId, userType = "User") => {
  if (amount <= 0) {
    throw new ApiError(400, "Amount must be greater than 0");
  }

  const wallet = await getOrCreateWallet(userId, userType);
  const newBalance = wallet.monetaryBalance + amount;
  return await walletRepository.updateWallet(wallet._id, {
    monetaryBalance: newBalance,
  });
};

/**
 * Initiate wallet recharge – create Razorpay order for wallet topup
 */
export const initiateWalletRecharge = async (userId, amount) => {
  if (amount < 1) {
    throw new ApiError(400, "Amount must be at least ₹1");
  }

  const receipt = `WALLET_${userId}_${Date.now()}`;
  const { orderId, amount: amountPaise } = await createRazorpayOrder(amount, receipt);

  await razorpayOrderIntentRepository.create({
    orderId,
    studentId: userId,
    type: "wallet",
    entityId: userId,
    entityModel: "User",
    amountPaise,
    currency: "INR",
    receipt,
  });

  const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
  if (!razorpayKeyId) {
    throw new ApiError(500, "Payment gateway not configured");
  }

  return {
    orderId,
    amount: amountPaise,
    currency: "INR",
    key: razorpayKeyId,
  };
};

/**
 * Complete wallet recharge – verify Razorpay payment and add balance
 */
export const completeWalletRecharge = async (userId, razorpayOrderId, razorpayPaymentId, razorpaySignature) => {
  const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValid) {
    throw new ApiError(400, "Invalid payment signature");
  }

  const intent = await razorpayOrderIntentRepository.findByOrderIdAny(razorpayOrderId);
  if (!intent) {
    throw new ApiError(404, "Recharge session not found or expired");
  }

  if (intent.studentId.toString() !== userId.toString()) {
    throw new ApiError(403, "Unauthorized");
  }

  if (intent.type !== "wallet") {
    throw new ApiError(400, "Invalid recharge session");
  }

  const amountRupees = Math.round(intent.amountPaise / 100);

  if (!intent.reconciled) {
    await addMonetaryBalance(userId, amountRupees, razorpayPaymentId, "User");
    await razorpayOrderIntentRepository.markReconciled(razorpayOrderId, razorpayPaymentId);
  }

  const wallet = await getOrCreateWallet(userId, "User");
  return wallet;
};

/**
 * Deduct monetary balance
 */
export const deductMonetaryBalance = async (userId, amount, userType = "User") => {
  const wallet = await getOrCreateWallet(userId, userType);

  if (wallet.monetaryBalance < amount) {
    throw new ApiError(400, "Insufficient balance");
  }

  const newBalance = wallet.monetaryBalance - amount;
  return await walletRepository.updateWallet(wallet._id, {
    monetaryBalance: newBalance,
  });
};

/**
 * Add reward points
 */
export const addRewardPoints = async (
  studentId,
  amount,
  source,
  description,
  referenceId = null,
  referenceType = null
) => {
  if (amount <= 0) {
    throw new ApiError(400, "Points amount must be greater than 0");
  }

  const wallet = await getOrCreateWallet(studentId, "User");
  const newPoints = wallet.rewardPoints + amount;
  const updatedWallet = await walletRepository.updateWallet(wallet._id, {
    rewardPoints: newPoints,
  });

  // Create transaction record
  await walletRepository.createPointsTransaction({
    student: studentId,
    type: "earned",
    amount,
    source,
    description,
    referenceId,
    referenceType,
    balanceAfter: updatedWallet.rewardPoints,
  });

  return updatedWallet;
};

/**
 * Deduct reward points
 */
export const deductRewardPoints = async (
  studentId,
  amount,
  source,
  description,
  referenceId = null,
  referenceType = null
) => {
  const wallet = await getOrCreateWallet(studentId, "User");

  if (wallet.rewardPoints < amount) {
    throw new ApiError(400, "Insufficient reward points");
  }

  const newPoints = wallet.rewardPoints - amount;
  const updatedWallet = await walletRepository.updateWallet(wallet._id, {
    rewardPoints: newPoints,
  });

  // Create transaction record
  await walletRepository.createPointsTransaction({
    student: studentId,
    type: "spent",
    amount,
    source,
    description,
    referenceId,
    referenceType,
    balanceAfter: updatedWallet.rewardPoints,
  });

  return updatedWallet;
};

/**
 * Get points transaction history
 */
export const getPointsHistory = async (studentId, page = 1, limit = 10) => {
  return await walletRepository.findPointsTransactions(studentId, { page, limit });
};

export default {
  getOrCreateWallet,
  getWalletBalance,
  addMonetaryBalance,
  deductMonetaryBalance,
  addRewardPoints,
  deductRewardPoints,
  getPointsHistory,
  initiateWalletRecharge,
  completeWalletRecharge,
};

