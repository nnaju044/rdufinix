import { LeadNote } from '../models/LeadNote.js';
import { Lead } from '../models/Lead.js';
import { httpError } from '../utils/httpError.js';
import { normalizePagination } from '../utils/pagination.js';

function leadIdSelector(id) {
  return /^[a-f\d]{24}$/i.test(id) ? { $or: [{ _id: id }, { leadId: id }] } : { leadId: id };
}

export async function listLeadNotes(user, id, query) {
  const filterLead = { ...leadIdSelector(id) };
  if (user.role === 'salesperson') Object.assign(filterLead, { assignedTo: user._id || user.id, isArchived: false });
  const lead = await Lead.findOne(filterLead).select('_id');
  if (!lead) throw httpError(404, 'LEAD_NOT_FOUND', 'Lead was not found');
  const { page, limit, skip } = normalizePagination(query);
  const filter = { leadId: lead._id };
  const [items, total] = await Promise.all([
    LeadNote.find(filter).populate('authorId', 'name role').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    LeadNote.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
