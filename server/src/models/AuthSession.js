import mongoose from 'mongoose';

const authSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  refreshTokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AuthSession', default: null },
  createdIp: { type: String, maxlength: 64 },
  userAgent: { type: String, maxlength: 500 },
}, { timestamps: true });

export const AuthSession = mongoose.model('AuthSession', authSessionSchema);
