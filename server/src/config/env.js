import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve the server environment file independently of the process working directory.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const required = [
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'CLIENT_ORIGIN',
];

export function loadConfig(env = process.env) {
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`);
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (env[key].length < 32 || /replace-with|example|changeme/i.test(env[key])) {
      throw new Error(`${key} must be a unique random secret of at least 32 characters`);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT access and refresh secrets must be different');
  }

  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');

  return {
    nodeEnv: env.NODE_ENV || 'development',
    port,
    clientOrigin: env.CLIENT_ORIGIN,
    mongoUri: env.MONGODB_URI,
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN || '7d',
    refreshCookieName: 'edufinix_refresh',
    cookieSecure: (env.NODE_ENV || 'development') === 'production',
  };
}

export const config = loadConfig();
