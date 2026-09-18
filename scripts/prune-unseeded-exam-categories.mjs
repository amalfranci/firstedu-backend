/**
 * Deactivate Competitive category nodes that are not seeded paper-wizard exams
 * (and not ancestors/subjects under those exams).
 *
 * Keeps:
 *   JEE Advanced / JEE Main (+ PCM subjects)
 *   NEET UG (+ subjects)
 *   CAT, GMAT
 *   CLAT
 *   IBPS PO Prelims
 *   SSC CGL Tier 1 / Tier 2
 *   UPSC CSE Prelims
 *
 * Soft-deletes (isActive=false) everything else under Competitive.
 * Idempotent. Does not hard-delete.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/config/db.js";
import Category from "../src/models/Category.js";

dotenv.config();

const isSeededExamLabel = (label = "") => {
  const n = String(label || "").trim();
  if (!n) return false;
  if (/jee\s*adv(?:ance|anced)?/i.test(n)) return true;
  if (/jee\s*mains?\b/i.test(n) && !/adv/i.test(n)) return true;
  if (/\bneet\b/i.test(n) && !/\bpg\b/i.test(n)) return true;
  if (/^cat$/i.test(n) || /\bcommon\s+admission\s+test\b/i.test(n)) return true;
  if (/\bgmat\b/i.test(n)) return true;
  if (/\bclat\b/i.test(n)) return true;
  if (/ibps(\s*po)?(\s*prelims)?/i.test(n)) return true;
  if (/ssc\s*cgl\s*tier\s*2\b|\bcgl\s*tier\s*(2|ii)\b/i.test(n)) return true;
  if (/ssc\s*cgl\b|\bcgl\s*tier\s*[i1]\b/i.test(n)) return true;
  if (/\bupsc\b/i.test(n)) return true;
  return false;
};

const run = async () => {
  await connectDB();

  const competitive = await Category.findOne({
    name: /^competitive$/i,
    parent: null,
  });
  if (!competitive) throw new Error('Root category "Competitive" not found');

  const all = await Category.find({}).select("_id name parent isActive").lean();
  const byParent = new Map();
  for (const doc of all) {
    const key = doc.parent ? String(doc.parent) : "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(doc);
  }

  const keepIds = new Set([String(competitive._id)]);

  const markKeepSubtree = (nodeId, ancestorIsExam) => {
    const children = byParent.get(String(nodeId)) || [];
    for (const child of children) {
      const selfIsExam = isSeededExamLabel(child.name);
      const underExam = ancestorIsExam || selfIsExam;
      if (underExam || selfIsExam) {
        keepIds.add(String(child._id));
        markKeepSubtree(child._id, underExam);
      } else {
        // Still walk: a non-exam folder may contain a seeded exam (MBA → CAT).
        const before = keepIds.size;
        markKeepSubtree(child._id, false);
        if (keepIds.size > before) {
          keepIds.add(String(child._id)); // keep ancestor folder
        }
      }
    }
  };

  markKeepSubtree(competitive._id, false);

  // Collect Competitive descendants (BFS) that are NOT kept.
  const toDisable = [];
  const queue = [String(competitive._id)];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift();
    for (const child of byParent.get(id) || []) {
      const cid = String(child._id);
      if (seen.has(cid)) continue;
      seen.add(cid);
      queue.push(cid);
      if (!keepIds.has(cid)) toDisable.push(child);
    }
  }

  let disabled = 0;
  for (const doc of toDisable) {
    if (doc.isActive === false) continue;
    await Category.updateOne({ _id: doc._id }, { $set: { isActive: false } });
    disabled += 1;
  }

  // Ensure kept seeded exams are active.
  let reactivated = 0;
  for (const id of keepIds) {
    if (id === String(competitive._id)) continue;
    const doc = all.find((d) => String(d._id) === id);
    if (doc && doc.isActive === false) {
      await Category.updateOne({ _id: doc._id }, { $set: { isActive: true } });
      reactivated += 1;
    }
  }

  const keptNames = all
    .filter((d) => keepIds.has(String(d._id)) && String(d._id) !== String(competitive._id))
    .map((d) => d.name)
    .sort();
  const disabledNames = toDisable.map((d) => d.name).sort();

  console.log(
    JSON.stringify(
      {
        ok: true,
        kept: keptNames.length,
        disabledNow: disabled,
        reactivated,
        keptNames,
        disabledNames,
      },
      null,
      2
    )
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("prune-unseeded-exam-categories failed:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
