/**
 * Phase C — Difficulty calibration dataset retrieval.
 * Retrieves easy/medium/hard exemplars from confirmed corpus for grounding.
 */

import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import { retrieveSimilarConfirmedQuestions } from "./questionCorpusRag.service.js";

const tierNorm = (d) => {
    const v = String(d || "").toLowerCase().trim();
    if (v === "easy" || v === "medium" || v === "hard") return v;
    return "";
};

/**
 * Retrieve calibration exemplars for a target difficulty.
 * Falls back to standard RAG if no difficulty-matched hits.
 */
export const retrieveDifficultyCalibration = async ({
    topic = "",
    bankName = "",
    subject = "",
    sectionName = "",
    difficulty = "hard",
    conceptHints = [],
    k = 4,
} = {}) => {
    const tier = tierNorm(difficulty) || "hard";
    const base = await retrieveSimilarConfirmedQuestions({
        topic,
        bankName,
        subject,
        sectionName,
        conceptHints: [...conceptHints, `${tier}-tier calibration`],
        difficulty: tier,
        k: Math.max(k * 2, 8),
    });

    if (!base.hit) {
        pipelineTrace("DIFFICULTY_CALIBRATION_MISS", { tier, topic, reason: base.ragMeta?.reason });
        return {
            ...base,
            calibrationBlock: "",
            calibrationMeta: { tier, hit: false, filtered: 0 },
        };
    }

    // Prefer exemplars whose stored difficulty matches (when present on meta/snippets).
    // questionCorpusRag already filters when difficulty arg is set; keep block focused.
    const calibrationBlock = [
        `**DIFFICULTY CALIBRATION (${tier.toUpperCase()}):** Match the difficulty texture of these real ${tier}-tier exemplars — do not copy content.`,
        base.retrievedQuestionContextBlock || "",
    ]
        .filter(Boolean)
        .join("\n");

    pipelineTrace("DIFFICULTY_CALIBRATION_HIT", {
        tier,
        returned: base.ragMeta?.returned || 0,
        topic,
    });

    return {
        ...base,
        retrievedQuestionContextBlock: calibrationBlock,
        calibrationBlock,
        calibrationMeta: {
            tier,
            hit: true,
            filtered: base.ragMeta?.returned || 0,
        },
    };
};

export const isDifficultyCalibrationEnabled = () => {
    const flag = process.env.AI_QB_DIFFICULTY_CALIBRATION;
    if (flag === "0" || flag === "false") return false;
    return true;
};
