import { login, refreshCookieOptions, revokeRefreshToken, rotateRefreshToken } from '../services/authService.js';
import { config } from '../config/env.js';

function checkOrigin(req) {
  if (req.get('origin') !== config.clientOrigin || req.get('x-edufinix-request') !== '1') {
    const error = new Error('Request origin is not allowed'); error.status = 403; error.code = 'ORIGIN_FORBIDDEN'; throw error;
  }
}

export async function loginController(req, res, next) {
  try {
    checkOrigin(req);
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A valid email and password are required' } });
    }
    const result = await login({ email, password, ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie('edufinix_refresh', result.refreshToken, refreshCookieOptions(result.refreshExpiresAt));
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) { next(error); }
}

export async function refreshController(req, res, next) {
  try {
    checkOrigin(req);
    const token = req.cookies?.edufinix_refresh;
    if (!token) return res.status(401).json({ error: { code: 'REFRESH_REQUIRED', message: 'Refresh session required' } });
    const result = await rotateRefreshToken(token, req.ip, req.get('user-agent'));
    res.cookie('edufinix_refresh', result.refreshToken, refreshCookieOptions(result.refreshExpiresAt));
    res.json({ user: result.user, accessToken: result.accessToken });
  } catch (error) { next(error); }
}

export async function logoutController(req, res, next) {
  try {
    checkOrigin(req);
    await revokeRefreshToken(req.cookies?.edufinix_refresh);
    res.clearCookie('edufinix_refresh', refreshCookieOptions(new Date(0)));
    res.status(204).end();
  } catch (error) { next(error); }
}

export function currentUserController(req, res) {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role } });
}
