/**
 * Post-o3 copy-edit for explanations.
 * Fixes spelling / grammar / broken sentences only — never re-solves or changes the key.
 */

import { callOpenAIReasoningJson } from "./openaiReasoningChat.service.js";
import {
  alignExplanationToMarkedAnswer,
  sanitizeExplanationText,
} from "../utils/explanationAnswerAlign.js";

const isEnabled = () => {
  const v = String(process.env.PAPER_EXPLANATION_POLISH ?? "1")
    .trim()
    .toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
};

const getPolishModel = () =>
  String(
    process.env.PAPER_EXPLANATION_POLISH_MODEL || "gpt-5.6-luna"
  ).trim() || "gpt-5.6-luna";

const getPolishEffort = () =>
  String(process.env.PAPER_EXPLANATION_POLISH_EFFORT || "low")
    .trim()
    .toLowerCase() || "low";

const getPolishTimeoutMs = () =>
  Math.max(
    15_000,
    Math.min(
      120_000,
      Number(process.env.PAPER_EXPLANATION_POLISH_TIMEOUT_MS || 75_000)
    )
  );

const getPolishMaxTokens = () =>
  Math.max(
    800,
    Math.min(
      8000,
      Number(process.env.PAPER_EXPLANATION_POLISH_MAX_TOKENS || 4000)
    )
  );

const markedLabel = (marked) => {
  if (Array.isArray(marked)) return marked.join(",");
  return String(marked || "").trim().toUpperCase();
};

/**
 * @param {object} args
 * @param {string} args.explanation
 * @param {string|string[]} args.markedAnswer
 * @param {object} [args.ctx] pipeline log / usage / jobId / seq
 * @returns {Promise<{ explanation: string, polished: boolean, model?: string }>}
 */
export const polishExplanationProse = async ({
  explanation,
  markedAnswer,
  ctx = {},
} = {}) => {
  const raw = String(explanation || "").trim();
  const marked = markedLabel(markedAnswer);
  if (!raw || raw.length < 40) {
    return { explanation: raw, polished: false };
  }
  if (!isEnabled()) {
    return {
      explanation: alignExplanationToMarkedAnswer(raw, marked),
      polished: false,
    };
  }

  const model = getPolishModel();
  const prompt = `You are a strict copy-editor for competitive-exam solution text.

Rewrite the DRAFT so it is clear, grammatical, and correctly spelled.
You may fix:
- spelling and typos
- grammar and punctuation (e.g. "...real time. According to..." — capitalize only at sentence start)
- broken / glued words (e.g. "Bnalysis" → "B. Analysis")
- awkward or run-on sentences
- duplicated closing lines and corrupted tails like "and B. and B.", "nd D. nd D.", or ", and D. , and D." (DELETE them entirely)
- wrong option verdict labels: if the marked key is ${marked || "X"}, every phrase "Option X is correct" MUST use that same letter — never say "Option A is correct" when evaluating Option C unless A is the key
- option walkthrough order: when analysing options, always use A → B → C → D (never D-first or A,D,B,C)

You MUST NOT:
- change the correct option letter(s): ${marked || "(unchanged)"}
- change the mathematical or logical meaning
- add solver meta tags (Locked answer, FINAL_ANSWER, Answer: X, bare [C])
- invent new facts or options
- append fragments like ", and D." or "and B." or "nd C." after the closer

Do not invent or change option letters; a deterministic aligner runs after you and owns the answer key.

Return ONLY JSON:
{"explanation":"polished student-facing solution. Analyse options in A,B,C,D order when present. End with exactly one line: Therefore, the correct option is ${marked || "X"}."}

DRAFT:
${raw}`;

  try {
    const packed = await callOpenAIReasoningJson({
      apiKey: process.env.OPENAI_API_KEY,
      callWithRetries: async (fn) => fn(),
      toError: (e) => e,
      kind: "explanation_polish",
      model,
      reasoningEffort: getPolishEffort(),
      timeoutMs: getPolishTimeoutMs(),
      maxTokens: getPolishMaxTokens(),
      disableFallback: true,
      prompt,
      developerHint:
        "Return ONLY valid JSON with key explanation. Copy-edit only; do not change the answer key.",
      pipelineLog: ctx.pipelineLog,
      recordUsage: ctx.recordUsage,
      jobId: ctx.jobId,
      seq: ctx.seq,
      topicId: ctx.topicId,
      subject: ctx.subject,
      chapter: ctx.chapter,
    });
    const text = typeof packed === "string" ? packed : packed?.text;
    let parsed = null;
    try {
      parsed = JSON.parse(String(text || "").trim());
    } catch {
      const m = String(text || "").match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }
    const polished = String(
      parsed?.explanation || parsed?.text || parsed?.verifiedSolution || ""
    ).trim();
    if (polished.length < 40) {
      ctx.pipelineLog?.("EXPLANATION_POLISH_SKIP", {
        seq: ctx.seq,
        reason: "empty_or_short",
        model,
      });
      return {
        explanation: alignExplanationToMarkedAnswer(
          sanitizeExplanationText(raw),
          marked
        ),
        polished: false,
        model,
      };
    }
    const finalText = alignExplanationToMarkedAnswer(
      sanitizeExplanationText(polished),
      marked
    );
    ctx.pipelineLog?.("EXPLANATION_POLISH_OK", {
      seq: ctx.seq,
      model,
      beforeChars: raw.length,
      afterChars: finalText.length,
    });
    return { explanation: finalText, polished: true, model };
  } catch (err) {
    ctx.pipelineLog?.("EXPLANATION_POLISH_FAIL", {
      seq: ctx.seq,
      model,
      error: err?.message || String(err),
    });
    // Fail open — keep o3 text after local sanitize/align.
    return {
      explanation: alignExplanationToMarkedAnswer(
        sanitizeExplanationText(raw),
        marked
      ),
      polished: false,
      model,
      error: err?.message || String(err),
    };
  }
};

export default { polishExplanationProse };
