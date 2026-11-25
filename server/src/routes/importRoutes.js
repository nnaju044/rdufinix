import { Router } from 'express';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { commitImportController, getImportController, inspectImportController, listImportsController, rejectedRowsController, stageImportController } from '../controllers/importController.js';

const router = Router();
const uploadRateLimit = createRateLimit({ windowMs: 60_000, max: 10, message: 'Too many import uploads. Try again shortly.' });
router.use(requireAuth, requireRoles('admin'));
router.get('/imports/leads', listImportsController);
router.post('/imports/leads/inspect', uploadRateLimit, inspectImportController);
router.post('/imports/leads', uploadRateLimit, stageImportController);
router.get('/imports/leads/:batchId/rejected.csv', rejectedRowsController);
router.get('/imports/leads/:batchId', getImportController);
router.post('/imports/leads/:batchId/commit', commitImportController);
export default router;
