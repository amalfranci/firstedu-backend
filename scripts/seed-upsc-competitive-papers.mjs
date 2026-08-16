import dotenv from "dotenv";
import connectDB from "../src/config/db.js";
import { seedUpscCompetitivePapers } from "../src/utils/seedUpscCompetitivePapers.js";
dotenv.config();
await connectDB();
console.log("UPSC seed result:", await seedUpscCompetitivePapers({ replace: true }));
process.exit(0);
