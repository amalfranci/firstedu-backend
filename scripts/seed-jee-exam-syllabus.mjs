import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedJeeExamSyllabus } from "../src/utils/seedJeeExamSyllabus.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedJeeExamSyllabus();
  console.log("JEE syllabus seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("JEE syllabus seed failed:", error);
  process.exit(1);
});
