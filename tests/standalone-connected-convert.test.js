import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Mock repositories and guards before importing service
jest.unstable_mockModule("../src/repository/question.repository.js", () => ({
  default: {
    findById: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    findByIds: jest.fn(),
    deleteById: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/repository/questionBank.repository.js", () => ({
  default: {
    findById: jest.fn(),
    updateById: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/utils/bankUsageGuard.js", () => ({
  assertBankNotInUse: jest.fn().mockResolvedValue(true),
}));

const { updateQuestion } = await import("../src/services/question.service.js");
const questionRepository = (await import("../src/repository/question.repository.js")).default;

describe("updateQuestion - Standalone to Connected Conversion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("successfully converts a standalone question to a connected parent question", async () => {
    const existingQuestion = {
      _id: "q-standalone-1",
      questionText: "Original standalone text",
      questionType: "single",
      isParent: false,
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
      ],
      subject: "Math",
      topic: "Algebra",
      difficulty: "medium",
      marks: 1,
      negativeMarks: 0,
      questionBank: "bank-1",
    };

    questionRepository.findById.mockResolvedValue(existingQuestion);

    const createdChildId = "child-sub-1";
    questionRepository.create.mockResolvedValue({
      _id: createdChildId,
      questionText: "Sub-question 1",
    });

    questionRepository.updateById.mockImplementation((id, data) => ({
      _id: id,
      ...existingQuestion,
      ...data,
    }));

    questionRepository.findByIds.mockResolvedValue([
      {
        _id: createdChildId,
        questionText: "Sub-question 1",
        questionType: "single",
        options: [
          { text: "Opt 1", isCorrect: true },
          { text: "Opt 2", isCorrect: false },
        ],
        correctAnswer: "Opt 1",
        explanation: "Exp 1",
        marks: 2,
        negativeMarks: 0.5,
      },
    ]);

    const updatePayload = {
      questionType: "connected",
      paragraph: "This is the reading passage for the connected block.",
      title: "Connected Block Title",
      subQuestions: [
        {
          questionText: "Sub-question 1",
          questionType: "single",
          options: [
            { text: "Opt 1", isCorrect: true },
            { text: "Opt 2", isCorrect: false },
          ],
          correctAnswer: "Opt 1",
          explanation: "Exp 1",
          marks: 2,
          negativeMarks: 0.5,
        },
      ],
    };

    const result = await updateQuestion("q-standalone-1", updatePayload);

    expect(result).toBeDefined();
    expect(result.questionType).toBe("connected");
    expect(result.isParent).toBe(true);
    expect(result.subQuestions).toHaveLength(1);
    expect(result.subQuestions[0].questionText).toBe("Sub-question 1");

    // Verify sub-question was created with parentQuestionId
    expect(questionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentQuestionId: "q-standalone-1",
        questionText: "Sub-question 1",
      })
    );

    // Verify parent was updated to connected and parent fields set
    expect(questionRepository.updateById).toHaveBeenCalledWith(
      "q-standalone-1",
      expect.objectContaining({
        questionType: "connected",
        isParent: true,
        childQuestions: [createdChildId],
        marks: 2,
        negativeMarks: 0.5,
      })
    );
  });

  it("rejects converting a sub-question into a connected parent question", async () => {
    const existingChildQuestion = {
      _id: "child-1",
      parentQuestionId: "parent-block-1",
      isParent: false,
      questionType: "single",
    };

    questionRepository.findById.mockResolvedValue(existingChildQuestion);

    const updatePayload = {
      questionType: "connected",
      paragraph: "Passage",
      subQuestions: [
        {
          questionText: "Sub 1",
          questionType: "single",
          options: [
            { text: "A", isCorrect: true },
            { text: "B", isCorrect: false },
          ],
          explanation: "Exp",
        },
      ],
    };

    await expect(updateQuestion("child-1", updatePayload)).rejects.toThrow(
      "Sub-questions cannot be converted into connected parent questions"
    );
  });

  it("rejects connected edit if no subQuestions are provided on standalone question", async () => {
    const existingQuestion = {
      _id: "q-standalone-2",
      questionType: "single",
      isParent: false,
    };

    questionRepository.findById.mockResolvedValue(existingQuestion);

    const updatePayload = {
      questionType: "connected",
      paragraph: "Passage with no subQuestions",
    };

    await expect(updateQuestion("q-standalone-2", updatePayload)).rejects.toThrow(
      "Connected questions must include at least one sub-question"
    );
  });

  it("successfully converts a connected parent question back to a standalone question", async () => {
    const existingConnectedParent = {
      _id: "parent-1",
      questionType: "connected",
      isParent: true,
      passage: "Old passage",
      childQuestions: ["child-1", "child-2"],
    };

    questionRepository.findById.mockResolvedValue(existingConnectedParent);
    questionRepository.deleteById.mockResolvedValue(true);
    questionRepository.updateById.mockImplementation((id, data) => ({
      _id: id,
      ...data,
    }));

    const updatePayload = {
      questionType: "single",
      questionText: "Reverted to standalone",
      options: [
        { text: "Option A", isCorrect: true },
        { text: "Option B", isCorrect: false },
      ],
      correctAnswer: "Option A",
    };

    const result = await updateQuestion("parent-1", updatePayload);

    expect(result).toBeDefined();
    expect(result.questionType).toBe("single");
    expect(result.isParent).toBe(false);

    // Verify existing child questions were cleaned up
    expect(questionRepository.deleteById).toHaveBeenCalledWith("child-1");
    expect(questionRepository.deleteById).toHaveBeenCalledWith("child-2");
  });
});

