import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import {
  addLeadNoteController, assignLeadController, changeLeadStatusController,
  completeFollowUpController, createLeadController, createLeadFollowUpController,
  getLeadController, listLeadEventsController, listLeadFollowUpsController,
  listLeadNotesController, listLeadsController, updateLeadController,
} from '../controllers/leadController.js';

const router = Router();
router.use(requireAuth);
router.get('/leads', listLeadsController);
router.post('/leads', requireRoles('admin'), createLeadController);
router.get('/leads/:id', getLeadController);
router.patch('/leads/:id', requireRoles('admin'), updateLeadController);
router.patch('/leads/:id/assign', requireRoles('admin'), assignLeadController);
router.patch('/leads/:id/status', requireRoles('admin', 'salesperson'), changeLeadStatusController);
router.get('/leads/:id/events', listLeadEventsController);
router.get('/leads/:id/notes', listLeadNotesController);
router.post('/leads/:id/notes', requireRoles('admin', 'salesperson'), addLeadNoteController);
router.get('/leads/:id/follow-ups', listLeadFollowUpsController);
router.post('/leads/:id/follow-ups', requireRoles('admin', 'salesperson'), createLeadFollowUpController);
router.patch('/follow-ups/:id/complete', requireRoles('admin', 'salesperson'), completeFollowUpController);
export default router;
