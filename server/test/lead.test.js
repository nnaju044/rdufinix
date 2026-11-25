import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import mongoose from 'mongoose';
import { Lead } from '../src/models/Lead.js';
import { LeadEvent } from '../src/models/LeadEvent.js';
import { LeadNote } from '../src/models/LeadNote.js';
import { FollowUp } from '../src/models/FollowUp.js';
import { User } from '../src/models/User.js';
import { normalizePhone } from '../src/utils/phone.js';
import { createLead, listLeads, getLead, assignLead, changeLeadStatus, listLeadEvents, addLeadNote, createLeadFollowUp, completeFollowUp } from '../src/services/leadService.js';
import { listLeadNotes } from '../src/services/leadNoteService.js';

const idA = new mongoose.Types.ObjectId();
const idB = new mongoose.Types.ObjectId();
const admin = { _id: new mongoose.Types.ObjectId(), id: null, role: 'admin', name: 'Admin' };
admin.id = String(admin._id);
const salespersonA = { _id: idA, id: String(idA), role: 'salesperson', name: 'Alex' };
const salespersonB = { _id: idB, id: String(idB), role: 'salesperson', name: 'Blair' };
const founder = { _id: new mongoose.Types.ObjectId(), role: 'founder', name: 'Founder' };
founder.id = String(founder._id);
const store = { leads: [], events: [], notes: [], followUps: [] };
const originals = {};
process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/edufinix_test';
process.env.JWT_ACCESS_SECRET = 'c'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'd'.repeat(48);
const [{ createApp }, { config }, { signAccessToken }] = await Promise.all([
  import('../src/app.js'), import('../src/config/env.js'), import('../src/utils/tokens.js'),
]);

function same(a, b) { return String(a) === String(b); }
function matchValue(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof RegExp) && !(expected instanceof mongoose.Types.ObjectId) && !(expected instanceof Date)) {
    if ('$ne' in expected && same(actual, expected.$ne)) return false;
    if ('$regex' in expected && !(new RegExp(expected.$regex).test(String(actual || '')))) return false;
    return true;
  }
  if (expected instanceof RegExp) return expected.test(String(actual || ''));
  return same(actual ?? null, expected ?? null);
}
function matches(item, filter = {}) {
  if (filter.$or && !filter.$or.some((entry) => matches(item, entry))) return false;
  return Object.entries(filter).filter(([key]) => key !== '$or').every(([key, expected]) => matchValue(item[key], expected));
}

class Query {
  constructor(get) { this.get = get; this.skipCount = 0; this.limitCount = Infinity; this.sortSpec = null; }
  session() { return this; }
  select() { return this; }
  populate() { return this; }
  lean() { return this; }
  sort(spec) { this.sortSpec = spec; return this; }
  skip(value) { this.skipCount = value; return this; }
  limit(value) { this.limitCount = value; return this; }
  async then(resolve, reject) { try { return resolve(this.value()); } catch (error) { return reject(error); } }
  value() {
    const value = this.get();
    if (!Array.isArray(value)) return value;
    let items = [...value];
    if (this.sortSpec) {
      const [[key, direction]] = Object.entries(this.sortSpec);
      items.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction);
    }
    return items.slice(this.skipCount, this.skipCount + this.limitCount);
  }
}

function setModelMock(model, name, fn) {
  originals[`${name}.${model.modelName}`] = model[name];
  model[name] = fn;
}

async function invokeApp(app, { method = 'GET', path, token, headers = {} }) {
  const req = Readable.from([]);
  const socket = { remoteAddress: '127.0.0.1' };
  Object.assign(req, { url: path, originalUrl: path, method, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, socket, connection: socket });
  Object.setPrototypeOf(req, app.request);
  const res = {
    statusCode: 200, headers: {}, writableEnded: false, headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    end(body) { this.body = body?.toString() || ''; this.writableEnded = true; this.headersSent = true; this.finished = true; return this; },
  };
  Object.setPrototypeOf(res, app.response);
  await new Promise((resolve, reject) => {
    res.end = (body) => { res.body = body?.toString() || ''; res.writableEnded = true; res.headersSent = true; res.finished = true; resolve(); return res; };
    try { app(req, res); } catch (error) { reject(error); }
    setTimeout(() => { if (!res.finished) reject(new Error(`No response for ${method} ${path}`)); }, 100);
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

beforeEach(() => {
  store.leads = []; store.events = []; store.notes = []; store.followUps = [];
  originals.startSession = mongoose.startSession;
  mongoose.startSession = async () => ({ withTransaction: async (callback) => callback(), endSession: async () => {} });
  originals['Lead.save'] = Lead.prototype.save;
  originals['Lead.populate'] = Lead.prototype.populate;
  Lead.prototype.populate = async function populateLead() { return this; };
  Lead.prototype.save = async function saveLead() {
    this.updatedAt = new Date(); this.createdAt ||= new Date();
    const index = store.leads.findIndex((item) => same(item._id, this._id));
    if (index < 0) store.leads.push(this); else store.leads[index] = this;
    return this;
  };
  originals['FollowUp.save'] = FollowUp.prototype.save;
  FollowUp.prototype.save = async function saveFollowUp() {
    this.updatedAt = new Date(); this.createdAt ||= new Date();
    const index = store.followUps.findIndex((item) => same(item._id, this._id));
    if (index < 0) store.followUps.push(this); else store.followUps[index] = this;
    return this;
  };
  setModelMock(Lead, 'find', (filter) => new Query(() => store.leads.filter((item) => matches(item, filter))));
  setModelMock(Lead, 'findOne', (filter) => new Query(() => store.leads.find((item) => matches(item, filter)) || null));
  setModelMock(Lead, 'countDocuments', async (filter) => store.leads.filter((item) => matches(item, filter)).length);
  setModelMock(LeadEvent, 'create', async (docs) => {
    const items = (Array.isArray(docs) ? docs : [docs]).map((doc) => ({ _id: new mongoose.Types.ObjectId(), timestamp: new Date(), ...doc }));
    store.events.push(...items); return items;
  });
  setModelMock(LeadEvent, 'find', (filter) => new Query(() => store.events.filter((item) => matches(item, filter))));
  setModelMock(LeadEvent, 'countDocuments', async (filter) => store.events.filter((item) => matches(item, filter)).length);
  setModelMock(LeadNote, 'create', async (docs) => {
    const items = (Array.isArray(docs) ? docs : [docs]).map((doc) => ({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc }));
    store.notes.push(...items); return items;
  });
  setModelMock(LeadNote, 'find', (filter) => new Query(() => store.notes.filter((item) => matches(item, filter))));
  setModelMock(LeadNote, 'countDocuments', async (filter) => store.notes.filter((item) => matches(item, filter)).length);
  setModelMock(FollowUp, 'create', async (docs) => {
    const items = (Array.isArray(docs) ? docs : [docs]).map((doc) => new FollowUp({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc }));
    store.followUps.push(...items); return items;
  });
  setModelMock(FollowUp, 'find', (filter) => new Query(() => store.followUps.filter((item) => matches(item, filter))));
  setModelMock(FollowUp, 'findOne', (filter) => new Query(() => store.followUps.find((item) => matches(item, filter)) || null));
  setModelMock(FollowUp, 'countDocuments', (filter) => new Query(() => store.followUps.filter((item) => matches(item, filter)).length));
  setModelMock(FollowUp, 'updateMany', async (filter, update) => {
    const items = store.followUps.filter((item) => matches(item, filter));
    for (const item of items) Object.assign(item, update.$set);
    return { modifiedCount: items.length };
  });
  setModelMock(User, 'findOne', (filter) => new Query(() => {
    const users = [salespersonA, salespersonB, admin, founder];
    return users.find((item) => matches({ ...item, active: true }, filter)) || null;
  }));
});

afterEach(() => {
  mongoose.startSession = originals.startSession;
  Lead.prototype.save = originals['Lead.save'];
  Lead.prototype.populate = originals['Lead.populate'];
  FollowUp.prototype.save = originals['FollowUp.save'];
  for (const [key, original] of Object.entries(originals)) {
    const [name, modelName] = key.split('.');
    const model = { Lead, LeadEvent, LeadNote, FollowUp, User }[modelName];
    if (model && name !== 'save' && name !== 'startSession') model[name] = original;
  }
});

const leadInput = (phone, extras = {}) => ({ name: 'Taylor Student', phone, source: 'Website', ...extras });

test('creates leads with readable IDs and an immutable creation event', async () => {
  const lead = await createLead(admin, leadInput('+1 (415) 555-0198'));
  assert.match(lead.leadId, /^EFX-\d{4}-[A-F\d]{8}$/);
  assert.equal(lead.normalizedPhone, '+14155550198');
  assert.equal(store.events[0].eventType, 'LEAD_CREATED');
  assert.equal(String(store.events[0].actorId), admin.id);
  assert.equal(store.events[0].newValue.status, 'NEW');
});

test('detects exact and possible duplicate phones without merging records', async () => {
  const first = await createLead(admin, leadInput('+1 415 555 0198'));
  await assert.rejects(() => createLead(admin, leadInput('+14155550198')), (error) => error.code === 'DUPLICATE_LEAD' && error.details.duplicates[0].duplicateType === 'exact');
  const explicitlyConfirmed = await createLead(admin, leadInput('+14155550198', { confirmDuplicate: true }));
  assert.notEqual(first.leadId, explicitlyConfirmed.leadId);
  await assert.rejects(() => createLead(admin, leadInput('+44 415 555 0198')), (error) => error.code === 'DUPLICATE_LEAD' && error.details.duplicates.some((item) => item.duplicateType === 'possible'));
  const possible = await createLead(admin, leadInput('+44 415 555 0198', { confirmDuplicate: true }));
  assert.equal(possible.status, 'NEW');
  assert.equal(store.leads.length, 3);
  assert.equal(store.events.length, 3);
});

test('enforces role permissions and salesperson lead scope', async () => {
  const lead = await createLead(admin, leadInput('+1 415 555 0198', { assignedTo: salespersonA.id }));
  await assert.rejects(() => createLead(founder, leadInput('+1 202 555 0134')), (error) => error.status === 403);
  assert.equal((await getLead(salespersonA, lead.leadId)).leadId, lead.leadId);
  await assert.rejects(() => getLead(salespersonB, lead.leadId), (error) => error.status === 404);
  await assert.rejects(() => changeLeadStatus(founder, lead.leadId, 'CONTACTED'), (error) => error.status === 403);
});

test('lead endpoints reject anonymous requests and deny Founder write access', async () => {
  const app = createApp(config);
  const preflight = await invokeApp(app, { method: 'OPTIONS', path: '/api/v1/leads/lead-1/status', headers: { origin: config.clientOrigin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type,x-edufinix-request' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH/);
  const anonymous = await invokeApp(app, { path: '/api/v1/leads' });
  assert.equal(anonymous.status, 401);
  const founderWrite = await invokeApp(app, { method: 'POST', path: '/api/v1/leads', token: signAccessToken(founder) });
  assert.equal(founderWrite.status, 403);
});

test('assigns and reassigns leads while preserving actor-stamped history and transferring pending follow-ups', async () => {
  const lead = await createLead(admin, leadInput('+1 415 555 0198', { assignedTo: salespersonA.id }));
  const followUp = await createLeadFollowUp(salespersonA, lead.leadId, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), notes: 'Call tomorrow' });
  const result = await assignLead(admin, lead.leadId, salespersonB.id);
  assert.equal(result.transferredFollowUps, 1);
  assert.equal(String(followUp.assignedTo), salespersonB.id);
  assert.ok(store.events.some((item) => item.eventType === 'LEAD_REASSIGNED' && String(item.actorId) === admin.id));
  assert.ok(store.events.some((item) => item.eventType === 'FOLLOWUP_TRANSFERRED'));
  assert.equal(store.events.filter((item) => item.eventType === 'LEAD_REASSIGNED').length, 1);
});

test('first assignment moves NEW to ASSIGNED and records both changes', async () => {
  const lead = await createLead(admin, leadInput('+1 415 555 0198'));
  const result = await assignLead(admin, lead.leadId, salespersonA.id);
  assert.equal(result.lead.status, 'ASSIGNED');
  assert.ok(store.events.some((item) => item.eventType === 'LEAD_ASSIGNED'));
  assert.ok(store.events.some((item) => item.eventType === 'STATUS_CHANGED' && item.previousValue === 'NEW' && item.newValue === 'ASSIGNED'));
});

test('validates status transitions and records every successful status update', async () => {
  const lead = await createLead(admin, leadInput('+1 415 555 0198', { assignedTo: salespersonA.id }));
  const changed = await changeLeadStatus(salespersonA, lead.leadId, 'CONTACTED');
  assert.equal(changed.lead.status, 'CONTACTED');
  assert.ok(changed.lead.lastContactedAt instanceof Date);
  assert.equal(store.events.at(-1).eventType, 'STATUS_CHANGED');
  await assert.rejects(() => changeLeadStatus(salespersonA, lead.leadId, 'NEW'), (error) => error.code === 'INVALID_STATUS_TRANSITION');
  const history = await listLeadEvents(salespersonA, lead.leadId, { page: 1, limit: 20 });
  assert.equal(history.pagination.total, 3);
});

test('stores internal notes separately and records note/follow-up completion events', async () => {
  const lead = await createLead(admin, leadInput('+1 415 555 0198', { assignedTo: salespersonA.id }));
  await addLeadNote(salespersonA, lead.leadId, 'Discussed course options');
  const founderNotes = await listLeadNotes(founder, lead.leadId, { page: 1, limit: 20 });
  assert.equal(founderNotes.items[0].body, 'Discussed course options');
  const followUp = await createLeadFollowUp(salespersonA, lead.leadId, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() });
  await completeFollowUp(salespersonA, String(followUp._id));
  assert.equal(store.notes.length, 1);
  assert.equal(store.notes[0].body, 'Discussed course options');
  assert.ok(store.events.some((item) => item.eventType === 'NOTE_ADDED'));
  assert.ok(store.events.some((item) => item.eventType === 'FOLLOWUP_CREATED'));
  assert.ok(store.events.some((item) => item.eventType === 'FOLLOWUP_COMPLETED'));
  assert.equal(followUp.status, 'completed');
  assert.equal(lead.status, 'CONTACTED');
});

test('paginates and filters lead lists and rejects unsafe page sizes', async () => {
  await createLead(admin, leadInput('+1 415 555 0198', { source: 'Referral' }));
  await createLead(admin, leadInput('+1 202 555 0134', { source: 'Website' }));
  await createLead(admin, leadInput('+1 303 555 0100', { source: 'Referral' }));
  const filtered = await listLeads(admin, { q: 'Taylor', source: 'Referral', page: '2', limit: '1' });
  assert.equal(filtered.pagination.total, 2);
  assert.equal(filtered.pagination.pages, 2);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0].source, 'Referral');
  await assert.rejects(() => listLeads(admin, { limit: '101' }), (error) => error.code === 'INVALID_PAGINATION');
  assert.equal(normalizePhone('4155550198'), null);
});
