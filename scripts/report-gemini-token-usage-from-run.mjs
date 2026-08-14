/**
 * Build Gemini-only token/time/cost report from a hard-maths run folder.
 *
 * Actual usageMetadata is not logged in pipeline — tokens/cost are ESTIMATED;
 * wall times for phases are MEASURED from phases.jsonl.
 *
 *   node scripts/report-gemini-token-usage-from-run.mjs [runDir]
 */
import fs from "fs";
import path from "path";

const runDir =
  process.argv[2] ||
  "temp/jee-advanced-hard-6-nonsingle-maths/2026-08-04_11-40-37";

const abs = path.resolve(runDir);
const phases = fs
  .readFileSync(path.join(abs, "phases.jsonl"), "utf8")
  .trim()
  .split(/\n/)
  .map((l) => JSON.parse(l));
const qs = JSON.parse(fs.readFileSync(path.join(abs, "questions.json"), "utf8"));
const summary = JSON.parse(
  fs.readFileSync(path.join(abs, "summary.json"), "utf8")
);

// Gemini Flash paid-tier proxy rates (gemini-3.5-flash not itemized in logs)
const IN_PER_M = 0.3; // USD / 1M input tokens
const OUT_PER_M = 2.5; // USD / 1M output tokens (incl. thinking proxy)

const charsToTok = (c) => Math.ceil(Number(c || 0) / 4);
const cost = (inTok, outTok) => (inTok / 1e6) * IN_PER_M + (outTok / 1e6) * OUT_PER_M;
const atMs = (p) => (p ? new Date(p.at).getTime() : null);
const findStep = (pred) => phases.find(pred);

// Estimated prompt pack sizes (chars) for hard Advanced writer
const EST_IN = {
  plan: 12000,
  multi: 35000,
  integer: 30000,
  match: 28000,
  expand: 12000,
  solverB: 8000,
};

const qRows = qs.map((q, i) => {
  const text = String(q.questionText || "");
  const exp = String(q.explanation || "");
  const opts = JSON.stringify(q.options || []);
  const insight = String(q._insight || "");
  const steps = JSON.stringify(q._solveSteps || []);
  const outChars = text.length + exp.length + opts.length + insight.length + steps.length;
  return {
    q: i + 1,
    type: q.questionType,
    chapter: q.chapter || q._chapter || "",
    topicId: q.topicId || q._topicId || "",
    slot: q._conceptSlot || "",
    lock: q._lockMode || "",
    trust: q._trustBadge || "",
    textChars: text.length,
    expChars: exp.length,
    outChars,
    outTok: charsToTok(outChars),
  };
});

const expandStarts = phases.filter(
  (p) => p.message && String(p.message).startsWith("Expand Q")
);
const phase4end = findStep((p) => p.type === "phase_end" && p.id === "4");
const expandTimes = [];
for (let i = 0; i < expandStarts.length; i++) {
  const a = atMs(expandStarts[i]);
  const b =
    i + 1 < expandStarts.length
      ? atMs(expandStarts[i + 1])
      : atMs(phase4end);
  expandTimes.push((b - a) / 1000);
}

const planStart = findStep((p) => p.type === "phase_start" && p.id === "1");
const planEnd = findStep((p) => p.type === "phase_end" && p.id === "1");
const fillStart = findStep(
  (p) => p.message && String(p.message).includes("Fill 1/4")
);
const multiFail = findStep(
  (p) => p.message && String(p.message).includes("multi attempt 1 failed")
);
const multiRaw = findStep(
  (p) => p.message && String(p.message).includes("multi: raw=3")
);
const multiDone = findStep(
  (p) => p.message && String(p.message).includes("multi: locked kept")
);
const intRaw = findStep(
  (p) => p.message && String(p.message).includes("integer: raw")
);
const intDone = findStep(
  (p) => p.message && String(p.message).includes("integer: kept")
);
const matchRaw = findStep(
  (p) => p.message && String(p.message).includes("match: raw")
);
const matchDone = findStep(
  (p) => p.message && String(p.message).includes("match: kept")
);

const multiGenOutTok = Math.ceil(
  qRows.slice(0, 3).reduce((s, r) => s + r.outTok * 0.45, 0)
);
const intGenOutTok = Math.ceil(
  qRows.slice(3, 5).reduce((s, r) => s + r.outTok * 0.5, 0)
);
const matchGenOutTok = Math.ceil(qRows[5].outTok * 0.45);

const geminiPhases = [
  {
    name: "Plan HIGH slots",
    calls: 1,
    wallSec: (atMs(planEnd) - atMs(planStart)) / 1000,
    inTok: charsToTok(EST_IN.plan),
    outTok: 800,
    shared: true,
  },
  {
    name: "Multi gen attempt 1 (FAILED JSON)",
    calls: 1,
    wallSec: (atMs(multiFail) - atMs(fillStart)) / 1000,
    inTok: charsToTok(EST_IN.multi),
    outTok: 4500,
    shared: true,
    waste: true,
  },
  {
    name: "Multi gen attempt 2 (OK → Q1–Q3)",
    calls: 1,
    wallSec: (atMs(multiRaw) - atMs(multiFail)) / 1000,
    inTok: charsToTok(EST_IN.multi),
    outTok: multiGenOutTok,
    shared: true,
  },
  {
    name: "Integer gen (→ Q4–Q5)",
    calls: 1,
    wallSec: (atMs(intRaw) - atMs(multiDone)) / 1000,
    inTok: charsToTok(EST_IN.integer),
    outTok: intGenOutTok,
    shared: true,
  },
  {
    name: "Match gen (→ Q6)",
    calls: 1,
    wallSec: (atMs(matchRaw) - atMs(intDone)) / 1000,
    inTok: charsToTok(EST_IN.match),
    outTok: matchGenOutTok,
    shared: true,
  },
  {
    name: "Gemini solver-B (Q6 only)",
    calls: 1,
    // half of lock window attributed to Gemini B (rest OpenAI A)
    wallSec: ((atMs(matchDone) - atMs(matchRaw)) / 1000) * 0.5,
    inTok: charsToTok(EST_IN.solverB),
    outTok: 600,
    shared: false,
    q: 6,
  },
];

for (let i = 0; i < qRows.length; i++) {
  geminiPhases.push({
    name: `Insight expand Q${i + 1}`,
    calls: 1,
    wallSec: expandTimes[i] ?? 0,
    inTok:
      charsToTok(EST_IN.expand) +
      Math.ceil(qRows[i].textChars / 4) +
      400,
    outTok: Math.ceil(qRows[i].expChars / 4),
    shared: false,
    q: i + 1,
  });
}

const phaseRows = geminiPhases.map((p) => ({
  ...p,
  wallSec: Math.round(p.wallSec * 10) / 10,
  costUsd: cost(p.inTok, p.outTok),
}));

const phaseTotals = phaseRows.reduce(
  (a, p) => ({
    calls: a.calls + p.calls,
    in: a.in + p.inTok,
    out: a.out + p.outTok,
    wall: a.wall + p.wallSec,
    cost: a.cost + p.costUsd,
  }),
  { calls: 0, in: 0, out: 0, wall: 0, cost: 0 }
);

const perQ = qRows.map((r, i) => {
  let inTok = 0;
  let outTok = 0;
  let wall = 0;

  // plan share
  inTok += phaseRows[0].inTok / 6;
  outTok += phaseRows[0].outTok / 6;
  wall += phaseRows[0].wallSec / 6;

  if (i < 3) {
    inTok += (phaseRows[1].inTok + phaseRows[2].inTok) / 3;
    outTok += (phaseRows[1].outTok + phaseRows[2].outTok) / 3;
    wall += (phaseRows[1].wallSec + phaseRows[2].wallSec) / 3;
  } else if (i < 5) {
    inTok += phaseRows[3].inTok / 2;
    outTok += phaseRows[3].outTok / 2;
    wall += phaseRows[3].wallSec / 2;
  } else {
    inTok += phaseRows[4].inTok + phaseRows[5].inTok;
    outTok += phaseRows[4].outTok + phaseRows[5].outTok;
    wall += phaseRows[4].wallSec + phaseRows[5].wallSec;
  }

  const exp = phaseRows[6 + i];
  inTok += exp.inTok;
  outTok += exp.outTok;
  wall += exp.wallSec;

  inTok = Math.round(inTok);
  outTok = Math.round(outTok);
  return {
    ...r,
    expandWallSec: Math.round((expandTimes[i] || 0) * 10) / 10,
    geminiInTok: inTok,
    geminiOutTok: outTok,
    geminiTotalTok: inTok + outTok,
    geminiWallSec: Math.round(wall * 10) / 10,
    geminiCostUsd: cost(inTok, outTok),
  };
});

const sum = perQ.reduce(
  (a, r) => ({
    in: a.in + r.geminiInTok,
    out: a.out + r.geminiOutTok,
    total: a.total + r.geminiTotalTok,
    wall: a.wall + r.geminiWallSec,
    cost: a.cost + r.geminiCostUsd,
  }),
  { in: 0, out: 0, total: 0, wall: 0, cost: 0 }
);

const report = {
  meta: {
    reportDate: "2026-08-05",
    runDate: "2026-08-04",
    selectedRun: path.basename(abs),
    reasonSelected:
      "Best yesterday maths run: 6/6 dual-locked, insight-first solutions expanded, trust grades present, writer=gemini-3.5-flash",
    outDir: abs,
    model: summary.models?.writer || "gemini-3.5-flash",
    totalWallClockSec: Math.round(summary.elapsedMs / 1000),
    produced: summary.produced,
    pricingAssumptions: {
      model: "gemini-3.5-flash (priced as Gemini Flash paid tier proxy)",
      inputUsdPer1M: IN_PER_M,
      outputUsdPer1M: OUT_PER_M,
      note: "Official usageMetadata was NOT logged. Tokens/cost ESTIMATED; phase wall times MEASURED from phases.jsonl.",
    },
    otherRunsYesterday: [
      { id: "2026-08-04_08-53-33", elapsedSec: 348, dual: 6, note: "dual A+B, no insight expand" },
      { id: "2026-08-04_10-08-11", elapsedSec: 232, dual: 6, note: "single solver only, fastest" },
      { id: "2026-08-04_10-40-45", elapsedSec: 882, dual: 6, note: "single solver, slower gen" },
    ],
  },
  geminiCallPhases: phaseRows,
  perQuestion: perQ,
  totalsFromPerQuestionAttribution: {
    geminiInputTokens: sum.in,
    geminiOutputTokens: sum.out,
    geminiTotalTokens: sum.total,
    attributedWallSec: Math.round(sum.wall * 10) / 10,
    estimatedCostUsd: sum.cost,
    avgCostPerQuestionUsd: sum.cost / perQ.length,
    avgTokensPerQuestion: Math.round(sum.total / perQ.length),
  },
  totalsFromCallPhases: {
    geminiCalls: phaseTotals.calls,
    geminiInputTokens: phaseTotals.in,
    geminiOutputTokens: phaseTotals.out,
    geminiTotalTokens: phaseTotals.in + phaseTotals.out,
    measuredGeminiWallSec: Math.round(phaseTotals.wall * 10) / 10,
    estimatedCostUsd: phaseTotals.cost,
  },
};

const outDir = path.resolve("temp/reports");
fs.mkdirSync(outDir, { recursive: true });
const base = "gemini-token-usage-2026-08-04-best-maths";
fs.writeFileSync(
  path.join(outDir, `${base}.json`),
  JSON.stringify(report, null, 2)
);

const fullMin = (summary.elapsedMs / 60000).toFixed(1);
const gemMin = (phaseTotals.wall / 60).toFixed(1);

let md = "";
md += `# Gemini Token Usage Report — JEE Advanced Maths (Best Run Yesterday)\n\n`;
md += `**Run:** \`${path.basename(abs)}\`  \n`;
md += `**Path:** \`${runDir}\`  \n`;
md += `**Writer model:** \`${summary.models?.writer || "gemini-3.5-flash"}\`  \n`;
md += `**Produced:** 6 questions (3 multi + 2 integer + 1 match), dual-locked + insight expanded  \n`;
md += `**Total wall clock (full pipeline):** ${Math.round(summary.elapsedMs / 1000)}s (~${fullMin} min)  \n`;
md += `**Report generated:** 2026-08-05\n\n`;
md += `---\n\n`;
md += `## Important caveat\n\n`;
md += `This pipeline **does not persist Gemini \`usageMetadata\`** (\`promptTokenCount\` / \`candidatesTokenCount\`).\n\n`;
md += `| Field | Source |\n`;
md += `|-------|--------|\n`;
md += `| Time (generation / expand phases) | **Measured** from \`phases.jsonl\` |\n`;
md += `| Tokens | **Estimated** (output ≈ content chars÷4; input ≈ hard-writer prompt pack size) |\n`;
md += `| Cost USD | **Estimated** using Flash paid proxy: **$${IN_PER_M}/1M input**, **$${OUT_PER_M}/1M output** |\n`;
md += `| OpenAI dual-lock | **Excluded** (Gemini only) |\n\n`;
md += `---\n\n`;
md += `## Why this run is "best" among yesterday\n\n`;
md += `| Run | Wall | Dual locked | Insight expand | Notes |\n`;
md += `|-----|------|-------------|----------------|-------|\n`;
md += `| 08-53-33 | 348s | 6 | no | dual A+B |\n`;
md += `| 10-08-11 | 232s | 6 | no | fastest; solver B off |\n`;
md += `| 10-40-45 | 882s | 6 | no | solver B off |\n`;
md += `| **11-40-37** | **1069s** | **6** | **yes (6)** | **selected — trust grades + insight solutions** |\n\n`;
md += `---\n\n`;
md += `## Gemini call phases (measured time + estimated tokens)\n\n`;
md += `| Phase | Calls | Wall (s) | Est. input tok | Est. output tok | Est. cost USD |\n`;
md += `|-------|------:|---------:|---------------:|----------------:|--------------:|\n`;
for (const p of phaseRows) {
  md += `| ${p.name} | ${p.calls} | ${p.wallSec.toFixed(1)} | ${p.inTok} | ${p.outTok} | $${p.costUsd.toFixed(5)} |\n`;
}
md += `| **TOTAL (Gemini only)** | **${phaseTotals.calls}** | **${phaseTotals.wall.toFixed(1)}** | **${phaseTotals.in}** | **${phaseTotals.out}** | **$${phaseTotals.cost.toFixed(5)}** |\n\n`;
md += `---\n\n`;
md += `## Per-question Gemini usage (shared batch cost attributed)\n\n`;
md += `| Q | Type | Topic | Trust | Gemini wall (s)* | Est. in tok | Est. out tok | Est. total tok | Est. cost USD |\n`;
md += `|--:|------|-------|-------|-----------------:|------------:|-------------:|---------------:|--------------:|\n`;
for (const r of perQ) {
  const topic = `${r.topicId} ${String(r.chapter).slice(0, 36)}`.trim();
  md += `| ${r.q} | ${r.type} | ${topic} | ${r.trust} | ${r.geminiWallSec} | ${r.geminiInTok} | ${r.geminiOutTok} | ${r.geminiTotalTok} | $${r.geminiCostUsd.toFixed(5)} |\n`;
}
md += `| **AVG** | | | | **${(sum.wall / 6).toFixed(1)}** | **${Math.round(sum.in / 6)}** | **${Math.round(sum.out / 6)}** | **${Math.round(sum.total / 6)}** | **$${(sum.cost / 6).toFixed(5)}** |\n`;
md += `| **SUM** | | | | **${sum.wall.toFixed(1)}** | **${sum.in}** | **${sum.out}** | **${sum.total}** | **$${sum.cost.toFixed(5)}** |\n\n`;
md += `\\*Wall = attributed share of batch generation + measured insight-expand. OpenAI lock time excluded.\n\n`;
md += `### Insight-expand only (pure measured Gemini wall per question)\n\n`;
md += `| Q | Expand wall (s) | Est. expand out tok (from explanation chars) |\n`;
md += `|--:|----------------:|---------------------------------------------:|\n`;
for (let i = 0; i < 6; i++) {
  md += `| ${i + 1} | ${(expandTimes[i] || 0).toFixed(1)} | ${Math.ceil(qRows[i].expChars / 4)} |\n`;
}
md += `\n---\n\n`;
md += `## Summary (Gemini only)\n\n`;
md += `| Metric | Value |\n`;
md += `|--------|------:|\n`;
md += `| Gemini API calls (est.) | ${phaseTotals.calls} |\n`;
md += `| Measured Gemini-related wall | ~${phaseTotals.wall.toFixed(0)}s (~${gemMin} min) |\n`;
md += `| Full pipeline wall (incl OpenAI) | ${Math.round(summary.elapsedMs / 1000)}s (~${fullMin} min) |\n`;
md += `| Est. total Gemini tokens | ~${(phaseTotals.in + phaseTotals.out).toLocaleString()} |\n`;
md += `| Est. total Gemini cost | ~$${phaseTotals.cost.toFixed(4)} |\n`;
md += `| Est. cost per question | ~$${(phaseTotals.cost / 6).toFixed(4)} |\n`;
md += `| Est. tokens per question | ~${Math.round((phaseTotals.in + phaseTotals.out) / 6)} |\n\n`;
md += `---\n\n`;
md += `## Notes / waste\n\n`;
md += `- Multi generation **attempt 1 failed** (JSON escape) after **~129s** — wasted Gemini tokens/time.\n`;
md += `- Batch generation: 1 Gemini call → 3 multi Qs; 1 → 2 integers; 1 → 1 match. Per-Q tokens are **attributed**, not separate billed calls.\n`;
md += `- Q6 used **A+gemini-B** (Gemini as secondary solver) plus writer + expand.\n`;
md += `- For **exact** tokens next run: log \`usageMetadata.promptTokenCount\`, \`candidatesTokenCount\`, \`totalTokenCount\` on every Gemini \`generateContent\` call.\n`;

fs.writeFileSync(path.join(outDir, `${base}.md`), md);
console.log(md);
console.log(`\nWrote: temp/reports/${base}.md`);
console.log(`Wrote: temp/reports/${base}.json`);
