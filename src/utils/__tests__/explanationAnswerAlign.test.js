import {
  alignExplanationToMarkedAnswer,
  explanationRemapMismatch,
  finalizeExplanationForPublish,
  normalizeBackslashEscapes,
  remapExplanationOptionLetters,
  sanitizeExplanationText,
  stripCorruptedOptionFragments,
  sortExplanationOptionAnalysis,
  stripOptionLabelPrefix,
  autoFixOptionArticles,
  formatStatementBasedQuestion,
  formatStructuredExplanation,
} from "../explanationAnswerAlign.js";
import {
  applyExplanationQualityGate,
  isOrphanAuthorOrPassageStem,
  optionMentionOrder,
} from "../../services/paperExplanationQualityGate.service.js";

describe("explanationAnswerAlign", () => {
  test("does not turn Option Analysis into Option A. nalysis", () => {
    const input = "Option Analysis shows that B is wrong. Option C is best.";
    const out = sanitizeExplanationText(input);
    expect(out).toContain("Option Analysis");
    expect(out).not.toMatch(/Option A\.\s*nalysis/i);
  });

  test("repairs real glued Option Bnalysis", () => {
    const out = sanitizeExplanationText("Option Bnalysis of the claim fails.");
    expect(out).toMatch(/Option B\.\s*Analysis/i);
    expect(out).not.toMatch(/Option B\.\s*nalysis/i);
  });

  test("mid-body Option B is kept when key is C", () => {
    const out = alignExplanationToMarkedAnswer(
      "Option B fails under scrutiny. Therefore, the correct option is B.",
      "C"
    );
    expect(out).toMatch(/Option B fails/i);
    expect(out).toMatch(/correct option is C/i);
    expect(out).not.toMatch(/correct option is B/i);
  });

  test("remap does not eat Analysis", () => {
    const out = remapExplanationOptionLetters(
      "Option Analysis shows B is wrong. Hence option B is correct.",
      { A: "C", B: "D" }
    );
    expect(out).toContain("Option Analysis");
    expect(out).toMatch(/option D/i);
    expect(out).not.toMatch(/Option Cnalysis/i);
  });

  test("strips Locked answer and Answer markers", () => {
    const out = sanitizeExplanationText(
      "The stem implies X.\nLocked answer: C\nAnswer: C\n[C]\nHence done."
    );
    expect(out).not.toMatch(/Locked answer/i);
    expect(out).not.toMatch(/\bAnswer\s*:\s*C\b/i);
    expect(out).not.toMatch(/^\s*\[C\]\s*$/m);
  });

  test("align ends with a single closer matching the key", () => {
    const out = alignExplanationToMarkedAnswer(
      "Policy C looks attractive. Therefore, the correct option is C.\nTherefore, the correct option is D.",
      "D"
    );
    const closers = out.match(
      /Therefore, the correct option is [A-D]\./gi
    );
    expect(closers?.length).toBe(1);
    expect(out.trim().endsWith("Therefore, the correct option is D.")).toBe(
      true
    );
  });

  test("align rewrites scrambled closing letter", () => {
    const out = alignExplanationToMarkedAnswer(
      "Option B fails under scrutiny. Therefore, the correct option is B.",
      "C"
    );
    expect(out).toMatch(/correct option is C/i);
    expect(out).not.toMatch(/correct option is B/i);
  });

  test("strips duplicated , and D. , and D. tails", () => {
    const out = stripCorruptedOptionFragments(
      "Hence done. Therefore, the correct option is D., and D. , and D."
    );
    expect(out).toMatch(/correct option is D\.\s*$/);
    expect(out).not.toMatch(/,\s*and\s+D\./);
  });

  test("align fixes Option A is correct when key is C", () => {
    const out = alignExplanationToMarkedAnswer(
      "Option C matches the passage claim. Option A is correct. Therefore, the correct option is A.",
      "C"
    );
    expect(out).toMatch(/Option C is correct/i);
    expect(out).not.toMatch(/Option A is correct/i);
    expect(out.trim().endsWith("Therefore, the correct option is C.")).toBe(
      true
    );
  });

  test("align does not rewrite Option A is incorrect", () => {
    const out = alignExplanationToMarkedAnswer(
      "Option A is incorrect. Option C fits. Therefore, the correct option is C.",
      "C"
    );
    expect(out).toMatch(/Option A is incorrect/i);
    expect(out).toMatch(/correct option is C/i);
  });

  test("multi-correct keeps C and D verdicts (no collapse to A)", () => {
    const out = alignExplanationToMarkedAnswer(
      [
        "Option Analysis",
        "Option A is correct. Standardising fails when models use historical data.",
        "Option B is incorrect. The author does not abandon algorithms.",
        "Option C is correct because raw predictive accuracy deepens homogeneity.",
        "Option D is correct. Firms must recalibrate for diversity.",
        ", and D. , and D.",
        "Therefore, the correct options are A and B.",
      ].join(" "),
      "A,C,D"
    );
    expect(out).toMatch(/Option A is correct/i);
    expect(out).toMatch(/Option C is correct/i);
    expect(out).toMatch(/Option D is correct/i);
    expect(out).toMatch(/Option B is incorrect/i);
    // Orphan tail gone; legitimate closer "A, C, and D." may remain.
    expect(out.replace(/Therefore[\s\S]*$/, "")).not.toMatch(/,\s*and\s+D\./);
    expect(out).toMatch(
      /Therefore, the correct options are A, C, and D\.\s*$/
    );
  });

  test("multi-correct rewrites Option B is correct when B not in key", () => {
    const out = alignExplanationToMarkedAnswer(
      "Option A is correct. Option B is correct. Option C is correct. Therefore, the correct options are A and C.",
      "A,C"
    );
    expect(out).toMatch(/Option B is incorrect/i);
    expect(out).toMatch(/Option A is correct/i);
    expect(out).toMatch(/Option C is correct/i);
    expect(out).toMatch(/Therefore, the correct options are A and C\.\s*$/);
  });

  test("finalizeExplanationForPublish strips tails and aligns", () => {
    const locked = finalizeExplanationForPublish({
      correctAnswer: "C",
      explanation:
        "Option Analysis\nA. Weak claim.\nC. Strong claim. Option A is correct. Therefore, the correct option is A., and D. , and D.",
    });
    expect(locked.explanation).toMatch(/Option C is correct/i);
    expect(locked.explanation).not.toMatch(/Option A is correct/i);
    expect(locked.explanation).not.toMatch(/,\s*and\s+D\./);
    expect(locked.explanation).toMatch(/correct option is C/i);
  });

  test("explanationRemapMismatch detects B/D content swap", () => {
    const options = [
      "manufacturing firm reducing its operational carbon footprint",
      "renewable energy startup experiencing market volatility because institutional funds",
      "An investment firm failing to generate competitive financial returns",
      "tech corporation redesigning its reporting framework to maximize score gains from ESG algorithms",
    ];
    const explanation = [
      "Option Analysis",
      "A. The firm actually lowers its carbon footprint for green-bond financing.",
      "B. The tech corporation re-engineers only its reporting while its carbon-intensive supply chain stays the same.",
      "C. The investment firm underperforms from excluding fossil-fuel stocks.",
      "D. The renewable energy startup volatility is due to capital preference for blue-chip stocks.",
      "Therefore, the correct option is D.",
    ].join("\n");
    const result = explanationRemapMismatch(explanation, options);
    expect(result.mismatch).toBe(true);
    expect(result.reason).toMatch(/label_content_swap|duplicate/);
  });

  test("explanationRemapMismatch detects duplicate analysis letters", () => {
    const options = ["alpha one unique", "beta two unique", "gamma three unique", "delta four unique"];
    const explanation = [
      "D. Replacing human screeners removes scrutiny with alpha wording unused.",
      "B. Mandating periodic audits recalibrates beta parameters for fairness.",
      "C. Abandoning algorithms returns to human panels gamma.",
      "D. Feeding the algorithm more historical data entrenches delta biases.",
    ].join("\n");
    const result = explanationRemapMismatch(explanation, options);
    expect(result.mismatch).toBe(true);
    expect(result.reason).toBe("duplicate_analysis_letter");
  });

  test("quality gate cleans corrupted tail and wrong verdict", () => {
    const { locked, issues } = applyExplanationQualityGate({
      correctAnswer: "C",
      options: ["a", "b", "c", "d"],
      explanation:
        "Option C is strongest. Option A is correct. Therefore, the correct option is A., and D. , and D.",
    });
    expect(locked.explanation).toMatch(/Option C is correct/i);
    expect(locked.explanation).not.toMatch(/Option A is correct/i);
    expect(locked.explanation).not.toMatch(/,\s*and\s+D\./);
    expect(locked.explanation).toMatch(/correct option is C/i);
    expect(issues).toEqual(
      expect.arrayContaining([
        "explanation_corrupted_option_tail",
        "explanation_wrong_option_verdict",
      ])
    );
  });

  test("quality gate flags out-of-order option mentions", () => {
    const text =
      "Option D is weak. Option A fails. Option B is partial. Option C fits.";
    expect(optionMentionOrder(text)).toEqual(["D", "A", "B", "C"]);
    const { issues } = applyExplanationQualityGate({
      correctAnswer: "C",
      options: ["a", "b", "c", "d"],
      explanation: `${text} Therefore, the correct option is C.`,
    });
    expect(issues.some((i) => i.startsWith("explanation_option_order"))).toBe(
      true
    );
  });

  test("orphan author stem without passage is a hard fail", () => {
    expect(
      isOrphanAuthorOrPassageStem({
        questionText:
          "which of the following organizational practices would the author support?",
        passage: "",
        explanation: "The author highlights private focus zones.",
        options: ["a", "b", "c", "d"],
      })
    ).toBe(true);

    expect(
      isOrphanAuthorOrPassageStem({
        questionText:
          "which of the following scenarios best exemplifies this strategy applied to a new domain?",
        passage: "",
        explanation: "The passage defines algorithmic enclosure.",
      })
    ).toBe(true);

    expect(
      isOrphanAuthorOrPassageStem({
        questionText:
          "Which of the following decisions by a fund manager best reflects the ultimate conclusion reached in the passage?",
        passage: "",
      })
    ).toBe(true);

    const { ok, issues, locked } = applyExplanationQualityGate({
      questionText:
        "which of the following organizational practices would the author support?",
      passage: "",
      correctAnswer: "A,C",
      options: ["a", "b", "c", "d"],
      explanation:
        "The author highlights private focus zones and temporal boundaries. Option A is correct. Option C is correct. Option B is incorrect. Option D is incorrect. Therefore, the correct options are A and C.",
    });
    expect(issues).toEqual(
      expect.arrayContaining(["stem_orphan_author_or_passage"])
    );
    expect(ok).toBe(false);
    expect(locked._productionReady).toBe(false);
    expect(locked._needsReview).toBe(true);
  });

  test("embedded passage stem is not orphan", () => {
    expect(
      isOrphanAuthorOrPassageStem({
        questionText:
          "Read the short passage and answer: Initial enthusiasm for algorithmic hiring tools stemmed from meritocracy. Which practice aligns with the author's prescription?",
        passage: "",
        explanation: "The author wants human audits.",
      })
    ).toBe(false);
  });

  test("stripOptionLabelPrefix preserves English indefinite article 'A '", () => {
    expect(stripOptionLabelPrefix("A healthcare system that deploys AI")).toBe(
      "A healthcare system that deploys AI"
    );
    expect(stripOptionLabelPrefix("A) A healthcare system that deploys AI")).toBe(
      "A healthcare system that deploys AI"
    );
    expect(stripOptionLabelPrefix("Option A: A municipal transit authority")).toBe(
      "A municipal transit authority"
    );
    expect(stripOptionLabelPrefix("(A) A fashion designer")).toBe(
      "A fashion designer"
    );
    expect(stripOptionLabelPrefix("B) An automated pricing engine")).toBe(
      "An automated pricing engine"
    );
  });

  test("autoFixOptionArticles restores missing English articles and capitalizes", () => {
    const raw = [
      "healthcare system that deploys specialized equipment",
      "fashion designer who uses AI to generate patterns",
      "municipal transit authority that uses sensors",
      "An e-commerce platform that inflates prices",
    ];
    const fixed = autoFixOptionArticles(raw);
    expect(fixed[0]).toBe("A healthcare system that deploys specialized equipment");
    expect(fixed[1]).toBe("A fashion designer who uses AI to generate patterns");
    expect(fixed[2]).toBe("A municipal transit authority that uses sensors");
    expect(fixed[3]).toBe("An e-commerce platform that inflates prices");
  });

  test("sortExplanationOptionAnalysis sequences paragraphs strictly A -> B -> C -> D", () => {
    const text =
      "Option Analysis: Option C is historical bias. Option D is a precise parallel. Option A describes a one-time policy. Option B involves surge pricing. Therefore, the correct option is D.";
    const sorted = sortExplanationOptionAnalysis(text);
    const order = [...sorted.matchAll(/Option\s+([A-D]):/g)].map((m) => m[1]);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(sorted).toMatch(/Therefore, the correct option is D\.$/);
  });

  test("normalizeBackslashEscapes collapses runs of escaped backslashes and repairs \\ eq artifacts", () => {
    const raw =
      "Given \\\\\\\\\\\\\\\\\\\\\\frac{a}{b} and \\\\\\\\\\\\\\\\\\\\\\dfrac{c}{d} where 21\\ eq25 and k(k\\ eq 0) while \\\\\\\\ line break.";
    const fixed = normalizeBackslashEscapes(raw);
    expect(fixed).toContain("\\frac{a}{b}");
    expect(fixed).toContain("\\dfrac{c}{d}");
    expect(fixed).toContain("21\\neq 25");
    expect(fixed).toContain("k(k\\neq 0)");
    expect(fixed).toContain("\\\\ line break");
    expect(fixed).not.toContain("\\\\\\\\\\\\\\\\\\\\\\frac");
  });

  test("finalizeExplanationForPublish collapses escaped backslashes and normalizes \\ eq to \\neq", () => {
    const locked = finalizeExplanationForPublish({
      explanation:
        "Step 1: Compute \\\\\\\\\\\\\\\\\\\\\\frac{2.303 RT}{F} = 0.06. Here Q = \\\\\\\\\\\\\\\\\\\\\\dfrac{[Zn^{2+}]}{[Cu^{2+}]} = 10. Also note 18\\cdot\\frac76=21\\ eq25. Option Analysis: Option A: The standard cell potential is +1.10 V. Option B: Cell potential is 1.07 V.",
      correctAnswer: "A, B",
    });
    expect(locked.explanation).toContain("\\frac{2.303 RT}{F}");
    expect(locked.explanation).toContain("\\dfrac{[Zn^{2+}]}{[Cu^{2+}]}");
    expect(locked.explanation).toContain("21\\neq 25");
    expect(locked.explanation).not.toContain("\\\\\\\\\\\\\\\\\\\\\\frac");
    expect(locked.explanation).not.toContain("\\ eq");
  });

  test("formatStatementBasedQuestion formats question intro, numbered statements, and final question on separate lines", () => {
    const raw =
      "Consider the following statements regarding ancient Indian philosophical schools: 1. The Sautrantika and Sammitiya were prominent sects of Jainism that debated the nature of the soul. 2. The Lokayata school explicitly rejected the existence of an afterlife, karma, and the authority of the Vedas. Which of the statements given above is/are correct?";
    const formatted = formatStatementBasedQuestion(raw);
    const lines = formatted.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toBe(
      "Consider the following statements regarding ancient Indian philosophical schools:"
    );
    expect(lines[1]).toMatch(
      /^1\. The Sautrantika and Sammitiya were prominent sects of Jainism/
    );
    expect(lines[2]).toMatch(
      /^2\. The Lokayata school explicitly rejected the existence of an afterlife/
    );
    expect(lines[3]).toBe(
      "Which of the statements given above is/are correct?"
    );
  });

  test("formatStructuredExplanation formats statement breakdowns and separates conclusion", () => {
    const raw =
      "Statement 1 is correct as Ramanujacharya propounded Visishtadvaita Vedanta. Statement 2 is incorrect because Visishtadvaita asserts that souls and the physical universe form an inseparable part of the supreme reality (Brahman), rather than being completely independent or devoid of connection. Therefore, the correct option is A.";
    const formatted = formatStructuredExplanation(raw);
    const lines = formatted.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toMatch(
      /^1\. Statement 1 is correct as Ramanujacharya propounded Visishtadvaita/
    );
    expect(lines[1]).toMatch(
      /^2\. Statement 2 is incorrect because Visishtadvaita asserts that souls/
    );
    expect(lines[2]).toBe("Therefore, the correct option is A.");
  });
});
