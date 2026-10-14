import Admin from '../models/Admin.js';

const DEFAULT_ADMINS = [
  {
    name: 'Super Admin',
    email: 'iscorre2026@gmail.com',
    password: 'Iscorre2026@321',
    userType: 'Admin',
    role: 'superadmin',
    allowedModules: ['*'],
  },
  {
    name: 'Super Admin',
    email: 'admin@testladr.com',
    password: 'TestLadr@2026',
    userType: 'Admin',
    role: 'superadmin',
    allowedModules: ['*'],
  },
  {
    name: 'Blog Sub Admin',
    email: 'subadmin@testladr.com',
    password: 'TestLadr@2026',
    userType: 'Admin',
    role: 'subadmin',
    allowedModules: ['blogs'],
  },
];

export const seedAdmin = async () => {
  try {
    for (const admin of DEFAULT_ADMINS) {
      const existingAdmin = await Admin.findOne({ email: admin.email });
      if (!existingAdmin) {
        await new Admin(admin).save();
        console.log(`✅ Default Admin created: ${admin.email} (Role: ${admin.role})`);
      } else {
        let needsSave = false;
        if (!existingAdmin.role || (admin.role && existingAdmin.role !== admin.role)) {
          existingAdmin.role = admin.role;
          needsSave = true;
        }
        if (!existingAdmin.allowedModules || existingAdmin.allowedModules.length === 0 || existingAdmin.role === 'subadmin') {
          existingAdmin.allowedModules = admin.allowedModules;
          needsSave = true;
        }
        if (needsSave) {
          await existingAdmin.save();
          console.log(`✅ Updated Admin permissions: ${admin.email} (Role: ${admin.role})`);
        } else {
          console.log(`ℹ️ Admin already exists (${admin.email}), skipping seeding.`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error seeding admin:', error.message);
  }
};
