import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['founder', 'admin', 'salesperson'], required: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.__v; return ret; } } });

userSchema.methods.setPassword = async function setPassword(password) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be between 12 and 72 UTF-8 bytes');
  }
  this.passwordHash = await bcrypt.hash(password, 12);
};
userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
