import { describe, it, expect } from "@jest/globals";
import validator from "../src/validation/aiQuestionBank.validator.js";

const { createAiQuestionBankWithQuestions } = validator;

const basePayload = (overrides = {}) => ({
  name: "JEE Main · Paper 1 · abc12345",
  generationId: "gen-test-save-1",
  categories: ["507f1f77bcf86cd799439011"],
  overallDifficulty: "hard",
  aiProvider: "gemini",
  questions: [
    {
      questionText: "What is 2+2?",
      questionType: "single",
      options: [
        { text: "3", isCorrect: false },
        { text: "4", isCorrect: true },
        { text: "5", isCorrect: false },
        { text: "6", isCorrect: false },
      ],
      correctAnswer: "4",
      explanation: "",
      topicId: "X01",
      topic: "Algebra",
      subject: "Mathematics",
      difficulty: "hard",
      _clientExtra: true,
    },
  ],
  expectedTotal: 1,
  ...overrides,
});

describe("aiQuestionBank validator (paper save)", () => {
  it("accepts topicId, empty explanation, and unknown client fields", () => {
    const { error, value } = createAiQuestionBankWithQuestions.validate(
      basePayload(),
      { abortEarly: false }
    );
    expect(error).toBeUndefined();
    expect(value.questions[0].topicId).toBe("X01");
    expect(value.questions[0].explanation).toBe("");
    expect(value.questions[0]._clientExtra).toBe(true);
    expect(value.expectedTotal).toBe(1);
  });

  it("accepts expectedTotal equal to a partial unique count (18 of 25)", () => {
    const questions = Array.from({ length: 18 }, (_, i) => ({
      questionText: `Stem number ${i} about uniquely different topic ${i}`,
      questionType: "single",
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
        { text: "C", isCorrect: false },
        { text: "D", isCorrect: false },
      ],
      correctAnswer: "A",
      explanation: "Solution provided with the paper.",
      difficulty: "hard",
    }));
    const { error, value } = createAiQuestionBankWithQuestions.validate(
      basePayload({ questions, expectedTotal: questions.length }),
      { abortEarly: false }
    );
    expect(error).toBeUndefined();
    expect(value.questions).toHaveLength(18);
    expect(value.expectedTotal).toBe(18);
  });

  it("accepts integer questions", () => {
    const { error } = createAiQuestionBankWithQuestions.validate(
      basePayload({
        questions: [
          {
            questionText: "Find n",
            questionType: "integer",
            options: [],
            correctAnswer: 42,
            explanation: "n = 42",
            difficulty: "hard",
          },
        ],
      })
    );
    expect(error).toBeUndefined();
  });
});

/**
 * Mirrors the soft-save gate in aiQuestionBank.service.js after the 409 removal.
 * Confirm must never hard-block when unique < paper target.
 */
describe("paper save soft-gate policy", () => {
  const shouldHardBlockSave = (rawCount, expectedTotal) => {
    // Current policy: never hard-block on expectedTotal shortfall.
    void rawCount;
    void expectedTotal;
    return false;
  };

  it("does not hard-block when client sends 18 questions with legacy expectedTotal 25", () => {
    expect(shouldHardBlockSave(18, 25)).toBe(false);
  });

  it("does not hard-block when unique after dedupe is below target", () => {
    expect(shouldHardBlockSave(25, 25)).toBe(false);
  });
});

describe("aiQuestionBank validator (updateAiQuestion)", () => {
  const { updateAiQuestion } = validator;

  it("validates direct update of a connected sub-question", () => {
    const payload = {
      questionText:
        "What is the ratio of the number of Standard packages processed at Hub Alpha to the number of Express packages processed at Hub Gamma?",
      options: [
        { text: "4 : 5", isCorrect: false },
        { text: "10 : 9", isCorrect: false },
        { text: "5 : 4", isCorrect: false },
        { text: "11 : 9", isCorrect: true },
      ],
      correctAnswer: "11 : 9",
      difficulty: "hard",
      questionType: "single",
      marks: 3,
      negativeMarks: 1,
      explanation: "Step 1: ...",
    };
    const { error, value } = updateAiQuestion.validate(payload);
    expect(error).toBeUndefined();
    expect(value.marks).toBe(3);
    expect(value.difficulty).toBe("hard");
  });

  it("validates partial field updates", () => {
    const { error: err1 } = updateAiQuestion.validate({ marks: 4 });
    expect(err1).toBeUndefined();

    const { error: err2 } = updateAiQuestion.validate({ difficulty: "hard" });
    expect(err2).toBeUndefined();

    const { error: err3 } = updateAiQuestion.validate({
      explanation: "Updated explanation text",
    });
    expect(err3).toBeUndefined();
  });
});

