import dotenv from "dotenv";
import mongoose from "mongoose";
import NeetCompetitivePaper from "../src/models/NeetCompetitivePaper.js";
import NeetCompetitiveQuestion from "../src/models/NeetCompetitiveQuestion.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const papers = await NeetCompetitivePaper.find()
  .select("paperKey title totalQuestions sourceFile")
  .sort({ sortOrder: 1 })
  .lean();
const total = await NeetCompetitiveQuestion.countDocuments();
const missing = await NeetCompetitiveQuestion.countDocuments({
  topic: { $in: [null, ""] },
});
const byPaper = await NeetCompetitiveQuestion.aggregate([
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
const topics = await NeetCompetitiveQuestion.aggregate([
  { $group: { _id: { subject: "$subject", topic: "$topic" }, n: { $sum: 1 } } },
  { $sort: { "_id.subject": 1, n: -1 } },
]);

console.log(
  JSON.stringify(
    {
      papers,
      questions: { total, missing },
      byPaper,
      topicCount: topics.length,
      topics: topics.map((t) => ({
        subject: t._id.subject,
        topic: t._id.topic,
        n: t.n,
      })),
    },
    null,
    2
  )
);
await mongoose.disconnect();
