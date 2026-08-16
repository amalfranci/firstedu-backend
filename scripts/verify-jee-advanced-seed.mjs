import dotenv from "dotenv";
import mongoose from "mongoose";
import JeeAdvancedCompetitivePaper from "../src/models/JeeAdvancedCompetitivePaper.js";
import JeeAdvancedCompetitiveQuestion from "../src/models/JeeAdvancedCompetitiveQuestion.js";
import JeeExamSyllabus from "../src/models/JeeExamSyllabus.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const papers = await JeeAdvancedCompetitivePaper.find()
  .select("paperKey title totalQuestions sourceFile sortOrder")
  .sort({ sortOrder: 1 })
  .lean();

const qTotal = await JeeAdvancedCompetitiveQuestion.countDocuments();
const missingTopic = await JeeAdvancedCompetitiveQuestion.countDocuments({
  topic: { $in: [null, ""] },
});

const byPaper = await JeeAdvancedCompetitiveQuestion.aggregate([
  {
    $group: {
      _id: { paperKey: "$paperKey", subject: "$subject" },
      n: { $sum: 1 },
      withTopic: {
        $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$topic", ""] } }, 0] }, 1, 0] },
      },
    },
  },
  { $sort: { "_id.paperKey": 1, "_id.subject": 1 } },
]);

const topics = await JeeAdvancedCompetitiveQuestion.aggregate([
  { $group: { _id: { subject: "$subject", topic: "$topic" }, n: { $sum: 1 } } },
  { $sort: { "_id.subject": 1, n: -1 } },
]);

const syllabus = await JeeExamSyllabus.find({ examType: "jee_advanced" })
  .select("subject topicCount topics.title")
  .lean();

console.log(
  JSON.stringify(
    {
      papers,
      questions: { total: qTotal, missingTopic },
      byPaper,
      uniqueTopics: topics.length,
      topics: topics.map((t) => ({
        subject: t._id.subject,
        topic: t._id.topic,
        n: t.n,
      })),
      syllabus: syllabus.map((s) => ({
        subject: s.subject,
        topicCount: s.topicCount,
        titles: (s.topics || []).map((t) => t.title),
      })),
    },
    null,
    2
  )
);

await mongoose.disconnect();
