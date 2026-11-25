import mongoose from 'mongoose';

export const LEAD_STATUSES = [
  'NEW', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_SCHEDULED',
  'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER',
];
export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const leadSchema = new mongoose.Schema({
  leadId: { type: String, required: true, unique: true, immutable: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  phone: { type: String, required: true, trim: true, maxlength: 40 },
  normalizedPhone: { type: String, required: true, trim: true, maxlength: 20 },
  phoneSuffix: { type: String, trim: true, maxlength: 7, select: false },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
  source: { type: String, required: true, trim: true, maxlength: 120 },
  status: { type: String, enum: LEAD_STATUSES, default: 'NEW', required: true },
  priority: { type: String, enum: LEAD_PRIORITIES, default: 'MEDIUM', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastContactedAt: { type: Date, default: null },
  nextFollowUpAt: { type: Date, default: null },
  customFields: { type: Map, of: String, default: {} },
  isArchived: { type: Boolean, default: false, index: true },
}, { timestamps: true });

leadSchema.index({ assignedTo: 1, status: 1, isArchived: 1, createdAt: -1 });
leadSchema.index({ status: 1, isArchived: 1, createdAt: -1 });
leadSchema.index({ normalizedPhone: 1 });
leadSchema.index({ phoneSuffix: 1 });

export const Lead = mongoose.model('Lead', leadSchema);
