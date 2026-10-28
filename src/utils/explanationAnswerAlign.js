/**
 * Keep explanations publishable and in sync with the marked correctAnswer.
 *
 * Critical: option letters are UPPERCASE A–D only. Never use the `i` flag on
 * [A-D] remaps — that turns "and B" into "nd B" / "nd D. nd D.".
 */

/** Uppercase option letter only (never match "a" inside "and"). */
const OPT = "[A-D]";

/**
 * First-letter eaten by a glued option label (textbf leftovers).
 * `natural` = real first letter of the restored word — when the captured
 * letter equals `natural`, this is the intact word (e.g. "Option Analysis"),
 * NOT a glue bug.
 */
const GLUED_WORD_RESTORES = {
  nalysis: { word: "Analysis", natural: "A" },
  orresponds: { word: "corresponds", natural: "C" },
  orresponding: { word: "corresponding", natural: "C" },
  ccording: { word: "According", natural: "A" },
  ccordingly: { word: "Accordingly", natural: "A" },
  herefore: { word: "Therefore", natural: "T" },
  ence: { word: "Hence", natural: "H" },
  hus: { word: "Thus", natural: "T" },
};

/** Closing / verdict phrases that name an option letter (uppercase only). */
const CLOSING_LETTER_RES = [
  new RegExp(
    `\\b(?:Hence|Therefore|Thus|So),?\\s+(?:the\\s+)?(?:correct|Dorrect)?\\s*(?:option|answer|choice)\\s*(?:is|:|=)?\\s*[\\[\\(]?${OPT}[\\]\\)]?`,
    "g"
  ),
  new RegExp(
    `\\b(?:the\\s+)?(?:correct|right|Dorrect)\\s+(?:option|answer|choice)\\s*(?:is|:|=)\\s*[\\[\\(]?${OPT}[\\]\\)]?`,
    "g"
  ),
  new RegExp(
    `\\bOption\\s*[\\[\\(]?${OPT}[\\]\\)]?\\s+is\\s+(?:therefore\\s+)?(?:the\\s+)?correct\\b`,
    "g"
  ),
  new RegExp(
    `\\b(?:this\\s+)?correspond(?:s|ing)\\s+to\\s+(?:option|choice)\\s*[\\[\\(]?${OPT}[\\]\\)]?`,
    "gi"
  ),
  new RegExp(`\\\\boxed\\{${OPT}(?:\\s*,\\s*${OPT})*\\}`, "g"),
];

/** Isolated uppercase A–D only. */
const ISOLATED_OPT_RE = () => new RegExp(`(?<![A-Za-z])${OPT}(?![A-Za-z])`, "g");

const extractVerdictLetter = (chunk = "") => {
  const s = String(chunk);
  let last = null;
  const re = ISOLATED_OPT_RE();
  let m;
  while ((m = re.exec(s)) !== null) {
    last = m[0].toUpperCase();
  }
  return last;
};

const replaceVerdictLetter = (chunk, ans) => {
  const s = String(chunk);
  let lastIdx = -1;
  const re = ISOLATED_OPT_RE();
  let m;
  while ((m = re.exec(s)) !== null) {
    lastIdx = m.index;
  }
  if (lastIdx < 0) return s;
  return `${s.slice(0, lastIdx)}${ans}${s.slice(lastIdx + 1)}`;
};

/** Normalize marked key to A–D or CSV like "A,C". */
export const normalizeMarkedLetters = (marked) => {
  if (Array.isArray(marked)) {
    return [
      ...new Set(
        marked
          .map((x) =>
            String(x || "")
              .trim()
              .toUpperCase()
              .replace(/[^A-D].*$/, "")
              .slice(0, 1)
          )
          .filter((L) => /^[A-D]$/.test(L))
      ),
    ].join(",");
  }
  const raw = String(marked || "").toUpperCase();
  const letters = [...raw.matchAll(/\b([A-D])\b/g)].map((m) => m[1]);
  if (letters.length) return [...new Set(letters)].join(",");
  const single = raw.replace(/[^A-D].*$/, "").slice(0, 1);
  return /^[A-D]$/.test(single) ? single : "";
};

/**
 * Remove duplicated / corrupted trailing fragments from bad letter remaps:
 * "and B. and B.", "nd D. nd D.", ", and D. , and D."
 */
export const stripCorruptedOptionFragments = (text = "") => {
  let out = String(text || "");

  // Collapse identical ", and X. , and X." anywhere (Q8/Q9)
  out = out.replace(/(,\s*and\s+[A-D]\.)(?:\s*\1)+/g, "$1");
  // Orphan ", and D." after a sentence end, before Therefore (not part of closer)
  out = out.replace(
    /\.\s*,\s*and\s+[A-D]\.(?:\s*,\s*and\s+[A-D]\.)*\s*(?=Therefore,)/g,
    ".\n\n"
  );
  // Orphan ", and D." after a sentence end at EOF (not "options are A, C, and D.")
  out = out.replace(
    /(?<!Therefore, the correct options? (?:is|are)[^.]*?)\.\s*,\s*and\s+[A-D]\.(?:\s*,\s*and\s+[A-D]\.)*\s*$/g,
    "."
  );
  // Repeated "and X." / ", and X." tails (2+ only)
  out = out.replace(/(?:\s*,?\s*and\s+[A-D]\.){2,}\s*$/g, "");
  // Corrupted "nd X." tails — must NOT match inside "and X."
  out = out.replace(/(?:^|[\s(])nd\s+[A-D]\.(?:\s*nd\s+[A-D]\.)*/g, " ");

  // After a proper closer, drop orphan ", and X." / "and X." repeats
  out = out.replace(
    /(Therefore,\s+the\s+correct\s+options?\s+(?:is|are)\s+[A-D](?:\s*,\s*[A-D])*(?:\s+and\s+[A-D])?\.)\s*(?:,?\s*and\s+[A-D]\.\s*)+$/g,
    "$1"
  );
  // Single-correct closer followed by stray ", and D."
  out = out.replace(
    /(Therefore,\s+the\s+correct\s+option\s+is\s+[A-D]\.)\s*(?:,?\s*and\s+[A-D]\.\s*)+$/g,
    "$1"
  );

  // Near end (last 160 chars): collapse 2+ ",? and X." only
  const head = out.slice(0, Math.max(0, out.length - 160));
  let tail = out.slice(Math.max(0, out.length - 160));
  tail = tail.replace(/(,\s*and\s+[A-D]\.)(?:\s*\1)+/g, "$1");
  tail = tail.replace(/(?:\s*,?\s*and\s+[A-D]\.){2,}/g, "");
  tail = tail.replace(/(?:^|[\s(])nd\s+[A-D]\.(?:\s*nd\s+[A-D]\.)*/g, " ");
  out = `${head}${tail}`;

  // Duplicate identical closer lines
  out = out.replace(
    /(\bTherefore,\s+the\s+correct\s+options?\s+(?:is|are)\s+[A-D](?:\s*,\s*[A-D])*(?:\s+and\s+[A-D])?\.)(?:\s*\1)+/g,
    "$1"
  );

  return out.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
};

/**
 * Normalize over-escaped backslashes and repair regex artifacts:
 * 1. Repair broken \ eq / \eq artifacts to \neq (e.g., "21\ eq25" -> "21 \neq 25", "k(k\ eq 0)" -> "k(k\neq 0)")
 * 2. Collapse runs of escaped backslashes before LaTeX commands (e.g. \\\\\\\\\\\\\\\\\\\\\frac -> \frac)
 * 3. Collapse excessive standalone backslash runs (e.g. \\\\\\\\ -> \\)
 */
export const normalizeBackslashEscapes = (raw) => {
  if (!raw) return raw;
  let text = String(raw);

  // 1. Repair broken \ eq / \eq artifacts to \neq
  // Matches \ eq, \eq, \\ eq, \\eq (not followed by letters, so \eqref, \equiv are safe)
  text = text.replace(/\\+\s*eq(?![a-zA-Z])(\s*)/g, (_full, sp) => {
    return sp ? `\\neq${sp}` : `\\neq `;
  });

  // 2. Collapse runs of escaped backslashes before LaTeX commands:
  // e.g., \\\\\\\\\\\\\\\\\\\\\frac -> \frac, \\\\\\\\\dfrac -> \dfrac, \\\\\\\\\text -> \text
  text = text.replace(/\\{2,}([a-zA-Z]+)/g, (_full, cmd) => `\\${cmd}`);

  // 3. Collapse excessive standalone backslash runs (e.g. \\\\\\\\ -> \\ for line break)
  text = text.replace(/\\{4,}/g, "\\\\");

  return text;
};

/**
 * Repair prose / LaTeX corruptions without destroying words like "Analysis".
 */
export const sanitizeExplanationText = (raw) => {
  let text = String(raw || "");
  if (!text) return text;

  text = normalizeBackslashEscapes(text);
  text = text.replace(/<[^>]+>/g, " ");

  // Real glued labels only: Option Bnalysis → Option B. Analysis
  text = text.replace(
    /\bOption\s*([A-D])(nalysis|orresponds|orresponding|ccordingly|ccording|herefore|ence|hus)\b/g,
    (_full, L, rest) => {
      const info = GLUED_WORD_RESTORES[String(rest).toLowerCase()];
      if (!info) return _full;
      const letter = String(L).toUpperCase();
      if (letter === info.natural) return `Option ${info.word}`;
      return `Option ${letter}. ${info.word}`;
    }
  );

  text = text.replace(
    /(?<![A-Za-z])([A-D])(nalysis|orresponds|orresponding|ccordingly|ccording)\b/g,
    (_full, L, rest) => {
      const info = GLUED_WORD_RESTORES[String(rest).toLowerCase()];
      if (!info) return _full;
      const letter = String(L).toUpperCase();
      if (letter === info.natural) return info.word;
      return `${letter}. ${info.word}`;
    }
  );

  text = text
    .replace(
      /\b(?:Locked answer|FINAL[_-\s]?ANSWER|PROPOSED ANSWER|independentAnswer|verifiedSolution)\s*[:=]\s*[A-D](?:\s*,\s*[A-D])*\b[^\n.]*/gi,
      ""
    )
    .replace(/\bAnswer\s*[:=]\s*([A-D])(?:\s*,\s*[A-D])*\b/g, "")
    .replace(/(?:^|\n)\s*\[([A-D])\]\s*(?=\n|$)/gm, "\n")
    .replace(/\s+\[([A-D])\]\s*\.?\s*$/gm, ".")
    .replace(/\(\s*Locked[^)]*\)/gi, "");

  text = text
    .replace(/Long\)arrow/gi, "\\rightarrow")
    .replace(/\)arrow/gi, "\\rightarrow")
    .replace(/\bLongrightarrow\b/g, "\\longrightarrow")
    .replace(/\bdll\b/g, "")
    .replace(/\bdfrac\b/g, "\\dfrac")
    .replace(/\bfrac\b(?![a-zA-Z])/g, "\\frac")
    .replace(/\btextbf\b/g, "\\textbf")
    .replace(/(?<![\\])<=(?=[\s$\d])/g, "\\le ")
    .replace(/(?<![\\])>=(?=[\s$\d])/g, "\\ge ")
    .replace(/\[dfrac\{([^}\]]+)\](\d+)\}/gi, "\\dfrac{$1}{$2}")
    .replace(/\[frac\{([^}\]]+)\](\d+)\}/gi, "\\frac{$1}{$2}");

  text = stripCorruptedOptionFragments(text);
  text = normalizeBackslashEscapes(text);

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

/** @deprecated alias — keep old import sites working */
export const sanitizeExplanationLatex = sanitizeExplanationText;

/**
 * After option shuffle, remap A–D references so they still point at the same
 * option text. UPPERCASE letters only — never touch "and" / "According".
 */
export const remapExplanationOptionLetters = (text, letterMap) => {
  if (!text || !letterMap || typeof letterMap !== "object") return text;
  const entries = Object.entries(letterMap).filter(
    ([from, to]) =>
      /^[A-D]$/.test(from) && /^[A-D]$/.test(to) && from !== to
  );
  if (!entries.length) return text;

  const token = (L) => `\uE000${L}\uE001`;
  const subst = (L) => {
    const up = String(L || "").toUpperCase();
    return letterMap[up] && letterMap[up] !== up ? token(letterMap[up]) : L;
  };

  let out = sanitizeExplanationText(text);

  // "Option B" / "options B" — uppercase letter only, not start of a word
  out = out.replace(
    /\b(options?|statements?|choices?|Option)\s*[\-\s]*\(?([A-D])\)?(?![A-Za-z])/g,
    (_full, word, L) => `${word} ${subst(L)}`
  );

  // Multi-correct phrases: "A and C" / "A, C" (uppercase only)
  out = out.replace(
    /\b([A-D])(\s+and\s+)([A-D])\b/g,
    (_full, a, mid, b) => `${subst(a)}${mid}${subst(b)}`
  );
  out = out.replace(
    /\b([A-D])(\s*,\s*)([A-D])\b/g,
    (_full, a, mid, b) => `${subst(a)}${mid}${subst(b)}`
  );

  out = out.replace(
    /\b((?:Hence|Therefore|Thus|So),?\s+)?(?:this\s+corresponds\s+to\s+)?(?:the\s+)?(?:right\s+)?(?:correct\s+)?(?:option|answer)\s+(?:is\s+)?\(?([A-D])\)?(?![A-Za-z])/g,
    (full, _lead, L) => {
      if (!L) return full;
      return full.replace(
        new RegExp(`\\(?${L}\\)?(?![A-Za-z])`),
        () => String(subst(L))
      );
    }
  );

  out = out.replace(
    /\bcorrespond(?:s|ing)\s+to\s+(?:option|choice)\s*\(?([A-D])\)?(?![A-Za-z])/gi,
    (full, L) =>
      full.replace(
        new RegExp(`\\(?${L}\\)?(?![A-Za-z])`),
        () => String(subst(L))
      )
  );

  // Line-start enumeration: "A." / "B)" / "C:"
  out = out.replace(
    /(^|\n)([ \t]*)([A-D])([).:]\s+)/gm,
    (_full, br, sp, L, punct) => `${br}${sp}${subst(L)}${punct}`
  );

  out = out.replace(
    /\b(FINAL_ANSWER|Locked answer):\s*([A-D])\b/g,
    (_full, label, L) => `${label}: ${subst(L)}`
  );

  out = out.replace(
    /\\mathbf\{([A-D])\}/g,
    (_full, L) => `\\mathbf{${subst(L)}}`
  );
  out = out.replace(
    /\\textbf\{([A-D])\}/g,
    (_full, L) => `\\textbf{${subst(L)}}`
  );

  out = out.replace(
    /([\[\(/])([A-D])([\]\)])/g,
    (_full, open, L, close) => `${open}${subst(L)}${close}`
  );

  out = out.replace(/\uE000([A-D])\uE001/g, "$1");
  return stripCorruptedOptionFragments(out);
};

/** Remove duplicate closing verdict sentences. */
export const stripClosingVerdicts = (text = "") => {
  let out = String(text || "");
  const patterns = [
    /\b(?:Hence|Therefore|Thus|So),?\s+(?:the\s+)?(?:correct|right)\s+(?:options?|answers?|choices?)\s*(?:are|is|:|=)\s*[\[\(]?[A-D](?:\s*,\s*[A-D])*(?:\s+and\s+[A-D])*[\]\)]?\.?/g,
    /\b(?:Correct|Right)\s+(?:options?|answers?)\s*(?:are|is|:)\s*[\[\(]?[A-D](?:\s*,\s*[A-D])*(?:\s+and\s+[A-D])*[\]\)]?\.?/g,
    /\bThis\s+corresponds\s+to\s+(?:option|choice)\s*[\[\(]?[A-D][\]\)]?\.?/gi,
    /\\boxed\{[A-D](?:\s*,\s*[A-D])*\}/g,
    /\b(?:Hence|Therefore|Thus|So),?\s+(?:the\s*)?$/gm,
  ];
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    for (const re of patterns) {
      out = out.replace(re, "").trim();
    }
    if (out === before) break;
  }
  return stripCorruptedOptionFragments(out.replace(/\n{3,}/g, "\n\n").trim());
};

const closerSentence = (ansCsv) => {
  const letters = String(ansCsv || "")
    .split(",")
    .map((x) => x.trim())
    .filter((L) => /^[A-D]$/.test(L));
  if (!letters.length) return "";
  if (letters.length === 1) {
    return `Therefore, the correct option is ${letters[0]}.`;
  }
  if (letters.length === 2) {
    return `Therefore, the correct options are ${letters[0]} and ${letters[1]}.`;
  }
  const head = letters.slice(0, -1).join(", ");
  const last = letters[letters.length - 1];
  return `Therefore, the correct options are ${head}, and ${last}.`;
};

/** Normalize bare analysis headers "A." / "B)" → "Option A" / "Option B". */
export const normalizeOptionAnalysisHeaders = (text = "") => {
  let out = String(text || "");
  // Line-start bare letters (not already "Option X")
  out = out.replace(
    /(^|\n)([ \t]*)(?!Option\s)([A-D])([).:]\s+)(?=[A-Za-z("'])/gm,
    (_full, br, sp, L, punct) => {
      const p = String(punct).startsWith(")") ? ". " : punct;
      return `${br}${sp}Option ${String(L).toUpperCase()}${p}`;
    }
  );
  // Inline after Option Analysis: "Option Analysis D. Replacing"
  out = out.replace(
    /\b(Option\s+Analysis)\s+([A-D])([).:]\s+)/gi,
    (_full, lead, L, punct) => {
      const p = String(punct).startsWith(")") ? ". " : punct;
      return `${lead}\nOption ${String(L).toUpperCase()}${p}`;
    }
  );
  return out;
};

/**
 * Force closing verdict to name `marked`.
 * Single: rewrite wrong "Option A is correct" → marked key.
 * Multi: keep "Option X is correct" when X ∈ keySet; rewrite X ∉ keySet → incorrect.
 * Never collapse C/D → primary A (Q16 bug).
 */
export const alignExplanationToMarkedAnswer = (text, marked) => {
  const ans = normalizeMarkedLetters(marked);
  if (!text) return text;
  if (!ans) return sanitizeExplanationText(text);

  let out = sanitizeExplanationText(text);
  out = stripClosingVerdicts(out);
  out = stripCorruptedOptionFragments(out);

  const keyLetters = ans.split(",").filter((L) => /^[A-D]$/.test(L));
  const keySet = new Set(keyLetters);
  const primary = keyLetters[0];
  const multi = keyLetters.length > 1;

  const positiveVerdictRe =
    /\bOption\s+([A-D])\s+is\s+(?:therefore\s+)?(?:the\s+)?(?<!in)correct(?:\s+answer|\s+option|\s+choice)?\b/gi;

  if (!multi) {
    out = out.replace(positiveVerdictRe, `Option ${primary} is correct`);
  } else {
    out = out.replace(positiveVerdictRe, (chunk, L) => {
      const letter = String(L || "").toUpperCase();
      if (keySet.has(letter)) return `Option ${letter} is correct`;
      return `Option ${letter} is incorrect`;
    });
  }

  for (const re of CLOSING_LETTER_RES) {
    out = out.replace(new RegExp(re.source, re.flags), (chunk) => {
      // Mid-body "Option X is correct" — already handled above; skip collapse for multi.
      if (/\bOption\s+[A-D]\s+is\s+/i.test(chunk)) {
        if (multi) return chunk;
        const letter = extractVerdictLetter(chunk);
        if (!letter || letter === primary) return chunk;
        return replaceVerdictLetter(chunk, primary);
      }
      if (multi && /options?\s+are/i.test(chunk)) {
        return closerSentence(ans).replace(/\.$/, "");
      }
      const letter = extractVerdictLetter(chunk);
      if (!letter) return chunk;
      if (multi) {
        // Multi closer fragments: replace whole with canonical closer body later.
        if (/correct\s+options?\s+(?:is|are)/i.test(chunk)) {
          return closerSentence(ans).replace(/\.$/, "");
        }
        // "corresponds to option X" — leave if X in keySet, else primary of set is wrong;
        // leave mid-body letters alone for multi.
        return chunk;
      }
      if (letter === primary) return chunk;
      return replaceVerdictLetter(chunk, primary);
    });
  }

  if (!multi) {
    out = out.replace(
      /([\[\(/])\s*([A-D])\s*([\]\)])(\s*\.?[\s]*)$/g,
      (_full, open, letter, close, trail) =>
        letter.toUpperCase() === primary
          ? `${open}${letter}${close}${trail}`
          : `${open}${primary}${close}${trail}`
    );
  }

  out = stripClosingVerdicts(out);
  out = stripCorruptedOptionFragments(out).trim();
  const closer = closerSentence(ans);
  if (closer) {
    out = `${out}\n\n${closer}`;
  }
  out = stripCorruptedOptionFragments(out).trim();
  // Final: drop stray ", and X." after multi/single closer
  out = out.replace(
    /(Therefore,\s+the\s+correct\s+options?\s+(?:is|are)\s+[A-D](?:\s*,\s*[A-D])*(?:\s*,?\s*and\s+[A-D])?\.)\s*(?:,?\s*and\s+[A-D]\.\s*)+/g,
    "$1"
  );
  out = out.replace(/\s*,\s*and\s+[A-D]\.\s*(?=Therefore,)/g, "\n\n");
  return stripCorruptedOptionFragments(out).trim();
};

/**
 * Tokens for Jaccard overlap between explanation block and option text.
 */
export const tokenizeForOverlap = (s = "") => {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "for",
    "that",
    "this",
    "with",
    "is",
    "are",
    "be",
    "by",
    "on",
    "as",
    "its",
    "from",
    "option",
    "correct",
    "incorrect",
  ]);
  return new Set(
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stop.has(w))
  );
};

export const jaccardOverlap = (a, b) => {
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

/**
 * Parse Option X / bare X. analysis blocks from explanation.
 * @returns {{ letter: string, body: string }[]}
 */
export const extractOptionAnalysisBlocks = (text = "") => {
  const src = String(text || "");
  const blocks = [];
  const re =
    /(?:^|\n)\s*(?:Option\s+)?([A-D])[).:]\s+/g;
  const starts = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    starts.push({ letter: m[1].toUpperCase(), index: m.index + (m[0].startsWith("\n") ? 1 : 0), endHeader: m.index + m[0].length });
  }
  for (let i = 0; i < starts.length; i += 1) {
    const cur = starts[i];
    const next = starts[i + 1];
    const bodyEnd = next ? next.index : src.length;
    const body = src.slice(cur.endHeader, bodyEnd).trim();
    if (body.length >= 20) blocks.push({ letter: cur.letter, body });
  }
  return blocks;
};

/**
 * True when remapped explanation labels disagree with option texts,
 * or walkthrough has duplicate / missing letters among 3+ blocks.
 */
export const explanationRemapMismatch = (explanation = "", options = []) => {
  const plain = (options || []).map((o) =>
    String(typeof o === "string" ? o : o?.text || "")
      .replace(/^[([]?[A-D][).:\-\]]\s*/i, "")
      .trim()
  );
  if (plain.length < 2) return { mismatch: false, reason: null };

  const optTokens = plain.map((t) => tokenizeForOverlap(t));
  const blocks = extractOptionAnalysisBlocks(explanation);
  if (blocks.length < 2) return { mismatch: false, reason: null };

  const letters = blocks.map((b) => b.letter);
  const uniq = new Set(letters);
  if (uniq.size !== letters.length) {
    return { mismatch: true, reason: "duplicate_analysis_letter" };
  }
  if (blocks.length >= 3) {
    const expected = "ABCD".slice(0, Math.min(4, plain.length)).split("");
    const missing = expected.filter((L) => !uniq.has(L));
    // Only flag missing when we clearly intended a full walkthrough
    if (blocks.length >= plain.length && missing.length) {
      return { mismatch: true, reason: `missing_analysis_letter:${missing.join("")}` };
    }
  }

  let mismatches = 0;
  for (const block of blocks) {
    const bt = tokenizeForOverlap(block.body);
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < optTokens.length; i += 1) {
      const score = jaccardOverlap(bt, optTokens[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestScore < 0.08) continue;
    const bestLetter = String.fromCharCode(65 + bestIdx);
    if (bestLetter !== block.letter) mismatches += 1;
  }
  if (mismatches >= 1 && blocks.length >= 2) {
    return { mismatch: true, reason: "label_content_swap" };
  }
  return { mismatch: false, reason: null };
};

/**
 * Safely strip option label prefixes (e.g. "A)", "Option A:", "(A)") without
 * stripping the English indefinite article "A " (e.g. "A healthcare system...").
 */
export const stripOptionLabelPrefix = (text = "") => {
  return String(text || "")
    .replace(/^\s*option\s+[A-D](?:[).:\-]|\s+)\s*/i, "")
    .replace(/^\s*[([]\s*[A-D]\s*[)\]][).:\-]?\s*/i, "")
    .replace(/^\s*[A-D][).:\-]\s*/i, "")
    .replace(/^\s*[B-D]\s+/i, "")
    .trim();
};

/**
 * Ensure option evaluation paragraphs follow strict A -> B -> C -> D sequence.
 */
export const sortExplanationOptionAnalysis = (text = "") => {
  let out = String(text || "");
  if (!out) return out;

  // Extract conclusion line if present
  let conclusion = "";
  const conclusionMatch = out.match(
    /\n*(Therefore,\s+(?:the\s+)?correct\s+options?\s+(?:is|are)\s+[A-D,\sand]+\.?\s*)$/i
  );
  if (conclusionMatch) {
    conclusion = conclusionMatch[1].trim();
    out = out.slice(0, conclusionMatch.index).trim();
  }

  // Pre-normalize Option Analysis header
  out = out.replace(/\b(Option\s+Analysis)[:.]?\s*/gi, "$1:\n\n");

  // Separate inline Option A/B/C/D that follow sentence end (.!?)
  out = out.replace(
    /(?<=[.!?])\s+(?:•\s*)?Option\s+([A-D])\b(?!\s*nalysis)/gi,
    "\n\nOption $1"
  );

  const itemRe = /(?:^|\n)\s*(?:•\s*)?Option\s+([A-D])\b(?!\s*nalysis)[:.\-\s]*/gi;
  const matches = [];
  const seenLetters = new Set();
  let m;
  while ((m = itemRe.exec(out)) !== null) {
    const letter = m[1].toUpperCase();
    if (!seenLetters.has(letter)) {
      seenLetters.add(letter);
      matches.push({
        letter,
        start: m.index,
        headerLen: m[0].length,
      });
    }
  }

  if (matches.length < 2) return text;

  const prefix = out.slice(0, matches[0].start).trim();
  const blocks = [];
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const next = matches[i + 1];
    const blockEnd = next ? next.start : out.length;
    let body = out.slice(cur.start + cur.headerLen, blockEnd).trim();
    body = body.replace(/^[:.\-]\s*/, "");
    blocks.push({
      letter: cur.letter,
      body,
    });
  }

  blocks.sort((a, b) => a.letter.localeCompare(b.letter));
  const sortedBody = blocks
    .map((b) => `Option ${b.letter}: ${b.body}`)
    .join("\n\n");

  let result = prefix ? `${prefix}\n\n${sortedBody}` : sortedBody;
  if (conclusion) result += `\n\n${conclusion}`;
  return result;
};

/**
 * Auto-restore English indefinite article (A/An) and ensure proper capitalization.
 */
export const autoFixOptionArticles = (options = []) => {
  return (options || []).map((o) => {
    const isObj = typeof o === "object" && o !== null;
    let text = isObj ? o.text || "" : String(o || "");
    text = stripOptionLabelPrefix(text);

    if (/^[a-z]/.test(text)) {
      if (
        /^(?:online|independent|open|automated|adaptive|efficient|authoritative|encyclopedic|on-demand|e-commerce|enterprise|agricultural|environmental|animation)\b/i.test(
          text
        )
      ) {
        text = "An " + text;
      } else if (
        /^(?:healthcare|fashion|municipal|corporate|social|researcher|commercial|software|dark-store|hospital|logistics|university|digital|cash-flush|painter|novelist|mobile|rideshare|cloud|public|coalition|pharmaceutical|manufacturing|ride-hailing|retail|global|technology|financial|tech|biotech|marketing|smart|decentralized|venture|traditional|film|fitness|firm|dominant|sovereign|robust)\b/i.test(
          text
        )
      ) {
        text = "A " + text;
      } else {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }
    }
    return isObj ? { ...o, text } : text;
  });
};

/**
 * Format statement-based questions so that:
 * 1. Intro and statements are on separate lines.
 * 2. Statements are properly formatted as a numbered list.
 * 3. Final question is displayed on a separate line after the statements.
 */
export const formatStatementBasedQuestion = (text) => {
  if (!text || typeof text !== "string") return text;
  let s = text.trim();
  if (!s) return "";

  const closingQuestionPatterns = [
    /(?:Which(?:\s+of)?(?:\s+the)?(?:\s+above|\s+following)?\s+statements?\b[^\n?]*\?)/i,
    /(?:How\s+many\s+of\s+the\s+(?:statements|pairs|options)\b[^\n?]*\?)/i,
    /(?:Which\s+one\s+of\s+the\s+following\b[^\n?]*\?)/i,
    /(?:Which\s+of\s+the\s+following\b[^\n?]*\?)/i,
    /(?:Which\s+of\s+the\s+above\b[^\n?]*\?)/i,
    /(?:Which\s+mode\s+of\s+inheritance\b[^\n?]*\?)/i,
    /(?:Select\s+(?:the\s+)?(?:correct|appropriate|incorrect|increasing|decreasing)\b[^\n.:]*[.:?])/i,
    /(?:Choose\s+the\s+correct\s+answer\b[^\n.:]*[.:?])/i,
  ];

  let closingBlock = "";
  for (const pattern of closingQuestionPatterns) {
    const match = s.match(pattern);
    if (match && match.index != null) {
      const afterMatch = s.slice(match.index + match[0].length).trim();
      if (afterMatch.length <= 25) {
        closingBlock = s.slice(match.index).trim();
        s = s.slice(0, match.index).trim();
        break;
      }
    }
  }

  let firstMarkerMatch = null;
  let statementType = null;

  const numberedMatch = s.match(/(?:[:.]\s*|\n\s*|^)(1\.|1\))\s+/);
  const romanMatch = s.match(
    /(?:[:.]\s*|\n\s*|^)(\([IVXLCDM]+\)|[IVXLCDM]+\.)\s+/i
  );
  const parenMatch = s.match(/(?:[:.]\s*|\n\s*|^)(\(1\))\s+/);
  const dashedMatch = s.match(/(?:[:.]\s*|\n\s*|^)(-\s+[A-Za-z0-9])/);
  const namedMatch = s.match(/(?:[:.]\s*|\n\s*|^)(Statement\s+(?:1|I)[:.]\s+)/i);

  if (numberedMatch && /(?:[\s\n])(2\.|2\))\s+/.test(s)) {
    firstMarkerMatch = numberedMatch;
    statementType = "numbered";
  } else if (
    romanMatch &&
    /(?:[\s\n])(\([IVXLCDM]+\)|[IVXLCDM]+\.)\s+/i.test(s)
  ) {
    firstMarkerMatch = romanMatch;
    statementType = "roman";
  } else if (parenMatch && /(?:[\s\n])\(2\)\s+/.test(s)) {
    firstMarkerMatch = parenMatch;
    statementType = "paren";
  } else if (dashedMatch && /(?:[\s\n])-\s+[A-Za-z0-9]/.test(s)) {
    firstMarkerMatch = dashedMatch;
    statementType = "dashed";
  } else if (namedMatch && /(?:[\s\n])Statement\s+(?:2|II)[:.]\s+/i.test(s)) {
    firstMarkerMatch = namedMatch;
    statementType = "named";
  }

  if (statementType && firstMarkerMatch && firstMarkerMatch.index != null) {
    const marker = firstMarkerMatch[1] || firstMarkerMatch[0].trim();
    const markerIndex = s.indexOf(marker, firstMarkerMatch.index);
    const intro = markerIndex > 0 ? s.slice(0, markerIndex).trim() : "";
    let body = s.slice(markerIndex).trim();

    if (statementType === "numbered") {
      body = body.replace(/([.!?;]|\))\s+(?=\b([2-9]|\d{2})\.\s+)/g, "$1\n");
    } else if (statementType === "roman") {
      let idx = 1;
      body = body.replace(
        /(?:^|\n|\s*)(?:\(([IVXLCDM]+)\)|([IVXLCDM]+)\.)\s+/gi,
        () => {
          const num = idx++;
          return num === 1 ? "1. " : `\n${num}. `;
        }
      );
      body = body.replace(/,\s*\n/g, ".\n");
      body = body.replace(/,\s*and\s*\n/gi, ".\n");
      body = body.replace(/\band\s*\n/gi, "\n");
    } else if (statementType === "paren") {
      let idx = 1;
      body = body.replace(/(?:^|\n|\s*)\((\d+)\)\s+/g, () => {
        const num = idx++;
        return num === 1 ? "1. " : `\n${num}. `;
      });
    } else if (statementType === "dashed") {
      let idx = 1;
      body = body.replace(/(?:^|\n|\s*)-\s+/g, () => {
        const num = idx++;
        return num === 1 ? "1. " : `\n${num}. `;
      });
    } else if (statementType === "named") {
      let idx = 1;
      body = body.replace(
        /(?:^|\n|\s*)Statement\s+(?:[1-9]|I|II|III|IV|V)[:.]\s+/gi,
        () => {
          const num = idx++;
          return num === 1 ? "1. " : `\n${num}. `;
        }
      );
    }

    s = intro ? `${intro}\n\n${body.trim()}` : body.trim();
  }

  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (closingBlock) {
    s = `${s.trim()}\n\n${closingBlock.trim()}`;
  }
  return s;
};

/**
 * Format explanation to separate statement analysis, numbered points, and conclusion on separate lines.
 */
export const formatStructuredExplanation = (text) => {
  if (!text || typeof text !== "string") return text;
  let s = text.trim();
  if (!s) return "";

  const conclusionRe =
    /(?<=[.!?])\s+(?=(?:Therefore|Hence|Thus|Consequently|In conclusion)\b[^\n]*)/i;
  let conclusion = "";
  const cMatch = s.match(conclusionRe);
  if (cMatch && cMatch.index != null) {
    conclusion = s.slice(cMatch.index).trim();
    s = s.slice(0, cMatch.index).trim();
  }

  const hasStatementBreakdown =
    /(?:^|[\s\n])(?:Statement\s+1|1\.\s+Statement\s+1)\b.+?(?:[\s\n])(?:Statement\s+2|2\.\s+Statement\s+2)\b/is.test(
      s
    );
  const hasNumberedList = /(?:^|[\s\n])1\.\s+.+?(?:[\s\n])2\.\s+/s.test(s);
  const hasStepList = /(?:^|[\s\n])Step\s+1[:.]\s+.+?(?:[\s\n])Step\s+2[:.]\s+/is.test(
    s
  );
  const hasOptionList = /(?:^|[\s\n])Option\s+[A-D][:.]\s+.+?(?:[\s\n])Option\s+[A-D][:.]\s+/is.test(
    s
  );

  if (hasStatementBreakdown) {
    let idx = 1;
    s = s
      .replace(
        /(^|[.!?]\s+)(?:(\d+)\.\s*)?Statement\s+(\d+|I|II|III|IV)\b/gi,
        (_match, prefix) => {
          const punct = prefix.trim();
          const num = idx++;
          const p = punct ? `${punct}\n` : "";
          return `${p}${num}. Statement ${num}`;
        }
      )
      .trim();
  } else if (hasNumberedList) {
    s = s.replace(/([.!?])\s+(?=\b([2-9]|\d{2})\.\s+)/g, "$1\n");
  } else if (hasStepList) {
    s = s.replace(/([.!?])\s+(?=Step\s+\d+[:.]\s+)/gi, "$1\n\n");
  } else if (hasOptionList) {
    s = s.replace(/([.!?])\s+(?=Option\s+[A-D][:.]\s+)/gi, "$1\n");
  }

  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (conclusion) {
    s = `${s.trim()}\n\n${conclusion.trim()}`;
  }
  return s;
};

/**
 * Single publish contract: sanitize → strip tails → align → normalize headers → sort A-B-C-D → format structure.
 */
export const finalizeExplanationForPublish = (locked = {}) => {
  const marked = locked.correctAnswer ?? locked.answerKey;
  let explanation = String(locked.explanation || locked._verifiedSolution || "");
  if (!explanation) return { ...locked, explanation: "" };

  explanation = normalizeBackslashEscapes(explanation);
  explanation = sanitizeExplanationText(explanation);
  explanation = stripCorruptedOptionFragments(explanation);
  explanation = alignExplanationToMarkedAnswer(explanation, marked);
  explanation = normalizeOptionAnalysisHeaders(explanation);
  explanation = sortExplanationOptionAnalysis(explanation);
  explanation = stripCorruptedOptionFragments(explanation);
  explanation = alignExplanationToMarkedAnswer(explanation, marked);
  explanation = stripCorruptedOptionFragments(explanation);
  explanation = normalizeBackslashEscapes(explanation);
  explanation = formatStructuredExplanation(explanation);

  return {
    ...locked,
    explanation,
    ...(locked._verifiedSolution != null
      ? { _verifiedSolution: explanation }
      : {}),
  };
};

export const polishExplanationForPublish = (text, marked) =>
  alignExplanationToMarkedAnswer(text, marked);

export default {
  alignExplanationToMarkedAnswer,
  sanitizeExplanationText,
  sanitizeExplanationLatex,
  normalizeBackslashEscapes,
  remapExplanationOptionLetters,
  stripClosingVerdicts,
  stripCorruptedOptionFragments,
  polishExplanationForPublish,
  finalizeExplanationForPublish,
  normalizeOptionAnalysisHeaders,
  normalizeMarkedLetters,
  explanationRemapMismatch,
  extractOptionAnalysisBlocks,
  tokenizeForOverlap,
  jaccardOverlap,
  sortExplanationOptionAnalysis,
  autoFixOptionArticles,
  stripOptionLabelPrefix,
  formatStatementBasedQuestion,
  formatStructuredExplanation,
};
