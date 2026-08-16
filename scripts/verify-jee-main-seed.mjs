import dotenv from "dotenv";
import mongoose from "mongoose";
import JeeMainCompetitivePaper from "../src/models/JeeMainCompetitivePaper.js";
import JeeMainCompetitiveQuestion from "../src/models/JeeMainCompetitiveQuestion.js";
import Test from "../src/models/Test.js";
import Category from "../src/models/Category.js";

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const papers = await JeeMainCompetitivePaper.find().sort({ sortOrder: 1 }).lean();
const qCount = await JeeMainCompetitiveQuestion.countDocuments();
const byPaper = await JeeMainCompetitiveQuestion.aggregate([
  {
    $group: {
      _id: "$paperKey",
      n: { $sum: 1 },
      subjects: { $addToSet: "$subject" },
    },
  },
]);
const tests = await Test.find({ paperSource: "jee_main_db" })
  .select("title paperSource jeeMainPaper categoryId durationMinutes isPublished")
  .lean();
const cats = await Category.find({ name: /jee/i })
  .select("name parent rootType isFree")
  .lean();
const withTopic = await JeeMainCompetitiveQuestion.countDocuments({
  topic: { $nin: [null, ""] },
});
const sample = await JeeMainCompetitiveQuestion.findOne({
  paperKey: "JEE-MAIN-Paper1",
  questionNumber: 1,
  subject: "Mathematics",
}).lean();

console.log(
  JSON.stringify(
    {
      papers: papers.map((p) => ({
        key: p.paperKey,
        title: p.title,
        total: p.totalQuestions,
        marks: p.totalMarks,
      })),
      qCount,
      withTopic,
      byPaper,
      tests: tests.map((t) => ({
        title: t.title,
        source: t.paperSource,
        cat: t.categoryId,
        dur: t.durationMinutes,
        pub: t.isPublished,
      })),
      cats,
      sample: sample
        ? {
            text: sample.questionText.slice(0, 80),
            options: sample.options.map((o) => `${o.key}:${o.isCorrect}`),
            correctAnswer: sample.correctAnswer,
            marks: sample.marks,
          }
        : null,
    },
    null,
    2
  )
);

await mongoose.disconnect();
