/**
 * When solve steps compute a value that matches another option, buildMcqFromSkeleton
 * must rematch the key (not reject / not force-align Therefore onto the wrong key).
 */

import { buildMcqFromSkeleton } from "../questionSolveFirst.service.js";

describe("buildMcqFromSkeleton — rematch key to derivation", () => {
    test("rematches when derivation matches a distractor option", () => {
        const built = buildMcqFromSkeleton(
            {
                stem: "A resistor network yields equivalent resistance R_eq. Find R_eq.",
                conceptSlot: "circuit_resistance",
                questionKind: "direct",
                solveSteps: [
                    "Series combination of the two branches gives R_eq = 5.66 ohm.",
                    "Thus the equivalent resistance is 5.66 ohm.",
                ],
                finalAnswer: {
                    type: "numeric",
                    display: "4.0 ohm",
                    value: 4,
                    unit: "ohm",
                },
                distractorValues: ["5.66 ohm", "8.0 ohm", "2.83 ohm"],
            },
            0,
            "medium",
            "circuit_resistance"
        );

        expect(built.options.some((o) => /5\.66/.test(String(o)))).toBe(true);
        const marked = built.options[built.correctIndex];
        expect(String(marked)).toMatch(/5\.66/);
        expect(built._keyRealignedFromDerivation).toBeTruthy();
    });

    test("rebuilds options when derivation is not among the listed distractors", () => {
        const built = buildMcqFromSkeleton(
            {
                stem: "Find the magnitude of a × (b × c).",
                conceptSlot: "vector_triple",
                questionKind: "direct",
                solveSteps: [
                    "Compute magnitude √(16+1+49) = √66 ≈ 8.12.",
                ],
                finalAnswer: {
                    type: "numeric",
                    display: "7.35",
                    value: 7.35,
                    unit: "",
                },
                distractorValues: ["9.15", "5.25", "6.45"],
            },
            0,
            "medium",
            "vector_triple"
        );

        const markedNum = Number(
            String(built.options[built.correctIndex]).match(/[\d.]+/)?.[0]
        );
        expect(Math.abs(markedNum - 8.12)).toBeLessThan(0.05);
        expect(built._keyRealignedFromDerivation).toBe("rebuild_options");
    });
});
