import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import { ImportBatch } from '../src/models/ImportBatch.js';
import { ImportRow } from '../src/models/ImportRow.js';
import { Lead } from '../src/models/Lead.js';
import { LeadEvent } from '../src/models/LeadEvent.js';
import { User } from '../src/models/User.js';
import { inspectUpload, IMPORT_LIMITS } from '../src/services/spreadsheetParser.js';
import { importOne, markDuplicates, normalizeMapping, stageImport, targetFor, validateAssignment, validateCandidate } from '../src/services/importService.js';

function file(name, buffer, mimetype) { return { originalname: name, buffer, size: buffer.length, mimetype }; }

test('parses valid CSV and preserves row numbering and UTF-8 values', async () => {
  const data = Buffer.from('Name,Phone,Email,Source\nAsha,+91 98765 43210,asha@example.com,Website\n');
  const result = await inspectUpload(file('leads.csv', data, 'text/csv'));
  assert.deepEqual(result.sheets[0].headers, ['Name', 'Phone', 'Email', 'Source']);
  assert.equal(result.sheets[0].rows[0].rowNumber, 2);
  assert.equal(result.sheets[0].rows[0].values[1], '+91 98765 43210');
});

test('rejects unsupported types, malformed CSV, invalid UTF-8, and oversized uploads', async () => {
  await assert.rejects(inspectUpload(file('leads.xls', Buffer.from('x'), 'application/vnd.ms-excel')), /Only \.xlsx and \.csv/);
  await assert.rejects(inspectUpload(file('leads.csv', Buffer.from('Name,Phone\n"broken,+12345678\n'), 'text/csv')), /Could not parse/);
  await assert.rejects(inspectUpload(file('leads.csv', Buffer.from([0xff, 0xfe]), 'text/csv')), /valid UTF-8/);
  const oversized = Buffer.alloc(IMPORT_LIMITS.fileBytes + 1, 0x61);
  await assert.rejects(inspectUpload(file('large.csv', oversized, 'text/csv')), (error) => error.status === 413);
});

test('enforces the maximum CSV row count before staging', async () => {
  const lines = ['Name,Phone,Source', ...Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, index) => `Name ${index},+141555${String(index).padStart(4, '0')},Web`)];
  await assert.rejects(inspectUpload(file('many.csv', Buffer.from(lines.join('\n')), 'text/csv')), /at most 5000 data rows/);
});

test('parses XLSX without evaluating formulas and flags formula cells for review', async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Leads');
  sheet.addRow(['Name', 'Phone', 'Source']); sheet.addRow(['Taylor', '+14155550198', 'Web']); sheet.getCell('A2').value = { formula: '1+1', result: 2 };
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await inspectUpload(file('leads.xlsx', buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  assert.equal(result.sheets[0].rows[0].values[0], '[FORMULA NOT ALLOWED]');
  assert.ok(validateCandidate({ name: result.sheets[0].rows[0].values[0], phone: '+14155550198', source: 'Web', priority: '', customFields: {} }, 2).issues.some((issue) => issue.code === 'FORMULA_LIKE_VALUE'));
  await assert.rejects(inspectUpload(file('bad.xlsx', Buffer.from('not a zip'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')), /valid ZIP/);
});

test('validates required/optional mappings, custom field keys and assignment strategies', () => {
  const mapping = normalizeMapping(['Full name', 'Mobile', 'Campaign', 'Extra'], { name: 'Full name', phone: 'Mobile', source: 'Campaign', additionalFields: [{ key: 'program', header: 'Extra' }] });
  assert.equal(mapping.program, 'Extra');
  assert.throws(() => normalizeMapping(['Name', 'Phone'], { name: 'Name', phone: 'Phone', source: 'Missing' }), /Map source to a column/);
  assert.throws(() => normalizeMapping(['Name', 'Phone', 'Source'], { name: 'Name', phone: 'Phone', source: 'Source', additionalFields: [{ key: '$bad', header: 'Name' }] }), /safe keys/);
  assert.throws(() => normalizeMapping(['Name', 'Phone', 'Source'], { name: 'Name', phone: 'Phone', source: 'Source', additionalFields: [{ key: 'name', header: 'Source' }] }), /safe keys/);
  assert.deepEqual(validateAssignment({ type: 'unassigned', userIds: [] }), { type: 'unassigned', userIds: [] });
  assert.throws(() => validateAssignment({ type: 'single', userIds: [] }), /salesperson selections/);
});

test('distributes assignment predictably by the stable row index', () => {
  const strategy = { type: 'equal', userIds: ['sales-a', 'sales-b', 'sales-c'] };
  const firstPass = [0, 1, 2, 3, 4, 5].map((index) => targetFor(strategy, index));
  const retrySubset = [3, 4, 5].map((index) => targetFor(strategy, index));
  assert.deepEqual(firstPass, ['sales-a', 'sales-b', 'sales-c', 'sales-a', 'sales-b', 'sales-c']);
  assert.deepEqual(retrySubset, firstPass.slice(3));
});

test('separates exact and possible duplicate rows within an upload without merging', () => {
  const candidates = [
    { rowNumber: 2, candidate: { normalizedPhone: '+14155550198', phone: '+14155550198', name: 'A' } },
    { rowNumber: 3, candidate: { normalizedPhone: '+14155550198', phone: '+14155550198', name: 'B' } },
    { rowNumber: 4, candidate: { normalizedPhone: '+4414155550198', phone: '+4414155550198', name: 'C' } },
  ];
  const result = markDuplicates(candidates, new Map());
  assert.equal(result[0].rowStatus, 'valid');
  assert.equal(result[1].duplicateType, 'exact');
  assert.equal(result[1].duplicateMatches[0].rowNumber, 2);
  assert.equal(result[2].duplicateType, 'possible');
});

test('accepts international plus-prefixed phones but rejects formula-like mapped values', () => {
  const valid = validateCandidate({ name: 'Taylor', phone: '+14155550198', email: '', source: 'Website', priority: '', customFields: {} }, 2);
  assert.equal(valid.issues.length, 0);
  const invalid = validateCandidate({ name: '=2+2', phone: '+14155550198', email: '', source: 'Website', priority: '', customFields: {} }, 3);
  assert.ok(invalid.issues.some((issue) => issue.code === 'FORMULA_LIKE_VALUE'));
});

test('stages row validation and duplicate outcomes, and denies non-admin staging', async () => {
  const originals = { batchCreate: ImportBatch.create, rowInsertMany: ImportRow.insertMany, rowFind: ImportRow.find, rowCount: ImportRow.countDocuments, userFind: User.find, leadFind: Lead.find };
  const batchId = new mongoose.Types.ObjectId(); const rowDocs = [];
  const query = (get) => ({ select() { return this; }, sort() { return this; }, skip() { return this; }, limit(n) { this.n = n; return this; }, lean() { return Promise.resolve(get().slice(0, this.n || Infinity)); } });
  try {
    ImportBatch.create = async (data) => ({ ...data, _id: batchId, toObject() { return { ...this }; }, async save() {} });
    ImportRow.insertMany = async (docs) => { rowDocs.push(...docs.map((doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }))); return docs; };
    ImportRow.find = (filter) => query(() => rowDocs.filter((row) => String(row.batchId) === String(filter.batchId)));
    ImportRow.countDocuments = async (filter) => rowDocs.filter((row) => String(row.batchId) === String(filter.batchId)).length;
    User.find = () => ({ select() { return this; }, lean: async () => [] });
    Lead.find = (filter) => query(() => {
      if (filter.normalizedPhone?.$in) return [{ leadId: 'EFX-2026-EXISTING', name: 'Existing Student', phone: '+14155550198', normalizedPhone: '+14155550198', phoneSuffix: '5550198' }].filter((lead) => filter.normalizedPhone.$in.includes(lead.normalizedPhone));
      return [];
    });
    const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
    const data = Buffer.from('Name,Phone,Source\nAsha,+14155550198,Website\nInvalid,,Website\nOther,+442071838750,Referral\n');
    const result = await stageImport(admin, file('leads.csv', data, 'text/csv'), { mapping: { name: 'Name', phone: 'Phone', source: 'Source' }, assignmentStrategy: { type: 'unassigned', userIds: [] } });
    assert.equal(result.batch.status, 'PREVIEW');
    assert.equal(result.batch.totalRows, 3);
    assert.equal(result.batch.validRows, 2);
    assert.equal(result.batch.invalidRows, 1);
    assert.equal(result.batch.duplicateRows, 1);
    assert.equal(result.rows.items.find((row) => row.rowNumber === 2).duplicateMatches[0].leadId, 'EFX-2026-EXISTING');
    await assert.rejects(() => stageImport({ role: 'founder' }, file('leads.csv', data, 'text/csv'), { mapping: { name: 'Name', phone: 'Phone', source: 'Source' } }), (error) => error.status === 403);
  } finally {
    ImportBatch.create = originals.batchCreate; ImportRow.insertMany = originals.rowInsertMany; ImportRow.find = originals.rowFind; ImportRow.countDocuments = originals.rowCount; User.find = originals.userFind; Lead.find = originals.leadFind;
  }
});

test('rolls back partial row writes and safely retries without creating the row twice', async () => {
  const originals = {
    startSession: mongoose.startSession, rowFindOne: ImportRow.findOne, rowUpdateOne: ImportRow.updateOne,
    batchFindOne: ImportBatch.findOne, batchUpdateOne: ImportBatch.updateOne,
    leadFind: Lead.find, leadSave: Lead.prototype.save, eventCreate: LeadEvent.create,
  };
  const leads = []; const events = []; let failOnce = true;
  const actor = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  const batch = { _id: new mongoose.Types.ObjectId(), status: 'COMMITTING', fileName: 'partial.csv', assignmentStrategy: { type: 'unassigned', userIds: [] }, confirmedDuplicateRows: [], importedRows: 0, failedRows: 0, skippedRows: 0, async save() {} };
  const row = { _id: new mongoose.Types.ObjectId(), batchId: batch._id, rowNumber: 2, rowStatus: 'valid', commitStatus: 'pending', attemptCount: 0, candidate: { name: 'Taylor', phone: '+14155550198', normalizedPhone: '+14155550198', phoneSuffix: '5550198', source: 'Web', priority: 'MEDIUM', customFields: {} }, async save() {} };
  const query = (get) => ({ session() { return this; }, select() { return this; }, limit() { return this; }, lean() { return Promise.resolve(get()); }, then(resolve, reject) { return Promise.resolve(get()).then(resolve, reject); } });
  try {
    mongoose.startSession = async () => ({
      async withTransaction(work) {
        const oldLeads = [...leads]; const oldEvents = [...events]; const oldRow = { ...row }; const oldImported = batch.importedRows;
        try { await work({}); } catch (error) { leads.splice(0, leads.length, ...oldLeads); events.splice(0, events.length, ...oldEvents); Object.assign(row, oldRow); batch.importedRows = oldImported; throw error; }
      }, async endSession() {},
    });
    ImportRow.findOne = () => query(() => ['pending', 'failed'].includes(row.commitStatus) ? row : null);
    ImportRow.updateOne = async (_filter, update) => { Object.assign(row, update.$set); row.attemptCount += update.$inc?.attemptCount || 0; return { modifiedCount: 1 }; };
    ImportBatch.findOne = () => query(() => batch.status === 'COMMITTING' ? batch : null);
    ImportBatch.updateOne = async (_filter, update) => { batch.failedRows += update.$inc?.failedRows || 0; return { modifiedCount: 1 }; };
    Lead.find = () => query(() => []);
    Lead.prototype.save = async function save() { leads.push(this); return this; };
    LeadEvent.create = async (items) => {
      if (failOnce) { failOnce = false; throw new Error('Simulated event-store outage'); }
      events.push(...items); return items;
    };
    await importOne(batch, row, actor, 0);
    assert.equal(leads.length, 0);
    assert.equal(events.length, 0);
    assert.equal(row.commitStatus, 'failed');
    await importOne(batch, row, actor, 0);
    assert.equal(leads.length, 1);
    assert.equal(events.length, 1);
    assert.equal(row.commitStatus, 'imported');
    await importOne(batch, row, actor, 0);
    assert.equal(leads.length, 1);
    assert.equal(events.length, 1);
  } finally {
    mongoose.startSession = originals.startSession; ImportRow.findOne = originals.rowFindOne; ImportRow.updateOne = originals.rowUpdateOne;
    ImportBatch.findOne = originals.batchFindOne; ImportBatch.updateOne = originals.batchUpdateOne;
    Lead.find = originals.leadFind; Lead.prototype.save = originals.leadSave; LeadEvent.create = originals.eventCreate;
  }
});

test('import history endpoints reject anonymous users and deny Founder access', async () => {
  process.env.NODE_ENV = 'test'; process.env.PORT = '5000'; process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/edufinix_test'; process.env.JWT_ACCESS_SECRET = 'c'.repeat(48); process.env.JWT_REFRESH_SECRET = 'd'.repeat(48);
  const [{ createApp }, { config }, { signAccessToken }] = await Promise.all([import('../src/app.js'), import('../src/config/env.js'), import('../src/utils/tokens.js')]);
  const originalFindOne = User.findOne;
  const founderId = new mongoose.Types.ObjectId();
  User.findOne = () => ({ select() { return this; }, then(resolve) { return Promise.resolve({ _id: founderId, id: String(founderId), name: 'Founder', email: 'founder@example.test', role: 'founder', active: true }).then(resolve); } });
  const app = createApp(config);
  async function request(token) {
    const req = Readable.from([]); const socket = { remoteAddress: '127.0.0.1' };
    Object.assign(req, { url: '/api/v1/imports/leads', originalUrl: '/api/v1/imports/leads', method: 'GET', headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, socket, connection: socket });
    Object.setPrototypeOf(req, app.request);
    const res = { statusCode: 200, headers: {}, writableEnded: false, headersSent: false, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, getHeader(name) { return this.headers[name.toLowerCase()]; }, removeHeader(name) { delete this.headers[name.toLowerCase()]; } };
    Object.setPrototypeOf(res, app.response);
    const body = await new Promise((resolve, reject) => {
      res.end = (value) => { res.writableEnded = true; res.headersSent = true; res.finished = true; resolve(value?.toString() || ''); return res; };
      try { app(req, res); } catch (error) { reject(error); }
      setTimeout(() => { if (!res.finished) reject(new Error('Import permission request timed out')); }, 100);
    });
    return { status: res.statusCode, body: body ? JSON.parse(body) : null };
  }
  try {
    assert.equal((await request()).status, 401);
    const response = await request(signAccessToken({ id: String(founderId), role: 'founder' }));
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'FORBIDDEN');
  } finally { User.findOne = originalFindOne; }
});
