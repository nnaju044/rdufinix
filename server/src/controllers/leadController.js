import {
  addLeadNote, assignLead, changeLeadStatus, completeFollowUp, createLead,
  createLeadFollowUp, getLead, listLeadEvents, listLeadFollowUps, listLeads,
  updateLead,
} from '../services/leadService.js';
import { listLeadNotes } from '../services/leadNoteService.js';

const handler = (work) => async (req, res, next) => {
  try { await work(req, res); }
  catch (error) { next(error); }
};

export const listLeadsController = handler(async (req, res) => res.json(await listLeads(req.user, req.query)));
export const createLeadController = handler(async (req, res) => res.status(201).json({ lead: await createLead(req.user, req.body || {}) }));
export const getLeadController = handler(async (req, res) => res.json({ lead: await getLead(req.user, req.params.id) }));
export const updateLeadController = handler(async (req, res) => res.json({ lead: await updateLead(req.user, req.params.id, req.body || {}) }));
export const assignLeadController = handler(async (req, res) => res.json(await assignLead(req.user, req.params.id, req.body?.assignedTo)));
export const changeLeadStatusController = handler(async (req, res) => res.json(await changeLeadStatus(req.user, req.params.id, req.body?.status)));
export const listLeadEventsController = handler(async (req, res) => res.json(await listLeadEvents(req.user, req.params.id, req.query)));
export const listLeadNotesController = handler(async (req, res) => res.json(await listLeadNotes(req.user, req.params.id, req.query)));
export const addLeadNoteController = handler(async (req, res) => res.status(201).json({ note: await addLeadNote(req.user, req.params.id, req.body?.body) }));
export const listLeadFollowUpsController = handler(async (req, res) => res.json(await listLeadFollowUps(req.user, req.params.id, req.query)));
export const createLeadFollowUpController = handler(async (req, res) => res.status(201).json({ followUp: await createLeadFollowUp(req.user, req.params.id, req.body || {}) }));
export const completeFollowUpController = handler(async (req, res) => res.json({ followUp: await completeFollowUp(req.user, req.params.id) }));
