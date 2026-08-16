import fs from "fs";
import path from "path";

const SRC = path.resolve("../IBPS");
const OUT = path.resolve("files/ibps-competitive-papers");

const S = {
  english: "English Language",
  quant: "Quantitative Aptitude",
  reasoning: "Reasoning Ability",
};

const E = {
  rc: "Reading Comprehension",
  main: "Main idea",
  inference: "Inference",
  tone: "Tone",
  vocab: "Vocabulary in context",
  error: "Error detection",
  correction: "Sentence correction",
  fillers: "Fill in the blanks",
  synonyms: "Synonyms",
  antonyms: "Antonyms",
  usage: "Word usage",
  idioms: "Idioms and phrases",
  jumbles: "Para jumbles",
  rearrange: "Sentence rearrangement",
  cloze: "Cloze test",
};

const Q = {
  percent: "Percentage",
  pl: "Profit and loss",
  ratio: "Ratio and proportion",
  average: "Average",
  interest: "Simple and compound interest",
  work: "Time and work",
  tsd: "Time, speed and distance",
  mixture: "Mixture and allegation",
  simplification: "Simplification",
  approximation: "Approximation",
  series: "Number series",
  hcf: "HCF and LCM",
  tables: "Tables",
  bars: "Bar graphs",
  lines: "Line graphs",
  pie: "Pie charts",
  caselets: "Caselets",
  equations: "Basic equations",
  quadratic: "Quadratic equations",
  area: "Area",
  volume: "Volume",
};

const R = {
  linear: "Linear seating",
  circular: "Circular seating",
  floor: "Floor puzzles",
  box: "Box puzzles",
  schedule: "Scheduling",
  syllogism: "Syllogism",
  inequality: "Inequality",
  coding: "Coding-decoding",
  blood: "Blood relations",
  direction: "Direction sense",
  ranking: "Order and ranking",
  alpha: "Alphanumeric series",
  input: "Input-output",
  ds: "Data sufficiency",
  statement: "Statement and conclusion",
};

const ALLOWED = {
  [S.english]: new Set(Object.values(E)),
  [S.quant]: new Set(Object.values(Q)),
  [S.reasoning]: new Set(Object.values(R)),
};

const LIMITS = { [S.english]: 30, [S.quant]: 35, [S.reasoning]: 35 };

const rule = (re, topic) => ({ re: new RegExp(re, "i"), topic });

const ENGLISH_TYPE_RULES = [
  rule("cloze", E.cloze),
  rule("para.?jumble|sentence rearrangement|rearrangement", E.jumbles),
  rule("error spotting|error detection", E.error),
  rule("sentence (correction|improvement)|phrase replacement", E.correction),
  rule("double (blank|filler)|fillers|fill in", E.fillers),
  rule("word usage|grammar & vocabulary|vocabulary", E.usage),
  rule("reading comprehension", E.rc),
];

const ENGLISH_STEM_RULES = [
  rule("most (nearly )?similar|synonym", E.synonyms),
  rule("most (nearly )?opposite|antonym", E.antonyms),
  rule("most nearly means|meaning of|phrase", E.vocab),
  rule("tone|author.?s attitude", E.tone),
  rule("infer|inferred|implied", E.inference),
  rule("central theme|primary objective|main idea|best expresses|according to the passage|TRUE according to the passage|author suggest", E.main),
  rule("error|incorrect|spot the error|words are highlighted|correct pair", E.error),
  rule("rearrang|proper sequence|para jumble", E.jumbles),
  rule("blank|filler", E.fillers),
];

const QUANT_TYPE_RULES = [
  rule("caselet", Q.caselets),
  rule("approximation", Q.approximation),
  rule("simplification", Q.simplification),
  rule("quadratic", Q.quadratic),
  rule("number series", Q.series),
  rule("data interpretation|bar graph", Q.bars),
  rule("table", Q.tables),
  rule("pie", Q.pie),
  rule("line graph", Q.lines),
];

const QUANT_STEM_RULES = [
  rule("approximat|what value will come|find the (exact )?value of", Q.approximation),
  rule("simplif", Q.simplification),
  rule("quadratic|roots of the equation|two equations|relationship between x and y|2x\\^2|x\\^2 -", Q.quadratic),
  rule("what will come in place of|number series|wrong number|missing (term|number)|odd one out in the series|given series", Q.series),
  rule("profit|loss|marked price|discount", Q.pl),
  rule("simple interest|compound interest|rate of interest", Q.interest),
  rule("time and work|days to complete|work done|can do a work|can reap|pipe can fill|pipes are opened", Q.work),
  rule("speed|distance|train|boat|upstream|downstream", Q.tsd),
  rule("mixture|allegation", Q.mixture),
  rule("average|mean age", Q.average),
  rule("ratio", Q.ratio),
  rule("percent|% ", Q.percent),
  rule("hcf|lcm", Q.hcf),
  rule("area|perimeter|rectangle|circle|triangle", Q.area),
  rule("volume|cylinder|cone|sphere|cuboid", Q.volume),
  rule("table|students in|units produced", Q.tables),
];

const REASON_TYPE_RULES = [
  rule("circular", R.circular),
  rule("linear seating|row", R.linear),
  rule("floor|building", R.floor),
  rule("box", R.box),
  rule("day-based|schedul", R.schedule),
  rule("syllogism", R.syllogism),
  rule("inequality", R.inequality),
  rule("coding", R.coding),
  rule("blood|family", R.blood),
  rule("direction", R.direction),
  rule("data sufficiency", R.ds),
  rule("input-output|input output", R.input),
  rule("ranking|order", R.ranking),
  rule("word series|number series|alphanumeric", R.alpha),
  rule("statement", R.statement),
  rule("puzzle|seating", R.linear),
];

const REASON_STEM_RULES = [
  rule("sits|sitting|left of|right of|circular|around a", R.circular),
  rule("row facing|linear", R.linear),
  rule("floor|lives on", R.floor),
  rule("box", R.box),
  rule("monday|tuesday|schedule|seven days", R.schedule),
  rule("conclusions?:|only conclusion|syllog", R.syllogism),
  rule("which of the following symbols|inequalit|\\bP @ Q\\b|\\bA # B\\b", R.inequality),
  rule("coded as|coding|in a certain code|code language|is written as", R.coding),
  rule("mother|father|brother|sister|how is .+ related", R.blood),
  rule("north|south|east|west|direction", R.direction),
  rule("data in statement|sufficient to answer", R.ds),
  rule("input|step i", R.input),
  rule("rank|tallest|shortest", R.ranking),
  rule("follows? the same pattern|series|meaningful english word|alphanumeric", R.alpha),
  rule("designation|holds the designation", R.floor),
];

const FALLBACK = {
  [S.english]: E.rc,
  [S.quant]: Q.percent,
  [S.reasoning]: R.linear,
};

const FILES = [
  { src: "IBPS_paper_1.json", n: 1 },
  { src: "IBPS_PO_paper-2_structured.json", n: 2 },
  { src: "IBPS_PO_chandan_paper_3.json", n: 3 },
  { src: "IBPS_PO_Prelims_Mock_Paper4.json", n: 4 },
  { src: "IBPS_paper_5.json", n: 5 },
];

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("english")) return S.english;
  if (key.includes("quant") || key.includes("numerical")) return S.quant;
  if (key.includes("reason")) return S.reasoning;
  return "";
};

const pickTopic = (section, type, stem) => {
  const typeRules =
    section === S.english
      ? ENGLISH_TYPE_RULES
      : section === S.quant
        ? QUANT_TYPE_RULES
        : REASON_TYPE_RULES;
  const stemRules =
    section === S.english
      ? ENGLISH_STEM_RULES
      : section === S.quant
        ? QUANT_STEM_RULES
        : REASON_STEM_RULES;
  for (const item of stemRules) {
    if (item.re.test(stem)) return { topic: item.topic, matched: true };
  }
  for (const item of typeRules) {
    if (item.re.test(type)) return { topic: item.topic, matched: true };
  }
  return { topic: FALLBACK[section], matched: false };
};

const pushQ = (grouped, section, type, item, passage) => {
  if (!grouped[section]) return;
  const blankId = item.id || item.number || item.question_number;
  const question = String(
    item.question_text ||
      item.question ||
      item.questionText ||
      (item.word
        ? `Choose the sentence where the word "${item.word}" is used correctly.`
        : "") ||
      (blankId
        ? `Choose the most appropriate word for blank (${blankId}).`
        : "")
  ).trim();
  if (!question) return;
  grouped[section].push({
    type: String(type || "").trim(),
    passage: String(
      passage || item.passage_or_context || item.passage || ""
    ).trim(),
    question,
    options: Object.fromEntries(
      Object.entries(item.options || {}).map(([k, v]) => [
        String(k).toUpperCase(),
        String(v ?? "").trim(),
      ])
    ),
    correct: String(item.correct_option || item.correct || "A")
      .toUpperCase()
      .trim(),
    explanation: String(item.explanation || "").trim(),
  });
};

const collectFromRaw = (raw) => {
  const grouped = { [S.english]: [], [S.quant]: [], [S.reasoning]: [] };

  if (Array.isArray(raw.sections)) {
    for (const sec of raw.sections) {
      const section = normalizeSection(sec.section_name || sec.name);
      if (Array.isArray(sec.questions) && !sec.parts && !sec.subsections) {
        for (const item of sec.questions) {
          pushQ(grouped, section, "", item, item.passage_or_context);
        }
        continue;
      }
      for (const part of sec.parts || sec.subsections || []) {
        const type = part.type || part.subsection_name || "";
        for (const item of part.questions || []) {
          pushQ(grouped, section, type, item, part.passage);
        }
      }
    }
  }

  const named = {
    english_language: S.english,
    quantitative_aptitude: S.quant,
    reasoning_ability: S.reasoning,
  };
  for (const [key, section] of Object.entries(named)) {
    const block = raw[key];
    if (!block || typeof block !== "object") continue;
    const walk = (node, type, passage) => {
      if (!node || typeof node !== "object") return;
      const nextPassage = node.passage || passage;
      if (Array.isArray(node.questions)) {
        for (const item of node.questions) {
          pushQ(grouped, section, type, item, nextPassage);
        }
      }
      for (const [ck, cv] of Object.entries(node)) {
        if (["questions", "passage", "directions"].includes(ck)) continue;
        if (cv && typeof cv === "object") walk(cv, type || ck, nextPassage);
      }
    };
    walk(block, "", "");
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
          stem: item.question.slice(0, 130),
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
      return next;
    });
  }

  const paper = {
    paper_id: `IBPS-Paper${spec.n}`,
    title: `IBPS PO Prelims Paper ${spec.n}`,
    exam: "IBPS PO Prelims",
    year: 2026,
    subjects,
  };
  const outName = `IBPS-Paper${spec.n}.json`;
  fs.writeFileSync(path.join(OUT, outName), `${JSON.stringify(paper, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${outName}`,
    Object.fromEntries(Object.entries(subjects).map(([k, v]) => [k, v.length]))
  );
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# IBPS PO Prelims question papers

Add more papers here as \`.json\` files, then run:

\`\`\`bash
cd firstedu-backend
npm run seed:ibps
\`\`\`

The seed script reads every \`.json\` file in this folder and upserts them into:

- \`ibpscompetitivepapers\`
- \`ibpscompetitivequestions\`

## JSON format

\`\`\`json
{
  "paper_id": "IBPS-Paper6",
  "title": "IBPS PO Prelims Paper 6",
  "subjects": {
    "English Language": [
      {
        "q": 1,
        "topic": "Reading Comprehension",
        "passage": "optional passage",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "", "E": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Quantitative Aptitude": [],
    "Reasoning Ability": []
  }
}
\`\`\`

Topics must match official IBPS PO Prelims 2026 syllabus topics
(source: \`IBPS/IBPS_2026_Syllabus.json\`).
`
);

console.log(JSON.stringify({ fallbackCount: fallbacks.length }, null, 2));
if (fallbacks.length) {
  console.log("\nFALLBACKS:");
  for (const row of fallbacks) {
    console.log(`[P${row.paper} ${row.section} Q${row.q} ${row.type}] ${row.stem}`);
  }
}
