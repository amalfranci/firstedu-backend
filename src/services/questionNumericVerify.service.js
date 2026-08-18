/**
 * Independent numeric / factual verification from question stems.
 * Used in solve-first validation and post-generation audit.
 */

import {
    extractHybridizationFromText,
    extractMoleculeFromStem,
    getHybridizationForFormula,
    hybridizationMatches,
    isZeroDipoleMolecule,
    normFormula,
    parseOrbitalFromStem,
    radialNodesForOrbital,
} from "./chemistryFacts.service.js";

const R = 8.314; // J K⁻¹ mol⁻¹
const H = 6.626e-34;
const E_MASS = 9.1e-31;

export const parseNumber = (text) => {
    // Convert superscript digits and minus to ASCII
    const superscriptMap = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '−': '-' };
    let s = String(text || "").replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻−]/g, m => superscriptMap[m]);

    // Handle scientific notation: × 10^N, × 10N, x 10^-N, x 10-N → e+N / e-N.
    // The optional \^? is required for CARET notation ("× 10^8") — the single most
    // common form LLMs actually emit — which this regex previously did not match at
    // all (it only matched an optional "-" directly after "10", nothing else), so
    // "1.6737 × 10^8" silently parsed as 1.6737, dropping the exponent entirely.
    s = s.replace(/[×x]\s*10\s*\^?\s*(-?)\s*(\d+)/gi, (_, sign, exp) => {
        // Use the minus sign if present, otherwise positive exponent
        const op = sign === '-' ? '-' : '+';
        return `e${op}${exp}`;
    });

    s = s
        .replace(/,/g, "")
        .trim();
    // Match numeric values with optional whitespace around the 'e' in exponent notation
    const m = s.match(/-?\d+(?:\.\d+)?(?:\s*e[+-]?\d+)?/i);
    return m ? Number(m[0].replace(/\s/g, '')) : NaN;
};

/**
 * Distinguish true numeric options (numbers with optional units)
 * from text containing digits (e.g., "Team 3", "1st place").
 *
 * Returns true for: "123", "123.45", "123 J", "1.5 kW", "0.005 mol/L"
 * Returns false for: "Team 1", "1st place", "pH 3", "Year 2023"
 */
export const isNumericAnswer = (option) => {
    const text = String(option || "").trim();
    if (!text) return false;

    // Match: number with optional unit, but not text containing a digit
    // Pattern: -?\d+(\.\d+)? optionally followed by space + unit
    const numericPattern = /^-?(\d+(?:\.\d+)?|\d+\/\d+)(?:\s+[a-zA-Z°\/·\-]+)?$/;
    return numericPattern.test(text);
};

/**
 * Inverse of isNumericAnswer — text options that are not numeric.
 */
export const isTextAnswer = (option) => !isNumericAnswer(option);

/** Extract first N numeric literals from stem (with optional unit suffix). */
const extractNumbers = (stem, limit = 12) => {
    const matches = [
        ...String(stem || "").matchAll(
            /(\d+(?:\.\d+)?)\s*(?:×|x)\s*10\s*[⁻−-]?\s*(\d+)|(\d+(?:\.\d+)?)/gi
        ),
    ];
    const out = [];
    for (const m of matches) {
        if (m[1] != null && m[2] != null) {
            out.push(Number(m[1]) * 10 ** -Number(m[2]));
        } else if (m[3] != null) {
            out.push(Number(m[3]));
        }
        if (out.length >= limit) break;
    }
    return out;
};

const optionNumeric = (opt) => parseNumber(opt);

const findOptionForValue = (options, value, tolerance = 0.06) => {
    if (!Number.isFinite(value)) return -1;
    return (options || []).findIndex((o) => {
        const n = optionNumeric(o);
        if (!Number.isFinite(n)) return false;
        if (Math.abs(n - value) <= tolerance) return true;
        if (value !== 0 && Math.abs(n - value) / Math.abs(value) <= 0.02) return true;
        return false;
    });
};

const getMarkedIndex = (q) => {
    if (Number.isFinite(q.correctIndex)) return q.correctIndex;
    const letter = String(q.correctAnswer || "").match(/^([A-D])/i)?.[1];
    return letter ? letter.toUpperCase().charCodeAt(0) - 65 : 0;
};

/** ΔG° = −RT ln K at temperature T (K). */
const tryDeltaG = (stem) => {
    if (!/\bΔG|delta\s*G|gibbs|equilibrium constant\b/i.test(stem)) return null;
    const kMatch = stem.match(/K\s*(?:=|is)\s*(\d+(?:\.\d+)?)\s*(?:×|x)\s*10\s*[⁻−-]?\s*(\d+)/i);
    const tMatch = stem.match(/(\d+(?:\.\d+)?)\s*K\b/);
    if (!kMatch || !tMatch) return null;
    const K = Number(kMatch[1]) * 10 ** -Number(kMatch[2]);
    const T = Number(tMatch[1]);
    const dG = (-R * T * Math.log(K)) / 1000; // kJ/mol
    return { value: dG, display: `${dG.toFixed(1)} kJ/mol`, unit: "kJ/mol" };
};

/** First-order: t = ln(C0/C) / k */
const tryFirstOrder = (stem) => {
    if (!/first[- ]order|rate constant/i.test(stem)) return null;
    const kMatch = stem.match(
        /(\d+(?:\.\d+)?)\s*min\s*(?:[⁻−-]?\s*¹|[-−]?\s*1|\^-1)/i
    );
    if (!kMatch) return null;
    const k = Number(kMatch[1]);
    let ratio = null;
    if (/12\.5\s*%|1\/8|eighth/i.test(stem)) ratio = 8;
    else if (/25\s*%|1\/4|quarter/i.test(stem)) ratio = 4;
    else if (/50\s*%|half/i.test(stem)) ratio = 2;
    else {
        const frac = stem.match(/(\d+(?:\.\d+)?)\s*%/);
        if (frac) ratio = 100 / Number(frac[1]);
    }
    if (!ratio || !k) return null;
    const t = Math.log(ratio) / k;
    return { value: t, display: `${Math.round(t)} min`, unit: "min" };
};

/** Henderson–Hasselbalch: pH = pKa + log([A⁻]/[HA]) */
const tryBufferPh = (stem) => {
    if (!/\bph\b|\bbuffer\b|\bpka\b/i.test(stem)) return null;
    const pKaMatch = stem.match(
        /pKa\s*(?:of\s+[\w\s]+\s+is\s+|is\s+)?(\d+(?:\.\d+)?)/i
    );
    const concs = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*M/gi)].map((m) =>
        Number(m[1])
    );
    if (!pKaMatch || concs.length < 2) return null;
    const pKa = Number(pKaMatch[1]);
    const [acid, base] = concs;
    const pH = pKa + Math.log10(base / acid);
    return { value: pH, display: pH.toFixed(2), unit: "" };
};

/** Molality: moles solute / kg solvent */
const tryMolality = (stem) => {
    if (!/\bmolality\b/i.test(stem) && !/\bg\s+of\s+water\b/i.test(stem)) return null;
    const massSolute = stem.match(/(\d+(?:\.\d+)?)\s*g\s+of\s+[A-Za-z]/i);
    const mw = stem.match(/molar mass\s*(\d+(?:\.\d+)?)/i);
    const solvent = stem.match(/(\d+(?:\.\d+)?)\s*g\s+of\s+water/i);
    if (!massSolute || !mw || !solvent) return null;
    const moles = Number(massSolute[1]) / Number(mw[1]);
    const m = moles / (Number(solvent[1]) / 1000);
    return { value: m, display: `${m.toFixed(2)} mol/kg`, unit: "mol/kg" };
};

/** Molarity from mixing: (C1V1 + C2V2) / (V1+V2) */
const tryMixingMolarity = (stem) => {
    if (!/\bmolarity\b/i.test(stem) || !/mix/i.test(stem)) return null;
    const mls = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*mL/gi)].map((x) => Number(x[1]));
    const Ms = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*M\b/gi)].map((x) => Number(x[1]));
    if (mls.length < 2 || Ms.length < 2) return null;
    const [v1, v2] = mls;
    const [c1, c2] = Ms;
    const molarity = (c1 * v1 + c2 * v2) / (v1 + v2);
    return { value: molarity, display: `${molarity.toFixed(2)} M`, unit: "M" };
};

/** de Broglie λ = h / (mv) */
const tryDeBroglie = (stem) => {
    if (!/de\s*broglie|wavelength/i.test(stem)) return null;
    const vMatch = stem.match(/velocity\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:×|x)\s*10\s*[⁶6]/i);
    if (!vMatch) return null;
    const v = Number(vMatch[1]) * 1e6;
    const lambda = H / (E_MASS * v);
    const nm = lambda * 1e9;
    return { value: nm, display: `${nm.toFixed(2)} nm`, unit: "nm" };
};

/** ΔS = ΔH_vap / T (J/mol·K) */
const tryEntropyVap = (stem) => {
    if (!/\bΔS|entropy|vaporization/i.test(stem)) return null;
    const hMatch = stem.match(/(\d+(?:\.\d+)?)\s*kJ\/mol/i);
    if (!hMatch) return null;
    const dH = Number(hMatch[1]) * 1000;
    const T = 373.15;
    const dS = dH / T;
    return { value: dS, display: `${dS.toFixed(1)} J/mol·K`, unit: "J/mol·K" };
};

/** Hybridization from molecule in stem */
const tryHybridization = (stem) => {
    if (!/hybridization/i.test(stem)) return null;
    const mol = extractMoleculeFromStem(stem);
    if (!mol) return null;
    const hyb = getHybridizationForFormula(mol);
    if (!hyb) return null;
    return { value: hyb, display: hyb, unit: "", type: "hybridization" };
};

/** Radial nodes for orbital */
const tryRadialNodes = (stem) => {
    if (!/radial node/i.test(stem)) return null;
    const orb = parseOrbitalFromStem(stem);
    if (!orb) return null;
    const nodes = radialNodesForOrbital(orb.n, orb.l);
    return { value: nodes, display: String(nodes), unit: "", type: "integer" };
};

const pickStemQuantity = (stem, patterns) => {
    for (const re of patterns) {
        const m = String(stem || "").match(re);
        if (m?.[1] != null) return Number(m[1]);
    }
    return NaN;
};

/** Motional EMF circuit: P = ε²/R, ε = BLv (rod or loop leaving uniform B). */
const tryEmPowerDissipation = (stem) => {
    if (
        !/power\s+dissipat|heat\s+in\s+the\s+(?:circuit|loop)/i.test(stem) &&
        !/power\s+in\s+the\s+loop/i.test(stem)
    ) {
        return null;
    }
    if (!/magnetic\s+field|\bB\s*=|\bT\b/i.test(stem)) return null;

    const B = pickStemQuantity(stem, [
        /magnetic\s+field\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*T\b/i,
        /uniform\s+magnetic\s+field\s+of\s+(\d+(?:\.\d+)?)\s*T/i,
        /field\s+of\s+(\d+(?:\.\d+)?)\s*T\b/i,
    ]);
    const L = pickStemQuantity(stem, [
        /(?:length|side)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*m\b/i,
        /rod\s+of\s+length\s+(\d+(?:\.\d+)?)\s*m/i,
        /loop\s+of\s+side\s+(\d+(?:\.\d+)?)\s*m/i,
    ]);
    const v = pickStemQuantity(stem, [
        /(?:velocity|speed)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*m\s*\/\s*s/i,
        /(?:velocity|speed)\s+of\s+(\d+(?:\.\d+)?)\s*m/i,
        /constant\s+speed\s+of\s+(\d+(?:\.\d+)?)\s*m/i,
    ]);
    const R = pickStemQuantity(stem, [
        /resistance\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:Ω|ohm)/i,
        /total\s+resistance\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:Ω|ohm)?/i,
    ]);

    if (
        !Number.isFinite(B) ||
        !Number.isFinite(L) ||
        !Number.isFinite(v) ||
        !Number.isFinite(R) ||
        R <= 0
    ) {
        return null;
    }

    const eps = B * L * v;
    const P = (eps * eps) / R;
    const rounded = Math.round(P * 1000) / 1000;
    return {
        value: rounded,
        display: `${rounded} W`,
        unit: "W",
    };
};

/** λ_e/λ_α when both accelerated through the same potential V. */
const tryDeBroglieRatio = (stem) => {
    if (!/de\s+broglie|broglie\s+wavelength/i.test(stem)) return null;
    if (!/ratio/i.test(stem)) return null;

    const massTimes = stem.match(
        /mass\s+(?:of\s+[\w\s]+\s+)?(?:as\s+)?(\d+(?:\.\d+)?)\s*times\s+the\s+mass/i
    );
    const chargeTimes = stem.match(
        /charge\s+as\s+(\d+(?:\.\d+)?)\s*times\s+the\s+charge/i
    );
    if (massTimes && chargeTimes) {
        const ratio = Math.sqrt(
            Number(massTimes[1]) * Number(chargeTimes[1])
        );
        const rounded = Math.round(ratio * 10) / 10;
        return { value: rounded, display: String(rounded), unit: "" };
    }

    const massRatio = stem.match(
        /mass\s+ratio\s+m[pα]\s*\/\s*m[eα]\s*[≈~]?\s*(\d+(?:\.\d+)?)/i
    );
    if (massRatio && /proton/i.test(stem) && /electron/i.test(stem)) {
        const ratio = Math.sqrt(Number(massRatio[1]));
        return {
            value: ratio,
            display: String(Math.round(ratio)),
            unit: "",
        };
    }

    const approx = stem.match(
        /(?:Take|take)\s+mass\s+ratio\s+m[pα]\s*\/\s*m[eα]\s*[≈~]?\s*(\d+(?:\.\d+)?)/i
    );
    if (approx) {
        const ratio = Math.sqrt(Number(approx[1]));
        return {
            value: ratio,
            display: String(Math.round(ratio)),
            unit: "",
        };
    }
    return null;
};

/** Zero dipole — which molecule in options */
const tryZeroDipole = (stem, options) => {
    if (!/zero\s+dipole|dipole moment/i.test(stem)) return null;
    if (!options?.length) return null;
    const zeroOpts = options.filter((o) => isZeroDipoleMolecule(o));
    if (zeroOpts.length !== 1) return null;
    return { value: zeroOpts[0], display: zeroOpts[0], unit: "", type: "molecule" };
};

const SOLVERS = [
    tryDeltaG,
    tryFirstOrder,
    tryBufferPh,
    tryMolality,
    tryMixingMolarity,
    tryEmPowerDissipation,
    tryDeBroglieRatio,
    tryDeBroglie,
    tryEntropyVap,
    tryHybridization,
    tryRadialNodes,
];

/**
 * Independently solve a question where possible.
 * @returns {{ verified: boolean, expected?: object, matchedOptionIndex?: number, issue?: string }}
 */
export const independentlyVerifyQuestion = (q) => {
    const stem = q.questionText || "";
    const options = q.options || [];
    const markedIdx = getMarkedIndex(q);

    for (const solve of SOLVERS) {
        const expected = solve(stem, options);
        if (!expected) continue;

        if (expected.type === "hybridization") {
            const markedHyb = extractHybridizationFromText(options[markedIdx]);
            if (!markedHyb || !hybridizationMatches(markedHyb, expected.display)) {
                const altIdx = options.findIndex((o) =>
                    hybridizationMatches(extractHybridizationFromText(o), expected.display)
                );
                return {
                    verified: false,
                    expected,
                    matchedOptionIndex: altIdx,
                    issue: `Hybridization for ${extractMoleculeFromStem(stem) || "molecule"} should be ${expected.display}, not ${markedHyb || options[markedIdx]}.`,
                };
            }
            return { verified: true, expected, matchedOptionIndex: markedIdx };
        }

        if (expected.type === "molecule") {
            const marked = String(options[markedIdx] || "").trim();
            if (normFormula(marked) !== normFormula(expected.display)) {
                const altIdx = options.findIndex(
                    (o) => normFormula(o) === normFormula(expected.display)
                );
                return {
                    verified: false,
                    expected,
                    matchedOptionIndex: altIdx,
                    issue: `Zero dipole molecule should be ${expected.display}, marked ${marked}.`,
                };
            }
            return { verified: true, expected, matchedOptionIndex: markedIdx };
        }

        const idx = findOptionForValue(options, expected.value);
        if (idx < 0) {
            return {
                verified: false,
                expected,
                issue: `Computed ${expected.display} but value not found among options.`,
            };
        }
        if (idx !== markedIdx) {
            return {
                verified: false,
                expected,
                matchedOptionIndex: idx,
                issue: `Computed ${expected.display} (option ${String.fromCharCode(65 + idx)}) but marked ${String.fromCharCode(65 + markedIdx)} (${options[markedIdx]}).`,
            };
        }
        return { verified: true, expected, matchedOptionIndex: markedIdx };
    }

    const dipole = tryZeroDipole(stem, options);
    if (dipole) {
        const altIdx = options.findIndex(
            (o) => normFormula(o) === normFormula(dipole.display)
        );
        if (altIdx !== markedIdx) {
            return {
                verified: false,
                expected: dipole,
                matchedOptionIndex: altIdx,
                issue: dipole.issue || `Marked answer should be ${dipole.display}.`,
            };
        }
        return { verified: true, expected: dipole, matchedOptionIndex: markedIdx };
    }

    const explainCheck = verifyExplanationMarkedNumericAgreement(q);
    if (explainCheck?.verified === false) {
        return explainCheck;
    }

    return { verified: null };
};

/** Last numeric value asserted in explanation tail (before "Therefore"). */
const extractLastExplanationNumeric = (explanation = "") => {
    const body =
        String(explanation || "").split(/\bTherefore\b/i)[0] ||
        String(explanation || "");
    const tail = body.slice(Math.max(0, body.length - 420));
    const matches = [
        ...tail.matchAll(
            /(?:=|is|are|gives?|yields?|equals?|calculated\s+as)\s*(-?\d+(?:\.\d+)?)\s*(mm|cm|m|eV|keV|MeV|GeV(?:²)?|nm|Å|Hz|kHz|s|ms|N|J|W|Pa|kPa|atm|%|rad\/s|m\/s(?:²)?)?/gi
        ),
    ];
    if (!matches.length) return null;
    const last = matches[matches.length - 1];
    const raw = last[1];
    const value = parseNumber(raw);
    if (!Number.isFinite(value)) return null;
    return { value, raw, unit: String(last[2] || "").trim() };
};

const optionContainsNumericValue = (optText, value, raw) => {
    const target = Number.isFinite(value) ? value : parseNumber(raw);
    const fromOpt = parseNumber(optText);
    if (Number.isFinite(target) && Number.isFinite(fromOpt)) {
        const tol = Math.max(0.05, Math.abs(target) * 0.02);
        if (Math.abs(fromOpt - target) <= tol) return true;
        if (target !== 0 && Math.abs(fromOpt - target) / Math.abs(target) <= 0.02) {
            return true;
        }
    }
    const needle = String(raw || value || "").trim();
    return needle && String(optText || "").includes(needle);
};

const verifyExplanationMarkedNumericAgreement = (q) => {
    const opts = q.options || [];
    const markedIdx = getMarkedIndex(q);
    const marked = opts[markedIdx];
    if (!marked || !q.explanation) return null;

    const parsed = extractLastExplanationNumeric(q.explanation);
    if (!parsed) return null;

    if (optionContainsNumericValue(marked, parsed.value, parsed.raw)) {
        return { verified: true };
    }

    const altIdx = opts.findIndex(
        (o, i) =>
            i !== markedIdx &&
            optionContainsNumericValue(o, parsed.value, parsed.raw)
    );
    const unitSuffix = parsed.unit ? ` ${parsed.unit}` : "";
    if (altIdx >= 0) {
        return {
            verified: false,
            matchedOptionIndex: altIdx,
            issue: `Explanation concludes ${parsed.raw}${unitSuffix} but marked option is ${marked}; value matches option ${String.fromCharCode(65 + altIdx)}.`,
        };
    }

    const inAny = opts.some((o) =>
        optionContainsNumericValue(o, parsed.value, parsed.raw)
    );
    if (!inAny) {
        return {
            verified: false,
            issue: `Explanation derives ${parsed.raw}${unitSuffix} but that value is not among options.`,
        };
    }

    return null;
};

/** Validate skeleton finalAnswer against independent solve of stem. */
export const verifySkeletonAnswer = (skeleton) => {
    const fakeQ = {
        questionText: skeleton.stem,
        options: buildVerifyOptionsFromSkeleton(skeleton),
        correctIndex: 0,
    };
    const result = independentlyVerifyQuestion(fakeQ);
    if (result.verified === false) {
        return {
            ok: false,
            reason: result.issue || "Skeleton answer failed independent verification.",
        };
    }
    if (result.verified === true && skeleton.finalAnswer) {
        const exp = result.expected;
        const skVal = parseNumber(skeleton.finalAnswer.display || skeleton.finalAnswer.value);
        if (Number.isFinite(exp?.value) && Number.isFinite(skVal)) {
            const tol = Math.max(0.05, Math.abs(exp.value) * 0.02);
            if (Math.abs(skVal - exp.value) > tol) {
                return {
                    ok: false,
                    reason: `Skeleton claims ${skVal} but independent solve gives ${exp.display}.`,
                };
            }
        }
    }
    return { ok: true };
};

function buildVerifyOptionsFromSkeleton(skeleton) {
    const fa = skeleton.finalAnswer || {};
    const display = String(fa.display || fa.value || "");
    const distractors = (skeleton.distractorValues || skeleton.optionCandidates?.distractors || [])
        .map(String)
        .filter(Boolean);
    return [display, ...distractors].slice(0, 4);
}

/** Comprehensive unit whitelist (for reference only; units are no longer filtered). */
const UNIT_WHITELIST = new Set([
    // SI base units
    "s", "m", "kg", "A", "K", "mol", "cd",
    // SI derived units
    "N", "J", "W", "Pa", "Hz", "C", "V", "Ω", "F", "H",
    // Concentration & molarity
    "M", "mol/L", "mol/kg", "ppm", "ppb", "g/L", "mg/L",
    // Energy
    "J", "kJ", "eV", "cal", "kcal", "kJ/mol", "kcal/mol",
    // Power (including prefixed variants)
    "W", "kW", "MW", "mW",
    // Other common units
    "min", "nm", "Å", "°C", "°F", "atm", "bar", "L", "mL",
    // Specific chemistry units
    "J/mol·K", "kJ/mol·K", "cm³", "cm³/mol", "g/mol",
    // Time
    "s", "ms", "μs", "ns", "min", "h",
    // Distance
    "m", "cm", "mm", "μm", "nm", "Å", "pm",
    // Composed units (velocity, acceleration, etc.)
    "m/s", "cm/s", "km/h", "kg/m³", "g/cm³", "K/s", "J/K",
]);

export const formatValueForOption = (value, unit = "") => {
    if (value == null) return "";
    if (typeof value === "string") return value;

    const u = String(unit || "").trim();

    // Preserve any unit passed in — don't filter by whitelist.
    // Whitelist exists for documentation; actual unit preservation happens here.
    const formatted = formatNumericValue(value);

    if (!u) return formatted;
    return `${formatted} ${u}`;
};

/** Format numeric value with appropriate precision. */
const formatNumericValue = (value) => {
    if (!Number.isFinite(value)) return String(value);

    // Special handling for specific numeric values by convention
    // These could be expanded based on domain-specific formatting rules
    if (Math.abs(value) >= 100 || Number.isInteger(value)) {
        return String(Math.round(value * 100) / 100);
    }

    return value.toFixed(2);
};

const stripExplanationMetaTail = (explanation = "") => {
    let text = String(explanation || "");
    text = text
        .replace(/\(?\s*re-?calculat(?:ing|e)[^.)]*\)?/gi, "")
        .replace(/\(?\s*re-?evaluat(?:ing|e)[^.)]*\)?/gi, "")
        .replace(/\bCorrection:\s*[^.]*\./gi, "")
        .replace(/\bwait\b[^.]*\./gi, "")
        .trim();
    const thereforeIdx = text.search(/\bTherefore\b/i);
    if (thereforeIdx > 0) text = text.slice(0, thereforeIdx).trim();
    return text;
};

const rebuildExplanationClosing = (explanation, markedOptionText) => {
    const marked = String(markedOptionText || "").trim();
    const body = stripExplanationMetaTail(explanation);
    if (!marked) return body.slice(0, 1200) || explanation;
    if (!body) return `Therefore, the correct answer is ${marked}.`;
    return `${body} Therefore, the correct answer is ${marked}.`.slice(0, 1200);
};

export const buildOptionsAroundExpected = (expected, existingOptions = []) => {
    const display = String(expected.display || "").trim();
    const unit = String(expected.unit || "").trim();
    const correctNum = parseNumber(display);
    const distractors = [];
    for (const opt of existingOptions) {
        const n = parseNumber(opt);
        if (!Number.isFinite(n) || !Number.isFinite(correctNum)) continue;
        if (Math.abs(n - correctNum) <= Math.max(0.05, Math.abs(correctNum) * 0.02)) {
            continue;
        }
        distractors.push(String(opt).trim());
        if (distractors.length >= 3) break;
    }
    const offsets = [0.5, 2, 0.75];
    while (distractors.length < 3 && Number.isFinite(correctNum)) {
        const factor = offsets[distractors.length % offsets.length];
        distractors.push(formatValueForOption(correctNum * factor, unit));
    }
    const options = [display, ...distractors.slice(0, 3)];
    return options;
};

/**
 * Fix marked answer / options when independent physics/chemistry solve disagrees.
 * Used on solve-first output and one-shot top-up/repair paths.
 */
export const reconcileQuestionWithIndependentVerify = (q) => {
    if (!q?.questionText || !Array.isArray(q.options) || q.options.length < 2) {
        return { question: q, fixed: false };
    }

    const markedIdx = getMarkedIndex(q);
    const result = independentlyVerifyQuestion({
        questionText: q.questionText,
        options: q.options,
        correctIndex: markedIdx,
        correctAnswer: q.correctAnswer,
    });

    if (result.verified === true || result.verified === null || !result.expected) {
        return { question: q, fixed: false };
    }

    let options = [...q.options];
    let correctIndex = markedIdx;

    if (
        Number.isFinite(result.matchedOptionIndex) &&
        result.matchedOptionIndex >= 0
    ) {
        correctIndex = result.matchedOptionIndex;
    } else if (Number.isFinite(result.expected.value)) {
        options = buildOptionsAroundExpected(result.expected, options);
        correctIndex = 0;
        const idx = findOptionForValue(options, result.expected.value);
        if (idx >= 0) correctIndex = idx;
    } else {
        return { question: q, fixed: false, issue: result.issue };
    }

    const markedOption = options[correctIndex];
    const explanation = rebuildExplanationClosing(q.explanation, markedOption);
    const letter = String.fromCharCode(65 + correctIndex);

    return {
        fixed: true,
        issue: result.issue,
        question: {
            ...q,
            options,
            correctIndex,
            correctAnswer: `${letter}. ${markedOption}`,
            explanation,
        },
    };
};

/** Run independent-verify reconciliation on a flat question bank. */
export const reconcileQuestionBankWithIndependentVerify = (questions = []) => {
    const out = [];
    for (const q of questions) {
        if (q.questionType === "connected") {
            const subQuestions = (q.subQuestions || []).map((sub) => {
                const { question } = reconcileQuestionWithIndependentVerify(sub);
                return question;
            });
            out.push({ ...q, subQuestions });
            continue;
        }
        const { question } = reconcileQuestionWithIndependentVerify(q);
        out.push(question);
    }
    return out;
};
