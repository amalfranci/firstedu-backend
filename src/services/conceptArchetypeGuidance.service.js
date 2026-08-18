/**
 * Per-concept-slot authoring blueprints — tells the LLM exactly how to write
 * a hard JEE/entrance question for each archetype (avoids template drills).
 */

const PHYSICS_HARD_BLUEPRINTS = {
    mechanics_kinematics: {
        pattern:
            "Link TWO motions or constraints: projectile + relative motion, circular + friction, or collision + energy with a non-obvious ask.",
        required:
            'Stem must include at least two givens with units, a constraint ("when", "at the instant", "simultaneously"), and ask for a derived quantity — not a single SUVAT plug-in.',
        banned: "Single equation v = u + at with one unknown; bare 'find acceleration'.",
        stemHint:
            "A block slides on a rough incline while a second block hangs via a pulley; when the hanging block descends 2 m, find the speed of the sliding block given μ and angles.",
    },
    rotational_dynamics: {
        pattern:
            "Rolling without slipping + incline, or torque on a composite body with moment of inertia.",
        required:
            "Combine rotation and translation OR torque balance with two unknowns resolved in sequence.",
        banned: "Single τ = Iα with all values given directly.",
        stemHint:
            "A solid sphere rolls down a rough incline of angle θ; find the minimum coefficient of friction so that pure rolling is maintained.",
    },
    optics_combined: {
        pattern:
            "Two lenses/mirrors in contact or separated, or lens in different medium, or object between foci.",
        required:
            'Use words like "combination", "placed in contact", "refractive index", or "after reflection then refraction".',
        banned: "Single lens formula with u and f given — one step to v.",
        stemHint:
            "A convex lens (f = 20 cm) is in contact with a concave lens (f = 10 cm); an object is at 30 cm — find image position by equivalent focal length then lens formula.",
    },
    electromagnetism: {
        pattern:
            "Moving rod in B-field + induced emf, or loop in changing flux with resistance, or force between current elements.",
        required:
            "At least two linked quantities (flux → emf → current, or force + equilibrium).",
        banned: "Bare ε = BLv with all values listed — no extra constraint.",
        stemHint:
            "A rod of length L moves at speed v perpendicular to uniform B; the circuit has resistance R — find induced current and power dissipated.",
    },
    modern_physics_comparative: {
        pattern:
            "Compare two particles (proton vs electron), OR de Broglie linked to magnetic radius, OR photoelectric with stopping potential + unknown wavelength.",
        required:
            'Must use "ratio", "both", "respectively", or chain modern-physics concepts — never naked λ = h/p for one electron at V volts.',
        banned: '"Calculate the de Broglie wavelength of an electron accelerated through 150 V."',
        stemHint:
            "An electron and a proton are accelerated through the same potential difference V; find the ratio of their de Broglie wavelengths.",
    },
    thermodynamics_entropy: {
        pattern:
            "Cyclic process, free expansion + compression, or mixing of gases with entropy change in multiple steps.",
        required:
            "Two or more stages with ΔS computed separately then combined — not a single isothermal ln(V2/V1) line.",
        banned: "One-line isothermal ΔS = nR ln(V₂/V₁) with volumes given; bare 'calculate change in entropy' for one step.",
        stemHint:
            "An ideal gas undergoes isothermal expansion to double volume, then adiabatic compression back to initial pressure — find net ΔS of the gas.",
    },
    waves_interference: {
        pattern:
            "Two-source interference with path difference, or standing waves with boundary conditions, or fringe position vs order with extra constraint.",
        required:
            "Path difference or harmonic condition with at least two setup sentences — not naked y = nλD/d.",
        banned: "Bare Young's double-slit y = nλD/d with all values given; single v = fλ.",
        stemHint:
            "In YDSE with slit separation d and screen distance D, find the distance between the 3rd bright fringe and the 5th dark fringe on the same side — requires two fringe formulas.",
    },
    work_energy_power: {
        pattern:
            "Variable force, power under constraint, or energy loss in multi-step system.",
        required:
            "Energy method across at least two bodies or two stages.",
        banned: "Single W = Fd with all values given.",
        stemHint:
            "A chain is pulled over a rough table with one segment hanging; find the speed when the hanging end has descended h, using energy conservation with friction work.",
    },
    collision_momentum: {
        pattern: "1D/2D collision with energy or momentum constraint, oblique collision, or explosion with fragments.",
        required: "Both momentum and energy (or geometry) needed; not bare m1v1 = m2v2.",
        banned: "Simple inelastic collision with all masses and one velocity given.",
        stemHint:
            "A ball moving at 10 m/s collides elastically with an identical ball at rest on a smooth table; find the angle between their velocities after collision.",
    },
    gravitation_orbit: {
        pattern: "Orbital energy, escape velocity with planet rotation, or satellite transfer between orbits.",
        required: "Link gravitational potential and kinetic energy or Kepler constraint.",
        banned: "Bare F = GMm/r² plug-in.",
        stemHint:
            "A satellite orbits Earth at height h above surface; find the energy required to transfer it to an orbit at height 2h.",
    },
    fluid_bernoulli: {
        pattern: "Continuity + Bernoulli with height change, or Torricelli's theorem with tank geometry.",
        required: "Two linked equations (continuity and Bernoulli) or geometry constraint.",
        banned: "Single v = √(2gh) with h given directly.",
        stemHint:
            "Water flows through a horizontal pipe narrowing from radius r to r/2; find the pressure difference between the wide and narrow sections given inlet speed.",
    },
    capacitor_rc: {
        pattern: "RC charging/discharging, or capacitor with moving rod in B-field steady-state analysis.",
        required: "Time constant or steady-state with circuit constraint — not bare Q = CV.",
        banned: "Steady-state current confusion (capacitor open circuit vs resistor-only).",
        stemHint:
            "A 10 μF capacitor in series with 10 kΩ is connected to 5 V; find charge on capacitor at t = 2τ.",
    },
    photoelectric_stopping: {
        pattern: "Photoelectric with stopping potential + wavelength, or work function from two frequencies.",
        required: "Two equations linking hf, φ, and KE; comparative or two-frequency setup.",
        banned: "Single KE = hf − φ with all values given.",
        stemHint:
            "Light of wavelength 300 nm ejects photoelectrons with stopping potential 1.2 V; find the work function of the metal.",
    },
    optics_separated: {
        pattern: "Lens and mirror separated (not in contact), silvered lens, or object between lens and mirror.",
        required: "Two-stage imaging with sign convention — not equivalent focal length only.",
        banned: "Convex+concave in contact with u = 30 cm template.",
        stemHint:
            "A convex lens forms an image; a plane mirror is placed beyond the lens so light reflects back — find final image position.",
    },
    shm_superposition: {
        pattern: "Two SHM superposition, beats, or damped oscillation amplitude decay.",
        required: "Phase or frequency difference matters — not bare T = 2π√(m/k).",
        banned: "Single pendulum period formula.",
        stemHint:
            "Two SHM along same line with amplitudes 3 cm and 4 cm and phase difference π/3; find resultant amplitude.",
    },
};

/** Explicit two-concept fusion for AI-planned slots that often fail hard-mandate checks. */
const PHYSICS_CONCEPT_FUSION_BLUEPRINTS = {
    em_wave_dielectric_boundary_phase: {
        pattern:
            "EM wave at dielectric boundary — combine reflection/transmission coefficients with phase shift or polarization.",
        required:
            "FUSE (A) dielectric boundary / refractive index ratio AND (B) phase shift, polarization angle, or power transmission. Stem must name both media plus incidence angle or polarization.",
        banned: "Single-medium wave speed; bare Snell with all angles listed.",
        conceptFusion: "EM waves + dielectric boundary conditions",
        stemHint:
            "A linearly polarized wave enters glass from air at 45° — find phase shift on reflection and transmitted amplitude fraction.",
    },
    electrostatic_potential_non_uniform_charge: {
        pattern:
            "Non-uniform charge distribution — integrate field/potential then apply superposition or boundary condition.",
        required:
            "FUSE (A) continuous/non-uniform charge density setup AND (B) potential/field at a point via integration or Gauss law with symmetry breaking.",
        banned: "Point charge only; uniform sheet with one-step E = σ/2ε₀.",
        conceptFusion: "electrostatics + integration/superposition",
        stemHint:
            "A rod with linear charge density λ(x) varies along its length; find potential at point P off-axis using integration.",
    },
    magnetic_torque_non_uniform_field: {
        pattern:
            "Magnetic dipole in non-uniform B-field — torque and potential energy linked.",
        required:
            "FUSE (A) dipole moment orientation AND (B) spatially varying B-field (gradient) affecting torque or equilibrium angle.",
        banned: "Uniform B-field with τ = MB sinθ only and all values given.",
        conceptFusion: "magnetic dipole + non-uniform field gradient",
        stemHint:
            "A current loop in a B-field that decreases linearly along x — find torque magnitude and stable equilibrium orientation.",
    },
    quantum_well_tunneling_probability: {
        pattern:
            "Finite potential well/barrier — link energy levels with tunneling or transmission probability.",
        required:
            "FUSE (A) bound-state quantization (or barrier height) AND (B) tunneling/transmission coefficient at given energy.",
        banned: "Infinite well only; bare T = e^{-2κa} with all constants listed.",
        conceptFusion: "quantum bound states + barrier tunneling",
        stemHint:
            "An electron in a finite square well has ground-state energy E; a thin barrier of height V₀ > E is inserted — find transmission probability.",
    },
    non_inertial_fluid_pressure: {
        pattern:
            "Fluid in accelerating frame — pseudo-force plus hydrostatic pressure variation.",
        required:
            "FUSE (A) non-inertial frame / acceleration AND (B) pressure variation in fluid (manometer or tilted tank).",
        banned: "Static hydrostatic P = ρgh only.",
        conceptFusion: "non-inertial mechanics + fluid statics",
        stemHint:
            "A tank of water accelerates horizontally; find pressure difference between front and rear walls at depth h.",
    },
    thermo_cycle_variable_heat_capacity: {
        pattern:
            "Thermodynamic cycle with temperature-dependent Cp/Cv or multi-stage process.",
        required:
            "FUSE (A) variable heat capacity or non-ideal stage AND (B) cyclic/net ΔU or ΔS across two+ legs.",
        banned: "Single isothermal ln(V) line with constant Cp.",
        conceptFusion: "thermodynamics cycles + variable heat capacity",
        stemHint:
            "An ideal gas with Cp = a + bT undergoes isobaric heating then adiabatic expansion — find net work per cycle.",
    },
    coupled_oscillator_energy_transfer: {
        pattern:
            "Coupled oscillators — normal modes or energy transfer between modes.",
        required:
            "FUSE (A) two coupled masses/springs AND (B) beat frequency or energy exchange time.",
        banned: "Single SHM period T = 2π√(m/k).",
        conceptFusion: "SHM + coupled oscillators",
        stemHint:
            "Two identical pendulums coupled by a light spring — find beat period and maximum energy transfer time.",
    },
    optics_aberration_lens_system: {
        pattern:
            "Multi-lens system with aberration or deviation from thin-lens ideal.",
        required:
            "FUSE (A) two optical elements (lenses/mirror) AND (B) chromatic/spherical aberration or separated image chain.",
        banned: "Single thin lens with u, f given.",
        conceptFusion: "geometric optics + multi-element system",
        stemHint:
            "Two separated lenses form a compound microscope objective+eyepiece — find magnifying power with near-point viewing.",
    },
    rotational_impulse_collision: {
        pattern:
            "Impulse on rigid body — angular impulse linked to linear collision.",
        required:
            "FUSE (A) rotational dynamics (I, ω) AND (B) impulse/momentum from collision or hinge constraint.",
        banned: "Pure linear collision without rotation.",
        conceptFusion: "rotation + impulse/collision",
        stemHint:
            "A rod hinged at one end is struck by a bullet at its free end — find angular velocity immediately after inelastic impact.",
    },
};

const CHEMISTRY_HARD_BLUEPRINTS = {
    thermodynamics_deltaG_from_K: {
        pattern: "ΔG° from K with temperature dependence or coupled equilibria.",
        required: "Link K, ΔG°, and at least one non-standard condition.",
        banned: "Direct ΔG = -RT ln K with all values given.",
    },
    kinetics_first_order_time: {
        pattern: "First-order integrated law with half-life comparison or parallel paths.",
        required: "Two time intervals or concentration ratios.",
        banned: "Single t = 0.693/k plug-in.",
    },
    equilibrium_mole_fraction: {
        pattern: "ICE table with total pressure or inert gas addition.",
        required: "At least two species and mole-fraction or partial-pressure ask.",
        banned: "Kp given, all initial moles given, one-step x.",
    },
    buffer_henderson_hasselbalch: {
        pattern: "Buffer after dilution or added strong acid/base.",
        required: "Recalculate ratio after a perturbation.",
        banned: "Direct Henderson-Hasselbalch with no change.",
    },
    solutions_molality: {
        pattern: "Mixing solutions or temperature-dependent density.",
        required: "Two solutions or dilution step.",
        banned: "Single m = n/kg.",
    },
    solutions_mixing_molarity: {
        pattern: "Mixing with volume change or common-ion effect on concentration.",
        required: "Total moles ÷ total volume explicitly.",
        banned: "Average of two molarities without moles.",
    },
    atomic_hybridization: {
        pattern: "Hybridization from structure or geometry with multiple atoms.",
        required: "Name compound or draw inference from properties.",
        banned: "Single atom with obvious geometry.",
    },
    atomic_radial_nodes: {
        pattern: "Radial nodes vs n and l with comparison across orbitals.",
        required: "Compare two orbitals or shells.",
        banned: "Single n - l - 1 plug-in.",
    },
    molecular_dipole_zero: {
        pattern: "Zero dipole from geometry — compare with polar analogues.",
        required: "Shape reasoning, not just formula recall.",
        banned: "Name one molecule without setup.",
    },
    electrochemistry_nernst: {
        pattern: "Nernst with concentration change or cell EMF under non-standard conditions.",
        required: "Log term with concentration ratio.",
        banned: "Standard E° only.",
    },
    gas_law_stoichiometry: {
        pattern: "Ideal gas + reaction stoichiometry or partial pressures.",
        required: "Link moles of gas to reaction extent.",
        banned: "Single PV = nRT.",
    },
    organic_nomenclature: {
        pattern: "IUPAC name or stereochemistry with functional group priority.",
        required: "Multi-functional or branched chain.",
        banned: "Two-carbon alkane name.",
    },
};

const MATH_HARD_BLUEPRINTS = {
    calculus: {
        pattern: "Definite integral or derivative application with constraint.",
        required: "Setup from word problem or parameter.",
        banned: "Bare differentiate sin x.",
    },
    algebra: {
        pattern: "Quadratic with parameter or inequality with cases.",
        required: "Case analysis or parameter range.",
        banned: "Solve x² - 5x + 6 = 0.",
    },
    coordinate_geometry: {
        pattern: "Locus, family of curves, or intersection with condition.",
        required: "Two geometric constraints.",
        banned: "Distance between two given points.",
    },
    trigonometry: {
        pattern: "Identity with constraint or triangle with multiple unknowns.",
        required: "At least two linked angles/sides.",
        banned: "Single sin² + cos².",
    },
    probability: {
        pattern: "Conditional probability or Bayes with two events.",
        required: "P(A|B) or total probability theorem.",
        banned: "Single coin toss.",
    },
};

const ALL_BLUEPRINTS = {
    ...PHYSICS_HARD_BLUEPRINTS,
    ...PHYSICS_CONCEPT_FUSION_BLUEPRINTS,
    ...CHEMISTRY_HARD_BLUEPRINTS,
    ...MATH_HARD_BLUEPRINTS,
    // Legacy slot ids → canonical blueprints
    optics: PHYSICS_HARD_BLUEPRINTS.optics_combined,
    modern_physics: PHYSICS_HARD_BLUEPRINTS.modern_physics_comparative,
    de_broglie_wavelength: PHYSICS_HARD_BLUEPRINTS.modern_physics_comparative,
    solid_state_fcc_density: CHEMISTRY_HARD_BLUEPRINTS.solutions_molality,
    chemical_kinetics_rate_law: CHEMISTRY_HARD_BLUEPRINTS.kinetics_first_order_time,
};

/** Physics-only archetypes — 15 unique slots (no within-batch repeat for batches ≤15). */
export const PHYSICS_ARCHETYPES = [
    "mechanics_kinematics",
    "rotational_dynamics",
    "optics_combined",
    "electromagnetism",
    "modern_physics_comparative",
    "thermodynamics_entropy",
    "waves_interference",
    "work_energy_power",
    "collision_momentum",
    "gravitation_orbit",
    "fluid_bernoulli",
    "capacitor_rc",
    "photoelectric_stopping",
    "optics_separated",
    "shm_superposition",
];

/**
 * Peak-difficulty physics archetypes — score well on JEE authenticity audit.
 * Prefer these first when bank is hard / exam-calibrated.
 */
export const PHYSICS_PEAK_ARCHETYPES = [
    "collision_momentum",
    "optics_separated",
    "gravitation_orbit",
    "thermodynamics_entropy",
    "fluid_bernoulli",
    "shm_superposition",
    "capacitor_rc",
    "photoelectric_stopping",
    "work_energy_power",
    "rotational_dynamics",
    "mechanics_kinematics",
];

/** Archetypes that often degrade to one-formula drills — require peak blueprint discipline. */
const PHYSICS_TEMPLATE_PRONE = new Set([
    "electromagnetism",
    "modern_physics_comparative",
    "waves_interference",
    "optics_combined",
]);

export const CHEMISTRY_PEAK_ARCHETYPES = [
    "equilibrium_mole_fraction",
    "electrochemistry_nernst",
    "buffer_henderson_hasselbalch",
    "kinetics_first_order_time",
    "thermodynamics_deltaG_from_K",
    "gas_law_stoichiometry",
    "organic_nomenclature",
];

export const MATH_PEAK_ARCHETYPES = [
    "coordinate_geometry",
    "probability",
    "calculus",
    "trigonometry",
];

/** Easy template → hard pattern redirect per archetype (for generation steering). */
const ARCHETYPE_HARD_REDIRECT = {
    waves_interference: {
        easy: "bare nth bright fringe with y = nλD/d only",
        hard: "distance between nth bright and mth dark on the same side, OR path difference with phase reversal / glass slab",
    },
    modern_physics_comparative: {
        easy: "single de Broglie λ at V volts for one particle",
        hard: "ratio λ₁/λ₂ for two species at same V, OR link λ to magnetic radius / stopping potential",
    },
    electromagnetism: {
        easy: "bare ε = BLv then P = ε²/R with all values listed",
        hard: "external force to maintain rod speed on rails, partial loop leaving field, OR RC transient + motional emf",
    },
    optics_combined: {
        easy: "convex+concave in contact with u = 30 cm",
        hard: "separated lens+mirror chain, silvered lens, or lens in different medium",
    },
    thermodynamics_entropy: {
        easy: "single isothermal ΔS = nR ln(V₂/V₁)",
        hard: "two-stage process (isothermal + adiabatic/isochoric) with net ΔS",
    },
    mechanics_kinematics: {
        easy: "single SUVAT with one unknown",
        hard: "pulley + incline with friction, or collision + kinematics constraint",
    },
    rotational_dynamics: {
        easy: "bare τ = Iα with all values given",
        hard: "rolling threshold μ, or composite body with parallel-axis theorem",
    },
    photoelectric_stopping: {
        easy: "single KE = hf − φ with all values given",
        hard: "work function from two wavelengths / stopping potentials",
    },
};

const normalizeSubjectPoolKey = (idOrLabel = "") => {
    const s = String(idOrLabel || "").toLowerCase();
    if (s.includes("physics")) return "physics";
    if (s.includes("math")) return "mathematics";
    if (s.includes("chem")) return "chemistry";
    return "chemistry";
};

/**
 * Ranked archetype pool — peak slots first for hard / exam-calibrated generation.
 */
export const getSubjectArchetypePool = (
    subjectKey = "",
    { preferPeak = false } = {}
) => {
    const key = normalizeSubjectPoolKey(subjectKey);
    let base;
    if (key === "physics") base = [...PHYSICS_ARCHETYPES];
    else if (key === "mathematics") base = [...MATH_ARCHETYPES];
    else base = [...CHEMISTRY_ARCHETYPES];

    if (!preferPeak) return base;

    let peak;
    if (key === "physics") peak = PHYSICS_PEAK_ARCHETYPES;
    else if (key === "mathematics") peak = MATH_PEAK_ARCHETYPES;
    else peak = CHEMISTRY_PEAK_ARCHETYPES;

    const rest = base.filter((a) => !peak.includes(a));
    return [...peak, ...rest];
};

const pickFromPool = (pool, index) =>
    pool[((index % pool.length) + pool.length) % pool.length];

/**
 * Allocate concept slots with peak-difficulty preference for hard banks.
 * `excludeArchetypes` — archetypes already used in prior chunks (max 1 per bank when possible).
 */
export const allocateRankedConceptSlots = (
    count,
    {
        examProfile = "competitive",
        subjectId = "",
        slotOffset = 0,
        subjects = null,
        preferPeak = false,
        bankDifficulty = "medium",
        excludeArchetypes = [],
        maxPerArchetype = 2,
    } = {}
) => {
    const n = Math.max(1, count);
    const offset = Math.max(0, Number(slotOffset) || 0);
    const usePeak =
        preferPeak ||
        String(bankDifficulty || "").toLowerCase() === "hard";

    const usageCount = new Map();
    for (const slot of excludeArchetypes || []) {
        const key = String(slot || "").trim();
        if (!key) continue;
        usageCount.set(key, (usageCount.get(key) || 0) + 1);
    }

    const pickLeastUsed = (pool, avoid = new Set()) => {
        const unused = pool.filter(
            (a) => !avoid.has(a) && (usageCount.get(a) || 0) === 0
        );
        if (unused.length) {
            return unused.sort((a, b) => pool.indexOf(a) - pool.indexOf(b))[0];
        }
        const ordered = [...pool]
            .filter((a) => !avoid.has(a))
            .sort((a, b) => {
                const ua = usageCount.get(a) || 0;
                const ub = usageCount.get(b) || 0;
                if (ua !== ub) return ua - ub;
                return pool.indexOf(a) - pool.indexOf(b);
            });
        const underCap = ordered.find(
            (a) => (usageCount.get(a) || 0) < maxPerArchetype
        );
        return underCap || ordered[0] || pool[0];
    };

    const swapSlot = (pool, slotIndex, nextArchetype) => {
        const prev = slots[slotIndex];
        if (prev === nextArchetype) return;
        if (prev) {
            const prevCount = (usageCount.get(prev) || 1) - 1;
            if (prevCount <= 0) usageCount.delete(prev);
            else usageCount.set(prev, prevCount);
        }
        slots[slotIndex] = nextArchetype;
        usageCount.set(nextArchetype, (usageCount.get(nextArchetype) || 0) + 1);
    };

    if (Array.isArray(subjects) && subjects.length > 1) {
        const subjectRows = subjects
            .map((s) => ({
                key: normalizeSubjectPoolKey(s.id || s.label),
                weight: Math.max(1, Number(s.count) || 1),
            }))
            .filter((s) => getSubjectArchetypePool(s.key).length);

        const totalWeight =
            subjectRows.reduce((sum, row) => sum + row.weight, 0) || 1;
        const slots = [];
        let archetypeIndex = offset;

        for (let i = 0; i < n; i++) {
            let cursor = (i + offset) % totalWeight;
            let chosen = subjectRows[0];
            for (const row of subjectRows) {
                if (cursor < row.weight) {
                    chosen = row;
                    break;
                }
                cursor -= row.weight;
            }
            const pool = getSubjectArchetypePool(chosen.key, {
                preferPeak: usePeak,
            });
            const pick = pickLeastUsed(pool);
            slots.push(pick);
            usageCount.set(pick, (usageCount.get(pick) || 0) + 1);
            archetypeIndex += 1;
        }
        return slots;
    }

    const sid = String(subjectId || "").toLowerCase();
    const isStemSubject =
        sid === "physics" || /physics/.test(sid) ||
        sid === "mathematics" || /math/.test(sid) ||
        sid === "chemistry" || /chem/.test(sid) ||
        examProfile === "jee_main" || examProfile === "jee_advanced" ||
        examProfile === "neet";

    if (!isStemSubject) {
        // No hand-curated archetype catalog exists for non-STEM domains
        // (law/GK/reasoning/etc.) — this is a last-resort path (the AI-first
        // planner in conceptArchetypePlanner.service.js is tried first), so
        // return generic numbered slots instead of silently defaulting to
        // chemistry archetypes for an unrelated subject.
        return Array.from({ length: n }, (_, i) => `concept_slot_${offset + i + 1}`);
    }

    // Subject must be pinned to its own pool whenever it's explicitly known —
    // the mixed PCM pool below is only for a genuinely unset subject (e.g. a
    // full-paper JEE bank spanning all three). Previously "chemistry" fell
    // through to the mixed branch below (it only matched physics/math),
    // silently pulling in Physics/Maths archetypes for a Chemistry-only bank.
    let pool = getSubjectArchetypePool("chemistry", { preferPeak: usePeak });
    if (sid === "physics" || /physics/.test(sid)) {
        pool = getSubjectArchetypePool("physics", { preferPeak: usePeak });
    } else if (sid === "mathematics" || /math/.test(sid)) {
        pool = getSubjectArchetypePool("mathematics", { preferPeak: usePeak });
    } else if (sid === "chemistry" || /chem/.test(sid)) {
        pool = getSubjectArchetypePool("chemistry", { preferPeak: usePeak });
    } else if (examProfile === "jee_main" || examProfile === "jee_advanced") {
        pool = [
            ...getSubjectArchetypePool("chemistry", { preferPeak: usePeak }),
            ...getSubjectArchetypePool("physics", { preferPeak: usePeak }),
            ...getSubjectArchetypePool("mathematics", { preferPeak: usePeak }),
        ];
    }

    const slots = [];
    for (let i = 0; i < n; i++) {
        const pick = pickLeastUsed(pool);
        slots.push(pick);
        usageCount.set(pick, (usageCount.get(pick) || 0) + 1);
    }

    for (let i = 1; i < slots.length; i++) {
        if (slots[i] === slots[i - 1]) {
            const alt = pickLeastUsed(pool, new Set([slots[i - 1]]));
            if (alt && alt !== slots[i]) swapSlot(pool, i, alt);
        }
    }

    if (slots.length <= pool.length) {
        const used = new Set();
        for (let i = 0; i < slots.length; i++) {
            if (!used.has(slots[i])) {
                used.add(slots[i]);
                continue;
            }
            const replacement = pickLeastUsed(
                pool,
                new Set([slots[i - 1], slots[i]])
            );
            if (replacement && replacement !== slots[i]) {
                swapSlot(pool, i, replacement);
                used.add(replacement);
            }
        }
    }

    return slots;
};

/** Prompt block listing archetypes already used in this bank — forbid repeats. */
export const buildBankArchetypeExcludeBlock = (usedArchetypes = []) => {
    const list = [...new Set((usedArchetypes || []).map(String).filter(Boolean))];
    if (!list.length) return "";
    return `
**BANK ARCHETYPE EXCLUSIONS (already used in prior chunks — do NOT repeat these problem types):**
${list.map((a) => `- ${a}`).join("\n")}
Each new skeleton must use its **assigned slot archetype** and a **fresh setup** — never another SHM-superposition / photoelectric / satellite-orbit clone.`;
};

export const getSubjectLabelForArchetypes = (subjectId = "") => {
    const sid = String(subjectId || "").trim();
    if (/physics/i.test(sid)) return "Physics";
    if (/math/i.test(sid)) return "Mathematics";
    if (/chem/i.test(sid)) return "Chemistry";
    return sid || "the subject";
};

/** Tells the LLM each slot is a peak archetype — choose hard pattern, not easy template. */
export const buildSubjectArchetypeSelectionBlock = ({
    conceptSlots = [],
    subjectId = "",
    examProfile = "jee_main",
    preferPeak = false,
} = {}) => {
    if (!conceptSlots.length || !preferPeak) return "";

    const examLabel =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";
    const subjectLabel = getSubjectLabelForArchetypes(subjectId);

    const redirects = [...new Set(conceptSlots)]
        .filter((s) => ARCHETYPE_HARD_REDIRECT[s])
        .map((s) => {
            const r = ARCHETYPE_HARD_REDIRECT[s];
            return `- **${s}:** do NOT write "${r.easy}" → write: ${r.hard}`;
        });

    const peakNote =
        normalizeSubjectPoolKey(subjectId) === "physics"
            ? `Peak pool used: ${PHYSICS_PEAK_ARCHETYPES.slice(0, 6).join(", ")}, …`
            : "Peak-difficulty archetypes from this subject were assigned first.";

    return `
**SUBJECT ARCHETYPE SELECTION — ${subjectLabel} (${examLabel} hard tier):**
Each slot below was **pre-selected from the hardest ${subjectLabel} archetypes** in our catalog — not a random syllabus topic.
${peakNote}

**Your job:** write the **peak (hard) pattern** for the assigned slot. If the draft feels like an NCERT exercise → **do not switch topic** — add a second constraint, linked quantity, or comparative setup per the blueprint.

**Template downgrade forbidden (use assigned slot's hard pattern instead):**
${redirects.length ? redirects.join("\n") : "- No single-formula plug-ins at hard tier — follow each slot blueprint."}

**Never** substitute an easier archetype than the one assigned in CONCEPT SLOTS.`;
};

export const CHEMISTRY_ARCHETYPES = Object.keys(CHEMISTRY_HARD_BLUEPRINTS);
export const MATH_ARCHETYPES = Object.keys(MATH_HARD_BLUEPRINTS);

export const getArchetypeBlueprint = (conceptSlot = "") =>
    ALL_BLUEPRINTS[String(conceptSlot || "").trim()] || null;

/** Merge catalog fusion templates into AI-planned slot blueprints. */
export const enrichBlueprintWithConceptFusion = (conceptSlot = "", blueprint = {}) => {
    const catalog = getArchetypeBlueprint(conceptSlot);
    if (!catalog) return blueprint;

    const required =
        blueprint.required && /FUSE|linked concepts/i.test(blueprint.required)
            ? blueprint.required
            : catalog.required || blueprint.required;

    return {
        pattern: blueprint.pattern || catalog.pattern || "",
        required,
        banned: blueprint.banned || catalog.banned || "",
        stemHint: blueprint.stemHint || catalog.stemHint || "",
        ...(catalog.conceptFusion
            ? { conceptFusion: catalog.conceptFusion }
            : {}),
    };
};

export const buildArchetypeAuthoringBlock = ({
    conceptSlot = "",
    tier = "hard",
    examProfile = "jee_main",
} = {}) => {
    const bp = getArchetypeBlueprint(conceptSlot);
    if (!bp) {
        return `
**CONCEPT SLOT "${conceptSlot}" — hard-tier authoring:**
- Multi-condition stem (3+ sentences, 2+ linked concepts).
- ${tier === "hard" ? "≥4" : "≥3"} solve steps with distinct reasoning.
- No single-formula plug-in or chapter-test template.`;
    }

    const examLabel =
        examProfile === "jee_advanced"
            ? "JEE Advanced"
            : examProfile === "jee_main"
              ? "JEE Main shift-paper"
              : "entrance exam";

    return `
**CONCEPT SLOT BLUEPRINT — "${conceptSlot}" (${examLabel}, ${tier}-tier):**
- **Pattern:** ${bp.pattern}
- **Required:** ${bp.required}
- **BANNED:** ${bp.banned}
${bp.stemHint ? `- **Stem shape example (write a NEW problem, do not copy):** ${bp.stemHint}` : ""}

Your stem MUST satisfy the pattern and required lines above.`;
};

/** Per-slot blueprints for a batch solve-first prompt — drives proper hard generation upfront. */
export const buildBatchArchetypeGuidanceBlock = ({
    conceptSlots = [],
    slotPlans = null,
    difficultyTierSlots = [],
    examProfile = "jee_main",
    slotOffset = 0,
    aiSteered = false,
} = {}) => {
    if (!conceptSlots.length) return "";

    const planBySlot = new Map(
        (slotPlans || []).map((p) => [p.conceptSlot, p])
    );

    const blocks = conceptSlots.map((slot, i) => {
        const tier = difficultyTierSlots[i] || "hard";
        const n = slotOffset + i + 1;
        const plan = planBySlot.get(slot);
        const bp = enrichBlueprintWithConceptFusion(
            slot,
            plan?.blueprint || getArchetypeBlueprint(slot) || {}
        );
        const redirect = aiSteered ? null : ARCHETYPE_HARD_REDIRECT[slot];
        const proneTag =
            !aiSteered && PHYSICS_TEMPLATE_PRONE.has(slot)
                ? " ⚠ template-prone — write PEAK pattern only"
                : "";
        const slotTitle = plan?.label
            ? `${slot} (${plan.label})`
            : slot;
        const kind = plan?.questionKind || "multi_concept";
        if (kind === "theory") {
            // Theory slot: conceptual/assertion-reason — hard via concept depth and
            // close distractors, NOT numeric givens or solve-step count.
            return `**Slot ${n} [${tier}] — ${slotTitle} · THEORY (conceptual, no computation):**
- Pattern: ${bp?.pattern || "Assertion–reason / statement-correctness item probing deep understanding."}
- Required: ${bp?.required || "Discriminate close concepts; correctness hinges on understanding, not a formula."}
${bp?.conceptFusion ? `- **Concept fusion:** ${bp.conceptFusion}` : ""}
- Banned: ${bp?.banned || "Any numeric given or single-formula solve; trivially-true restatement."}
- **No numeric givens, no solveSteps requirement** — difficulty comes from subtle distractors and concept depth.${bp?.stemHint ? `\n- Stem shape: ${bp.stemHint}` : ""}`;
        }
        if (kind === "direct") {
            // Direct slot: one clean single-formula / single-concept numerical MCQ.
            // A single-step solve is CORRECT here — do NOT force multi-step fusion.
            return `**Slot ${n} [${tier}] — ${slotTitle} · DIRECT (single-formula numerical):**
- Pattern: ${bp?.pattern || "Direct application of one formula/concept — a clean ~1–2 step numerical MCQ."}
- Required: ${bp?.required || "One formula/concept, clear numeric answer among the options; state units."}
- Banned: ${bp?.banned || "Multi-concept fusion, ≥3-step derivations, or contrived linked setups."}
- **One direct solve is fine** — do NOT force ≥3 solve steps or concept fusion; keep it a genuine (not trick) single-step item.${bp?.stemHint ? `\n- Stem shape: ${bp.stemHint}` : ""}`;
        }
        if (!bp) {
            return `**Slot ${n} [${tier}] — ${slotTitle}${proneTag}:** Multi-condition stem, ≥4 solve steps, no formula drill.`;
        }
        return `**Slot ${n} [${tier}] — ${slotTitle}${proneTag}:**
- Pattern: ${bp.pattern}
- Required: ${bp.required}
${bp.conceptFusion ? `- **Concept fusion (mandatory):** ${bp.conceptFusion}` : ""}
- Banned: ${bp.banned}
${redirect ? `- **Choose HARD (not easy):** ${redirect.hard}\n- **Reject easy template:** ${redirect.easy}` : ""}
${bp.stemHint ? `- Stem shape: ${bp.stemHint}` : ""}`;
    });

    const kindOf = (slot) => planBySlot.get(slot)?.questionKind || "multi_concept";
    const hasTheorySlot = conceptSlots.some((slot) => kindOf(slot) === "theory");
    const hasDirectSlot = conceptSlots.some((slot) => kindOf(slot) === "direct");

    const examLabel =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";

    const steeringNote = aiSteered
        ? "Blueprints below were **planned by AI** for this batch's syllabus and exclusions — follow each slot exactly."
        : "Blueprints below use the subject archetype catalog — follow each slot exactly.";

    return `
**AUTHORING BLUEPRINT — one ${examLabel} question per slot, matching each slot's kind (${steeringNote}):**
${blocks.join("\n\n")}

**Rules for MULTI_CONCEPT slots (default / peak-hard):**
- Stem: 3–4 sentences, ≥2 numerical givens with units, **≥2 linked concepts**, constraint before the ask.
- solveSteps: **≥3** solving steps, **≥4** substantive derivation lines; no direct substitution; last sentence = finalAnswer.display.
- Never write chapter-test / NCERT drill / single-formula plug-ins.${
        hasDirectSlot
            ? `

**Rules for DIRECT slots (marked "DIRECT" above):**
- A **single formula/concept applied in ~1–2 steps is CORRECT** — do NOT force ≥3 solve steps or concept fusion.
- Still a real numerical MCQ: state units, compute the answer, and make it appear among the options.
- Keep it genuine (not a trick); these are the routine items that make up the bulk of a real paper.`
            : ""
    }${
        hasTheorySlot
            ? `

**Rules for THEORY slots (marked "THEORY" above):**
- Do **not** force numeric givens or a solveSteps count — a theory item may have none.
- Difficulty must come from **conceptual depth and close, plausible distractors** (assertion–reason, statement analysis, mechanism/definition discrimination).
- Reject anything that is a single trivially-true fact restated as the answer.`
            : ""
    }`;
};

export const buildJeeHardStemAuthoringBlock = (examProfile = "jee_main") => {
    const label =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";
    return `
**${label} HARD STEM STANDARD (author at this depth — do not under-shoot):**

**Veteran bar:** A repeater with 1000+ mocks should need **4+ minutes** and **≥4 solve steps**. Stems under 3 sentences or solvable by one formula → **reject and rewrite**.

**Model stem (match this complexity, new numbers/setup):**
"A solid sphere of radius R rolls without slipping on a rough incline of angle 37°. Given μ = 0.4 and the sphere starts from rest, find the linear acceleration of its center of mass after rotating through 2 radians."

**Another model (comparative modern physics):**
"An electron and a proton are each accelerated through the same potential difference V = 200 V. Find the ratio of their de Broglie wavelengths."

**Another model (combined optics):**
"A thin convex lens (f₁ = 20 cm) is placed in contact with a concave lens (f₂ = 10 cm). A point object is placed 30 cm from the combination. Determine the position of the final image."

**Never output:** one-line formula drills, bare "calculate λ at V volts", single lens-formula with u and f given, or stems under 3 sentences.`;
};

/** Templates that score low on JEE authenticity difficulty audit — never generate these at hard tier. */
export const buildJeeMainHardAntiTemplateBlock = (examProfile = "jee_main") => {
    const label =
        examProfile === "jee_advanced" ? "JEE Advanced" : "JEE Main shift-paper";
    return `
**${label} HARD TIER — NEVER GENERATE (authenticity audit scores these as too easy):**
- Young's double-slit: bare "find distance of nth bright fringe" with y = nλD/d only.
- Thermodynamics: single isothermal ΔS = nR ln(V₂/V₁) with volumes given.
- Optics: convex+concave in contact with u = 30 cm (overused template) — use separated lenses, mirror+lens, or medium change.
- Mechanics: repeated "at maximum height, second particle projected/dropped" — use collision, relative motion on incline, or energy+constraint instead.
- EM: bare ε = BLv then P = ε²/R with all values listed — add capacitor/inductor, partial loop in field, or force to maintain speed.
- Modern physics: single de Broglie at V volts — use comparative λ ratios or link to magnetic radius.
- Rotational: energy conservation only with standard incline — add external torque, slipping threshold, or combined translation+rotation constraint.
- Car kinematics: piecewise accelerate–cruise–decelerate distance (textbook template).

If your draft matches any line above → **do not pick an easier topic** — deepen the **assigned concept slot** using its peak blueprint instead (see AUTHORING BLUEPRINT).

**Redirect map (same subject, harder pattern):**
- YDSE template → waves_interference peak: bright vs dark fringe on same side
- de Broglie at V → modern_physics_comparative peak: λ ratio or λ vs magnetic radius
- ε = BLv power → electromagnetism peak: force to maintain speed OR partial loop + circuit
- Lens in contact u = 30 cm → optics_separated or optics_combined peak: separated lens+mirror
- Isothermal ΔS only → thermodynamics_entropy peak: multi-stage cycle ΔS`;
};

export default {
    PHYSICS_ARCHETYPES,
    PHYSICS_PEAK_ARCHETYPES,
    CHEMISTRY_ARCHETYPES,
    CHEMISTRY_PEAK_ARCHETYPES,
    MATH_ARCHETYPES,
    MATH_PEAK_ARCHETYPES,
    buildArchetypeAuthoringBlock,
    buildBatchArchetypeGuidanceBlock,
    buildJeeHardStemAuthoringBlock,
    buildJeeMainHardAntiTemplateBlock,
    buildSubjectArchetypeSelectionBlock,
    buildBankArchetypeExcludeBlock,
    getArchetypeBlueprint,
    getSubjectArchetypePool,
    allocateRankedConceptSlots,
};
