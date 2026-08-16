import fs from "fs";
import path from "path";
import {
  collectSectioned,
  matchRules,
  rule,
  writePaper,
} from "./lib/extract-exam-questions.mjs";

const SRC = path.resolve("../SSC _CGL_tier_1");
const OUT = path.resolve("files/ssc-cgl-tier1-competitive-papers");

const S = {
  reason: "General Intelligence and Reasoning",
  ga: "General Awareness",
  quant: "Quantitative Aptitude",
  eng: "English Comprehension",
};

const R = {
  analogy: "Analogy",
  classification: "Classification",
  series: "Series",
  coding: "Coding and Decoding",
  problem: "Problem Solving",
  spatial: "Spatial and Visual Reasoning",
  venn: "Venn Diagrams",
  nonverbal: "Non-Verbal Reasoning",
  ops: "Numerical and Symbolic Operations",
  relation: "Relationship Concepts",
};
const G = {
  current: "Current Affairs",
  history: "History",
  culture: "Culture",
  geo: "Geography",
  economy: "Economic Scene",
  polity: "General Polity",
  science: "Scientific Research",
};
const Q = {
  number: "Number Systems",
  percent: "Percentages",
  ratio: "Ratio and proportion",
  average: "Averages",
  interest: "Interest",
  pl: "Profit and loss",
  mixture: "Mixture and allegation",
  tsd: "Time and distance",
  work: "Time and work",
  algebra: "Algebra",
  geometry: "Geometry",
  mensuration: "Mensuration",
  trigo: "Trigonometry",
  stats: "Statistics and Probability",
};
const E = {
  grammar: "Grammar",
  vocab: "Vocabulary",
  spelling: "Spelling",
  fillers: "Fillers",
  rc: "Reading Comprehension",
  cloze: "Cloze Test",
  arrange: "Sentence Arrangement",
};

const ALLOWED = {
  [S.reason]: new Set(Object.values(R)),
  [S.ga]: new Set(Object.values(G)),
  [S.quant]: new Set(Object.values(Q)),
  [S.eng]: new Set(Object.values(E)),
};
const LIMITS = { [S.reason]: 25, [S.ga]: 25, [S.quant]: 25, [S.eng]: 25 };
const FALLBACK = { [S.reason]: R.problem, [S.ga]: G.current, [S.quant]: Q.percent, [S.eng]: E.grammar };

const RULES = {
  [S.reason]: [
    rule("analog|related to the third|same way as", R.analogy),
    rule("odd one|different|classification|three of the following", R.classification),
    rule("series|question mark", R.series),
    rule("code language|coded as|written as", R.coding),
    rule("venn|diagram", R.venn),
    rule("mirror|water image|embedded|paper fold|figure", R.nonverbal),
    rule("mathematical signs|replace the \\*", R.ops),
    rule("dictionary|blood relation|family", R.relation),
    rule("direction|ranking|puzzle|seating", R.problem),
  ],
  [S.ga]: [
    rule("constitution|article|parliament|president|supreme court|panchayat", G.polity),
    rule("gdp|rbi|budget|inflation|gst|economy|bank", G.economy),
    rule("river|mountain|plateau|climate|soil|latitude|capital of", G.geo),
    rule("vedic|mughal|gupta|revolt|gandhi|congress|harappa|temple", G.history),
    rule("dance|festival|paint|literature|unesco", G.culture),
    rule("physics|chemistry|biology|vitamin|planet|acid|cell", G.science),
    rule("award|sport|scheme|appointed|current|2023|2024|2025|2026", G.current),
  ],
  [S.quant]: [
    rule("sin|cos|tan|height and distance|trigono", Q.trigo),
    rule("area|volume|cylinder|cone|sphere|prism|mensur", Q.mensuration),
    rule("triangle|circle|chord|tangent|similar", Q.geometry),
    rule("x \\+|identit|surd|algebra", Q.algebra),
    rule("mean|median|mode|probability|histogram|pie chart", Q.stats),
    rule("compound interest|simple interest|rate of interest", Q.interest),
    rule("profit|loss|discount|marked", Q.pl),
    rule("mixture|allegation|milk", Q.mixture),
    rule("time and work|days to complete|pipe", Q.work),
    rule("speed|distance|train|boat", Q.tsd),
    rule("ratio|proportion", Q.ratio),
    rule("average", Q.average),
    rule("percent", Q.percent),
    rule("fraction|decimal|hcf|lcm|divisib", Q.number),
  ],
  [S.eng]: [
    rule("passage|according to the passage|comprehension", E.rc),
    rule("cloze|blank in the passage", E.cloze),
    rule("synonym|antonym|idiom|one.?word|meaning of", E.vocab),
    rule("spelt|spelling", E.spelling),
    rule("rearrang|jumble|proper sequence", E.arrange),
    rule("fill in the blank|filler", E.fillers),
    rule("error|improve the sentence|correct usage", E.grammar),
  ],
};

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("reason") || key.includes("intelligence")) return S.reason;
  if (key.includes("awareness")) return S.ga;
  if (key.includes("quant")) return S.quant;
  if (key.includes("english")) return S.eng;
  return "";
};

const FILES = [
  { src: "ssc_cgl_tier1_paper1.json", n: 1 },
  { src: "SSC_CGL_Tier_1_Paper_2.json", n: 2 },
  { src: "SSC_CGL_Tier_1_Paper_3.json", n: 3 },
  { src: "SSC_CGL_Tier_1_Paper_4.json", n: 4 },
  { src: "ssc_cgl_tier1_paper5.json", n: 5 },
];

fs.mkdirSync(OUT, { recursive: true });
for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectSectioned(raw, normalizeSection);
  const subjects = {};
  for (const section of Object.values(S)) {
    const items = (grouped[section] || []).slice(0, LIMITS[section]);
    if (items.length !== LIMITS[section]) {
      throw new Error(`${spec.src} ${section} has ${items.length}`);
    }
    subjects[section] = items.map((item, i) => {
      const { topic } = matchRules(
        `${item.question}\n${item.explanation}\n${item.type}`,
        RULES[section],
        FALLBACK[section]
      );
      if (!ALLOWED[section].has(topic)) throw new Error(`bad topic ${topic}`);
      const next = {
        q: i + 1,
        topic,
        question: item.question,
        options: item.options,
        correct: item.correct,
        explanation: item.explanation,
      };
      if (item.passage) next.passage = item.passage;
      return next;
    });
  }
  writePaper(fs, path, OUT, `SSC-CGL-T1-Paper${spec.n}`, `SSC CGL Tier 1 Paper ${spec.n}`, "SSC CGL Tier 1", 2026, subjects);
  console.log(`Wrote SSC-CGL-T1-Paper${spec.n}.json`);
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# SSC CGL Tier 1 papers\n\nRun: \`npm run seed:ssc-cgl-tier1\`\n`
);
