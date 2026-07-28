/**
 * Unit tests for FINAL_ANSWER parse / lock helpers.
 */
import {
    parseFinalAnswerFromSolution,
    buildExplanationWithFinalAnswer,
    applySolutionFinalAnswerLock,
    stripFinalAnswerMarker,
} from "../src/services/finalAnswerLock.service.js";

describe("parseFinalAnswerFromSolution", () => {
    it("parses single letter", () => {
        const r = parseFinalAnswerFromSolution(
            "Step 1… Therefore the answer is 4. FINAL_ANSWER: C"
        );
        expect(r).toEqual({ letters: ["C"], raw: "C" });
    });

    it("parses multi-correct list", () => {
        const r = parseFinalAnswerFromSolution("FINAL_ANSWER: A, C");
        expect(r.letters).toEqual(["A", "C"]);
    });

    it("parses True/False", () => {
        const r = parseFinalAnswerFromSolution("FINAL_ANSWER: True");
        expect(r.letters).toEqual(["True"]);
    });

    it("parses bracket form", () => {
        const r = parseFinalAnswerFromSolution('FINAL_ANSWER: ["A","C"]');
        expect(r.letters).toEqual(["A", "C"]);
    });

    it("returns null when marker missing", () => {
        expect(parseFinalAnswerFromSolution("no marker here")).toBeNull();
    });
});

describe("buildExplanationWithFinalAnswer", () => {
    it("appends Therefore + FINAL_ANSWER", () => {
        const text = buildExplanationWithFinalAnswer(
            ["Compute force", "Get 12 N"],
            "12 N",
            { correctLetter: "B" }
        );
        expect(text).toContain("Therefore, the correct answer is 12 N.");
        expect(text).toContain("FINAL_ANSWER: B");
        expect(text).toContain("Step 1:");
    });
});

describe("applySolutionFinalAnswerLock", () => {
    it("overrides correctIndex from FINAL_ANSWER in explanation", () => {
        const locked = applySolutionFinalAnswerLock({
            explanation: "Working… FINAL_ANSWER: C",
            options: ["a", "b", "c", "d"],
            correctIndex: 0,
            correctAnswer: "A",
            questionType: "single",
        });
        expect(locked.correctIndex).toBe(2);
        expect(locked.correctAnswer).toBe("C");
        expect(locked.explanation).toContain("FINAL_ANSWER: C");
    });

    it("stripFinalAnswerMarker removes prior markers", () => {
        expect(
            stripFinalAnswerMarker("foo FINAL_ANSWER: B. bar")
        ).toBe("foo bar");
    });
});
