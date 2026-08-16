import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedCatCompetitivePapers } from "../src/utils/seedCatCompetitivePapers.js";
dotenv.config();
await connectDB();
console.log("CAT seed result:", await seedCatCompetitivePapers({ replace: true }));
process.exit(0);
