import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedJeeMainCompetitivePapers } from "../src/utils/seedJeeMainCompetitivePapers.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedJeeMainCompetitivePapers({ replace: true });
  console.log("JEE Main competitive seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("JEE Main competitive seed failed:", error);
  process.exit(1);
});
