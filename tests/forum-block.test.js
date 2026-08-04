import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import Student from '../src/models/Student.js';
import Admin from '../src/models/Admin.js';
import Teacher from '../src/models/Teacher.js';

dotenv.config();

if (process.env.MONGODB_URI?.startsWith('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME,
  });

  const targetUserId = '69f305a757da62f102ab88fa';

  const student = await Student.findById(targetUserId).lean();
  console.log("Is Student?", !!student);

  const admin = await Admin.findById(targetUserId).lean();
  console.log("Is Admin?", !!admin);

  const teacher = await Teacher.findById(targetUserId).lean();
  console.log("Is Teacher?", !!teacher);

  await mongoose.connection.close();
};

run();
