/**
 * Ensure subject children under Competitive exam categories from seeded papers.
 * Idempotent. Does not push — run locally:
 *   node scripts/seed-competitive-exam-subjects.mjs
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/config/db.js";
import Category, { Subcategory } from "../src/models/Category.js";
import {
  COMPETITIVE_EXAM_SUBJECT_SEED,
} from "../src/services/seededCompetitivePapers.service.js";

dotenv.config();

const findChild = async (parentId, name) =>
  Category.findOne({
    parent: parentId,
    name: new RegExp(
      `^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    ),
  });

const ensureChild = async ({ parent, name, order, createdBy }) => {
  const existing = await findChild(parent._id, name);
  if (existing) {
    const patch = {};
    if (existing.isActive === false) patch.isActive = true;
    if (existing.kind !== "Subcategory" && existing.status !== "Public") {
      /* leave kind alone */
    }
    if (Object.keys(patch).length) {
      await Category.updateOne({ _id: existing._id }, { $set: patch });
      Object.assign(existing, patch);
    }
    return { doc: existing, created: false };
  }

  const doc = await Subcategory.create({
    name,
    parent: parent._id,
    order,
    createdBy,
    isActive: true,
    isPredefined: false,
    rootType: parent.rootType || "Competitive",
    status: "Public",
    price: 0,
    isFree: true,
  });
  return { doc, created: true };
};

/** Canonical exam category name patterns → subjects to seed. */
const EXAM_SUBJECT_PLAN = COMPETITIVE_EXAM_SUBJECT_SEED;

const run = async () => {
  // PAUSED: Auto-creation of child subcategories for all competitive exams
  // (JEE, NEET, CLAT, GMAT, CAT, IBPS, UPSC, SSC, etc.) is disabled.
  console.log(
    "ℹ️ seed-competitive-exam-subjects is PAUSED. Auto-creation of exam child subcategories is disabled for all exams."
  );
  process.exit(0);

  await connectDB();

  const competitive = await Category.findOne({
    name: /^competitive$/i,
    parent: null,
  });
  if (!competitive) throw new Error('Root "Competitive" not found');

  const createdBy =
    competitive.createdBy ||
    (await Category.findOne({ createdBy: { $ne: null } }))?.createdBy;
  if (!createdBy) throw new Error("No createdBy admin available");

  const exams = await Category.find({
    rootType: "Competitive",
    isActive: { $ne: false },
  })
    .select("name parent rootType")
    .lean();

  const report = [];

  for (const plan of EXAM_SUBJECT_PLAN) {
    const matches = exams.filter((e) => plan.match(e.name));
    for (const exam of matches) {
      let order = 0;
      const created = [];
      const kept = [];
      for (const subject of plan.subjects) {
        const { doc, created: wasCreated } = await ensureChild({
          parent: exam,
          name: subject,
          order: order++,
          createdBy,
        });
        if (wasCreated) created.push(doc.name);
        else kept.push(doc.name);
      }
      report.push({
        exam: exam.name,
        examId: String(exam._id),
        subjects: plan.subjects,
        created,
        alreadyHad: kept,
      });
    }
  }

  console.log(JSON.stringify({ ok: true, exams: report }, null, 2));
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("seed-competitive-exam-subjects failed:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
