import Admin from '../models/Admin.js';

const DEFAULT_ADMINS = [
  {
    name: 'Super Admin',
    email: 'iscorre2026@gmail.com',
    password: 'Iscorre2026@321',
    userType: 'Admin',
  },
  {
    name: 'Super Admin',
    email: 'admin@testladr.com',
    password: 'TestLadr@2026',
    userType: 'Admin',
  },
];

export const seedAdmin = async () => {
  try {
    for (const admin of DEFAULT_ADMINS) {
      const existingAdmin = await Admin.findOne({ email: admin.email });
      if (!existingAdmin) {
        await new Admin(admin).save();
        console.log(`✅ Default Admin created: ${admin.email}`);
      } else {
        console.log(`ℹ️ Admin already exists (${admin.email}), skipping seeding.`);
      }
    }
  } catch (error) {
    console.error('❌ Error seeding admin:', error.message);
  }
};
