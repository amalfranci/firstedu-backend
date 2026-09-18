/**
 * Ensure Government exam selection for AI Powered Test:
 *   Competitive > Government > SSC CGL Tier 1
 * Idempotent. Keeps existing UPSC sibling.
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

  let government = await findChild(competitive._id, "Government");
  if (!government) {
    const { doc } = await ensureChild({
      parent: competitive,
      name: "Government",
      order: 14,
      createdBy,
      price: 0,
    });
    government = doc;
  }

  const { doc: ssc, created } = await ensureChild({
    parent: government,
    name: "SSC CGL Tier 1",
    order: 0,
    createdBy,
    price: 1000,
  });

  const upsc = await findChild(government._id, "UPSC");
  if (upsc && (upsc.order == null || upsc.order < 1)) {
    await Category.updateOne({ _id: upsc._id }, { $set: { order: 1 } });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        exam: {
          path: "Competitive > Government > SSC CGL Tier 1",
          id: String(ssc._id),
          created,
        },
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("seed-ssc-cgl-tier1-exam-categories failed:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
