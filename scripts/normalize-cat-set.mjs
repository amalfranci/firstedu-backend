import fs from "fs";
import path from "path";
import {
  collectSectioned,
  matchRules,
  pushItem,
  rule,
  writePaper,
} from "./lib/extract-exam-questions.mjs";

const SRC = path.resolve("../CAT");
const OUT = path.resolve("files/cat-competitive-papers");

const S = {
  varc: "Verbal Ability and Reading Comprehension",
  dilr: "Data Interpretation and Logical Reasoning",
  qa: "Quantitative Ability",
};

const V = {
  main: "Main idea",
  inference: "Inference",
  tone: "Tone",
  purpose: "Purpose",
  vocab: "Meaning of words",
  jumbles: "Para Jumbles",
  summary: "Para Summary",
  odd: "Odd Sentence Out",
  complete: "Para Completion",
};
const D = {
  tables: "Tables",
  charts: "Charts and Graphs",
  caselets: "Caselets",
  venn: "Set Based DI",
  arrange: "Arrangements",
  distribution: "Distribution",
  schedule: "Scheduling",
  games: "Games and Tournaments",
  puzzles: "Logic Puzzles",
};
const Q = {
  percent: "Percentages",
  pl: "Profit and Loss",
  ratio: "Ratio and Proportion",
  average: "Averages",
  interest: "Interest",
  work: "Time and Work",
  tsd: "Time Speed and Distance",
  mixture: "Mixtures and Allegation",
  equations: "Equations",
  inequalities: "Inequalities",
  functions: "Functions",
  progressions: "Progressions",
  numbers: "Number Properties",
  geometry: "Geometry",
  modern: "Modern Math",
};

const ALLOWED = {
  [S.varc]: new Set(Object.values(V)),
  [S.dilr]: new Set(Object.values(D)),
  [S.qa]: new Set(Object.values(Q)),
};
const LIMITS = { [S.varc]: 24, [S.dilr]: 22, [S.qa]: 22 };
const FALLBACK = { [S.varc]: V.inference, [S.dilr]: D.puzzles, [S.qa]: Q.equations };

const RULES = {
  [S.varc]: [
    rule("jumble|rearrang|proper sequence", V.jumbles),
    rule("best summar|summary", V.summary),
    rule("odd (one|sentence) out|does not belong", V.odd),
    rule("complete the paragraph|logical continuation", V.complete),
    rule("tone|attitude", V.tone),
    rule("primarily (in order )?to|purpose", V.purpose),
    rule("means|meaning of", V.vocab),
    rule("main theme|central|primarily concerned", V.main),
    rule("infer|implies|according to the passage", V.inference),
  ],
  [S.dilr]: [
    rule("venn|set theory|only a and b", D.venn),
    rule("tournament|match|points table", D.games),
    rule("schedule|monday|shift|day", D.schedule),
    rule("circular|linear arrangement|sits", D.arrange),
    rule("table|row |column", D.tables),
    rule("bar graph|pie|line graph|chart", D.charts),
    rule("distribut|allocat|select", D.distribution),
    rule("caselet", D.caselets),
  ],
  [S.qa]: [
    rule("permutation|combination|probability", Q.modern),
    rule("triangle|circle|coordinate|geometry", Q.geometry),
    rule("ap |gp |progression|sequence", Q.progressions),
    rule("function f\\(|f\\(x\\)", Q.functions),
    rule("inequalit|modulus", Q.inequalities),
    rule("quadratic|linear equation|roots", Q.equations),
    rule("mixture|alligation", Q.mixture),
    rule("speed|distance|train|boat", Q.tsd),
    rule("work|pipe", Q.work),
    rule("interest", Q.interest),
    rule("average", Q.average),
    rule("ratio|proportion", Q.ratio),
    rule("profit|loss|discount", Q.pl),
    rule("percent", Q.percent),
    rule("integer|divisib|remainder|prime", Q.numbers),
  ],
};

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (
    key.includes("varc") ||
    key.includes("verbal") ||
    key.includes("reading") ||
    key.includes("para")
  ) {
    return S.varc;
  }
  if (
    key.includes("dilr") ||
    key.includes("data") ||
    key.includes("logical") ||
    key.includes("set ") ||
    key.includes("arrangement") ||
    key.includes("scheduling") ||
    key.includes("venn") ||
    key.includes("game")
  ) {
    return S.dilr;
  }
  if (key.includes("quant") || key === "qa") return S.qa;
  return "";
};

const FILES = [
  { src: "CAT_Paper_1.json", n: 1 },
  { src: "CAT_Paper_2.json", n: 2 },
  { src: "CAT_Paper_3.json", n: 3 },
  { src: "CAT_Paper_4.json", n: 4 },
  { src: "CAT_Paper_5.json", n: 5 },
];

fs.mkdirSync(OUT, { recursive: true });
for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectSectioned(raw, normalizeSection);
  // CAT paper 2/5 may store DILR as named sets; already mapped by normalizeSection
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
  writePaper(fs, path, OUT, `CAT-Paper${spec.n}`, `CAT Paper ${spec.n}`, "CAT", 2026, subjects);
  console.log(`Wrote CAT-Paper${spec.n}.json`);
}
fs.writeFileSync(path.join(OUT, "README.md"), `# CAT papers\n\nRun: \`npm run seed:cat\`\n`);
