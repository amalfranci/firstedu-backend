import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import teacherRepository from "../repository/teacher.repository.js";
import teacherWithdrawalRepository from "../repository/teacherWithdrawal.repository.js";
import * as walletService from "./wallet.service.js";
import * as notificationService from "./notification.service.js";
import * as teacherWalletLedger from "./teacherWalletLedger.service.js";

export const MIN_WITHDRAWAL_AMOUNT = 100;
const TEACHER_WALLET_TYPE = "Teacher";

/**
 * Resolves a pending withdrawal by request document id or by teacher id (admin UIs often pass teacher._id).
 */
async function resolvePendingWithdrawalDocument(rawId) {
  if (!mongoose.isValidObjectId(rawId)) {
    throw new ApiError(400, "Invalid withdrawal request id");
  }
  const byRequestId = await teacherWithdrawalRepository.findById(rawId);
  if (byRequestId) return byRequestId;
  return await teacherWithdrawalRepository.findByTeacherId(rawId);
}

export function isBankDetailsComplete(bankDetails) {
  if (!bankDetails) return false;
  const ok = (v) => v != null && String(v).trim().length > 0;
  return (
    ok(bankDetails.accountHolderName) &&
    ok(bankDetails.accountNumber) &&
    ok(bankDetails.bankName) &&
    ok(bankDetails.ifscCode)
  );
}

function maskAccountNumber(accountNumber) {
  const s = String(accountNumber || "").trim();
  if (s.length <= 4) return "****";
  return `****${s.slice(-4)}`;
}

function maskBankDetailsForTeacher(bankDetails) {
  if (!bankDetails) return null;
  return {
    accountHolderName: bankDetails.accountHolderName || null,
    bankName: bankDetails.bankName || null,
    accountNumber: bankDetails.accountNumber || null,
    accountNumberMasked: maskAccountNumber(bankDetails.accountNumber),
    ifscCode: bankDetails.ifscCode || null,
  };
}

export async function getTeacherWalletOverview(teacherId) {
  const wallet = await walletService.getWalletBalance(teacherId, TEACHER_WALLET_TYPE);
  const pending = await teacherWithdrawalRepository.findByTeacherId(teacherId);
  return {
    monetaryBalance: wallet.monetaryBalance,
    rewardPoints: wallet.rewardPoints,
    pendingWithdrawal: pending
      ? { id: pending._id, amount: pending.amount, requestedAt: pending.createdAt }
      : null,
  };
}

export async function updateTeacherBankDetails(teacherId, payload) {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  const bankDetails = {
    accountHolderName: payload.accountHolderName.trim(),
    accountNumber:
      String(payload.accountNumber || '').includes('*') &&
      teacher.bankDetails?.accountNumber
        ? teacher.bankDetails.accountNumber
        : String(payload.accountNumber || '').trim(),
    bankName: payload.bankName.trim(),
    ifscCode: String(payload.ifscCode).trim().toUpperCase(),
  };
  if (!isBankDetailsComplete(bankDetails)) {
    throw new ApiError(400, "All bank fields are required");
  }
  return await teacherRepository.updateById(teacherId, { bankDetails });
}

export async function getTeacherBankDetailsMasked(teacherId) {
  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  const complete = isBankDetailsComplete(teacher.bankDetails);
  return {
    isComplete: complete,
    bankDetails: complete ? maskBankDetailsForTeacher(teacher.bankDetails) : null,
  };
}

export async function createWithdrawalRequest(teacherId, amount) {
  if (amount < MIN_WITHDRAWAL_AMOUNT) {
    throw new ApiError(
      400,
      `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL_AMOUNT}`
    );
  }

  const teacher = await teacherRepository.findById(teacherId);
  if (!teacher) {
    throw new ApiError(404, "Teacher not found");
  }
  if (teacher.status !== "approved") {
    throw new ApiError(400, "Only approved teachers can withdraw");
  }
  if (!isBankDetailsComplete(teacher.bankDetails)) {
    throw new ApiError(
      400,
      "Add your bank account details before requesting a withdrawal"
    );
  }

  const existing = await teacherWithdrawalRepository.findByTeacherId(teacherId);
  if (existing) {
    throw new ApiError(400, "You already have a pending withdrawal request");
  }

  const wallet = await walletService.getWalletBalance(teacherId, TEACHER_WALLET_TYPE);
  if (wallet.monetaryBalance < amount) {
    throw new ApiError(400, "Insufficient wallet balance");
  }

  await walletService.deductMonetaryBalance(teacherId, amount, TEACHER_WALLET_TYPE);

  try {
    const request = await teacherWithdrawalRepository.create({
      teacher: teacherId,
      amount,
    });
    return request;
  } catch (err) {
    await walletService.addMonetaryBalance(
      teacherId,
      amount,
      "withdrawal_rollback",
      TEACHER_WALLET_TYPE
    );
    throw err;
  }
}

export async function listPendingWithdrawalsForAdmin(options) {
  return await teacherWithdrawalRepository.findAllPending(options);
}

export async function getWithdrawalRequestForAdmin(requestId) {
  const request = await resolvePendingWithdrawalDocument(requestId);
  if (!request) {
    throw new ApiError(404, "Withdrawal request not found");
  }
  const populated = await teacherWithdrawalRepository.findByIdPopulated(request._id);
  if (!populated) {
    throw new ApiError(404, "Withdrawal request not found");
  }
  return populated;
}

export async function approveWithdrawalRequest(adminId, requestId) {
  const request = await resolvePendingWithdrawalDocument(requestId);
  if (!request) {
    throw new ApiError(404, "Withdrawal request not found");
  }

  const docId = request._id;
  const teacherId = request.teacher;
  const amount = request.amount;

  const deleted = await teacherWithdrawalRepository.deleteById(docId);
  if (!deleted) {
    throw new ApiError(404, "Withdrawal request not found");
  }

  const balAfter = await walletService.getWalletBalance(teacherId, TEACHER_WALLET_TYPE);
  await teacherWalletLedger
    .recordWithdrawalPayout({
      teacherId,
      amount,
      balanceAfter: balAfter.monetaryBalance,
      withdrawalRequestId: docId,
    })
    .catch((e) => console.error("teacherWalletLedger recordWithdrawalPayout:", e));

  await notificationService.sendNotificationToTeacher(
    teacherId,
    "Withdrawal approved",
    `Your withdrawal of ₹${amount} has been processed. The amount has been sent to your bank account.`,
    {
      type: "teacher_withdrawal_approved",
      withdrawalRequestId: String(docId),
      amount: String(amount),
    },
    adminId
  );

  return { approved: true, amount, teacherId };
}

export async function rejectWithdrawalRequest(adminId, requestId) {
  const request = await resolvePendingWithdrawalDocument(requestId);
  if (!request) {
    throw new ApiError(404, "Withdrawal request not found");
  }

  const docId = request._id;
  const teacherId = request.teacher;
  const amount = request.amount;

  await walletService.addMonetaryBalance(
    teacherId,
    amount,
    "withdrawal_rejected",
    TEACHER_WALLET_TYPE
  );

  try {
    const deleted = await teacherWithdrawalRepository.deleteById(docId);
    if (!deleted) {
      await walletService.deductMonetaryBalance(teacherId, amount, TEACHER_WALLET_TYPE);
      throw new ApiError(500, "Could not finalize rejection; please retry");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    await walletService.deductMonetaryBalance(teacherId, amount, TEACHER_WALLET_TYPE).catch(() => {});
    throw err;
  }

  const balAfterRefund = await walletService.getWalletBalance(teacherId, TEACHER_WALLET_TYPE);
  await teacherWalletLedger
    .recordWithdrawalRefund({
      teacherId,
      amount,
      balanceAfter: balAfterRefund.monetaryBalance,
      withdrawalRequestId: docId,
    })
    .catch((e) => console.error("teacherWalletLedger recordWithdrawalRefund:", e));

  await notificationService.sendNotificationToTeacher(
    teacherId,
    "Withdrawal request declined",
    `Your withdrawal request of ₹${amount} was declined. The amount has been returned to your wallet.`,
    {
      type: "teacher_withdrawal_rejected",
      withdrawalRequestId: String(docId),
      amount: String(amount),
    },
    adminId
  );

  return { rejected: true, amount, teacherId };
}
