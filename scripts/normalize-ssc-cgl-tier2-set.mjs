import fs from "fs";
import path from "path";
import {
  collectSectioned,
  matchRules,
  rule,
  writePaper,
} from "./lib/extract-exam-questions.mjs";

const SRC = path.resolve("../SSC_CGL_Tier_2");
const OUT = path.resolve("files/ssc-cgl-tier2-competitive-papers");

const S = {
  math: "Mathematical Abilities",
  reason: "Reasoning and General Intelligence",
  eng: "English Language and Comprehension",
  ga: "General Awareness",
  comp: "Computer Knowledge",
};

const M = {
  number: "Number Systems",
  percent: "Percentage",
  ratio: "Ratio and proportion",
  average: "Averages",
  si: "Simple interest",
  ci: "Compound interest",
  pl: "Profit and loss",
  partnership: "Partnership business",
  mixture: "Mixture and allegation",
  tsd: "Time and distance",
  work: "Time and work",
  algebra: "Algebra",
  geometry: "Geometry",
  mensuration: "Mensuration",
  trigo: "Trigonometry",
  stats: "Statistics and Data",
};
const R = {
  analogy: "Analogy",
  classification: "Classification",
  series: "Series",
  coding: "Coding and Decoding",
  logical: "Logical Reasoning",
  spatial: "Spatial Reasoning",
  nonverbal: "Non-Verbal Reasoning",
  other: "Other",
};
const E = {
  vocab: "Vocabulary",
  grammar: "Grammar",
  spelling: "Spelling",
  fillers: "Fillers",
  voice: "Voice and Narration",
  arrange: "Sentence Arrangement",
  cloze: "Cloze Test",
  rc: "Reading Comprehension",
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
const C = {
  basics: "Computer Basics",
  software: "Software",
  office: "Office Applications",
  net: "Internet and Networking",
  cyber: "Cyber Security",
  digital: "Digital Basics",
};

const ALLOWED = {
  [S.math]: new Set(Object.values(M)),
  [S.reason]: new Set(Object.values(R)),
  [S.eng]: new Set(Object.values(E)),
  [S.ga]: new Set(Object.values(G)),
  [S.comp]: new Set(Object.values(C)),
};
const LIMITS = { [S.math]: 30, [S.reason]: 30, [S.eng]: 45, [S.ga]: 25, [S.comp]: 20 };
const FALLBACK = {
  [S.math]: M.percent,
  [S.reason]: R.logical,
  [S.eng]: E.grammar,
  [S.ga]: G.current,
  [S.comp]: C.basics,
};

const RULES = {
  [S.math]: [
    rule("sin|cos|tan|height and distance|trigono", M.trigo),
    rule("area|volume|cylinder|cone|sphere|pyramid|mensur", M.mensuration),
    rule("triangle|circle|chord|tangent|similar|equilateral", M.geometry),
    rule("x \\+|1/x|identit|surd|algebra|x\\^", M.algebra),
    rule("histogram|pie chart|bar diagram|mean|median", M.stats),
    rule("compound interest", M.ci),
    rule("simple interest", M.si),
    rule("profit|loss|discount|marks up", M.pl),
    rule("partnership|capitals in the ratio|profit is divided", M.partnership),
    rule("mixture|allegation|milk", M.mixture),
    rule("time and work|pipe|days to", M.work),
    rule("speed|distance|train|boat", M.tsd),
    rule("ratio|proportion", M.ratio),
    rule("average", M.average),
    rule("percent", M.percent),
    rule("fraction|decimal|hcf|lcm", M.number),
  ],
  [S.reason]: [
    rule("analog|same way as", R.analogy),
    rule("odd one|classification|different", R.classification),
    rule("series|question mark", R.series),
    rule("code|coded", R.coding),
    rule("mirror|fold|embedded|figure", R.nonverbal),
    rule("direction|cube|dice|paper cut", R.spatial),
    rule("venn|syllog|statement|conclusion|seating", R.logical),
  ],
  [S.eng]: [
    rule("passage|according to the passage|comprehension", E.rc),
    rule("cloze", E.cloze),
    rule("passive|active voice|indirect speech|narration", E.voice),
    rule("synonym|antonym|idiom|one.?word", E.vocab),
    rule("spelt|spelling", E.spelling),
    rule("rearrang|jumble", E.arrange),
    rule("fill in the blank", E.fillers),
    rule("error|improve", E.grammar),
  ],
  [S.ga]: [
    rule("constitution|article|parliament|president|judiciary", G.polity),
    rule("gdp|rbi|budget|gst|economy", G.economy),
    rule("river|mountain|climate|latitude", G.geo),
    rule("vedic|mughal|gandhi|revolt|harappa", G.history),
    rule("dance|festival|literature", G.culture),
    rule("physics|chemistry|biology|vitamin", G.science),
  ],
  [S.comp]: [
    rule("malware|virus|phishing|password|cyber|firewall", C.cyber),
    rule("excel|word|powerpoint|spreadsheet|ms office", C.office),
    rule("internet|browser|email|lan|wan|http|ip address", C.net),
    rule("operating system|windows|linux|application software", C.software),
    rule("cpu|ram|rom|input|output|memory|hardware", C.basics),
    rule("binary|bit|byte|digital", C.digital),
  ],
};

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("math") || key.includes("quant")) return S.math;
  if (key.includes("reason") || key.includes("intelligence")) return S.reason;
  if (key.includes("english")) return S.eng;
  if (key.includes("awareness")) return S.ga;
  if (key.includes("computer")) return S.comp;
  return "";
};

const loadPaper = (spec) => {
  if (spec.bundle) {
    const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
    const paper = (raw.papers || []).find((p) =>
      String(p.paper_name || "").toLowerCase().includes(`paper ${spec.bundle}`)
    );
    if (!paper) throw new Error(`missing ${spec.bundle} in ${spec.src}`);
    return paper;
  }
  return JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
};

const FILES = [
  { src: "SSC_CGL_Tier_2_Paper_1.json", n: 1 },
  { src: "ssc_cgl_tier2_questions.json", n: 2, bundle: "2" },
  { src: "ssc_cgl_tier2_questions.json", n: 3, bundle: "3" },
  { src: "SSC_CGL_Tier_2_Paper_4.json", n: 4 },
  { src: "ssc_cgl_tier2_paper5.json", n: 5 },
];

fs.mkdirSync(OUT, { recursive: true });
for (const spec of FILES) {
  const raw = loadPaper(spec);
  const grouped = collectSectioned(raw, normalizeSection);
  const subjects = {};
  for (const section of Object.values(S)) {
    const items = (grouped[section] || []).slice(0, LIMITS[section]);
    if (items.length !== LIMITS[section]) {
      throw new Error(`Paper ${spec.n} ${section} has ${items.length}`);
    }
    subjects[section] = items.map((item, i) => {
      const { topic } = matchRules(
        `${item.question}\n${item.explanation}`,
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
  writePaper(
    fs,
    path,
    OUT,
    `SSC-CGL-T2-Paper${spec.n}`,
    `SSC CGL Tier 2 Paper ${spec.n}`,
    "SSC CGL Tier 2",
    2026,
    subjects
  );
  console.log(`Wrote SSC-CGL-T2-Paper${spec.n}.json`);
}
fs.writeFileSync(path.join(OUT, "README.md"), `# SSC CGL Tier 2 papers\n\nRun: \`npm run seed:ssc-cgl-tier2\`\n`);
