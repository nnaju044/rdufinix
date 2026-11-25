import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
  try {
    const claims = verifyAccessToken(token);
    const user = await User.findOne({ _id: claims.sub, active: true }).select('name email role active');
    if (!user) return res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'Session is no longer valid' } });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Access token is invalid or expired' } });
  }
}

export const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } });
  next();
};

export const requireManagement = requireRoles('admin');
export const requireReadAll = requireRoles('founder', 'admin');
