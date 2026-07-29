/**
 * Concept coverage gate: generated concept must match official syllabus /
 * requested subject scope before save.
 */

import { pipelineTrace } from "../utils/aiApiCallLogger.js";
import {
    isChapterInOfficialSyllabus,
    isJeeMainOfficialSyllabusAvailable,
    matchOfficialSyllabusUnit,
} from "./jeeMainOfficialSyllabus.service.js";

export const isConceptCoverageEnabled = () => {
    const flag = process.env.AI_QB_CONCEPT_COVERAGE;
    if (flag === "0" || flag === "false") return false;
    return true;
};

const extractConceptHints = (q = {}) => {
    const hints = [
        q._conceptSlot,
        q.conceptSlot,
        q.concept,
        q.chapter,
        q.topic,
        ...(Array.isArray(q._concepts) ? q._concepts : []),
    ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);
    return [...new Set(hints)];
};

/**
 * Validate question concepts against official JEE syllabus (when available)
 * and optional requested concept/subject scope.
 */
export const validateConceptCoverage = (
    question = {},
    { subject = "", sectionName = "", requestedConcepts = [] } = {}
) => {
    const subj = subject || sectionName || "";
    const hints = extractConceptHints(question);
    if (!hints.length) {
        return {
            ok: true,
            soft: true,
            reason: "no_concept_tag",
            matchedUnit: null,
        };
    }

    const requested = (requestedConcepts || [])
        .map((c) => String(c || "").trim().toLowerCase())
        .filter(Boolean);

    if (requested.length) {
        const hay = hints.join(" ").toLowerCase();
        const hit = requested.some(
            (r) => hay.includes(r) || r.split(/\s+/).some((t) => t.length > 4 && hay.includes(t))
        );
        if (!hit) {
            return {
                ok: false,
                reason: `concept_mismatch_requested (${hints[0]} ∉ requested scope)`,
                matchedUnit: null,
            };
        }
    }

    if (!isJeeMainOfficialSyllabusAvailable() || !subj) {
        return { ok: true, soft: true, reason: "syllabus_unavailable", matchedUnit: null };
    }

    let matched = null;
    for (const hint of hints) {
        matched = matchOfficialSyllabusUnit(subj, hint);
        if (matched) break;
        if (isChapterInOfficialSyllabus(subj, hint)) {
            matched = { title: hint };
            break;
        }
    }

    if (!matched) {
        return {
            ok: false,
            reason: `concept_out_of_syllabus (${hints[0]})`,
            matchedUnit: null,
        };
    }

    return {
        ok: true,
        reason: "ok",
        matchedUnit: matched.title || matched.unit || null,
    };
};

/**
 * Apply concept coverage gate. Failures stamp conceptCoverageOk=false for rule engine.
 */
export const runConceptCoveragePass = (
    questions = [],
    { subject = "", sectionName = "", requestedConcepts = [] } = {}
) => {
    if (!isConceptCoverageEnabled()) {
        return { questions, rejected: [], checked: 0 };
    }

    const rejected = [];
    const next = (questions || []).map((q) => {
        const type = String(q?.questionType || "single").toLowerCase();
        if (type !== "single") return q;
        const result = validateConceptCoverage(q, {
            subject,
            sectionName,
            requestedConcepts,
        });
        if (!result.ok) {
            rejected.push({ question: q, reason: result.reason });
            return {
                ...q,
                _verification: {
                    ...(q._verification || {}),
                    conceptCoverageOk: false,
                    conceptCoverageReason: result.reason,
                    status: "stripped",
                    ruleFailures: [
                        ...((q._verification?.ruleFailures) || []),
                        "concept_coverage_failed",
                    ],
                },
            };
        }
        return {
            ...q,
            _verification: {
                ...(q._verification || {}),
                conceptCoverageOk: true,
                matchedSyllabusUnit: result.matchedUnit,
            },
        };
    });

    pipelineTrace("CONCEPT_COVERAGE_DONE", {
        checked: questions.length,
        rejected: rejected.length,
        subject,
        sectionName,
    });

    return {
        questions: next,
        rejected,
        checked: questions.length,
    };
};
