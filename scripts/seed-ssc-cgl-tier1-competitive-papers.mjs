import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedSscCglTier1CompetitivePapers } from "../src/utils/seedSscCglTier1CompetitivePapers.js";
dotenv.config();
await connectDB();
console.log("SSC CGL Tier 1 seed result:", await seedSscCglTier1CompetitivePapers({ replace: true }));
process.exit(0);
