import { Router } from 'express';
import { currentUserController, loginController, logoutController, refreshController } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const router = Router();
const authRateLimit = createRateLimit({ windowMs: 60_000, max: 10, message: 'Too many authentication attempts. Try again shortly.' });
router.post('/login', authRateLimit, loginController);
router.post('/refresh', authRateLimit, refreshController);
router.post('/logout', logoutController);
router.get('/me', requireAuth, currentUserController);
export default router;
