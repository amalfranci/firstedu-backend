import { runDeterministicCorrectnessAudit } from "../src/services/correctnessPreAudit.service.js";

describe("rule engine structural detectors", () => {
    it("flags empty explanation", () => {
        const result = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 1,
                questionType: "single",
                questionText: "What is 2+2?",
                options: ["1", "2", "3", "4"],
                correctIndex: 3,
                explanation: "   ",
            },
        ]);
        expect(
            result.confirmedIssues.some((i) => /Explanation is empty/i.test(i.issue))
        ).toBe(true);
    });

    it("flags wrong option count", () => {
        const result = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 1,
                questionType: "single",
                questionText: "Pick one",
                options: ["A only", "B only"],
                correctIndex: 0,
                explanation: "Because A. FINAL_ANSWER: A",
            },
        ]);
        expect(
            result.confirmedIssues.some((i) => /exactly 4 non-empty options/i.test(i.issue))
        ).toBe(true);
    });

    it("flags missing questionText", () => {
        const result = runDeterministicCorrectnessAudit([
            {
                sampleNumber: 1,
                questionType: "single",
                questionText: "",
                options: ["1", "2", "3", "4"],
                correctIndex: 0,
                explanation: "x FINAL_ANSWER: A",
            },
        ]);
        expect(
            result.confirmedIssues.some((i) => /questionText is empty/i.test(i.issue))
        ).toBe(true);
    });
});
