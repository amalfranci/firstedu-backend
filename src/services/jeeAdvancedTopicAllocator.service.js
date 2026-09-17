/**
 * Backend-only topic allocator for JEE Advanced paper jobs.
 * Picks N distinct chapters from the user-selected seed pool.
 * Gemini is not used here — it only chooses a hard archetype inside an allocated chapter.
 *
 * Config file (edit without code): jee_advanced/topic_allocation.json
 *
 * score =
 *   historical_weight
 * + high_yield_priority
 * + hard_slot_availability
 * + freshness_bonus
 * - recently_used_penalty
 * - same_cluster_penalty (vs topics already picked this paper)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(
  __dirname,
  "..",
  "..",
  "jee_advanced",
  "topic_allocation.json"
);

const DEFAULT_WEIGHTS = {
  historical: 1,
  priorityHigh: 0.25,
  priorityMedium: 0.1,
  hardSlot: 0.04,
  freshness: 0.15,
  recentUsed: 0.35,
  sameCluster: 0.22,
};

let cache = null;

const loadConfig = () => {
  if (cache) return cache;
  if (!existsSync(CONFIG_PATH)) {
    cache = { weights: DEFAULT_WEIGHTS, topics: {} };
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    cache = { weights: DEFAULT_WEIGHTS, topics: {} };
  }
  return cache;
};

const topicMeta = (topicId) => {
  const cfg = loadConfig();
  return cfg.topics?.[String(topicId || "").toUpperCase()] || {};
};

const priorityBonus = (priority, w) => {
  const p = String(priority || "").toLowerCase();
  if (p === "high") return Number(w.priorityHigh) || 0;
  if (p === "medium") return Number(w.priorityMedium) || 0;
  return 0;
};

const scoreTopic = (item, { paper, pickedClusters, weights }) => {
  const id = String(item.topicId || "").toUpperCase();
  const meta = topicMeta(id);
  const historical = Number(meta.weight ?? item.weight ?? 0.5);
  const priority = meta.priority || item.relevance || "medium";
  const hardSlots = Math.max(
    0,
    Number(item.hardSlotCount ?? meta.hardSlotCount ?? 0)
  );
  const cluster = meta.cluster || item.cluster || "";
  const lastUsed = meta.lastUsedPaper;

  let score = historical * (Number(weights.historical) || 1);
  score += priorityBonus(priority, weights);
  score += Math.min(8, hardSlots) * (Number(weights.hardSlot) || 0);
  if (lastUsed == null || lastUsed === "") {
    score += Number(weights.freshness) || 0;
  } else if (Number(lastUsed) === Number(paper)) {
    score -= Number(weights.recentUsed) || 0;
  } else {
    score -= (Number(weights.recentUsed) || 0) * 0.4;
  }
  if (cluster && pickedClusters.has(cluster)) {
    score -= Number(weights.sameCluster) || 0;
  }
  return { score, cluster, priority, hardSlots, historical };
};

/**
 * @param {Array<{ topicId: string, subject?: string, hardSlotCount?: number, relevance?: string }>} pool
 * @param {number} count
 * @param {{ paper?: number }} [opts]
 */
export const allocateTopicsFromPool = (pool = [], count = 0, opts = {}) => {
  const need = Math.max(0, Number(count) || 0);
  const unique = [];
  const seen = new Set();
  for (const item of pool || []) {
    const id = String(item?.topicId || "").trim();
    if (!id) continue;
    const key = `${item.subject || ""}::${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  if (need <= 0 || !unique.length) return [];

  const cfg = loadConfig();
  const weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights || {}) };
  const paper = Number(opts.paper) || 0;
  const pickedClusters = new Set();
  const picked = [];
  const remaining = [...unique];
  const take = Math.min(need, remaining.length);

  while (picked.length < take && remaining.length) {
    let bestIdx = 0;
    let best = null;
    remaining.forEach((item, idx) => {
      const ranked = scoreTopic(item, { paper, pickedClusters, weights });
      if (
        !best ||
        ranked.score > best.ranked.score ||
        (ranked.score === best.ranked.score &&
          ranked.hardSlots > best.ranked.hardSlots) ||
        (ranked.score === best.ranked.score &&
          ranked.hardSlots === best.ranked.hardSlots &&
          String(item.topicId) < String(best.item.topicId))
      ) {
        best = { item, ranked };
        bestIdx = idx;
      }
    });
    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push({
      ...chosen,
      _allocScore: best.ranked.score,
      _allocCluster: best.ranked.cluster,
    });
    if (best.ranked.cluster) pickedClusters.add(best.ranked.cluster);
  }
  return picked;
};

export const describeAllocation = (picked = []) =>
  picked.map((t) => ({
    topicId: t.topicId,
    chapter: t.chapter,
    subject: t.subject,
    score: Number(t._allocScore?.toFixed?.(4) ?? t._allocScore) || 0,
    cluster: t._allocCluster,
  }));

export const markAllocatedTopicsUsed = (picked = [], paper = 1) => {
  const cfg = loadConfig();
  if (!cfg.topics) cfg.topics = {};
  const p = Number(paper) || 1;
  let changed = false;
  for (const item of picked || []) {
    const id = String(item.topicId || "").toUpperCase();
    if (!id) continue;
    if (!cfg.topics[id]) cfg.topics[id] = {};
    cfg.topics[id].lastUsedPaper = p;
    changed = true;
  }
  if (!changed) return;
  cache = cfg;
  try {
    writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  } catch {
    // History write is best-effort; allocation still stands.
  }
};
