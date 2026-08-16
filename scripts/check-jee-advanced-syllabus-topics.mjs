import dotenv from "dotenv";
import mongoose from "mongoose";
import JeeExamSyllabus from "../src/models/JeeExamSyllabus.js";
import JeeAdvancedCompetitivePaper from "../src/models/JeeAdvancedCompetitivePaper.js";
import JeeAdvancedCompetitiveQuestion from "../src/models/JeeAdvancedCompetitiveQuestion.js";
import JeeMainCompetitiveQuestion from "../src/models/JeeMainCompetitiveQuestion.js";
import Category from "../src/models/Category.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const collections = (await mongoose.connection.db.listCollections().toArray())
  .map((c) => c.name)
  .filter((n) => /jee|syllab|advance|topic/i.test(n))
  .sort();

const syllabus = await JeeExamSyllabus.find({ examType: "jee_advanced" })
  .select("examType examLabel subject paper year topicCount source topics.title")
  .lean();

const allSyllabus = await JeeExamSyllabus.find()
  .select("examType subject topicCount")
  .lean();

const papers = await JeeAdvancedCompetitivePaper.find()
  .select("paperKey title totalQuestions")
  .sort({ sortOrder: 1 })
  .lean();

const qTotal = await JeeAdvancedCompetitiveQuestion.countDocuments();
const qWithTopic = await JeeAdvancedCompetitiveQuestion.countDocuments({
  topic: { $nin: [null, ""] },
});
const byPaper = await JeeAdvancedCompetitiveQuestion.aggregate([
  {
    $group: {
      _id: "$paperKey",
      n: { $sum: 1 },
      withTopic: {
        $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$topic", ""] } }, 0] }, 1, 0] },
      },
      subjects: { $addToSet: "$subject" },
    },
  },
]);
const topicSamples = await JeeAdvancedCompetitiveQuestion.aggregate([
  { $match: { topic: { $nin: [null, ""] } } },
  { $group: { _id: { subject: "$subject", topic: "$topic" }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 20 },
]);

const cats = await Category.find({ name: /jee\s*advanc/i })
  .select("name syllabus rootType")
  .lean();

const mainTopics = await JeeMainCompetitiveQuestion.countDocuments({
  topic: { $nin: [null, ""] },
});

console.log(
  JSON.stringify(
    {
      relatedCollections: collections,
      jeeAdvancedSyllabusSubjects: syllabus.map((s) => ({
        subject: s.subject,
        paper: s.paper,
        year: s.year,
        topicCount: s.topicCount,
        sampleTopics: (s.topics || []).slice(0, 5).map((t) => t.title),
        source: s.source,
      })),
      allSyllabusDocs: allSyllabus,
      advancedPapers: papers,
      advancedQuestions: { total: qTotal, withTopic: qWithTopic },
      byPaper,
      topTopics: topicSamples,
      jeeAdvanceCategories: cats.map((c) => ({
        name: c.name,
        hasSyllabus: Boolean(c.syllabus && String(c.syllabus).trim()),
      })),
      jeeMainQuestionsWithTopic: mainTopics,
    },
    null,
    2
  )
);

await mongoose.disconnect();
