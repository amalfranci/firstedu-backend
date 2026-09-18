import ExamPaperPattern from "../models/ExamPaperPattern.js";

const normalizeExamType = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const listExamPaperPatterns = async ({
  examType = "jee_advanced",
  year = 2026,
} = {}) => {
  const query = { isActive: true };
  if (examType) query.examType = normalizeExamType(examType);
  if (year) query.year = Number(year);
  return ExamPaperPattern.find(query).sort({ paperNumber: 1 }).lean();
};

export const findExamPaperPattern = async ({
  examType = "jee_advanced",
  year = 2026,
  paper = 1,
} = {}) => {
  const paperNumber = Number(paper) === 2 ? 2 : 1;
  return ExamPaperPattern.findOne({
    examType: normalizeExamType(examType),
    year: Number(year) || 2026,
    paperNumber,
    isActive: true,
  }).lean();
};

/** Map Mongo / file pattern into generation-friendly counts. */
export const toPaperTypeCounts = (docOrBlock = null, { scale = 1 } = {}) => {
  if (!docOrBlock) {
    return {
      single: 0,
      multi: 0,
      integer: 0,
      match: 0,
      paragraph: 0,
      total: 0,
    };
  }

  if (docOrBlock.typeCounts) {
    const c = docOrBlock.typeCounts;
    return {
      single: Math.round((c.single || 0) * scale),
      multi: Math.round((c.multi || 0) * scale),
      integer: Math.round((c.integer || 0) * scale),
      match: Math.round((c.match || 0) * scale),
      paragraph: Math.round((c.paragraph || 0) * scale),
      total: Math.round((c.total || 0) * scale),
    };
  }

  const single = Math.round(
    (docOrBlock.section_1_single_correct?.questions || 0) * scale
  );
  const multi = Math.round(
    (docOrBlock.section_2_multi_correct?.questions || 0) * scale
  );
  const integer = Math.round(
    (docOrBlock.section_3_numerical?.questions || 0) * scale
  );
  const match = Math.round(
    (docOrBlock.section_4_match_list?.questions || 0) * scale
  );
  const paragraph = Math.round(
    (docOrBlock.section_5_paragraph?.questions || 0) * scale
  );
  return {
    single,
    multi,
    integer,
    match,
    paragraph,
    total: single + multi + integer + match + paragraph,
  };
};

export const summarizeExamPapers = (papers = []) => {
  if (!papers.length) return null;
  const first = papers[0];
  const quick = first.quickComparison || null;
  const subjectCounts = {};
  if (quick && typeof quick === "object") {
    for (const [key, val] of Object.entries(quick)) {
      if (!val || typeof val !== "object") continue;
      const q =
        Number(val.questions) ||
        Number(val.scored) ||
        Number(val.scored_convention) ||
        0;
      if (q > 0) subjectCounts[key] = q;
    }
  }
  return {
    examType: first.examType,
    examLabel: first.examLabel,
    year: first.year,
    examDate: first.examDate,
    examDateLabel: first.examDateLabel,
    mandatoryBothPapers: Boolean(first.mandatoryBothPapers),
    subjects: first.subjects || [],
    subjectCounts,
    papers: papers.map((p) => ({
      paperNumber: p.paperNumber,
      paperKey: p.paperKey,
      paperLabel: p.paperLabel,
      session: p.session,
      startTime: p.startTime,
      endTime: p.endTime,
      durationMinutes: p.durationMinutes,
      totalMarks: p.totalMarks,
      totalQuestions: p.totalQuestions,
      questionsPerSubject: p.questionsPerSubject,
      formats: p.formats || [],
      overallDifficulty: p.overallDifficulty || "",
      typeCounts: p.typeCounts || toPaperTypeCounts(p),
      sections: p.sections || [],
    })),
    quickComparison: quick,
  };
};
