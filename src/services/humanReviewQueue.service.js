/**
 * Optional human review queue for low-confidence / disagreeing verification items.
 */

import mongoose from "mongoose";

const reviewItemSchema = new mongoose.Schema(
    {
        topic: { type: String, trim: true, default: "" },
        bankName: { type: String, trim: true, default: "" },
        sectionName: { type: String, trim: true, default: "" },
        reason: { type: String, trim: true, required: true },
        confidence: { type: Number, default: null },
        question: { type: mongoose.Schema.Types.Mixed, required: true },
        verification: { type: mongoose.Schema.Types.Mixed, default: null },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
        },
        workflowLogKey: { type: String, trim: true, default: "" },
    },
    { timestamps: true }
);

export const AiQuestionReviewQueue =
    mongoose.models.AiQuestionReviewQueue ||
    mongoose.model("AiQuestionReviewQueue", reviewItemSchema);

export const isHumanReviewEnabled = () => {
    const flag = process.env.AI_QB_HUMAN_REVIEW;
    return flag === "1" || flag === "true";
};

const CONFIDENCE_FLOOR = Math.min(
    1,
    Math.max(0, Number(process.env.AI_QB_HUMAN_REVIEW_CONFIDENCE || 0.8))
);

const confidenceToNumber = (c) => {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    const s = String(c || "").toLowerCase();
    if (s === "high") return 0.95;
    if (s === "medium") return 0.75;
    if (s === "low") return 0.4;
    return null;
};

/**
 * Park low-confidence / symbolic-fail / judge-disagree items into review queue.
 * Returns questions that remain auto-publishable.
 */
export const parkLowConfidenceForHumanReview = async (
    questions = [],
    {
        topic = "",
        bankName = "",
        sectionName = "",
        workflowLogKey = "",
    } = {}
) => {
    if (!isHumanReviewEnabled() || !questions?.length) {
        return { questions, parkedCount: 0 };
    }

    const keep = [];
    const toPark = [];

    for (const q of questions) {
        const v = q?._verification || {};
        const conf = confidenceToNumber(v.answerConfidence);
        const lowConf = conf != null && conf < CONFIDENCE_FLOOR;
        const symbolicFail = v.symbolicOk === false;
        const judgeDisagree = v.status === "stripped" && Array.isArray(v.ruleFailures);
        if (lowConf || symbolicFail || judgeDisagree) {
            toPark.push({
                topic,
                bankName,
                sectionName,
                reason: lowConf
                    ? "low_confidence"
                    : symbolicFail
                      ? "symbolic_fail"
                      : "verification_flag",
                confidence: conf,
                question: q,
                verification: v,
                workflowLogKey,
                status: "pending",
            });
        } else {
            keep.push(q);
        }
    }

    if (toPark.length) {
        try {
            await AiQuestionReviewQueue.insertMany(toPark, { ordered: false });
        } catch {
            // ignore duplicate/partial insert noise
        }
    }

    return { questions: keep, parkedCount: toPark.length };
};

export const listHumanReviewQueue = async ({ status = "pending", limit = 50 } = {}) =>
    AiQuestionReviewQueue.find(status ? { status } : {})
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(200, Number(limit) || 50)))
        .lean();
