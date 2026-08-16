import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedNeetCompetitivePapers } from "../src/utils/seedNeetCompetitivePapers.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedNeetCompetitivePapers({ replace: true });
  console.log("NEET seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("NEET seed failed:", error);
  process.exit(1);
});
