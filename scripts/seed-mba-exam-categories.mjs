/**
 * Ensure MBA exam selection nodes for AI Powered Test:
 *   Competitive > MBA > CAT
 *   Competitive > MBA > GMAT
 *
 * Both stay leaf categories (like NEET UG) so the paper wizard loads full
 * multi-section blueprints. Idempotent.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/config/db.js";
import Category, { Subcategory } from "../src/models/Category.js";

dotenv.config();

const findChild = async (parentId, name) =>
  Category.findOne({
    parent: parentId,
    name: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });

const ensureChild = async ({
  parent,
  name,
  order,
  createdBy,
  price = 0,
}) => {
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
  if (!competitive) {
    throw new Error('Root category "Competitive" not found');
  }

  let mba = await findChild(competitive._id, "MBA");
  if (!mba) {
    const createdBy =
      competitive.createdBy ||
      (await Category.findOne({ createdBy: { $ne: null } }))?.createdBy;
    if (!createdBy) throw new Error("No createdBy admin available for MBA");
    mba = await Subcategory.create({
      name: "MBA",
      parent: competitive._id,
      order: 10,
      createdBy,
      isActive: true,
      rootType: "Competitive",
      status: "Public",
      price: 0,
      isFree: true,
    });
    console.log("Created Competitive > MBA");
  }

  const createdBy = mba.createdBy || competitive.createdBy;
  const exams = [
    { name: "CAT", order: 0, price: 1000 },
    { name: "GMAT", order: 1, price: 1000 },
  ];

  const results = [];
  for (const exam of exams) {
    const { doc, created } = await ensureChild({
      parent: mba,
      name: exam.name,
      order: exam.order,
      createdBy,
      price: exam.price,
    });
    results.push({
      path: `Competitive > MBA > ${doc.name}`,
      id: String(doc._id),
      created,
      order: doc.order,
    });
  }

  // Keep PGCET after the seeded exams when present.
  const pgcet = await findChild(mba._id, "PGCET");
  if (pgcet && pgcet.order < 2) {
    await Category.updateOne({ _id: pgcet._id }, { $set: { order: 2 } });
  }

  console.log(JSON.stringify({ ok: true, mba: String(mba._id), exams: results }, null, 2));
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("seed-mba-exam-categories failed:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
