import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.accessSecret, {
    subject: user.id,
    issuer: 'edufinix-crm',
    audience: 'edufinix-crm-client',
    expiresIn: config.accessExpiresIn,
    algorithm: 'HS256',
  });
}

export function signRefreshToken(userId, sessionId) {
  return jwt.sign({ sid: sessionId, typ: 'refresh', jti: crypto.randomUUID() }, config.refreshSecret, {
    subject: userId,
    issuer: 'edufinix-crm',
    audience: 'edufinix-crm-refresh',
    expiresIn: config.refreshExpiresIn,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.accessSecret, {
    issuer: 'edufinix-crm', audience: 'edufinix-crm-client', algorithms: ['HS256'],
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.refreshSecret, {
    issuer: 'edufinix-crm', audience: 'edufinix-crm-refresh', algorithms: ['HS256'],
  });
}
