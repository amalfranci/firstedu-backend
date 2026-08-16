import fs from "fs";
import path from "path";

const SRC = path.resolve("../JEE ADVANCE EXAM - PROPER - QUESTIONS SET");
const OUT = path.resolve("files/jee-advanced-competitive-papers");

const M = {
  sets: "Sets, Relations and Functions",
  complex: "Complex Numbers",
  quadratic: "Quadratic Equations",
  series: "Sequences and Series",
  pnc: "Logarithms, Permutations and Combinations",
  binomial: "Binomial Theorem",
  matrices: "Matrices and Determinants",
  probability: "Probability",
  stats: "Statistics",
  trigo: "Trigonometry",
  lines: "Straight Lines (2D Analytical Geometry)",
  circles: "Circles",
  conics: "Conic Sections (Parabola, Ellipse, Hyperbola)",
  td: "Three-Dimensional Geometry",
  lcd: "Limits, Continuity and Differentiability",
  aod: "Applications of Derivatives",
  integral: "Integral Calculus",
  de: "Differential Equations",
  vectors: "Vectors",
};

const P = {
  units: "Units, Dimensions, Errors and Experimental Physics",
  kinematics: "Kinematics",
  nlm: "Newton's Laws of Motion and Friction",
  wep: "Work, Energy and Power",
  rotation: "System of Particles and Rotational Motion",
  gravitation: "Gravitation",
  shm: "Simple Harmonic Motion and Oscillations",
  fluids: "Mechanical Properties of Solids and Fluids",
  waves: "Wave Motion and Sound",
  thermal: "Thermal Physics",
  electro: "Electrostatics",
  cap: "Capacitance",
  current: "Current Electricity",
  magnetism: "Magnetic Effects of Current and Magnetism",
  emi: "Electromagnetic Induction and AC Circuits",
  emw: "Electromagnetic Waves",
  ray: "Ray Optics",
  waveOptics: "Wave Optics",
  modern: "Modern Physics",
};

const C = {
  general: "General Topics",
  gases: "States of Matter: Gases and Liquids",
  atomic: "Atomic Structure",
  bonding: "Chemical Bonding and Molecular Structure",
  thermo: "Chemical Thermodynamics",
  eq: "Chemical and Ionic Equilibrium",
  electro: "Electrochemistry",
  kinetics: "Chemical Kinetics",
  solid: "Solid State",
  solutions: "Solutions",
  surface: "Surface Chemistry",
  periodic: "Classification of Elements and Periodicity in Properties",
  hydrogen: "Hydrogen",
  sblock: "s-Block Elements",
  pblock: "p-Block Elements",
  dblock: "d-Block Elements",
  fblock: "f-Block Elements",
  coord: "Coordination Compounds",
  isolation: "Isolation of Metals",
  qual: "Principles of Qualitative Analysis",
  goc: "Basic Principles of Organic Chemistry",
  alkanes: "Alkanes",
  alkenes: "Alkenes and Alkynes",
  benzene: "Benzene",
  phenols: "Phenols",
  halo: "Alkyl Halides",
  alcohols: "Alcohols",
  ethers: "Ethers",
  carbonyl: "Aldehydes and Ketones",
  acids: "Carboxylic Acids",
  amines: "Amines",
  haloarenes: "Haloarenes",
  bio: "Biomolecules",
  polymers: "Polymers",
  everyday: "Chemistry in Everyday Life",
  practical: "Practical Organic Chemistry",
};

const ALLOWED = {
  Mathematics: new Set(Object.values(M)),
  Physics: new Set(Object.values(P)),
  Chemistry: new Set(Object.values(C)),
};

const TOPICS = {
  "JEE-ADVANCED-Paper1": {
    Physics: {
      1: P.wep, 2: P.rotation, 3: P.rotation, 4: P.thermal, 5: P.ray,
      6: P.emi, 7: P.magnetism, 8: P.waveOptics, 9: P.modern, 10: P.cap,
      11: P.shm, 12: P.emi, 13: P.waves, 14: P.fluids, 15: P.shm,
      16: P.ray, 17: P.emi, 18: P.electro,
    },
    Chemistry: {
      1: C.electro, 2: C.alkenes, 3: C.coord, 4: C.kinetics, 5: C.carbonyl,
      6: C.pblock, 7: C.solid, 8: C.thermo, 9: C.gases, 10: C.isolation,
      11: C.qual, 12: C.alkenes, 13: C.atomic, 14: C.solutions, 15: C.amines,
      16: C.bonding, 17: C.dblock, 18: C.eq,
    },
    Mathematics: {
      1: M.complex, 2: M.lcd, 3: M.sets, 4: M.matrices, 5: M.aod,
      6: M.pnc, 7: M.integral, 8: M.aod, 9: M.conics, 10: M.aod,
      11: M.matrices, 12: M.lcd, 13: M.de, 14: M.conics, 15: M.vectors,
      16: M.probability, 17: M.integral, 18: M.series,
    },
  },
  "JEE-ADVANCED-Paper2": {
    Physics: {
      1: P.kinematics, 2: P.thermal, 3: P.modern, 4: P.electro, 5: P.current,
      6: P.ray, 7: P.rotation, 8: P.gravitation, 9: P.shm, 10: P.magnetism,
      11: P.emi, 12: P.fluids, 13: P.thermal, 14: P.emi, 15: P.waveOptics,
      16: P.wep, 17: P.electro, 18: P.modern,
    },
    Chemistry: {
      1: C.electro, 2: C.carbonyl, 3: C.coord, 4: C.kinetics, 5: C.gases,
      6: C.goc, 7: C.pblock, 8: C.solid, 9: C.halo, 10: C.solutions,
      11: C.isolation, 12: C.goc, 13: C.electro, 14: C.pblock, 15: C.carbonyl,
      16: C.surface, 17: C.pblock, 18: C.bio,
    },
    Mathematics: {
      1: M.complex, 2: M.lcd, 3: M.sets, 4: M.matrices, 5: M.aod,
      6: M.pnc, 7: M.integral, 8: M.aod, 9: M.conics, 10: M.aod,
      11: M.matrices, 12: M.lcd, 13: M.de, 14: M.conics, 15: M.vectors,
      16: M.probability, 17: M.integral, 18: M.series,
    },
  },
  "JEE-ADVANCED-Paper3": {
    Physics: {
      1: P.rotation, 2: P.electro, 3: P.emi, 4: P.emi, 5: P.thermal,
      6: P.ray, 7: P.modern, 8: P.waves, 9: P.fluids, 10: P.shm,
      11: P.gravitation, 12: P.cap, 13: P.units, 14: P.wep, 15: P.emi,
      16: P.waveOptics, 17: P.thermal, 18: P.modern,
    },
    Chemistry: {
      1: C.eq, 2: C.electro, 3: C.kinetics, 4: C.coord, 5: C.phenols,
      6: C.amines, 7: C.electro, 8: C.pblock, 9: C.isolation, 10: C.bonding,
      11: C.carbonyl, 12: C.thermo, 13: C.halo, 14: C.sblock, 15: C.electro,
      16: C.bio, 17: C.coord, 18: C.periodic,
    },
    Mathematics: {
      1: M.integral, 2: M.matrices, 3: M.sets, 4: M.integral, 5: M.binomial,
      6: M.complex, 7: M.de, 8: M.stats, 9: M.lcd, 10: M.vectors,
      11: M.conics, 12: M.pnc, 13: M.probability, 14: M.lcd, 15: M.de,
      16: M.conics, 17: M.matrices, 18: M.aod,
    },
  },
  "JEE-ADVANCED-Paper4": {
    Physics: {
      1: P.rotation, 2: P.rotation, 3: P.thermal, 4: P.cap, 5: P.emi,
      6: P.waveOptics, 7: P.modern, 8: P.modern, 9: P.thermal, 10: P.ray,
      11: P.current, 12: P.gravitation, 13: P.shm, 14: P.rotation, 15: P.emw,
      16: P.modern, 17: P.emi, 18: P.thermal,
    },
    Chemistry: {
      1: C.carbonyl, 2: C.coord, 3: C.kinetics, 4: C.bonding, 5: C.gases,
      6: C.alkanes, 7: C.eq, 8: C.electro, 9: C.coord, 10: C.dblock,
      11: C.periodic, 12: C.halo, 13: C.electro, 14: C.pblock, 15: C.phenols,
      16: C.solutions, 17: C.bonding, 18: C.bonding,
    },
    Mathematics: {
      1: M.integral, 2: M.complex, 3: M.trigo, 4: M.matrices, 5: M.binomial,
      6: M.integral, 7: M.probability, 8: M.lcd, 9: M.vectors, 10: M.circles,
      11: M.sets, 12: M.matrices, 13: M.series, 14: M.lcd, 15: M.probability,
      16: M.de, 17: M.td, 18: M.vectors,
    },
  },
  "JEE-ADVANCED-Paper5": {
    Physics: {
      1: P.kinematics, 2: P.nlm, 3: P.nlm, 4: P.wep, 5: P.wep,
      6: P.rotation, 7: P.gravitation, 8: P.shm, 9: P.waves, 10: P.waves,
      11: P.thermal, 12: P.thermal, 13: P.electro, 14: P.cap, 15: P.current,
      16: P.magnetism, 17: P.emi, 18: P.modern,
    },
    Chemistry: {
      1: C.general, 2: C.periodic, 3: C.carbonyl, 4: C.thermo, 5: C.eq,
      6: C.coord, 7: C.pblock, 8: C.carbonyl, 9: C.amines, 10: C.electro,
      11: C.isolation, 12: C.solid, 13: C.kinetics, 14: C.dblock, 15: C.halo,
      16: C.bio, 17: C.eq, 18: C.qual,
    },
    Mathematics: {
      1: M.complex, 2: M.quadratic, 3: M.series, 4: M.pnc, 5: M.binomial,
      6: M.matrices, 7: M.probability, 8: M.lines, 9: M.circles, 10: M.conics,
      11: M.conics, 12: M.conics, 13: M.lcd, 14: M.aod, 15: M.integral,
      16: M.integral, 17: M.de, 18: M.vectors,
    },
  },
};

const FILES = [
  { src: "JEE_Advanced_paper1.json", paperKey: "JEE-ADVANCED-Paper1", n: 1 },
  { src: "JEE_Advanced_pdf2.json", paperKey: "JEE-ADVANCED-Paper2", n: 2 },
  { src: "JEE_Advanced_paper3.json", paperKey: "JEE-ADVANCED-Paper3", n: 3 },
  { src: "JEE_Advanced_pdf4.json", paperKey: "JEE-ADVANCED-Paper4", n: 4 },
  { src: "JEE_Advanced_pdf-5.json", paperKey: "JEE-ADVANCED-Paper5", n: 5 },
];

const isPrimarySubject = (name) =>
  /^(physics|chemistry|mathematics)$/i.test(String(name || "").trim());

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("math")) return "Mathematics";
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  return String(raw || "").trim();
};

const normalizeOptions = (options) => {
  const next = {};
  for (const [key, value] of Object.entries(options || {})) {
    next[String(key).toUpperCase()] = String(value ?? "").trim();
  }
  return next;
};

const normalizeCorrect = (value) =>
  String(value || "A")
    .toUpperCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");

const collectQuestions = (raw) => {
  const grouped = { Physics: [], Chemistry: [], Mathematics: [] };

  if (raw.subjects && !Array.isArray(raw.subjects)) {
    for (const [rawSubject, items] of Object.entries(raw.subjects)) {
      if (!isPrimarySubject(rawSubject) || !Array.isArray(items)) continue;
      const subject = normalizeSubject(rawSubject);
      for (const item of items) {
        grouped[subject].push({
          q: Number(item.q) || grouped[subject].length + 1,
          type: item.type || null,
          question: String(item.question || "").trim(),
          options: normalizeOptions(item.options),
          correct: normalizeCorrect(item.correct),
          explanation: String(item.explanation || "").trim(),
        });
      }
    }
    return grouped;
  }

  for (const block of raw.subjects || []) {
    if (!isPrimarySubject(block.subject)) continue;
    const subject = normalizeSubject(block.subject);
    for (const section of block.sections || []) {
      for (const item of section.questions || []) {
        grouped[subject].push({
          q: Number(item.q_no) || grouped[subject].length + 1,
          type: section.section_name || null,
          question: String(item.question || "").trim(),
          options: normalizeOptions(item.options),
          correct: normalizeCorrect(item.correct_option || item.correct),
          explanation: String(item.explanation || "").trim(),
        });
      }
    }
  }
  return grouped;
};

const uniqueFirst18 = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.question.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === 18) break;
  }
  return out;
};

const withTopic = (item, topic, q) => {
  const next = { q };
  if (item.type) next.type = item.type;
  next.topic = topic;
  next.question = item.question;
  next.options = item.options;
  next.correct = item.correct;
  next.explanation = item.explanation;
  return next;
};

fs.mkdirSync(OUT, { recursive: true });

const summary = [];

for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectQuestions(raw);
  const paperTopics = TOPICS[spec.paperKey];
  const subjects = {};

  for (const subject of ["Mathematics", "Physics", "Chemistry"]) {
    const items = uniqueFirst18(grouped[subject] || []);
    if (items.length !== 18) {
      throw new Error(`${spec.paperKey} ${subject} has ${items.length} unique questions`);
    }
    subjects[subject] = items.map((item, index) => {
      const q = index + 1;
      const topic = paperTopics[subject][q];
      if (!topic || !ALLOWED[subject].has(topic)) {
        throw new Error(`${spec.paperKey} ${subject} Q${q} has invalid topic: ${topic}`);
      }
      return withTopic(item, topic, q);
    });
  }

  const paper = {
    paper_id: spec.paperKey,
    title: `JEE Advanced Paper ${spec.n}`,
    exam: "JEE Advanced",
    year: 2026,
    subjects,
  };

  const outName = `JEE-ADVANCED-Paper${spec.n}.json`;
  fs.writeFileSync(path.join(OUT, outName), `${JSON.stringify(paper, null, 2)}\n`, "utf8");

  const topicCounts = {};
  for (const subject of ["Mathematics", "Physics", "Chemistry"]) {
    for (const q of subjects[subject]) {
      const key = `${subject} :: ${q.topic}`;
      topicCounts[key] = (topicCounts[key] || 0) + 1;
    }
  }
  summary.push({
    file: outName,
    paper_id: spec.paperKey,
    counts: {
      Mathematics: subjects.Mathematics.length,
      Physics: subjects.Physics.length,
      Chemistry: subjects.Chemistry.length,
    },
    topicsUsed: Object.keys(topicCounts).length,
  });
  console.log(`Wrote ${outName}: 18+18+18, ${Object.keys(topicCounts).length} topic slots`);
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# JEE Advanced question papers

Add more papers here as \`.json\` files, then run:

\`\`\`bash
cd firstedu-backend
npm run seed:jee-advanced
\`\`\`

The seed script reads **every** \`.json\` file in this folder and upserts them into:

- \`jeeadvancedcompetitivepapers\`
- \`jeeadvancedcompetitivequestions\`

## File name

Use any name, for example:

- \`JEE-ADVANCED-Paper6.json\`
- \`JEE_ADVANCED_paper6.json\`

## JSON format

\`\`\`json
{
  "paper_id": "JEE-ADVANCED-Paper6",
  "title": "JEE Advanced Paper 6",
  "subjects": {
    "Mathematics": [
      {
        "q": 1,
        "topic": "Complex Numbers",
        "question": "Question text here",
        "options": {
          "A": "option A",
          "B": "option B",
          "C": "option C",
          "D": "option D"
        },
        "correct": "A",
        "explanation": "Step-by-step solution"
      }
    ],
    "Physics": [],
    "Chemistry": []
  }
}
\`\`\`

Required fields:

- \`paper_id\` — unique key stored in DB (\`JEE-ADVANCED-Paper6\`)
- \`title\` — shown to students
- \`subjects.Mathematics\` / \`Physics\` / \`Chemistry\` — arrays of questions
- each question: \`q\`, \`topic\` (official JEE Advanced 2026 chapter), \`question\`, \`options\` (\`A\`–\`D\`), \`correct\`, \`explanation\`

Topics must match official JEE Advanced 2026 syllabus chapters
(same as 2025; source: jeeadv.ac.in).
`
);

console.log(JSON.stringify(summary, null, 2));
