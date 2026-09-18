import { describe, it, expect } from "@jest/globals";
import {
  normalizeExamType,
  canonicalizeSubject,
  inferExamAndSubject,
} from "../src/services/aiPoweredTestExamTopics.service.js";
import { getAdvancedPaperTypeCounts } from "../src/services/jeeAdvancedMaths.service.js";

describe("ai-powered-test exam topics helpers", () => {
  it("normalizes exam aliases", () => {
    expect(normalizeExamType("JEE Main")).toBe("jee_main");
    expect(normalizeExamType("jee-advanced")).toBe("jee_advanced");
    expect(normalizeExamType("NEET UG")).toBe("neet");
    expect(normalizeExamType("GMAT Focus")).toBe("gmat");
    expect(normalizeExamType("CLAT UG")).toBe("clat");
    expect(normalizeExamType("IBPS PO Prelims")).toBe("ibps");
    expect(normalizeExamType("SSC CGL Tier 1")).toBe("ssc_cgl_tier1");
    expect(normalizeExamType("SSC CGL Tier 2")).toBe("ssc_cgl_tier2");
    expect(normalizeExamType("UPSC CSE Prelims")).toBe("upsc");
    expect(normalizeExamType("")).toBe(null);
  });

  it("canonicalizes subject aliases", () => {
    expect(canonicalizeSubject("maths")).toBe("Mathematics");
    expect(canonicalizeSubject("PHYSICS")).toBe("Physics");
    expect(canonicalizeSubject("qa")).toBe("QA");
    expect(canonicalizeSubject("VARC")).toBe("VARC");
    expect(canonicalizeSubject("CAT")).toBe(null);
    expect(canonicalizeSubject("")).toBe(null);
  });

  it("treats exam-as-subject as no subject filter for CAT", () => {
    const inferred = inferExamAndSubject({
      examType: "cat",
      subject: "CAT",
    });
    expect(inferred.examType).toBe("cat");
    expect(inferred.subject).toBe(null);
  });

  it("infers JEE Main Physics from a category path", () => {
    const inferred = inferExamAndSubject({
      categoryPath: "Competitive > JEE Main > Physics",
    });
    expect(inferred.examType).toBe("jee_main");
    expect(inferred.subject).toBe("Physics");
  });

  it("infers JEE Advanced Mathematics from a category path", () => {
    const inferred = inferExamAndSubject({
      categoryPath: "Competitive > JEE Advanced > Mathematics",
    });
    expect(inferred.examType).toBe("jee_advanced");
    expect(inferred.subject).toBe("Mathematics");
  });

  it("infers JEE Advanced Physics from JEE Advance Paper 1 path", () => {
    const inferred = inferExamAndSubject({
      categoryPath:
        "Competitive > Engineering > JEE Advance Paper 1 > Physics",
    });
    expect(inferred.examType).toBe("jee_advanced");
    expect(inferred.subject).toBe("Physics");
    expect(inferred.paperNumber).toBe(1);
  });

  it("infers Paper 2 from JEE Advance Paper 2 path", () => {
    const inferred = inferExamAndSubject({
      categoryPath:
        "Competitive › Engineering › JEE Advance Paper 2 › Chemistry",
    });
    expect(inferred.examType).toBe("jee_advanced");
    expect(inferred.subject).toBe("Chemistry");
    expect(inferred.paperNumber).toBe(2);
  });

  it("prefers explicit examType and subject over the category path", () => {
    const inferred = inferExamAndSubject({
      examType: "jee_advanced",
      subject: "Chemistry",
      categoryPath: "Competitive > JEE Main > Physics",
    });
    expect(inferred.examType).toBe("jee_advanced");
    expect(inferred.subject).toBe("Chemistry");
  });
});

describe("JEE Advanced paper question types", () => {
  it("loads Paper 1 single / multi / integer / match counts (16/subject)", () => {
    const counts = getAdvancedPaperTypeCounts({ paper: 1 });
    expect(counts.single).toBe(4);
    expect(counts.multi).toBe(3);
    expect(counts.integer).toBe(6);
    expect(counts.match).toBe(3);
    expect(counts.paragraph || 0).toBe(0);
    expect(counts.total).toBe(16);
    expect(counts.paperTotalQuestions).toBe(48);
    expect(counts.totalMarks).toBe(180);
  });

  it("loads Paper 2 single / multi / integer / paragraph counts (18/subject)", () => {
    const counts = getAdvancedPaperTypeCounts({ paper: 2 });
    expect(counts.single).toBe(4);
    expect(counts.multi).toBe(4);
    expect(counts.integer).toBe(6);
    expect(counts.match || 0).toBe(0);
    expect(counts.paragraph).toBe(4);
    expect(counts.total).toBe(18);
    expect(counts.paperTotalQuestions).toBe(54);
    expect(counts.totalMarks).toBe(180);
  });
});
