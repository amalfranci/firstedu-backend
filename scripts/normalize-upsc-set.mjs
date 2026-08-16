import fs from "fs";
import path from "path";
import {
  collectSectioned,
  matchRules,
  rule,
  writePaper,
} from "./lib/extract-exam-questions.mjs";

const SRC = path.resolve("../UPSC EXAM");
const OUT = path.resolve("files/upsc-competitive-papers");

const S = {
  history: "History",
  polity: "Indian Polity and Governance",
  geo: "Geography",
  economy: "Economic and Social Development",
  env: "Environment and Ecology",
  science: "General Science",
  current: "Current Affairs",
};

const T = {
  [S.history]: ["Ancient India", "Medieval India", "Modern India", "Indian National Movement"],
  [S.polity]: ["Constitution", "Political system", "Panchayati Raj", "Public policy", "Rights issues", "Governance"],
  [S.geo]: ["Physical geography", "Indian geography", "World geography", "Economic geography"],
  [S.economy]: ["Sustainable development", "Poverty", "Inclusion", "Demographics", "Social sector initiatives"],
  [S.env]: ["Environmental ecology", "Biodiversity", "Climate change", "Environmental issues"],
  [S.science]: ["Physics", "Chemistry", "Biology", "Science and technology basics"],
  [S.current]: ["National events", "International events", "Government initiatives", "Important developments"],
};

const ALLOWED = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [k, new Set(v)])
);
const FALLBACK = {
  [S.history]: "Modern India",
  [S.polity]: "Constitution",
  [S.geo]: "Indian geography",
  [S.economy]: "Sustainable development",
  [S.env]: "Environmental issues",
  [S.science]: "Science and technology basics",
  [S.current]: "National events",
};

const RULES = {
  [S.history]: [
    rule("harappa|vedic|maurya|gupta|ashoka|stupa|ashvamedha", "Ancient India"),
    rule("mughal|sultanate|bhakti|sufi|vijayanagara|medieval", "Medieval India"),
    rule("gandhi|congress|revolt of 1857|national movement|swadeshi|quit india", "Indian National Movement"),
    rule("british|colonial|modern|ryotwari|permanent settlement", "Modern India"),
  ],
  [S.polity]: [
    rule("fundamental right|dpsp|article 2|article 3|writ", "Rights issues"),
    rule("panchayat|73rd|74th|local government", "Panchayati Raj"),
    rule("policy|niti|scheme implementation", "Public policy"),
    rule("parliament|president|supreme court|federal|governor", "Political system"),
    rule("governance|cag|cvc|lokpal|transparency", "Governance"),
    rule("constitution|preamble|amendment", "Constitution"),
  ],
  [S.geo]: [
    rule("monsoon|himalaya|peninsula|indian desert|ganga|deccan", "Indian geography"),
    rule("plate|volcano|climate|ocean current|landform|atmosphere", "Physical geography"),
    rule("continent|country|strait|canal|world", "World geography"),
    rule("resource|industry|agriculture|mineral|port", "Economic geography"),
  ],
  [S.economy]: [
    rule("poverty|unemployment|mpi", "Poverty"),
    rule("inclusion|jan dhan|financial inclusion", "Inclusion"),
    rule("census|demograph|population|fertility", "Demographics"),
    rule("health|education|social sector|mgnrega", "Social sector initiatives"),
    rule("sustainable|sdg|development", "Sustainable development"),
  ],
  [S.env]: [
    rule("biodiversity|wildlife|species|ramsar|biosphere", "Biodiversity"),
    rule("climate change|ipcc|paris|carbon|emission", "Climate change"),
    rule("ecology|ecosystem|food chain|biome", "Environmental ecology"),
    rule("pollution|waste|environment", "Environmental issues"),
  ],
  [S.science]: [
    rule("virus|bacteria|gene|cell|vaccine|disease", "Biology"),
    rule("atom|molecule|acid|chemical|polymer", "Chemistry"),
    rule("force|energy|wave|optics|particle", "Physics"),
    rule("isro|nasa|ai |semiconductor|technology", "Science and technology basics"),
  ],
  [S.current]: [
    rule("un |who|imf|world bank|g20|international", "International events"),
    rule("scheme|yojana|budget|government", "Government initiatives"),
    rule("summit|report|index|2023|2024|2025|2026", "Important developments"),
  ],
};

const normalizeSection = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.includes("histor") || key.includes("culture") || key.includes("art")) return S.history;
  if (key.includes("polit") || key.includes("governance")) return S.polity;
  if (key.includes("geograph")) return S.geo;
  if (key.includes("econom")) return S.economy;
  if (key.includes("environment") || key.includes("ecolog")) return S.env;
  if (key.includes("science") || key.includes("technolog")) return S.science;
  if (key.includes("current")) return S.current;
  return S.current;
};

const FILES = [
  { src: "UPSC_Prelims_GS_Paper1.json", n: 1 },
  { src: "UPSC_Prelims_GS_Paper2.json", n: 2 },
  { src: "UPSC_Prelims_GS_Paper_MockTest.json", n: 3 },
  { src: "UPSC_Prelims_GS_Paper4_MockTest.json", n: 4 },
  { src: "UPSC_Prelims_gs_Paper_5.json", n: 5 },
];

fs.mkdirSync(OUT, { recursive: true });
for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectSectioned(raw, normalizeSection);
  const all = [];
  for (const [section, items] of Object.entries(grouped)) {
    for (const item of items) all.push({ ...item, section });
  }
  if (all.length < 80) throw new Error(`${spec.src} has ${all.length} questions`);
  const subjects = Object.fromEntries(Object.values(S).map((s) => [s, []]));
  all.slice(0, 100).forEach((item) => {
    const section = item.section;
    const { topic } = matchRules(
      `${item.question}\n${item.explanation}`,
      RULES[section],
      FALLBACK[section]
    );
    if (!ALLOWED[section].has(topic)) throw new Error(`bad ${section} ${topic}`);
    subjects[section].push({
      q: subjects[section].length + 1,
      topic,
      question: item.question,
      options: item.options,
      correct: item.correct,
      explanation: item.explanation,
    });
  });
  writePaper(fs, path, OUT, `UPSC-GS-Paper${spec.n}`, `UPSC Prelims GS Paper ${spec.n}`, "UPSC Prelims GS", 2026, subjects);
  const counts = Object.fromEntries(Object.entries(subjects).map(([k, v]) => [k, v.length]));
  console.log(`Wrote UPSC-GS-Paper${spec.n}.json`, counts);
}
fs.writeFileSync(path.join(OUT, "README.md"), `# UPSC Prelims GS papers\n\nRun: \`npm run seed:upsc\`\n`);
