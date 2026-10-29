import assert from "node:assert/strict";
import { formatReadableQuestionText } from "../src/utils/formatReadableQuestionText.js";

console.log("--- Testing Backend Exam Response Formatting ---\n");

// 1. Passage with \n\n, formulas, and \times 100
const rawPassage =
  "In a classic genetic mapping experiment with Drosophila melanogaster, a geneticist analyzed three autosomal recessive traits controlled by genes a, b, and c. To determine map distances and gene order, three separate two-point test crosses were performed using heterozygous females crossed with homozygous recessive males.\\n\\nRecombination frequency (%) is defined as (Number of recombinant progeny / Total progeny) $\\times 100$, where 1% recombination corresponds to 1 map unit or centimorgan (cM).";

const formattedPassage = formatReadableQuestionText(rawPassage, { sourceType: "ai" });
console.log("1. Passage Formatting:");
console.log(formattedPassage);
assert.ok(!formattedPassage.includes("$\\times 100$"), "LaTeX times 100 should be converted");
assert.ok(formattedPassage.includes("× 100"), "Should contain unicode multiplication sign × 100");
assert.ok(!formattedPassage.includes("\\n\\n"), "Literal \\n\\n should be converted to real line breaks");
console.log("✓ Passage test passed\n");

// 2. Sub-question stem with \frac and options with \text{ cM} and \%
const rawQuestionText =
  "Based on the test-cross data provided in the passage, what is the correct linear sequence of the three genes on the chromosome and the map distance between gene $a$ and gene $b$?";
const formattedQuestionText = formatReadableQuestionText(rawQuestionText, {
  sourceType: "ai",
  isQuestion: true,
});
console.log("2. Question Stem Formatting:");
console.log(formattedQuestionText);
assert.ok(!formattedQuestionText.includes("$a$"), "Dollar signs around single variables should be unwrapped");
assert.ok(formattedQuestionText.includes("gene a and gene b"), "Variables should read naturally");
console.log("✓ Question stem test passed\n");

// 3. Option with \text{ cM} and order
const rawOption1 = "Order: $a - c - b$; Map distance between $a$ and $b$: $18\\text{ cM}$";
const formattedOption1 = formatReadableQuestionText(rawOption1, { sourceType: "ai" });
console.log("3. Option Formatting (Units & Math):");
console.log("Raw:      ", rawOption1);
console.log("Formatted:", formattedOption1);
assert.equal(
  formattedOption1,
  "Order: a - c - b; Map distance between a and b: 18 cM",
  "Option 1 should be clean text without LaTeX or dollar signs"
);
console.log("✓ Option 1 test passed\n");

// 4. Fraction with linkage configuration \frac{A\,c\,B}{a\,C\,b}
const rawFracQuestion =
  "A female Drosophila with the linkage configuration $\\frac{A\\,c\\,B}{a\\,C\\,b}$ is test-crossed with a homozygous recessive male. Assuming no double crossovers occur, what percentage of the total test-cross progeny will exhibit parental (non-recombinant) phenotypes?";
const formattedFracQuestion = formatReadableQuestionText(rawFracQuestion, {
  sourceType: "ai",
  isQuestion: true,
});
console.log("4. Fraction Formatting:");
console.log(formattedFracQuestion);
assert.ok(!formattedFracQuestion.includes("\\frac"), "LaTeX frac should be converted");
assert.ok(formattedFracQuestion.includes("(A c B)/(a C b)"), "Fractions should convert to readable (A c B)/(a C b)");
console.log("✓ Fraction test passed\n");

// 5. Percent option: $18\%$
const rawPercent = "$18\\%$";
const formattedPercent = formatReadableQuestionText(rawPercent, { sourceType: "ai" });
console.log("5. Percent Option:");
console.log("Raw:      ", rawPercent);
console.log("Formatted:", formattedPercent);
assert.equal(formattedPercent, "18%", "Should be clean 18%");
console.log("✓ Percent test passed\n");

// 6. Scientific notation: $1.0 \times 10^{-10}$
const rawSci = "$1.0 \\times 10^{-10}$";
const formattedSci = formatReadableQuestionText(rawSci, { sourceType: "ai" });
console.log("6. Scientific Notation:");
console.log("Raw:      ", rawSci);
console.log("Formatted:", formattedSci);
assert.equal(formattedSci, "1.0 × 10⁻¹⁰", "Should convert to unicode exponent 1.0 × 10⁻¹⁰");
console.log("✓ Scientific notation test passed\n");

// 7. Chemistry potentials: $\text{Cr}^{3+}/\text{Cr}^{2+}$
const rawChem = "$\\text{Cr}^{3+}/\\text{Cr}^{2+}$";
const formattedChem = formatReadableQuestionText(rawChem, { sourceType: "ai" });
console.log("7. Chemistry Ions:");
console.log("Raw:      ", rawChem);
console.log("Formatted:", formattedChem);
assert.equal(formattedChem, "Cr³⁺/Cr²⁺", "Should convert to Cr³⁺/Cr²⁺");
console.log("✓ Chemistry test passed\n");

// 8. Physics symbols: $G = 99\ \Omega$
const rawPhysics = "$G = 99\\ \\Omega$";
const formattedPhysics = formatReadableQuestionText(rawPhysics, { sourceType: "ai" });
console.log("8. Physics Symbols (Ohm):");
console.log("Raw:      ", rawPhysics);
console.log("Formatted:", formattedPhysics);
assert.equal(formattedPhysics, "G = 99 Ω", "Should convert to G = 99 Ω");
console.log("✓ Physics test passed\n");

// 9. Manual question bypass: verify that manual questions are untouched
const manualRaw = "Manual Question: 1. stays as author typed. 2. does not get restructured.";
const formattedManual = formatReadableQuestionText(manualRaw, { sourceType: "manual" });
console.log("9. Manual Question Bypass:");
console.log("Raw:      ", manualRaw);
console.log("Formatted:", formattedManual);
assert.equal(formattedManual, manualRaw, "Manual question must remain 100% untouched");
console.log("✓ Manual question bypass test passed\n");

// 10. Idempotency test: verify that web frontend re-running formatReadableQuestionText causes 0 regressions
const pass1 = formatReadableQuestionText(rawOption1, { sourceType: "ai" });
const pass2 = formatReadableQuestionText(pass1, { sourceType: "ai" });
console.log("10. Web Frontend Idempotency Check:");
console.log("Pass 1 (Backend): ", pass1);
console.log("Pass 2 (Frontend):", pass2);
assert.equal(pass1, pass2, "Re-running formatter on already formatted text must produce identical output");
console.log("✓ Idempotency test passed (0 regressions for web frontend)\n");

console.log("=========================================");
console.log("ALL EXAM FORMATTING TESTS PASSED 100%!");
console.log("=========================================");
