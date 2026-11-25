import mongoose from 'mongoose';

const followUpSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending', required: true },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

followUpSchema.index({ assignedTo: 1, status: 1, scheduledAt: 1 });
followUpSchema.index({ leadId: 1, status: 1, scheduledAt: 1 });

export const FollowUp = mongoose.model('FollowUp', followUpSchema);
