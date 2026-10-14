import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  userType: { type: String, required: true, default: 'Admin' },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'subadmin'],
    default: 'admin',
  },
  allowedModules: {
    type: [String],
    default: ['*'],
  },
  passwordResetOTP: { type: String, default: null },
  passwordResetOTPExpires: { type: Date, default: null },
  refreshToken: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
  },
});

// ✅ Hash password before save
adminSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// ✅ Method to compare passwords
adminSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

// ✅ Method to generate Access Token
adminSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      userType: this.userType,
      role: this.role || 'admin',
      allowedModules: this.allowedModules || ['*'],
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '2d' }
  );
};

// ✅ Method to generate Refresh Token
adminSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      userType: this.userType,
      role: this.role || 'admin',
      allowedModules: this.allowedModules || ['*'],
    },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '7d' }
  );
};

export default mongoose.model('Admin', adminSchema);
