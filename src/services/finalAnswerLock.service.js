/**
 * Derive marked answer from solution text via FINAL_ANSWER marker so
 * answer ↔ explanation cannot drift apart.
 */

const FINAL_ANSWER_RE =
    /FINAL_ANSWER\s*:\s*(\[[^\]]+\]|[A-D](?:\s*,\s*[A-D])*|True|False)/i;

/**
 * Parse FINAL_ANSWER from a free-form solution / explanation string.
 * @returns {{ letters: string[], raw: string } | null}
 */
export const parseFinalAnswerFromSolution = (text = "") => {
    const src = String(text || "");
    if (!src.trim()) return null;
    const match = src.match(FINAL_ANSWER_RE);
    if (!match) return null;
    let raw = String(match[1] || "").trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
        raw = raw.slice(1, -1);
    }
    const lower = raw.toLowerCase();
    if (lower === "true" || lower === "false") {
        return { letters: [lower === "true" ? "True" : "False"], raw };
    }
    const letters = raw
        .split(/[\s,]+/)
        .map((p) => p.trim().replace(/^["']|["']$/g, "").toUpperCase())
        .filter((p) => /^[A-D]$/.test(p));
    if (!letters.length) return null;
    return { letters: [...new Set(letters)], raw };
};

/** Strip trailing FINAL_ANSWER / Therefore closings so we can re-lock cleanly. */
export const stripFinalAnswerMarker = (text = "") =>
    String(text || "")
        .replace(/\s*FINAL_ANSWER\s*:\s*[^\n.]*\.?/gi, "")
        .replace(/\s*Therefore,?\s+the correct answer is[^.]*\.?/gi, "")
        .trim();

/**
 * Build explanation from solution steps with a single closing + FINAL_ANSWER line.
 * @param {string[]} solveSteps
 * @param {string} markedAnswer — option text OR letter(s) like "C" / "A,C" / "True"
 */
export const buildExplanationWithFinalAnswer = (
    solveSteps = [],
    markedAnswer = "",
    { correctLetter = "" } = {}
) => {
    const steps = (solveSteps || [])
        .map((s) => stripFinalAnswerMarker(String(s || "")))
        .filter(Boolean);
    const body =
        steps.length > 1
            ? steps.map((s, i) => `Step ${i + 1}: ${s}`).join(" ")
            : steps.join(" ").trim();
    const marked = String(markedAnswer || "").trim();
    const letterTag = String(correctLetter || "").trim().toUpperCase();
    const finalTag =
        letterTag ||
        (/^[A-D](,[A-D])*$/i.test(marked)
            ? marked.toUpperCase()
            : /^(true|false)$/i.test(marked)
              ? marked[0].toUpperCase() + marked.slice(1).toLowerCase()
              : "");
    const closingBits = [];
    if (body) closingBits.push(body);
    if (marked) {
        closingBits.push(`Therefore, the correct answer is ${marked}.`);
    }
    if (finalTag) {
        closingBits.push(`FINAL_ANSWER: ${finalTag}`);
    }
    return closingBits.join(" ").slice(0, 1600);
};

/**
 * Ensure solve-steps end with FINAL_ANSWER for the marked letter/value.
 */
export const appendFinalAnswerToSolveSteps = (
    solveSteps = [],
    correctLetterOrValue = ""
) => {
    const tag = String(correctLetterOrValue || "").trim();
    if (!tag) return solveSteps || [];
    const steps = (solveSteps || [])
        .map((s) => stripFinalAnswerMarker(String(s || "")).trim())
        .filter(Boolean);
    if (!steps.length) {
        return [`FINAL_ANSWER: ${tag}`];
    }
    const last = steps.length - 1;
    steps[last] = `${steps[last]} FINAL_ANSWER: ${tag}`;
    return steps;
};

/**
 * Apply lock: if solution has FINAL_ANSWER, prefer that letter for correctAnswer;
 * rebuild explanation from cleaned solution + marker.
 */
export const applySolutionFinalAnswerLock = ({
    explanation = "",
    solveSteps = [],
    options = [],
    correctAnswer = null,
    correctIndex = null,
    questionType = "single",
} = {}) => {
    const type = String(questionType || "single").toLowerCase();
    const opts = (options || []).map((o) =>
        typeof o === "object" && o !== null ? String(o.text ?? "") : String(o ?? "")
    );
    const solutionText = [
        ...(solveSteps || []).map(String),
        String(explanation || ""),
    ].join("\n");

    const parsed = parseFinalAnswerFromSolution(solutionText);

    let nextCorrectIndex = Number.isFinite(correctIndex) ? Number(correctIndex) : null;
    let nextCorrectAnswer = correctAnswer;
    let letterTag = "";

    if (type === "true_false" && parsed?.letters?.[0]) {
        const val = parsed.letters[0];
        nextCorrectAnswer = val;
        nextCorrectIndex = opts.findIndex(
            (o) => String(o).trim().toLowerCase() === val.toLowerCase()
        );
        letterTag = val;
    } else if (type === "multiple" && parsed?.letters?.length) {
        const letters = parsed.letters.filter((L) => /^[A-D]$/.test(L));
        if (letters.length) {
            nextCorrectAnswer = letters;
            letterTag = letters.join(",");
            nextCorrectIndex = letters[0].charCodeAt(0) - 65;
        }
    } else if (parsed?.letters?.[0] && /^[A-D]$/.test(parsed.letters[0])) {
        letterTag = parsed.letters[0];
        nextCorrectIndex = letterTag.charCodeAt(0) - 65;
        nextCorrectAnswer = letterTag;
    } else if (Number.isFinite(nextCorrectIndex) && nextCorrectIndex >= 0) {
        letterTag = String.fromCharCode(65 + nextCorrectIndex);
        nextCorrectAnswer = nextCorrectAnswer || letterTag;
    } else if (typeof correctAnswer === "string" && /^[A-D]$/i.test(correctAnswer)) {
        letterTag = correctAnswer.toUpperCase();
        nextCorrectIndex = letterTag.charCodeAt(0) - 65;
    }

    const markedText =
        Number.isFinite(nextCorrectIndex) && opts[nextCorrectIndex]
            ? opts[nextCorrectIndex]
            : String(
                  Array.isArray(nextCorrectAnswer)
                      ? nextCorrectAnswer.join(",")
                      : nextCorrectAnswer || letterTag || ""
              );

    const cleanedSteps = appendFinalAnswerToSolveSteps(
        (solveSteps || []).length
            ? solveSteps
            : String(explanation || "")
                  .split(/(?:Step\s*\d+\s*:)/i)
                  .map((s) => s.trim())
                  .filter(Boolean),
        letterTag || markedText
    );

    const lockedExplanation = buildExplanationWithFinalAnswer(
        cleanedSteps.map(stripFinalAnswerMarker),
        markedText,
        { correctLetter: letterTag || markedText }
    );

    return {
        correctIndex: nextCorrectIndex,
        correctAnswer: nextCorrectAnswer,
        explanation: lockedExplanation,
        _solveSteps: cleanedSteps,
        parsedFinalAnswer: parsed,
    };
};
