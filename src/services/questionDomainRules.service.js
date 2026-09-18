/**
 * Subject-specific domain expectations for JEE Advanced papers.
 * Used by explanation contracts, o3 prompts, and Luna paper audit.
 * Framework is shared; scientific details differ by subject.
 */

const SUBJECT_ALIASES = {
  physics: "Physics",
  phy: "Physics",
  chemistry: "Chemistry",
  chem: "Chemistry",
  mathematics: "Mathematics",
  maths: "Mathematics",
  math: "Mathematics",
};

export const normalizeSubjectName = (subject) => {
  const key = String(subject || "")
    .trim()
    .toLowerCase();
  return SUBJECT_ALIASES[key] || (subject ? String(subject).trim() : "");
};

/** Shared explanation contract for every subject. */
export const COMMON_EXPLANATION_REQUIREMENTS = `
EXPLANATION REQUIREMENTS (mandatory):
1. Start with the key idea / insight.
2. State the relevant principle, theorem, law, or formula.
3. Show the important derivation/calculation steps.
4. Explain non-obvious assumptions.
5. Derive the final result explicitly.
6. End with the locked answer.
7. Never contradict the locked key.
8. Be complete enough for a JEE Advanced student to reproduce the solution.
Do not skip essential intermediate reasoning merely to make the explanation shorter.
`.trim();

const SUBJECT_EXPLANATION_HINTS = {
  Physics: `
Physics-specific:
- State physical assumptions (idealizations, constraints, approx.).
- Write governing equations before substituting numbers.
- Check units / limiting cases when relevant.
`.trim(),
  Chemistry: `
Chemistry-specific:
- Show reaction / stoichiometry / equilibrium logic explicitly.
- State n-factors, limiting reagents, or equilibrium conditions when used.
- Do not invent species or protons that cannot exist in the structure.
`.trim(),
  Mathematics: `
Mathematics-specific:
- Show derivation steps; state domain / root / extraneous-solution checks.
- Justify inequalities, case splits, and substitutions.
`.trim(),
};

export const explanationContractForSubject = (subject) => {
  const name = normalizeSubjectName(subject) || "General";
  const extra = SUBJECT_EXPLANATION_HINTS[name] || "";
  return `${COMMON_EXPLANATION_REQUIREMENTS}\n${extra}`.trim();
};

/** Hardness rubric shared across subjects. */
export const DIFFICULTY_RUBRIC = `
DIFFICULTY RUBRIC (requested Hard unless stated otherwise):
- MODERATE: ≥ 2 meaningful reasoning steps.
- HARD: non-obvious reasoning OR multiple derivation steps OR hidden constraint
  OR non-routine application OR meaningful multi-concept reasoning.
REJECT as too easy:
- one formula + direct substitution
- routine calculation / memorization / obvious result
CRITICAL: Do NOT make a question hard by introducing an unrelated chapter.
`.trim();

export const domainCorrectnessHints = (subject) => {
  const name = normalizeSubjectName(subject);
  if (name === "Physics") {
    return "Check physical_correct: assumptions, constraints, and equation applicability.";
  }
  if (name === "Chemistry") {
    return "Check chemical/scientific validity: species existence, stoichiometry, equilibrium logic.";
  }
  if (name === "Mathematics") {
    return "Check mathematical_correct: domain, roots, and derivation soundness.";
  }
  return "Check scientific/domain correctness for the assigned subject.";
};

export const PhysicsRules = {
  subject: "Physics",
  explanationHint: SUBJECT_EXPLANATION_HINTS.Physics,
  domainField: "physical_correct",
};

export const ChemistryRules = {
  subject: "Chemistry",
  explanationHint: SUBJECT_EXPLANATION_HINTS.Chemistry,
  domainField: "scientific_correct",
};

export const MathematicsRules = {
  subject: "Mathematics",
  explanationHint: SUBJECT_EXPLANATION_HINTS.Mathematics,
  domainField: "mathematical_correct",
};

export const rulesForSubject = (subject) => {
  const name = normalizeSubjectName(subject);
  if (name === "Physics") return PhysicsRules;
  if (name === "Chemistry") return ChemistryRules;
  if (name === "Mathematics") return MathematicsRules;
  return { subject: name || "General", explanationHint: "", domainField: "scientific_correct" };
};

export default {
  normalizeSubjectName,
  explanationContractForSubject,
  DIFFICULTY_RUBRIC,
  domainCorrectnessHints,
  PhysicsRules,
  ChemistryRules,
  MathematicsRules,
  rulesForSubject,
};
