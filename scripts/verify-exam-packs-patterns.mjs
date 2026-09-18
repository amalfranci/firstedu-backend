import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import ExamSyllabusPack from "../src/models/ExamSyllabusPack.js";
import ExamPaperPattern from "../src/models/ExamPaperPattern.js";

dotenv.config();

const summarizePacks = (packs) =>
  packs.map((p) => ({
    examType: p.examType,
    subject: p.subject,
    paper: p.paper || "",
    year: p.year,
    topics: p.topicCount,
    high: p.highRelevanceCount,
    scoringSource: Boolean(p.scoringSource),
  }));

const summarizePatterns = (patterns) =>
  patterns.map((p) => ({
    examType: p.examType,
    paper: p.paperLabel,
    year: p.year,
    questions: p.totalQuestions,
    perSubject: p.questionsPerSubject,
    marks: p.totalMarks,
    types: p.typeCounts,
    sections: (p.sections || []).map((s) => `${s.type}:${s.questions}`),
  }));

const run = async () => {
  await connectDB();

  const packs = await ExamSyllabusPack.find({})
    .select(
      "examType subject paper year topicCount highRelevanceCount scoringSource"
    )
    .sort({ examType: 1, subject: 1 })
    .lean();
  const patterns = await ExamPaperPattern.find({})
    .select(
      "examType paperLabel year totalQuestions questionsPerSubject totalMarks typeCounts sections"
    )
    .sort({ examType: 1, paperNumber: 1 })
    .lean();

  const byExam = (examType) => packs.filter((p) => p.examType === examType);
  const patternsByExam = (examType) =>
    patterns.filter((p) => p.examType === examType);

  const exams = [
    ["advanced", "jee_advanced", 3],
    ["main", "jee_main", 3],
    ["neet", "neet", 4],
    ["cat", "cat", 3],
    ["gmat", "gmat", 3],
    ["clat", "clat", 5],
    ["ibps", "ibps", 3],
    ["sscT1", "ssc_cgl_tier1", 4],
    ["sscT2", "ssc_cgl_tier2", 5],
    ["upsc", "upsc", 7],
  ];

  const packReport = {};
  const patternReport = {};
  const ok = {};
  for (const [key, examType, minPacks] of exams) {
    const p = byExam(examType);
    const pat = patternsByExam(examType);
    packReport[key] = summarizePacks(p);
    patternReport[key] = summarizePatterns(pat);
    ok[`${key}Packs`] = p.length >= minPacks;
    ok[`${key}Patterns`] =
      examType === "jee_advanced" ? pat.length >= 2 : pat.length >= 1;
  }

  const report = { packs: packReport, patterns: patternReport, ok };
  console.log(JSON.stringify(report, null, 2));

  const failed = Object.entries(report.ok).filter(([, v]) => !v);
  if (failed.length) {
    console.error(
      `Verify failed: missing ${failed.map(([k]) => k).join(", ")}`
    );
    process.exit(1);
  }

  console.log(
    "Verify OK: JEE Advanced + JEE Main + NEET + CAT + GMAT + CLAT + IBPS + SSC CGL Tier 1 + Tier 2 + UPSC CSE Prelims packs and patterns present."
  );
  process.exit(0);
};

run().catch((error) => {
  console.error("Verify exam packs/patterns failed:", error);
  process.exit(1);
});
