/**
 * Hard-tier question mandate — generation prompts + deterministic validation.
 * Hard difficulty applies within each question kind (theory / direct / multi_concept);
 * only multi_concept slots must be multi-concept + multi-step + non plug-in.
 */

import { normalizeQuestionTier } from "./difficultyMix.service.js";
import { ISSUE_CATEGORY } from "./topicRelevanceValidation.service.js";
import { getArchetypeBlueprint } from "./conceptArchetypeGuidance.service.js";
import { buildWeightedDifficultyRubricBlock } from "./weightedDifficultyScore.service.js";

export const HARD_MIN_CONCEPTS = 2;
export const HARD_MIN_SOLVE_STEPS = 3;
export const HARD_MIN_SOLUTION_LINES = 4;

/** Non-STEM (UPSC/CLAT/CAT/GK/law/etc.) hard tier has no concept-cluster
 * catalog to check against — the only generic proxy for real elimination
 * depth is having more than one reasoning step. */
export const NON_STEM_HARD_MIN_SOLVE_STEPS = 2;

/** Same STEM detector the solve-first routing gate used to gate on, now
 * relocated here to decide mandate *rigor* (concept clusters vs. generic
 * reasoning-depth checks) rather than whether solve-first runs at all. */
export const isStemProfile = (examProfile = "", subject = "") => {
    const profile = String(examProfile || "").toLowerCase();
    const hay = `${profile} ${String(subject || "").toLowerCase()}`;
    // Biology (NEET Botany / Zoology, life sciences) is NOT computational STEM:
    // its hard tier is conceptual depth / multi-statement NCERT analysis, not
    // numeric concept-fusion. Route it to the conceptual (non-numeric) path so
    // it is not held to the physics-style concept-cluster + numeric mandate.
    if (/\b(botany|zoology|biology|biological|life\s*science)\b/.test(hay)) {
        return false;
    }
    if (profile === "jee_main" || profile === "jee_advanced" || profile === "neet") {
        return true;
    }
    return /\bchem|physics|math|mathematics|engineering|jee|iit|pcm|nta\b/i.test(
        hay
    );
};

export const VETERAN_HARD_MIN_CONCEPTS = 2;
export const VETERAN_HARD_MIN_SOLVE_STEPS = 4;
export const VETERAN_HARD_MIN_SOLUTION_LINES = 5;
export const VETERAN_MIN_STEM_CHARS = 200;
export const VETERAN_MIN_NUMERIC_GIVENS = 3;

/** Coaching-book templates veterans memorize — fail even with ≥4 solve steps. */
const VETERAN_COACHING_DRILL_PATTERNS = [
    {
        re: /van\s*der\s*waals|work done (?:on|by) the (?:gas|system).*(?:expansion|compression)|w\s*=\s*[-−]?\s*p(?:_|\s*)?ext/i,
        message:
            "Van der Waals / gas-expansion work template — coaching veterans solve by plug-in; deepen with coupled stages or non-standard path.",
    },
    {
        re: /compton\s+scattering|change in (?:the )?wavelength.*(?:photon|scattered)|Δλ\s*=\s*\(?\s*h\s*\/\s*\(?\s*m/i,
        message:
            "Compton Δλ template — too familiar for veteran JEE; use comparative or constraint-heavy setup.",
    },
    {
        re: /binary\s+(?:star|system).*(?:gravitational potential|center of mass|mid[- ]?point|separation)/i,
        message:
            "Binary-star gravitation midpoint template — repeats across batches; use non-standard orbit/energy linkage.",
    },
    {
        re: /capillary.*(?:rise|height).*(?:percentage|percent|%\s*(?:change|increase|decrease))/i,
        message:
            "Capillary rise percentage-change drill — chapter-test ease for veterans.",
    },
    {
        re: /ratio of (?:the )?(?:de\s+broglie|wavelength|kinetic energy|momenta)/i,
        message:
            "Single-formula comparative ratio drill — veterans recall constants; add linked constraints.",
    },
    {
        re: /photoelectric.*stopping potential.*wavelength|stopping potential.*(?:changed|halved|doubled)/i,
        message:
            "Photoelectric stopping-potential swap template — below veteran bar without multi-stage linkage.",
    },
];

export const detectCoachingTemplateDrill = (stem = "") => {
    const text = String(stem || "");
    for (const { re, message } of VETERAN_COACHING_DRILL_PATTERNS) {
        if (re.test(text)) return message;
    }
    return null;
};

const countNumericGivens = (stem = "") => {
    const matches =
        String(stem || "").match(
            /\d+(?:\.\d+)?(?:\s*(?:×|x|\*)\s*10\s*(?:\^|⁻)?[-−]?\d+|\s*\/\s*\d+)?/gi
        ) || [];
    return new Set(matches.map((m) => m.replace(/\s+/g, "").toLowerCase())).size;
};

/** When on (default), JEE/NEET/CAT generation targets coaching veterans — not first-attempt ease. */
export const isVeteranDifficultyEnabled = () =>
    process.env.AI_QB_VETERAN_DIFFICULTY !== "0";

/** When off (default), failed LLM difficulty audits trigger regen — not in-place repair. */
export const isRepairOnFailEnabled = () =>
    process.env.AI_QB_REPAIR_ON_FAIL === "1";

/** When on (default), mandate / correctness failures repair one skeleton — not full batch regen. */
export const isMandateRepairEnabled = () =>
    process.env.AI_QB_MANDATE_REPAIR !== "0";

/**
 * When off (default), finalize strips low-difficulty questions instead of spawning
 * another full solve-first batch (prevents nested endless regen loops).
 */
export const isFinalizeDifficultyRegenEnabled = () =>
    process.env.AI_QB_FINALIZE_DIFFICULTY_REGEN === "1";

/** When off, finalize never top-ups stripped/sanitized slots (accept partial batch). */
export const isFinalizeTopUpEnabled = () =>
    process.env.AI_QB_FINALIZE_TOP_UP !== "0";

/** Max shallow one-shot replacement waves per root finalize (default 3 for count guarantee). */
export const getFinalizeTopUpMaxWaves = () =>
    Math.min(
        5,
        Math.max(
            0,
            Number(process.env.AI_QB_FINALIZE_TOP_UP_MAX_WAVES ?? 3)
        )
    );

/**
 * After verification strips failures, allow up to target+N extras from refill
 * (default +3). Floor remains the requested target.
 */
export const getCountOverflowMax = () =>
    Math.max(0, Math.min(10, Number(process.env.AI_QB_COUNT_OVERFLOW_MAX ?? 3)));

/** Exam-native JEE/NEET — veteran hard, trust generation prompt not post-hoc difficulty audits. */
export const isExamNativeVeteranGeneration = (difficultyResolution) =>
    Boolean(
        difficultyResolution?.examCalibrated && isVeteranDifficultyEnabled()
    );

export const getHardMandateFloors = ({ examCalibrated = false } = {}) => {
    const veteran = isVeteranDifficultyEnabled() && examCalibrated;
    return {
        minConcepts: veteran ? VETERAN_HARD_MIN_CONCEPTS : HARD_MIN_CONCEPTS,
        minSolveSteps: veteran ? VETERAN_HARD_MIN_SOLVE_STEPS : HARD_MIN_SOLVE_STEPS,
        minSolutionLines: veteran
            ? VETERAN_HARD_MIN_SOLUTION_LINES
            : HARD_MIN_SOLUTION_LINES,
        veteran,
    };
};

/** Distinct syllabus clusters — hard stems must hit ≥2. */
const SYLLABUS_CONCEPT_CLUSTERS = [
    {
        id: "kinematics_dynamics",
        re: /\b(incline|pulley|block|tension|friction|collision|momentum|projectile|slip|rough)\b/i,
    },
    {
        id: "energy_work",
        re: /\b(energy|work done|power|conservation|kinetic|potential)\b/i,
    },
    {
        id: "rotation",
        re: /\b(torque|angular|rolling|sphere|cylinder|moment of inertia|pure rolling)\b/i,
    },
    {
        id: "gravitation",
        re: /\b(orbit|satellite|escape|gravitat|kepler)\b/i,
    },
    {
        id: "fluids",
        re: /\b(bernoulli|continuity|viscosity|flow|pipe|density of)\b/i,
    },
    {
        id: "thermo",
        re: /\b(entropy|adiabatic|isothermal|isochoric|isobaric|ideal gas|heat)\b/i,
    },
    {
        id: "waves",
        re: /\b(interference|fringe|ydse|double[- ]slit|standing|beat|doppler)\b/i,
    },
    {
        id: "optics",
        re: /\b(lens|mirror|focal|refraction|image|magnification|silvered)\b/i,
    },
    {
        id: "em",
        re: /\b(magnetic|electric field|induced|emf|flux|resistance|circuit|capacitor|inductor)\b/i,
    },
    {
        id: "modern",
        re: /\b(photoelectric|de broglie|bohr|stopping potential|nuclear|wavelength)\b/i,
    },
    {
        id: "shm",
        re: /\b(simple harmonic|shm|pendulum|spring constant|oscillation|superposition)\b/i,
    },
    {
        id: "chemistry_equilibrium",
        re: /\b(equilibrium|ice table|kp|kc|mole fraction|le chatelier)\b/i,
    },
    {
        id: "chemistry_kinetics",
        re: /\b(rate constant|half[- ]life|order of reaction|integrated rate)\b/i,
    },
    {
        id: "chemistry_electro",
        re: /\b(nernst|electrode|cell emf|electrolysis|faraday)\b/i,
    },
    {
        id: "math_limits",
        re: /\b(limit|indeterminate|l'h[oô]pital|as\s+x\s*→|x\s*→\s*0|x\s*to\s*0)\b/i,
    },
    {
        id: "math_derivatives",
        re: /\b(derivative|differentiat|dy\/dx|f'\(|maxima|minima|tangent|chain rule|implicit)\b/i,
    },
    {
        id: "math_integrals",
        re: /\b(integral|integrat|antiderivative|definite integral|area bounded|by parts|substitution)\b/i,
    },
    {
        id: "math_coord_geo",
        re: /\b(circle|parabola|ellipse|hyperbola|locus|chord|tangent line|coordinate|straight line)\b/i,
    },
    {
        id: "math_matrices",
        re: /\b(matrix|matrices|determinant|adjoint|inverse of|system of linear)\b/i,
    },
    {
        id: "math_de",
        re: /\b(differential equation|integrating factor|homogeneous|variable separable|order and degree)\b/i,
    },
    {
        id: "math_trig",
        re: /\b(trigonometr|sin\^|cos\^|tan\^|identity|periodicity)\b/i,
    },
    {
        id: "math_series",
        re: /\b(sequence|series|arithmetic progression|geometric progression|binomial)\b/i,
    },
    {
        id: "math_complex_vectors",
        re: /\b(complex number|argand|modulus|argument|vector|dot product|cross product|3d geometry)\b/i,
    },
    {
        id: "math_probability",
        re: /\b(probability|permutation|combination|binomial distribution|bayes)\b/i,
    },
];

/**
 * Classic JEE-Main *easy* math drills that still get labeled hard.
 * Fail veteran/exam-calibrated hard even when step-count is padded.
 */
const MATH_EASY_DRILL_PATTERNS = [
    {
        re: /evaluate the limit.*(?:sin|cos|tan).*x\s*→\s*0|lim\s*.*x\s*→\s*0.*(?:sin|cos).*\/\s*x/i,
        message:
            "Standard sinx/x-style limit drill — too easy for hard JEE Main; need multi-identity / multi-stage limit.",
    },
    {
        re: /cos\s*\(\s*2x\s*\).*cos\s*\(\s*4x\s*\)|cosA\s*-\s*cosB|sum-to-product identities and standard limit/i,
        message:
            "Textbook cosA−cosB limit template — medium at most; fuse with piecewise / parameter / multi-limit.",
    },
    {
        re: /f\(x\)\s*=\s*ln\s*\(\s*e\^|ln\s*\(\s*e\^\{|find the derivative.*ln\(.*e\^|f'\(0\)|instantaneous rate of change.*x\s*=\s*0/i,
        message:
            "Single chain-rule evaluation at a point — not hard-tier calculus.",
    },
    {
        re: /sin\^3\s*\(?x\)?.*cos\^2|∫\s*.*sin\^3.*cos\^2|trigonometric integral via substitution.*sin\^3/i,
        message:
            "Standard ∫sin³x cos²x (u=cos x) drill — NCERT easy/medium, not hard.",
    },
    {
        re: /odd function.*integral|integrand is odd|parity of the (?:integrand|function).*symmetric interval|even\/odd properties/i,
        message:
            "Pure even/odd integral recognition — one-trick medium; need non-obvious symmetry + second technique.",
    },
    {
        re: /assertion.*reason|statement\s*1.*statement\s*2.*continuity of.*composite/i,
        message:
            "Bare assertion–reason continuity theory — easy conceptual, not hard multi-step maths.",
    },
    {
        re: /tangent line is drawn.*at the specific point.*area of this bounded region|area.*curve.*tangent.*vertical line x\s*=/i,
        message:
            "Standard area-between-curve-and-tangent (one derivative + one integral) — medium JEE, not hard.",
    },
    {
        re: /dy\/dx at (?:the )?point\s*\(\s*\d+\s*,\s*\d+\s*\)|slope of the tangent.*implicit.*at the point/i,
        message:
            "Single-point implicit differentiation plug-in — medium unless multi-constraint.",
    },
    {
        re: /particle moves.*potential energy is linked|particle of mass \d+ kg moves|kinetic energy is proportional to the area/i,
        message:
            "Physics-particle fluff padding on a pure math drill — fluff does not raise difficulty; fuse real techniques.",
    },
    // —— Extra easy templates across ALL JEE Main maths units ——
    {
        re: /find (?:the )?(?:centre|center) and radius|equation of the circle.*x\^2\s*\+\s*y\^2|complete the square.*circle only/i,
        message:
            "Bare circle centre/radius plug-in — easy; need locus/family/chord multi-constraint.",
    },
    {
        re: /slope of the line joining|find the distance between the points?\s*\(|section formula.*internal division only/i,
        message:
            "Single distance/section/slope formula drill — not hard coordinate geometry.",
    },
    {
        re: /compute (?:the )?determinant of|find det\s*\(|2\s*[×x]\s*2 matrix.*determinant only|multiply the matrices A and B/i,
        message:
            "Bare 2×2 det / matrix multiply — medium at most; need properties + system/adj linkage.",
    },
    {
        re: /order and degree of the differential equation only|identify order and degree|dy\/dx\s*=\s*f\(x\).*direct integrat/i,
        message:
            "Order/degree ID or direct ∫f(x) DE — easy; need formation + solve or IF + IC.",
    },
    {
        re: /n\(A\s*∪\s*B\)|n\(A union B\).*n\(A\).*n\(B\)|two sets?.*venn.*direct|power set of a set with \d+ elements only/i,
        message:
            "Two-set Venn / power-set count only — easy sets; need three-set constraints or function-type fusion.",
    },
    {
        re: /find \|?\s*\d+\s*[+\-]\s*\d+i\s*\|?|modulus of the complex number \d+|solve x\^2\s*\+\s*1\s*=\s*0 only/i,
        message:
            "Bare modulus / trivial complex quadratic — not hard; need locus/parameter multi-condition.",
    },
    {
        re: /compute C\(\s*\d+\s*,\s*\d+\s*\)|find P\(\s*\n?\s*\d+\s*,\s*\d+\s*\) only|number of ways to choose \d+ from \d+ only/i,
        message:
            "Single C(n,r)/P(n,r) plug-in — easy counting; need multi-constraint casework/complement.",
    },
    {
        re: /expand \(a\s*\+\s*b\)\^3|find the (?:second|2nd) term in the expansion|T_?2 of \(.*\)\^n only/i,
        message:
            "Trivial binomial expand / T2 — easy; need constrained general term or greatest-term condition.",
    },
    {
        re: /find the \d+(?:st|nd|rd|th) term of (?:the )?AP|sum of (?:the )?first \d+ terms of (?:the )?GP with r\s*=/i,
        message:
            "Bare AP/GP nth term or sum plug-in — easy; need hybrid AP-GP or Sn condition for n.",
    },
    {
        re: /direction cosines of.*direction ratios only|angle between i and j|find DCs from DRs only/i,
        message:
            "Bare DC/DR conversion — easy 3D; need skew distance or multi-condition line.",
    },
    {
        re: /compute i\s*[·.]\s*j|simple \|a\s*[×x]\s*b\| for perpendicular unit|dot product of unit vectors along axes only/i,
        message:
            "Trivial vector identity plug-in — not hard; need simultaneous dot/cross conditions.",
    },
    {
        re: /probability of (?:getting )?heads? (?:on )?(?:a )?fair coin|mean of the numbers? \d+,\s*\d+|simple mean of \d+ observations only/i,
        message:
            "Coin-flip or bare mean — easy stats/prob; need Bayes multi-stage or fused counting.",
    },
    {
        re: /evaluate sin\s*\(?\s*30|sin\s*\(?\s*π\s*\/\s*6|expand sin\s*\(\s*A\s*\+\s*B\s*\) only|value of cos\s*0°/i,
        message:
            "Bare trig evaluation / expand identity only — easy; need multi-angle equation + domain filter.",
    },
    {
        re: /find f'\(x\) if f\(x\)\s*=\s*x\^\d+|differentiate x\^\d+ \+ \d+x only|simple power rule only/i,
        message:
            "Bare power-rule differentiation — easy; fuse with implicit/parameter/constraint.",
    },
];

/** Narrative padding that inflates stem length without real difficulty. */
const FLUFF_PADDING_RE =
    /\b(?:particle moves|potential field|kinetic energy|system is constrained|system undergoes|secondary oscillator|damping coefficient|total energy is proportional)\b/i;

export const detectEasyMathDrill = (stem = "") => {
    const text = String(stem || "");
    for (const { re, message } of MATH_EASY_DRILL_PATTERNS) {
        if (re.test(text)) return message;
    }
    return null;
};

/**
 * Stem red herrings / fake hardness — conditions that never enter the solve.
 * Used on hard/exam-calibrated Maths to keep JEE-authentic lean stems.
 */
const STEM_FLUFF_UNUSED_SIGNAL_RE =
    /(?:vertical\s+line\s+at\s+x\s*=|boundary\s+conditions?\s+at\s+x\s*=|protective\s+coating|physical\s+transition\s+system|periodic\s+wave\s+constraint|optical\s+interference|particle\s+moves\s+along\s+a\s+path\s+defined|represents\s+a\s+physical|under\s+the\s+constraint\s+of\s+the\s+implicit\s+function\s+theorem)/i;

/** Hard-looking but trivial: stem feeds the intermediate values to plug in. */
const PRECOMPUTED_INTERMEDIATE_RE =
    /\b(?:given that (?:the )?(?:local maximum|second derivative|y_max|y'').*(?:is|=)\s*[-−]?\d|y_max is \d|y'' is [-−]?\d|pre[- ]?computed|evaluated under the constraint.*calculate the value of the expression)\b/i;

export const detectStemFluffOrFakeHardness = (stem = "") => {
    const text = String(stem || "");
    if (PRECOMPUTED_INTERMEDIATE_RE.test(text)) {
        return "Stem supplies pre-computed intermediates (y_max / y'' / decimals) — student only does arithmetic; rewrite to require real derivation.";
    }
    if (STEM_FLUFF_UNUSED_SIGNAL_RE.test(text)) {
        return "Stem has narrative / unused-constraint fluff (JEE stems should be lean — every stated condition must matter).";
    }
    return null;
};

/**
 * True when stem is mostly fluff + one textbook ask (veteran-hard reject).
 */
export const detectFluffOnlyHardness = (stem = "") => {
    const text = String(stem || "");
    if (!FLUFF_PADDING_RE.test(text)) return null;
    // Long fluff stems that still only need one technique.
    const techniqueHits = [
        /\bintegral\b/i,
        /\bderivative\b|\bdifferentiat\b|\bf'\b/i,
        /\blimit\b/i,
        /\btangent\b/i,
        /\bimplicit\b/i,
    ].filter((re) => re.test(text)).length;
    if (techniqueHits <= 1 && text.length >= 200) {
        return "Stem pads with particle/energy narrative but only one real technique — not veteran-hard.";
    }
    return null;
};

const LINKED_SETUP_MARKERS =
    /\b(?:first|then|after|followed by|respectively|both|two|system|combination|while|when|simultaneously|linked|using .+ and)\b/i;

/** Assigned archetype blueprints imply multi-concept when stem matches pattern keywords. */
export const stemSatisfiesArchetypeConcepts = (stem = "", conceptSlot = "") => {
    const slot = String(conceptSlot || "").trim();
    if (!slot) return false;
    const text = String(stem || "");
    const checks = {
        optics_separated: () => /lens/i.test(text) && /mirror/i.test(text),
        optics_combined: () => /lens/i.test(text) && /(contact|combination|equivalent)/i.test(text),
        thermodynamics_entropy: () =>
            /(isothermal|adiabatic|isochoric|isobaric)/i.test(text) &&
            /(then|followed|second|total)/i.test(text),
        electromagnetism: () =>
            /(magnetic|emf|induced|flux)/i.test(text) &&
            /(resistance|circuit|capacitor|force|power)/i.test(text),
        fluid_bernoulli: () =>
            /(bernoulli|continuity|flow|pipe)/i.test(text) &&
            /(pressure|speed|area|density)/i.test(text),
        modern_physics_comparative: () =>
            /(ratio|both|respectively|electron|proton|alpha)/i.test(text),
        waves_interference: () =>
            /(bright|dark|fringe|interference)/i.test(text) &&
            /(and|between|same side)/i.test(text),
        collision_momentum: () =>
            /(collision|momentum|elastic)/i.test(text) &&
            /(angle|velocity|speed)/i.test(text),
        capacitor_rc: () => /capacitor/i.test(text) && /(resistor|rc|time constant|τ)/i.test(text),
        photoelectric_stopping: () =>
            /(wavelength|stopping potential|photoelectric)/i.test(text) &&
            /(two|both|changed|respectively)/i.test(text),
        work_energy_power: () =>
            /(work|energy|friction|spring)/i.test(text) &&
            /(distance|speed|block|chain)/i.test(text),
        rotational_dynamics: () =>
            /(roll|rolling|sphere|cylinder)/i.test(text) &&
            /(friction|incline|torque)/i.test(text),
        mechanics_kinematics: () =>
            /(pulley|incline|block)/i.test(text) &&
            /(friction|tension|hanging)/i.test(text),
        gravitation_orbit: () => /(satellite|orbit)/i.test(text) && /(energy|height|radius)/i.test(text),
        shm_superposition: () =>
            /(superimpos|resultant amplitude|phase)/i.test(text) &&
            /(sin|shm|harmonic)/i.test(text),
        em_wave_dielectric_boundary_phase: () =>
            /(dielectric|refractive|boundary|polariz)/i.test(text) &&
            /(phase|reflection|transmission|em wave|electromagnetic)/i.test(text),
        electrostatic_potential_non_uniform_charge: () =>
            /(charge density|non-uniform|distributed|rod|ring|disk)/i.test(text) &&
            /(potential|field|integration|gauss)/i.test(text),
        magnetic_torque_non_uniform_field: () =>
            /(dipole|current loop|magnetic moment)/i.test(text) &&
            /(torque|non-uniform|gradient|varying)/i.test(text),
        quantum_well_tunneling_probability: () =>
            /(well|barrier|tunnel|transmission)/i.test(text) &&
            /(energy|probability|wavefunction|quantum)/i.test(text),
        coupled_oscillator_energy_transfer: () =>
            /(coupled|two|beat|normal mode)/i.test(text) &&
            /(oscillat|spring|pendulum|shm)/i.test(text),
        non_inertial_fluid_pressure: () =>
            /(accelerat|non-inertial|pseudo)/i.test(text) &&
            /(pressure|fluid|manometer|tank)/i.test(text),
    };
    const fn = checks[slot];
    if (fn?.()) return true;
    const bp = getArchetypeBlueprint(slot);
    return Boolean(bp && LINKED_SETUP_MARKERS.test(text));
};

const DIRECT_SUBSTITUTION_STEM_RE =
    /\b(?:using the formula|plug(?:\s+in)?|direct substitution|simply substitute|apply the equation)\b/i;

const SINGLE_FORMULA_DRILL_STEM_RE =
    /\bcalculate (?:the )?(?:de broglie wavelength|wavelength|entropy change|focal length|power dissipated|distance of (?:the )?\d+(?:st|nd|rd|th) (?:bright|dark) fringe)\b/i;

export const countConceptClusters = (text = "") => {
    const stem = String(text || "");
    return SYLLABUS_CONCEPT_CLUSTERS.filter((c) => c.re.test(stem)).length;
};

export const countSolutionLines = (solveSteps = []) => {
    if (!Array.isArray(solveSteps)) return 0;
    return solveSteps
        .map((s) => String(s || "").trim())
        .filter((s) => s.length > 12).length;
};

export const detectDirectSubstitution = (stem = "", solveSteps = []) => {
    const stemText = String(stem || "");
    const steps = (solveSteps || []).map((s) => String(s || "").trim()).filter(Boolean);
    const body = steps.join(" ");

    if (DIRECT_SUBSTITUTION_STEM_RE.test(stemText) || DIRECT_SUBSTITUTION_STEM_RE.test(body)) {
        return true;
    }
    if (SINGLE_FORMULA_DRILL_STEM_RE.test(stemText) && steps.length <= 2) {
        return true;
    }

    const equalsCount = (body.match(/=/g) || []).length;
    if (steps.length <= 2 && equalsCount <= 1) return true;
    if (steps.length <= 3 && body.length < 120 && equalsCount <= 2) return true;

    const hasIntermediateReasoning =
        /\b(?:therefore|thus|from this|substituting|rearranging|equating|combining|using conservation)\b/i.test(
            body
        );
    if (steps.length <= 2 && !hasIntermediateReasoning) return true;

    return false;
};

/**
 * @returns {{ ok: boolean, issues: string[] }}
 */
export const validateHardQuestionMandate = (
    q,
    {
        assignedTier = "hard",
        examCalibrated = false,
        examProfile = "",
        subject = "",
        questionKind = "",
    } = {}
) => {
    const tier = normalizeQuestionTier(assignedTier) || "medium";
    const isHard = tier === "hard" || examCalibrated;
    if (!isHard) return { ok: true, issues: [] };

    const stem = String(q.questionText || q.stem || "").trim();
    let solveSteps = q.solveSteps || q._solveSteps || [];
    if (!solveSteps.length && q.explanation) {
        solveSteps = String(q.explanation)
            .split(/\bTherefore\b/i)[0]
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 12);
    }

    // Theory (conceptual) slots are hard via concept depth and close distractors, not
    // computation — the numeric-given / solve-step / direct-substitution gates do not
    // apply. Require only that it is not a single trivially-restated fact.
    const kind = String(
        questionKind || q._questionKind || q.questionKind || ""
    ).toLowerCase();
    const floorsEarly = getHardMandateFloors({ examCalibrated });
    // Exam-native veteran hard (JEE/NEET): do NOT exempt "direct" from multi-step
    // gates — that exemption shipped easy single-formula items labeled Hard.
    const strictVeteranHard = floorsEarly.veteran && examCalibrated;

    if (kind === "theory") {
        const stepCount = Array.isArray(solveSteps) ? solveSteps.length : 0;
        const issues = [];
        if (stepCount > 0 && stepCount < NON_STEM_HARD_MIN_SOLVE_STEPS) {
            issues.push(
                `Hard theory question needs ≥${NON_STEM_HARD_MIN_SOLVE_STEPS} reasoning/elimination steps, not a single fact restated as the answer (found ${stepCount}).`
            );
        }
        if (strictVeteranHard) {
            const easyMath = detectEasyMathDrill(stem);
            if (easyMath) issues.push(easyMath);
            if (stem.length < 160) {
                issues.push(
                    "Hard theory stem needs multi-statement depth (≥160 chars) with close distractors — not a one-line definition."
                );
            }
        }
        return { ok: issues.length === 0, issues };
    }

    // Direct slots: only exempt from peak gates on non-exam banks.
    // For exam-calibrated veteran hard, direct still must pass multi-step / no-plug-in.
    if (kind === "direct" && !strictVeteranHard) {
        return { ok: true, issues: [] };
    }

    if (!isStemProfile(examProfile, subject)) {
        // No hand-curated concept-cluster catalog exists for non-STEM
        // domains (law/GK/reasoning/etc.) — fabricating one isn't something
        // to do without real domain review. The only generic proxy for real
        // elimination/synthesis depth is having more than one solve step;
        // a single restated fact (the UPSC 0/40 failure mode) fails this.
        const stepCount = Array.isArray(solveSteps) ? solveSteps.length : 0;
        const issues = [];
        if (stepCount > 0 && stepCount < NON_STEM_HARD_MIN_SOLVE_STEPS) {
            issues.push(
                `Hard question needs ≥${NON_STEM_HARD_MIN_SOLVE_STEPS} reasoning/elimination steps, not a single fact restated as the answer (found ${stepCount}).`
            );
        }
        return { ok: issues.length === 0, issues };
    }

    const conceptSlot = q.conceptSlot || q._conceptSlot || "";
    const issues = [];
    const floors = getHardMandateFloors({ examCalibrated });

    // JEE authenticity: ban unused narrative fluff + "hard-looking easy" pre-computed plugs.
    const fluff = detectStemFluffOrFakeHardness(stem);
    if (fluff) issues.push(fluff);
    const easyMathAlways = detectEasyMathDrill(stem);
    if (easyMathAlways) issues.push(easyMathAlways);

    const conceptCount = countConceptClusters(stem);
    const hasLinkedSetup =
        LINKED_SETUP_MARKERS.test(stem) ||
        stemSatisfiesArchetypeConcepts(stem, conceptSlot);
    if (conceptCount < floors.minConcepts && !hasLinkedSetup) {
        issues.push(
            `Hard question needs ≥${floors.minConcepts} linked concepts in the stem (found ~${conceptCount}); fuse ideas (e.g. mechanics+energy, optics+mirror, EM+circuit).`
        );
    }

    const stepCount = Array.isArray(solveSteps) ? solveSteps.length : 0;
    if (stepCount > 0 && stepCount < floors.minSolveSteps) {
        issues.push(
            `Hard question needs ≥${floors.minSolveSteps} solving steps (found ${stepCount}).`
        );
    }

    const lineCount = countSolutionLines(solveSteps);
    if (stepCount > 0 && lineCount < floors.minSolutionLines) {
        issues.push(
            `Hard solution cannot finish in under ${floors.minSolutionLines} lines (found ${lineCount} derivation step(s)).`
        );
    }

    if (detectDirectSubstitution(stem, solveSteps)) {
        issues.push(
            "Hard question must not be direct substitution / single-formula plug-in — chain ≥2 reasoning stages."
        );
    }

    if (floors.veteran) {
        if (stem.length < VETERAN_MIN_STEM_CHARS) {
            issues.push(
                `Veteran-tier stem needs ≥${VETERAN_MIN_STEM_CHARS} characters with linked constraints (found ${stem.length}).`
            );
        }
        const givens = countNumericGivens(stem);
        // Theory already returned; for numeric hard, require real givens — but
        // pure symbolic hard items may have 0 digits (e.g. definite integral of
        // sin^m cos^n). Allow if multi-technique markers present.
        const multiTechnique =
            /\b(?:and then|first.*then|substitution.*parts|parts.*substitution|implicit.*and|limit.*and|using both|combined with)\b/i.test(
                stem
            ) || conceptCount >= 2;
        if (givens < VETERAN_MIN_NUMERIC_GIVENS && !multiTechnique) {
            issues.push(
                `Veteran-tier stem needs ≥${VETERAN_MIN_NUMERIC_GIVENS} distinct numeric givens (found ${givens}) OR explicit multi-technique fusion.`
            );
        }
        const coachingDrill = detectCoachingTemplateDrill(stem);
        if (coachingDrill) {
            issues.push(coachingDrill);
        }
        const easyMath = detectEasyMathDrill(stem);
        if (easyMath) {
            issues.push(easyMath);
        }
        const fluff = detectFluffOnlyHardness(stem);
        if (fluff) {
            issues.push(fluff);
        }
    }

    return { ok: issues.length === 0, issues };
};

/** Validate solve-first skeleton before MCQ build. */
export const validateHardSkeletonMandate = (
    skeleton,
    assignedTier = "hard",
    { examCalibrated = false, examProfile = "", subject = "", questionKind = "" } = {}
) => {
    return validateHardQuestionMandate(
        {
            stem: skeleton.stem,
            solveSteps: skeleton.solveSteps,
            conceptSlot: skeleton.conceptSlot,
        },
        {
            assignedTier,
            examCalibrated: examCalibrated || assignedTier === "hard",
            examProfile,
            subject,
            questionKind:
                questionKind ||
                skeleton.questionKind ||
                skeleton._questionKind ||
                "",
        }
    );
};

/**
 * Prompt block — every hard-tier skeleton must satisfy these gates.
 */
export const buildHardQuestionMandateBlock = ({
    examProfile = "jee_main",
    tier = "hard",
    examCalibrated = false,
} = {}) => {
    const isHard = tier === "hard" || examCalibrated;
    if (!isHard) return "";

    const floors = getHardMandateFloors({ examCalibrated });
    const examLabel =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";
    const audienceNote = floors.veteran
        ? "\n**Audience:** coaching veterans / repeaters — if solvable in <90s with one memorized formula, it **fails**."
        : "";

    return `
**HARD QUESTION MANDATE — ${examLabel} (EVERY hard-tier skeleton MUST satisfy ALL):**
1. **≥${floors.minConcepts} syllabus techniques/concepts** — fuse ideas (e.g. for Maths: limit+series, integral+property+area, circle+optimization, DE formation+solve; for Physics: rotation+friction, lens+mirror). One-formula single-topic drills **fail**.
2. **≥${floors.minSolveSteps} solving steps** — \`solveSteps\` array has at least ${floors.minSolveSteps} distinct reasoning sentences; each advances the solve (not filler).
3. **No direct substitution** — do not plug all givens into one formula and stop. Intermediate quantity / second technique required.
4. **Cannot finish in under ${floors.minSolutionLines} lines** — full derivation needs **${floors.minSolutionLines}+** substantive sentences in \`solveSteps\`; a 1–2 line solve is **rejected**.${audienceNote}${
        floors.veteran
            ? `
5. **Veteran stem depth** — stem **≥${VETERAN_MIN_STEM_CHARS} characters**, real multi-condition setup, **4+ sentences** before the ask.
6. **Mathematics ban-list (auto-reject):** plain chain-rule at a point; standard cosA−cosB / sinx/x limit; single even/odd integral; textbook ∫sin³cos²; curve+tangent one-shot area; bare assertion–reason; particle fluff; bare centre/radius circle; single distance/slope; bare 2×2 det/matrix multiply; order-degree-only DE; two-set Venn plug; |a+ib| only; single C(n,r); trivial binomial T2; bare AP/GP nth term; DC from DR only; i·j only; coin P(H)/bare mean; sin30°/expand sin(A+B) only.
7. **Do NOT tag easy drills as multi_concept** — if a prepared student finishes in <2 minutes with one identity, **rewrite harder** using the chapter's hard_archetypes (parameter, piecewise, multi-stage, case split, fused chapters). Prefer NCERT-file hard_archetypes over textbook drills.
8. **Accuracy first:** deepen difficulty WITHOUT inventing out-of-NCERT methods; the dual-solver path must still re-derive a unique correct key with trap-based distractors.
9. **Lean JEE stems:** every stated condition must be used. Ban unused red herrings (\"vertical line at x=…\", decorative \"physical system\" padding) and ban hard-looking questions that hand the student pre-computed y_max / y'' decimals to plug in — require real multi-step derivation.
10. **Options:** consistent LaTeX for all four choices; distractors must match the correct answer's algebraic form (no three plain integers vs one surd).`
            : ""
    }

**Self-check before output:** Count concepts (≥${floors.minConcepts}), count solveSteps (≥${floors.minSolveSteps}), count derivation lines (≥${floors.minSolutionLines}), confirm no single-formula path${
        floors.veteran
            ? `, stem length ≥${VETERAN_MIN_STEM_CHARS}, NOT on the math ban-list`
            : ""
    }. If any check fails → deepen the problem (add constraint, second stage, or comparative setup) — do not ship.

${buildWeightedDifficultyRubricBlock()}`;
};

/**
 * Explicit codegen checklist — mirrors deterministic skeleton validators.
 * Placed in solve-first prompts so the model ships compliant skeletons on first pass.
 */
const SKELETON_EXAM_LABELS = {
    jee_advanced: "JEE Advanced",
    jee_main: "JEE Main shift-paper",
    neet: "NEET",
    cat: "CAT",
    board: "board exam",
    competitive: "competitive exam",
};

export const buildSkeletonGenerationComplianceBlock = ({
    examProfile = "jee_main",
    examCalibrated = false,
    subject = "",
} = {}) => {
    const floors = getHardMandateFloors({ examCalibrated });
    // Was hardcoded to "JEE Main shift-paper" for EVERY profile except jee_advanced, so a
    // CAT / UPSC / board skeleton was repaired against a JEE brief.
    const examLabel =
        SKELETON_EXAM_LABELS[String(examProfile || "").toLowerCase()] ||
        "competitive exam";

    // Vocabulary is subject-specific. Physics lists on a Maths bank produce fluff
    // "particle energy" stems that fail hardness; non-STEM banks must stay on-topic.
    const wantsStemVocab = isStemProfile(examProfile, subject);
    const isMathSubject = /\bmath(?:s|ematics)?\b/i.test(String(subject || ""));

    const conceptVocabHint = !wantsStemVocab
        ? `
**Two-concept stem requirement:** the stem must combine **≥2 ideas from THIS bank's own
syllabus** (the topic/subject named above). Do NOT import vocabulary or scenarios from a
different subject to satisfy this — an off-syllabus stem is a failure, not a fix.`
        : isMathSubject
          ? `
**Two-concept Mathematics stem vocabulary (use words from ≥2 areas in the stem):**
- Limits/continuity: piecewise, LHL/RHL, indeterminate, standard limit reduction
- Derivatives/AOD: implicit, logarithmic, parameter, extrema under constraint
- Integrals/area: King's property, split limits, intersection of curves, parts+sub
- Coordinate geometry: locus, family of lines, chord, conic focus-directrix
- Matrices/DE: adjoint, consistency parameter λ, integrating factor, formation of DE
- Algebra: binomial general term, AP-GP hybrid, permutations with restrictions
- Complex/vectors/3D: Argand locus, modulus-argument, skew distance, scalar triple product
- Probability/trig: Bayes multi-stage, multi-angle equation, principal values
**OR** linking phrases: *first … then …, both …, simultaneously, under the constraint, parameter, case*.
**Banned as main ask:** single formula plug-ins listed in the Mathematics ban-list / NCERT banned_easy_templates.`
          : `
**Two-concept stem vocabulary (use words from ≥2 areas in the stem):**
- Mechanics/dynamics: incline, pulley, friction, collision, momentum
- Energy/work: kinetic, potential, conservation, work done, power
- Rotation: torque, angular, rolling, cylinder, moment of inertia
- Gravitation: orbit, satellite, escape, gravitational
- Fluids: Bernoulli, viscosity, flow, pressure, density
- Thermo: entropy, adiabatic, isothermal, heat, latent
- Waves/optics: interference, fringe, lens, mirror, refraction, focal
- EM/circuits: magnetic, electric field, emf, flux, capacitor, inductor, resistance
- Modern: photoelectric, de Broglie, Bohr, wavelength, photon
**OR** linking phrases: *first … then …, both …, two …, system, combination, while, when, simultaneously, linked, respectively*.`;

    let block = `
**SKELETON COMPLIANCE — ${examLabel} (code auto-rejects non-compliant skeletons):**
${conceptVocabHint}

**Mandatory per skeleton:**
| Gate | Requirement |
|------|-------------|
| Linked concepts | ≥${floors.minConcepts} syllabus areas in stem text (see vocabulary above) |
| solveSteps count | **≥${floors.minSolveSteps}** array entries, each a full sentence |
| Derivation depth | **≥${floors.minSolutionLines}** substantive lines (each solveStep ≥13 chars) |
| Answer lock | Last solveStep states **exactly** \`finalAnswer.display\` (value + unit) |
| Arithmetic | Re-solve from stem givens before output — code verifies numerics independently |

**Answer mismatch = instant reject:** If solveSteps derive 0.0102 m/s but \`finalAnswer.display\` is "0.082 m/s", the skeleton is discarded. Solve completely, then set \`finalAnswer\` and echo that same value in the final solveStep.`;

    if (floors.veteran) {
        block += `

**Veteran-tier (all mandatory):**
| Gate | Requirement |
|------|-------------|
| Stem length | **≥${VETERAN_MIN_STEM_CHARS} characters** (4 sentences: setup → givens → constraint → ask) |
| Numeric givens | **≥${VETERAN_MIN_NUMERIC_GIVENS} distinct** numbers with units in the stem |
| No templates | Avoid Van der Waals plug-in, lone Compton Δλ, binary-star midpoint, capillary % drills |

**Veteran stem pattern:** Sentence 1 = physical setup. Sentence 2–3 = **three+ numeric givens** with units. Sentence 4 = **coupled constraint** linking two concepts. Sentence 5 = the ask.`;
    }

    block += `

**Before adding each skeleton to JSON:** (1) count concept areas in stem, (2) count solveSteps ≥${floors.minSolveSteps}, (3) count lines ≥${floors.minSolutionLines}, (4) verify last step = finalAnswer${
        floors.veteran
            ? `, (5) stem ≥${VETERAN_MIN_STEM_CHARS} chars, (6) ≥${VETERAN_MIN_NUMERIC_GIVENS} numeric givens`
            : ""
    }.`;

    return block;
};

/** Single authoritative block for exam-native veteran generation — replaces tier-mix + post-hoc audit. */
export const buildVeteranExamNativeGenerationBlock = ({
    examProfile = "jee_main",
    batchSize = 10,
} = {}) => {
    const floors = getHardMandateFloors({ examCalibrated: true });
    const examLabel =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";

    return `
**═══ VETERAN EXAM-NATIVE GENERATION (${examLabel}) — ${batchSize} question(s), ALL HARD ═══**

**Audience:** Coaching veterans / repeaters who have solved 1000+ mocks. Every item must need **4–6 careful minutes** — not homework, not NCERT drill.

**Your job:** Generate **${batchSize}** skeletons that are **already compliant** on first output. If a draft would fail automated gates, **fix it before output** — deepen stem, add solve steps, align \`finalAnswer\` with the last solveStep.

${buildSkeletonGenerationComplianceBlock({ examProfile, examCalibrated: true })}

**GENERATION-TIME SELF-FIX (mandatory before JSON):**
1. Draft each skeleton for its assigned \`conceptSlot\` blueprint.
2. Re-read each skeleton against the compliance table above.
3. If stem too short, concepts not fused, solveSteps < ${floors.minSolveSteps}, or last step ≠ \`finalAnswer.display\` → **rewrite that skeleton in place**.
4. Re-solve arithmetic from stem givens; align \`finalAnswer\` and final solveStep to the **same** value.
5. Only add skeletons that pass your own review to the JSON array.

**Reject before output (rewrite harder, do not include):**
- Single-formula plug-ins, coaching templates, <90s solves
- Stems under ${VETERAN_MIN_STEM_CHARS} chars or with <${VETERAN_MIN_NUMERIC_GIVENS} numeric givens
- solveSteps that disagree with \`finalAnswer\``;
};

/**
 * Feed prior-attempt difficulty-audit rejection reasons back into the next
 * generation attempt so the model targets the SPECIFIC weakness the auditor
 * named, instead of blindly resampling the same instructions and getting the
 * same reject rate again.
 */
export const buildDifficultyRegenFeedbackBlock = (rejections = []) => {
    const rows = (Array.isArray(rejections) ? rejections : [])
        .filter((r) => r && Number.isFinite(Number(r.difficultyScore)))
        .slice(0, 8);
    if (!rows.length) return "";

    const lines = rows
        .map((r, i) => {
            const label = r.conceptSlot ? ` [${r.conceptSlot}]` : "";
            const reason =
                String(r.reason || "").trim() || "too easy for assigned tier";
            return `${i + 1}.${label} scored ${r.difficultyScore}/100 — ${reason}`;
        })
        .join("\n");

    return `
**PRIOR ATTEMPT REJECTED BY DIFFICULTY AUDIT — FIX THESE SPECIFIC WEAKNESSES:**
The last batch was scored below the required difficulty bar. Do not just resubmit similar skeletons — address the NAMED weakness in each reason below:
${lines}

For this attempt: if a reason says "only 1 concept fused" → explicitly link ≥2 syllabus ideas in the stem. If it says "no derivation depth" / "too few solve steps" → add substantive intermediate solveSteps that build toward the answer. If it says "single-formula plug-in" → restructure so no step is a direct one-shot substitution. Treat each reason as a literal defect to correct, not generic feedback.`;
};

/** Map mandate failures to audit issues for difficulty scoring. */
export const detectHardMandateIssues = (q, ctx = {}) => {
    const tier =
        normalizeQuestionTier(ctx.assignedTier || q.difficultyTier || q.difficulty) ||
        "medium";
    const { ok, issues } = validateHardQuestionMandate(q, {
        assignedTier: tier,
        examCalibrated: ctx.examCalibrated,
        examProfile: ctx.examProfile,
        subject: ctx.subject,
        questionKind:
            ctx.questionKind || q._questionKind || q.questionKind || "",
    });
    if (ok) return [];

    return issues.map((issue) => ({
        questionNumber: q.sampleNumber,
        issue,
        severity: tier === "hard" || ctx.examCalibrated ? "major" : "minor",
        confidence: "confirmed",
        category: ISSUE_CATEGORY.DIFFICULTY,
    }));
};

export default {
    buildHardQuestionMandateBlock,
    buildSkeletonGenerationComplianceBlock,
    buildVeteranExamNativeGenerationBlock,
    buildDifficultyRegenFeedbackBlock,
    isExamNativeVeteranGeneration,
    isStemProfile,
    validateHardQuestionMandate,
    validateHardSkeletonMandate,
    detectHardMandateIssues,
    countConceptClusters,
    countSolutionLines,
    detectDirectSubstitution,
    detectEasyMathDrill,
    detectStemFluffOrFakeHardness,
    detectFluffOnlyHardness,
};
