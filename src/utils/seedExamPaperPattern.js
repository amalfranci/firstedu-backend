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

/**
 * Seed official paper patterns (Paper 1 + Paper 2 for JEE Advanced 2026).
 * Source: jee_advanced/jee_advanced_pattern_totals.json
 */
export const seedExamPaperPattern = async () => {
  const patternPath = resolveExisting([
    path.resolve(process.cwd(), "jee_advanced/jee_advanced_pattern_totals.json"),
    path.resolve(__dirname, "../../jee_advanced/jee_advanced_pattern_totals.json"),
  ]);

  if (!patternPath) {
    console.warn("ExamPaperPattern: pattern file missing — skip seed.");
    return { seeded: false, papers: [] };
  }

  const pattern = readJson(patternPath);
  const year = Number(pattern.year || 2026);
  const examDay = pattern.exam_day || {};
  const subjects = Array.isArray(pattern.subjects)
    ? pattern.subjects
    : ["Physics", "Chemistry", "Mathematics"];
  const results = [];

  for (const [paperKey, block] of Object.entries(
    pattern.structure_per_subject_per_paper || {}
  )) {
    const paperNumber = Number(block.paper_number || (paperKey === "Paper_2" ? 2 : 1));
    const sections = buildSections(block);
    // Keep zero-count match/paragraph out of active sections for clarity,
    // but still reflect them in typeCounts for UI toggles.
    const activeSections = sections.filter((s) => s.questions > 0);
    const typeCounts = typeCountsFromSections(
      SECTION_DEFS.map((def) => ({
        type: def.type,
        questions: Number(block[def.key]?.questions || 0) || 0,
      }))
    );

    const doc = await upsertPaper({
      examType: "jee_advanced",
      examLabel: pattern.cycle || pattern.exam || "JEE Advanced",
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
      totalMarks: Number(block.total_marks || 180),
      totalQuestions: Number(block.total_questions || 0),
      questionsPerSubject: Number(block.questions_per_subject || typeCounts.total),
      subjects,
      formats: Array.isArray(block.formats) ? block.formats : [],
      overallDifficulty: block.overall_difficulty || "",
      mandatoryBothPapers: Boolean(examDay.mandatory_both_papers),
      sections: activeSections,
      typeCounts,
      source: "jee_advanced/jee_advanced_pattern_totals.json",
      dataProvenance: pattern.data_provenance || "",
      quickComparison: pattern.quick_comparison || undefined,
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

  console.log(
    `Seeded ExamPaperPattern: ${results
      .map(
        (r) =>
          `${r.paper} ${r.questions}Q/${r.marks} · ${r.perSubject}/subject · ${r.session}`
      )
      .join("; ") || "none"}`
  );

  return { seeded: true, papers: results };
};

export default seedExamPaperPattern;
