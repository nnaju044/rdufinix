import crypto from 'node:crypto';

export function createLeadId(now = new Date()) {
  const date = `${String(now.getUTCFullYear()).slice(-2)}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `EFX-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
