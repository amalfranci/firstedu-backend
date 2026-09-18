import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExamPaperPattern from "../models/ExamPaperPattern.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveExisting = (candidates) =>
  candidates.find((p) => fs.existsSync(p)) || null;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const SECTION_DEFS = [
  {
    key: "section_1_single_correct",
    type: "single",
    label: "Single Correct",
    order: 1,
  },
  {
    key: "section_2_multi_correct",
    type: "multi",
    label: "Multi-Correct",
    order: 2,
  },
  {
    key: "section_3_numerical",
    type: "integer",
    label: "Numerical / Integer",
    order: 3,
  },
  {
    key: "section_4_match_list",
    type: "match",
    label: "Match the Column",
    order: 4,
  },
  {
    key: "section_5_paragraph",
    type: "paragraph",
    label: "Comprehension / Paragraph",
    order: 5,
  },
];

const buildSections = (paperBlock = {}) =>
  SECTION_DEFS.map((def) => {
    const raw = paperBlock[def.key] || {};
    return {
      key: def.key,
      type: def.type,
      label: def.label,
      questions: Number(raw.questions || 0) || 0,
      options: Number(raw.options || 0) || 0,
      order: def.order,
    };
  }).filter((s) => s.questions > 0 || ["match", "paragraph"].includes(s.type));

const typeCountsFromSections = (sections = []) => {
  const counts = {
    single: 0,
    multi: 0,
    integer: 0,
    match: 0,
    paragraph: 0,
    total: 0,
  };
  for (const s of sections) {
    if (counts[s.type] != null) counts[s.type] += s.questions;
  }
  counts.total =
    counts.single +
    counts.multi +
    counts.integer +
    counts.match +
    counts.paragraph;
  return counts;
};

const upsertPaper = async (payload) =>
  ExamPaperPattern.findOneAndUpdate(
    {
      examType: payload.examType,
      year: payload.year,
      paperNumber: payload.paperNumber,
    },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const seedPatternFile = async ({
  examType,
  examLabelFallback,
  relativePath,
  sourceLabel,
}) => {
  const patternPath = resolveExisting([
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "../../", relativePath),
  ]);

  if (!patternPath) {
    console.warn(`ExamPaperPattern: pattern file missing (${relativePath}) — skip.`);
    return [];
  }

  const pattern = readJson(patternPath);
  const year = Number(pattern.year || 2026);
  const examDay = pattern.exam_day || {};
  const subjects = Array.isArray(pattern.bank_subjects)
    ? pattern.bank_subjects
    : Array.isArray(pattern.subjects)
      ? pattern.subjects
      : ["Physics", "Chemistry", "Mathematics"];
  const results = [];

  for (const [paperKey, block] of Object.entries(
    pattern.structure_per_subject_per_paper || {}
  )) {
    const paperNumber = Number(
      block.paper_number || (paperKey === "Paper_2" ? 2 : 1)
    );
    const sections = buildSections(block);
    const activeSections = sections.filter((s) => s.questions > 0);
    const typeCounts = typeCountsFromSections(
      SECTION_DEFS.map((def) => ({
        type: def.type,
        questions: Number(block[def.key]?.questions || 0) || 0,
      }))
    );

    const doc = await upsertPaper({
      examType,
      examLabel: pattern.cycle || pattern.exam || examLabelFallback,
      year,
      paperNumber,
      paperKey,
      paperLabel: block.label || `Paper ${paperNumber}`,
      session: block.session || "",
      examDate: examDay.date || "",
      examDateLabel: examDay.date_label || "",
      startTime: block.start_time || "",
      endTime: block.end_time || "",
      durationMinutes: Number(block.duration_minutes || 180),
      totalMarks: Number(block.total_marks || 0),
      totalQuestions: Number(block.total_questions || 0),
      questionsPerSubject: Number(
        block.questions_per_subject || typeCounts.total
      ),
      subjects,
      formats: Array.isArray(block.formats) ? block.formats : [],
      overallDifficulty: block.overall_difficulty || "",
      mandatoryBothPapers: Boolean(examDay.mandatory_both_papers),
      sections: activeSections,
      typeCounts,
      source: sourceLabel || relativePath,
      dataProvenance: pattern.data_provenance || "",
      quickComparison:
        pattern.quick_comparison || pattern.all_subjects_table || undefined,
      isActive: true,
    });

    results.push({
      examType: doc.examType,
      year: doc.year,
      paper: doc.paperLabel,
      questions: doc.totalQuestions,
      perSubject: doc.questionsPerSubject,
      marks: doc.totalMarks,
      session: `${doc.startTime}-${doc.endTime}`,
      types: doc.typeCounts,
    });
  }

  return results;
};

/**
 * Seed official paper patterns:
 * - JEE Advanced 2026 Paper 1 + Paper 2
 * - JEE Main 2026 Paper 1 (B.E./B.Tech)
 * - NEET UG 2026 single paper
 * - CAT 2026 slot paper (VARC / DILR / QA)
 * - GMAT Focus Edition 2026 (Quant / Verbal / Data Insights)
 * - CLAT UG 2026 (English / Current Affairs / Legal / Logical / Quant)
 * - IBPS PO Prelims 2026 (English / Quant / Reasoning)
 * - SSC CGL Tier 1 2026 (Reasoning / GA / Quant / English)
 * - SSC CGL Tier 2 2026 Paper I (Maths / Reasoning / English / GA / Computer)
 * - UPSC CSE Prelims 2026 GS Paper I (History / Polity / Geography / Economy / Environment / Science / CA)
 */
export const seedExamPaperPattern = async () => {
  const results = [
    ...(await seedPatternFile({
      examType: "jee_advanced",
      examLabelFallback: "JEE Advanced",
      relativePath: "jee_advanced/jee_advanced_pattern_totals.json",
      sourceLabel: "jee_advanced/jee_advanced_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "jee_main",
      examLabelFallback: "JEE Main",
      relativePath:
        "jee main exam all seed files/jee_main_pattern_totals.json",
      sourceLabel: "jee main exam all seed files/jee_main_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "neet",
      examLabelFallback: "NEET UG",
      relativePath:
        "NEET EXAM ALL SEED REQUIRED FILES/neet_pattern_totals.json",
      sourceLabel: "NEET EXAM ALL SEED REQUIRED FILES/neet_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "cat",
      examLabelFallback: "CAT",
      relativePath: "CAT exam seed files/cat_pattern_totals.json",
      sourceLabel: "CAT exam seed files/cat_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "gmat",
      examLabelFallback: "GMAT Focus Edition",
      relativePath: "GMAT EXAM  SEED DATA/gmat_pattern_totals.json",
      sourceLabel: "GMAT EXAM  SEED DATA/gmat_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "clat",
      examLabelFallback: "CLAT UG",
      relativePath: "CLAT EXAM SEED FILES/clat_pattern_totals.json",
      sourceLabel: "CLAT EXAM SEED FILES/clat_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "ibps",
      examLabelFallback: "IBPS PO Prelims",
      relativePath:
        "IBPS PO prelims syllabus and seed file/ibps_po_prelims_pattern_totals.json",
      sourceLabel:
        "IBPS PO prelims syllabus and seed file/ibps_po_prelims_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "ssc_cgl_tier1",
      examLabelFallback: "SSC CGL Tier 1",
      relativePath:
        "ssc cgl tier 1 question paper/ssc_cgl_tier1_pattern_totals.json",
      sourceLabel:
        "ssc cgl tier 1 question paper/ssc_cgl_tier1_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "ssc_cgl_tier2",
      examLabelFallback: "SSC CGL Tier 2",
      relativePath:
        "ssc cgl tier 2 question paper/ssc_cgl_tier2_pattern_totals.json",
      sourceLabel:
        "ssc cgl tier 2 question paper/ssc_cgl_tier2_pattern_totals.json",
    })),
    ...(await seedPatternFile({
      examType: "upsc",
      examLabelFallback: "UPSC CSE Prelims",
      relativePath: "UPSC CSE Prelims /upsc_gs_pattern_totals.json",
      sourceLabel: "UPSC CSE Prelims /upsc_gs_pattern_totals.json",
    })),
  ];

  console.log(
    `Seeded ExamPaperPattern: ${results
      .map(
        (r) =>
          `${r.examType}/${r.paper} ${r.questions}Q/${r.marks} · ${r.perSubject}/subject`
      )
      .join("; ") || "none"}`
  );

  return { seeded: true, papers: results };
};

export default seedExamPaperPattern;
