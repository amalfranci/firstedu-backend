import fs from "fs";
import path from "path";

const SRC = path.resolve("../NEET EXAM-JSON -FILE");
const OUT = path.resolve("files/neet-competitive-papers");

const P = {
  measure: "Physics and Measurement",
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
  experimental: "Experimental Skills",
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
  pblock: "p-Block Elements",
  dblock: "d- and f-Block Elements",
  coord: "Coordination Compounds",
  purify: "Purification and Characterisation of Organic Compounds",
  goc: "Some Basic Principles of Organic Chemistry",
  hc: "Hydrocarbons",
  halo: "Organic Compounds Containing Halogens",
  oxygen: "Organic Compounds Containing Oxygen",
  nitrogen: "Organic Compounds Containing Nitrogen",
  bio: "Biomolecules",
  practical: "Principles Related to Practical Chemistry",
};

const B = {
  diversity: "Diversity in the Living World",
  structure: "Structural Organisation in Animals and Plants",
  cell: "Cell Structure and Function",
  plantPhys: "Plant Physiology",
  humanPhys: "Human Physiology",
  repro: "Reproduction",
  genetics: "Genetics and Evolution",
  welfare: "Biology and Human Welfare",
  biotech: "Biotechnology and its Applications",
  ecology: "Ecology and Environment",
};

const ALLOWED = {
  Physics: new Set(Object.values(P)),
  Chemistry: new Set(Object.values(C)),
  Botany: new Set(Object.values(B)),
  Zoology: new Set(Object.values(B)),
};

const rule = (re, topic) => ({ re: new RegExp(re, "i"), topic });

const PHYSICS_RULES = [
  rule("dimensional formula|dimensions of|unit of|significant figure|error in|percentage error|si unit", P.measure),
  rule("vernier|screw gauge|least count|experimental|potentiometer (is|are)|meter bridge|post office box", P.experimental),
  rule("photoelectric|work function|de broglie|photon|dual nature|matter wave", P.dual),
  rule("bohr|hydrogen atom|radioactiv|half[- ]life|binding energy|nucleus|nuclei|alpha.?decay|beta.?decay|gamma ray|mass defect", P.atoms),
  rule("nand gate|nor gate|boolean|diode|transistor|semiconductor|zener|p-n|pn junction|logic gate|led\\b|forward bias|reverse bias", P.devices),
  rule("young.?s double|interference|diffraction|polariz|brewster|huygens|fringe width", P.optics),
  rule("lens|mirror|prism|refraction|reflection|focal length|optical|snell|critical angle|magnification|compound microscope|telescope|refractive index|refractive indices|rarer medium|denser medium|speed of light in|ray of light", P.optics),
  rule("electromagnetic wave|displacement current|maxwell|em spectrum", P.emw),
  rule("mutual induct|self induct|faraday|lenz|transformer|lcr|impedance|alternating current|ac (source|circuit)|rms voltage|induced emf|induced current|purely capacitive|phase difference between current and voltage", P.emi),
  rule("magnetic field|biot|ampere|solenoid|cyclotron|galvanometer|magnetic moment|torque.*(magnet|needle)|permeability|\\bmu0\\b|\\bμ0\\b|angle of dip|magnetic equator", P.magnetism),
  rule("capacitor|capacitance|dielectric|gauss|electric flux|electric dipole|electric field|electric potential|point charge|coulomb", P.electro),
  rule("kirchhoff|wheatstone|ohm.?s law|resistivity|resistance|current electricity|internal resistance|drift velocity|cell.*emf|series.*parallel.*resist", P.current),
  rule("kinetic theory|rms speed|root mean square speed|mean free path|degree of freedom|\\bcv\\b|\\bcp\\b|ideal gas.*molecule|speed of sound in (oxygen|nitrogen)", P.ktg),
  rule("carnot|entropy|isothermal|adiabatic|first law of thermo|calorimet|latent heat|heat engine|thermodynamic|black body|radiates heat|cools from|newton.?s law of cooling|refrigerator|coefficient of performance", P.thermo),
  rule("surface tension|viscosity|stokes|bernoulli|capillar|young.?s modulus|bulk modulus|stress|strain|elasticity|buoyan|archimedes|equation of continuity|fluid", P.solids),
  rule("simple harmonic|shm|time period.*spring|spring constant k oscillat|pendulum|organ pipe|doppler|standing wave|progressive wave|wavelength.*string|resonance column|beats\\b|phase difference between the two waves", P.waves),
  rule("escape veloc|satellite|kepler|gravitat|orbital|\\bGM\\b|earth.?s radius|height equal to the earth", P.gravitation),
  rule("moment of inertia|angular momentum|torque|rolling|centre of mass|center of mass|rigid body|rotat", P.rotation),
  rule("kinetic energy|potential energy|work done|power\\b|collision|conservat\\w* of (mechanical )?energy", P.wep),
  rule("friction|newton.?s law|tension|pulley|impulse|linear momentum|coefficient of friction|banked", P.lom),
  rule("dimension|unit of|significant figure|error in|percentage error|least count|si unit", P.measure),
  rule("projectile|displacement|velocity|acceleration|relative velocity|straight line.*time|centripetal|circular motion|moves in circle|average speed", P.kinematics),
  rule("when light travels|property remains unchanged", P.optics),
];

const CHEMISTRY_RULES = [
  rule("chromatograph|distillation|lassaigne|purif|characteris\\w* of organic|carius|keldahl|kjeldahl", C.purify),
  rule("polymer|polyamide|thermosetting|biodegradable|soap|detergent|antacid|greenhouse|global warming|atmospheric pollutant", C.practical),
  rule("langmuir|adsorption|catalyst surface|colloids?", C.practical),
  rule("glucose|fructose|amino acid|peptide|protein|dna|rna|carbohydrate|enzyme|vitamin|nucleic", C.bio),
  rule("aniline|amine|diazonium|hoffmann|carbylamine|isocyanide|hinsberg", C.nitrogen),
  rule("phenol|alcohol|ether|aldehyde|ketone|carboxylic|ester|aldol|cannizzaro|tollens|fehling|iodoform|carbonyl|lucas test|enolic form of acetone", C.oxygen),
  rule("alkyl halide|haloalkane|haloarene|sn1|sn2|grignard|chloroform|freon", C.halo),
  rule("alkane|alkene|alkyne|benzene|toluene|aromatic|markovnikov|ozonolysis|hydrocarbon|wurtz|cyclohexane|n-butane|ethyne|acetylene", C.hc),
  rule("inductive|resonance|hyperconjugat|carbocation|carbanion|iupac|isomerism|hybridis\\w* of carbon|optical isomer|enantiomer|conformation", C.goc),
  rule("coordination|ligand|cfse|werner|chelate|crystal field|complex ion|\\[co|\\[fe|\\[ni|\\[cr", C.coord),
  rule("transition|lanthanoid|actinoid|d-block|f-block|coloured ion|catalytic.*transition|k2cr2o7|k₂cr₂o₇|atomic number 25|maximum oxidation state of \\+7|extracted by carbon reduction", C.dblock),
  rule("boron|borax|diborane|silic|xenon|noble gas|interhalogen|p-block|group 1[3-8]|oxoacid|phosphorus|sulphur|sulfuric|nitric acid|amphoteric|contact process|ellingham|self-reduction of copper|cu2o|cu₂o", C.pblock),
  rule("periodic table|ionisation|ionization enthalpy|electronegativ|atomic radius|ionic radi|electron gain|isoelectronic", C.periodic),
  rule("rate constant|order of reaction|half-life|arrhenius|activation energy|chemical kinetic|first-order|zero-order", C.kinetics),
  rule("nernst|electrolysis|faraday|galvanic|electrolytic|electrode potential|standard hydrogen electrode|conductivity|molar conductance|cell potential|redox|emf of|oxidation state|standard reduction potential", C.redox),
  rule("buffer|\\bka\\b|\\bkb\\b|pka|solubility product|ksp|le chatelier|equilibrium constant|\\bkp\\b|\\bkc\\b|ph of|weak acid|ionic product|inert gas at constant volume", C.eq),
  rule("raoult|colligative|van.?t hoff|molality|elevation of boiling|depression of freezing|osmotic|ideal solution", C.solutions),
  rule("enthalpy|entropy|gibbs|hess|spontaneous|exothermic|\\bdelta h\\b|\\bδh\\b|internal energy|first law|intensive thermodynamic", C.thermo),
  rule("hybridis|hybridization|vsepr|molecular orbital|bond order|dipole moment|hydrogen bond|paramagnetic|diamagnetic|sf6", C.bonding),
  rule("quantum number|orbital|aufbau|hund|pauli|bohr|de broglie|photoelectric.*electron|wavelength of electron", C.atomic),
  rule("mole|molarity|empirical|stoichiometr|limiting reagent|avagadro|avogadro|molar mass|number of moles|ideal gas|gas law|charles|boyle|pressure and density|compressibility factor|unit cell|face-centered|fcc", C.basic),
];

const BIO_RULES = [
  rule("restriction (enzyme|endonuclease)|plasmid|pcr\\b|recombinant|vector dna|bt cotton|bacillus thuringiensis|cry toxin|rna interference|gel electrophor|agarose|biotech|transgenic|gene therapy|insulin.*recombinant|ecori", B.biotech),
  rule("ecosystem|food chain|food web|pyramid of|biodiversity|hotspot|sacred grove|conservation|population growth|natality|carrying capacity|ozone|ecological succession|species-area|allen.?s rule|phosphorus cycle|decomposition|leaching|competitive exclusion|gause|lichen|nitrosomonas|nitrogen cycle", B.ecology),
  rule("immunity|antibody|antigen|pathogen|malaria|plasmodium|anopheles|aids|hiv|cancer|drug abuse|vaccine|filariasis|wuchereria|mast cell|histamine|allergic|disease|microbes in|biofertilizer|azolla|sewage|biogas|statins|antibiotics? produced", B.welfare),
  rule("mendel|linkage|crossing over|mutation|chromosomal|incomplete dominance|pleiotrop|test cross|okazaki|dna ligase|helicase|hershey|chargaff|wobble|codon|hardy.?weinberg|darwin|homologous organ|analogous|evolution|miller-urey|industrial melanism|dna polymerase|transcription|translation|operon|genetic code|pedigree|sex.?link|hemophilia|turner|down.?s syndrome|karyotype|ames test|aminoacyl|x:a ratio|probability that their next|unit of inheritance|unit of heredity|genetic material of|nitrogenous bases is present exclusively in rna|genotype|gametes|adenine pairs|thymine|plant viruses|age of reptiles|geological era", B.genetics),
  rule("spermatogenesis|oogenesis|menstrual|placenta|pregnancy|contraceptive|iud|ivf|zift|art\\b|std\\b|treponema|syphilis|reproductive health|double fertili[sz]|pollen|embryo sac|endosperm|seed formation|anther|ovule|gynoecium|stigma, style|epididymis|extraembryonic|amnion|blastomere|neurulation|cleavage", B.repro),
  rule("photosynthe|calvin|c3|c4|cam plant|chlorophyll|light reaction|photophosphoryl|rubisco|photorespiration|chemiosmotic", B.plantPhys),
  rule("glycolysis|krebs|fermentation|respiration in plant|\\brq\\b|oxidative phosphoryl", B.plantPhys),
  rule("auxin|gibberellin|cytokinin|ethylene|abscisic|plant hormone|photoperiod|vernalis|water potential|stomata|guard cell|hydroponics|nitrogen[- ]fix", B.plantPhys),
  rule("breathing|vital capacity|alveol|lung|gas exchange|chloride shift|oxygenated blood", B.humanPhys),
  rule("cardiac|ecg|blood group|circulation|haemoglobin|hemoglobin|heart (beat|sound)|erythrocyte|serum|plasma protein|renin|juxtaglomerular|blood pressure|dehydration", B.humanPhys),
  rule("nephron|kidney|urea|urine|excret|loop of henle", B.humanPhys),
  rule("sarcomere|muscle|locomotion|skeleton|joint|actin|myosin", B.humanPhys),
  rule("neuron|synapse|reflex|brain|spinal|action potential|meninges|myelin|schwann|serotonin|photoreceptor|fovea|organ of corti|inner ear|cochlea|eye|neural membrane|na\\+/k\\+|sodium.?potassium", B.humanPhys),
  rule("hormone|endocrine|insulin|thyroid|pituitary|adrenal|glucagon|testosterone|estrogen|vitamin synthesized in human skin|ultraviolet", B.humanPhys),
  rule("pharynx|alimentary|digest|pancreatic juice|trypsin|parietal|hydrochloric|starch is initiated|bile|liver|appendix|cecum|larynx|voice box", B.humanPhys),
  rule("mitosis|meiosis|cell cycle|s phase|disjunction|crossing over during", B.cell),
  rule("mitochondri|chloroplast|golgi|endoplasmic|nucleus|plasma membrane|fluid mosaic|cell wall|ribosome|lysosome|prokaryot|eukaryot", B.cell),
  rule("biomolecule|enzyme kinet|competitive inhibit|protein structure|polysaccharide|non-reducing|sucrose|atp\\b|energy currency|fat-soluble vitamin|cofactor|apoenzyme|holoenzyme", B.cell),
  rule("xylem|phloem|meristem|anatomy of|dicot|monocot|tissue system|secondary growth|casparian|collenchyma|sclerenchyma|simple plant tissue|dead cells", B.structure),
  rule("morphology|inflorescence|fabaceae|solanaceae|liliaceae|floral formula|placentation|phyllotaxy|gynobasic|saffron|crocus|pneumatophore", B.structure),
  rule("epithelium|connective tissue|cockroach|earthworm|frog anatomy|compound eye", B.structure),
  rule("porifera|cnidaria|platyhelminthes|annelida|arthropoda|mollusca|echinoderm|chordata|animal kingdom|coelom|cartilaginous|bony fish|agnatha|oviparous|egg-laying|flightless", B.diversity),
  rule("algae|bryophyt|pteridophyt|gymnosperm|angiosperm|plant kingdom|chrysophyt|diatom|insectivorous|root parasite|mycorrhiza|ginger", B.diversity),
  rule("monera|protista|fungi|five kingdom|biological classif|whittaker", B.diversity),
  rule("binomial|taxonomy|taxonomic|living world|icbn|species epithet|lowest unit of taxonomic", B.diversity),
];

const FALLBACK = {
  Physics: P.kinematics,
  Chemistry: C.basic,
  Botany: B.diversity,
  Zoology: B.humanPhys,
};

const normalizeSubject = (raw) => {
  const key = String(raw || "").toLowerCase();
  if (key.startsWith("phys")) return "Physics";
  if (key.startsWith("chem")) return "Chemistry";
  if (key.startsWith("bot")) return "Botany";
  if (key.startsWith("zoo")) return "Zoology";
  if (key.startsWith("bio")) return "Biology";
  return String(raw || "").trim();
};

const matchTopic = (subject, text) => {
  let rules =
    subject === "Physics"
      ? PHYSICS_RULES
      : subject === "Chemistry"
        ? CHEMISTRY_RULES
        : BIO_RULES;
  if (subject === "Botany") {
    rules = rules.filter((item) => item.topic !== B.humanPhys);
  }
  if (subject === "Zoology") {
    rules = rules.filter((item) => item.topic !== B.plantPhys);
  }
  for (const item of rules) {
    if (item.re.test(text)) return { topic: item.topic, matched: true };
  }
  return { topic: FALLBACK[subject] || "", matched: false };
};

const collectFromRaw = (raw) => {
  const grouped = { Physics: [], Chemistry: [], Botany: [], Zoology: [] };

  const push = (subjectRaw, item) => {
    const subject = normalizeSubject(subjectRaw);
    if (!grouped[subject]) return;
    const question = String(item.question || "").trim();
    if (!question) return;
    grouped[subject].push({
      q: Number(item.question_number || item.number || item.q || grouped[subject].length + 1),
      question,
      options: Object.fromEntries(
        Object.entries(item.options || {}).map(([k, v]) => [String(k).toUpperCase(), String(v ?? "").trim()])
      ),
      correct: String(item.correct_option || item.correct || "A").toUpperCase().trim(),
      explanation: String(item.explanation || "").trim(),
    });
  };

  if (raw.subjects && !Array.isArray(raw.subjects)) {
    for (const [subject, items] of Object.entries(raw.subjects)) {
      for (const item of items || []) push(subject, item);
    }
    return grouped;
  }

  const wrap = raw.NEET_Paper_2 || raw.NEET_Paper_3 || raw.NEET_Paper_4 || raw.NEET_Paper_5;
  if (wrap && typeof wrap === "object" && !Array.isArray(wrap)) {
    for (const [subject, items] of Object.entries(wrap)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) push(subject, item);
    }
    return grouped;
  }

  if (Array.isArray(raw.sections)) {
    for (const section of raw.sections) {
      for (const item of section.questions || []) push(section.section_name, item);
    }
    return grouped;
  }

  if (Array.isArray(raw.questions)) {
    for (const item of raw.questions) push(item.subject, item);
  }
  return grouped;
};

const takeFirst = (items, limit = 45) =>
  items.filter((item) => item.question).slice(0, limit);

const FILES = [
  { src: "NEET_Paper_1.json", n: 1 },
  { src: "NEET_Paper_2.json", n: 2 },
  { src: "NEET_Paper_3.json", n: 3 },
  { src: "NEET_Paper_4.json", n: 4 },
  { src: "NEET_Paper_5.json", n: 5 },
];

fs.mkdirSync(OUT, { recursive: true });

const fallbacks = [];
const summary = [];

for (const spec of FILES) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, spec.src), "utf8"));
  const grouped = collectFromRaw(raw);
  const subjects = {};

  for (const subject of ["Physics", "Chemistry", "Botany", "Zoology"]) {
    const items = takeFirst(grouped[subject] || [], 45);
    if (items.length !== 45) {
      throw new Error(`${spec.src} ${subject} has ${items.length} questions`);
    }
    subjects[subject] = items.map((item, index) => {
      const q = index + 1;
      const hay = `${item.question}\n${item.explanation}`;
      const { topic, matched } = matchTopic(subject, hay);
      if (!ALLOWED[subject].has(topic)) {
        throw new Error(`${spec.src} ${subject} Q${q} invalid topic ${topic}`);
      }
      if (!matched) {
        fallbacks.push({ paper: spec.n, subject, q, stem: item.question.slice(0, 160) });
      }
      return {
        q,
        topic,
        question: item.question,
        options: item.options,
        correct: item.correct,
        explanation: item.explanation,
      };
    });
  }

  const paper = {
    paper_id: `NEET-Paper${spec.n}`,
    title: `NEET Paper ${spec.n}`,
    exam: "NEET",
    year: 2026,
    subjects,
  };
  const outName = `NEET-Paper${spec.n}.json`;
  fs.writeFileSync(path.join(OUT, outName), `${JSON.stringify(paper, null, 2)}\n`, "utf8");
  summary.push({
    file: outName,
    counts: Object.fromEntries(
      Object.entries(subjects).map(([k, v]) => [k, v.length])
    ),
  });
  console.log(`Wrote ${outName}: 45+45+45+45`);
}

fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# NEET question papers

Add more papers here as \`.json\` files, then run:

\`\`\`bash
cd firstedu-backend
npm run seed:neet
\`\`\`

The seed script reads **every** \`.json\` file in this folder and upserts them into:

- \`neetcompetitivepapers\`
- \`neetcompetitivequestions\`

## JSON format

\`\`\`json
{
  "paper_id": "NEET-Paper6",
  "title": "NEET Paper 6",
  "subjects": {
    "Physics": [
      {
        "q": 1,
        "topic": "Kinematics",
        "question": "Question text here",
        "options": { "A": "option A", "B": "option B", "C": "option C", "D": "option D" },
        "correct": "A",
        "explanation": "Step-by-step solution"
      }
    ],
    "Chemistry": [],
    "Botany": [],
    "Zoology": []
  }
}
\`\`\`

Topics must match official NEET UG 2026 syllabus chapters/units
(source: \`NEET EXAM-JSON -FILE/NEET_2026_Syllabus.json\` and NTA NEET UG syllabus).
`
);

console.log(JSON.stringify({ papers: summary, fallbackCount: fallbacks.length }, null, 2));
if (fallbacks.length) {
  console.log("\nFALLBACKS:");
  for (const row of fallbacks) {
    console.log(`[P${row.paper} ${row.subject} Q${row.q}] ${row.stem}`);
  }
}
