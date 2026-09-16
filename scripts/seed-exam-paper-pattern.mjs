import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedExamPaperPattern } from "../src/utils/seedExamPaperPattern.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedExamPaperPattern();
  console.log("ExamPaperPattern seed result:", JSON.stringify(result, null, 2));
  process.exit(0);
};

run().catch((error) => {
  console.error("ExamPaperPattern seed failed:", error);
  process.exit(1);
});
