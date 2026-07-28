import {
    enrichSlotPlansToBlueprints,
    checkBlueprintCoverage,
    buildExamBlueprintDistribution,
    blueprintsToPresetSteering,
} from "../src/services/questionBlueprint.service.js";
import { validateDistractors } from "../src/services/distractorPass.service.js";
import { validateQuestionFormulas } from "../src/services/formulaValidator.service.js";

describe("Phase C blueprint planner", () => {
    it("enriches slot plans with difficulty, blooms, time", () => {
        const bps = enrichSlotPlansToBlueprints(
            [
                {
                    conceptSlot: "integration",
                    label: "Definite Integration",
                    questionKind: "multi_concept",
                },
                {
                    conceptSlot: "optics_lens",
                    label: "Lens Formula",
                    questionKind: "direct",
                },
            ],
            {
                topic: "JEE",
                bankDifficulty: "hard",
                examProfile: "jee_main",
                examCalibrated: true,
            }
        );
        expect(bps).toHaveLength(2);
        expect(bps[0].blooms).toBeTruthy();
        expect(bps[0].estimatedTime).toBeGreaterThan(0);
        expect(["easy", "medium", "hard"]).toContain(bps[0].difficulty);
        const steering = blueprintsToPresetSteering(bps);
        expect(steering.slotPlans[0].blooms).toBe(bps[0].blooms);
    });

    it("detects coverage gaps", () => {
        const bps = enrichSlotPlansToBlueprints(
            [
                { conceptSlot: "a", label: "A", questionKind: "direct" },
                { conceptSlot: "b", label: "B", questionKind: "direct" },
            ],
            { bankDifficulty: "medium", examProfile: "competitive" }
        );
        const coverage = checkBlueprintCoverage(bps, [
            { _conceptSlot: "a", difficulty: "medium" },
        ]);
        expect(coverage.ok).toBe(false);
        expect(coverage.missing.some((m) => m.conceptSlot === "b")).toBe(true);
    });

    it("builds exam distribution", () => {
        const dist = buildExamBlueprintDistribution({
            totalSlots: 10,
            bankDifficulty: "hard",
            examCalibrated: true,
            examProfile: "jee_main",
        });
        expect(dist.totalSlots).toBe(10);
        expect(dist.difficulty.Hard).toBe(10);
    });
});

describe("Phase C distractor + formula", () => {
    it("rejects duplicate distractors", () => {
        const r = validateDistractors(["1", "2", "2", "3"], 0);
        expect(r.ok).toBe(false);
    });

    it("flags impossible formula patterns", () => {
        const r = validateQuestionFormulas({
            questionText: "x",
            explanation: "divide by zero in the derivation",
        });
        expect(r.ok).toBe(false);
    });
});
