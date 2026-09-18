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

  it("maps JEE Main very-high freq band to high relevance", () => {
    const mapped = mapScoringEntry({
      jee_main_freq_band: "very high",
      avg_q_per_session_jee_main: "2-3",
    });
    expect(mapped.relevance).toBe("high");
    expect(mapped.freqBand).toBe("very high");
    expect(mapped.avgQPerSession).toBe("2-3");
  });

  it("maps NEET freq bands including medium-high and low-medium", () => {
    const highish = mapScoringEntry({
      neet_freq_band: "very high",
      avg_q_per_session_neet: "3-4",
    });
    expect(highish.relevance).toBe("high");
    expect(highish.freqBand).toBe("very high");
    expect(highish.avgQPerSession).toBe("3-4");

    const midHigh = mapScoringEntry({ neet_freq_band: "medium-high" });
    expect(midHigh.relevance).toBe("medium");

    const lowMed = mapScoringEntry({ neet_freq_band: "low-medium" });
    expect(lowMed.relevance).toBe("low");
  });

  it("maps CAT freq band and avg_q_per_slot", () => {
    const mapped = mapScoringEntry({
      cat_freq_band: "very high",
      avg_q_per_slot: "8-10",
    });
    expect(mapped.relevance).toBe("high");
    expect(mapped.freqBand).toBe("very high");
    expect(mapped.avgQPerSession).toBe("8-10");
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
