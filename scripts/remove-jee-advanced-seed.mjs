import dotenv from "dotenv";
import mongoose from "mongoose";
import JeeAdvancedCompetitivePaper from "../src/models/JeeAdvancedCompetitivePaper.js";
import JeeAdvancedCompetitiveQuestion from "../src/models/JeeAdvancedCompetitiveQuestion.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const q = await JeeAdvancedCompetitiveQuestion.deleteMany({});
const p = await JeeAdvancedCompetitivePaper.deleteMany({});

console.log(
  JSON.stringify(
    {
      deletedQuestions: q.deletedCount,
      deletedPapers: p.deletedCount,
      remainingQuestions: await JeeAdvancedCompetitiveQuestion.countDocuments(),
      remainingPapers: await JeeAdvancedCompetitivePaper.countDocuments(),
    },
    null,
    2
  )
);

await mongoose.disconnect();
