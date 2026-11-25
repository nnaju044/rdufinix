import mongoose from 'mongoose';

const issueSchema = new mongoose.Schema({
  field: { type: String, maxlength: 120 },
  code: { type: String, required: true, maxlength: 80 },
  message: { type: String, required: true, maxlength: 500 },
}, { _id: false });

const duplicateSchema = new mongoose.Schema({
  duplicateType: { type: String, enum: ['exact', 'possible'], required: true },
  source: { type: String, enum: ['file', 'database'], required: true },
  rowNumber: { type: Number, default: null },
  leadId: { type: String, default: null },
  name: { type: String, default: null },
  phone: { type: String, default: null },
}, { _id: false });

const importRowSchema = new mongoose.Schema({
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch', required: true },
  rowNumber: { type: Number, required: true },
  rawData: { type: mongoose.Schema.Types.Mixed, required: true },
  candidate: { type: mongoose.Schema.Types.Mixed, default: null },
  rowStatus: { type: String, enum: ['valid', 'invalid', 'duplicate'], required: true },
  duplicateType: { type: String, enum: ['exact', 'possible', null], default: null },
  duplicateMatches: { type: [duplicateSchema], default: [] },
  issues: { type: [issueSchema], default: [] },
  commitStatus: { type: String, enum: ['pending', 'imported', 'failed', 'skipped', 'rejected'], default: 'pending', required: true },
  leadRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  attemptCount: { type: Number, default: 0 },
  lastError: { type: String, maxlength: 500, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

importRowSchema.index({ batchId: 1, rowNumber: 1 }, { unique: true });
importRowSchema.index({ batchId: 1, commitStatus: 1, rowNumber: 1 });
importRowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const ImportRow = mongoose.model('ImportRow', importRowSchema);
