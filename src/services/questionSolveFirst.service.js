/**
 * Solve-first question generation: LLM produces verified skeletons;
 * code builds options and locks the answer key.
 */

import { parseJsonArrayFromAIText, parseJsonObjectFromAIText, salvageParseJsonArrayObjects } from "../utils/aiJsonRepair.js";
import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { publishPartialQuestions } from "../utils/pipelinePartialPublish.js";
import {
    buildCorrectnessFirstGenerationBlock,
    buildExamSolveThenWriteBlock,
    buildGenerationCorrectnessMandatesBlock,
    buildSolveFirstSkeletonCorrectnessBlock,
    buildExplanationOptionLockBlock,
    buildAutomatedAuditorDefectsBlock,
    buildPreOutputCorrectnessChecklist,
    buildChemistryNumericalAuthoringBlock,
    buildPhysicsNumericalAuthoringBlock,
    buildJeeAuthenticityGenerationBlock,
    buildVeteranExamineeCaliberBlock,
} from "./examPromptContext.service.js";
import { buildDifficultyCalibrationBlock } from "./examDifficultyCalibration.js";
import {
    independentlyVerifyQuestion,
    verifySkeletonAnswer,
    parseNumber,
    formatValueForOption,
    buildOptionsAroundExpected,
} from "./questionNumericVerify.service.js";
import { parseFinalAnswerFromSolution } from "./finalAnswerLock.service.js";
import { detectExamProfile } from "./examDifficultyCalibration.js";
import { isJeeFullPaperTopic } from "./examPromptContext.service.js";
import { buildExamSpecificRules } from "./examPromptFirst.service.js";
import { resolveSubjectForGeneration } from "./subjectDetection.js";
import {
    buildDifficultyMixGenerationBlock,
    buildDifficultyTierSlots,
    buildBankDifficultyProfileBlock,
    buildAssignedTierSlotsBlock,
} from "./difficultyMix.service.js";
import { buildExamNativeDifficultyAuthorityBlock } from "./examGenerationDifficulty.service.js";
import {
    buildRegenerationEscalationBlock,
    buildRegenerationQualityGatesBlock,
    GENERATE_INTENTS,
    inferSolveStepsFromExplanation,
} from "./topicRelevanceValidation.service.js";
import {
    getHybridizationForFormula,
    hybridizationMatches,
    POLAR_MOLECULES,
    ZERO_DIPOLE_MOLECULES,
} from "./chemistryFacts.service.js";
import {
    buildBatchArchetypeGuidanceBlock,
    buildJeeHardStemAuthoringBlock,
    buildJeeMainHardAntiTemplateBlock,
    buildSubjectArchetypeSelectionBlock,
    buildBankArchetypeExcludeBlock,
    allocateRankedConceptSlots,
} from "./conceptArchetypeGuidance.service.js";
import { buildScoringConceptWriterBlock } from "./jeeMainScoringConcept.service.js";
import { buildOfficialSyllabusWriterBlock } from "./jeeMainOfficialSyllabus.service.js";
import {
    buildNcertChapterReferenceBlock,
    inferNcertChaptersFromSlots,
} from "./ncertChapterReference.service.js";
import {
    buildJeeAdvancedNcertWriterBlock,
    buildJeeAdvancedSyllabusWriterBlock,
    buildJeeAdvancedPatternAuthoringBlock,
    isJeeAdvancedMathsDataAvailable,
} from "./jeeAdvancedMaths.service.js";
import {
    buildJeeAdvancedPhysicsNcertWriterBlock,
    buildJeeAdvancedPhysicsSyllabusWriterBlock,
    buildJeeAdvancedPhysicsPatternAuthoringBlock,
    isJeeAdvancedPhysicsDataAvailable,
} from "./jeeAdvancedPhysics.service.js";
import {
    buildHardQuestionMandateBlock,
    buildSkeletonGenerationComplianceBlock,
    buildVeteranExamNativeGenerationBlock,
    buildDifficultyRegenFeedbackBlock,
    validateHardSkeletonMandate,
    isVeteranDifficultyEnabled,
    isExamNativeVeteranGeneration,
    isMandateRepairEnabled,
    getHardMandateFloors,
    isStemProfile,
} from "./hardQuestionMandate.service.js";
import {
    isBatchStemNearDuplicate,
    registerBatchStem,
    assertGenerationCorrectness,
} from "./correctnessPreAudit.service.js";
import {
    repairSkeleton,
    repairSkeletonAuditRejections,
} from "./skeletonRepair.service.js";
import { buildCasVerificationContractBlock } from "./skeletonCasVerification.service.js";
import { stripMetaCommentary } from "../utils/stripMetaCommentary.js";

export { stripMetaCommentary };

export const SOLVE_FIRST_MAX_ATTEMPTS = Math.min(
    8,
    Math.max(
        1,
            Number(
                process.env.AI_QB_SOLVE_FIRST_MAX_ATTEMPTS ??
                    (isMandateRepairEnabled() ? 3 : 4)
            )
    )
);

/**
 * JEE Main veteran generation runs its skeleton batches in small (~5-question)
 * chunks, each with its OWN attempt counter — so the default 3-attempt cap
 * gives a strict 78+ difficulty bar only 2 real re-tries per chunk before that
 * chunk's deficit is abandoned for good. A full-paper run measured this at
 * 12/75 (16%) yield even with per-attempt rejection-reason feedback wired in
 * (see buildDifficultyRegenFeedbackBlock) — the bottleneck was attempt budget,
 * not feedback quality. Raised only for jee_main so other exam profiles' cost
 * per generation is untouched.
 */
export const getSolveFirstMaxAttempts = ({ examProfile = "" } = {}) => {
    if (String(examProfile || "").toLowerCase() === "jee_main") {
        return Math.min(
            10,
            Math.max(
                SOLVE_FIRST_MAX_ATTEMPTS,
                // 6 burned ~20+ min/section with almost no extra yield; 4 is enough
                // when difficulty self-audit is skipped for exam-native.
                Number(process.env.AI_QB_JEE_MAIN_SOLVE_FIRST_MAX_ATTEMPTS ?? 4)
            )
        );
    }
    return SOLVE_FIRST_MAX_ATTEMPTS;
};

/** Caps per-skeleton repair LLM calls within a single skeletonsToQuestions() pass — bounds worst-case tail latency on a bad batch instead of one call per failure. */
const MAX_SKELETON_REPAIR_CALLS_PER_BATCH = Math.max(
    1,
    Number(process.env.AI_QB_MAX_SKELETON_REPAIR_CALLS ?? 4)
);

export const isSolveFirstEnabled = () => {
    const flag = process.env.AI_QB_SOLVE_FIRST;
    if (flag === "0" || flag === "false") return false;
    return true;
};

/** One archetype per slot; peak-difficulty pool for hard banks; slotOffset avoids chunk repeats. */
export const allocateConceptSlots = (
    count,
    {
        examProfile = "competitive",
        subjectId = "",
        slotOffset = 0,
        subjects = null,
        preferPeak = false,
        bankDifficulty = "medium",
        examCalibrated = false,
        excludeArchetypes = [],
    } = {}
) =>
    allocateRankedConceptSlots(count, {
        examProfile,
        subjectId,
        slotOffset,
        subjects,
        preferPeak: preferPeak || examCalibrated,
        bankDifficulty,
        excludeArchetypes,
        maxPerArchetype:
            isVeteranDifficultyEnabled() && examCalibrated ? 1 : 2,
    });

export const shouldUseSolveFirstGeneration = ({
    singleCount = 0,
    multipleCount = 0,
    trueFalseCount = 0,
    passageCount = 0,
    generateIntent = "initial",
    competitiveExamPlan = null,
    topic = "",
    bankName = "",
    categoryPaths = [],
    sectionName = "",
    subject = "",
} = {}) => {
    if (!isSolveFirstEnabled()) return false;
    const standalones = singleCount + multipleCount + trueFalseCount;
    if (passageCount > 0) return false;
    if (multipleCount > 0 || trueFalseCount > 0) return false;
    if (!standalones) return false;

    if (competitiveExamPlan?.isFullPaper) return false;
    if (
        Array.isArray(competitiveExamPlan?.subjects) &&
        competitiveExamPlan.subjects.length > 1
    ) {
        return false;
    }

    const fullPaperCtx = { topic, bankName, categoryPaths, sectionName };
    if (isJeeFullPaperTopic(fullPaperCtx)) return false;

    const profile = String(competitiveExamPlan?.examProfile || "").toLowerCase();
    if (
        (profile === "jee_main" || profile === "jee_advanced") &&
        isJeeFullPaperTopic(fullPaperCtx)
    ) {
        return false;
    }

    // Standalone (non-passage) requests always go through solve-first now —
    // exam-domain rigor (STEM concept clusters vs. generic reasoning-depth
    // checks) is decided downstream by validateHardQuestionMandate via
    // isStemProfile(), not here.
    return true;
};

export const buildSolveFirstSkeletonPrompt = ({
    topic,
    bankName,
    difficulty,
    count,
    conceptSlots = [],
    difficultyTierSlots = [],
    excludeQuestionTexts = [],
    excludeArchetypes = [],
    categoryPaths = [],
    sectionName = "",
    subject = "",
    examProfile = "competitive",
    examReferenceBlock = "",
    difficultyResolution = null,
    slotOffset = 0,
    slotPlans = null,
    archetypeSteeringSource = "catalog",
    generateIntent = GENERATE_INTENTS.INITIAL,
    topicRelevanceFeedback = null,
    maxSelectableSlots = 0,
    referenceCalibrationBlock = "",
    retrievedQuestionContextBlock = "",
    priorAttemptFeedback = null,
}) => {
    const referencePaperGroundingBlock = referenceCalibrationBlock
        ? `\n**REFERENCE PAPER — DIFFICULTY FLOOR TO EXCEED:** an actual past paper for this exam was analyzed; observed difficulty pattern: ${referenceCalibrationBlock}\nThis is a FLOOR, not a target — every question you write must be strictly MORE difficult than that observed pattern (deeper concept fusion, tighter time pressure, less telegraphed setups). Do not merely replicate the reference paper's level, and do not use it to constrain which topics/slots you write about — the concept slots above are independently planned.\n`
        : "";
    const retrievedQuestionGroundingBlock = retrievedQuestionContextBlock
        ? `\n**RETRIEVED EXEMPLARS — STYLE/PATTERN REFERENCE ONLY:** the following are real, previously-confirmed questions for this subject/topic, retrieved for their similarity to what you are being asked to write:\n${retrievedQuestionContextBlock}\nUse these ONLY to match format, phrasing style, and difficulty texture. You MUST write about a completely different scenario, context, and numeric values — do not reuse any stem, scenario, or numeric value from these exemplars. These are not a topic/content source and do not constrain which concept slots you write about.\n`
        : "";
    const mixOpts = difficultyResolution?.examCalibrated
        ? { examProfile, examCalibrated: true }
        : {};
    const examNativeVeteran = isExamNativeVeteranGeneration(difficultyResolution);
    const examNativeBlock = buildExamNativeDifficultyAuthorityBlock({
        difficultyResolution,
    });
    const slotLines = conceptSlots
        .slice(0, count)
        .map((s, i) => {
            const tier = difficultyTierSlots[i] || "hard";
            const plan = slotPlans?.[i];
            const label = plan?.label ? ` — ${plan.label}` : "";
            return difficultyResolution?.examCalibrated
                ? `${i + 1}. [hard] ${s}${label}`
                : `${i + 1}. [${tier}-tier] ${s}${label}`;
        })
        .join("\n");

    const excludeBlock =
        excludeQuestionTexts.length > 0
            ? `\n**Excluded stems (do not repeat topic OR structural template):**\n${excludeQuestionTexts
                  .slice(0, 30)
                  .map((t, i) => `${i + 1}. ${String(t).slice(0, 200)}`)
                  .join("\n")}
Each new skeleton must use a **different problem structure** from every excluded stem — not the same setup with different numbers.\n`
            : "";

    const isEvaluationRegen =
        generateIntent === GENERATE_INTENTS.EVALUATION_REGEN &&
        topicRelevanceFeedback;

    const subjLower = String(subject || "").toLowerCase();

    // NEET is multi-subject: only inject the physics / chemistry numeric
    // authoring guidance for the matching subject. Biology sections (Botany /
    // Zoology) must NOT receive numeric-STEM authoring — it makes the model
    // manufacture calculation questions and bolt irrelevant physics/chemistry
    // onto biology stems. JEE stays as-is (single combined PCM authoring).
    const chemBlock =
        examProfile === "jee_main" ||
        examProfile === "jee_advanced" ||
        (examProfile === "neet" && subjLower.includes("chem")) ||
        subjLower.includes("chem")
            ? buildChemistryNumericalAuthoringBlock({ examProfile })
            : "";

    const physicsBlock =
        examProfile === "jee_main" ||
        examProfile === "jee_advanced" ||
        (examProfile === "neet" && subjLower.includes("phys")) ||
        subjLower.includes("phys")
            ? buildPhysicsNumericalAuthoringBlock({ examProfile })
            : "";

    const isNonStemDomain = !isStemProfile(examProfile, subject);

    const nonStemAnswerTypeBlock = isNonStemDomain
        ? `\n**NON-NUMERIC ANSWER TYPE:** If this subject has no numeric solve, set \`finalAnswer.type = "text"\`, \`finalAnswer.display\` = the correct statement/option text (not a number), and \`distractorValues\` = exactly 3 plausible but wrong statements on the same point of law/fact/reasoning (not vague filler — a well-prepared candidate should have to actually eliminate them). If the stem IS quantitative (e.g. CAT Quantitative Ability), keep \`finalAnswer.type = "numeric"\` as usual.\n`
        : "";

    // Standalone (non-passage) generation only reaches here, so the passage-
    // oriented CLAT/CAT VARC/DILR guidance in buildExamSpecificRules mostly
    // falls through to its generic branches for these profiles — still
    // useful for register/difficulty framing on the standalone items that
    // DO reach solve-first (e.g. CLAT Legal Reasoning principle-application,
    // CAT QA, UPSC Prelims standalone facts).
    const nonStemExamRulesBlock = isNonStemDomain
        ? buildExamSpecificRules({ examProfile, sectionName, passageCount: 0 })
        : "";

    const isJeeStem =
        examProfile === "jee_main" || examProfile === "jee_advanced";
    const jeeHardBlock = isJeeStem
        ? buildJeeHardStemAuthoringBlock(examProfile)
        : "";
    const scoringConceptWriterBlock = isJeeStem
        ? buildScoringConceptWriterBlock({
              subject: subject || bankName || topic,
              examProfile,
              difficulty,
              examCalibrated: difficultyResolution?.examCalibrated || false,
          })
        : "";
    const isAdvProfile = examProfile === "jee_advanced";
    const slotSlice =
        slotPlans?.slice(0, count)?.length
            ? slotPlans.slice(0, count)
            : conceptSlots.slice(0, count);
    const subjectForRef = subject || bankName || topic;

    // JEE Advanced Maths/Physics: dedicated packs from jee_advanced/.
    // JEE Main: Main official syllabus + NCERT chapter reference.
    const isAdvMathsWriter =
        isAdvProfile &&
        isJeeAdvancedMathsDataAvailable() &&
        /\bmath/i.test(`${subjectForRef || ""}`);
    const isAdvPhysicsWriter =
        isAdvProfile &&
        isJeeAdvancedPhysicsDataAvailable() &&
        /\bphysics\b/i.test(`${subjectForRef || ""}`);
    const advancedWriterPack = isAdvMathsWriter
        ? [
              buildJeeAdvancedSyllabusWriterBlock({
                  subject: subjectForRef,
                  examProfile,
              }),
              buildJeeAdvancedPatternAuthoringBlock({ examProfile }),
              buildJeeAdvancedNcertWriterBlock({
                  subject: subjectForRef,
                  examProfile,
                  slots: slotSlice,
              }),
          ]
              .filter(Boolean)
              .join("\n")
        : isAdvPhysicsWriter
          ? [
                buildJeeAdvancedPhysicsSyllabusWriterBlock({
                    subject: subjectForRef,
                    examProfile,
                }),
                buildJeeAdvancedPhysicsPatternAuthoringBlock({ examProfile }),
                buildJeeAdvancedPhysicsNcertWriterBlock({
                    subject: subjectForRef,
                    examProfile,
                    slots: slotSlice,
                }),
            ]
                .filter(Boolean)
                .join("\n")
          : "";

    const officialSyllabusWriterBlock =
        isJeeStem && !advancedWriterPack
            ? buildOfficialSyllabusWriterBlock({
                  subject: subjectForRef,
                  examProfile,
              })
            : "";

    // NCERT Class 11/12 chapter reference for the chapters this batch touches.
    // Chapters are inferred from the planned slots (their own `chapter` field
    // when the caller set one, else from concept-slot vocabulary). Advanced
    // path uses advancedWriterPack instead (richer M01–M19 hard context).
    const ncertChapterReferenceBlock = advancedWriterPack
        ? advancedWriterPack
        : isJeeStem
          ? buildNcertChapterReferenceBlock({
                chapters: inferNcertChaptersFromSlots(slotSlice).map(
                    (c) => c.label
                ),
                subject: subjectForRef,
            })
          : "";

    // Root-cause-1 fix from the correctness review: neither the hard-mandate
    // nor the difficulty self-audit ever recomputes the actual math, so a
    // deterministic SymPy re-derivation is wired in right after skeleton
    // parsing (see skeletonCasVerification.service.js) — but it can only
    // check a skeleton that declares its raw inputs in machine-readable
    // form. This block asks for that, gated to Mathematics only since the
    // known archetypes (area-between-curves, limits, integrals, matrices,
    // linear ODEs) are all Maths-specific.
    const isMathSubject = /\bmath(?:s|ematics)?\b/.test(
        `${subjLower} ${String(topic || "").toLowerCase()} ${String(bankName || "").toLowerCase()}`
    );
    const casVerificationContractBlock = isMathSubject
        ? buildCasVerificationContractBlock()
        : "";

    const aiSteered =
        archetypeSteeringSource === "ai" ||
        archetypeSteeringSource === "ai_partial";
    const archetypeBatchBlock = buildBatchArchetypeGuidanceBlock({
        conceptSlots: conceptSlots.slice(0, count),
        slotPlans: slotPlans?.slice(0, count) || null,
        difficultyTierSlots: difficultyTierSlots.slice(0, count),
        examProfile,
        slotOffset,
        aiSteered,
    });

    const preferPeak =
        !aiSteered &&
        (difficultyResolution?.examCalibrated ||
            String(difficulty || "").toLowerCase() === "hard");
    const archetypeSelectionBlock = preferPeak
        ? buildSubjectArchetypeSelectionBlock({
              conceptSlots: conceptSlots.slice(0, count),
              subjectId: subject || bankName || topic,
              examProfile,
              preferPeak,
          })
        : aiSteered
          ? `
**AI ARCHETYPE STEERING:** Slots and blueprints for this batch were planned for "${topic || bankName}" — use the assigned slot id in each skeleton's \`conceptSlot\` field. Do not swap to an easier archetype.`
          : "";

    const jeeHardAntiTemplate = isJeeStem
        ? buildJeeMainHardAntiTemplateBlock(examProfile)
        : "";

    const jeeAuthenticityBlock = isJeeStem
        ? buildJeeAuthenticityGenerationBlock({
              examProfile,
              difficulty,
              batchSize: count,
              sectionName,
          })
        : "";

    const difficultyCalibrationBlock = buildDifficultyCalibrationBlock({
              bankName,
              topic,
              subject,
              difficulty,
              batchSize: count,
              categoryPaths,
              sectionName,
          });

    const effectiveTier = difficultyResolution?.examCalibrated
        ? "hard"
        : difficulty;
    // The hard-mandate / skeleton-compliance / veteran blocks are physics-STEM
    // authoring guidance (concept-cluster vocabulary, numeric givens, "JEE
    // shift-paper"). They must not be injected for non-STEM domains — including
    // NEET Biology (Botany/Zoology) — or the model manufactures calculation
    // questions and bolts physics onto conceptual stems.
    const hardMandateBlock = isNonStemDomain
        ? ""
        : buildHardQuestionMandateBlock({
              examProfile,
              tier: effectiveTier,
              examCalibrated: difficultyResolution?.examCalibrated || false,
          });
    const skeletonComplianceBlock =
        examNativeVeteran || isNonStemDomain
            ? ""
            : buildSkeletonGenerationComplianceBlock({
                  examProfile,
                  examCalibrated: difficultyResolution?.examCalibrated || false,
              });
    const veteranExamNativeBlock =
        examNativeVeteran && !isNonStemDomain
            ? buildVeteranExamNativeGenerationBlock({
                  examProfile,
                  batchSize: count,
              })
            : "";
    const mandateFloors = getHardMandateFloors({
        examCalibrated: difficultyResolution?.examCalibrated || false,
    });
    const veteranCaliberBlock = examNativeVeteran
        ? ""
        : buildVeteranExamineeCaliberBlock({ examProfile });

    const bankArchetypeExcludeBlock = buildBankArchetypeExcludeBlock(
        excludeArchetypes
    );

    const regenEscalationBlock = isEvaluationRegen
        ? buildRegenerationEscalationBlock({
              topic,
              bankName,
              sectionName,
              categoryPaths,
              examProfile,
              topicRelevanceFeedback,
              maxSelectableSlots,
          })
        : "";
    const regenQualityGatesBlock = isEvaluationRegen
        ? buildRegenerationQualityGatesBlock({
              topic,
              bankName,
              examProfile,
              topicRelevanceFeedback,
              maxSelectableSlots,
              generateIntent: GENERATE_INTENTS.EVALUATION_REGEN,
          })
        : "";

    const difficultyRegenFeedbackBlock = buildDifficultyRegenFeedbackBlock(
        priorAttemptFeedback
    );

    return `${regenEscalationBlock}${regenQualityGatesBlock}${difficultyRegenFeedbackBlock}${veteranExamNativeBlock}You are authoring ${count} exam MCQ **skeletons** (step 1 of 2). Do NOT write options or correctAnswer letters yet.

**Topic:** ${topic || bankName}
**Bank difficulty profile:** ${difficulty}${difficultyResolution?.examCalibrated ? " (exam-native — all hard, veteran caliber)" : " (per-question tier mix — NOT uniform)"}
${
    examNativeVeteran
        ? ""
        : `${buildDifficultyMixGenerationBlock({
              bankDifficulty: difficulty,
              batchSize: count,
              examProfile,
              examCalibrated: difficultyResolution?.examCalibrated || false,
          })}
${examNativeBlock}
${buildBankDifficultyProfileBlock({ bankDifficulty: difficulty, examProfile })}
${buildAssignedTierSlotsBlock({
    tierSlots: difficultyTierSlots.slice(0, count),
    examProfile,
})}`
}
**Exam profile:** ${examProfile}
${examReferenceBlock}
${referencePaperGroundingBlock}
${retrievedQuestionGroundingBlock}
${jeeAuthenticityBlock}
${difficultyCalibrationBlock}
${jeeHardBlock}
${jeeHardAntiTemplate}
${officialSyllabusWriterBlock}
${ncertChapterReferenceBlock}
${casVerificationContractBlock}
${scoringConceptWriterBlock}
${examNativeVeteran ? "" : `${hardMandateBlock}\n${skeletonComplianceBlock}\n${veteranCaliberBlock}`}
${archetypeSelectionBlock}
${archetypeBatchBlock}

${buildCorrectnessFirstGenerationBlock({ examProfile })}
${buildGenerationCorrectnessMandatesBlock({ examProfile })}
${buildAutomatedAuditorDefectsBlock({ examProfile })}
${buildSolveFirstSkeletonCorrectnessBlock({
    examCalibrated: difficultyResolution?.examCalibrated || false,
})}
${buildExplanationOptionLockBlock({ examProfile })}
${chemBlock}
${physicsBlock}
${nonStemExamRulesBlock}
${nonStemAnswerTypeBlock}
${buildExamSolveThenWriteBlock()}

**MANDATORY concept slots (one distinct problem per slot — no duplicates; ${aiSteered ? "AI-planned" : "catalog"} archetypes assigned):**
${slotLines || `Generate ${count} distinct problems.`}
Each slot name is a **hard archetype from this subject** — write its peak blueprint, not the easy textbook version of the topic.

${excludeBlock}
${bankArchetypeExcludeBlock}

**TASK:** For each slot, read its blueprint above, solve completely, then output skeletons only.

**Rules (every skeleton):**
1. Match the slot's **${examProfile === "jee_main" || examProfile === "jee_advanced" ? "shift-paper hard" : "entrance hard"}** blueprint — multi-condition stem, linked concepts, realistic givens.
2. **finalAnswer** = exact solved result (numeric with unit, hybridization string, molecule formula, or — for non-numeric subjects — \`type: "text"\` with the correct statement as \`display\`).
3. **solveSteps** = **≥${mandateFloors.minSolutionLines}** substantive sentences for hard tier (minimum **${mandateFloors.minSolveSteps}** steps); each step advances the solve; the **last sentence must state the same value as \`finalAnswer.display\`** (full derivation — these become the explanation).
4. **distractorValues** = exactly 3 plausible wrong values (same unit/type as finalAnswer); pH distractors 0–14 only.
5. For hybridization: finalAnswer.display like "sp³d²" (Unicode superscripts OK).
6. For zero-dipole items: finalAnswer.type = "molecule", display = formula like "CO2".
7. Verify arithmetic before output — re-solve from stem givens; wrong finalAnswer or solveSteps≠finalAnswer breaks the question.
8. No duplicate logic across skeletons (different numbers, setups, and micro-topics).
9. Stems: ${
        mandateFloors.veteran
            ? `**≥4 sentences, ≥200 characters**, **≥3 distinct numeric givens** with units, constraint linking two concepts before the ask`
            : `**3–4 sentences**, ≥2 numerical givens with units, constraint or linking phrase before the ask`
    }.
10. **Hard-tier depth (mandatory):** **≥${mandateFloors.minConcepts} concepts** in stem vocabulary, **≥${mandateFloors.minSolveSteps} solveSteps**, **≥${mandateFloors.minSolutionLines} derivation lines**, **no direct substitution** — see SKELETON COMPLIANCE above.
11. **Option craft:** never use a bare number from the stem as an option (if stem gives f = 20 cm, no option "20 cm").
12. **CRITICAL — no self-corrections:** Never output draft thoughts, "re-evaluating", "correcting", "wait", "my mistake", "adjusting", or "therefore override to …". Compute the math **once**, sequentially. If the final value does not match what you planned for option A, set \`finalAnswer.display\` to the **exact** computed final value (do not invent a bridging sentence).
13. **calcOps (recommended for numeric items):** emit a short machine-checkable arithmetic trace, e.g. \`[{"a":11.76,"b":10.0,"op":"-","result":1.76}]\`. The last \`result\` MUST equal \`finalAnswer.value\`. Text explanations must not invent arithmetic that contradicts \`calcOps\`.
14. **Batch diversity:** every skeleton must use a **different micro-topic and problem structure** — no two pulley-incline, lens-contact, or de Broglie-ratio clones in the same batch.
15. **Per-slot concept fusion:** read the assigned \`conceptSlot\` blueprint — the stem must explicitly weave **both** fused ideas from that archetype (e.g. viscosity + terminal velocity + thermal; wavefront + refractive gradient; photoelectric + momentum recoil).
16. **ANSWER LOCK (critical for correctness):** The LAST solveStep MUST end with the same number/expression as \`finalAnswer.display\` / \`finalAnswer.value\`. Never invent a bridging fudge ("subtract 0.43 to match option A"). If the computed value is not among your planned distractors, change \`finalAnswer\` and rebuild \`distractorValues\` around the true value.
17. **Exact form over decimals (JEE Main Maths):** Prefer exact answers (e.g. \`2/3\`, \`(8/3)ln2 - 7/9\`, \`π/4\`, \`√2\`) over rounded decimals when the integral/limit closes exactly. Decimal options only when the problem truly has no clean closed form.
18. **Single clear ask:** One stem = one final numeric/text answer. Do not combine two unrelated asks ("find x for horizontal tangent AND dy/dt") into one MCQ.

${buildPreOutputCorrectnessChecklist({ examProfile })}

Return ONLY valid JSON:
{
  "skeletons": [
    {
      "conceptSlot": "buffer_henderson_hasselbalch",
      "stem": "Full question stem with all given data and units",
      "finalAnswer": {
        "type": "numeric",
        "value": 5.04,
        "display": "5.04",
        "unit": ""
      },
      "calcOps": [{"a": 5.0, "b": 0.04, "op": "+", "result": 5.04}],
      "solveSteps": ["Step 1 with full reasoning …", "Step 2 …", "Step 3 …", "Step 4 …", "Step 5 concluding with the same value as finalAnswer.display …"],
      "distractorValues": ["4.74", "5.34", "5.74"]${
          isMathSubject
              ? `,
      "archetype": "definite_integral",
      "givens": {"expr": "sin(x)**8", "lower": "0", "upper": "pi/2"}`
              : ""
      }
    }
  ]
}

Output exactly ${count} skeleton(s) in the array.`;
};

export const parseSolveFirstSkeletons = (rawText) => {
    let parsed = null;
    try {
        parsed = parseJsonObjectFromAIText(rawText);
    } catch {
        parsed = null;
    }

    let list = parsed?.skeletons || parsed?.items || parsed?.questions;
    if (!Array.isArray(list)) {
        try {
            list = parseJsonArrayFromAIText(rawText);
        } catch {
            list = null;
        }
    }

    if (!Array.isArray(list) || !list.length) {
        const skIdx = String(rawText || "").indexOf('"skeletons"');
        const salvageSource = skIdx >= 0 ? rawText.slice(skIdx) : rawText;
        const salvaged = salvageParseJsonArrayObjects(salvageSource);
        if (salvaged.length) list = salvaged;
    }

    return (list || []).filter((s) => s?.stem && s?.finalAnswer);
};

/** Distractors must not repeat bare givens from the stem (e.g. stem "f = 20 cm" → no option "20 cm"). */
const optionEmbeddedInStem = (stem, optText) => {
    const opt = String(optText || "").trim();
    if (!opt || !stem) return false;
    const stemText = String(stem);
    if (stemText.includes(opt)) return true;
    const m = opt.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
    if (!m) return false;
    const [, num, unit] = m;
    const unitPat = unit.trim()
        ? new RegExp(`\\b${num.replace(".", "\\.")}\\s*${unit.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
        : new RegExp(`\\b${num.replace(".", "\\.")}\\b`);
    return unitPat.test(stemText);
};

/**
 * Deterministic distractor-quality repair — no LLM call.
 *
 * The auditor reports two option defects that NOTHING ever fixed: they are not
 * "strippable" (correctly — you should not delete a question over cosmetics) and so they
 * never reached the repair path either. They simply shipped (observed live:
 * styleScore 90, strippedCount 0, with "Option D trivially embedded in the stem" and
 * "Options A and D are near-duplicates" both surviving into the bank):
 *   1. a distractor copied verbatim from the stem
 *   2. two near-duplicate distractors
 *
 * The previous sanitizer missed case 1 because it tested the stem with a RAW,
 * case-sensitive `includes`, while the auditor tests it normalised — so what got flagged
 * and what got fixed disagreed. Matching is now normalised on both sides.
 *
 * Only DISTRACTORS are ever rewritten — never the correct option, which would change the
 * answer. Replacements are synthesized only for numeric answers; for text answers there
 * is no safe way to invent a good distractor in code, so those are left untouched (still
 * flagged) rather than filled with fabricated nonsense.
 */
const sanitizeDistractorQuality = (stem, options, correctIndex, unit = "") => {
    const list = [...(options || [])];
    const correct = String(list[correctIndex] ?? "");
    const correctNum = parseNumber(correct);

    // parseNumber() is permissive — it happily returns 3 for "Team 3" — so a mere
    // isFinite() check would classify a TEXT answer as numeric and replace a distractor
    // like "Team 1" with a bare synthesized number ("5") sitting among team names.
    // Require the option to BE a number (optionally with a unit), not merely contain one.
    const isNumericAnswer =
        Number.isFinite(correctNum) &&
        /^-?\d+(?:\.\d+)?(?:\s*[×x]\s*10\s*[⁻⁰¹²³⁴⁵⁶⁷⁸⁹\-\d]+)?\s*[%°]?[a-zA-ZμΩ°/·⁻¹²³]{0,10}$/.test(
            correct.trim()
        );
    if (!isNumericAnswer) return list;

    const wantsInteger = Number.isInteger(correctNum) && !correct.includes(".");
    const unitSuffix =
        unit || correct.replace(/^-?\d+(?:\.\d+)?/, "").trim();
    const loose = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const stemNorm = loose(stem);
    const correctNorm = loose(correct);

    // Proportional offsets keep the replacement plausible next to the key. Walking by ±1
    // does not: for a key of "15120 kW" it yields "15121", which is both implausible as a
    // distractor and a near-duplicate of the answer. Anything that cannot produce a
    // clearly-distinct, correctly-united value returns null and the original distractor
    // is left untouched (still flagged) rather than replaced with something worse.
    const OFFSETS = [0.6, 0.75, 0.9, 1.1, 1.25, 1.4, 1.6, 2, 0.5, 2.5];
    const render = (v) => {
        const num = wantsInteger ? String(Math.round(v)) : String(Number(v.toFixed(4)));
        return unitSuffix ? `${num} ${unitSuffix}` : num;
    };
    const synth = (seed) => {
        for (let i = 0; i < OFFSETS.length; i++) {
            const f = OFFSETS[(i + seed) % OFFSETS.length];
            const v = correctNum * f;
            if (!Number.isFinite(v) || v <= 0) continue;
            // Must be clearly separated from the key (≥5%), else it reads as a duplicate.
            if (Math.abs(v - correctNum) < Math.abs(correctNum) * 0.05) continue;
            const cand = render(v);
            const c = loose(cand);
            if (!c || c === correctNorm) continue;
            if (list.some((o) => loose(o) === c)) continue;
            if (stemNorm.includes(c)) continue; // don't reintroduce defect 1
            return cand;
        }
        return null;
    };

    // 1 — distractor lifted from the stem
    for (let i = 0; i < list.length; i++) {
        if (i === correctIndex) continue;
        const raw = String(list[i] ?? "").trim();
        if (raw.length < 3) continue;
        const embedded =
            stemNorm.includes(loose(raw)) || optionEmbeddedInStem(stem, raw);
        if (!embedded) continue;
        const rep = synth(i);
        if (rep) list[i] = rep;
    }

    // 2 — near-duplicate pair: rewrite the one that is not the key
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = loose(list[i]);
            const b = loose(list[j]);
            if (!a || !b) continue;
            if (!(a === b || a.includes(b) || b.includes(a))) continue;
            const victim = j === correctIndex ? i : j;
            if (victim === correctIndex) continue;
            const rep = synth(victim + 7);
            if (rep) list[victim] = rep;
        }
    }

    return list;
};

const shuffleWithSeed = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const isPhStem = (stem = "") =>
    /\bph\b|\bpka\b|\bbuffer\b|\bhenderson/i.test(String(stem || ""));

const optionContainsNumeric = (optText, value) => {
    const target = parseNumber(value);
    const fromOpt = parseNumber(optText);
    if (!Number.isFinite(target) || !Number.isFinite(fromOpt)) {
        return String(optText || "").includes(String(value || "").trim());
    }
    return (
        Math.abs(fromOpt - target) <= Math.max(0.05, Math.abs(target) * 0.02) ||
        String(optText).includes(String(value))
    );
};

const findOptionIndexForNumericValue = (opts, value) => {
    const target = parseNumber(value);
    if (!Number.isFinite(target)) return -1;
    return (opts || []).findIndex((o) => {
        const n = parseNumber(o);
        if (!Number.isFinite(n)) return false;
        return (
            Math.abs(n - target) <= Math.max(0.05, Math.abs(target) * 0.02) ||
            (target !== 0 && Math.abs(n - target) / Math.abs(target) <= 0.02)
        );
    });
};

/** Strip a trailing code/model "Therefore, the correct answer is …" closing (may be duplicated). */
const stripTrailingThereforeClosing = (text) => {
    let s = String(text || "").trim();
    const closing =
        /\s*Therefore,?\s*the\s+(?:correct\s+)?(?:answer|result)\s+is\s+[^.]+[.]?\s*$/i;
    for (let i = 0; i < 3 && closing.test(s); i++) {
        s = s.replace(closing, "").trim();
    }
    return s;
};

/**
 * After independent verify adjusts the answer, append a single closing that names the
 * marked option. Does NOT rewrite earlier derivation values — callers must reject
 * (via assertSolveStepsConsistency) when the derivation disagrees with the key.
 */
export const syncSolveStepsToMarkedAnswer = (solveSteps, markedOptionText) => {
    const marked = String(markedOptionText || "").trim();
    if (!marked || !Array.isArray(solveSteps) || !solveSteps.length) {
        return solveSteps;
    }
    const steps = solveSteps.map((s) => String(s || "").trim()).filter(Boolean);
    const last = steps.length - 1;
    const cleaned = stripTrailingThereforeClosing(steps[last])
        .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
        .trim();
    steps[last] = cleaned
        ? `${cleaned} Therefore, the correct answer is ${marked}.`
        : `Therefore, the correct answer is ${marked}.`;
    return steps;
};

/** Explanation: numbered solve steps + closing + FINAL_ANSWER lock. */
export const lockExplanationToMarkedOption = (
    solveSteps,
    markedOptionText,
    { correctLetter = "" } = {}
) => {
    const marked = String(markedOptionText || "").trim();
    // Strip any prior Therefore / FINAL_ANSWER closings from steps so we never
    // emit duplicated closings when sanitizeMcqForPipeline re-enters.
    const steps = (solveSteps || [])
        .map(String)
        .map(stripMetaCommentary)
        .map(stripTrailingThereforeClosing)
        .map((s) => s.replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim())
        .filter(Boolean);
    const body =
        steps.length > 1
            ? steps.map((s, i) => `Step ${i + 1}: ${s}`).join(" ")
            : steps.join(" ").trim();
    if (!marked) {
        return body.slice(0, 1400) || "See calculation above.";
    }
    const letterTag =
        String(correctLetter || "").trim().toUpperCase() ||
        (/^[A-D]$/i.test(marked) ? marked.toUpperCase() : "");
    const closing = body
        ? `${body} Therefore, the correct answer is ${marked}.`
        : `Therefore, the correct answer is ${marked}.`;
    const withFinal = letterTag
        ? `${closing} FINAL_ANSWER: ${letterTag}`
        : closing;
    return withFinal.slice(0, 1600);
};

const sanitizePhOptions = (options, correctIndex) => {
    const list = [...(options || [])];
    const correct = parseNumber(list[correctIndex]);
    const correctPh = Number.isFinite(correct) && correct >= 0 && correct <= 14;

    for (let i = 0; i < list.length; i++) {
        const bare = String(list[i] || "").trim().match(/^(\d+(?:\.\d+)?)\s*$/);
        if (!bare) continue;
        const val = Number(bare[1]);
        if (!Number.isFinite(val) || (val >= 0 && val <= 14)) continue;
        if (i === correctIndex && correctPh) continue;
        const replacement = correctPh
            ? Math.max(0, Math.min(14, correct + (i - correctIndex) * 0.4))
            : 7 + i * 0.3;
        list[i] = replacement.toFixed(2);
    }
    return list;
};

/**
 * Parse a numeric value from a string, handling ×10^n superscript notation
 * (e.g. "1.70×10⁵") in addition to whatever parseNumber already handles.
 */
const parseNumericWithSuperscript = (str) => {
    const s = String(str || "").trim();
    // \s*\^?\s* after "10" is required for CARET notation ("10^52") — the most common
    // form LLMs emit — which this regex previously did not match (only an immediately-
    // adjacent superscript/digit exponent), silently truncating "4.17 × 10^52" to 4.17.
    const sciMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*[×x\*]\s*10\s*\^?\s*([⁰¹²³⁴⁵⁶⁷⁸⁹⁻\-\d]+)/i);
    if (sciMatch) {
        const base = parseFloat(sciMatch[1]);
        const expStr = sciMatch[2];
        const expMap = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5',
                         '⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-' };
        const exponent = parseInt(
            expStr.split('').map(c => expMap[c] ?? c).join(''),
            10
        );
        const result = base * Math.pow(10, exponent);
        if (Number.isFinite(result)) return result;
    }
    return parseNumber(s);
};

/**
 * Extract final-result candidates from a solve-step string array.
 *
 * Two tiers:
 *
 *   HIGH-PRIORITY — conclusion keywords: "therefore/thus/hence/the answer is …"
 *   These are the strongest signal that a value is the final answer, regardless
 *   of what variable name precedes it. Domain-agnostic.
 *
 *   LOW-PRIORITY (fallback) — the last "= VALUE" assignment in the last step.
 *   Used only when no conclusion keyword is present. We take the LAST step's
 *   last numeric assignment, not every intermediate "a = 9.8" across all steps,
 *   to avoid treating setup constants as final answers.
 *
 * Returns { highPri: [{value, display}], lastEq: {value, display} | null }.
 */
const extractSolveStepResults = (solveSteps) => {
    // \\s*\\^?\\s* after "10" is required for CARET notation ("× 10^52") — without it
    // this token silently stops at the mantissa for the most common form LLMs emit,
    // truncating "4.17 × 10^52" to "4.17" before any parsing even runs.
    const NUM_TOKEN_SRC = '(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?(?:\\s*[×x\\*]\\s*10\\s*\\^?\\s*[⁰¹²³⁴⁵⁶⁷⁸⁹⁻\\-\\d]+)?)';

    // High-priority: conclusion keywords anywhere across all steps.
    // Include ≈ / approximately — JEE solutions often end "√66 ≈ 8.12" without "therefore".
    const allText = solveSteps.map(s => String(s || "")).join(" ");
    const conclusionRe = new RegExp(
        `\\b(?:therefore|thus|hence|(?:the\\s+)?(?:correct\\s+)?(?:answer|result|value|magnitude|volume|probability)\\s+is|gives?|yields?|equals?|approximately)\\s*(?:is|are|=|≈|~)?\\s*${NUM_TOKEN_SRC}` +
        `|≈\\s*${NUM_TOKEN_SRC}`,
        'gi'
    );
    const highPri = [];
    for (const m of allText.matchAll(conclusionRe)) {
        const token = m[1] || m[2];
        const v = parseNumericWithSuperscript(token);
        if (Number.isFinite(v)) highPri.push({ value: v, display: String(token).trim() });
    }

    // Low-priority fallback: last "= VALUE" in the last step only
    const lastStepText = String(solveSteps[solveSteps.length - 1] || "");
    const eqRe = new RegExp(`=${NUM_TOKEN_SRC}`, 'g');
    let lastEq = null;
    for (const m of lastStepText.matchAll(eqRe)) {
        const v = parseNumericWithSuperscript(m[1]);
        if (Number.isFinite(v)) lastEq = { value: v, display: m[1].trim() };
    }

    return { highPri, lastEq };
};

/**
 * Tolerance for comparing a computed value against the answer options.
 *
 * This used to be `max(0.05, |v| * 2%)`. That flat 0.05 floor is larger than the spacing
 * between small-magnitude options — for a probability set like 0.2500 / 0.2875 / 0.3000 /
 * 0.3125 every option sits within 0.05 of every other, so a derivation concluding 0.2875
 * "matched" a key of 0.3000 and the mismatch was never reported. The tolerance must never
 * be wide enough to span two distinct options.
 */
const answerMatchTolerance = (value, optionNumerics = []) => {
    const vals = (optionNumerics || [])
        .filter(Number.isFinite)
        .slice()
        .sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < vals.length; i++) {
        const d = Math.abs(vals[i] - vals[i - 1]);
        if (d > 0) gap = Math.min(gap, d);
    }
    const relative = Math.max(Math.abs(value) * 0.02, 1e-9);
    return Number.isFinite(gap) ? Math.min(relative, gap / 2) : relative;
};

/** Returns true if `computed` is close enough to any of the numeric option values. */
const computedMatchesAnyOption = (computed, optionNumerics) => {
    const tol = answerMatchTolerance(computed, optionNumerics);
    return optionNumerics.some(n => Number.isFinite(n) && Math.abs(n - computed) <= tol);
};

/** Escape a literal for use inside a RegExp. */
const escapeForRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `haystack` name `needle` as a whole token?
 * Substring matching is unsafe here: "Team 1" is a substring of "Team 14", which would
 * make a derivation concluding "Team 3 ... team 14" look like it agrees with a "Team 1"
 * key. Word-boundary matching avoids that.
 */
const mentionsToken = (haystack, needle) => {
    const n = String(needle || "").trim();
    if (n.length < 3) return false; // too short to be distinctive (e.g. "A", "2")
    return new RegExp(`(?:^|\\W)${escapeForRegExp(n)}(?:\\W|$)`, "i").test(
        String(haystack || "")
    );
};

/**
 * Text-answer key check. The numeric path below bails whenever the marked option isn't a
 * number, which left every text answer — most of a DILR / VARC / theory bank ("B, A, C, D",
 * "Team 3", "Scatter plot") — with NO key verification at all. Production shipped an
 * explanation reading "…defeated Team 3 … Therefore, the correct answer is Team 1."
 *
 * Throws (routing the skeleton to repair) only when the derivation's own conclusion names
 * a DIFFERENT option and does not name the marked one — a deliberately conservative test.
 */
const assertTextAnswerConsistency = ({ _solveSteps, options, correctIndex }) => {
    const marked = String(options[correctIndex] || "").trim();
    if (!marked) return;

    const lastStep = String(_solveSteps[_solveSteps.length - 1] || "");
    // Prefer the concluding clause; fall back to the whole final step.
    const conclusion =
        lastStep.match(/\b(?:therefore|thus|hence|so)\b[,:]?\s*(.+)$/i)?.[1] || lastStep;
    if (!conclusion.trim()) return;

    // Consistent if the conclusion names the marked option.
    if (mentionsToken(conclusion, marked)) return;

    for (let i = 0; i < options.length; i++) {
        if (i === correctIndex) continue;
        const other = String(options[i] || "").trim();
        if (!mentionsToken(conclusion, other)) continue;
        // The conclusion names another option and not the marked one.
        throw new Error(
            `Solve steps conclude "${other}" but marked answer is "${marked}" — wrong option marked`
        );
    }
};

/**
 * Pull the derivation's numeric conclusion, ignoring distractor-override language
 * that models append to paper over a wrong key.
 */
const extractDerivationCandidate = (_solveSteps = []) => {
    if (!Array.isArray(_solveSteps) || !_solveSteps.length) return null;
    const OVERRIDE_SPLIT =
        /\b(?:however|,?\s*for the specific distractor|nearest option|closest option|among the (?:given )?options|but (?:for the specific|the nearest|using the distractor)|unjustified statement|overrides? it to match)\b/i;
    const joined = _solveSteps.map((s) => String(s || "")).join(" ");
    const preOverrideText = joined.split(OVERRIDE_SPLIT)[0];
    const preOverrideSteps =
        preOverrideText.trim().length >= 12 ? [preOverrideText] : _solveSteps;

    const { highPri, lastEq } = extractSolveStepResults(preOverrideSteps);
    const fallback = extractSolveStepResults(_solveSteps);
    const primary =
        (highPri.length ? highPri[highPri.length - 1] : null) ||
        lastEq ||
        (fallback.highPri.length
            ? fallback.highPri[fallback.highPri.length - 1]
            : fallback.lastEq);
    if (primary) return primary;

    // Fallback: last numeric token in the last step that looks like a magnitude
    // (covers "the equivalent resistance is 5.66 ohm" without "=" / therefore).
    const lastStep = String(_solveSteps[_solveSteps.length - 1] || "");
    const nums = [
        ...lastStep.matchAll(/(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g),
    ].map((m) => ({
        value: Number(m[1]),
        display: m[1],
    }));
    const usable = nums.filter((n) => Number.isFinite(n.value));
    return usable.length ? usable[usable.length - 1] : null;
};

/**
 * Trust the derivation over the model's key:
 * - if compute matches another option → rematch that option
 * - if compute matches none → rebuild options around the computed value
 * Returns null when no numeric candidate / no change needed.
 */
const realignOptionsToDerivation = ({
    _solveSteps,
    options,
    correctIndex,
    unit = "",
    distractorValues = [],
}) => {
    const candidate = extractDerivationCandidate(_solveSteps);
    if (!candidate || !Number.isFinite(candidate.value)) return null;

    const optionNumerics = (options || []).map((o) => parseNumber(o));
    const tol = answerMatchTolerance(candidate.value, optionNumerics);
    const markedNumeric = parseNumber(options?.[correctIndex]);
    if (
        Number.isFinite(markedNumeric) &&
        Math.abs(markedNumeric - candidate.value) <= tol
    ) {
        return null;
    }

    const matchIdx = optionNumerics.findIndex(
        (n) => Number.isFinite(n) && Math.abs(n - candidate.value) <= tol
    );
    if (matchIdx >= 0) {
        return {
            options,
            correctIndex: matchIdx,
            realigned: "rematch_option",
            candidate,
        };
    }

    // Derivation is coherent but not among options — rebuild distractors around it
    // rather than reject the whole skeleton (flash-lite often mis-keys by one distractor).
    const display =
        formatValueForOption(candidate.value, unit) ||
        String(candidate.display || candidate.value).trim();
    const rebuilt = buildNumericDistractors(display, distractorValues, unit);
    const rebuiltNums = rebuilt.map((o) => parseNumber(o));
    const rebuiltTol = answerMatchTolerance(candidate.value, rebuiltNums);
    let newIdx = rebuiltNums.findIndex(
        (n) => Number.isFinite(n) && Math.abs(n - candidate.value) <= rebuiltTol
    );
    if (newIdx < 0) newIdx = 0;
    return {
        options: rebuilt,
        correctIndex: newIdx,
        realigned: "rebuild_options",
        candidate,
    };
};

const assertSolveStepsConsistency = ({ _solveSteps, options, correctIndex }) => {
    if (!Array.isArray(_solveSteps) || !_solveSteps.length) return;

    const marked = options[correctIndex];
    const markedNumeric = parseNumber(marked);
    if (!Number.isFinite(markedNumeric)) {
        assertTextAnswerConsistency({ _solveSteps, options, correctIndex });
        return;
    }

    const optionNumerics = options.map(o => parseNumber(o));
    const candidate = extractDerivationCandidate(_solveSteps);

    if (!candidate) {
        // No numeric conclusion to compare against. This is the common case for answers
        // that merely CONTAIN a digit — parseNumber("Team 1") returns 1, so we land in
        // this numeric branch even though the answer is really text. Fall back to the
        // token-based text check rather than returning unverified.
        assertTextAnswerConsistency({ _solveSteps, options, correctIndex });
        return;
    }

    const tol = answerMatchTolerance(candidate.value, optionNumerics);
    const markedMatchesCandidate = Math.abs(markedNumeric - candidate.value) <= tol;

    // Reject whenever the derivation's conclusion disagrees with the marked option.
    // Previously Failure B only fired when relDiff > 15% AND absDiff > 1, which let
    // classic force-align cases through (√66≈8.12 vs marked 7.35 ≈ 10% relative) —
    // then sync/lock appended "Therefore, the correct answer is 7.35" and shipped a
    // coherent-looking but wrong key. Prefer reject-and-repair over force-align.
    // Callers that can rematch/rebuild (buildMcqFromSkeleton) should realign first.
    if (!markedMatchesCandidate) {
        const matchesOther = options.some((opt, idx) => {
            if (idx === correctIndex) return false;
            const n = optionNumerics[idx];
            return Number.isFinite(n) && Math.abs(n - candidate.value) <= tol;
        });
        if (matchesOther) {
            throw new Error(
                `Solve steps compute ${candidate.display} but marked answer is ${marked} — wrong option marked`
            );
        }
        throw new Error(
            `Solve steps compute ${candidate.display} but marked answer is ${marked} — derivation does not match the marked option (reject, do not force-align)`
        );
    }

    // Extra guard: any explicit therefore/thus/hence NUMBER that names a different
    // option (even if the primary candidate already matched) is still a contradiction.
    const allText = _solveSteps.map(s => String(s || "")).join(" ");
    // \\s*\\^?\\s* after "10" is required for CARET notation ("× 10^52") — without it
    // this token silently stops at the mantissa for the most common form LLMs emit,
    // truncating "4.17 × 10^52" to "4.17" before any parsing even runs.
    const NUM_TOKEN_SRC = '(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?(?:\\s*[×x\\*]\\s*10\\s*\\^?\\s*[⁰¹²³⁴⁵⁶⁷⁸⁹⁻\\-\\d]+)?)';
    const conclusionRe = new RegExp(
        `\\b(?:therefore|thus|hence)\\s*(?:the\\s+(?:correct\\s+)?(?:answer|result|value)\\s+is\\s+)?${NUM_TOKEN_SRC}`,
        'gi'
    );
    for (const m of allText.matchAll(conclusionRe)) {
        const asserted = parseNumericWithSuperscript(m[1]);
        if (!Number.isFinite(asserted)) continue;
        const assertTol = answerMatchTolerance(asserted, optionNumerics);
        if (Math.abs(asserted - markedNumeric) > assertTol &&
            computedMatchesAnyOption(asserted, optionNumerics)) {
            throw new Error(
                `Solve steps assert "${m[1].trim()}" via conclusion keyword but marked answer is ${marked}`
            );
        }
    }
};

/** Exported for unit tests — same gate used by buildMcqFromSkeleton before force-align. */
export const assertSolveStepsConsistencyForTest = assertSolveStepsConsistency;

const assertBuiltMcqConsistency = ({ questionText, options, correctIndex, explanation, _solveSteps }) => {
    const marked = options[correctIndex];
    if (!marked) throw new Error("Missing marked option");

    const normOpts = options
        .map((o) => String(o || "").trim().toLowerCase())
        .filter(Boolean);
    if (normOpts.length >= 2 && new Set(normOpts).size !== normOpts.length) {
        throw new Error("Two or more options are identical");
    }

    if (isPhStem(questionText)) {
        for (let i = 0; i < options.length; i++) {
            const bare = String(options[i] || "").trim().match(/^(\d+(?:\.\d+)?)\s*$/);
            if (!bare) continue;
            const val = Number(bare[1]);
            if (Number.isFinite(val) && (val < 0 || val > 14)) {
                throw new Error(`Invalid pH option: ${options[i]}`);
            }
        }
    }

    // NEW: Deep validation of solve steps before explanation text checks
    assertSolveStepsConsistency({ _solveSteps, options, correctIndex });

    const tail = String(explanation || "").slice(-220);
    const bodyBeforeTherefore = String(explanation || "").split(/\bTherefore\b/i)[0] || "";
    const deriveMatches = [
        ...bodyBeforeTherefore.matchAll(/=\s*(-?\d+(?:\.\d+)?)\s*(?:W|J|N|m\/s(?:²)?|eV|mm|cm)?/gi),
    ];
    if (deriveMatches.length) {
        const lastDeriv = deriveMatches[deriveMatches.length - 1][1];
        const inMarked = optionContainsNumeric(marked, lastDeriv);
        const inAny = options.some((o) => optionContainsNumeric(o, lastDeriv));
        if (inAny && !inMarked) {
            throw new Error(
                `Explanation derives ${lastDeriv} but marked option is ${marked}`
            );
        }
    }

    const nums = [...tail.matchAll(/(?:=|is|are|gives?|yields?|equals?)\s*(-?\d+(?:\.\d+)?)/gi)];
    if (nums.length) {
        const lastVal = nums[nums.length - 1][1];
        const inMarked = optionContainsNumeric(marked, lastVal);
        const inAny = options.some((o) => optionContainsNumeric(o, lastVal));
        if (!inAny) {
            throw new Error(
                `Explanation derives ${lastVal} but that value is not among options`
            );
        }
        if (!inMarked) {
            throw new Error(
                `Explanation concludes ${lastVal} but marked option is ${marked}`
            );
        }
    }

    const body = String(explanation || "");
    const bodyAsserts = [
        ...body.matchAll(
            /\b(?:molarity|molality|pH|time)\b\s*=\s*(-?\d+(?:\.\d+)?)/gi
        ),
    ];
    for (const m of bodyAsserts) {
        const val = m[1];
        if (!optionContainsNumeric(marked, val) && !options.some((o) => optionContainsNumeric(o, val))) {
            throw new Error(
                `Explanation asserts ${val} but that value is not among options`
            );
        }
    }
};

const buildHybridizationDistractors = (correct) => {
    const pool = ["sp", "sp²", "sp³", "sp³d", "sp³d²", "sp³d³"];
    const out = [correct];
    for (const p of pool) {
        if (!hybridizationMatches(p, correct) && out.length < 4) out.push(p);
    }
    while (out.length < 4) out.push(`sp³d${out.length}`);
    return shuffleWithSeed(out.slice(0, 4));
};

const buildMoleculeDistractors = (correct) => {
    const polar = [...POLAR_MOLECULES].map((f) =>
        f === "H2O" ? "H2O" : f === "NH3" ? "NH3" : f
    );
    const zeros = [...ZERO_DIPOLE_MOLECULES].filter((f) => f !== correct.toUpperCase().replace(/\s/g, ""));
    const distractors = [];
    for (const p of polar) {
        if (distractors.length >= 3) break;
        if (p !== correct.toUpperCase()) distractors.push(p);
    }
    while (distractors.length < 3 && zeros.length) {
        distractors.push(zeros.shift());
    }
    const options = shuffleWithSeed([correct, ...distractors.slice(0, 3)]);
    return options;
};

const buildNumericDistractors = (display, distractorValues = [], unit = "") => {
    const correct = String(display || "").trim();
    const correctNum = parseNumber(correct);

    // If the answer is a whole number, the distractors must be whole numbers too.
    // Production shipped "the minimum number of rooms required" with options
    // 1.76 / 1.52 / 2 / 2.72, a path count offering 1.76, and a student count offering
    // 26.88 — fractional options for inherently countable quantities are obviously
    // wrong to any candidate and give the answer away.
    const wantsInteger =
        Number.isFinite(correctNum) &&
        Number.isInteger(correctNum) &&
        !correct.includes(".");

    // Rewrite ONLY the numeric part, in place, and only when it is actually fractional.
    // Round-tripping through formatValueForOption() destroys units it does not recognise —
    // its whitelist is min/M/mol·kg/kJ·mol/nm/J·mol·K/W, so "20160 kW" came back as
    // "20160" — so an already-integer distractor is returned untouched.
    const coerce = (v) => {
        const s = String(v ?? "").trim();
        if (!wantsInteger || !s) return s;
        const n = parseNumber(s);
        if (!Number.isFinite(n) || Number.isInteger(n)) return s;
        return s.replace(/-?\d+(?:\.\d+)?/, String(Math.round(n)));
    };

    const unique = [];
    const add = (v) => {
        const s = String(v ?? "").trim();
        if (!s || s === correct || unique.includes(s)) return false;
        unique.push(s);
        return true;
    };

    for (const d of distractorValues) add(coerce(d));

    // Synthesize any shortfall. Proportional offsets first (keeps magnitude plausible);
    // for integers they are rounded, and if rounding collides we walk outwards by ±k.
    // Render explicitly so the unit survives (see coerce note above).
    const unitSuffix = unit || correct.replace(/^-?\d+(?:\.\d+)?/, "").trim();
    const render = (v) => {
        const num = wantsInteger ? String(Math.round(v)) : String(Number(v.toFixed(4)));
        return unitSuffix ? `${num} ${unitSuffix}` : num;
    };
    const offsets = [0.85, 1.15, 1.5, 0.7, 1.3, 1.75, 0.6, 2];
    for (let i = 0; unique.length < 3 && i < offsets.length; i++) {
        if (!Number.isFinite(correctNum)) break;
        const v = correctNum * offsets[i];
        if (v > 0) add(render(v));
    }
    for (let k = 1; unique.length < 3 && k <= 12; k++) {
        if (!Number.isFinite(correctNum)) break;
        for (const delta of [k, -k]) {
            if (unique.length >= 3) break;
            const v = correctNum + delta;
            if (v <= 0) continue;
            add(render(v));
        }
    }
    while (unique.length < 3) add(`${correct} (alt ${unique.length + 1})`);

    return shuffleWithSeed([correct, ...unique.slice(0, 3)]);
};

/** Non-numeric (non-STEM) answers — the model's own distractorValues are the
 * wrong options directly; there's no arithmetic offset to synthesize for a
 * legal/GK statement, so unlike buildNumericDistractors this never invents
 * filler options. Throws if fewer than 3 usable distractors survive, which
 * routes the skeleton to the existing repair queue like any other build failure. */
const buildTextDistractors = (display, distractorValues = []) => {
    const correct = String(display || "").trim();
    const unique = [
        ...new Set(
            distractorValues
                .map((d) => String(d || "").trim())
                .filter((d) => d && d.toLowerCase() !== correct.toLowerCase())
        ),
    ];
    if (unique.length < 3) {
        throw new Error(
            `text answer needs 3 distinct distractorValues (found ${unique.length})`
        );
    }
    return shuffleWithSeed([correct, ...unique.slice(0, 3)]);
};

/**
 * Apply machine-checkable calcOps to override finalAnswer when present.
 * Ops: { a, b, op: '+'|'-'|'*'|'/'|'^', result? }
 * Last computed result becomes finalAnswer.value/display.
 */
export const applyCalcOpsToSkeleton = (skeleton = {}) => {
    const ops = Array.isArray(skeleton?.calcOps) ? skeleton.calcOps : [];
    if (!ops.length) return skeleton;

    let last = null;
    for (const op of ops) {
        const a = Number(op?.a);
        const b = Number(op?.b);
        const kind = String(op?.op || "").trim();
        if (![a, b].every(Number.isFinite) || !kind) continue;
        let computed = NaN;
        if (kind === "+") computed = a + b;
        else if (kind === "-") computed = a - b;
        else if (kind === "*" || kind === "×" || kind === "x") computed = a * b;
        else if (kind === "/" || kind === "÷") computed = b === 0 ? NaN : a / b;
        else if (kind === "^" || kind === "**") computed = a ** b;
        if (!Number.isFinite(computed)) {
            throw new Error(
                `calcOps invalid: ${a} ${kind} ${b} is not a finite number`
            );
        }
        const stated = Number(op?.result);
        if (Number.isFinite(stated) && Math.abs(stated - computed) > 1e-6 * Math.max(1, Math.abs(computed))) {
            throw new Error(
                `calcOps mismatch: ${a} ${kind} ${b} should be ${computed} but states ${stated}`
            );
        }
        last = computed;
    }
    if (last == null) return skeleton;

    const fa = { ...(skeleton.finalAnswer || {}) };
    const display =
        Math.abs(last) >= 100 || Number.isInteger(last)
            ? String(Math.round(last * 1000) / 1000)
            : String(Number(last.toFixed(6)));
    return {
        ...skeleton,
        finalAnswer: {
            ...fa,
            type: fa.type || "numeric",
            value: last,
            display,
        },
    };
};

export const buildMcqFromSkeleton = (
    skeleton,
    index = 0,
    assignedTier = "medium",
    assignedConceptSlot = ""
) => {
    const stem = String(skeleton.stem || "").trim();
    const tier = String(assignedTier || skeleton.difficultyTier || "medium").toLowerCase();
    // Prefer calcOps-derived finalAnswer when present (deterministic arithmetic).
    skeleton = applyCalcOpsToSkeleton(skeleton);
    const solveSteps = (skeleton.solveSteps || [])
        .map(String)
        .map(stripMetaCommentary)
        .filter(Boolean)
        // Drop degenerate steps that carry no reasoning — production shipped a question
        // whose step 3 was literally "." . Removing them here lowers the step count, so
        // the hard-mandate floor rejects the skeleton and routes it to repair instead of
        // letting an empty step pad out the derivation.
        .filter((s) => /[A-Za-z0-9]{2,}/.test(s));
    let fa = { ...(skeleton.finalAnswer || {}) };

    // Solver-truth: Independent Solver owns the answer. Generator builds stem+options only.
    const solverTruth =
        process.env.AI_QB_SOLVER_TRUTH !== "0" &&
        process.env.AI_QB_SOLVER_TRUTH !== "false";

    if (!solverTruth) {
        const preCheck = independentlyVerifyQuestion({
            questionText: stem,
            options: [
                String(fa.display ?? fa.value ?? ""),
                ...(skeleton.distractorValues || []).map(String),
            ]
                .filter(Boolean)
                .slice(0, 4),
            correctIndex: 0,
        });
        if (preCheck.expected?.display) {
            fa = {
                ...fa,
                display: preCheck.expected.display,
                value: preCheck.expected.value,
                unit: preCheck.expected.unit || fa.unit,
                type: preCheck.expected.type || fa.type,
            };
        }
    }

    const type = String(fa.type || "numeric").toLowerCase();
    const display = String(fa.display ?? fa.value ?? "").trim();
    const unit = String(fa.unit || "").trim();
    const distractorValues = skeleton.distractorValues || [];

    // Anchored to actual hybridization notation (sp, sp², sp³d² …) — a loose
    // /sp/ substring test also matches ordinary English words ("response",
    // "special", "disproportionation"), which corrupted non-STEM text
    // answers into chemistry notation. type !== "text" keeps explicit text
    // answers out of this branch even if their display happens to match.
    const looksLikeHybridizationNotation =
        type !== "text" && /^sp[¹²³⁰-⁹\d]{0,3}(?:d[¹²³⁰-⁹\d]{0,2})?$/i.test(display);

    let options;
    if (type === "hybridization" || looksLikeHybridizationNotation) {
        const mol = stem.match(/\b([A-Z][A-Za-z₀-₉\d]{1,8})\b/)?.[1];
        const verified = mol ? getHybridizationForFormula(mol) : null;
        const correct = verified || display;
        options = buildHybridizationDistractors(correct);
    } else if (type === "molecule") {
        options = buildMoleculeDistractors(display);
    } else if (type === "text") {
        options = buildTextDistractors(display, distractorValues);
    } else {
        const formatted =
            display || formatValueForOption(parseNumber(fa.value), unit);
        options = buildNumericDistractors(formatted, distractorValues, unit);
    }

    // Locate the correct option. The old matcher used a FLAT 0.05 absolute tolerance
    // floor, which is wider than the spacing between small-magnitude options
    // (probabilities/ratios like 0.2875 · 0.3000 · 0.3125 are all within 0.05 of each
    // other). findIndex then keyed whichever happened to come FIRST in the shuffled
    // option array — frequently a distractor, silently producing a wrong answer key.
    // Now: exact match wins outright, and the numeric fallback tolerance can never be
    // wide enough to span two distinct options.
    const optionNumbers = options.map((o) => parseNumber(o));
    const smallestOptionGap = (() => {
        const vals = optionNumbers.filter(Number.isFinite).slice().sort((a, b) => a - b);
        let gap = Infinity;
        for (let i = 1; i < vals.length; i++) {
            const d = Math.abs(vals[i] - vals[i - 1]);
            if (d > 0) gap = Math.min(gap, d);
        }
        return gap;
    })();
    const norm = (v) => String(v).replace(/\s/g, "").toUpperCase();

    const matchesDisplay = (o, idx, exactOnly) => {
        if (type === "hybridization") return hybridizationMatches(o, display);
        if (type === "molecule") return norm(o) === norm(display);
        if (type === "text") {
            return String(o).trim().toLowerCase() === display.trim().toLowerCase();
        }
        if (norm(o) === norm(display)) return true;
        if (exactOnly) return false;
        const on = optionNumbers[idx];
        const dn = parseNumber(display);
        if (!Number.isFinite(on) || !Number.isFinite(dn)) {
            return String(o).trim() === display;
        }
        const tol = Math.min(
            Math.max(Math.abs(dn) * 0.005, 1e-9),
            Number.isFinite(smallestOptionGap) ? smallestOptionGap / 2 : Infinity
        );
        return Math.abs(on - dn) <= tol;
    };

    let correctIndex = options.findIndex((o, i) => matchesDisplay(o, i, true));
    if (correctIndex < 0) {
        correctIndex = options.findIndex((o, i) => matchesDisplay(o, i, false));
    }

    if (correctIndex < 0) {
        throw new Error(`Skeleton ${index + 1}: correct answer not among built options`);
    }

    const builtForVerify = {
        questionText: stem,
        options,
        correctIndex,
    };
    if (!solverTruth) {
        const postVerify = independentlyVerifyQuestion(builtForVerify);
        if (
            postVerify.verified === false &&
            Number.isFinite(postVerify.matchedOptionIndex) &&
            postVerify.matchedOptionIndex >= 0
        ) {
            correctIndex = postVerify.matchedOptionIndex;
        } else if (postVerify.verified === false && postVerify.expected?.value != null) {
            options = buildOptionsAroundExpected(postVerify.expected, options);
            correctIndex = findOptionIndexForNumericValue(
                options,
                postVerify.expected.value
            );
            if (correctIndex < 0) correctIndex = 0;
            fa = {
                ...fa,
                display: postVerify.expected.display,
                value: postVerify.expected.value,
                unit: postVerify.expected.unit || fa.unit,
            };
        } else if (postVerify.verified === false) {
            throw new Error(
                postVerify.issue ||
                    `Skeleton ${index + 1}: independent verification failed`
            );
        }
    }

    if (isPhStem(stem)) {
        options = sanitizePhOptions(options, correctIndex);
    }
    options = sanitizeDistractorQuality(stem, options, correctIndex, unit);

    // Models (esp. flash-lite) often derive the right number then mark a distractor
    // or invent a fudge to force-fit option A. Rematch / rebuild options around the
    // derivation BEFORE any consistency check — even under solverTruth, so Stage A
    // provisional keys are far less wrong before the independent solver runs.
    // This is NOT "force-align Therefore to wrong key"; we trust the derivation math.
    let realigned = null;
    realigned = realignOptionsToDerivation({
        _solveSteps: solveSteps,
        options,
        correctIndex,
        unit,
        distractorValues,
    });
    if (realigned) {
        options = realigned.options;
        correctIndex = realigned.correctIndex;
        pipelineTrace("SKELETON_KEY_REALIGNED_TO_DERIVATION", {
            index: index + 1,
            mode: realigned.realigned,
            computed: realigned.candidate?.display,
            marked: options[correctIndex],
            provisional: !!solverTruth,
        });
        if (isPhStem(stem)) {
            options = sanitizePhOptions(options, correctIndex);
        }
        options = sanitizeDistractorQuality(stem, options, correctIndex, unit);
    }

    const markedOption = options[correctIndex];
    const correctLetter = String.fromCharCode(65 + correctIndex);

    if (solverTruth) {
        // Soft consistency check on generator derivation vs marked key.
        // Failures reject the skeleton so the slot can regenerate instead of
        // shipping a self-contradictory provisional answer into Stage A output.
        try {
            assertSolveStepsConsistency({
                _solveSteps: solveSteps,
                options,
                correctIndex,
            });
        } catch (err) {
            throw new Error(
                `Skeleton ${index + 1}: generator derivation disagrees with marked key — ${err?.message || err}`
            );
        }
        return {
            questionType: "single",
            questionText: stem,
            options,
            correctIndex,
            correctAnswer: correctLetter,
            multipleCorrectIndexes: [],
            // Placeholder until Stage A answer-lock / full finalize runs.
            explanation: `Pending independent verification. FINAL_ANSWER: ${correctLetter}`,
            difficulty: tier,
            _solveSteps: [],
            _generatorSolveSteps: solveSteps,
            _answerProvisional: true,
            _conceptSlot:
                String(assignedConceptSlot || skeleton.conceptSlot || "").trim() ||
                undefined,
            _questionKind: skeleton.questionKind || undefined,
            ...(realigned
                ? { _keyRealignedFromDerivation: realigned.realigned }
                : {}),
        };
    }

    // Verify the model's OWN derivation against the marked option BEFORE any alignment.
    // syncSolveStepsToMarkedAnswer / lockExplanationToMarkedOption staple
    // "Therefore, the correct answer is <marked>" onto the steps; running the consistency
    // check after that makes it validate a conclusion this code just manufactured, so a
    // wrong key (derivation concludes 44 W, key says 8 W) always passed. Check raw first.
    assertSolveStepsConsistency({ _solveSteps: solveSteps, options, correctIndex });

    const alignedSteps = syncSolveStepsToMarkedAnswer(solveSteps, markedOption).map(
        (s, i, arr) =>
            i === arr.length - 1
                ? `${String(s || "").replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim()} FINAL_ANSWER: ${correctLetter}`
                : s
    );
    // Build the explanation from the RAW steps — lockExplanationToMarkedOption appends the
    // closing + FINAL_ANSWER itself.
    const explanation = lockExplanationToMarkedOption(solveSteps, markedOption, {
        correctLetter,
    });

    const built = {
        questionType: "single",
        questionText: stem,
        options,
        correctIndex,
        correctAnswer: correctLetter,
        multipleCorrectIndexes: [],
        explanation,
        difficulty: tier,
        _solveSteps: alignedSteps,
        _conceptSlot:
            String(assignedConceptSlot || skeleton.conceptSlot || "").trim() ||
            undefined,
        _questionKind: skeleton.questionKind || undefined,
        ...(realigned
            ? { _keyRealignedFromDerivation: realigned.realigned }
            : {}),
    };

    /** Rematch only when the auditor names a concrete wrong-key conflict. */
    const rematchFromCorrectnessError = (errMsg) => {
        const m = String(errMsg || "").match(
            /matching option ([A-D]).*marked answer ([A-D])/i
        );
        if (!m) {
            const m2 = String(errMsg || "").match(
                /(?:computes|derives|concludes)\s+(-?\d+(?:\.\d+)?).*(?:marked (?:answer|option) is|[—-] wrong option marked)/i
            );
            if (!m2) return false;
            const derivedVal = Number(m2[1]);
            if (!Number.isFinite(derivedVal)) return false;
            const nums = built.options.map((o) => parseNumber(o));
            const dTol = answerMatchTolerance(derivedVal, nums);
            const idx = nums.findIndex(
                (n) => Number.isFinite(n) && Math.abs(n - derivedVal) <= dTol
            );
            if (idx < 0 || idx === built.correctIndex) return false;
            const rematchedLetter = String.fromCharCode(65 + idx);
            const rematchedMarked = built.options[idx];
            built.correctIndex = idx;
            built.correctAnswer = rematchedLetter;
            built.explanation = lockExplanationToMarkedOption(
                solveSteps,
                rematchedMarked,
                { correctLetter: rematchedLetter }
            );
            built._solveSteps = syncSolveStepsToMarkedAnswer(
                solveSteps,
                rematchedMarked
            ).map((s, i, arr) =>
                i === arr.length - 1
                    ? `${String(s || "").replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim()} FINAL_ANSWER: ${rematchedLetter}`
                    : s
            );
            built._keyRealignedFromDerivation = "correctness_error_rematch";
            pipelineTrace("SKELETON_KEY_REALIGNED_FROM_EXPLANATION", {
                index: index + 1,
                derived: derivedVal,
                marked: rematchedMarked,
            });
            return true;
        }
        const wantIdx = m[1].toUpperCase().charCodeAt(0) - 65;
        if (wantIdx < 0 || wantIdx >= built.options.length) return false;
        if (wantIdx === built.correctIndex) return false;
        const rematchedLetter = String.fromCharCode(65 + wantIdx);
        const rematchedMarked = built.options[wantIdx];
        built.correctIndex = wantIdx;
        built.correctAnswer = rematchedLetter;
        built.explanation = lockExplanationToMarkedOption(solveSteps, rematchedMarked, {
            correctLetter: rematchedLetter,
        });
        built._solveSteps = syncSolveStepsToMarkedAnswer(
            solveSteps,
            rematchedMarked
        ).map((s, i, arr) =>
            i === arr.length - 1
                ? `${String(s || "").replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim()} FINAL_ANSWER: ${rematchedLetter}`
                : s
        );
        built._keyRealignedFromDerivation = "correctness_option_letter_rematch";
        pipelineTrace("SKELETON_KEY_REALIGNED_FROM_EXPLANATION", {
            index: index + 1,
            from: m[2],
            to: m[1],
            marked: rematchedMarked,
        });
        return true;
    };

    try {
        assertBuiltMcqConsistency(built);
        assertGenerationCorrectness(built, index + 1);
    } catch (err) {
        if (rematchFromCorrectnessError(err?.message)) {
            assertBuiltMcqConsistency(built);
            assertGenerationCorrectness(built, index + 1);
        } else {
            throw err;
        }
    }

    return built;
};

export const sanitizeQuestionStemEmbeddedOptions = (q) => {
    if (!q?.questionText || !Array.isArray(q.options) || !q.options.length) {
        return q;
    }
    const markedIdx = Number.isFinite(q.correctIndex)
        ? q.correctIndex
        : String(q.correctAnswer || "").match(/^([A-D])/i)?.[1]
          ? String(q.correctAnswer).match(/^([A-D])/i)[1].toUpperCase().charCodeAt(0) - 65
          : 0;
    const options = sanitizeDistractorQuality(
        q.questionText,
        q.options,
        markedIdx
    );
    return { ...q, options };
};

/**
 * VALIDATION 1: Solve step chain validation
 * Ensures steps are logically connected and derive valid intermediate values
 */
const validateSolveStepChain = (solveSteps = []) => {
    if (!Array.isArray(solveSteps) || solveSteps.length === 0) {
        throw new Error("No solve steps provided");
    }

    // Check for degenerate steps (empty, only punctuation, too short)
    const validSteps = solveSteps.filter(s => {
        const text = String(s || "").trim();
        return /[A-Za-z0-9]{3,}/.test(text); // At least 3 alphanumeric chars
    });

    if (validSteps.length < 2) {
        throw new Error(
            `Insufficient solve steps: need at least 2 meaningful steps (found ${validSteps.length})`
        );
    }

    // Check for common reasoning gaps (steps that jump without intermediate)
    const stepText = validSteps.join(" ");
    const hasMultiplication = /[\*×]/.test(stepText);
    const hasDivision = /[\/÷]/.test(stepText);
    const hasAddSub = /[+-]/.test(stepText);

    if (hasMultiplication && hasAddSub) {
        // Check that steps don't contradict (e.g., "times 2" then "plus 2" making no sense)
        const conflicts = [
            /times\s+[+-]\d+/i, // "times plus" back-to-back
            /divide\s+[×x]\d+/i, // "divide times" back-to-back
        ];
        const hasConflict = conflicts.some(re => re.test(stepText));
        if (hasConflict) {
            throw new Error("Solve steps contain contradictory operations (e.g., 'times' then 'plus' without intermediate result)");
        }
    }

    return validSteps;
};

/**
 * VALIDATION 2: Stem quality validation
 * Checks for ambiguity, completeness, and formatting issues
 */
const validateStemQuality = (stem) => {
    const text = String(stem || "").trim();

    if (!text || text.length < 20) {
        throw new Error(
            `Stem too short or empty (${text.length} chars) — likely incomplete`
        );
    }

    // NOTE: no "must contain numeric values" check here. That requirement was STEM-
    // presumptuous ("most physics/chemistry problems need values") and false for a wide
    // swath of legitimate content: theory/assertion-reason questions (which explicitly
    // have NO numeric givens by design — see PART N question-kind taxonomy), vocabulary
    // questions, and virtually all CAT VARC content (critical reasoning, para-jumbles,
    // odd-one-out) — confirmed live: this check alone was responsible for the dominant
    // rejection category in a CAT VARC run, driving several batches to a 0% pass rate.

    // Check for extreme/unrealistic values
    const largeNumbers = text.match(/\d{10,}/g) || [];
    if (largeNumbers.length > 2) {
        // Some problems might have very large numbers, but suspicious if many
        console.warn(`Stem has unusually large numbers: ${largeNumbers.join(", ")}`);
    }

    // Is this actually a prompt (question or instruction), not a truncated fragment?
    // A literal "?" requirement rejected legitimate imperative CAT VARC stems ("Arrange
    // the following sentences...", "Identify the sentence that does not belong.") that
    // end in a period rather than a question mark. Requiring terminal punctuation of
    // any normal kind still catches genuinely truncated stems (which trail off with no
    // ending punctuation at all) without presuming a single phrasing style.
    if (!/[?.:]\s*$/.test(text)) {
        throw new Error(
            "Stem has no terminal punctuation — looks truncated/incomplete"
        );
    }

    // Check for common typos/errors (double spaces, strange symbols)
    if (/\s{2,}/.test(text)) {
        throw new Error("Stem has excessive whitespace (likely formatting error)");
    }

    return text;
};

/**
 * VALIDATION 3: Distractor spacing and quality
 * Ensures distractors are distinct, plausible, and spread appropriately
 */
const validateDistractorQuality = (answerValue, answerUnit, distractors = []) => {
    const answerNum = Number.isFinite(answerValue) ? answerValue : null;

    if (!distractors || distractors.length === 0) {
        throw new Error("No distractors provided");
    }

    if (distractors.length < 3) {
        throw new Error(
            `Need 3+ distractors (found ${distractors.length})`
        );
    }

    const distractorNums = distractors.map(d => parseNumber(d)).filter(n => Number.isFinite(n));

    // If answer is numeric, check spacing
    if (answerNum !== null && distractorNums.length >= 2) {
        const allNums = [answerNum, ...distractorNums];
        const sorted = [...allNums].sort((a, b) => a - b);

        // Check if answer is sandwiched between two distractors (ambiguous)
        const answerIdx = sorted.indexOf(answerNum);
        if (answerIdx > 0 && answerIdx < sorted.length - 1) {
            const before = sorted[answerIdx - 1];
            const after = sorted[answerIdx + 1];
            const gapBefore = Math.abs(answerNum - before);
            const gapAfter = Math.abs(after - answerNum);

            // If gaps are very small, hard to distinguish
            if (gapBefore < Math.abs(answerNum) * 0.01 || gapAfter < Math.abs(answerNum) * 0.01) {
                throw new Error(
                    `Answer (${answerNum}) is too close to adjacent distractors (${before}, ${after}) — ambiguous`
                );
            }
        }

        // Check if answer is suspiciously far from all distractors (obvious correct answer)
        const minGapToDistractor = Math.min(...distractorNums.map(d => Math.abs(d - answerNum)));
        const maxGapToDistractor = Math.max(...distractorNums.map(d => Math.abs(d - answerNum)));
        if (minGapToDistractor > maxGapToDistractor * 0.5 && minGapToDistractor > Math.abs(answerNum) * 0.1) {
            // Answer is very far from all distractors — students can guess by magnitude
            console.warn(`Answer (${answerNum}) is far from all distractors — might be too obvious`);
        }
    }

    // Check for duplicate distractors
    const uniqueNums = new Set(distractorNums);
    if (uniqueNums.size < distractorNums.length) {
        throw new Error(
            "Duplicate numeric values in distractors — two options are identical"
        );
    }

    // Check for implausible values (negative when answer is positive, or vice versa)
    if (answerNum !== null) {
        const answerSign = Math.sign(answerNum);
        const wrongSignDistr = distractorNums.filter(d => {
            const distrSign = Math.sign(d);
            // Allow 0 to have either sign, but not if answer is clearly positive/negative
            if (d === 0 || answerNum === 0) return false;
            return distrSign !== answerSign;
        });

        // It's OK to have some wrong-sign distractors, but not all or most
        if (wrongSignDistr.length === distractorNums.length) {
            throw new Error(
                `All distractors have opposite sign from answer (${answerNum}) — sign giveaway`
            );
        }
    }

    return distractors;
};

/** Superscript digit/minus → ASCII, shared by the log/antilog exponent scanners below. */
const SUPERSCRIPT_MAP = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','−':'-' };

/** Finds every "10^N" / "10¹⁸" occurrence in `text`, in reading order. */
const findExponentsIn = (text) => {
    const s = String(text || "");
    const results = [];
    const supRe = /10\s*([⁻−]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g;
    let m;
    while ((m = supRe.exec(s))) {
        const converted = m[1].replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻−]/g, ch => SUPERSCRIPT_MAP[ch]);
        results.push({ index: m.index, exp: parseFloat(converted) });
    }
    const caretRe = /10\s*\^\s*(-?\d+(?:\.\d+)?)/g;
    while ((m = caretRe.exec(s))) results.push({ index: m.index, exp: parseFloat(m[1]) });
    results.sort((a, b) => a.index - b.index);
    return results;
};

/**
 * Finds the LAST "log10(X) = A/B ≈ C" or "ln(X) = C" clause in the text and returns
 * its resolved value as a log10 exponent (natural-log values are converted via /ln(10)).
 * Only the LAST clause matters — LLMs often write an intermediate fragment first
 * ("log(K) = A/B, which simplifies to log(K) = ... = C") and only the final restatement
 * is the value that should carry into the antilog step.
 */
const findLastLogClause = (text) => {
    const s = String(text || "");
    const clauseRe = /\b(log(?:10)?|ln)\s*\(?[A-Za-z0-9_]*\)?\s*[≈=]\s*([\d\s\/\*.\-≈=()]+)/gi;
    let last = null, m;
    while ((m = clauseRe.exec(s))) {
        const kind = m[1].toLowerCase().startsWith("ln") ? "ln" : "log10";
        const nums = [...m[2].matchAll(/(-?\d+(?:\.\d+)?)/g)].map(x => parseFloat(x[1]));
        if (!nums.length) continue;
        const val = nums[nums.length - 1];
        const exp = kind === "ln" ? val / Math.LN10 : val;
        last = { endIndex: m.index + m[0].length, exp, kind };
    }
    return last;
};

/**
 * Catches antilog exponent slips: a derivation computes log10(K) ≈ 37.18 but the
 * stated final answer is 10¹⁸ instead of 10³⁷ (a ~19-order-of-magnitude error LLMs
 * are prone to when converting a log value back to a power of ten). None of the
 * other consistency checks catch this — they verify the marked option matches the
 * text's OWN stated conclusion, and here the text's conclusion is self-consistently
 * wrong (states 10¹⁸ and then also uses 10¹⁸ as "the answer").
 *
 * Deliberately scoped to the window immediately AFTER the log clause (not the whole
 * derivation) — an unscoped search cross-referenced unrelated "10^N" values that were
 * just given data elsewhere in the same explanation (e.g. a Ka value quoted earlier),
 * producing false positives. Only the last log/ln clause is checked, for the same
 * reason: an earlier, not-yet-simplified fragment is not the value that carries into
 * the antilog. This is a heuristic, not a symbolic solver — it only fires when a
 * log/antilog CHAIN is written out; it has no opinion on derivations that don't do a
 * base-10 exponent conversion at all.
 */
const validateLogAntilogConsistency = (solveSteps = [], finalAnswerDisplay = "") => {
    const text = [...(solveSteps || []).map(String), String(finalAnswerDisplay || "")].join(" ");
    const clause = findLastLogClause(text);
    if (!clause) return; // no log/ln arithmetic — nothing to check

    const WINDOW_CHARS = 200;
    const TOLERANCE = 1.5; // orders of magnitude; absorbs normal antilog rounding
    const window = text.slice(clause.endIndex, clause.endIndex + WINDOW_CHARS);
    const exponents = findExponentsIn(window);
    if (!exponents.length) return; // no antilog conclusion nearby — nothing to cross-check

    const stated = exponents[exponents.length - 1].exp;
    const diff = Math.abs(stated - clause.exp);
    if (diff > TOLERANCE) {
        throw new Error(
            `Log/antilog mismatch: derivation computes ${clause.kind === "ln" ? "ln" : "log10"}-based exponent ≈${clause.exp.toFixed(2)} but the stated answer uses 10^${stated} — likely an antilog conversion error (off by ~${diff.toFixed(1)} orders of magnitude)`
        );
    }
};

/**
 * Finds the LAST "exp(X) = Y" or "e^X = Y" occurrence and returns its exponent X
 * plus the byte offset right after the match — mirrors findLastLogClause's "last
 * occurrence only" rationale (an earlier, unrelated exp() elsewhere in the same
 * derivation should not be cross-checked against a later, unrelated claimed value).
 */
const findLastExpClaim = (text) => {
    const s = String(text || "");
    const re = /\bexp\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)|\be\s*\^\s*(-?\d+(?:\.\d+)?)/gi;
    let m, last = null;
    while ((m = re.exec(s))) last = m;
    if (!last) return null;
    const exponent = parseFloat(last[1] ?? last[2]);
    if (!Number.isFinite(exponent)) return null;
    return { endIndex: last.index + last[0].length, exponent };
};

/**
 * Catches exp()/e^ arithmetic slips: a derivation writes "exp(12.028) ≈ 1.67×10⁸"
 * when exp(12.028) is actually ≈1.67×10⁵ (a live example — off by exactly 3 orders
 * of magnitude, the same failure family as validateLogAntilogConsistency but via a
 * direct exponential rather than a log-then-antilog chain, so the log/ln-anchored
 * check above never sees it).
 *
 * Unlike the log/antilog check, this one converts directly: expected log10(exp(X))
 * = X / ln(10), compared against log10 of whatever numeric value follows exp(X) in
 * the text (scanned in a bounded window, same false-positive rationale as above —
 * grep-matching "10^N" across the WHOLE derivation cross-referenced unrelated given
 * data during testing).
 */
const validateExpConsistency = (solveSteps = [], finalAnswerDisplay = "") => {
    const text = [...(solveSteps || []).map(String), String(finalAnswerDisplay || "")].join(" ");
    const claim = findLastExpClaim(text);
    if (!claim) return; // no exp()/e^ arithmetic — nothing to check

    const WINDOW_CHARS = 120;
    const TOLERANCE = 1.0; // orders of magnitude
    const window = text
        .slice(claim.endIndex, claim.endIndex + WINDOW_CHARS)
        .replace(/(\d),(\d)/g, "$1$2"); // "167,430" -> "167430" so it isn't truncated at the comma

    const valueToken = window.match(
        /\d+(?:\.\d+)?(?:\s*[×x]\s*10\s*\^?\s*[⁻−\-]?[⁰¹²³⁴⁵⁶⁷⁸⁹\d]+)?/
    );
    if (!valueToken) return; // no claimed value nearby — nothing to cross-check

    const claimedValue = parseNumber(valueToken[0]);
    if (!Number.isFinite(claimedValue) || claimedValue <= 0) return;

    const expectedLog10 = claim.exponent / Math.LN10;
    const actualLog10 = Math.log10(claimedValue);
    const diff = Math.abs(expectedLog10 - actualLog10);
    if (diff > TOLERANCE) {
        throw new Error(
            `exp() arithmetic mismatch: exp(${claim.exponent}) should be ≈10^${expectedLog10.toFixed(2)} but the derivation states ${valueToken[0].trim()} (≈10^${actualLog10.toFixed(2)}) — off by ~${diff.toFixed(1)} orders of magnitude`
        );
    }
};

/**
 * VALIDATION 5: Better answer matching
 * Finds the best matching option for computed answer with proper tolerance
 */
const findBestMatchingOption = (computedValue, options = [], tolerance = null) => {
    if (!Number.isFinite(computedValue) || !options.length) {
        return null;
    }

    const optionNums = options.map(o => ({ val: parseNumber(o), orig: o }));
    const validOptions = optionNums.filter(o => Number.isFinite(o.val));

    if (!validOptions.length) return null;

    // Exact match first (within machine epsilon for floating point)
    const exactMatch = validOptions.find(o => Math.abs(o.val - computedValue) < 1e-10);
    if (exactMatch) {
        return { index: options.indexOf(exactMatch.orig), option: exactMatch.orig, distance: 0 };
    }

    // Calculate smart tolerance based on option spacing
    let smartTol = tolerance ?? answerMatchTolerance(computedValue, validOptions.map(o => o.val));

    // Find closest option within tolerance
    const candidates = validOptions
        .map((o, idx) => ({
            index: options.indexOf(o.orig),
            option: o.orig,
            distance: Math.abs(o.val - computedValue),
        }))
        .filter(c => c.distance <= smartTol)
        .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
        // No match within tolerance — return closest with warning
        const closest = validOptions
            .map((o, idx) => ({
                index: options.indexOf(o.orig),
                option: o.orig,
                distance: Math.abs(o.val - computedValue),
            }))
            .sort((a, b) => a.distance - b.distance)[0];
        return { ...closest, outOfTolerance: true };
    }

    // If two options are equidistant, that's ambiguous
    if (candidates.length >= 2 && Math.abs(candidates[0].distance - candidates[1].distance) < 1e-10) {
        throw new Error(
            `Computed value (${computedValue}) is equidistant from options "${candidates[0].option}" and "${candidates[1].option}" — ambiguous`
        );
    }

    return candidates[0];
};

/**
 * Runs all 6 pre-MCQ validation layers against a skeleton. Throws on the first
 * failure with a descriptive message. MUST be called on every skeleton before
 * buildAndPush() — including skeletons coming back from the repair LLM, which
 * are just as likely (empirically MORE likely) to still be broken.
 */
const runSkeletonValidationGates = (sk) => {
    // VALIDATION 1: Stem quality
    validateStemQuality(sk.stem);

    // VALIDATION 2: Solve step chain
    // (No separate "explanation completeness" gate here: neither the initial skeleton
    // prompt nor the repair prompt ever asks for an `explanation` field — only stem/
    // finalAnswer/solveSteps/distractorValues. buildMcqFromSkeleton() synthesizes the
    // real explanation from solveSteps via lockExplanationToMarkedOption(). Checking
    // sk.explanation pre-build was checking a field that is always empty by design,
    // which rejected 100% of skeletons — confirmed live: a real chemistry generation
    // run produced 0/5 questions in a chunk, every one killed by "Explanation is
    // empty". Solve-step adequacy (checked above) is the correct pre-build proxy.
    validateSolveStepChain(sk.solveSteps);

    // VALIDATION 4: Distractor quality
    // Gated on isStrictNumericAnswer(), not Number.isFinite(parseNumber(display)):
    // parseNumber() is permissive (extracts a stray digit from anywhere in a string),
    // so a CAT VARC critical-reasoning conclusion that happens to mention a percentage
    // or a year would parse to a "finite" number and incorrectly run the numeric-only
    // distractor-spacing/sign/duplicate checks below against sentence-length options —
    // confirmed live, this was firing on real CAT VARC content.
    const fa = sk.finalAnswer || {};
    const display = String(fa.display ?? fa.value ?? "").trim();
    const unit = String(fa.unit || "").trim();
    const answerIsNumeric = isStrictNumericAnswer(display);
    const computed = answerIsNumeric ? parseNumber(display) : NaN;
    if (answerIsNumeric) {
        validateDistractorQuality(computed, unit, sk.distractorValues || []);
    }

    // VALIDATION 5: Answer-option coherence (unit consistency across all options)
    validateSkeletonAnswerCoherence(sk);

    // VALIDATION 6: Computed answer must match an option (no silent divergence)
    if (answerIsNumeric && (sk.distractorValues || []).length > 0) {
        const allOptions = [display, ...(sk.distractorValues || [])];
        const match = findBestMatchingOption(computed, allOptions);
        if (!match || match.outOfTolerance) {
            throw new Error(
                `Computed answer (${display}) does not match any option within tolerance`
            );
        }
    }

    // VALIDATION 7: Log/antilog exponent consistency (e.g. log10(K)≈37.18 but the
    // stated answer uses 10¹⁸ instead of 10³⁷). See validateLogAntilogConsistency
    // for why this is scoped to a text window and the LAST log clause only.
    validateLogAntilogConsistency(sk.solveSteps, display);

    // VALIDATION 8: exp()/e^ arithmetic consistency — same failure family as #7 but
    // via a direct exponential (e.g. Arrhenius A_cat/A_uncat derivations) rather than
    // a log-then-antilog chain, so #7 never sees it.
    validateExpConsistency(sk.solveSteps, display);
};

/**
 * True only if the WHOLE string is essentially a number (+ optional short unit),
 * not merely text that happens to contain a digit somewhere. Deliberately stricter
 * than parseNumber(), which extracts a number from anywhere in a string — so
 * parseNumber("The 150 new corporate entities...") = 150, which would misclassify
 * a CAT VARC critical-reasoning conclusion (a full sentence) as a numeric answer.
 * Handles scientific notation (both "× 10^N" caret and "× 10¹⁸" superscript forms)
 * so STEM answers like "4.17 × 10^52" or "0.529 Å" still classify as numeric.
 */
const isStrictNumericAnswer = (text) => {
    const s = String(text || "").trim();
    if (!s) return false;
    return /^-?\d+(?:\.\d+)?(?:\s*[×x]\s*10\s*\^?\s*[⁻−\-]?[⁰¹²³⁴⁵⁶⁷⁸⁹\d]+)?\s*[%°]?[a-zA-ZμΩÅ°\/·⁻¹²³₀-₉\-]{0,15}$/.test(
        s
    );
};

/**
 * Pre-MCQ validation: rejects skeletons where the computed answer and option values
 * are fundamentally incoherent (unit mismatches, computed value absent, etc).
 * Fails fast before wasting time building MCQ with bad data.
 */
const validateSkeletonAnswerCoherence = (skeleton) => {
    const fa = skeleton.finalAnswer || {};
    const display = String(fa.display ?? fa.value ?? "").trim();
    const unit = String(fa.unit || "").trim();
    const distractorValues = skeleton.distractorValues || [];

    if (!display) {
        throw new Error("Missing finalAnswer.display or finalAnswer.value");
    }

    // parseNumber() is deliberately PERMISSIVE — it extracts a stray digit from
    // anywhere in a string, so parseNumber("The 150 new corporate entities...") = 150.
    // Classifying "is this answer numeric" via Number.isFinite(parseNumber(display))
    // therefore misclassifies full-sentence text answers (CAT VARC critical-reasoning
    // conclusions, para-jumble permutations, odd-one-out sentence picks) as numeric
    // whenever they happen to mention a number anywhere — which is most of them. That
    // false classification then ran the numeric-only unit/type-consistency checks
    // below against sentence-length "distractors", rejecting ~100% of a CAT VARC batch
    // ("Answer is non-numeric (long sentence) but has numeric distractors" and
    // "Inconsistent units across options" firing on text). isStrictNumericAnswer()
    // requires the WHOLE string to basically BE a number (+ optional short unit), not
    // merely contain one — the same fix already applied for this exact trap elsewhere
    // (see the isNumericAnswer comment in questionNumericVerify.service.js).
    if (!isStrictNumericAnswer(display)) {
        return; // Text answers: no numeric/unit consistency checks apply.
    }
    const computed = parseNumber(display);

    // Numeric answer: all options must have matching unit structure
    const extractUnit = (text) => {
        const s = String(text || "").trim();
        const m = s.match(/\s+([a-zA-Z°\/·\-·^₀-₉]+.*?)$/);
        return m ? m[1].trim() : "";
    };

    const computedUnit = extractUnit(display);
    const unitMismatch = distractorValues.some(d => {
        const dUnit = extractUnit(d);
        // Both have units: units must match
        if (computedUnit && dUnit && computedUnit !== dUnit) return true;
        // One has unit, other doesn't
        if ((computedUnit && !dUnit) || (!computedUnit && dUnit)) return true;
        return false;
    });

    if (unitMismatch) {
        throw new Error(
            `Inconsistent units across options: answer "${display}" but distractors include different unit structures`
        );
    }

    // Verify that at least one distractor has a different numeric value
    const distractorNumerics = distractorValues.map(d => parseNumber(d));
    const anyDifferent = distractorNumerics.some(n =>
        Number.isFinite(n) && Math.abs(n - computed) > 1e-10
    );
    if (!anyDifferent && distractorValues.length > 0) {
        throw new Error(
            `All distractors are numerically identical to the answer — impossible to distinguish correct option`
        );
    }
};

export const skeletonsToQuestions = async (
    skeletons,
    tierSlots = [],
    conceptSlots = [],
    batchOpts = {},
    repairDeps = null
) => {
    const {
        batchSeenStems = [],
        examCalibrated = false,
        publishPartials = true,
    } = batchOpts;
    const veteran = isVeteranDifficultyEnabled() && examCalibrated;
    const callRepairLlm = repairDeps?.callLlm;
    const examProfile = repairDeps?.examProfile || "jee_main";
    const subject = repairDeps?.subject || "";
    const repairTopic = repairDeps?.topic || "";
    const repairBankName = repairDeps?.bankName || "";
    const kindBySlot = repairDeps?.kindBySlot || {};
    const kindForSlot = (slot) =>
        kindBySlot[String(slot || "").trim()] || "calculative";
    const repairOnFail =
        repairDeps?.repairOnFail !== false && isMandateRepairEnabled();
    const questions = [];
    const repairQueue = [];

    const publishReady = (items, phase) => {
        if (!publishPartials || !items.length) return;
        publishPartialQuestions(items, { phase });
    };

    const buildAndPush = (skeleton, index, assignedTier, assignedSlot) => {
        const built = buildMcqFromSkeleton(
            skeleton,
            index,
            assignedTier,
            assignedSlot
        );
        questions.push(built);
        if (veteran) {
            registerBatchStem(built.questionText, batchSeenStems);
        }
        return built;
    };

    // Track failure reasons for analytics
    const failureCategories = {
        stemQuality: 0,
        solveSteps: 0,
        explanation: 0,
        distractors: 0,
        answerCoherence: 0,
        answerMatching: 0,
        mathConsistency: 0,
        hardMandate: 0,
        buildError: 0,
        other: 0,
    };

    const categorizeError = (message) => {
        if (/log\/antilog|antilog|exp\(\).*mismatch|orders of magnitude/i.test(message)) return "mathConsistency";
        if (/stem/i.test(message)) return "stemQuality";
        if (/solve step/i.test(message)) return "solveSteps";
        if (/explanation/i.test(message)) return "explanation";
        if (/distractor/i.test(message)) return "distractors";
        if (/unit|option|answer.*value/i.test(message)) return "answerCoherence";
        if (/computed.*answer|matching|ambiguous/i.test(message)) return "answerMatching";
        if (/hard question|mandate|concept/i.test(message)) return "hardMandate";
        return "other";
    };

    for (let i = 0; i < skeletons.length; i++) {
        const sk = skeletons[i];
        const assignedTier = tierSlots[i] || sk.difficultyTier || "medium";
        const assignedSlot = String(conceptSlots[i] || sk.conceptSlot || "").trim();
        // Tag the skeleton with its planned kind so the hard gate and the built MCQ
        // both know whether numeric-depth checks apply (calculative) or not (theory).
        if (!sk.questionKind) sk.questionKind = kindForSlot(assignedSlot);
        const stemPreview = String(sk.stem || "").trim();

        if (
            veteran &&
            isBatchStemNearDuplicate(stemPreview, batchSeenStems, { veteran: true })
        ) {
            repairQueue.push({
                sk,
                i,
                assignedTier,
                assignedSlot,
                mandateIssues: [
                    "Near-duplicate stem in batch — rewrite with a different problem structure and setup.",
                ],
            });
            continue;
        }
        if (
            assignedSlot &&
            sk.conceptSlot &&
            String(sk.conceptSlot).trim() !== assignedSlot
        ) {
            repairQueue.push({
                sk: { ...sk, conceptSlot: assignedSlot },
                i,
                assignedTier,
                assignedSlot,
                mandateIssues: [
                    `conceptSlot must be "${assignedSlot}" (was "${sk.conceptSlot}").`,
                ],
            });
            continue;
        }
        const verification = verifySkeletonAnswer(sk);
        if (!verification.ok) {
            repairQueue.push({
                sk,
                i,
                assignedTier,
                assignedSlot,
                buildError: verification.reason,
            });
            continue;
        }
        const mandate = validateHardSkeletonMandate(sk, assignedTier, {
            examCalibrated: examCalibrated || assignedTier === "hard",
            examProfile,
            subject,
        });
        if (!mandate.ok) {
            repairQueue.push({
                sk,
                i,
                assignedTier,
                assignedSlot,
                mandateIssues: mandate.issues,
            });
            continue;
        }

        // Comprehensive pre-MCQ validation
        try {
            runSkeletonValidationGates(sk);
        } catch (err) {
            const category = categorizeError(err.message);
            failureCategories[category]++;
            repairQueue.push({
                sk,
                i,
                assignedTier,
                assignedSlot,
                buildError: err.message,
                category,
            });
            continue;
        }

        try {
            buildAndPush(sk, i, assignedTier, assignedSlot);
        } catch (err) {
            const category = categorizeError(err.message);
            failureCategories[category]++;
            repairQueue.push({
                sk,
                i,
                assignedTier,
                assignedSlot,
                buildError: err.message,
                category,
            });
        }
    }

    if (questions.length) {
        publishReady(questions, "initial_pass");
    }

    if (repairQueue.length && repairOnFail && typeof callRepairLlm === "function") {
        // Unbounded repair (one LLM call per failed skeleton) can blow up
        // worst-case latency on a bad batch. Cap it per attempt — anything
        // beyond the cap is deferred (traced, not silently dropped) so the
        // caller's own retry loop regenerates the deficit instead of paying
        // for a long tail of repair calls in a single attempt.
        const itemsToRepair = repairQueue.slice(0, MAX_SKELETON_REPAIR_CALLS_PER_BATCH);
        const deferredItems = repairQueue.slice(MAX_SKELETON_REPAIR_CALLS_PER_BATCH);
        pipelineTrace("SKELETON_REPAIR_BATCH", {
            count: itemsToRepair.length,
            deferred: deferredItems.length,
        });
        for (const item of deferredItems) {
            pipelineTrace("SKELETON_REPAIR_CAPPED", {
                index: item.i + 1,
                conceptSlot: item.assignedSlot,
                reason: (item.mandateIssues || [item.buildError])
                    .filter(Boolean)
                    .join("; "),
            });
        }
        for (const item of itemsToRepair) {
            const fixed = await repairSkeleton(
                item.sk,
                {
                    assignedConceptSlot: item.assignedSlot,
                    assignedTier: item.assignedTier,
                    examProfile,
                    examCalibrated,
                    mandateIssues: item.mandateIssues || [],
                    buildError: item.buildError || "",
                    // Without topic/subject the repair prompt had no idea what bank it was
                    // fixing and drifted off-syllabus (JEE physics inside a CAT DILR bank).
                    topic: repairTopic,
                    bankName: repairBankName,
                    subject,
                    questionKind: item.sk?.questionKind || kindForSlot(item.assignedSlot),
                },
                { callLlm: callRepairLlm }
            );
            if (!fixed) {
                pipelineTrace("SKELETON_REPAIR_GAVE_UP", {
                    index: item.i + 1,
                    conceptSlot: item.assignedSlot,
                });
                continue;
            }
            try {
                // Repaired skeletons are just as likely — empirically MORE likely — to
                // still be broken (repair LLM fixed the flagged issue but introduced or
                // left a different one, e.g. unit mismatch, duplicate distractor). Run
                // the same 6 gates the first pass ran, or a "fixed" skeleton with a
                // fabricated unit mismatch ships straight through untouched.
                runSkeletonValidationGates(fixed);
                const built = buildAndPush(
                    fixed,
                    item.i,
                    item.assignedTier,
                    item.assignedSlot
                );
                publishReady([built], "repair");
                pipelineTrace("SKELETON_REPAIR_OK", {
                    index: item.i + 1,
                    conceptSlot: item.assignedSlot,
                });
            } catch (err) {
                const category = categorizeError(err.message);
                failureCategories[category]++;
                pipelineTrace("SKELETON_REPAIR_BUILD_FAILED", {
                    index: item.i + 1,
                    error: err.message,
                    category,
                });
            }
        }
    } else if (repairQueue.length) {
        for (const item of repairQueue) {
            pipelineTrace("SKELETON_REJECTED", {
                index: item.i + 1,
                conceptSlot: item.assignedSlot,
                reason: (item.mandateIssues || [item.buildError])
                    .filter(Boolean)
                    .join("; "),
            });
        }
    }

    // Log failure category summary for analytics
    const totalFailures = Object.values(failureCategories).reduce((a, b) => a + b, 0);
    if (totalFailures > 0) {
        const categoryBreakdown = Object.entries(failureCategories)
            .filter(([_, count]) => count > 0)
            .map(([cat, count]) => `${cat}(${count})`)
            .join(", ");
        pipelineTrace("SKELETON_FAILURE_BREAKDOWN", {
            totalFailures,
            categories: categoryBreakdown,
            passRate: `${Math.round((questions.length / skeletons.length) * 100)}%`,
        });
    }

    return questions;
};

export const getSolveFirstExamProfile = (params) =>
    detectExamProfile({
        bankName: params.bankName,
        topic: params.topic,
        subject: params.subject,
        sectionName: params.sectionName,
        categoryPaths: params.categoryPaths,
    });

export const getSolveFirstSubjectId = (params) => {
    const resolved = resolveSubjectForGeneration({
        generateIntent: params.generateIntent || "initial",
        topicRelevanceFeedback: params.topicRelevanceFeedback,
        topic: params.topic,
        bankName: params.bankName,
        sectionName: params.sectionName,
        categoryPaths: params.categoryPaths,
        subject: params.subject,
    });
    return resolved.id || "";
};

/**
 * Safe pass-through for dual-verified / solver-truth-locked MCQs.
 * Never drop these for explanation-vs-key nitpicks — the answer key is already locked.
 */
const sanitizeDualVerifiedMcq = (q) => {
    const correctIndex = Number.isFinite(q.correctIndex) ? q.correctIndex : 0;
    const correctLetter = String.fromCharCode(65 + correctIndex);
    const marked = String(q.options?.[correctIndex] ?? "").trim() || correctLetter;
    const solverVal = String(
        q?._verification?.solverValue || q?.solverValue || ""
    ).trim();
    let solveSteps = Array.isArray(q._solveSteps)
        ? q._solveSteps.map(String).filter(Boolean)
        : [];
    if (!solveSteps.length && q.explanation) {
        solveSteps = inferSolveStepsFromExplanation(q.explanation);
    }
    // Strip conflicting therefore closings; re-lock to the verified option only.
    solveSteps = solveSteps
        .map(stripMetaCommentary)
        .map(stripTrailingThereforeClosing)
        .map((s) => s.replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim())
        .filter(Boolean);
    const explanation =
        solveSteps.length >= 2
            ? lockExplanationToMarkedOption(solveSteps, marked, { correctLetter })
            : `Verified result: ${
                  solverVal || marked
              }. Therefore, the correct answer is ${marked}. FINAL_ANSWER: ${correctLetter}`;
    return {
        ...q,
        correctIndex,
        correctAnswer: correctLetter,
        explanation: stripMetaCommentary(explanation),
        _solveSteps:
            solveSteps.length >= 1
                ? syncSolveStepsToMarkedAnswer(solveSteps, marked).map(
                      (s, i, arr) =>
                          i === arr.length - 1
                              ? `${String(s || "")
                                    .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
                                    .trim()} FINAL_ANSWER: ${correctLetter}`
                              : s
                  )
                : [
                      `Verified result: ${
                          solverVal || marked
                      }. FINAL_ANSWER: ${correctLetter}`,
                  ],
        _sanitizeMode: "dual_verified_safe",
    };
};

/** Rebuild explanation from solve steps and assert option consistency. */
export const sanitizeMcqForPipeline = (q) => {
    if (!q?.questionText || !Array.isArray(q.options) || !q.options.length) {
        return q;
    }
    // Dual-verified / Stage-A answer-locked: never drop — key is already trusted.
    if (
        q._answerCorrectnessGuaranteed === true ||
        q._doubleSolverAgree === true ||
        q?._verification?.doubleSolverAgree === true ||
        (q._solverTruthApplied === true && q._stageAAnswerLocked === true)
    ) {
        return sanitizeDualVerifiedMcq(q);
    }
    // Solver-truth provisional items: stem+options only until Independent Solver runs.
    // Do not rebuild explanation from generator drafts / placeholders.
    if (
        q._answerProvisional === true ||
        /^Pending independent verification\b/i.test(String(q.explanation || ""))
    ) {
        const correctIndex = Number.isFinite(q.correctIndex) ? q.correctIndex : 0;
        const correctLetter = String.fromCharCode(65 + correctIndex);
        return {
            ...q,
            correctIndex,
            correctAnswer: correctLetter,
            explanation:
                String(q.explanation || "").trim() ||
                `Pending independent verification. FINAL_ANSWER: ${correctLetter}`,
            _solveSteps: Array.isArray(q._solveSteps) ? q._solveSteps : [],
            _answerProvisional: true,
        };
    }
    let correctIndex = Number.isFinite(q.correctIndex)
        ? q.correctIndex
        : 0;
    let solveSteps = Array.isArray(q._solveSteps)
        ? [...q._solveSteps]
        : Array.isArray(q.solveSteps)
          ? [...q.solveSteps]
          : [];
    if (!solveSteps.length && q.explanation) {
        solveSteps = inferSolveStepsFromExplanation(q.explanation);
    }
    solveSteps = solveSteps
        .map(stripMetaCommentary)
        .map(stripTrailingThereforeClosing)
        .map((s) => s.replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "").trim())
        .filter(Boolean);

    // Prefer FINAL_ANSWER marker in existing solution when present.
    const fromMarker = parseFinalAnswerFromSolution(
        [...solveSteps, String(q.explanation || "")].join("\n")
    );
    if (fromMarker?.letters?.[0] && /^[A-D]$/.test(fromMarker.letters[0])) {
        const idx = fromMarker.letters[0].charCodeAt(0) - 65;
        if (idx >= 0 && idx < q.options.length) correctIndex = idx;
    }

    const marked = q.options[correctIndex];
    const correctLetter = String.fromCharCode(65 + correctIndex);
    // Reject derivation≠key BEFORE re-locking the Therefore closing onto the marked option.
    assertSolveStepsConsistency({
        _solveSteps: solveSteps,
        options: q.options,
        correctIndex,
    });
    const explanation = lockExplanationToMarkedOption(solveSteps, marked, {
        correctLetter,
    });
    const cleanedExplanation = stripMetaCommentary(explanation);
    const synced = syncSolveStepsToMarkedAnswer(solveSteps, marked);
    const last = synced.length - 1;
    if (last >= 0) {
        synced[last] = `${String(synced[last] || "")
            .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*/gi, "")
            .trim()} FINAL_ANSWER: ${correctLetter}`;
    }
    const built = {
        ...q,
        correctIndex,
        correctAnswer: correctLetter,
        explanation: cleanedExplanation,
        _solveSteps: synced,
    };
    assertBuiltMcqConsistency(built);
    assertGenerationCorrectness(built, 1);
    return built;
};

/** Sanitize singles and connected sub-questions; drops items that fail consistency. */
export const sanitizeBankQuestionForPipeline = (q) => {
    if (!q) return null;
    const type = String(q.questionType || "single").toLowerCase();
    if (type === "connected") {
        const subQuestions = (q.subQuestions || [])
            .map((sub) => {
                try {
                    return sanitizeMcqForPipeline({
                        ...sub,
                        questionType: sub.questionType || "single",
                    });
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
        if (!subQuestions.length) return null;
        return { ...q, subQuestions };
    }
    if (type === "single" || type === "multiple" || type === "true_false") {
        if (type !== "single") return q;
        try {
            return sanitizeMcqForPipeline(q);
        } catch (err) {
            pipelineTrace("SANITIZE_MCQ_DROPPED", {
                error: err?.message || String(err),
                stem: String(q.questionText || "").slice(0, 120),
            });
            return null;
        }
    }
    return q;
};
