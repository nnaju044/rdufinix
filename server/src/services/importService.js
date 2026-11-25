import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ImportBatch } from '../models/ImportBatch.js';
import { ImportRow } from '../models/ImportRow.js';
import { Lead, LEAD_PRIORITIES } from '../models/Lead.js';
import { LeadEvent } from '../models/LeadEvent.js';
import { User } from '../models/User.js';
import { normalizePhone } from '../utils/phone.js';
import { createLeadId } from '../utils/leadIds.js';
import { inTransaction } from '../utils/transactions.js';
import { normalizePagination } from '../utils/pagination.js';
import { inspectUpload, IMPORT_LIMITS } from './spreadsheetParser.js';

const activeCommits = new Set();
const nameSource = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
function bad(status, code, message, details) { const error = new Error(message); error.status = status; error.code = code; if (details !== undefined) error.details = details; throw error; }
function assertAdmin(user) { if (user?.role !== 'admin') bad(403, 'FORBIDDEN', 'You do not have permission to manage lead imports'); }
const idOf = (user) => user._id || user.id;
function mapCandidate(values, headers, mapping) {
  const byHeader = new Map(headers.map((header, i) => [header, String(values[i] ?? '').trim()]));
  const get = (field) => mapping[field] ? byHeader.get(mapping[field]) ?? '' : '';
  const fields = mapping.additionalFields || [];
  const customFields = {};
  for (const field of fields) customFields[field.key] = get(field.key).slice(0, 500);
  return { name: get('name'), phone: get('phone'), email: get('email'), source: get('source'), priority: get('priority').toUpperCase(), customFields };
}
function validateCandidate(candidate, rowNumber) {
  const issues = [];
  const name = nameSource(candidate.name, 160); if (!name) issues.push({ field: 'name', code: 'INVALID_NAME', message: 'Name is required (up to 160 characters)' });
  const phone = nameSource(candidate.phone, 40); const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (!normalizedPhone) issues.push({ field: 'phone', code: 'INVALID_PHONE', message: 'Phone must include a country code and contain 8 to 15 digits' });
  const email = candidate.email ? candidate.email.toLowerCase() : null;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) issues.push({ field: 'email', code: 'INVALID_EMAIL', message: 'Email address is invalid' });
  const source = nameSource(candidate.source, 120); if (!source) issues.push({ field: 'source', code: 'INVALID_SOURCE', message: 'Source is required (up to 120 characters)' });
  const priority = candidate.priority || 'MEDIUM'; if (!LEAD_PRIORITIES.includes(priority)) issues.push({ field: 'priority', code: 'INVALID_PRIORITY', message: 'Priority must be LOW, MEDIUM, HIGH or URGENT' });
  const formulaLike = [candidate.name, candidate.email, candidate.source, ...Object.values(candidate.customFields)].some((value) => /^\s*[=+@\-\t\r]/.test(String(value || '')))
    || /^\s*[=@\-\t\r]/.test(String(candidate.phone || ''))
    || [candidate.name, candidate.phone, candidate.email, candidate.source, ...Object.values(candidate.customFields)].includes('[FORMULA NOT ALLOWED]');
  if (formulaLike) issues.push({ field: 'row', code: 'FORMULA_LIKE_VALUE', message: 'Formula-like values are not accepted; review the cell as plain text' });
  return { rowNumber, candidate: issues.length ? null : { ...candidate, name, phone, normalizedPhone, email, source, priority, phoneSuffix: normalizedPhone.slice(-7) }, issues };
}
function normalizeMapping(headers, mapping = {}) {
  const allowed = ['name', 'phone', 'email', 'source', 'priority'];
  const result = {};
  for (const key of allowed) {
    const value = mapping[key];
    if (key === 'name' || key === 'phone' || key === 'source') {
      if (!headers.includes(value)) bad(400, 'INVALID_MAPPING', `Map ${key} to a column header`);
    } else if (value && !headers.includes(value)) bad(400, 'INVALID_MAPPING', `Mapped ${key} header was not found`);
    if (value) result[key] = value;
  }
  if (!result.name || !result.phone || !result.source) bad(400, 'INVALID_MAPPING', 'Name, phone and source mappings are required');
  const fields = mapping.additionalFields || [];
  if (!Array.isArray(fields) || fields.length > 10) bad(400, 'INVALID_MAPPING', 'At most 10 additional fields are supported');
  const usedKeys = new Set();
  result.additionalFields = fields.map(({ key, header }) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key || '') || [...allowed, 'additionalFields', '__proto__', 'constructor', 'prototype'].includes(key) || usedKeys.has(key) || !headers.includes(header)) bad(400, 'INVALID_MAPPING', 'Additional field mappings must have unique safe keys and existing columns');
    usedKeys.add(key); return { key, header };
  });
  for (const field of result.additionalFields) result[field.key] = field.header;
  return result;
}
function validateAssignment(input = {}) {
  const type = input.type || 'unassigned';
  if (!['unassigned', 'single', 'equal'].includes(type)) bad(400, 'INVALID_ASSIGNMENT_STRATEGY', 'Choose unassigned, single or equal assignment');
  const userIds = input.userIds || (input.userId ? [input.userId] : []);
  if (!Array.isArray(userIds) || userIds.length > 100 || (type === 'single' && userIds.length !== 1) || (type === 'equal' && !userIds.length) || (type === 'unassigned' && userIds.length)) bad(400, 'INVALID_ASSIGNMENT_STRATEGY', 'Provide valid salesperson selections for the assignment strategy');
  if (userIds.some((id) => !mongoose.Types.ObjectId.isValid(id)) || new Set(userIds.map(String)).size !== userIds.length) bad(400, 'INVALID_ASSIGNMENT_STRATEGY', 'Salesperson selections are invalid or duplicated');
  return { type, userIds: userIds.map(String) };
}
async function ensureAssignees(strategy) {
  if (strategy.type === 'unassigned') return;
  const users = await User.find({ _id: { $in: strategy.userIds }, role: 'salesperson', active: true }).select('_id').lean();
  if (users.length !== strategy.userIds.length) bad(400, 'INVALID_ASSIGNEE', 'Every selected salesperson must be active');
}
function duplicateEntry(type, source, lead) { return { duplicateType: type, source, rowNumber: null, leadId: lead.leadId, name: lead.name, phone: lead.phone }; }
async function findExistingDuplicates(candidates) {
  const phones = [...new Set(candidates.map((item) => item.candidate?.normalizedPhone).filter(Boolean))];
  if (!phones.length) return new Map();
  const suffixes = [...new Set(phones.map((phone) => phone.slice(-7)))];
  const [exact, possible, legacy] = await Promise.all([
    Lead.find({ normalizedPhone: { $in: phones } }).select('leadId name phone normalizedPhone +phoneSuffix').limit(phones.length * 5).lean(),
    Lead.find({ phoneSuffix: { $in: suffixes } }).select('leadId name phone normalizedPhone +phoneSuffix').limit(phones.length * 5).lean(),
    // Earlier Phase 3 records may not yet have the indexed suffix field.
    Lead.find({ phoneSuffix: { $exists: false }, normalizedPhone: { $regex: `(?:${suffixes.join('|')})$` } }).select('leadId name phone normalizedPhone +phoneSuffix').limit(phones.length * 5).lean(),
  ]);
  const results = new Map();
  for (const phone of phones) {
    const exactMatches = exact.filter((lead) => lead.normalizedPhone === phone).slice(0, 5).map((lead) => duplicateEntry('exact', 'database', lead));
    const matches = exactMatches.length ? exactMatches : [...possible, ...legacy].filter((lead) => lead.normalizedPhone !== phone && lead.normalizedPhone?.slice(-7) === phone.slice(-7)).slice(0, 5).map((lead) => duplicateEntry('possible', 'database', lead));
    if (matches.length) results.set(phone, matches);
  }
  return results;
}
function markDuplicates(validated, existing) {
  const firstByPhone = new Map(); const firstBySuffix = new Map();
  for (const row of validated) {
    if (!row.candidate) continue;
    const phone = row.candidate.normalizedPhone;
    const same = firstByPhone.get(phone);
    const nearby = firstBySuffix.get(phone.slice(-7));
    const matches = same ? [{ duplicateType: 'exact', source: 'file', rowNumber: same, leadId: null, name: null, phone }] : (nearby && nearby.phone !== phone ? [{ duplicateType: 'possible', source: 'file', rowNumber: nearby.rowNumber, leadId: null, name: nearby.name, phone: nearby.phone }] : (existing.get(phone) || []));
    if (matches.length) { row.rowStatus = 'duplicate'; row.duplicateType = matches[0].duplicateType; row.duplicateMatches = matches; }
    else row.rowStatus = 'valid';
    if (!same) firstByPhone.set(phone, row.rowNumber);
    if (!nearby) firstBySuffix.set(phone.slice(-7), { rowNumber: row.rowNumber, phone, name: row.candidate.name });
  }
  return validated;
}
function batchCounts(rows) { return { totalRows: rows.length, validRows: rows.filter((row) => row.rowStatus !== 'invalid').length, invalidRows: rows.filter((row) => row.rowStatus === 'invalid').length, duplicateRows: rows.filter((row) => row.rowStatus === 'duplicate').length, importedRows: 0, failedRows: 0, skippedRows: rows.filter((row) => row.rowStatus === 'invalid').length }; }
function publicBatch(batch) { const value = batch.toObject ? batch.toObject() : batch; delete value.fileHash; return value; }

export async function previewUpload(file, sheetName) {
  const result = await inspectUpload(file, sheetName);
  return result.sheets.map(({ name, headers, rows }) => ({ name, headers, rowCount: rows.length, preview: rows.slice(0, 10) }));
}

export async function stageImport(user, file, input) {
  assertAdmin(user);
  const parsed = await inspectUpload(file, input.sheetName);
  const sheet = parsed.sheets[0];
  if (!sheet) bad(400, 'INVALID_SHEET', 'Choose a worksheet to import');
  const mapping = normalizeMapping(sheet.headers, input.mapping);
  const assignmentStrategy = validateAssignment(input.assignmentStrategy);
  await ensureAssignees(assignmentStrategy);
  const rows = sheet.rows.filter(({ values }) => values.some((value) => value.trim())).map(({ rowNumber, values }) => {
    const candidate = mapCandidate(values, sheet.headers, mapping);
    const validation = validateCandidate(candidate, rowNumber);
    return { ...validation, rowStatus: validation.issues.length ? 'invalid' : null, duplicateType: null, duplicateMatches: [], rawData: Object.fromEntries(sheet.headers.map((header, i) => [header, values[i] || ''])) };
  });
  const existing = await findExistingDuplicates(rows);
  markDuplicates(rows, existing);
  const batch = await ImportBatch.create({ fileName: String(file.originalname).slice(0, 255), fileSize: file.size, fileHash: crypto.createHash('sha256').update(file.buffer).digest('hex'), sheetName: sheet.name, headers: sheet.headers, mapping, assignmentStrategy, status: 'STAGING', createdBy: idOf(user), ...batchCounts(rows) });
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const docs = rows.slice(i, i + 200).map((row) => ({ batchId: batch._id, rowNumber: row.rowNumber, rawData: row.rawData, candidate: row.candidate, rowStatus: row.rowStatus, duplicateType: row.duplicateType, duplicateMatches: row.duplicateMatches, issues: row.issues }));
      await ImportRow.insertMany(docs, { ordered: true });
    }
    batch.status = 'PREVIEW'; await batch.save();
  } catch (error) {
    await ImportRow.deleteMany({ batchId: batch._id }); batch.status = 'STAGE_FAILED'; batch.lastError = 'Failed to stage import rows'; await batch.save();
    throw error;
  }
  return { batch: publicBatch(batch), rows: await listImportRows(batch._id, { limit: 100 }) };
}

export async function listImportRows(batchId, query = {}) {
  const { page, limit, skip } = normalizePagination(query);
  const filter = { batchId };
  if (query.rowStatus && ['valid', 'invalid', 'duplicate'].includes(query.rowStatus)) filter.rowStatus = query.rowStatus;
  const [items, total] = await Promise.all([ImportRow.find(filter).select('-rawData').sort({ rowNumber: 1 }).skip(skip).limit(limit).lean(), ImportRow.countDocuments(filter)]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
export async function listImports(query = {}) {
  const { page, limit, skip } = normalizePagination(query);
  const [items, total] = await Promise.all([ImportBatch.find().select('-fileHash').populate('createdBy', 'name email').sort({ uploadedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), ImportBatch.countDocuments()]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
export async function getImport(batchId) {
  if (!mongoose.Types.ObjectId.isValid(batchId)) bad(404, 'IMPORT_NOT_FOUND', 'Import batch was not found');
  const batch = await ImportBatch.findById(batchId).select('-fileHash').populate('createdBy', 'name email');
  if (!batch) bad(404, 'IMPORT_NOT_FOUND', 'Import batch was not found');
  return batch;
}

export function targetFor(strategy, rowIndex) {
  if (strategy.type === 'unassigned') return null;
  if (strategy.type === 'single') return strategy.userIds[0];
  return strategy.userIds[rowIndex % strategy.userIds.length];
}
export async function importOne(batch, row, actor, rowIndex) {
  const assignedTo = targetFor(batch.assignmentStrategy, rowIndex);
  try {
    await inTransaction(async (session) => {
      const current = await ImportRow.findOne({ _id: row._id, commitStatus: { $in: ['pending', 'failed'] } }).session(session);
      if (!current) return;
      const currentBatch = await ImportBatch.findOne({ _id: batch._id, status: 'COMMITTING' }).session(session);
      if (!currentBatch) throw new Error('Import batch is no longer committing');
      const candidate = current.candidate;
      const duplicates = await Lead.find({ $or: [{ normalizedPhone: candidate.normalizedPhone }, { phoneSuffix: candidate.phoneSuffix }] }).select('normalizedPhone').session(session).limit(10).lean();
      if (duplicates.length && current.rowStatus !== 'duplicate') throw Object.assign(new Error('A lead with this phone appeared after preview; review duplicates again'), { code: 'DUPLICATE_REVIEW_REQUIRED' });
      if (duplicates.length && current.rowStatus === 'duplicate' && !batch.confirmedDuplicateRows.includes(current.rowNumber)) { current.commitStatus = 'skipped'; current.attemptCount += 1; await current.save({ session }); currentBatch.skippedRows += 1; await currentBatch.save({ session }); return; }
      const leadId = createLeadId();
      const assignedUser = assignedTo ? await User.findOne({ _id: assignedTo, role: 'salesperson', active: true }).session(session).select('name') : null;
      if (assignedTo && !assignedUser) throw Object.assign(new Error('Selected salesperson is no longer active'), { code: 'INVALID_ASSIGNEE' });
      const lead = new Lead({ leadId, name: candidate.name, phone: candidate.phone, normalizedPhone: candidate.normalizedPhone, phoneSuffix: candidate.phoneSuffix, email: candidate.email, source: candidate.source, priority: candidate.priority, status: assignedUser ? 'ASSIGNED' : 'NEW', assignedTo: assignedUser?._id || null, assignedBy: assignedUser ? idOf(actor) : null, createdBy: idOf(actor), customFields: candidate.customFields || {}, isArchived: false });
      await lead.save({ session });
      const timestamp = new Date();
      const events = [{ leadId: lead._id, actorId: idOf(actor), eventType: 'LEAD_CREATED', previousValue: null, newValue: { leadId: lead.leadId, status: lead.status, importBatchId: batch._id, rowNumber: current.rowNumber }, description: `Lead ${lead.leadId} created from import ${batch.fileName}`, timestamp }];
      if (assignedUser) events.push({ leadId: lead._id, actorId: idOf(actor), eventType: 'LEAD_ASSIGNED', previousValue: null, newValue: { assignedTo: assignedUser._id, importBatchId: batch._id }, description: `Assigned during import to ${assignedUser.name}`, timestamp });
      await LeadEvent.create(events, { session });
      current.commitStatus = 'imported'; current.leadRef = lead._id; current.attemptCount += 1; current.lastError = null; await current.save({ session });
      currentBatch.importedRows += 1; await currentBatch.save({ session });
    });
  } catch (error) {
    const message = error.code === 'DUPLICATE_REVIEW_REQUIRED' ? error.message : error.code === 'INVALID_ASSIGNEE' ? error.message : 'Lead could not be imported';
    await ImportRow.updateOne({ _id: row._id, commitStatus: { $in: ['pending', 'failed'] } }, { $set: { commitStatus: 'failed', lastError: message }, $inc: { attemptCount: 1 } });
    await ImportBatch.updateOne({ _id: batch._id, status: 'COMMITTING' }, { $inc: { failedRows: 1 } });
  }
}

export async function commitImport(actor, batchId, duplicateRows = []) {
  assertAdmin(actor);
  const batch = await getImport(batchId);
  if (!['PREVIEW', 'COMPLETED_WITH_ERRORS', 'COMMITTING', 'COMPLETED'].includes(batch.status)) bad(409, 'IMPORT_NOT_READY', 'This import is not ready to commit');
  if (batch.status === 'COMPLETED') return batch;
  if (batch.status === 'COMMITTING') return { ...publicBatch(batch), processing: true };
  const selected = [...new Set(duplicateRows.map(Number))].sort((a, b) => a - b);
  if (batch.confirmedDuplicateRows?.length && JSON.stringify(selected) !== JSON.stringify([...batch.confirmedDuplicateRows].sort((a, b) => a - b))) bad(409, 'CONFIRMATIONS_LOCKED', 'Duplicate row confirmations cannot change after commit begins');
  const duplicateRowsInBatch = await ImportRow.find({ batchId, rowStatus: 'duplicate' }).select('rowNumber').lean();
  const allowed = new Set(duplicateRowsInBatch.map((row) => row.rowNumber));
  if (selected.some((row) => !allowed.has(row))) bad(400, 'INVALID_DUPLICATE_CONFIRMATION', 'Confirmation includes a row that is not marked duplicate');
  const strategy = validateAssignment({ type: batch.assignmentStrategy.type, userIds: batch.assignmentStrategy.userIds.map(String) });
  await ensureAssignees(strategy);
  const claimed = await ImportBatch.findOneAndUpdate({ _id: batchId, status: { $in: ['PREVIEW', 'COMPLETED_WITH_ERRORS'] } }, { $set: { status: 'COMMITTING', confirmedDuplicateRows: selected, lastError: null } }, { new: true });
  if (!claimed) { const latest = await getImport(batchId); return { ...publicBatch(latest), processing: latest.status === 'COMMITTING' }; }
  if (activeCommits.has(String(batchId))) return { ...publicBatch(claimed), processing: true };
  activeCommits.add(String(batchId));
  void processBatch(claimed, actor).finally(() => activeCommits.delete(String(batchId)));
  return { ...publicBatch(claimed), processing: true };
}

async function processBatch(batch, actor) {
  try {
    // These normalization steps are safe to repeat after a process restart.
    await ImportRow.updateMany({ batchId: batch._id, rowStatus: 'invalid', commitStatus: 'pending' }, { $set: { commitStatus: 'rejected' } });
    await ImportRow.updateMany({ batchId: batch._id, rowStatus: 'duplicate', commitStatus: 'pending', rowNumber: { $nin: batch.confirmedDuplicateRows || [] } }, { $set: { commitStatus: 'skipped' } });
    const allRows = await ImportRow.find({ batchId: batch._id, rowStatus: { $in: ['valid', 'duplicate'] } }).sort({ rowNumber: 1 }).select('_id rowNumber rowStatus commitStatus').lean();
    const indexByRow = new Map(allRows.map((row, index) => [row.rowNumber, index]));
    const rows = allRows.filter((row) => ['pending', 'failed'].includes(row.commitStatus));
    for (const row of rows) await importOne(batch, row, actor, indexByRow.get(row.rowNumber));
    const counts = await ImportRow.aggregate([{ $match: { batchId: batch._id } }, { $group: { _id: '$commitStatus', count: { $sum: 1 } } }]);
    const totals = Object.fromEntries(counts.map(({ _id, count }) => [_id, count]));
    const status = (totals.failed || 0) ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
    const retention = new Date(Date.now() + 30 * 86400_000);
    await ImportRow.updateMany({ batchId: batch._id, expiresAt: null }, { $set: { expiresAt: retention } });
    await ImportBatch.updateOne({ _id: batch._id, status: 'COMMITTING' }, { $set: { importedRows: totals.imported || 0, failedRows: totals.failed || 0, skippedRows: (totals.skipped || 0) + (totals.rejected || 0), status, completedAt: new Date(), rowRetentionUntil: retention } });
  } catch {
    await ImportBatch.updateOne({ _id: batch._id, status: 'COMMITTING' }, { $set: { status: 'COMPLETED_WITH_ERRORS', lastError: 'Import processing was interrupted and can be retried', completedAt: new Date() } });
  }
}

export async function resumeInterruptedImports() {
  const batches = await ImportBatch.find({ status: 'COMMITTING' }).populate('createdBy', 'name role active').lean();
  for (const batch of batches) {
    if (!batch.createdBy) continue;
    const actor = { ...batch.createdBy, _id: batch.createdBy._id };
    if (!activeCommits.has(String(batch._id))) {
      activeCommits.add(String(batch._id));
      void processBatch(batch, actor).finally(() => activeCommits.delete(String(batch._id)));
    }
  }
}

export async function rejectedRowsCsv(batchId) {
  await getImport(batchId);
  const rows = await ImportRow.find({ batchId, commitStatus: { $in: ['rejected', 'failed', 'skipped'] } }).sort({ rowNumber: 1 }).lean();
  const quote = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const output = [['Row', 'Result', 'Reason', 'Source data'].map(quote).join(',')];
  for (const row of rows) output.push([row.rowNumber, row.commitStatus, row.lastError || row.issues.map((issue) => issue.message).join('; ') || 'Duplicate not confirmed', JSON.stringify(row.rawData)].map(quote).join(','));
  return `\uFEFF${output.join('\r\n')}`;
}

export { IMPORT_LIMITS, normalizeMapping, validateCandidate, validateAssignment, markDuplicates };
