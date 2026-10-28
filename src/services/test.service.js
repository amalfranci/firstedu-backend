import { ApiError } from "../utils/ApiError.js";
import testRepository from "../repository/test.repository.js";
import questionBankRepository from "../repository/questionBank.repository.js";
import aiQuestionBankRepository from "../repository/aiQuestionBank.repository.js";
import orderRepository from "../repository/order.repository.js";
import TestPurchase from "../models/TestPurchase.js";
import ExamSession from "../models/ExamSession.js";
import Category from "../models/Category.js";
import {
  uploadImageToCloudinary,
  deleteFileFromCloudinary,
} from "../utils/s3Upload.js";
import {
  sendUpgradeNotificationForCategory,
  sendTestEditNotification,
} from "./notification.service.js";
import { ensureUniqueTestTitle } from "../utils/testValidationUtils.js";

const TESTS_IMAGE_FOLDER = "tests";

// ------- Tests / Test Builder -------

export const createTest = async (data, adminId, file) => {
  if (data.title) {
    await ensureUniqueTestTitle(data.title);
  }

  if (data.questionBank && data.aiQuestionBank) {
    throw new ApiError(400, "Test cannot link both manual and AI question banks");
  }
  if (data.aiQuestionBank) {
    const bank = await aiQuestionBankRepository.findById(data.aiQuestionBank);
    if (!bank) throw new ApiError(404, "AI question bank not found");

    // Strictly for AI-powered paper flow: ensure the test is associated with the final taxonomy leaf node
    const targetCatId =
      data.categoryId ||
      (Array.isArray(bank.categories) && bank.categories[0]?._id
        ? bank.categories[0]._id
        : bank.categories?.[0]);
    if (targetCatId) {
      const children = await Category.find({ parent: targetCatId })
        .select("_id name")
        .lean();
      if (children.length > 0) {
        const mockLeaf = children.find((c) => {
          const n = String(c.name || "").trim().toLowerCase();
          return (
            /\bfull\s*mock\b/i.test(n) ||
            /\bfull\s*paper\b/i.test(n) ||
            /\bmock\s*practice\b/i.test(n) ||
            /\bmodel\s*paper\b/i.test(n)
          );
        });
        if (mockLeaf) {
          data.categoryId = mockLeaf._id;
        }
      } else {
        data.categoryId = targetCatId;
      }
    }
    if (!data.applicableFor || data.applicableFor === "test") {
      data.applicableFor = "Competitive";
    }
  } else if (data.questionBank) {
    const bank = await questionBankRepository.findById(data.questionBank);
    if (!bank) throw new ApiError(404, "Question bank not found");
  } else {
    throw new ApiError(400, "Test must link a question bank");
  }

  let imageUrl = null;
  if (file?.buffer?.length) {
    try {
      imageUrl = await uploadImageToCloudinary(
        file.buffer,
        file.originalname,
        TESTS_IMAGE_FOLDER,
        file.mimetype
      );
    } catch (err) {
      const msg = err?.message || String(err);
      throw new ApiError(
        502,
        msg.includes("Access Key") || msg.includes("InvalidAccessKeyId")
          ? "Image upload failed: AWS S3 credentials are invalid. Create without an image, or update AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env."
          : `Image upload failed: ${msg}`
      );
    }
  }

  const test = await testRepository.createTest({
    ...data,
    imageUrl,
    createdBy: adminId,
  });
  await enrichTestsWithBankStats(test);

  const isNowPublished = test.isPublished === true || String(test.isPublished) === "true";

  if (test.categoryId && isNowPublished) {
    // Fire asynchronously
    sendUpgradeNotificationForCategory(test.categoryId, test.title, "test", adminId).catch(err => {
      console.error("Failed to send upgrade notification for test:", err);
    });
    // Mark as notified to prevent duplicate notifications
    await testRepository.updateTestById(test._id, { upgradeNotificationSent: true });
  }

  return test;
};

const enrichTestsWithBankStats = async (tests) => {
  const items = Array.isArray(tests) ? tests : [tests];
  const manualBankIds = items
    .map((t) => t?.questionBank?._id || t?.questionBank)
    .filter(Boolean)
    .map((id) => id.toString());
  const aiBankIds = items
    .map((t) => t?.aiQuestionBank?._id || t?.aiQuestionBank)
    .filter(Boolean)
    .map((id) => id.toString());

  const [manualStatsMap, aiStatsMap] = await Promise.all([
    questionBankRepository.getBanksStatsBatch([...new Set(manualBankIds)]),
    aiQuestionBankRepository.getBanksStatsBatch([...new Set(aiBankIds)]),
  ]);

  items.forEach((t) => {
    t.sourceType = (t.paperSource === "ai" || Boolean(t.aiQuestionBank)) ? "ai" : "manual";
    if (t?.questionBank?._id || t?.questionBank) {
      const key = (t.questionBank._id || t.questionBank).toString();
      const stats = manualStatsMap.get(key) || { totalQuestions: 0, totalMarks: 0 };
      if (t.questionBank && typeof t.questionBank === "object") {
        t.questionBank.totalQuestions = stats.totalQuestions;
        t.questionBank.totalMarks = stats.totalMarks;
      }
    }
    if (t?.aiQuestionBank?._id || t?.aiQuestionBank) {
      const key = (t.aiQuestionBank._id || t.aiQuestionBank).toString();
      const stats = aiStatsMap.get(key) || { totalQuestions: 0, totalMarks: 0 };
      if (t.aiQuestionBank && typeof t.aiQuestionBank === "object") {
        t.aiQuestionBank.totalQuestions = stats.totalQuestions;
        t.aiQuestionBank.totalMarks = stats.totalMarks;
      }
    }
  });

  return tests;
};

export const getTests = async (options = {}) => {
  const query = {};
  if (options.applicableFor) {
    query.applicableFor = options.applicableFor;
  }

  if (options.excludeAssigned === 'true' || options.excludeAssigned === true) {
    const usedIds = await testRepository.findAllUsedBundleTestIds(options.includeBundleId);
    if (usedIds.length > 0) {
      query._id = { $nin: usedIds };
    }
  }
  const result = await testRepository.findAllTests(query, options);
  await enrichTestsWithBankStats(result.tests);


  return result;
};

export const getTestById = async (id) => {
  const test = await testRepository.findTestById(id, {
    questionBank: "name categories",
    aiQuestionBank: "name categories overallDifficulty aiProvider",
  });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }
  await enrichTestsWithBankStats(test);

  // Attach isPurchased and hasAttempts so the frontend can handle locking appropriately
  const [purchase, session] = await Promise.all([
    TestPurchase.exists({
      test: test._id,
      paymentStatus: "completed",
    }),
    ExamSession.exists({
      test: test._id,
    }),
  ]);

  const isPurchased = !!purchase;
  const hasAttempts = !!session;

  test.isPurchased = isPurchased;
  test.hasAttempts = hasAttempts;
  if (test._doc) {
    test._doc.isPurchased = isPurchased;
    test._doc.hasAttempts = hasAttempts;
  }

  return test;
};

export const updateTest = async (id, data, file) => {
  if (data.title) {
    await ensureUniqueTestTitle(data.title, id, "Test");
  }

  const existing = await testRepository.findTestById(id);
  if (!existing) throw new ApiError(404, "Test not found");

  // Check if any student has attempted this test
  const hasAttempts = !!(await ExamSession.exists({
    test: id,
  }));

  // Block changing durationMinutes only if one or more students have already attempted this test
  if (hasAttempts) {
    if (
      Object.prototype.hasOwnProperty.call(data, "durationMinutes") &&
      Number(data.durationMinutes) !== Number(existing.durationMinutes)
    ) {
      throw new ApiError(
        400,
        "Cannot change Duration: one or more students have already attempted this test."
      );
    }
  }

  // Restrict changing applicableFor once a standalone test ("test") has purchases
  if (
    Object.prototype.hasOwnProperty.call(data, "applicableFor") &&
    data.applicableFor !== existing.applicableFor
  ) {
    if (existing.applicableFor === "test") {
      const purchase = await orderRepository.findTestPurchase({
        test: id,
        paymentStatus: "completed",
      });
      if (purchase) {
        throw new ApiError(
          400,
          "Cannot change applicableFor: this standalone test has already been purchased by at least one user"
        );
      }
    }
  }

  if (data.questionBank && data.aiQuestionBank) {
    throw new ApiError(400, "Test cannot link both manual and AI question banks");
  }
  if (data.questionBank) {
    const bank = await questionBankRepository.findById(data.questionBank);
    if (!bank) throw new ApiError(404, "Question bank not found");
    data.aiQuestionBank = null;
  }
  if (data.aiQuestionBank) {
    const bank = await aiQuestionBankRepository.findById(data.aiQuestionBank);
    if (!bank) throw new ApiError(404, "AI question bank not found");
    data.questionBank = null;
  }
  const effectiveAiBank =
    data.aiQuestionBank || (!data.questionBank ? existing.aiQuestionBank : null);
  if (effectiveAiBank) {
    const targetCatId = data.categoryId || existing.categoryId;
    if (targetCatId) {
      const children = await Category.find({ parent: targetCatId })
        .select("_id name")
        .lean();
      if (children.length > 0) {
        const mockLeaf = children.find((c) => {
          const n = String(c.name || "").trim().toLowerCase();
          return (
            /\bfull\s*mock\b/i.test(n) ||
            /\bfull\s*paper\b/i.test(n) ||
            /\bmock\s*practice\b/i.test(n) ||
            /\bmodel\s*paper\b/i.test(n)
          );
        });
        if (mockLeaf) {
          data.categoryId = mockLeaf._id;
        }
      }
    }
  }

  if (file) {
    if (existing.imageUrl) {
      await deleteFileFromCloudinary(existing.imageUrl);
    }
    data.imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      TESTS_IMAGE_FOLDER,
      file.mimetype
    );
  }

  const updated = await testRepository.updateTestById(id, data);
  if (updated) {
    await enrichTestsWithBankStats(updated);

    const changedFieldsList = [];
    if (data.title && data.title !== existing.title) changedFieldsList.push("Title");
    if (data.description !== undefined && data.description !== existing.description) changedFieldsList.push("Description");
    if (data.price !== undefined && Number(data.price) !== existing.price) changedFieldsList.push("Price");
    if (data.durationMinutes !== undefined && Number(data.durationMinutes) !== existing.durationMinutes) changedFieldsList.push("Duration");
    if (data.questionBank && String(data.questionBank) !== String(existing.questionBank?._id ?? existing.questionBank)) changedFieldsList.push("Question Bank");
    if (file) changedFieldsList.push("Image");
    if (data.rewardPoints !== undefined && Number(data.rewardPoints) !== existing.rewardPoints) changedFieldsList.push("Reward Points");
    if (data.categoryId && String(data.categoryId) !== String(existing.categoryId)) changedFieldsList.push("Category");

    // Strict checks for both existing and updated status
    const isNowPublished = updated.isPublished === true || String(updated.isPublished) === "true";

    // If the test was just published and hasn't notified yet, send the upgrade notification now
    if (isNowPublished && !existing.upgradeNotificationSent && updated.categoryId) {
      sendUpgradeNotificationForCategory(
        updated.categoryId,
        updated.title,
        "test",
        updated.createdBy
      ).catch((err) => {
        console.error("Failed to send upgrade notification for updated test:", err);
      });
      // Mark as notified so future edits don't spam students
      await testRepository.updateTestById(id, { upgradeNotificationSent: true });
    } else if (isNowPublished) {
      // Test was already published and is being edited, send update notification
      sendTestEditNotification(
        id,
        updated.title,
        updated.categoryId,
        updated.createdBy,
        existing.title,
        changedFieldsList
      ).catch((err) => {
        console.error("Failed to send edit notification for updated test:", err);
      });
    }
  }
  return updated;
};

export const deleteTest = async (id) => {
  const existing = await testRepository.findTestById(id);
  if (!existing) throw new ApiError(404, "Test not found");

  // Block deletion if any student has purchased this test
  const purchaseExists = await TestPurchase.exists({
    test: id,
    paymentStatus: "completed",
  });
  if (purchaseExists) {
    throw new ApiError(
      400,
      "Cannot delete this test: it has already been purchased by one or more students."
    );
  }

  if (existing.imageUrl) {
    await deleteFileFromCloudinary(existing.imageUrl);
  }
  const deleted = await testRepository.deleteTestById(id);
  if (!deleted) {
    throw new ApiError(404, "Test not found");
  }
  return true;
};

// ------- Bundles -------

const BUNDLES_IMAGE_FOLDER = "test-bundles";

const enrichBundlesTests = async (bundles) => {
  const items = Array.isArray(bundles) ? bundles : [bundles];
  for (const bundle of items) {
    if (bundle?.tests?.length) {
      await enrichTestsWithBankStats(bundle.tests);
    }
  }
};

export const createBundle = async (data, adminId, file) => {
  if (data.name) {
    await ensureUniqueTestTitle(data.name);
  }

  let imageUrl = null;
  if (file) {
    imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      BUNDLES_IMAGE_FOLDER,
      file.mimetype
    );
  }
  const bundle = await testRepository.createBundle({
    ...data,
    imageUrl,
    createdBy: adminId,
  });
  await enrichBundlesTests(bundle);
  return bundle;
};

export const getBundles = async (options = {}) => {
  const result = await testRepository.findAllBundles({}, options);
  await enrichBundlesTests(result.bundles);
  return result;
};

export const getBundleById = async (id) => {
  const bundle = await testRepository.findBundleById(id, {
    tests: "title durationMinutes questionBank",
  });
  if (!bundle) {
    throw new ApiError(404, "Bundle not found");
  }
  await enrichBundlesTests(bundle);
  return bundle;
};

export const updateBundle = async (id, data, file) => {
  if (data.name) {
    await ensureUniqueTestTitle(data.name, id, "TestBundle");
  }

  const existing = await testRepository.findBundleById(id);
  if (!existing) throw new ApiError(404, "Bundle not found");
  if (file) {
    if (existing.imageUrl) {
      await deleteFileFromCloudinary(existing.imageUrl);
    }
    data.imageUrl = await uploadImageToCloudinary(
      file.buffer,
      file.originalname,
      BUNDLES_IMAGE_FOLDER,
      file.mimetype
    );
  }
  const updated = await testRepository.updateBundleById(id, data);
  if (!updated) {
    throw new ApiError(404, "Bundle not found");
  }
  await enrichBundlesTests(updated);
  return updated;
};

export const deleteBundle = async (id) => {
  const existing = await testRepository.findBundleById(id);
  if (!existing) throw new ApiError(404, "Bundle not found");
  if (existing.imageUrl) {
    await deleteFileFromCloudinary(existing.imageUrl);
  }
  const deleted = await testRepository.deleteBundleById(id);
  if (!deleted) {
    throw new ApiError(404, "Bundle not found");
  }
  return true;
};

export default {
  createTest,
  getTests,
  getTestById,
  updateTest,
  deleteTest,
  createBundle,
  getBundles,
  getBundleById,
  updateBundle,
  deleteBundle,
};


