import fs from "fs";
import path from "path";

const SRC = path.resolve("../JEE MAIN ADVANCE");
const DEST = path.resolve("files/jee-advanced-competitive-papers");
fs.mkdirSync(DEST, { recursive: true });

const SUBJECT_KEYS = {
  physics: "Physics",
  chemistry: "Chemistry",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
};

const TOPIC_RULES = {
  Physics: [
    ["Units, Dimensions, Errors and Experimental Physics", /dimension|percentage error|least count|vernier|screw gauge/i],
    ["Kinematics", /projectil|velocity|displacement|acceleration|kinematic|range|maximum height/i],
    ["Newton's Laws of Motion and Friction", /friction|block|inclined|tension|impulse|string becomes taut|contact force/i],
    ["Work, Energy and Power", /work done|kinetic energy|potential energy|power delivered|elastic collision/i],
    ["Rotational Motion", /rod|torque|angular|moment of inertia|pure rolling|hinged|sphere.*roll|cylinder/i],
    ["Gravitation", /earth|satellite|escape|gravity|orbit|hemisphere of radius/i],
    ["Properties of Solids and Liquids", /young|elastic|viscosity|terminal|capillar|bernoulli|pipe/i],
    ["Heat and Thermodynamics", /ideal gas|carnot|adiabatic|isothermal|polytropic|heat capacit|entropy|heat engine/i],
    ["Kinetic Theory of Gases", /rms|v_rms|mean free|degree of freedom|diatomic/i],
    ["Oscillations and Waves", /shm|simple harmonic|pendulum|organ pipe|tuning fork|spring of constant/i],
    ["Electrostatics", /charge|capacitor|dielectric|electric field|potential|gauss|sphere.*charge/i],
    ["Current Electricity", /resistance|wheatstone|meter bridge|galvanometer|current.*wire|ohm/i],
    ["Magnetic Effects of Current and Magnetism", /magnetic field|biot|ampere|coil|loop.*current|dipole.*magnetic/i],
    ["Electromagnetic Induction and Alternating Currents", /mutual inductance|induced|flux|lcr|inductor|ac source/i],
    ["Electromagnetic Waves", /electromagnetic wave|energy density|poynting/i],
    ["Optics", /lens|mirror|young|slit|fringe|refractive|critical angle|prism/i],
    ["Modern Physics", /photoelect|de broglie|hydrogen atom|bohr|radioactive|decay|photon|spectral/i],
    ["Electronic Devices", /diode|semiconductor|logic|p-n|n-type/i],
  ],
  Chemistry: [
    ["Atomic Structure", /quantum|orbital|radial node|bohr|hydrogen-like|n =|principal quantum/i],
    ["Chemical Bonding and Molecular Structure", /hybrid|vsepr|mot|molecular orbital|bond order|xeF|dipole|diamagnetic/i],
    ["Chemical Thermodynamics", /enthalpy|internal energy|isothermal|δu|delta u|work done.*gas/i],
    ["Equilibrium", /kc|kp|buffer|ph|le chatelier|equilibrium constant/i],
    ["Redox Reactions and Electrochemistry", /electrode|emf|nernst|oxidation state|conductiv|cell reaction/i],
    ["Chemical Kinetics", /first-order|half-life|rate constant|order of the reaction/i],
    ["Solutions", /boiling point|freezing|molality|raoult|colligative/i],
    ["Classification of Elements and Periodicity in Properties", /ionization enthalpy|periodic|first ionization/i],
    ["p-Block Elements", /hydride|group 16|pcl5|ozone|halogen/i],
    ["d- and f-Block Elements", /transition|cr in|k2cr2o7|colourless|unpaired electrons/i],
    ["Coordination Compounds", /complex|iupac name.*\[|cfse|isomerism|linkage|en\)/i],
    ["Some Basic Principles of Organic Chemistry", /carbocation|chiral|optical|sn1|sn2|stereoisomer/i],
    ["Hydrocarbons", /alkene|ozonolysis|markovnikov|benzene|ethyl benzene/i],
    ["Organic Compounds Containing Halogens", /alkyl halide|williamson/i],
    ["Organic Compounds Containing Oxygen", /phenol|reimer|tollen|aldol|ether|carbonyl|aldehyde|ketone/i],
    ["Organic Compounds Containing Nitrogen", /amine|aniline|hinsberg|diazonium/i],
    ["Biomolecules", /glucose|sucrose|disaccharide|amino|dna|rna/i],
    ["Some Basic Concepts in Chemistry", /mole|stoich|combustion|22g of co2/i],
  ],
  Mathematics: [
    ["Sets, Relations and Functions", /relation|domain|function f\(|one-one|onto/i],
    ["Complex Numbers", /complex|arg\(|modulus|cube root|1 \+ i/i],
    ["Quadratic Equations", /roots of|α and β|quadratic/i],
    ["Sequences and Series", /infinite series|ap|gp|sum of the|a_n|p_n/i],
    ["Logarithms, Permutations and Combinations", /digit|permutation|combination|ways|formed using/i],
    ["Binomial Theorem", /coefficient of x|expansion of/i],
    ["Matrices and Determinants", /matrix|det|adj\(|system of linear|concurrent/i],
    ["Probability", /probability|dice|bag contains|conditional/i],
    ["Statistics", /mean|variance|median/i],
    ["Trigonometry", /sin|cos|tan|inverse|principal value/i],
    ["Straight Lines (2D Analytical Geometry)", /line|locus|distance from/i],
    ["Circles", /circle/i],
    ["Conic Sections (Parabola, Ellipse, Hyperbola)", /parabola|ellipse|hyperbola|eccentricity|latus/i],
    ["Three Dimensional Geometry", /shortest distance|planes|direction cosine|3d|z=/i],
    ["Vectors", /vector|cross product|dot product|coplanar|projection/i],
    ["Limits, Continuity and Differentiability", /limit|differentiable|derivative|maxima|f'\(/i],
    ["Integral Calculus", /integral|area bounded|definite/i],
    ["Differential Equations", /differential equation|dy\/dx/i],
  ],
};

const assignTopic = (subject, text) => {
  const rules = TOPIC_RULES[subject] || [];
  for (const [topic, re] of rules) {
    if (re.test(text)) return topic;
  }
  return subject === "Physics"
    ? "Modern Physics"
    : subject === "Chemistry"
      ? "Some Basic Concepts in Chemistry"
      : "Limits, Continuity and Differentiability";
};

const clean = (s = "") =>
  String(s)
    .replace(/\s+/g, " ")
    .replace(/Page \d+/gi, "")
    .replace(/-- \d+ of \d+ --/g, "")
    .trim();

const optionKey = (raw) => String(raw || "").toUpperCase().replace(/[^A-D]/g, "");

const parseCorrect = (block) => {
  const m =
    block.match(/Correct Option(?:\(s\))?\s*:\s*\(?([A-D](?:\s*,\s*[A-D])*)\)?/i) ||
    block.match(/Correct Option\s*:\s*\(([A-D])\)/i);
  if (!m) return "A";
  const keys = m[1]
    .split(",")
    .map((x) => optionKey(x))
    .filter(Boolean);
  return keys.length > 1 ? keys.join(",") : keys[0] || "A";
};

const parseOptions = (block) => {
  const options = {};
  const lineRe = /(?:^|\n)\s*\(([A-D])\)\s*([^\n]+)/g;
  let m;
  while ((m = lineRe.exec(block))) {
    options[m[1].toUpperCase()] = clean(m[2]);
  }
  if (Object.keys(options).length < 2) {
    const pipeRe = /Option\s+([A-D])\s*[:.]\s*([^|]+)/gi;
    while ((m = pipeRe.exec(block))) {
      options[m[1].toUpperCase()] = clean(m[2]);
    }
  }
  if (Object.keys(options).length < 2) {
    const looseRe = /\(([A-D])\)\s*([\s\S]*?)(?=\s*\([A-D]\)|Correct Option|Option\s+[A-D]|$)/gi;
    while ((m = looseRe.exec(block))) {
      const text = clean(m[2]);
      if (text) options[m[1].toUpperCase()] = text;
    }
  }
  return options;
};

const parseExplanation = (block) => {
  const m = block.match(/Explanation\s*:?\s*([\s\S]*)$/i);
  return clean(m?.[1] || "");
};

const splitBySubject = (text) => {
  const headerRe =
    /(?:^|\n)\s*(?:JEE Advanced\s*[-–:]?\s*)?(PHYSICS|CHEMISTRY|MATHEMATICS|MATHS|Physics|Chemistry|Mathematics|Maths)\b(?:\s+Section|\s+Practice|\s+-|\s|$)/g;
  const first = {};
  for (const hit of text.matchAll(headerRe)) {
    const subject = SUBJECT_KEYS[hit[1].toLowerCase()] || hit[1];
    if (first[subject] == null) first[subject] = hit.index;
  }
  const ordered = Object.entries(first).sort((a, b) => a[1] - b[1]);
  if (!ordered.length) return { Physics: text };
  const parts = {};
  ordered.forEach(([subject, start], i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1][1] : text.length;
    parts[subject] = text.slice(start, end);
  });
  return parts;
};

const splitQuestions = (subjectText) => {
  const re =
    /(?:^|\n)\s*(?:Q\.\s*|Q\s*|Question\s+|SINGLE CORRECT MCQ\s*)(\d+)[\).:\s-]+/gi;
  const hits = [...subjectText.matchAll(re)];
  if (hits.length < 3) return [];
  return hits.map((hit, i) => {
    const start = hit.index + hit[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : subjectText.length;
    return {
      q: Number(hit[1]),
      body: subjectText.slice(start, end),
    };
  });
};

const toQuestion = (subject, item) => {
  const body = item.body;
  const beforeCorrect = body.split(/Correct Option(?:\(s\))?\s*:/i)[0] || body;
  const qMatch = beforeCorrect.match(/^([\s\S]*?)(?=\s*\(A\))/);
  const question = clean(qMatch?.[1] || beforeCorrect)
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/^\((?:MCQ|MSQ)\)\s*/i, "")
    .replace(/^Single Correct[^\s]*\s*/i, "")
    .trim();
  const options = parseOptions(beforeCorrect);
  const correct = parseCorrect(body);
  const explanation = parseExplanation(body);
  const topic = assignTopic(subject, `${question} ${explanation}`);
  return {
    q: item.q,
    topic,
    question,
    options,
    correct,
    explanation,
  };
};

const FILES = [
  { file: "1. JEE Advanced.txt", paper_id: "JEE-ADVANCED-Paper1", title: "JEE Advanced Paper 1" },
  { file: "2. JEE Advanced.txt", paper_id: "JEE-ADVANCED-Paper2", title: "JEE Advanced Paper 2" },
  { file: "3. JEE_Advance.txt", paper_id: "JEE-ADVANCED-Paper3", title: "JEE Advanced Paper 3" },
  { file: "4. JEE_Advance.txt", paper_id: "JEE-ADVANCED-Paper4", title: "JEE Advanced Paper 4" },
  { file: "5. JEE_Advance.txt", paper_id: "JEE-ADVANCED-Paper5", title: "JEE Advanced Paper 5" },
];

const summary = [];
for (const spec of FILES) {
  const raw = fs.readFileSync(path.join(SRC, spec.file), "utf8");
  const blocks = splitBySubject(raw);
  const subjects = {};
  for (const [subject, text] of Object.entries(blocks)) {
    const seen = new Set();
    const items = [];
    for (const item of splitQuestions(text).map((row) => toQuestion(subject, row))) {
      if (!item.question || item.question.length <= 12) continue;
      if (Object.keys(item.options).length < 2) continue;
      if (seen.has(item.q)) continue;
      seen.add(item.q);
      items.push(item);
      if (items.length >= 18) break;
    }
    if (items.length) subjects[subject] = items;
  }
  const paper = {
    paper_id: spec.paper_id,
    title: spec.title,
    subjects,
  };
  const destName = `${spec.paper_id}.json`;
  fs.writeFileSync(path.join(DEST, destName), `${JSON.stringify(paper, null, 2)}\n`);
  fs.writeFileSync(path.join(SRC, destName), `${JSON.stringify(paper, null, 2)}\n`);
  const counts = Object.fromEntries(
    Object.entries(subjects).map(([s, qs]) => [s, qs.length])
  );
  summary.push({ file: spec.file, destName, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}

console.log(JSON.stringify(summary, null, 2));
