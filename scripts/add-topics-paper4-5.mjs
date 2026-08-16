import fs from "fs";
import path from "path";

const SRC = path.resolve("../JEE MAIN EXAM - PROPER - QUESTIONS SET");
const DEST = path.resolve("files/jee-main-competitive-papers");

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
  goc: "Some Basic Principles of Organic Chemistry",
  hc: "Hydrocarbons",
  halo: "Organic Compounds Containing Halogens",
  oxygen: "Organic Compounds Containing Oxygen",
  nitrogen: "Organic Compounds Containing Nitrogen",
  bio: "Biomolecules",
  practical: "Principles Related to Practical Chemistry",
};

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

const MAP = {
  "JEE_MAINS_paper4.json": {
    Physics: {
      1: P.kinematics, 2: P.kinematics, 3: P.lom, 4: P.wep, 5: P.rotation,
      6: P.gravitation, 7: P.solids, 8: P.solids, 9: P.thermo, 10: P.thermo,
      11: P.waves, 12: P.electro, 13: P.electro, 14: P.current, 15: P.magnetism,
      16: P.magnetism, 17: P.emi, 18: P.emi, 19: P.emw, 20: P.optics,
      21: P.optics, 22: P.dual, 23: P.atoms, 24: P.atoms, 25: P.devices,
    },
    Chemistry: {
      1: C.atomic, 2: C.periodic, 3: C.bonding, 4: C.thermo, 5: C.eq,
      6: C.eq, 7: C.dblock, 8: C.redox, 9: C.kinetics, 10: C.solutions,
      11: C.pblock, 12: C.coord, 13: C.dblock, 14: C.coord, 15: C.halo,
      16: C.oxygen, 17: C.oxygen, 18: C.nitrogen, 19: C.bio, 20: C.nitrogen,
      21: C.hc, 22: C.hc, 23: C.goc, 24: C.dblock, 25: C.pblock,
    },
    Mathematics: {
      1: M.lcd, 2: M.lcd, 3: M.complex, 4: M.series, 5: M.integral,
      6: M.integral, 7: M.de, 8: M.vector, 9: M.td, 10: M.td,
      11: M.binomial, 12: M.matrices, 13: M.pnC, 14: M.stats, 15: M.trigo,
      16: M.trigo, 17: M.coord, 18: M.coord, 19: M.coord, 20: M.complex,
      21: M.lcd, 22: M.integral, 23: M.td, 24: M.vector, 25: M.series,
    },
  },
  "JEE_MAINS_paper5.json": {
    Physics: {
      1: P.units, 2: P.kinematics, 3: P.lom, 4: P.wep, 5: P.wep,
      6: P.rotation, 7: P.gravitation, 8: P.solids, 9: P.solids, 10: P.thermo,
      11: P.ktg, 12: P.waves, 13: P.waves, 14: P.electro, 15: P.electro,
      16: P.current, 17: P.magnetism, 18: P.emi, 19: P.emi, 20: P.emw,
      21: P.optics, 22: P.optics, 23: P.dual, 24: P.atoms, 25: P.devices,
    },
    Chemistry: {
      1: C.atomic, 2: C.atomic, 3: C.bonding, 4: C.thermo, 5: C.eq,
      6: C.redox, 7: C.kinetics, 8: C.solutions, 9: C.dblock, 10: C.coord,
      11: C.pblock, 12: C.periodic, 13: C.goc, 14: C.hc, 15: C.oxygen,
      16: C.oxygen, 17: C.oxygen, 18: C.nitrogen, 19: C.bio, 20: C.basic,
      21: C.eq, 22: C.thermo, 23: C.bonding, 24: C.coord, 25: C.dblock,
    },
    Mathematics: {
      1: M.matrices, 2: M.complex, 3: M.series, 4: M.series, 5: M.binomial,
      6: M.pnC, 7: M.stats, 8: M.lcd, 9: M.lcd, 10: M.lcd,
      11: M.integral, 12: M.integral, 13: M.de, 14: M.coord, 15: M.coord,
      16: M.coord, 17: M.vector, 18: M.td, 19: M.trigo, 20: M.stats,
      21: M.sets, 22: M.trigo, 23: M.coord, 24: M.integral, 25: M.matrices,
    },
  },
};

const insertTopic = (obj, topic) => {
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

const processFile = (fileName) => {
  const srcPath = path.join(SRC, fileName);
  const paper = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const map = MAP[fileName];
  let tagged = 0;
  const missing = [];
  for (const [subject, questions] of Object.entries(paper.subjects || {})) {
    paper.subjects[subject] = questions.map((item) => {
      const topic = map?.[subject]?.[item.q];
      if (!topic) {
        missing.push(`${fileName} ${subject} q${item.q}`);
        return item;
      }
      tagged += 1;
      return insertTopic(item, topic);
    });
  }
  const json = `${JSON.stringify(paper, null, 2)}\n`;
  fs.writeFileSync(srcPath, json);
  fs.writeFileSync(path.join(DEST, fileName), json);
  return { fileName, tagged, missing };
};

const result = [
  processFile("JEE_MAINS_paper4.json"),
  processFile("JEE_MAINS_paper5.json"),
];
console.log(JSON.stringify(result, null, 2));
