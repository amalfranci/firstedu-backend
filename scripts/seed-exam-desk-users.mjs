import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedExamDeskUsers } from "../src/utils/seedExamDeskUsers.js";

dotenv.config();
await connectDB();
console.log(
  "Exam desk users:",
  await seedExamDeskUsers({ replace: true })
);
process.exit(0);
