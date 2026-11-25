import { AuthSession } from '../models/AuthSession.js';
import { User } from '../models/User.js';
import { config } from '../config/env.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/tokens.js';

const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });

export async function login({ email, password, ip, userAgent }) {
  const user = await User.findOne({ email: email.trim().toLowerCase(), active: true }).select('+passwordHash');
  if (!user || !(await user.verifyPassword(password))) {
    const error = new Error('Email or password is incorrect'); error.status = 401; error.code = 'INVALID_CREDENTIALS'; throw error;
  }
  const session = await AuthSession.create({
    user: user._id,
    refreshTokenHash: 'pending',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdIp: ip,
    userAgent: userAgent?.slice(0, 500),
  });
  const refreshToken = signRefreshToken(user.id, session.id);
  const decoded = verifyRefreshToken(refreshToken);
  session.refreshTokenHash = hashToken(refreshToken);
  session.expiresAt = new Date(decoded.exp * 1000);
  await session.save();
  return { user: publicUser(user), accessToken: signAccessToken(user), refreshToken, refreshExpiresAt: session.expiresAt };
}

export async function rotateRefreshToken(token, ip, userAgent) {
  let claims;
  try { claims = verifyRefreshToken(token); }
  catch { const error = new Error('Refresh session is invalid or expired'); error.status = 401; error.code = 'REFRESH_INVALID'; throw error; }
  if (claims.typ !== 'refresh' || !claims.sid) {
    const error = new Error('Refresh session is invalid'); error.status = 401; error.code = 'REFRESH_INVALID'; throw error;
  }
  const session = await AuthSession.findById(claims.sid).select('+refreshTokenHash');
  if (!session) { const error = new Error('Refresh session is invalid'); error.status = 401; error.code = 'REFRESH_INVALID'; throw error; }
  if (session.revokedAt || session.refreshTokenHash !== hashToken(token)) {
    await AuthSession.updateOne({ _id: session.id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const error = new Error('Refresh session has been revoked'); error.status = 401; error.code = 'REFRESH_REVOKED'; throw error;
  }
  const user = await User.findOne({ _id: session.user, active: true }).select('name email role active');
  if (!user) {
    await AuthSession.updateOne({ _id: session.id }, { $set: { revokedAt: new Date() } });
    const error = new Error('User is inactive'); error.status = 401; error.code = 'SESSION_INVALID'; throw error;
  }
  const nextToken = signRefreshToken(user.id, session.id);
  const decoded = verifyRefreshToken(nextToken);
  const result = await AuthSession.updateOne(
    { _id: session.id, refreshTokenHash: hashToken(token), revokedAt: null },
    { $set: { refreshTokenHash: hashToken(nextToken), expiresAt: new Date(decoded.exp * 1000), createdIp: ip, userAgent: userAgent?.slice(0, 500) } },
  );
  if (result.modifiedCount !== 1) {
    const error = new Error('Refresh session was already rotated'); error.status = 401; error.code = 'REFRESH_REUSED'; throw error;
  }
  return { user: publicUser(user), accessToken: signAccessToken(user), refreshToken: nextToken, refreshExpiresAt: new Date(decoded.exp * 1000) };
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  try {
    const claims = verifyRefreshToken(token);
    await AuthSession.updateOne({ _id: claims.sid, refreshTokenHash: hashToken(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
  } catch { /* Logout remains idempotent for expired or invalid cookies. */ }
}

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/api/v1/auth',
    expires: expiresAt,
  };
}
