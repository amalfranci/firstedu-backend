import dotenv from "dotenv";
import mongoose from "mongoose";
import JeeExamSyllabus from "../src/models/JeeExamSyllabus.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });

const docs = await JeeExamSyllabus.find()
  .select("examType examLabel subject paper year topicCount source")
  .sort({ examType: 1, subject: 1 })
  .lean();

console.log(JSON.stringify({ total: docs.length, docs }, null, 2));
await mongoose.disconnect();
