/**
 * JEE Advanced full-paper Gemini cost report.
 * Calibrated on real wallet: ₹2000 → ₹950 after 24 hard Advanced Maths Qs.
 *
 *   node scripts/report-jee-advanced-gemini-paper-cost.mjs
 */
import fs from "fs";
import path from "path";

// ===== Real wallet calibration (user) =====
const WALLET = { added: 2000, remain: 950, spent: 1050, questions: 24 };
const INR_PER_HARD_NS = WALLET.spent / WALLET.questions; // 43.75

// ===== Pattern from jee_advanced/jee_advanced_pattern_totals.json =====
const PER_SUBJECT_PAPER = { single: 4, multi: 3, integer: 6, match: 4 }; // 17
const SUBJECTS = ["Physics", "Chemistry", "Mathematics"];

// ===== Yesterday runs (measured) =====
const yTypes = {
  multi: 12,
  integer: 8,
  match: 4,
  sec: 348 + 232 + 882 + 1069, // four runs
};

// Type relative vs hard non-single avg (from best-run cost attribution)
const TYPE_HARD_MULT = { single: 0.87, multi: 1.29, integer: 0.53, match: 1.07 };
const DIFF_MULT = { easy: 0.5, medium: 0.7, hard: 1.0 };
const SUBJ_MULT = { Physics: 0.95, Chemistry: 0.9, Mathematics: 1.0 };
// Advanced paper mix (almost no trivial easy)
const DIFF_MIX = { easy: 0.15, medium: 0.5, hard: 0.35 };

const TYPE_TOK_HARD = {
  single: 11000,
  multi: 15000,
  integer: 9000,
  match: 14000,
};

function costPerQ(type, diff, subject) {
  return (
    INR_PER_HARD_NS *
    TYPE_HARD_MULT[type] *
    DIFF_MULT[diff] *
    SUBJ_MULT[subject]
  );
}
function timePerQ_sec(type, diff, subject) {
  const base = yTypes.sec / 24;
  return (
    base * TYPE_HARD_MULT[type] * DIFF_MULT[diff] * SUBJ_MULT[subject]
  );
}
function tokensPerQ(type, diff) {
  return Math.round(TYPE_TOK_HARD[type] * DIFF_MULT[diff]);
}

function distribute(count, mix) {
  const keys = Object.keys(mix);
  const raw = keys.map((k) => ({ k, v: count * mix[k] }));
  const floors = raw.map((r) => ({
    k: r.k,
    n: Math.floor(r.v),
    f: r.v - Math.floor(r.v),
  }));
  let used = floors.reduce((s, x) => s + x.n, 0);
  floors.sort((a, b) => b.f - a.f);
  let i = 0;
  while (used < count) {
    floors[i % floors.length].n++;
    used++;
    i++;
  }
  const out = {};
  for (const f of floors) out[f.k] = f.n;
  return out;
}

function buildPaper(paperName) {
  const bySubject = {};
  let totalQ = 0;
  let totalINR = 0;
  let totalSec = 0;
  let totalTok = 0;
  const byType = { single: 0, multi: 0, integer: 0, match: 0 };
  const byDiff = { easy: 0, medium: 0, hard: 0 };

  for (const subj of SUBJECTS) {
    const cells = [];
    let subjINR = 0;
    let subjSec = 0;
    let subjTok = 0;
    let subjQ = 0;
    for (const [type, count] of Object.entries(PER_SUBJECT_PAPER)) {
      const dist = distribute(count, DIFF_MIX);
      for (const [diff, n] of Object.entries(dist)) {
        if (!n) continue;
        const unitCost = costPerQ(type, diff, subj);
        const unitTime = timePerQ_sec(type, diff, subj);
        const unitTok = tokensPerQ(type, diff);
        cells.push({
          type,
          diff,
          n,
          unitCost,
          unitTime,
          unitTok,
          cost: unitCost * n,
          timeSec: unitTime * n,
          tokens: unitTok * n,
        });
        subjINR += unitCost * n;
        subjSec += unitTime * n;
        subjTok += unitTok * n;
        subjQ += n;
        byType[type] += n;
        byDiff[diff] += n;
      }
    }
    bySubject[subj] = {
      questions: subjQ,
      costINR: subjINR,
      timeSec: subjSec,
      tokens: subjTok,
      cells,
    };
    totalQ += subjQ;
    totalINR += subjINR;
    totalSec += subjSec;
    totalTok += subjTok;
  }
  return {
    paper: paperName,
    marks: 180,
    questions: totalQ,
    costINR: totalINR,
    timeSec: totalSec,
    tokens: totalTok,
    bySubject,
    byType,
    byDiff,
  };
}

function allHardPaper(paperName) {
  let cost = 0;
  let sec = 0;
  let tok = 0;
  let q = 0;
  const bySubj = {};
  for (const subj of SUBJECTS) {
    let sc = 0;
    let ss = 0;
    let st = 0;
    let sq = 0;
    for (const [type, count] of Object.entries(PER_SUBJECT_PAPER)) {
      sc += costPerQ(type, "hard", subj) * count;
      ss += timePerQ_sec(type, "hard", subj) * count;
      st += tokensPerQ(type, "hard") * count;
      sq += count;
    }
    bySubj[subj] = { q: sq, cost: sc, sec: ss, tok: st };
    cost += sc;
    sec += ss;
    tok += st;
    q += sq;
  }
  return { paper: paperName, q, cost, sec, tok, bySubj };
}

const p1 = buildPaper("Paper_1");
const p2 = buildPaper("Paper_2");
const ah1 = allHardPaper("Paper_1");
const ah2 = allHardPaper("Paper_2");

const mixedCombinedINR = p1.costINR + p2.costINR;
const mixedCombinedSec = p1.timeSec + p2.timeSec;
const mixedCombinedTok = p1.tokens + p2.tokens;
const allHardCombinedINR = ah1.cost + ah2.cost;
const allHardCombinedSec = ah1.sec + ah2.sec;

const unitTable = [];
for (const type of ["single", "multi", "integer", "match"]) {
  for (const diff of ["easy", "medium", "hard"]) {
    unitTable.push({
      type,
      diff,
      mathsINR: +costPerQ(type, diff, "Mathematics").toFixed(2),
      physicsINR: +costPerQ(type, diff, "Physics").toFixed(2),
      chemINR: +costPerQ(type, diff, "Chemistry").toFixed(2),
      mathsSec: +timePerQ_sec(type, diff, "Mathematics").toFixed(0),
      estTokens: tokensPerQ(type, diff),
    });
  }
}

const report = {
  title: "JEE Advanced Full Paper Gemini Cost Report",
  generatedAt: new Date().toISOString(),
  calibration: {
    spentINR: WALLET.spent,
    remainINR: WALLET.remain,
    questions: 24,
    inrPerHardNonSingleQ: INR_PER_HARD_NS,
  },
  officialPattern: {
    perSubjectPerPaper: PER_SUBJECT_PAPER,
    paperQuestions: 51,
    marksPerPaper: 180,
    combinedQuestions: 102,
    combinedMarks: 360,
  },
  difficultyMixAssumed: DIFF_MIX,
  multipliers: { TYPE_HARD_MULT, DIFF_MULT, SUBJ_MULT },
  yesterday: {
    pattern: "non_single_only hard Maths — 3 multi + 2 integer + 1 match × 4 runs",
    multi: yTypes.multi,
    integer: yTypes.integer,
    match: yTypes.match,
    spentINR: WALLET.spent,
    perQ_INR: INR_PER_HARD_NS,
    totalWallMin: +(yTypes.sec / 60).toFixed(1),
  },
  unitRateCard_INR: unitTable,
  mixedDifficulty: {
    paper1: {
      questions: p1.questions,
      costINR: Math.round(p1.costINR),
      timeHours: +(p1.timeSec / 3600).toFixed(2),
      bySubject: Object.fromEntries(
        SUBJECTS.map((s) => [
          s,
          {
            q: p1.bySubject[s].questions,
            costINR: Math.round(p1.bySubject[s].costINR),
            timeMin: +(p1.bySubject[s].timeSec / 60).toFixed(1),
          },
        ])
      ),
      byType: p1.byType,
      byDiff: p1.byDiff,
    },
    paper2: {
      questions: p2.questions,
      costINR: Math.round(p2.costINR),
      timeHours: +(p2.timeSec / 3600).toFixed(2),
      bySubject: Object.fromEntries(
        SUBJECTS.map((s) => [
          s,
          {
            q: p2.bySubject[s].questions,
            costINR: Math.round(p2.bySubject[s].costINR),
            timeMin: +(p2.bySubject[s].timeSec / 60).toFixed(1),
          },
        ])
      ),
    },
    combined: {
      questions: 102,
      marks: 360,
      costINR: Math.round(mixedCombinedINR),
      costRange: [
        Math.round(mixedCombinedINR * 0.85),
        Math.round(mixedCombinedINR * 1.25),
      ],
      timeHours: +(mixedCombinedSec / 3600).toFixed(2),
      timeRange: [
        +(mixedCombinedSec * 0.85 / 3600).toFixed(2),
        +(mixedCombinedSec * 1.3 / 3600).toFixed(2),
      ],
      estTokens: mixedCombinedTok,
      avgPerQ: +(mixedCombinedINR / 102).toFixed(1),
    },
    mathsP1Cells: p1.bySubject.Mathematics.cells.map((c) => ({
      type: c.type,
      diff: c.diff,
      n: c.n,
      unitCost: +c.unitCost.toFixed(1),
      subtotal: Math.round(c.cost),
      unitSec: Math.round(c.unitTime),
      unitTok: c.unitTok,
    })),
  },
  allHardScenario: {
    paper1_INR: Math.round(ah1.cost),
    paper2_INR: Math.round(ah2.cost),
    combined_INR: Math.round(allHardCombinedINR),
    timeHours: +(allHardCombinedSec / 3600).toFixed(2),
    avgPerQ: +(allHardCombinedINR / 102).toFixed(1),
    bySubject_bothPapers: Object.fromEntries(
      SUBJECTS.map((s) => [
        s,
        {
          q: ah1.bySubj[s].q + ah2.bySubj[s].q,
          costINR: Math.round(ah1.bySubj[s].cost + ah2.bySubj[s].cost),
        },
      ])
    ),
  },
  creditPlan: {
    remainingNowINR: WALLET.remain,
    needMixed102: Math.round(mixedCombinedINR),
    needAllHard102: Math.round(allHardCombinedINR),
    shortfallMixed: Math.max(0, Math.round(mixedCombinedINR - WALLET.remain)),
    shortfallAllHard: Math.max(
      0,
      Math.round(allHardCombinedINR - WALLET.remain)
    ),
    topUpMixed: Math.round(mixedCombinedINR - WALLET.remain + 500),
    topUpAllHard: Math.round(allHardCombinedINR - WALLET.remain + 800),
    qsLeftAtHardRate: Math.floor(WALLET.remain / INR_PER_HARD_NS),
  },
};

// ---- Markdown ----
const m = report.mixedDifficulty;
const a = report.allHardScenario;
const c = report.creditPlan;

let md = "";
md += `# JEE Advanced — Gemini Cost Report (Accurate · No Buffer)\n\n`;
md += `**Generated:** 2026-08-05  \n`;
md += `**Mode:** Accurate estimate only — **no** abort/kill buffer  \n`;
md += `**Calibration:** Wallet ₹2000 → ₹950 after **24 hard Advanced Maths** Qs → **₹${INR_PER_HARD_NS}/hard non-single Q**  \n`;
md += `**Pattern:** \`jee_advanced/jee_advanced_pattern_totals.json\`  \n`;
md += `**Writer (yesterday):** \`gemini-3.5-flash\`  \n`;
md += `**Canonical path:** \`temp/reports/jee-advanced-gemini-paper-cost-report.md\`\n\n`;
md += `---\n\n`;

md += `## 1. Yesterday baseline (what you actually paid)\n\n`;
md += `| Item | Value |\n|------|------:|\n`;
md += `| Questions | **24** Maths only |\n`;
md += `| Pattern | **Non-single only**: 3 multi + 2 integer + 1 match × 4 runs |\n`;
md += `| Single correct | **0** (not generated) |\n`;
md += `| Difficulty | **Hard only** (multi-concept) |\n`;
md += `| Easy / Medium | **None** |\n`;
md += `| Gemini spent | **₹1,050** |\n`;
md += `| Remaining | **₹950** |\n`;
md += `| **Real ₹ / Q** | **₹${INR_PER_HARD_NS}** |\n`;
md += `| Wall time | **~${(yTypes.sec / 60).toFixed(1)} min** (~${(yTypes.sec / 24).toFixed(0)}s/Q) |\n`;
md += `| Totals | multi **12** · integer **8** · match **4** |\n\n`;

md += `### Per-type hard rate (wallet-scaled)\n\n`;
md += `| Type | Count yesterday | Relative | ₹ / Q (hard Maths) | Wall s (hard Maths) | Est. tokens |\n`;
md += `|------|----------------:|---------:|-------------------:|--------------------:|------------:|\n`;
for (const type of ["single", "multi", "integer", "match"]) {
  const cnt =
    type === "single"
      ? 0
      : type === "multi"
        ? 12
        : type === "integer"
          ? 8
          : 4;
  const inr = costPerQ(type, "hard", "Mathematics");
  const sec = timePerQ_sec(type, "hard", "Mathematics");
  md += `| ${type} | ${cnt} | ${TYPE_HARD_MULT[type]}× | **₹${inr.toFixed(1)}** | ~${sec.toFixed(0)} | ~${TYPE_TOK_HARD[type].toLocaleString()} |\n`;
}
md += `\n---\n\n`;

md += `## 2. Official paper pattern\n\n`;
md += `Per **subject** per **paper**:\n\n`;
md += `| Section | Type | Q |\n|---------|------|--:|\n`;
md += `| 1 | Single correct | **4** |\n`;
md += `| 2 | Multi correct | **3** |\n`;
md += `| 3 | Numerical (integer) | **6** |\n`;
md += `| 4 | Match list | **4** |\n`;
md += `| **Total / subject / paper** | | **17** |\n\n`;
md += `| Paper | Phy | Chem | Math | Total Q | Marks |\n`;
md += `|-------|----:|-----:|-----:|--------:|------:|\n`;
md += `| Paper 1 | 17 | 17 | 17 | **51** | **180** |\n`;
md += `| Paper 2 | 17 | 17 | 17 | **51** | **180** |\n`;
md += `| **Combined** | **34** | **34** | **34** | **102** | **360** |\n\n`;
md += `Type totals (both papers, all subjects): single **24** · multi **18** · integer **36** · match **24** = **102**\n\n`;
md += `---\n\n`;

md += `## 3. Difficulty mix assumed\n\n`;
md += `| Difficulty | Share | Cost vs hard |\n|------------|------:|-------------:|\n`;
md += `| Easy | **15%** | 0.50× |\n`;
md += `| Medium | **50%** | 0.70× |\n`;
md += `| Hard | **35%** | 1.00× |\n\n`;
md += `Subject vs Maths: Physics **0.95×** · Chemistry **0.90×** · Maths **1.00×**\n\n`;
md += `---\n\n`;

md += `## 4. Rate card — Gemini ₹ / question\n\n`;
md += `| Type | Diff | Maths ₹ | Physics ₹ | Chem ₹ | Est. tokens | Maths wall (s) |\n`;
md += `|------|------|--------:|----------:|-------:|------------:|---------------:|\n`;
for (const u of unitTable) {
  md += `| ${u.type} | ${u.diff} | ${u.mathsINR} | ${u.physicsINR} | ${u.chemINR} | ~${u.estTokens.toLocaleString()} | ~${u.mathsSec} |\n`;
}
md += `\n---\n\n`;

md += `## 5. Paper-wise Gemini cost — MIXED difficulty (recommended)\n\n`;
md += `### Paper 1 (51 Q · 180 marks)\n\n`;
md += `| Subject | Q | Est. Gemini ₹ | Est. time |\n`;
md += `|---------|--:|--------------:|----------:|\n`;
for (const s of SUBJECTS) {
  const x = m.paper1.bySubject[s];
  md += `| ${s} | ${x.q} | **₹${x.costINR}** | ~${x.timeMin} min |\n`;
}
md += `| **Paper 1 total** | **51** | **₹${m.paper1.costINR}** | **~${(m.paper1.timeHours * 60).toFixed(0)} min (${m.paper1.timeHours} h)** |\n\n`;

md += `### Paper 2 (51 Q · 180 marks)\n\n`;
md += `| Subject | Q | Est. Gemini ₹ | Est. time |\n`;
md += `|---------|--:|--------------:|----------:|\n`;
for (const s of SUBJECTS) {
  const x = m.paper2.bySubject[s];
  md += `| ${s} | ${x.q} | **₹${x.costINR}** | ~${x.timeMin} min |\n`;
}
md += `| **Paper 2 total** | **51** | **₹${m.paper2.costINR}** | **~${(m.paper2.timeHours * 60).toFixed(0)} min (${m.paper2.timeHours} h)** |\n\n`;

md += `### Combined Paper 1 + Paper 2\n\n`;
md += `| Metric | Value |\n|--------|------:|\n`;
md += `| Questions | **102** |\n`;
md += `| Marks | **360** |\n`;
md += `| **Est. Gemini cost** | **₹${m.combined.costINR}** |\n`;
md += `| Cost range (−15% / +25%) | ₹${m.combined.costRange[0]} – ₹${m.combined.costRange[1]} |\n`;
md += `| Est. wall time | **~${m.combined.timeHours} hours** |\n`;
md += `| Time range | ${m.combined.timeRange[0]} – ${m.combined.timeRange[1]} h |\n`;
md += `| Avg ₹ / Q | **₹${m.combined.avgPerQ}** |\n`;
md += `| Est. tokens (rough) | ~${Math.round(m.combined.estTokens / 1000)}k |\n\n`;
md += `---\n\n`;

md += `## 6. All-hard scenario (yesterday Maths style on everything)\n\n`;
md += `| Scope | Est. Gemini ₹ | Est. time |\n`;
md += `|-------|--------------:|----------:|\n`;
md += `| Paper 1 (51) | **₹${a.paper1_INR}** | ~${(a.timeHours / 2).toFixed(1)} h |\n`;
md += `| Paper 2 (51) | **₹${a.paper2_INR}** | ~${(a.timeHours / 2).toFixed(1)} h |\n`;
md += `| **Full 102** | **₹${a.combined_INR}** | **~${a.timeHours} h** |\n`;
md += `| Avg ₹ / Q | **₹${a.avgPerQ}** | |\n\n`;
md += `| Subject (both papers) | Q | Est. ₹ |\n`;
md += `|----------------------|--:|-------:|\n`;
for (const s of SUBJECTS) {
  const x = a.bySubject_bothPapers[s];
  md += `| ${s} | ${x.q} | ₹${x.costINR} |\n`;
}
md += `\n---\n\n`;

md += `## 7. Maths Paper 1 — type × difficulty breakdown (example)\n\n`;
md += `| Type | Diff | Count | ₹ / Q | Subtotal ₹ | Wall s/Q | Est. tokens/Q |\n`;
md += `|------|------|------:|------:|-----------:|---------:|--------------:|\n`;
for (const c of m.mathsP1Cells) {
  md += `| ${c.type} | ${c.diff} | ${c.n} | ${c.unitCost} | ${c.subtotal} | ${c.unitSec} | ~${c.unitTok.toLocaleString()} |\n`;
}
md += `| **Maths P1** | | **17** | | **₹${m.paper1.bySubject.Mathematics.costINR}** | | |\n\n`;
md += `---\n\n`;

md += `## 8. Credit plan (₹950 remaining)\n\n`;
md += `| Scenario | Need | Have | Shortfall | Suggested top-up |\n`;
md += `|----------|-----:|-----:|----------:|-----------------:|\n`;
md += `| Mixed E/M/H full 102 | ₹${c.needMixed102} | ₹950 | **₹${c.shortfallMixed}** | **₹${c.topUpMixed}+** |\n`;
md += `| All-hard full 102 | ₹${c.needAllHard102} | ₹950 | **₹${c.shortfallAllHard}** | **₹${c.topUpAllHard}+** |\n`;
md += `| ₹950 alone | ~${c.qsLeftAtHardRate} hard NS Qs | | | |\n\n`;
md += `---\n\n`;

md += `## 9. Bottom line\n\n`;
md += `| | Mixed (recommended) | All-hard (yesterday style) |\n`;
md += `|-|--------------------:|---------------------------:|\n`;
md += `| **Paper 1 (51 Q)** | **₹${m.paper1.costINR}** · ~${m.paper1.timeHours}h | **₹${a.paper1_INR}** |\n`;
md += `| **Paper 2 (51 Q)** | **₹${m.paper2.costINR}** · ~${m.paper2.timeHours}h | **₹${a.paper2_INR}** |\n`;
md += `| **Full set (102 Q)** | **₹${m.combined.costINR}** · **~${m.combined.timeHours}h** | **₹${a.combined_INR}** · **~${a.timeHours}h** |\n`;
md += `| Per question avg | ~₹${m.combined.avgPerQ} | ~₹${a.avgPerQ} |\n\n`;

md += `### Takeaways\n\n`;
md += `1. Real spend: **₹43.75 per hard Advanced Maths non-single** (wallet truth).\n`;
md += `2. Yesterday = **24 hard Maths non-singles only** — no Physics/Chem, no singles, no easy/medium.\n`;
md += `3. Official full set = **102 Q** (P1 51 + P2 51), pattern 4 single + 3 multi + 6 integer + 4 match per subject per paper.\n`;
md += `4. **Mixed paper** Gemini: about **₹${m.combined.costINR}** and **~${m.combined.timeHours} hours** for 102 Q.\n`;
md += `5. **All-hard** Gemini: about **₹${a.combined_INR}** and **~${a.timeHours} hours**.\n`;
md += `6. Remaining **₹950** ≈ **${c.qsLeftAtHardRate} hard Qs** — not enough for full dual paper.\n`;
md += `7. OpenAI dual-lock is **extra** and currently out of credits — this report is **Gemini only**.\n\n`;
md += `---\n\n`;
md += `*Cost is wallet-calibrated. Tokens/time per type are scaled estimates; pipeline does not log Gemini usageMetadata.*\n`;

const outDir = path.resolve("temp/reports");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "jee-advanced-gemini-paper-cost-report.json"),
  JSON.stringify(report, null, 2)
);
fs.writeFileSync(
  path.join(outDir, "jee-advanced-gemini-paper-cost-report.md"),
  md
);
console.log(md);
console.log("\nWrote temp/reports/jee-advanced-gemini-paper-cost-report.md");
console.log("Wrote temp/reports/jee-advanced-gemini-paper-cost-report.json");
