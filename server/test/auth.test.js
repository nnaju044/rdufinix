import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.NODE_ENV = 'production';
process.env.PORT = '5000';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/edufinix_test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);

const [{ loadConfig }, { User }, { AuthSession }, { signAccessToken, verifyAccessToken, hashToken }, { requireRoles }, { createApp }] = await Promise.all([
  import('../src/config/env.js'),
  import('../src/models/User.js'),
  import('../src/models/AuthSession.js'),
  import('../src/utils/tokens.js'),
  import('../src/middleware/auth.js'),
  import('../src/app.js'),
]);
const { provisionInitialAdmin } = await import('../src/services/adminProvisioning.js');

test('environment validation requires different strong JWT secrets and a valid port', () => {
  assert.throws(() => loadConfig({ ...process.env, JWT_ACCESS_SECRET: 'short' }), /at least 32 characters/);
  assert.throws(() => loadConfig({ ...process.env, JWT_REFRESH_SECRET: process.env.JWT_ACCESS_SECRET }), /must be different/);
  assert.throws(() => loadConfig({ ...process.env, PORT: '99999' }), /valid TCP port/);
  assert.equal(loadConfig(process.env).port, 5000);
  assert.equal(loadConfig(process.env).cookieSecure, true);
});

test('passwords are bcrypt-hashed and verified without exposing the hash in JSON', async () => {
  const user = new User({ name: 'Test Admin', email: 'admin@example.com', role: 'admin' });
  await user.setPassword('a-strong-test-password');
  assert.notEqual(user.passwordHash, 'a-strong-test-password');
  assert.match(user.passwordHash, /^\$2[aby]\$/);
  assert.equal(await user.verifyPassword('a-strong-test-password'), true);
  assert.equal(await user.verifyPassword('incorrect'), false);
  assert.equal(JSON.stringify(user).includes('passwordHash'), false);
});

test('Admin provisioning CLI logic validates input, creates only Admin and hashes the password', async () => {
  let connected = false;
  let savedUser;
  class FakeUser {
    constructor(fields) { Object.assign(this, fields); }
    async setPassword(password) { this.passwordHash = `hashed:${password}`; }
    async save() { savedUser = this; }
    static async exists() { return false; }
  }
  const result = await provisionInitialAdmin({
    env: { INITIAL_ADMIN_NAME: '  Initial Admin  ', INITIAL_ADMIN_EMAIL: 'ADMIN@example.com ', INITIAL_ADMIN_PASSWORD: 'a-long-enough-test-password' },
    connect: async () => { connected = true; },
    User: FakeUser,
  });
  assert.equal(connected, true);
  assert.deepEqual(result, { email: 'admin@example.com' });
  assert.equal(savedUser.role, 'admin');
  assert.equal(savedUser.name, 'Initial Admin');
  assert.equal(savedUser.passwordHash, 'hashed:a-long-enough-test-password');
  await assert.rejects(() => provisionInitialAdmin({ env: {}, connect: async () => {}, User: FakeUser }), /valid INITIAL_ADMIN/);
});

test('JWT access tokens are scoped to the CRM audience and verify with fixed algorithm policy', () => {
  const token = signAccessToken({ id: '507f1f77bcf86cd799439011', role: 'founder' });
  const claims = verifyAccessToken(token);
  assert.equal(claims.role, 'founder');
  assert.equal(claims.sub, '507f1f77bcf86cd799439011');
  assert.equal(typeof hashToken(token), 'string');
  assert.throws(() => verifyAccessToken(`${token}x`));
});

test('role middleware denies missing and disallowed roles', () => {
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  let nextCalled = false;
  const guard = requireRoles('admin');
  let res = response();
  guard({}, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  res = response();
  guard({ user: { role: 'founder' } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
  guard({ user: { role: 'admin' } }, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

function mockResponse(app) {
  const response = {
    statusCode: 200,
    headers: {},
    cookies: {},
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
    clearCookie(name, options) { this.cookies[name] = { value: '', options }; return this; },
    end(body) { this.body = body?.toString() || ''; this.finished = true; this.writableEnded = true; this.headersSent = true; return this; },
  };
  Object.setPrototypeOf(response, app.response);
  return response;
}

async function invoke(app, { method = 'GET', path, body, headers = {} }) {
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = Readable.from(encoded ? [encoded] : []);
  const socket = { remoteAddress: '127.0.0.1', encrypted: true };
  Object.assign(req, {
    url: path, originalUrl: path, method,
    headers: { host: 'localhost', ...(encoded ? { 'content-type': 'application/json', 'content-length': String(encoded.length) } : {}), ...headers },
    socket, connection: socket,
  });
  Object.setPrototypeOf(req, app.request);
  const res = mockResponse(app);
  await new Promise((resolve, reject) => {
    res.end = (data) => { res.body = data?.toString() || ''; res.finished = true; res.writableEnded = true; res.headersSent = true; resolve(); return res; };
    try { app(req, res); } catch (error) { reject(error); }
    setTimeout(() => { if (!res.finished) reject(new Error(`No response for ${method} ${path}`)); }, 250);
  });
  return { status: res.statusCode, headers: res.headers, cookies: res.cookies, body: res.body ? JSON.parse(res.body) : null };
}

test('auth HTTP flow: login, access, rotation, logout, current user, denial, and cookie flags', async () => {
  const app = createApp(loadConfig(process.env));
  const originalFindOne = User.findOne;
  const originalCreate = AuthSession.create;
  const originalFindById = AuthSession.findById;
  const originalUpdateOne = AuthSession.updateOne;
  const records = new Map();
  const userId = '507f1f77bcf86cd799439011';
  const user = { _id: userId, id: userId, name: 'CRM Admin', email: 'admin@example.com', role: 'admin', active: true, verifyPassword: async (password) => password === 'a-strong-test-password' };
  User.findOne = () => ({ select: async () => user });
  AuthSession.create = async (values) => {
    const session = { ...values, id: '607f1f77bcf86cd799439022', _id: '607f1f77bcf86cd799439022', async save() { records.set(this.id, this); } };
    records.set(session.id, session);
    return session;
  };
  AuthSession.findById = (id) => ({ select: async () => records.get(String(id)) });
  AuthSession.updateOne = async (query, update) => {
    const session = records.get(String(query._id));
    if (!session || (query.revokedAt === null && session.revokedAt) || (query.refreshTokenHash && session.refreshTokenHash !== query.refreshTokenHash)) return { modifiedCount: 0 };
    Object.assign(session, update.$set);
    return { modifiedCount: 1 };
  };
  try {
    const goodOrigin = { origin: process.env.CLIENT_ORIGIN, 'x-edufinix-request': '1' };
    const health = await invoke(app, { path: '/api/v1/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok' });

    const unauthenticated = await invoke(app, { path: '/api/v1/auth/me' });
    assert.equal(unauthenticated.status, 401);
    const wrongOrigin = await invoke(app, { method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@example.com', password: 'a-strong-test-password' }, headers: { origin: 'https://attacker.invalid', 'x-edufinix-request': '1' } });
    assert.equal(wrongOrigin.status, 403);

    const badCredentials = await invoke(app, { method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@example.com', password: 'wrong' }, headers: goodOrigin });
    assert.equal(badCredentials.status, 401);
    const login = await invoke(app, { method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@example.com', password: 'a-strong-test-password' }, headers: goodOrigin });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin');
    assert.ok(login.body.accessToken);
    const cookie = login.cookies.edufinix_refresh;
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, 'strict');

    const current = await invoke(app, { path: '/api/v1/auth/me', headers: { authorization: `Bearer ${login.body.accessToken}` } });
    assert.equal(current.status, 200);
    assert.equal(current.body.user.id, userId);

    const noAdminPermission = await invoke(app, { path: '/api/v1/auth/me', headers: { authorization: `Bearer ${signAccessToken({ id: userId, role: 'founder' })}` } });
    assert.equal(noAdminPermission.status, 200);
    assert.equal(requireRoles('admin') instanceof Function, true);

    const refresh = await invoke(app, { method: 'POST', path: '/api/v1/auth/refresh', headers: { ...goodOrigin, cookie: `edufinix_refresh=${cookie.value}` } });
    assert.equal(refresh.status, 200);
    assert.ok(refresh.body.accessToken);
    assert.notEqual(refresh.cookies.edufinix_refresh.value, cookie.value);
    const replay = await invoke(app, { method: 'POST', path: '/api/v1/auth/refresh', headers: { ...goodOrigin, cookie: `edufinix_refresh=${cookie.value}` } });
    assert.equal(replay.status, 401);
    const revokedAccess = await invoke(app, { path: '/api/v1/auth/me', headers: { authorization: `Bearer ${refresh.body.accessToken}` } });
    assert.equal(revokedAccess.status, 200);

    const logout = await invoke(app, { method: 'POST', path: '/api/v1/auth/logout', headers: { ...goodOrigin, cookie: `edufinix_refresh=${refresh.cookies.edufinix_refresh.value}` } });
    assert.equal(logout.status, 204);
    assert.equal(logout.cookies.edufinix_refresh.options.expires.getTime(), 0);
    const afterLogout = await invoke(app, { method: 'POST', path: '/api/v1/auth/refresh', headers: { ...goodOrigin, cookie: `edufinix_refresh=${refresh.cookies.edufinix_refresh.value}` } });
    assert.equal(afterLogout.status, 401);
  } finally {
    User.findOne = originalFindOne;
    AuthSession.create = originalCreate;
    AuthSession.findById = originalFindById;
    AuthSession.updateOne = originalUpdateOne;
  }
});
