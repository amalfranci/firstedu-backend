import { describe, it, expect } from "@jest/globals";
import { mapScoringEntry } from "../src/utils/seedExamSyllabusPack.js";
import { mapPackTopicToGenerationShape } from "../src/services/examSyllabusPack.service.js";

describe("ExamSyllabusPack scoring mappers", () => {
  it("maps Advanced scoring JSON into portable relevance fields", () => {
    const mapped = mapScoringEntry({
      jee_main_freq_band: "high",
      avg_q_per_session_jee_main: "2-3",
      difficulty_split: { easy: 20, medium: 40, hard: 40 },
      advanced_relevance: "high",
      notes: "matrix proofs",
    });
    expect(mapped.relevance).toBe("high");
    expect(mapped.advancedRelevance).toBe("high");
    expect(mapped.freqBand).toBe("high");
    expect(mapped.difficultySplit.hard).toBe(40);
    expect(mapped.notes).toContain("matrix");
  });

  it("maps pack topic into generation scoring shape", () => {
    const shaped = mapPackTopicToGenerationShape({
      topicId: "M02",
      title: "Complex Numbers",
      classLevel: "11",
      subtopics: ["Polar form"],
      scoring: {
        relevance: "high",
        advancedRelevance: "high",
        freqBand: "medium",
        avgQPerSession: "1-2",
        difficultySplit: { easy: 25, medium: 45, hard: 30 },
        notes: "locus",
      },
    });
    expect(shaped.topicId).toBe("M02");
    expect(shaped.chapter).toBe("Complex Numbers");
    expect(shaped.highLock).toBe(true);
    expect(shaped.scoring.advanced_relevance).toBe("high");
    expect(shaped.scoring.difficulty_split.hard).toBe(30);
  });
});
