import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedIbpsCompetitivePapers } from "../src/utils/seedIbpsCompetitivePapers.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedIbpsCompetitivePapers({ replace: true });
  console.log("IBPS seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("IBPS seed failed:", error);
  process.exit(1);
});
