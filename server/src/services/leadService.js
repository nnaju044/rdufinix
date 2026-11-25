import mongoose from 'mongoose';
import { Lead, LEAD_STATUSES, LEAD_PRIORITIES } from '../models/Lead.js';
import { LeadEvent } from '../models/LeadEvent.js';
import { LeadNote } from '../models/LeadNote.js';
import { FollowUp } from '../models/FollowUp.js';
import { User } from '../models/User.js';
import { normalizePhone } from '../utils/phone.js';
import { createLeadId } from '../utils/leadIds.js';
import { inTransaction } from '../utils/transactions.js';
import { httpError } from '../utils/httpError.js';
import { normalizePagination } from '../utils/pagination.js';

const TERMINAL_STATUSES = new Set(['CONVERTED', 'NOT_INTERESTED', 'INVALID_NUMBER']);
const TRANSITIONS = {
  NEW: ['ASSIGNED', 'CONTACTED', 'INVALID_NUMBER'],
  ASSIGNED: ['CONTACTED', 'INTERESTED', 'FOLLOW_UP_SCHEDULED', 'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER'],
  CONTACTED: ['INTERESTED', 'FOLLOW_UP_SCHEDULED', 'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER'],
  INTERESTED: ['CONTACTED', 'FOLLOW_UP_SCHEDULED', 'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER'],
  FOLLOW_UP_SCHEDULED: ['CONTACTED', 'INTERESTED', 'CONVERTED', 'NOT_INTERESTED', 'NO_RESPONSE', 'INVALID_NUMBER'],
  CONVERTED: [],
  NOT_INTERESTED: ['CONTACTED'],
  NO_RESPONSE: ['CONTACTED', 'FOLLOW_UP_SCHEDULED', 'NOT_INTERESTED', 'INVALID_NUMBER'],
  INVALID_NUMBER: [],
};

function actorId(user) { return user._id || user.id; }
function objectId(value) { return mongoose.Types.ObjectId.isValid(value); }
function leadSelector(id) {
  return objectId(id) ? { $or: [{ _id: id }, { leadId: id }] } : { leadId: id };
}
function assertRole(user, roles) {
  if (!roles.includes(user.role)) throw httpError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
}
function assertValidStatus(status) {
  if (!LEAD_STATUSES.includes(status)) throw httpError(400, 'INVALID_STATUS', `Status must be one of: ${LEAD_STATUSES.join(', ')}`);
}
function event(lead, actor, eventType, previousValue, newValue, description) {
  return { leadId: lead._id, actorId: actorId(actor), eventType, previousValue, newValue, description, timestamp: new Date() };
}
function scopeFilter(user) {
  return user.role === 'salesperson' ? { assignedTo: actorId(user), isArchived: false } : {};
}
async function findAccessibleLead(user, id, { session, activeOnly = false } = {}) {
  const filter = { ...leadSelector(id), ...scopeFilter(user) };
  if (activeOnly) filter.isArchived = false;
  let query = Lead.findOne(filter);
  if (session) query = query.session(session);
  const lead = await query;
  if (!lead) throw httpError(404, 'LEAD_NOT_FOUND', 'Lead was not found');
  return lead;
}
async function activeSalesperson(id, session) {
  const query = User.findOne({ _id: id, role: 'salesperson', active: true }).select('name email role active');
  if (session) query.session(session);
  const user = await query;
  if (!user) throw httpError(400, 'INVALID_ASSIGNEE', 'Choose an active salesperson');
  return user;
}
async function phoneDuplicates(normalizedPhone, excludeLeadId) {
  const exactFilter = { normalizedPhone };
  if (excludeLeadId) exactFilter._id = { $ne: excludeLeadId };
  const exact = await Lead.find(exactFilter).select('leadId name phone status assignedTo').limit(5).lean();
  const possible = [];
  if (!exact.length && normalizedPhone.length >= 10) {
    const possibleFilter = { normalizedPhone: { $regex: `${normalizedPhone.slice(-7)}$`, $ne: normalizedPhone } };
    if (excludeLeadId) possibleFilter._id = { $ne: excludeLeadId };
    possible.push(...await Lead.find(possibleFilter).select('leadId name phone status assignedTo').limit(5).lean());
  }
  return [
    ...exact.map((item) => ({ ...item, duplicateType: 'exact' })),
    ...possible.map((item) => ({ ...item, duplicateType: 'possible' })),
  ];
}
function validateEmail(email) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'INVALID_EMAIL', 'Enter a valid email address');
}
function validateNameSource(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw httpError(400, 'VALIDATION_ERROR', `${label} is required and must be at most ${max} characters`);
  return value.trim();
}
const escapeRegex = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listLeads(user, query) {
  const { page, limit, skip } = normalizePagination(query);
  const filter = { ...scopeFilter(user) };
  if (user.role !== 'salesperson' && query.assignedTo) filter.assignedTo = query.assignedTo;
  if (user.role !== 'salesperson' && query.archived === 'all') {
    // Founder/Admin may include archived leads in the result set.
  } else if (user.role !== 'salesperson' && query.archived === 'true') filter.isArchived = true;
  else filter.isArchived = false;
  if (query.status) {
    if (!LEAD_STATUSES.includes(query.status)) throw httpError(400, 'INVALID_STATUS', 'Unknown lead status');
    filter.status = query.status;
  }
  if (query.priority) {
    if (!LEAD_PRIORITIES.includes(query.priority)) throw httpError(400, 'INVALID_PRIORITY', 'Unknown lead priority');
    filter.priority = query.priority;
  }
  if (query.source) {
    if (typeof query.source !== 'string' || query.source.length > 120) throw httpError(400, 'INVALID_SOURCE', 'Source filter must be at most 120 characters');
    filter.source = query.source;
  }
  if (query.assignedTo && user.role !== 'salesperson') {
    if (!objectId(query.assignedTo)) throw httpError(400, 'INVALID_ASSIGNEE', 'Assignee filter is invalid');
    filter.assignedTo = query.assignedTo;
  }
  if (query.q) {
    if (typeof query.q !== 'string' || query.q.length > 100) throw httpError(400, 'INVALID_SEARCH', 'Search text must be at most 100 characters');
    const regex = new RegExp(escapeRegex(query.q.trim()), 'i');
    filter.$or = [{ name: regex }, { leadId: regex }, { phone: regex }, { normalizedPhone: regex }, { email: regex }];
  }
  const [items, total] = await Promise.all([
    Lead.find(filter).populate('assignedTo', 'name email').populate('createdBy', 'name').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getLead(user, id) {
  const lead = await findAccessibleLead(user, id);
  return lead.populate?.([{ path: 'assignedTo', select: 'name email' }, { path: 'assignedBy', select: 'name' }, { path: 'createdBy', select: 'name' }]) || lead;
}

export async function createLead(user, input) {
  assertRole(user, ['admin']);
  const name = validateNameSource(input.name, 'Name', 160);
  const source = validateNameSource(input.source, 'Source', 120);
  const phone = validateNameSource(input.phone, 'Phone', 40);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw httpError(400, 'INVALID_PHONE', 'Phone must include a country code and contain 8 to 15 digits');
  const email = input.email ? String(input.email).trim().toLowerCase() : null;
  validateEmail(email);
  if (input.priority && !LEAD_PRIORITIES.includes(input.priority)) throw httpError(400, 'INVALID_PRIORITY', 'Unknown lead priority');
  if (input.status && input.status !== 'NEW' && input.status !== 'ASSIGNED') throw httpError(400, 'INVALID_STATUS', 'New leads must start as NEW or ASSIGNED');
  if (input.assignedTo && !objectId(input.assignedTo)) throw httpError(400, 'INVALID_ASSIGNEE', 'Assignee ID is invalid');
  if (input.status === 'ASSIGNED' && !input.assignedTo) throw httpError(400, 'ASSIGNEE_REQUIRED', 'Assign the lead before creating it with ASSIGNED status');
  const duplicates = await phoneDuplicates(normalizedPhone);
  if (duplicates.length && input.confirmDuplicate !== true) {
    throw httpError(409, 'DUPLICATE_LEAD', 'This phone matches existing leads. Review the matches and explicitly confirm if this is a separate lead.', { duplicates });
  }
  return inTransaction(async (session) => {
    const assignee = input.assignedTo ? await activeSalesperson(input.assignedTo, session) : null;
    const lead = new Lead({
      leadId: createLeadId(), name, phone, normalizedPhone, email, source,
      phoneSuffix: normalizedPhone.slice(-7),
      status: assignee ? 'ASSIGNED' : 'NEW', priority: input.priority || 'MEDIUM',
      assignedTo: assignee?._id || null, assignedBy: assignee ? actorId(user) : null,
      createdBy: actorId(user), isArchived: false,
    });
    await lead.save({ session });
    const events = [event(lead, user, 'LEAD_CREATED', null, { leadId: lead.leadId, status: lead.status }, `Lead ${lead.leadId} created` )];
    if (assignee) events.push(event(lead, user, 'LEAD_ASSIGNED', null, { assignedTo: assignee._id }, `Lead assigned to ${assignee.name}`));
    if (duplicates.length) events[0].description += `; duplicate reviewed (${duplicates.length} match(es))`;
    await LeadEvent.create(events, { session });
    return lead;
  });
}

export async function updateLead(user, id, input) {
  assertRole(user, ['admin']);
  const allowed = ['name', 'phone', 'email', 'source', 'priority', 'isArchived', 'confirmDuplicate'];
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw httpError(400, 'USE_DEDICATED_ENDPOINT', 'Status and ownership changes must use their dedicated endpoints');
  return inTransaction(async (session) => {
    const lead = await findAccessibleLead(user, id, { session });
    const previous = {};
    const next = {};
    for (const key of ['name', 'phone', 'email', 'source', 'priority', 'isArchived']) {
      if (input[key] === undefined) continue;
      if (key === 'name') next.name = validateNameSource(input.name, 'Name', 160);
      else if (key === 'source') next.source = validateNameSource(input.source, 'Source', 120);
      else if (key === 'phone') {
        const phone = validateNameSource(input.phone, 'Phone', 40);
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) throw httpError(400, 'INVALID_PHONE', 'Phone must include a country code and contain 8 to 15 digits');
        const duplicates = await phoneDuplicates(normalizedPhone, lead._id);
        if (duplicates.length && input.confirmDuplicate !== true) throw httpError(409, 'DUPLICATE_LEAD', 'Phone matches other leads; review and confirm to save', { duplicates });
        next.phone = phone; next.normalizedPhone = normalizedPhone; next.phoneSuffix = normalizedPhone.slice(-7);
      } else if (key === 'email') {
        const email = input.email ? String(input.email).trim().toLowerCase() : null;
        validateEmail(email); next.email = email;
      } else if (key === 'priority') {
        if (!LEAD_PRIORITIES.includes(input.priority)) throw httpError(400, 'INVALID_PRIORITY', 'Unknown lead priority');
        next.priority = input.priority;
      } else if (key === 'isArchived') {
        if (typeof input.isArchived !== 'boolean') throw httpError(400, 'VALIDATION_ERROR', 'isArchived must be a boolean');
        next.isArchived = input.isArchived;
      }
      previous[key] = lead[key];
    }
    if (!Object.keys(next).length) throw httpError(400, 'EMPTY_UPDATE', 'Provide at least one editable field');
    Object.assign(lead, next);
    await lead.save({ session });
    const eventType = next.isArchived === true && previous.isArchived === false ? 'LEAD_ARCHIVED' : 'LEAD_UPDATED';
    await LeadEvent.create([event(lead, user, eventType, previous, next, eventType === 'LEAD_ARCHIVED' ? `Lead ${lead.leadId} archived` : `Lead ${lead.leadId} updated`)], { session });
    return lead;
  });
}

export async function assignLead(user, id, assigneeId) {
  assertRole(user, ['admin']);
  if (!objectId(assigneeId)) throw httpError(400, 'INVALID_ASSIGNEE', 'Assignee ID is invalid');
  return inTransaction(async (session) => {
    const lead = await findAccessibleLead(user, id, { session, activeOnly: true });
    const assignee = await activeSalesperson(assigneeId, session);
    const oldAssignee = lead.assignedTo ? String(lead.assignedTo) : null;
    if (oldAssignee === String(assignee._id)) return { lead, changed: false, transferredFollowUps: 0 };
    const firstAssignment = !oldAssignee;
    const previousStatus = lead.status;
    lead.assignedTo = assignee._id;
    lead.assignedBy = actorId(user);
    if (lead.status === 'NEW') lead.status = 'ASSIGNED';
    await lead.save({ session });
    const events = [event(lead, user, firstAssignment ? 'LEAD_ASSIGNED' : 'LEAD_REASSIGNED', { assignedTo: oldAssignee }, { assignedTo: assignee._id }, `${firstAssignment ? 'Assigned' : 'Reassigned'} to ${assignee.name}`)];
    if (previousStatus !== lead.status) events.push(event(lead, user, 'STATUS_CHANGED', previousStatus, lead.status, `Status changed from ${previousStatus} to ${lead.status}`));
    const pending = await FollowUp.find({ leadId: lead._id, status: 'pending' }).session(session);
    if (pending.length) {
      await FollowUp.updateMany({ leadId: lead._id, status: 'pending' }, { $set: { assignedTo: assignee._id } }, { session });
      for (const followUp of pending) events.push(event(lead, user, 'FOLLOWUP_TRANSFERRED', { followUpId: followUp._id, assignedTo: followUp.assignedTo }, { followUpId: followUp._id, assignedTo: assignee._id }, `Open follow-up transferred to ${assignee.name}`));
    }
    await LeadEvent.create(events, { session });
    return { lead, changed: true, transferredFollowUps: pending.length };
  });
}

export async function changeLeadStatus(user, id, status) {
  assertRole(user, ['admin', 'salesperson']);
  assertValidStatus(status);
  return inTransaction(async (session) => {
    const lead = await findAccessibleLead(user, id, { session, activeOnly: true });
    if (lead.status === status) return { lead, changed: false };
    if (!TRANSITIONS[lead.status]?.includes(status)) throw httpError(400, 'INVALID_STATUS_TRANSITION', `Cannot change status from ${lead.status} to ${status}`);
    if (status === 'ASSIGNED' && !lead.assignedTo) throw httpError(400, 'ASSIGNEE_REQUIRED', 'Assign the lead to a salesperson before setting ASSIGNED');
    if (status === 'FOLLOW_UP_SCHEDULED') {
      const pendingCount = await FollowUp.countDocuments({ leadId: lead._id, status: 'pending' }).session(session);
      if (!pendingCount) throw httpError(400, 'FOLLOWUP_REQUIRED', 'Schedule a follow-up before setting this status');
    }
    const previous = lead.status;
    lead.status = status;
    if (['CONTACTED', 'INTERESTED', 'NO_RESPONSE'].includes(status)) lead.lastContactedAt = new Date();
    await lead.save({ session });
    await LeadEvent.create([event(lead, user, 'STATUS_CHANGED', previous, status, `Status changed from ${previous} to ${status}`)], { session });
    return { lead, changed: true };
  });
}

export async function listLeadEvents(user, id, query) {
  const lead = await findAccessibleLead(user, id);
  const { page, limit, skip } = normalizePagination(query);
  const filter = { leadId: lead._id };
  const [items, total] = await Promise.all([
    LeadEvent.find(filter).populate('actorId', 'name email role').sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    LeadEvent.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function addLeadNote(user, id, body) {
  assertRole(user, ['admin', 'salesperson']);
  if (typeof body !== 'string' || !body.trim() || body.trim().length > 5000) throw httpError(400, 'VALIDATION_ERROR', 'Note is required and must be at most 5000 characters');
  return inTransaction(async (session) => {
    const lead = await findAccessibleLead(user, id, { session, activeOnly: true });
    const [note] = await LeadNote.create([{ leadId: lead._id, authorId: actorId(user), body: body.trim() }], { session });
    await LeadEvent.create([event(lead, user, 'NOTE_ADDED', null, { noteId: note._id }, 'Internal note added')], { session });
    return note;
  });
}

export async function listLeadFollowUps(user, id, query) {
  const lead = await findAccessibleLead(user, id);
  const { page, limit, skip } = normalizePagination(query);
  const filter = { leadId: lead._id };
  if (query.status && !['pending', 'completed', 'cancelled'].includes(query.status)) throw httpError(400, 'INVALID_FOLLOWUP_STATUS', 'Unknown follow-up status');
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    FollowUp.find(filter).populate('assignedTo', 'name email').populate('createdBy', 'name').sort({ scheduledAt: 1 }).skip(skip).limit(limit).lean(),
    FollowUp.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function createLeadFollowUp(user, id, input) {
  assertRole(user, ['admin', 'salesperson']);
  const scheduledAt = new Date(input.scheduledAt);
  if (!input.scheduledAt || Number.isNaN(scheduledAt.getTime())) throw httpError(400, 'INVALID_SCHEDULED_AT', 'Provide a valid scheduledAt date');
  if (scheduledAt.getTime() < Date.now() - 60_000) throw httpError(400, 'INVALID_SCHEDULED_AT', 'Follow-up time cannot be in the past');
  if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 2000)) throw httpError(400, 'VALIDATION_ERROR', 'Follow-up notes must be at most 2000 characters');
  return inTransaction(async (session) => {
    const lead = await findAccessibleLead(user, id, { session, activeOnly: true });
    if (!lead.assignedTo) throw httpError(409, 'LEAD_UNASSIGNED', 'Assign this lead before scheduling a follow-up');
    if (user.role === 'salesperson' && String(lead.assignedTo) !== String(actorId(user))) throw httpError(403, 'FORBIDDEN', 'You can only schedule follow-ups for your assigned leads');
    if (TERMINAL_STATUSES.has(lead.status)) throw httpError(400, 'TERMINAL_LEAD_STATUS', 'This lead status does not allow follow-ups');
    const [followUp] = await FollowUp.create([{
      leadId: lead._id, assignedTo: lead.assignedTo, createdBy: actorId(user), scheduledAt,
      notes: input.notes?.trim() || '', status: 'pending',
    }], { session });
    const previousStatus = lead.status;
    const nextPending = await FollowUp.findOne({ leadId: lead._id, status: 'pending' }).sort({ scheduledAt: 1 }).session(session).lean();
    lead.nextFollowUpAt = nextPending?.scheduledAt || scheduledAt;
    if (lead.status !== 'FOLLOW_UP_SCHEDULED') lead.status = 'FOLLOW_UP_SCHEDULED';
    await lead.save({ session });
    const events = [event(lead, user, 'FOLLOWUP_CREATED', null, { followUpId: followUp._id, scheduledAt }, `Follow-up scheduled for ${scheduledAt.toISOString()}`)];
    if (previousStatus !== lead.status) events.push(event(lead, user, 'STATUS_CHANGED', previousStatus, lead.status, `Status changed from ${previousStatus} to ${lead.status}`));
    await LeadEvent.create(events, { session });
    return followUp;
  });
}

export async function completeFollowUp(user, followUpId) {
  assertRole(user, ['admin', 'salesperson']);
  if (!objectId(followUpId)) throw httpError(400, 'INVALID_FOLLOWUP_ID', 'Follow-up ID is invalid');
  return inTransaction(async (session) => {
    const filter = { _id: followUpId };
    if (user.role === 'salesperson') filter.assignedTo = actorId(user);
    const followUp = await FollowUp.findOne(filter).session(session);
    if (!followUp) throw httpError(404, 'FOLLOWUP_NOT_FOUND', 'Follow-up was not found');
    if (followUp.status !== 'pending') throw httpError(409, 'FOLLOWUP_NOT_PENDING', 'Only pending follow-ups can be completed');
    const lead = await findAccessibleLead(user, followUp.leadId, { session, activeOnly: true });
    followUp.status = 'completed';
    followUp.completedAt = new Date();
    await followUp.save({ session });
    const events = [event(lead, user, 'FOLLOWUP_COMPLETED', { followUpId: followUp._id, status: 'pending' }, { followUpId: followUp._id, status: 'completed' }, 'Follow-up completed')];
    const nextPending = await FollowUp.findOne({ leadId: lead._id, status: 'pending' }).sort({ scheduledAt: 1 }).session(session).lean();
    lead.nextFollowUpAt = nextPending?.scheduledAt || null;
    if (!nextPending && lead.status === 'FOLLOW_UP_SCHEDULED') {
      const previousStatus = lead.status;
      lead.status = 'CONTACTED';
      lead.lastContactedAt = new Date();
      events.push(event(lead, user, 'STATUS_CHANGED', previousStatus, lead.status, `Status changed from ${previousStatus} to ${lead.status} after follow-up completion`));
    }
    await lead.save({ session });
    await LeadEvent.create(events, { session });
    return followUp;
  });
}

export const leadWorkflow = { TRANSITIONS };
