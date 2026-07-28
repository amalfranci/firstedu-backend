/**
 * Phase C continuous evaluation harness (scaffold).
 *
 * Runs blueprint enrich → coverage check → formula/distractor validators
 * against a small fixture bank (no live LLM required for structural metrics).
 *
 * Usage:
 *   node scripts/eval-phase-c-quality.mjs
 * Optional live generate (needs server + keys):
 *   EVAL_LIVE=1 node scripts/eval-phase-c-quality.mjs
 */

import {
    enrichSlotPlansToBlueprints,
    buildExamBlueprintDistribution,
    checkBlueprintCoverage,
} from "../src/services/questionBlueprint.service.js";
import { validateDistractors } from "../src/services/distractorPass.service.js";
import { validateQuestionFormulas } from "../src/services/formulaValidator.service.js";
import { resolveProviderForDifficulty } from "../src/services/generationProvider.service.js";

const fixtureSlotPlans = [
    {
        conceptSlot: "definite_integration",
        label: "Definite Integration",
        questionKind: "multi_concept",
    },
    {
        conceptSlot: "projectile_motion",
        label: "Projectile Motion",
        questionKind: "direct",
    },
    {
        conceptSlot: "electrostatics_gauss",
        label: "Gauss Law",
        questionKind: "theory",
    },
    {
        conceptSlot: "quadratic_roots",
        label: "Quadratic Equation",
        questionKind: "direct",
    },
    {
        conceptSlot: "photoelectric_effect",
        label: "Photoelectric Effect",
        questionKind: "multi_concept",
    },
];

const log = (...args) => console.log(...args);

const main = () => {
    const blueprints = enrichSlotPlansToBlueprints(fixtureSlotPlans, {
        topic: "JEE Main Mixed",
        bankDifficulty: "hard",
        examProfile: "jee_main",
        examCalibrated: true,
        subject: "physics",
    });

    log("\n=== Phase C Eval: Blueprint Planner ===");
    log(`Blueprints: ${blueprints.length}`);
    blueprints.forEach((b, i) => {
        log(
            `  ${i + 1}. ${b.concept} | ${b.difficulty} | ${b.questionKind} | blooms=${b.blooms} | ~${b.estimatedTime}m`
        );
    });

    const distribution = buildExamBlueprintDistribution({
        totalSlots: blueprints.length,
        bankDifficulty: "hard",
        examProfile: "jee_main",
        examCalibrated: true,
        subjects: [
            { id: "physics", label: "Physics", count: 3 },
            { id: "math", label: "Mathematics", count: 2 },
        ],
    });
    log("\n=== Exam Blueprint Distribution ===");
    log(JSON.stringify(distribution, null, 2));

    // Simulate generated questions matching blueprint slots
    const generated = blueprints.map((b, i) => ({
        questionType: "single",
        questionText: `Sample stem for ${b.concept}`,
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        explanation: `Using formula for ${b.concept}. FINAL_ANSWER: A`,
        difficulty: b.difficulty,
        _conceptSlot: b.conceptSlot,
        _blueprint: b,
    }));
    // Drop one to force a coverage miss
    const partial = generated.slice(0, -1);
    const coverage = checkBlueprintCoverage(blueprints, partial, {
        examDistribution: distribution,
    });
    log("\n=== Coverage Checker (intentional miss) ===");
    log(JSON.stringify(coverage, null, 2));

    log("\n=== Distractor Validator ===");
    const distOk = validateDistractors(["12 N", "8 N", "12 N", "4 N"], 0);
    const distGood = validateDistractors(["12 N", "8 N", "10 N", "4 N"], 0);
    log(" duplicate case:", distOk);
    log(" good case:", distGood);

    log("\n=== Formula Validator ===");
    const formula = validateQuestionFormulas(
        {
            questionText: "Find acceleration with divide by zero 1/0",
            explanation: "a = F/m with divide by zero",
            _conceptSlot: "kinematics",
        },
        { topic: "kinematics" }
    );
    log(formula);

    log("\n=== Difficulty Model Routing ===");
    for (const tier of ["easy", "medium", "hard"]) {
        log(`  ${tier} -> ${resolveProviderForDifficulty(tier, "gemini")}`);
    }

    const metrics = {
        blueprintCount: blueprints.length,
        coverageOk: coverage.ok,
        missingSlots: coverage.missing.length,
        distractorDupDetected: !distOk.ok,
        formulaImpossibleDetected: !formula.ok,
        timestamp: new Date().toISOString(),
    };
    log("\n=== Metrics Summary ===");
    log(JSON.stringify(metrics, null, 2));

    if (process.env.EVAL_LIVE === "1") {
        log(
            "\nEVAL_LIVE=1 set — wire to running API separately (not executed in structural harness)."
        );
    }

    const pass =
        blueprints.length === 5 &&
        !coverage.ok &&
        !distOk.ok &&
        !formula.ok;
    if (!pass) {
        console.error("Phase C structural eval failed unexpected assertions");
        process.exit(1);
    }
    log("\n✓ Phase C structural eval passed");
};

main();
