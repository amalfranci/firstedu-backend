/**
 * Deterministic structural/format checks for AI paper questions.
 * No LLM calls — catch invalid Gemini output before o3/Luna.
 */

const LETTER = /^[A-D]$/;

const asText = (v) => String(v ?? "").trim();

const optionTexts = (options = []) =>
  (Array.isArray(options) ? options : []).map((o) =>
    asText(typeof o === "string" ? o : o?.text ?? o?.label ?? "")
  );

const letterFromIndex = (i) =>
  Number.isInteger(i) && i >= 0 && i <= 3 ? String.fromCharCode(65 + i) : null;

export const codeValidateQuestion = (q, typeHint = null) => {
  const issues = [];
  if (!q || typeof q !== "object") {
    return { ok: false, issues: ["not_an_object"] };
  }

  const type = String(
    typeHint || q._advancedType || q.questionType || ""
  ).toLowerCase();
  if (!["single", "multiple", "integer", "match"].includes(type)) {
    issues.push(`invalid_type:${type || "empty"}`);
  }

  const stem = asText(q.questionText || q.text);
  if (!stem) issues.push("missing_question_text");
  if (stem.length < 20) issues.push("question_text_too_short");

  const chapter = asText(q._chapter || q.chapter);
  if (!chapter) issues.push("missing_chapter");

  const insight = asText(q._insight || q.insightOneLiner || "");
  const explanation = asText(q.explanation);
  if (!insight && !explanation) issues.push("missing_explanation_or_insight");

  if (type === "integer") {
    const n = Number(q.correctAnswer ?? q.finalAnswer ?? q.answerDisplay);
    if (!Number.isFinite(n)) issues.push("integer_answer_not_numeric");
    if (Array.isArray(q.options) && q.options.length > 0) {
      issues.push("integer_should_not_have_options");
    }
  } else if (type === "match") {
    const listI = Array.isArray(q.listI) ? q.listI : [];
    const listII = Array.isArray(q.listII) ? q.listII : [];
    if (listI.length !== 4) issues.push(`match_listI_count:${listI.length}`);
    if (listII.length < 4) issues.push(`match_listII_count:${listII.length}`);
    if (listI.some((x) => !asText(x))) issues.push("match_listI_empty_item");
    const opts = optionTexts(q.options);
    if (opts.length !== 4) issues.push(`match_option_count:${opts.length}`);
    if (opts.some((t) => !t)) issues.push("match_empty_option");
    const letter = asText(q.correctAnswer).toUpperCase().slice(0, 1);
    if (!LETTER.test(letter)) issues.push("match_correctAnswer_not_A_D");
    else if (!opts[letter.charCodeAt(0) - 65]) {
      issues.push(`match_correctAnswer_missing_option:${letter}`);
    }
  } else {
    // single / multiple
    const opts = optionTexts(q.options);
    if (opts.length !== 4) issues.push(`option_count:${opts.length}`);
    if (opts.some((t) => !t)) issues.push("empty_option_text");
    const unique = new Set(opts.map((t) => t.toLowerCase()));
    if (opts.length === 4 && unique.size < 4) issues.push("duplicate_options");

    if (type === "single") {
      let letter = asText(q.correctAnswer).toUpperCase().replace(/[^A-D]/g, "");
      if (letter.length > 1) letter = letter[0];
      if (!letter && Number.isInteger(q.correctIndex)) {
        letter = letterFromIndex(q.correctIndex) || "";
      }
      if (!LETTER.test(letter)) issues.push("single_correctAnswer_not_A_D");
      else if (opts.length === 4 && !opts[letter.charCodeAt(0) - 65]) {
        issues.push(`single_correctAnswer_missing_option:${letter}`);
      }
      if (
        Number.isInteger(q.correctIndex) &&
        LETTER.test(letter) &&
        q.correctIndex !== letter.charCodeAt(0) - 65
      ) {
        issues.push("correctIndex_mismatch_correctAnswer");
      }
    } else if (type === "multiple") {
      const raw =
        q.correctIndices ||
        q.correctLetters ||
        q.correctAnswer ||
        q.multipleCorrectIndexes;
      const letters = (
        Array.isArray(raw)
          ? raw.map((x) => String(x).toUpperCase())
          : String(raw || "").toUpperCase().split(/[^A-D]+/)
      )
        .map((s) => s.replace(/[^A-D]/g, "").slice(0, 1))
        .filter((s) => LETTER.test(s));
      const uniq = [...new Set(letters)].sort();
      if (!uniq.length) issues.push("multiple_no_correct_letters");
      for (const L of uniq) {
        if (opts.length === 4 && !opts[L.charCodeAt(0) - 65]) {
          issues.push(`multiple_missing_option:${L}`);
        }
      }
    }
  }

  // Rough LaTeX balance check (cheap)
  const latexSrc = `${stem} ${explanation}`;
  const opens = (latexSrc.match(/\$/g) || []).length;
  if (opens % 2 !== 0) issues.push("unbalanced_inline_math_dollars");
  const fracOpen = (latexSrc.match(/\\frac\{/g) || []).length;
  const braces = (latexSrc.match(/\{/g) || []).length - (latexSrc.match(/\}/g) || []).length;
  if (Math.abs(braces) > 4) issues.push("suspicious_brace_imbalance");
  if (fracOpen > 0 && braces !== 0 && Math.abs(braces) > 2) {
    issues.push("latex_frac_brace_imbalance");
  }

  return { ok: issues.length === 0, issues, type };
};

export const isDuplicateStem = (stem, existingStems = []) => {
  const norm = asText(stem).toLowerCase().replace(/\s+/g, " ").slice(0, 180);
  if (!norm) return false;
  return existingStems.some((s) => {
    const other = asText(s).toLowerCase().replace(/\s+/g, " ").slice(0, 180);
    return other && (other === norm || other.includes(norm) || norm.includes(other));
  });
};

export default {
  codeValidateQuestion,
  isDuplicateStem,
};
