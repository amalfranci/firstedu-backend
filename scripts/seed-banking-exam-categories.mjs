/**
 * Ensure Banking exam selection node for AI Powered Test:
 *   Competitive > Banking > IBPS PO Prelims
 *
 * Also keeps / renames clarity on existing Competitive > IBPS PO leaf.
 * Idempotent.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/config/db.js";
import Category, { Subcategory } from "../src/models/Category.js";

dotenv.config();

const findChild = async (parentId, name) =>
  Category.findOne({
    parent: parentId,
    name: new RegExp(
      `^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    ),
  });

const ensureChild = async ({ parent, name, order, createdBy, price = 0 }) => {
  const existing = await findChild(parent._id, name);
  if (existing) {
    const patch = {};
    if (existing.order !== order) patch.order = order;
    if (existing.isActive === false) patch.isActive = true;
    if (existing.status && existing.status !== "Public") patch.status = "Public";
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
    price,
    isFree: price === 0,
  });
  return { doc, created: true };
};

const run = async () => {
  await connectDB();

  const competitive = await Category.findOne({
    name: /^competitive$/i,
    parent: null,
  });
  if (!competitive) throw new Error('Root category "Competitive" not found');

  const createdBy =
    competitive.createdBy ||
    (await Category.findOne({ createdBy: { $ne: null } }))?.createdBy;
  if (!createdBy) throw new Error("No createdBy admin available");

  const { doc: banking, created: bankingCreated } = await ensureChild({
    parent: competitive,
    name: "Banking",
    order: 12,
    createdBy,
    price: 0,
  });

  const { doc: ibps, created: ibpsCreated } = await ensureChild({
    parent: banking,
    name: "IBPS PO Prelims",
    order: 0,
    createdBy,
    price: 1000,
  });

  // Keep legacy top-level IBPS PO selectable too (same exam detection).
  const legacy = await findChild(competitive._id, "IBPS PO");
  if (legacy && legacy.isActive === false) {
    await Category.updateOne(
      { _id: legacy._id },
      { $set: { isActive: true, status: "Public" } }
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        banking: {
          path: "Competitive > Banking",
          id: String(banking._id),
          created: bankingCreated,
        },
        exam: {
          path: "Competitive > Banking > IBPS PO Prelims",
          id: String(ibps._id),
          created: ibpsCreated,
        },
        legacyIbpsPo: legacy ? String(legacy._id) : null,
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("seed-banking-exam-categories failed:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
