import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedGmatCompetitivePapers } from "../src/utils/seedGmatCompetitivePapers.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedGmatCompetitivePapers({ replace: true });
  console.log("GMAT seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("GMAT seed failed:", error);
  process.exit(1);
});
