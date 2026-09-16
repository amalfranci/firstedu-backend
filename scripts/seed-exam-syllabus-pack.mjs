import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedExamSyllabusPack } from "../src/utils/seedExamSyllabusPack.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedExamSyllabusPack();
  console.log("ExamSyllabusPack seed result:", JSON.stringify(result, null, 2));
  process.exit(0);
};

run().catch((error) => {
  console.error("ExamSyllabusPack seed failed:", error);
  process.exit(1);
});
