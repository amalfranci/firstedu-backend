import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedSscCglTier2CompetitivePapers } from "../src/utils/seedSscCglTier2CompetitivePapers.js";
dotenv.config();
await connectDB();
console.log("SSC CGL Tier 2 seed result:", await seedSscCglTier2CompetitivePapers({ replace: true }));
process.exit(0);
