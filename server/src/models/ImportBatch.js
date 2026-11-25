import mongoose from 'mongoose';

const importBatchSchema = new mongoose.Schema({
  fileName: { type: String, required: true, maxlength: 255 },
  fileSize: { type: Number, required: true, min: 1 },
  fileHash: { type: String, required: true, select: false },
  sheetName: { type: String, required: true, maxlength: 120 },
  headers: { type: [String], required: true },
  mapping: { type: mongoose.Schema.Types.Mixed, required: true },
  assignmentStrategy: {
    type: { type: String, enum: ['unassigned', 'single', 'equal'], required: true },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  confirmedDuplicateRows: { type: [Number], default: [] },
  status: { type: String, enum: ['STAGING', 'PREVIEW', 'STAGE_FAILED', 'COMMITTING', 'COMPLETED', 'COMPLETED_WITH_ERRORS'], default: 'STAGING', required: true, index: true },
  totalRows: { type: Number, default: 0 },
  validRows: { type: Number, default: 0 },
  invalidRows: { type: Number, default: 0 },
  duplicateRows: { type: Number, default: 0 },
  importedRows: { type: Number, default: 0 },
  failedRows: { type: Number, default: 0 },
  skippedRows: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now, required: true },
  completedAt: { type: Date, default: null },
  rowRetentionUntil: { type: Date, default: null },
  lastError: { type: String, maxlength: 500, default: null },
}, { timestamps: true });

importBatchSchema.index({ createdBy: 1, uploadedAt: -1 });

export const ImportBatch = mongoose.model('ImportBatch', importBatchSchema);
