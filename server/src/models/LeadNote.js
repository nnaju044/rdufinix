import mongoose from 'mongoose';

const leadNoteSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, immutable: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  body: { type: String, required: true, trim: true, maxlength: 5000, immutable: true },
}, { timestamps: true });

leadNoteSchema.index({ leadId: 1, createdAt: -1 });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  leadNoteSchema.pre(operation, function preventNoteMutation() {
    throw new Error('Lead notes are immutable; add a new note instead');
  });
}
leadNoteSchema.pre('deleteOne', { document: true, query: false }, function preventDocumentDelete() {
  throw new Error('Lead notes are immutable; add a new note instead');
});

export const LeadNote = mongoose.model('LeadNote', leadNoteSchema);
