/**
 * DEPRECATED — buffer-inflated cost plan.
 * Prefer accurate (no buffer) report:
 *   node scripts/report-jee-advanced-gemini-paper-cost.mjs
 *   temp/reports/jee-advanced-gemini-paper-cost-report.md
 *
 *   node scripts/report-jee-advanced-gemini-cost-with-buffer.mjs
 */
import fs from "fs";
import path from "path";

const WALLET_SPENT = 1050;
const Q_SUCCESS = 24;
const REMAIN = 950;
const basePerHardNS = WALLET_SPENT / Q_SUCCESS; // 43.75

// Previous mixed/all-hard base (no buffer)
const mixedBase = { p1: 1392, p2: 1392, full: 2783, avg: 27.3, hours: 1.86 };
const hardBase = { p1: 1847, p2: 1847, full: 3693, avg: 36.2, hours: 2.47 };
const mathsP1 = 488;
const phyP1 = 464;
const chemP1 = 439;

const BUFFERS = {
  light: 0.25,
  recommended: 0.4,
  heavy: 0.6,
};

function apply(base, b) {
  return {
    p1: Math.round(base.p1 * (1 + b)),
    p2: Math.round(base.p2 * (1 + b)),
    full: Math.round(base.full * (1 + b)),
    avg: +(base.avg * (1 + b)).toFixed(1),
    // time: partial inflation (retries add wall, but not always 1:1 with cost)
    hoursTypical: +(base.hours * (1 + b * 0.5)).toFixed(2),
    hoursWorst: +(base.hours * (1 + b)).toFixed(2),
    perHardNS: +(basePerHardNS * (1 + b)).toFixed(1),
  };
}

const rec = apply(mixedBase, BUFFERS.recommended);
const recHard = apply(hardBase, BUFFERS.recommended);
const heavy = apply(mixedBase, BUFFERS.heavy);
const heavyHard = apply(hardBase, BUFFERS.heavy);
const light = apply(mixedBase, BUFFERS.light);
const lightHard = apply(hardBase, BUFFERS.light);

const typeHard = [
  { type: "single", base: 38.1 },
  { type: "multi", base: 56.4 },
  { type: "integer", base: 23.2 },
  { type: "match", base: 46.8 },
].map((t) => ({
  type: t.type,
  hardBase: t.base,
  hardRec: +(t.base * 1.4).toFixed(1),
  hardHeavy: +(t.base * 1.6).toFixed(1),
  mediumRec: +(t.base * 0.7 * 1.4).toFixed(1),
  easyRec: +(t.base * 0.5 * 1.4).toFixed(1),
}));

const credit = {
  remain: REMAIN,
  needMixedRec: rec.full,
  needMixedHeavy: heavy.full,
  needAllHardRec: recHard.full,
  needAllHardHeavy: heavyHard.full,
  shortMixedRec: Math.max(0, rec.full - REMAIN),
  shortMixedHeavy: Math.max(0, heavy.full - REMAIN),
  shortHardRec: Math.max(0, recHard.full - REMAIN),
  shortHardHeavy: Math.max(0, heavyHard.full - REMAIN),
  topUpMixedRec: Math.round(rec.full - REMAIN + 300),
  topUpMixedHeavy: Math.round(heavy.full - REMAIN + 500),
  topUpHardRec: Math.round(recHard.full - REMAIN + 400),
  topUpHardHeavy: Math.round(heavyHard.full - REMAIN + 700),
  qsLeftBase: Math.floor(REMAIN / basePerHardNS),
  qsLeftRec: Math.floor(REMAIN / rec.perHardNS),
  qsLeftHeavy: Math.floor(REMAIN / heavy.perHardNS),
};

const subjRec = {
  mathsP1: Math.round(mathsP1 * 1.4),
  phyP1: Math.round(phyP1 * 1.4),
  chemP1: Math.round(chemP1 * 1.4),
  p1: Math.round(1392 * 1.4),
};

const report = {
  title: "JEE Advanced Gemini Cost WITH BUFFER",
  reason:
    "Scripts sometimes terminated mid-run; burned credits without finishing 24 clean Qs. Plan with buffer, not bare wallet/24.",
  basePerHardNS,
  buffers: BUFFERS,
  unitWithBuffer: {
    base: +basePerHardNS.toFixed(1),
    light25: light.perHardNS,
    recommended40: rec.perHardNS,
    heavy60: heavy.perHardNS,
  },
  typeHard,
  mixed: { raw: mixedBase, light, recommended: rec, heavy },
  allHard: { raw: hardBase, light: lightHard, recommended: recHard, heavy: heavyHard },
  paper1SubjectRecommended40: subjRec,
  credit,
  budgetRecommendation: {
    onePaperMixed51: 2000,
    fullDualMixed102: 4000,
    fullDualAllHard102: 6000,
    remainingBuysHardQsAt40: credit.qsLeftRec,
  },
};

let md = "";
md += "# JEE Advanced Gemini Cost — WITH BUFFER (aborts / retries)\n\n";
md +=
  "**Why buffer?** Scripts are sometimes **terminated** mid-run (too long). Those Gemini calls still cost money.  \n";
md +=
  "The **₹1,050 / 24 Q** number is only for **kept** questions. Do **not** treat that as exact clean cost for every future Q.\n\n";
md += "---\n\n";

md += "## 1. Base vs buffered unit rates\n\n";
md += "| Rate | ₹ / hard non-single Q | Meaning |\n";
md += "|------|----------------------:|---------|\n";
md += `| **Base (wallet)** | **₹${basePerHardNS.toFixed(1)}** | ₹1050 ÷ 24 successful Maths Qs |\n`;
md += `| Light **+25%** | **₹${light.perHardNS}** | Rare aborts |\n`;
md += `| **Recommended +40%** | **₹${rec.perHardNS}** | Typical kills + retries + fill waste |\n`;
md += `| Heavy **+60%** | **₹${heavy.perHardNS}** | Frequent timeouts / many abandoned runs |\n\n`;

md += "### Hard Maths type rates\n\n";
md += "| Type | Base ₹ | +40% plan ₹ | +60% safe ₹ |\n";
md += "|------|-------:|------------:|------------:|\n";
for (const t of typeHard) {
  md += `| ${t.type} | ${t.hardBase} | **${t.hardRec}** | ${t.hardHeavy} |\n`;
}
md += "\n---\n\n";

md += "## 2. What the buffer covers\n\n";
md += "| Waste source | Covered? |\n";
md += "|--------------|----------|\n";
md += "| Script killed mid-generation (timeout / manual stop) | Yes |\n";
md += "| JSON parse fail retry (wasted multi attempt) | Yes |\n";
md += "| Fill rounds that keep 0 after dual-lock drops | Yes |\n";
md += "| Insight expand spikes / slow Qs | Yes |\n";
md += "| Re-run after partial output | Yes |\n";
md += "| OpenAI dual-lock | **No** (Gemini-only) |\n\n";
md += "---\n\n";

md += "## 3. Full paper cost WITH buffer\n\n";
md += "### Mixed difficulty (realistic paper)\n\n";
md += "| Buffer | Paper 1 (51) | Paper 2 (51) | **Full 102** | Avg ₹/Q | Wall time |\n";
md += "|--------|-------------:|-------------:|-------------:|--------:|----------:|\n";
md += `| None (raw) | ₹${mixedBase.p1} | ₹${mixedBase.p2} | ₹${mixedBase.full} | ₹${mixedBase.avg} | ~${mixedBase.hours}h |\n`;
md += `| +25% light | ₹${light.p1} | ₹${light.p2} | ₹${light.full} | ₹${light.avg} | ~${light.hoursTypical}–${light.hoursWorst}h |\n`;
md += `| **+40% recommended** | **₹${rec.p1}** | **₹${rec.p2}** | **₹${rec.full}** | **₹${rec.avg}** | **~${rec.hoursTypical}–${rec.hoursWorst}h** |\n`;
md += `| +60% heavy | ₹${heavy.p1} | ₹${heavy.p2} | ₹${heavy.full} | ₹${heavy.avg} | ~${heavy.hoursTypical}–${heavy.hoursWorst}h |\n\n`;

md += "### All-hard (yesterday style)\n\n";
md += "| Buffer | Paper 1 | Paper 2 | **Full 102** | Avg ₹/Q | Wall time |\n";
md += "|--------|--------:|--------:|-------------:|--------:|----------:|\n";
md += `| None | ₹${hardBase.p1} | ₹${hardBase.p2} | ₹${hardBase.full} | ₹${hardBase.avg} | ~${hardBase.hours}h |\n`;
md += `| **+40% recommended** | **₹${recHard.p1}** | **₹${recHard.p2}** | **₹${recHard.full}** | **₹${recHard.avg}** | **~${recHard.hoursTypical}–${recHard.hoursWorst}h** |\n`;
md += `| +60% heavy | ₹${heavyHard.p1} | ₹${heavyHard.p2} | ₹${heavyHard.full} | ₹${heavyHard.avg} | ~${heavyHard.hoursTypical}–${heavyHard.hoursWorst}h |\n\n`;
md += "---\n\n";

md += "## 4. Paper 1 by subject (recommended +40%)\n\n";
md += "| Subject | Q | Base ₹ | **Plan ₹ (+40%)** |\n";
md += "|---------|--:|-------:|------------------:|\n";
md += `| Physics | 17 | ₹${phyP1} | **₹${subjRec.phyP1}** |\n`;
md += `| Chemistry | 17 | ₹${chemP1} | **₹${subjRec.chemP1}** |\n`;
md += `| Mathematics | 17 | ₹${mathsP1} | **₹${subjRec.mathsP1}** |\n`;
md += `| **Paper 1** | **51** | ₹1392 | **₹${subjRec.p1}** |\n\n`;
md += "---\n\n";

md += "## 5. Credit plan (have ₹950)\n\n";
md += "| Plan | Need (buffered) | Have | Shortfall | Top-up |\n";
md += "|------|----------------:|-----:|----------:|-------:|\n";
md += `| Mixed 102 **+40%** | **₹${rec.full}** | ₹950 | **₹${credit.shortMixedRec}** | **₹${credit.topUpMixedRec}+** |\n`;
md += `| Mixed 102 **+60%** | **₹${heavy.full}** | ₹950 | **₹${credit.shortMixedHeavy}** | **₹${credit.topUpMixedHeavy}+** |\n`;
md += `| All-hard 102 **+40%** | **₹${recHard.full}** | ₹950 | **₹${credit.shortHardRec}** | **₹${credit.topUpHardRec}+** |\n`;
md += `| All-hard 102 **+60%** | **₹${heavyHard.full}** | ₹950 | **₹${credit.shortHardHeavy}** | **₹${credit.topUpHardHeavy}+** |\n\n`;

md += "| What ₹950 buys | Successful Qs |\n";
md += "|----------------|--------------:|\n";
md += `| At base ₹${basePerHardNS.toFixed(1)} (too optimistic) | ~${credit.qsLeftBase} |\n`;
md += `| At **+40%** ₹${rec.perHardNS} | **~${credit.qsLeftRec}** |\n`;
md += `| At **+60%** ₹${heavy.perHardNS} | **~${credit.qsLeftHeavy}** |\n\n`;
md += "---\n\n";

md += "## 6. Bottom line — budget these numbers\n\n";
md += "| Goal | Do NOT use (raw) | **Plan with buffer** |\n";
md += "|------|-----------------:|---------------------:|\n";
md += `| Hard non-single unit | ₹${basePerHardNS.toFixed(1)} | **₹${rec.perHardNS} – ₹${heavy.perHardNS}** |\n`;
md += `| One paper 51 mixed | ₹1,392 | **₹${rec.p1} – ₹${heavy.p1}** |\n`;
md += `| Full 102 mixed | ₹2,783 | **₹${rec.full} – ₹${heavy.full}** |\n`;
md += `| Full 102 all-hard | ₹3,693 | **₹${recHard.full} – ₹${heavyHard.full}** |\n`;
md += `| Wall time 102 mixed | ~1.9h clean | **~${rec.hoursTypical} – ${heavy.hoursWorst}h** |\n\n`;

md += "### Recommended budget (simple)\n\n";
md += "- **One paper (51 Q, mixed):** **₹2,000** Gemini  \n";
md += "- **Both papers (102 Q, mixed):** **₹4,000** Gemini  \n";
md += "- **Both papers all-hard:** **₹5,500 – ₹6,000** Gemini  \n";
md += `- With **₹950** left: expect only **~${credit.qsLeftRec} successful hard Qs** (not ~21)  \n`;
md += "- Top-up for full dual mixed paper now: **~₹3,000 – ₹3,500**  \n\n";

md += "### Rule of thumb\n\n";
md += "```\n";
md += "Planning cost = (₹ per kept Q from wallet) × questions × 1.40   // recommended\n";
md += "Safe cost     = (₹ per kept Q from wallet) × questions × 1.60   // many terminations\n";
md += "```\n\n";
md += "**Never assume 24 kept Qs = 100% credit efficiency** when scripts can be killed mid-run.\n";

const outDir = path.resolve("temp/reports");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "jee-advanced-gemini-cost-WITH-BUFFER.md"),
  md
);
fs.writeFileSync(
  path.join(outDir, "jee-advanced-gemini-cost-WITH-BUFFER.json"),
  JSON.stringify(report, null, 2)
);
console.log(md);
console.log("\nWrote temp/reports/jee-advanced-gemini-cost-WITH-BUFFER.md");
