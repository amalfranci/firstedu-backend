import dns from 'dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { seedAdmin } from '../utils/seedAdmin.js';
import { seedJeeMainCompetitivePapers } from '../utils/seedJeeMainCompetitivePapers.js';
import { seedJeeExamSyllabus } from '../utils/seedJeeExamSyllabus.js';
import { seedExamSyllabusPack } from '../utils/seedExamSyllabusPack.js';
import { seedExamPaperPattern } from '../utils/seedExamPaperPattern.js';
import { seedJeeAdvancedCompetitivePapers } from '../utils/seedJeeAdvancedCompetitivePapers.js';
import { seedNeetCompetitivePapers } from '../utils/seedNeetCompetitivePapers.js';
import { seedClatCompetitivePapers } from '../utils/seedClatCompetitivePapers.js';
import { seedIbpsCompetitivePapers } from '../utils/seedIbpsCompetitivePapers.js';
import { seedGmatCompetitivePapers } from '../utils/seedGmatCompetitivePapers.js';
import { seedSscCglTier1CompetitivePapers } from '../utils/seedSscCglTier1CompetitivePapers.js';
import { seedSscCglTier2CompetitivePapers } from '../utils/seedSscCglTier2CompetitivePapers.js';
import { seedUpscCompetitivePapers } from '../utils/seedUpscCompetitivePapers.js';
import { seedCatCompetitivePapers } from '../utils/seedCatCompetitivePapers.js';
import JeeAdvancedCompetitivePaper from '../models/JeeAdvancedCompetitivePaper.js';
import JeeMainCompetitivePaper from '../models/JeeMainCompetitivePaper.js';
import NeetCompetitivePaper from '../models/NeetCompetitivePaper.js';
import ClatCompetitivePaper from '../models/ClatCompetitivePaper.js';
import IbpsCompetitivePaper from '../models/IbpsCompetitivePaper.js';
import GmatCompetitivePaper from '../models/GmatCompetitivePaper.js';
import SscCglTier1CompetitivePaper from '../models/SscCglTier1CompetitivePaper.js';
import SscCglTier2CompetitivePaper from '../models/SscCglTier2CompetitivePaper.js';
import UpscCompetitivePaper from '../models/UpscCompetitivePaper.js';
import CatCompetitivePaper from '../models/CatCompetitivePaper.js';
import JeeExamSyllabus from '../models/JeeExamSyllabus.js';
import ExamSyllabusPack from '../models/ExamSyllabusPack.js';
import ExamPaperPattern from '../models/ExamPaperPattern.js';
import ExamDeskUser from '../models/ExamDeskUser.js';
import { seedExamDeskUsers } from '../utils/seedExamDeskUsers.js';
// Ensure models are registered at startup (required for StudentSession collection)
import '../models/StudentSession.js';
import '../models/JeeMainCompetitiveQuestion.js';
import '../models/JeeAdvancedCompetitiveQuestion.js';
import '../models/NeetCompetitiveQuestion.js';
import '../models/ClatCompetitiveQuestion.js';
import '../models/IbpsCompetitiveQuestion.js';
import '../models/GmatCompetitiveQuestion.js';
import '../models/SscCglTier1CompetitiveQuestion.js';
import '../models/SscCglTier2CompetitiveQuestion.js';
import '../models/UpscCompetitiveQuestion.js';
import '../models/CatCompetitiveQuestion.js';
import '../models/AiPaperGenerationJob.js';
import '../models/AiPaperGenerationQuestion.js';

dotenv.config();

// Windows/router DNS often refuses SRV lookups that mongodb+srv requires (querySrv ECONNREFUSED).
if (process.env.MONGODB_URI?.startsWith('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.DB_NAME,
    });
    console.log(`MongoDB connected! DB Host: ${connectionInstance.connection.host}`);

    // ✅ Run seeding after connection
    await seedAdmin();
    const existingJeeMainPapers = await JeeMainCompetitivePaper.countDocuments();
    if (existingJeeMainPapers === 0) {
      await seedJeeMainCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ JEE Main papers already seeded (${existingJeeMainPapers}). Skipping.`);
    }
    const existingSyllabus = await JeeExamSyllabus.countDocuments();
    if (existingSyllabus === 0) {
      await seedJeeExamSyllabus();
    } else {
      console.log(`ℹ️ JEE syllabus already seeded (${existingSyllabus}). Skipping.`);
    }
    const existingSyllabusPacks = await ExamSyllabusPack.countDocuments();
    if (existingSyllabusPacks === 0) {
      await seedExamSyllabusPack();
    } else {
      console.log(
        `ℹ️ Exam syllabus packs already seeded (${existingSyllabusPacks}). Skipping.`
      );
    }
    const existingPaperPatterns = await ExamPaperPattern.countDocuments();
    if (existingPaperPatterns === 0) {
      await seedExamPaperPattern();
    } else {
      console.log(
        `ℹ️ Exam paper patterns already seeded (${existingPaperPatterns}). Skipping.`
      );
    }
    const existingAdvanced = await JeeAdvancedCompetitivePaper.countDocuments();
    if (existingAdvanced === 0) {
      await seedJeeAdvancedCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ JEE Advanced papers already seeded (${existingAdvanced}). Skipping.`);
    }
    const existingNeet = await NeetCompetitivePaper.countDocuments();
    if (existingNeet === 0) {
      await seedNeetCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ NEET papers already seeded (${existingNeet}). Skipping.`);
    }
    const existingClat = await ClatCompetitivePaper.countDocuments();
    if (existingClat === 0) {
      await seedClatCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ CLAT papers already seeded (${existingClat}). Skipping.`);
    }
    const existingIbps = await IbpsCompetitivePaper.countDocuments();
    if (existingIbps === 0) {
      await seedIbpsCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ IBPS papers already seeded (${existingIbps}). Skipping.`);
    }
    const existingGmat = await GmatCompetitivePaper.countDocuments();
    if (existingGmat === 0) {
      await seedGmatCompetitivePapers({ replace: true });
    } else {
      console.log(`ℹ️ GMAT papers already seeded (${existingGmat}). Skipping.`);
    }
    const existingSscT1 = await SscCglTier1CompetitivePaper.countDocuments();
    if (existingSscT1 === 0) await seedSscCglTier1CompetitivePapers({ replace: true });
    else console.log(`ℹ️ SSC CGL Tier 1 papers already seeded (${existingSscT1}). Skipping.`);
    const existingSscT2 = await SscCglTier2CompetitivePaper.countDocuments();
    if (existingSscT2 === 0) await seedSscCglTier2CompetitivePapers({ replace: true });
    else console.log(`ℹ️ SSC CGL Tier 2 papers already seeded (${existingSscT2}). Skipping.`);
    const existingUpsc = await UpscCompetitivePaper.countDocuments();
    if (existingUpsc === 0) await seedUpscCompetitivePapers({ replace: true });
    else console.log(`ℹ️ UPSC papers already seeded (${existingUpsc}). Skipping.`);
    const existingCat = await CatCompetitivePaper.countDocuments();
    if (existingCat === 0) await seedCatCompetitivePapers({ replace: true });
    else console.log(`ℹ️ CAT papers already seeded (${existingCat}). Skipping.`);
    const existingDeskUsers = await ExamDeskUser.countDocuments();
    if (existingDeskUsers === 0) {
      await seedExamDeskUsers({ replace: true });
    } else {
      console.log(`ℹ️ Exam desk users already seeded (${existingDeskUsers}). Skipping.`);
    }

  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

export default connectDB;
