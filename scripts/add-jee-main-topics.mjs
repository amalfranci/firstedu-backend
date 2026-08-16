import fs from "fs";
import path from "path";

const DIR = path.resolve("files/jee-main-competitive-papers");
const ALT = path.resolve("../JEE MAIN EXAM - PROPER - QUESTIONS SET");

const M = {
  sets: "Sets, Relations and Functions",
  complex: "Complex Numbers and Quadratic Equations",
  matrices: "Matrices and Determinants",
  pnC: "Permutations and Combinations",
  binomial: "Binomial Theorem and its Simple Applications",
  series: "Sequence and Series",
  lcd: "Limit, Continuity and Differentiability",
  integral: "Integral Calculus",
  de: "Differential Equations",
  coord: "Co-ordinate Geometry",
  td: "Three Dimensional Geometry",
  vector: "Vector Algebra",
  stats: "Statistics and Probability",
  trigo: "Trigonometry",
};

const P = {
  units: "Units and Measurements",
  kinematics: "Kinematics",
  lom: "Laws of Motion",
  wep: "Work, Energy and Power",
  rotation: "Rotational Motion",
  gravitation: "Gravitation",
  solids: "Properties of Solids and Liquids",
  thermo: "Thermodynamics",
  ktg: "Kinetic Theory of Gases",
  waves: "Oscillations and Waves",
  electro: "Electrostatics",
  current: "Current Electricity",
  magnetism: "Magnetic Effects of Current and Magnetism",
  emi: "Electromagnetic Induction and Alternating Currents",
  emw: "Electromagnetic Waves",
  optics: "Optics",
  dual: "Dual Nature of Matter and Radiation",
  atoms: "Atoms and Nuclei",
  devices: "Electronic Devices",
};

const C = {
  basic: "Some Basic Concepts in Chemistry",
  atomic: "Atomic Structure",
  bonding: "Chemical Bonding and Molecular Structure",
  thermo: "Chemical Thermodynamics",
  solutions: "Solutions",
  eq: "Equilibrium",
  redox: "Redox Reactions and Electrochemistry",
  kinetics: "Chemical Kinetics",
  periodic: "Classification of Elements and Periodicity in Properties",
  pblock: "p-Block Elements (Group-13 to Group 18 Elements)",
  dblock: "d- and f-Block Elements",
  coord: "Coordination Compounds",
  purify: "Purification and Characterisation of Organic Compounds",
  goc: "Some Basic Principles of Organic Chemistry",
  hc: "Hydrocarbons",
  halo: "Organic Compounds Containing Halogens",
  oxygen: "Organic Compounds Containing Oxygen",
  nitrogen: "Organic Compounds Containing Nitrogen",
  bio: "Biomolecules",
};

const MAP = {
  "JEE_Paper1.json": {
    Mathematics: {
      1: M.matrices, 2: M.lcd, 3: M.vector, 4: M.stats, 5: M.lcd,
      6: M.integral, 7: M.series, 8: M.matrices, 9: M.complex, 10: M.pnC,
      11: M.binomial, 12: M.series, 13: M.td, 14: M.de, 15: M.coord,
      16: M.coord, 17: M.stats, 18: M.stats, 19: M.integral, 20: M.trigo,
      21: M.sets, 22: M.integral, 23: M.stats, 24: M.trigo, 25: M.stats,
    },
    Chemistry: {
      1: C.solutions, 2: C.solutions, 3: C.solutions, 4: C.atomic, 5: C.kinetics,
      6: C.solutions, 7: C.redox, 8: C.bonding, 9: C.goc, 10: C.oxygen,
      11: C.coord, 12: C.pblock, 13: C.coord, 14: C.oxygen, 15: C.bio,
      16: C.thermo, 17: C.halo, 18: C.eq, 19: C.pblock, 20: C.oxygen,
      21: C.eq, 22: C.dblock, 23: C.bio, 24: C.eq, 25: C.coord,
    },
    Physics: {
      1: P.wep, 2: P.wep, 3: P.waves, 4: P.units, 5: P.kinematics,
      6: P.lom, 7: P.rotation, 8: P.gravitation, 9: P.thermo, 10: P.thermo,
      11: P.electro, 12: P.current, 13: P.magnetism, 14: P.emi, 15: P.emi,
      16: P.optics, 17: P.optics, 18: P.dual, 19: P.atoms, 20: P.atoms,
      21: P.devices, 22: P.waves, 23: P.waves, 24: P.solids, 25: P.electro,
    },
  },
  "JEE_Paper2.json": {
    Physics: {
      1: P.kinematics, 2: P.lom, 3: P.lom, 4: P.rotation, 5: P.gravitation,
      6: P.solids, 7: P.solids, 8: P.thermo, 9: P.ktg, 10: P.waves,
      11: P.waves, 12: P.electro, 13: P.electro, 14: P.current, 15: P.magnetism,
      16: P.emi, 17: P.emi, 18: P.optics, 19: P.optics, 20: P.dual,
      21: P.wep, 22: P.electro, 23: P.emi, 24: P.atoms, 25: P.dual,
    },
    Chemistry: {
      1: C.atomic, 2: C.thermo, 3: C.bonding, 4: C.solutions, 5: C.redox,
      6: C.kinetics, 7: C.bonding, 8: C.periodic, 9: C.coord, 10: C.goc,
      11: C.hc, 12: C.oxygen, 13: C.oxygen, 14: C.oxygen, 15: C.nitrogen,
      16: C.bio, 17: C.dblock, 18: C.dblock, 19: C.eq, 20: C.coord,
      21: C.basic, 22: C.kinetics, 23: C.solutions, 24: C.redox, 25: C.kinetics,
    },
    Mathematics: {
      1: M.complex, 2: M.trigo, 3: M.series, 4: M.binomial, 5: M.series,
      6: M.lcd, 7: M.lcd, 8: M.integral, 9: M.integral, 10: M.de,
      11: M.coord, 12: M.coord, 13: M.vector, 14: M.td, 15: M.trigo,
      16: M.stats, 17: M.stats, 18: M.sets, 19: M.matrices, 20: M.pnC,
      21: M.lcd, 22: M.td, 23: M.binomial, 24: M.integral, 25: M.integral,
    },
  },
  "JEE_Paper3.json": {
    Physics: {
      1: P.kinematics, 2: P.lom, 3: P.gravitation, 4: P.rotation, 5: P.thermo,
      6: P.waves, 7: P.electro, 8: P.electro, 9: P.current, 10: P.magnetism,
      11: P.magnetism, 12: P.emi, 13: P.emi, 14: P.emw, 15: P.optics,
      16: P.optics, 17: P.dual, 18: P.dual, 19: P.atoms, 20: P.atoms,
      21: P.devices, 22: P.devices, 23: P.units, 24: P.units, 25: P.waves,
    },
    Chemistry: {
      1: C.atomic, 2: C.bonding, 3: C.bonding, 4: C.thermo, 5: C.eq,
      6: C.kinetics, 7: C.redox, 8: C.redox, 9: C.pblock, 10: C.pblock,
      11: C.oxygen, 12: C.halo, 13: C.oxygen, 14: C.hc, 15: C.goc,
      16: C.goc, 17: C.bio, 18: C.basic, 19: C.solutions, 20: C.redox,
      21: C.coord, 22: C.coord, 23: C.oxygen, 24: C.bio, 25: C.eq,
    },
    Mathematics: {
      1: M.sets, 2: M.sets, 3: M.complex, 4: M.series, 5: M.pnC,
      6: M.binomial, 7: M.matrices, 8: M.matrices, 9: M.lcd, 10: M.lcd,
      11: M.lcd, 12: M.lcd, 13: M.integral, 14: M.integral, 15: M.integral,
      16: M.de, 17: M.td, 18: M.vector, 19: M.td, 20: M.stats,
      21: M.stats, 22: M.trigo, 23: M.trigo, 24: M.coord, 25: M.coord,
    },
  },
};

const insertTopicAfterQ = (obj, topic) => {
  const next = { q: obj.q };
  if (obj.global_q != null) next.global_q = obj.global_q;
  if (obj.section != null) next.section = obj.section;
  next.topic = topic;
  for (const [key, value] of Object.entries(obj)) {
    if (["q", "global_q", "section", "topic"].includes(key)) continue;
    next[key] = value;
  }
  return next;
};

const processFile = (filePath, fileName) => {
  const paper = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const map = MAP[fileName];
  if (!map) throw new Error(`No topic map for ${fileName}`);

  let tagged = 0;
  let missing = [];
  for (const [subject, questions] of Object.entries(paper.subjects || {})) {
    const subjectMap = map[subject];
    if (!subjectMap) {
      missing.push(`${fileName} missing subject map: ${subject}`);
      continue;
    }
    paper.subjects[subject] = questions.map((item) => {
      const topic = subjectMap[item.q];
      if (!topic) {
        missing.push(`${fileName} ${subject} q${item.q}`);
        return item;
      }
      tagged += 1;
      return insertTopicAfterQ(item, topic);
    });
  }

  fs.writeFileSync(filePath, `${JSON.stringify(paper, null, 2)}\n`);
  return { tagged, missing };
};

const files = ["JEE_Paper1.json", "JEE_Paper2.json", "JEE_Paper3.json"];
const summary = [];
for (const fileName of files) {
  const result = processFile(path.join(DIR, fileName), fileName);
  summary.push({ file: fileName, dir: DIR, ...result });
  const altPath = path.join(ALT, fileName);
  if (fs.existsSync(altPath)) {
    const alt = processFile(altPath, fileName);
    summary.push({ file: fileName, dir: ALT, ...alt });
  }
}

console.log(JSON.stringify(summary, null, 2));
