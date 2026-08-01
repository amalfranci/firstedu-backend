/**
 * Weighted 7-factor difficulty score (0–100).
 */

import {
    computeWeightedDifficultyScore,
    detectWeightedDifficultyIssue,
    WEIGHTED_DIFFICULTY_FLOORS,
} from "../weightedDifficultyScore.service.js";

describe("weightedDifficultyScore.service.js", () => {
    test("easy single-formula drill scores low and fails hard floor", () => {
        const q = {
            questionText: "Evaluate lim x→0 sin(x)/x.",
            options: ["0", "1", "∞", "−1"],
            correctIndex: 1,
            difficultyTier: "hard",
            _questionKind: "multi_concept",
            solveSteps: ["Use standard limit sinx/x → 1.", "Answer is 1."],
        };
        const r = computeWeightedDifficultyScore(q, { assignedTier: "hard" });
        expect(r.total).toBeLessThan(WEIGHTED_DIFFICULTY_FLOORS.hard);
        expect(r.meetsFloor).toBe(false);
        expect(r.factors.conceptDifficulty).toBeDefined();
        expect(r.factors.numberOfConcepts).toBeDefined();
        expect(r.factors.reasoningDepth).toBeDefined();
        expect(r.factors.calculationComplexity).toBeDefined();
        expect(r.factors.trickinessInsight).toBeDefined();
        expect(r.factors.optionQuality).toBeDefined();
        expect(r.factors.estimatedTime).toBeDefined();
        expect(r.estimatedTimeMinutes).toBeGreaterThan(0);

        const issue = detectWeightedDifficultyIssue(q, {
            assignedTier: "hard",
            sampleNumber: 1,
        });
        expect(issue).not.toBeNull();
        expect(issue.issue).toMatch(/Weighted difficulty/i);
    });

    test("multi-concept hard stem scores higher and can meet hard floor", () => {
        const q = {
            questionText:
                "Let the family of lines L1 + λL2 = 0 pass through the intersection of x − y + 1 = 0 and 2x + y − 4 = 0. " +
                "Find the locus of the mid-point of the chord of the circle x² + y² − 4x − 2y − 4 = 0 cut by members of this family that are perpendicular to the line 3x − y = 0. " +
                "Also determine the value of λ for which the chord is a diameter, given the constraint that the mid-point lies in the first quadrant.",
            options: [
                "x + y = 3 with λ = 1",
                "x − y = 1 with λ = −2",
                "2x + y = 5 with λ = 1/2",
                "x + 2y = 4 with λ = −1",
            ],
            correctIndex: 0,
            difficultyTier: "hard",
            _questionKind: "multi_concept",
            conceptFusion: "family of lines + circle chord + locus + perpendicular constraint",
            solveSteps: [
                "Find fixed intersection of L1 and L2 by solving the two lines simultaneously.",
                "Write family L1+λL2 and impose perpendicularity to 3x−y=0 to constrain λ or slope.",
                "For circle, mid-point of chord (h,k) satisfies T=S1; substitute family condition.",
                "Eliminate λ to obtain locus of (h,k); apply first-quadrant constraint.",
                "Check diameter case: mid-point equals centre of the circle; solve for λ.",
            ],
        };
        const r = computeWeightedDifficultyScore(q, { assignedTier: "hard" });
        expect(r.total).toBeGreaterThanOrEqual(60);
        expect(r.factors.numberOfConcepts).toBeGreaterThanOrEqual(70);
        expect(r.factors.reasoningDepth).toBeGreaterThanOrEqual(55);
        expect(r.estimatedTimeMinutes).toBeGreaterThanOrEqual(2.5);
    });

    test("weights sum to 1 and total is clamped 0–100", () => {
        const q = {
            questionText: "Short?",
            options: ["a", "b", "c", "d"],
            solveSteps: ["x"],
        };
        const r = computeWeightedDifficultyScore(q);
        expect(r.total).toBeGreaterThanOrEqual(0);
        expect(r.total).toBeLessThanOrEqual(100);
        const wSum = Object.values(r.weights).reduce((a, b) => a + b, 0);
        expect(Math.abs(wSum - 1)).toBeLessThan(1e-9);
    });
});
