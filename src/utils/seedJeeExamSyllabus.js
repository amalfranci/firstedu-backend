import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JeeExamSyllabus from "../models/JeeExamSyllabus.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolveExisting = (candidates) =>
  candidates.find((p) => fs.existsSync(p)) || null;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const titleCaseSubject = (value) => {
  const key = String(value || "").trim();
  if (/^math/i.test(key)) return "Mathematics";
  if (/^phys/i.test(key)) return "Physics";
  if (/^chem/i.test(key)) return "Chemistry";
  return key.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

const flattenMainSubject = (subject) => {
  const topics = [];
  let order = 0;
  if (Array.isArray(subject.units)) {
    for (const unit of subject.units) {
      topics.push({
        topicId: unit.unit || null,
        unit: unit.unit || null,
        title: String(unit.title || "").trim(),
        content: String(unit.content || "").trim(),
        branch: null,
        classLevel: null,
        subtopics: [],
        order: order++,
      });
    }
  }
  for (const section of subject.sections || []) {
    const branch = String(section.branch || "").trim() || null;
    for (const unit of section.units || []) {
      topics.push({
        topicId: unit.unit || null,
        unit: unit.unit || null,
        title: String(unit.title || "").trim(),
        content: String(unit.content || "").trim(),
        branch,
        classLevel: null,
        subtopics: [],
        order: order++,
      });
    }
  }
  return topics.filter((t) => t.title);
};

const flattenAdvancedTopics = (topics = []) =>
  topics.map((topic, index) => ({
    topicId: topic.topic_id || null,
    unit: topic.topic_id || null,
    title: String(topic.chapter || topic.title || "").trim(),
    content: Array.isArray(topic.subtopics) ? topic.subtopics.join("; ") : "",
    branch: topic.branch ? String(topic.branch).trim() : null,
    classLevel: topic.class_level ? String(topic.class_level) : null,
    subtopics: Array.isArray(topic.subtopics) ? topic.subtopics : [],
    order: index,
  }));

const upsertSubject = async (payload) => {
  await JeeExamSyllabus.findOneAndUpdate(
    {
      examType: payload.examType,
      subject: payload.subject,
      paper: payload.paper || "",
      year: payload.year,
    },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const seedJeeExamSyllabus = async () => {
  const results = [];

  const mainPath = resolveExisting([
    path.resolve(process.cwd(), "files/jee-main-syllabus/jee-main-2026-official.json"),
    path.resolve(__dirname, "../../files/jee-main-syllabus/jee-main-2026-official.json"),
  ]);

  if (mainPath) {
    const main = readJson(mainPath);
    const paper1 =
      (main.papers || []).find((p) =>
        /paper\s*1|b\.?e\.?\/?\s*b\.?tech/i.test(String(p.paper || ""))
      ) || main.papers?.[0];

    for (const subject of paper1?.subjects || []) {
      const topics = flattenMainSubject(subject);
      const doc = {
        examType: "jee_main",
        examLabel: "JEE Main",
        paper: paper1.paper || "Paper 1 (B.E./B.Tech.)",
        subject: titleCaseSubject(subject.subject),
        year: 2026,
        source: "files/jee-main-syllabus/jee-main-2026-official.json",
        topicCount: topics.length,
        topics,
        isActive: true,
      };
      await upsertSubject(doc);
      results.push({
        examType: doc.examType,
        subject: doc.subject,
        topics: topics.length,
      });
    }
  } else {
    console.warn("JEE Main official syllabus file not found.");
  }

  const advMathPath = resolveExisting([
    path.resolve(process.cwd(), "jee_advanced/maths_syllabus.json"),
    path.resolve(__dirname, "../../jee_advanced/maths_syllabus.json"),
  ]);
  const advPhysPath = resolveExisting([
    path.resolve(process.cwd(), "jee_advanced/physics/physics_syllabus.json"),
    path.resolve(__dirname, "../../jee_advanced/physics/physics_syllabus.json"),
  ]);
  const advChemPath = resolveExisting([
    path.resolve(process.cwd(), "jee_advanced/chemistry/chemistry_syllabus.json"),
    path.resolve(__dirname, "../../jee_advanced/chemistry/chemistry_syllabus.json"),
  ]);

  if (advMathPath) {
    const maths = readJson(advMathPath);
    const topics = flattenAdvancedTopics(maths.topics || []);
    const doc = {
      examType: "jee_advanced",
      examLabel: "JEE Advanced",
      paper: "Both papers (Paper 1 & Paper 2)",
      subject: "Mathematics",
      year: 2026,
      source: maths.source_note || "jee_advanced/maths_syllabus.json",
      topicCount: topics.length,
      topics,
      isActive: true,
    };
    await upsertSubject(doc);
    results.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: topics.length,
    });
  }

  if (advPhysPath) {
    const physics = readJson(advPhysPath);
    const topics = flattenAdvancedTopics(physics.topics || []);
    const doc = {
      examType: "jee_advanced",
      examLabel: "JEE Advanced",
      paper: "Both papers (Paper 1 & Paper 2)",
      subject: "Physics",
      year: 2026,
      source: physics.source_note || "jee_advanced/physics/physics_syllabus.json",
      topicCount: topics.length,
      topics,
      isActive: true,
    };
    await upsertSubject(doc);
    results.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: topics.length,
    });
  }

  if (advChemPath) {
    const chemistry = readJson(advChemPath);
    const topics = flattenAdvancedTopics(chemistry.topics || []);
    const doc = {
      examType: "jee_advanced",
      examLabel: "JEE Advanced",
      paper: "Both papers (Paper 1 & Paper 2)",
      subject: "Chemistry",
      year: 2026,
      source: chemistry.source_note || "jee_advanced/chemistry/chemistry_syllabus.json",
      topicCount: topics.length,
      topics,
      isActive: true,
    };
    await upsertSubject(doc);
    results.push({
      examType: doc.examType,
      subject: doc.subject,
      topics: topics.length,
    });
  }

  console.log(
    `Seeded JEE syllabus subjects: ${results
      .map((r) => `${r.examType}/${r.subject} (${r.topics})`)
      .join(", ")}`
  );

  return { seeded: true, subjects: results };
};

export default seedJeeExamSyllabus;
