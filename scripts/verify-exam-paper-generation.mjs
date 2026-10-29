import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import ExamSyllabusPack from "../src/models/ExamSyllabusPack.js";
import ExamPaperPattern from "../src/models/ExamPaperPattern.js";
import { planPipelineSlots } from "../src/services/aiPoweredTestPipeline.service.js";

dotenv.config();

const targetExam = process.argv[2]?.toLowerCase() || "all";

const EXAMS = [
  { key: "cat", label: "CAT (Common Admission Test)", defaultQ: 24 },
  { key: "jee_main", label: "JEE Main", defaultQ: 75 },
  { key: "jee_advanced", label: "JEE Advanced", defaultQ: 48 },
  { key: "neet", label: "NEET UG", defaultQ: 180 },
  { key: "clat", label: "CLAT", defaultQ: 120 },
  { key: "gmat", label: "GMAT Focus", defaultQ: 64 },
  { key: "ibps", label: "IBPS PO", defaultQ: 100 },
  { key: "ssc_cgl_tier1", label: "SSC CGL Tier 1", defaultQ: 100 },
  { key: "ssc_cgl_tier2", label: "SSC CGL Tier 2", defaultQ: 150 },
  { key: "upsc", label: "UPSC CSE Prelims", defaultQ: 100 },
];

const checkExam = async (examKey, examLabel, fallbackQ) => {
  const pattern = await ExamPaperPattern.findOne({ examType: examKey }).lean();
  const packs = await ExamSyllabusPack.find({ examType: examKey }).lean();

  if (!packs.length) {
    console.log(`[!] No syllabus packs found for ${examKey}`);
    return;
  }

  const subjects = packs.map((p) => p.subject);
  const topicsBySubject = {};
  packs.forEach((p) => {
    topicsBySubject[p.subject] = p.topics || [];
  });

  const totalQuestions = pattern?.totalQuestions || fallbackQ;
  const questionsPerSub = pattern?.questionsPerSubject || Math.floor(totalQuestions / subjects.length);
  const subjectCounts = Object.fromEntries(subjects.map((s) => [s, questionsPerSub]));

  // Build structure configs
  const passageSpec = examKey === "cat" ? { passageCount: 4, questionsPerPassage: 4, questionStructure: "both" } : {};

  const config = {
    examType: examKey,
    examLabel: pattern?.paperLabel || examLabel,
    totalQuestions,
    subjects,
    subjectCounts,
    enabledTypes: ["single", "multiple"],
    typeCounts: {
      single: Math.floor(totalQuestions / 2),
      multiple: Math.ceil(totalQuestions / 2),
    },
    topicsBySubject,
    ...passageSpec,
  };

  const plan = planPipelineSlots(config);
  const allSlots = Object.values(plan.slots).flat();

  console.log(`\n========================================================================`);
  console.log(`EXAM: ${examLabel.toUpperCase()} (${examKey})`);
  console.log(`Total Planned Questions: ${allSlots.length} | Target: ${totalQuestions}`);
  console.log(`Subjects: ${subjects.join(", ")}`);
  console.log(`Types: Single = ${plan.slots.single?.length || 0}, Multiple = ${plan.slots.multiple?.length || 0}`);

  // Subject & Topic breakdown
  const bySubject = {};
  const topicCounts = {};
  let passageSlots = 0;
  let standaloneSlots = 0;

  allSlots.forEach((s) => {
    bySubject[s.subject] = (bySubject[s.subject] || 0) + 1;
    const topKey = `${s.subject} → [${s.topicId || "N/A"}] ${s.chapter || s.title || "Untitled"}`;
    topicCounts[topKey] = (topicCounts[topKey] || 0) + 1;
    if (s.isPassageSlot) passageSlots += 1;
    else standaloneSlots += 1;
  });

  console.log(`\nSubject Distribution:`);
  console.table(bySubject);

  if (passageSlots > 0) {
    console.log(`Passage Questions: ${passageSlots} | Standalone Questions: ${standaloneSlots}`);
  }

  console.log(`\nTopic Distribution & Question Counts:`);
  console.table(
    Object.entries(topicCounts).map(([topic, count]) => ({
      Topic: topic,
      Questions: count,
    }))
  );
};

const run = async () => {
  await connectDB();

  const toRun = targetExam === "all" ? EXAMS : EXAMS.filter((e) => e.key === targetExam || e.key.includes(targetExam));

  if (!toRun.length) {
    console.log(`Unknown exam: "${targetExam}". Available: ${EXAMS.map((e) => e.key).join(", ")}`);
    process.exit(1);
  }

  for (const ex of toRun) {
    await checkExam(ex.key, ex.label, ex.defaultQ);
  }

  console.log(`\n[✓] Exam paper slot & topic verification completed.\n`);
  process.exit(0);
};

run().catch((err) => {
  console.error("Error running verification:", err);
  process.exit(1);
});
