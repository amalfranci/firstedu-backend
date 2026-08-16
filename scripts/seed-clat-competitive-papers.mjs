import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedClatCompetitivePapers } from "../src/utils/seedClatCompetitivePapers.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await seedClatCompetitivePapers({ replace: true });
  console.log("CLAT seed result:", result);
  process.exit(0);
};

run().catch((error) => {
  console.error("CLAT seed failed:", error);
  process.exit(1);
});
