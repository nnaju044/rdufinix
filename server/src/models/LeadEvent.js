import mongoose from 'mongoose';

export const LEAD_EVENT_TYPES = [
  'LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_ARCHIVED', 'LEAD_ASSIGNED', 'LEAD_REASSIGNED',
  'STATUS_CHANGED', 'NOTE_ADDED', 'FOLLOWUP_CREATED', 'FOLLOWUP_COMPLETED', 'FOLLOWUP_TRANSFERRED',
];

const leadEventSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  eventType: { type: String, enum: LEAD_EVENT_TYPES, required: true, immutable: true },
  previousValue: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  newValue: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  description: { type: String, required: true, maxlength: 2000, immutable: true },
  timestamp: { type: Date, default: Date.now, immutable: true },
}, { timestamps: false, versionKey: false });

leadEventSchema.index({ leadId: 1, timestamp: -1 });
leadEventSchema.index({ actorId: 1, eventType: 1, timestamp: -1 });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  leadEventSchema.pre(operation, function preventHistoryMutation() {
    throw new Error('Lead events are immutable; append a compensating event instead');
  });
}
leadEventSchema.pre('deleteOne', { document: true, query: false }, function preventDocumentDelete() {
  throw new Error('Lead events are immutable; append a compensating event instead');
});

export const LeadEvent = mongoose.model('LeadEvent', leadEventSchema);
