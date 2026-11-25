import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { listAssigneesController } from '../controllers/userController.js';

const router = Router();
router.get('/users/assignees', requireAuth, requireRoles('founder', 'admin'), listAssigneesController);
export default router;
