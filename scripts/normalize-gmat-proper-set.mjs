import fs from "fs";
import path from "path";

const SRC = path.resolve("../GMAT EXAM");
const OUT = path.resolve("files/gmat-competitive-papers");

const S = {
  quant: "Quantitative Reasoning",
  verbal: "Verbal Reasoning",
  di: "Data Insights",
};

const Q = {
  integers: "Integers",
  factors: "Factors and multiples",
  parity: "Odd and even numbers",
  primes: "Prime numbers",
  fractions: "Fractions",
  decimals: "Decimals",
  percent: "Percentages",
  pctChange: "Percentage change",
  ratios: "Ratios",
  proportions: "Proportions",
  exponents: "Exponents",
  roots: "Roots",
  linear: "Linear equations",
  quadratic: "Quadratic equations",
  simultaneous: "Simultaneous equations",
  inequalities: "Linear inequalities",
  functions: "Basic functions",
  work: "Work rate",
  combined: "Combined work",
  avgSpeed: "Average speed",
  distance: "Distance-time problems",
  pl: "Profit and loss",
  si: "Simple interest",
  ci: "Compound interest",
  average: "Weighted average",
  mixtures: "Mixtures",
  arithmetic: "Arithmetic reasoning",
};

const V = {
  main: "Main idea",
  support: "Supporting idea",
  inference: "Inference",
  application: "Application",
  organization: "Organization of ideas",
  tone: "Tone",
  purpose: "Purpose",
  conclusion: "Identify conclusion",
  assumption: "Identify assumptions",
  strengthen: "Strengthen an argument",
  weaken: "Weaken an argument",
  evaluate: "Evaluate an argument",
  draw: "Draw conclusions",
  flaws: "Identify flaws",
  complete: "Complete an argument",
};

const D = {
  ds: "Data Sufficiency",
  msr: "Multi-Source Reasoning",
  table: "Table Analysis",
  graphics: "Graphics Interpretation",
  tpa: "Two-Part Analysis",
};

const ALLOWED = {
  [S.quant]: new Set(Object.values(Q)),
  [S.verbal]: new Set(Object.values(V)),
  [S.di]: new Set(Object.values(D)),
};

const LIMITS = { [S.quant]: 21, [S.verbal]: 23, [S.di]: 20 };

const DS_OPTIONS = {
  A: "Statement (1) ALONE is sufficient, but statement (2) alone is not sufficient.",
  B: "Statement (2) ALONE is sufficient, but statement (1) alone is not sufficient.",
  C: "BOTH statements TOGETHER are sufficient, but NEITHER statement ALONE is sufficient.",
  D: "EACH statement ALONE is sufficient.",
  E: "Statements (1) and (2) TOGETHER are NOT sufficient.",
};

const rule = (re, topic) => ({ re: new RegExp(re, "i"), topic });

const QUANT_RULES = [
  rule("standard deviation|mean|median|average of|arithmetic progression|sequence", Q.average),
  rule("compound interest|compounded annually", Q.ci),
  rule("simple interest", Q.si),
  rule("profit|loss|discount|wholesale|retailer|sold .* percent", Q.pl),
  rule("mixture|alligation|milk|alcohol|tea.*mix|concentration", Q.mixtures),
  rule("average speed|harmonic|round trip|returns at", Q.avgSpeed),
  rule("mph|miles per hour|distance|train travels|freight train", Q.distance),
  rule("machine .* (widgets|batch)|work together|combined rate|can do a work|pipe", Q.combined),
  rule("widgets per hour|work rate", Q.work),
  rule("f\\(x\\)|function", Q.functions),
  rule("inequalit|must be true|a < b|absolute value \\|", Q.inequalities),
  rule("\\|2x|\\|x", Q.inequalities),
  rule("quadratic|x\\^2|roots", Q.quadratic),
  rule("simultaneous|two equations|system of", Q.simultaneous),
  rule("linear equation|solve for|how old|current ages", Q.linear),
  rule("units digit|exponent|3\\^|4\\^|2\\^|7\\^|power of|remainder when", Q.exponents),
  rule("square root|cube root|radical", Q.roots),
  rule("ratio of|in the ratio", Q.ratios),
  rule("proportion|directly proportional", Q.proportions),
  rule("percent change|percentage increase|percentage decrease", Q.pctChange),
  rule("percent|percentage", Q.percent),
  rule("1/2 \\+|fraction|decimal", Q.fractions),
  rule("prime", Q.primes),
  rule("odd|even|parity", Q.parity),
  rule("factor|multiple|divisible|greatest common|gcd|trailing zeros", Q.factors),
  rule("probability|committee|how many (distinct )?ways|subsets|diagonals|surface area|cone|cylinder|triangle|rectangle|polygon|neither .* nor", Q.arithmetic),
  rule("integer|positive integer", Q.integers),
];

const VERBAL_RULES = [
  rule("strengthen", V.strengthen),
  rule("weaken", V.weaken),
  rule("assumption|assumes", V.assumption),
  rule("boldface|primary purpose|author.?s purpose|primarily in order to|serves mainly|primarily serves", V.purpose),
  rule("tone|attitude", V.tone),
  rule("complete the passage|which of the following most logically completes", V.complete),
  rule("flaw|vulnerable to criticism|logical error", V.flaws),
  rule("must be true|inferred|infer|implies|suggests that|most closely means", V.inference),
  rule("main idea|primary objective|central thesis|primarily concerned|best summarizes|primary focus", V.main),
  rule("organization|structure of the passage|relationship between", V.organization),
  rule("according to the passage|based on the passage|supporting", V.support),
  rule("conclusion of the argument|main conclusion", V.conclusion),
  rule("evaluate the argument|which would be most useful|plan to|proposed|intends to", V.evaluate),
  rule("if true.*plan|course of action", V.application),
];

const DI_TYPE_RULES = [
  rule("data.?sufficiency", D.ds),
  rule("multi.?source|scenario_", D.msr),
  rule("table", D.table),
  rule("graph|graphics", D.graphics),
  rule("two.?part", D.tpa),
];

const FALLBACK = {
  [S.quant]: Q.arithmetic,
  [S.verbal]: V.inference,
  [S.di]: D.ds,
};

const FILES = [
  { src: "GMAT_Paper_1_structured.json", n: 1 },
  { src: "GMAT_Paper_2.json", n: 2 },
  { src: "GMAT_Paper_3.json", n: 3 },
  { src: "GMAT_Paper_4.json", n: 4 },
  { src: "GMAT_Paper_5_structured.json", n: 5 },
];

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("quant")) return S.quant;
  if (key.includes("verbal") || key.includes("critical") || key.includes("reading")) {
    return S.verbal;
  }
  if (key.includes("data") || key.includes("insight")) return S.di;
  return "";
};

const pickTopic = (section, type, stem) => {
  const rules =
    section === S.quant
      ? QUANT_RULES
      : section === S.verbal
        ? VERBAL_RULES
        : DI_TYPE_RULES;
  if (section === S.di) {
    for (const item of DI_TYPE_RULES) {
      if (item.re.test(type) || item.re.test(stem)) {
        return { topic: item.topic, matched: true };
      }
    }
    if (/statement \(1\)|statement_1|alone is sufficient/i.test(stem)) {
      return { topic: D.ds, matched: true };
    }
    return { topic: FALLBACK[section], matched: false };
  }
  for (const item of rules) {
    if (item.re.test(stem) || item.re.test(type)) {
      return { topic: item.topic, matched: true };
    }
  }
  return { topic: FALLBACK[section], matched: false };
};

const normalizeOptions = (item) => {
  const raw = item.options || {};
  const next = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [String(k).toUpperCase(), String(v ?? "").trim()])
  );
  if (!Object.keys(next).length && (item.statement_1 || item.statement1)) {
    return { ...DS_OPTIONS };
  }
  return next;
};

const buildQuestionText = (item) => {
  let text = String(item.question || item.question_text || item.questionText || "").trim();
  const s1 = item.statement_1 || item.statement1;
  const s2 = item.statement_2 || item.statement2;
  if (s1 || s2) {
    text += `\n\n(1) ${String(s1 || "").trim()}\n(2) ${String(s2 || "").trim()}`;
  }
  return text;
};

const pushQ = (grouped, section, type, item, passage) => {
  if (!grouped[section]) return;
  const question = buildQuestionText(item);
  if (!question) return;
  grouped[section].push({
    type: String(type || item.type || "").trim(),
    passage: String(passage || item.passage || item.passage_text || "").trim(),
    question,
    options: normalizeOptions(item),
    correct: String(item.correct_option || item.correct_answer || item.correct || "A")
      .toUpperCase()
      .trim()
      .charAt(0),
    explanation: String(item.explanation || "").trim(),
  });
};

const walkBlock = (node, section, type, passage, grouped) => {
  if (!node || typeof node !== "object") return;
  const nextPassage = node.passage || node.passage_text || passage;
  if (Array.isArray(node.passages)) {
    for (const p of node.passages) {
      const ptext = p.passage_text || p.passage || nextPassage;
      for (const q of p.questions || []) pushQ(grouped, section, type || "Reading Comprehension", q, ptext);
    }
  }
  if (Array.isArray(node.questions)) {
    for (const q of node.questions) {
      if (Array.isArray(q.questions)) {
        const ptext = q.passage || q.passage_text || nextPassage;
        for (const iq of q.questions) {
          pushQ(grouped, section, type || q.type || "", iq, ptext);
        }
      } else {
        pushQ(grouped, section, type || q.type || "", q, nextPassage);
      }
    }
  }
  for (const [ck, cv] of Object.entries(node)) {
    if (["questions", "passages", "passage", "passage_text", "options", "directions"].includes(ck)) {
      continue;
    }
    if (cv && typeof cv === "object" && !Array.isArray(cv)) {
      walkBlock(cv, section, type || ck, nextPassage, grouped);
    }
  }
};

const collectFromRaw = (raw) => {
  const grouped = { [S.quant]: [], [S.verbal]: [], [S.di]: [] };

  if (Array.isArray(raw.sections)) {
    for (const sec of raw.sections) {
      const section = normalizeSection(sec.section || sec.section_name || sec.name);
      walkBlock(sec, section, "", "", grouped);
    }
  }

  if (raw.sections && !Array.isArray(raw.sections) && typeof raw.sections === "object") {
    for (const [key, block] of Object.entries(raw.sections)) {
      const section = normalizeSection(block.section_name || key);
      walkBlock(block, section, "", "", grouped);
    }
  }

  for (const [key, label] of Object.entries({
    quantitative_reasoning: S.quant,
    verbal_reasoning: S.verbal,
    data_insights: S.di,
    critical_reasoning: S.verbal,
  })) {
    if (raw[key]) walkBlock(raw[key], label, key === "critical_reasoning" ? "Critical Reasoning" : "", "", grouped);
  }

  return grouped;
};

fs.mkdirSync(OUT, { recursive: true });
const fallbacks = [];

for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectFromRaw(raw);
  const subjects = {};

  for (const section of Object.values(S)) {
    const items = (grouped[section] || []).slice(0, LIMITS[section]);
    if (items.length !== LIMITS[section]) {
      throw new Error(
        `${spec.src} ${section} has ${items.length}, expected ${LIMITS[section]}`
      );
    }
    subjects[section] = items.map((item, index) => {
      const q = index + 1;
      const hay = `${item.question}\n${item.explanation}\n${item.type}`;
      const { topic, matched } = pickTopic(section, item.type, hay);
      if (!ALLOWED[section].has(topic)) {
        throw new Error(`${spec.src} ${section} Q${q} invalid topic ${topic}`);
      }
      if (!matched) {
        fallbacks.push({
          paper: spec.n,
          section,
          q,
          type: item.type,
          stem: item.question.replace(/\s+/g, " ").slice(0, 130),
        });
      }
      const next = {
        q,
        topic,
        question: item.question,
        options: item.options,
        correct: item.correct,
        explanation: item.explanation,
      };
      if (item.passage) next.passage = item.passage;
      if (item.type) next.type = item.type;
      return next;
    });
  }

  const paper = {
    paper_id: `GMAT-Paper${spec.n}`,
    title: `GMAT Paper ${spec.n}`,
    exam: "GMAT",
    year: 2026,
    subjects,
  };
  const outName = `GMAT-Paper${spec.n}.json`;
  fs.writeFileSync(path.join(OUT, outName), `${JSON.stringify(paper, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${outName}`,
    Object.fromEntries(Object.entries(subjects).map(([k, v]) => [k, v.length]))
  );
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# GMAT Focus question papers

Add more papers here as \`.json\` files, then run:

\`\`\`bash
cd firstedu-backend
npm run seed:gmat
\`\`\`

The seed script reads every \`.json\` file in this folder and upserts them into:

- \`gmatcompetitivepapers\`
- \`gmatcompetitivequestions\`

## JSON format

\`\`\`json
{
  "paper_id": "GMAT-Paper6",
  "title": "GMAT Paper 6",
  "subjects": {
    "Quantitative Reasoning": [
      {
        "q": 1,
        "topic": "Ratios",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "", "E": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Verbal Reasoning": [],
    "Data Insights": []
  }
}
\`\`\`

Topics must match official GMAT Focus 2026 syllabus topics
(source: \`GMAT EXAM/GMAT_2026_Syllabus.json\`).
`
);

console.log(JSON.stringify({ fallbackCount: fallbacks.length }, null, 2));
if (fallbacks.length) {
  console.log("\nFALLBACKS:");
  for (const row of fallbacks) {
    console.log(`[P${row.paper} ${row.section} Q${row.q} ${row.type}] ${row.stem}`);
  }
}
