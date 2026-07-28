/**
 * Hard-tier question mandate — generation prompts + deterministic validation.
 * Hard difficulty applies within each question kind (theory / direct / multi_concept);
 * only multi_concept slots must be multi-concept + multi-step + non plug-in.
 */

import { normalizeQuestionTier } from "./difficultyMix.service.js";
import { ISSUE_CATEGORY } from "./topicRelevanceValidation.service.js";
import { getArchetypeBlueprint } from "./conceptArchetypeGuidance.service.js";

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

/** Max shallow one-shot replacement waves per root finalize (default 1). */
export const getFinalizeTopUpMaxWaves = () =>
    Math.min(
        3,
        Math.max(
            0,
            Number(process.env.AI_QB_FINALIZE_TOP_UP_MAX_WAVES ?? 1)
        )
    );

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
        id: "math_calculus",
        re: /\b(integral|derivative|differentiat|limit|area under)\b/i,
    },
];

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
    if (kind === "theory") {
        const stepCount = Array.isArray(solveSteps) ? solveSteps.length : 0;
        const issues = [];
        if (stepCount > 0 && stepCount < NON_STEM_HARD_MIN_SOLVE_STEPS) {
            issues.push(
                `Hard theory question needs ≥${NON_STEM_HARD_MIN_SOLVE_STEPS} reasoning/elimination steps, not a single fact restated as the answer (found ${stepCount}).`
            );
        }
        return { ok: issues.length === 0, issues };
    }

    // Direct slots are meant to be single-formula / single-step numericals — the
    // peak-hard gates (numeric-given count, ≥3 solve steps, no direct substitution)
    // do NOT apply. Correctness is still enforced separately by the numeric-verify
    // and correctness audits, which are kind-agnostic.
    if (kind === "direct") {
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
        if (givens < VETERAN_MIN_NUMERIC_GIVENS) {
            issues.push(
                `Veteran-tier stem needs ≥${VETERAN_MIN_NUMERIC_GIVENS} distinct numeric givens (found ${givens}).`
            );
        }
        const coachingDrill = detectCoachingTemplateDrill(stem);
        if (coachingDrill) {
            issues.push(coachingDrill);
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
1. **≥${floors.minConcepts} concepts** — stem must link two syllabus ideas (e.g. rotation + friction, lens + mirror, EM + circuit, thermo + entropy stages). One-formula single-topic drills **fail**.
2. **≥${floors.minSolveSteps} solving steps** — \`solveSteps\` array has at least ${floors.minSolveSteps} distinct reasoning sentences; each advances the solve (not filler).
3. **No direct substitution** — do not plug all givens into one formula and stop. Intermediate quantity required (force → acceleration → velocity, image₁ → object for mirror → final image, ε → I → P, etc.).
4. **Cannot finish in under ${floors.minSolutionLines} lines** — full derivation needs **${floors.minSolutionLines}+** substantive sentences in \`solveSteps\`; a 1–2 line solve is **rejected**.${audienceNote}${
        floors.veteran
            ? `
5. **Veteran stem depth** — stem **≥${VETERAN_MIN_STEM_CHARS} characters**, **≥${VETERAN_MIN_NUMERIC_GIVENS} distinct numeric givens** with units, **4+ sentences** before the ask.`
            : ""
    }

**Self-check before output:** Count concepts (≥${floors.minConcepts}), count solveSteps (≥${floors.minSolveSteps}), count derivation lines (≥${floors.minSolutionLines}), confirm no single-formula path${
        floors.veteran
            ? `, stem length ≥${VETERAN_MIN_STEM_CHARS}, ≥${VETERAN_MIN_NUMERIC_GIVENS} numeric givens`
            : ""
    }. If any check fails → deepen the problem (add constraint, second stage, or comparative setup) — do not ship.`;
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

    // The vocabulary list below is physics-specific. Injecting it into a non-STEM bank
    // (CAT DILR, UPSC, CLAT) instructed the model to build stems out of "incline, pulley,
    // emf, capacitor" — which is how JEE physics questions ended up inside a CAT
    // Data-Interpretation bank during repair. Only emit it for STEM profiles.
    const wantsPhysicsVocab = isStemProfile(examProfile, subject);

    const conceptVocabHint = !wantsPhysicsVocab
        ? `
**Two-concept stem requirement:** the stem must combine **≥2 ideas from THIS bank's own
syllabus** (the topic/subject named above). Do NOT import vocabulary or scenarios from a
different subject to satisfy this — an off-syllabus stem is a failure, not a fix.`
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
};
