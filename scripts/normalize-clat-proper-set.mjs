import fs from "fs";
import path from "path";

const SRC = path.resolve("../CLAT_EXAM");
const OUT = path.resolve("files/clat-competitive-papers");

const SECTIONS = {
  english: "English Language",
  gk: "Current Affairs including General Knowledge",
  legal: "Legal Reasoning",
  logical: "Logical Reasoning",
  qt: "Quantitative Techniques",
};

const E = {
  rc: "Reading Comprehension",
  main: "Main idea and central theme",
  arguments: "Arguments and viewpoints",
  inference: "Inference and conclusions",
  summary: "Summarisation",
  compare: "Compare and contrast",
  meaning: "Meaning of words and phrases in context",
  vocab: "Vocabulary in context",
  passage: "Passage-based comprehension",
};

const G = {
  national: "National current affairs",
  international: "International current affairs",
  policy: "Government policies and schemes",
  appointments: "Important appointments",
  awards: "Awards and honours",
  sports: "Sports",
  science: "Science and technology",
  economy: "Economy and business",
  culture: "Arts and culture",
  history: "Important historical events",
  legal: "Major legal developments",
  orgs: "Important national and international organisations",
};

const L = {
  principles: "Legal principles and rules",
  apply: "Application of principles to facts",
  scenarios: "Legal scenarios",
  policy: "Public policy",
  moral: "Moral and philosophical issues",
  constitutional: "Constitutional concepts",
  rights: "Rights and duties",
  contemporary: "Contemporary legal issues",
  arguments: "Understanding legal arguments",
  rules: "Applying given rules to new situations",
};

const R = {
  arguments: "Arguments",
  premises: "Premises and conclusions",
  assumptions: "Assumptions",
  strengthen: "Strengthening arguments",
  weaken: "Weakening arguments",
  inferences: "Inferences",
  critical: "Critical reasoning",
  analogies: "Analogies",
  relationships: "Relationships",
  contradictions: "Contradictions",
  equivalence: "Equivalence",
  cause: "Cause and effect",
  evaluation: "Evaluation of arguments",
  patterns: "Identifying reasoning patterns",
};

const Q = {
  number: "Number System",
  ratio: "Ratios and Proportions",
  percent: "Percentages",
  average: "Averages",
  pl: "Profit and Loss",
  si: "Simple Interest",
  ci: "Compound Interest",
  work: "Time and Work",
  tsd: "Time, Speed and Distance",
  algebra: "Basic Algebra",
  mensuration: "Mensuration",
  arithmetic: "Basic Arithmetic",
  di: "Data Interpretation",
  tables: "Tables",
  graphs: "Graphs",
  charts: "Charts",
  stats: "Statistical estimation",
};

const ALLOWED = {
  [SECTIONS.english]: new Set(Object.values(E)),
  [SECTIONS.gk]: new Set(Object.values(G)),
  [SECTIONS.legal]: new Set(Object.values(L)),
  [SECTIONS.logical]: new Set(Object.values(R)),
  [SECTIONS.qt]: new Set(Object.values(Q)),
};

const rule = (re, topic) => ({ re: new RegExp(re, "i"), topic });

const ENGLISH_RULES = [
  rule("most nearly means|meaning of the word|word \".+\"|phrase \".+\"|term \".+\"|as used in|best defined|function of a", E.vocab),
  rule("strengthen", E.arguments),
  rule("weaken", E.arguments),
  rule("infer|inferred|imply|implied|implicit assumption|would the author most likely agree", E.inference),
  rule("summariz|summaris|main theme|central thesis|central argument|central claim|central paradox|primary (purpose|critique|dilemma|concern|argument)|main (focus|objective)|best captures the (main|central)|overall purpose", E.main),
  rule("tone|stance|attitude|characterizes", E.arguments),
  rule("organization|organisation of the passage|structural method", E.passage),
  rule("compare|contrast", E.compare),
  rule("according to|based on the|how does|why is|what (potential|limitation|role)|author suggests|author characterize", E.rc),
];

const GK_RULES = [
  rule("award|honour|padma|nobel|prize", G.awards),
  rule("olympic|world cup|tournament|championship|sports|athlete", G.sports),
  rule("appoint|chief justice|governor|ambassador|director general", G.appointments),
  rule("bharatiya|\\bbns\\b|\\bbnss\\b|\\bbsa\\b|sedition|ipc\\b|criminal law", G.legal),
  rule("scheme|yojana|policy|nari shakti|reservation act|constitutional amendment", G.legal),
  rule("article|lok sabha|constitution|amendment act", G.legal),
  rule("rbi|cbdc|upi|bank note|economy|gdp|fiscal|revenue|interest rate", G.economy),
  rule("chandrayaan|isro|aditya|gaganyaan|xposat|satellite|lunar|robot|space|hydrogen|mineral|mining|renewable", G.science),
  rule("sco|brics|ndb|united nations|cop\\d+|who\\b|imf|world bank|organisation|organization|headquarters|full member", G.orgs),
  rule("festival|heritage|culture|unesco|classical", G.culture),
  rule("in which year|formally admitted|historical|come into force|presidential assent", G.history),
  rule("summit|hosted|climate conference|international|another country", G.international),
];

const LEGAL_RULES = [
  rule("article|constitution|high court|writ|fundamental right|state list|union list|amendment|legislature enacted|parliament enacted", L.constitutional),
  rule("right to|duty of|fundamental rights", L.rights),
  rule("public policy|municipal|public highway|industrial zone", L.policy),
  rule("moral|ethical|philosophical|fiduciary", L.moral),
  rule("best summarizes the key distinction|which of the following conditions must|best describes the (legal )?principle|legal rule|doctrine of|maxim cited", L.principles),
  rule("proponents|critics|argument", L.arguments),
  rule("principle|if the given principle|applying the rule", L.apply),
  rule("\\b(ramesh|meera|arjun|rohan|kavita|rajesh|mahesh|vikram|sunita|anil|kapoor|mohan|rita|victor|sameer|sita|buildcorp|techcorp|ananya|cyberdata|vijay|ms\\. p)\\b", L.scenarios),
];

const LOGICAL_RULES = [
  rule("most strengthen", R.strengthen),
  rule("most weaken", R.weaken),
  rule("assumption|depends|depend|assumes which", R.assumptions),
  rule("infer|inferred", R.inferences),
  rule("logical flaw|fallac|contradict", R.contradictions),
  rule("cause of|underlying cause|relationship between", R.cause),
  rule("analogy|analogous", R.analogies),
  rule("equivalent|equivalence", R.equivalence),
  rule("main (logical )?conclusion|main argument|main theme|core argument|premise|central claim|main line of reasoning|summarizes the (core|main)", R.premises),
  rule("evaluate|evaluation", R.evaluation),
  rule("role does|serves primarily|attitude toward|primarily in order to", R.critical),
  rule("relationship", R.relationships),
  rule("reasoning pattern|structure of the passage", R.patterns),
  rule("according to (the )?(passage|paragraph|lon fuller)|based on the passage", R.critical),
];

const QT_RULES = [
  rule("percentage|percent", Q.percent),
  rule("ratio of", Q.ratio),
  rule("average|mean", Q.average),
  rule("profit|loss", Q.pl),
  rule("simple interest", Q.si),
  rule("compound interest", Q.ci),
  rule("time and work|days to complete", Q.work),
  rule("speed|distance|km/h", Q.tsd),
  rule("area|volume|perimeter|radius", Q.mensuration),
  rule("equation|algebra", Q.algebra),
  rule("table", Q.tables),
  rule("graph", Q.graphs),
  rule("chart|pie", Q.charts),
  rule("how many|total number|total (annual|overall|manufacturing)", Q.number),
];

const FALLBACK = {
  [SECTIONS.english]: E.passage,
  [SECTIONS.gk]: G.national,
  [SECTIONS.legal]: L.scenarios,
  [SECTIONS.logical]: R.arguments,
  [SECTIONS.qt]: Q.di,
};

const FILES = [
  { src: "CLAT_paper.json", n: 1 },
  { src: "CLAT_Paper_2.json", n: 2 },
  { src: "CLAT_Paper_chandan.json", n: 3 },
  { src: "CLAT_practice_test.json", n: 4 },
  { src: "CLAT_5.json", n: 5 },
];

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("english")) return SECTIONS.english;
  if (key.includes("current") || key.includes("general knowledge") || key.includes("gk")) {
    return SECTIONS.gk;
  }
  if (key.includes("legal")) return SECTIONS.legal;
  if (key.includes("logical")) return SECTIONS.logical;
  if (key.includes("quant")) return SECTIONS.qt;
  return String(raw || "").trim();
};

const matchTopic = (section, text) => {
  const rules =
    section === SECTIONS.english
      ? ENGLISH_RULES
      : section === SECTIONS.gk
        ? GK_RULES
        : section === SECTIONS.legal
          ? LEGAL_RULES
          : section === SECTIONS.logical
            ? LOGICAL_RULES
            : QT_RULES;
  for (const item of rules) {
    if (item.re.test(text)) return { topic: item.topic, matched: true };
  }
  return { topic: FALLBACK[section] || "", matched: false };
};

const collectFromRaw = (raw) => {
  const grouped = {
    [SECTIONS.english]: [],
    [SECTIONS.gk]: [],
    [SECTIONS.legal]: [],
    [SECTIONS.logical]: [],
    [SECTIONS.qt]: [],
  };

  for (const sec of raw.sections || []) {
    const section = normalizeSection(sec.section_name);
    if (!grouped[section]) continue;
    const blocks = sec.passages || sec.sets || [];
    for (const block of blocks) {
      const passage = String(
        block.passage_text || block.text || block.passage || ""
      ).trim();
      for (const item of block.questions || []) {
        grouped[section].push({
          q: Number(item.question_number || item.q_number || item.q || grouped[section].length + 1),
          passage,
          question: String(item.question_text || item.question || "").trim(),
          options: Object.fromEntries(
            Object.entries(item.options || {}).map(([k, v]) => [
              String(k).toUpperCase(),
              String(v ?? "").trim(),
            ])
          ),
          correct: String(item.correct_option || item.correct || "A").toUpperCase().trim(),
          explanation: String(item.explanation || "").trim(),
        });
      }
    }
  }
  return grouped;
};

fs.mkdirSync(OUT, { recursive: true });
const fallbacks = [];

for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectFromRaw(raw);
  const subjects = {};

  for (const section of Object.values(SECTIONS)) {
    const items = grouped[section] || [];
    if (!items.length) {
      throw new Error(`${spec.src} missing section ${section}`);
    }
    subjects[section] = items.map((item, index) => {
      const q = index + 1;
      const hay = `${item.question}\n${item.explanation}\n${item.passage.slice(0, 400)}`;
      const { topic, matched } = matchTopic(section, hay);
      if (!ALLOWED[section].has(topic)) {
        throw new Error(`${spec.src} ${section} Q${q} invalid topic ${topic}`);
      }
      if (!matched) {
        fallbacks.push({
          paper: spec.n,
          section,
          q,
          stem: item.question.slice(0, 140),
        });
      }
      return {
        q,
        topic,
        passage: item.passage,
        question: item.question,
        options: item.options,
        correct: item.correct,
        explanation: item.explanation,
      };
    });
  }

  const paper = {
    paper_id: `CLAT-Paper${spec.n}`,
    title: `CLAT Paper ${spec.n}`,
    exam: "CLAT",
    year: 2026,
    subjects,
  };
  const outName = `CLAT-Paper${spec.n}.json`;
  fs.writeFileSync(path.join(OUT, outName), `${JSON.stringify(paper, null, 2)}\n`, "utf8");
  const counts = Object.fromEntries(
    Object.entries(subjects).map(([k, v]) => [k, v.length])
  );
  console.log(`Wrote ${outName}`, counts);
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# CLAT question papers

Add more papers here as \`.json\` files, then run:

\`\`\`bash
cd firstedu-backend
npm run seed:clat
\`\`\`

The seed script reads every \`.json\` file in this folder and upserts them into:

- \`clatcompetitivepapers\`
- \`clatcompetitivequestions\`

## JSON format

\`\`\`json
{
  "paper_id": "CLAT-Paper6",
  "title": "CLAT Paper 6",
  "subjects": {
    "English Language": [
      {
        "q": 1,
        "topic": "Main idea and central theme",
        "passage": "Passage text...",
        "question": "Question text",
        "options": { "A": "", "B": "", "C": "", "D": "" },
        "correct": "B",
        "explanation": "..."
      }
    ],
    "Current Affairs including General Knowledge": [],
    "Legal Reasoning": [],
    "Logical Reasoning": [],
    "Quantitative Techniques": []
  }
}
\`\`\`

Topics must match official CLAT UG 2026 syllabus topics
(source: \`CLAT_EXAM/CLAT_2026_Syllabus.json\`).
`
);

console.log(JSON.stringify({ fallbackCount: fallbacks.length }, null, 2));
if (fallbacks.length) {
  console.log("\nFALLBACKS:");
  for (const row of fallbacks) {
    console.log(`[P${row.paper} ${row.section} Q${row.q}] ${row.stem}`);
  }
}
