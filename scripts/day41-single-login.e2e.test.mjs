// Single-login architecture tests.
//
// Boots the REAL compiled AuthController/AuthService (real bcrypt, real JWT),
// JwtAuthGuard, SuperAdminGuard, AuthorizationService, platform + restaurant
// controllers, request-safety pipe and error filter from backend/dist over
// real HTTP. Only the Mongoose models are in-memory fakes (no mongod here), so
// this proves authentication/authorization BEHAVIOUR, not MongoDB itself.
//
// Run:  (cd backend && npm run build) && node --test scripts/day41-single-login.e2e.test.mjs
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend');
const require = createRequire(path.join(apiDir, 'package.json'));
process.env.JWT_SECRET = 'y'.repeat(48);
process.env.NODE_ENV = 'test';
require('reflect-metadata');

const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { getModelToken } = require('@nestjs/mongoose');
const { Types } = require('mongoose');
const bcrypt = require('bcryptjs');
const d = (p) => require(path.join(apiDir, 'dist', p));

const { AuthController } = d('auth/auth.controller');
const { AuthService } = d('auth/auth.service');
const { AuthorizationService } = d('common/authorization.service');
const { SuperAdminGuard } = d('common/super-admin.guard');
const { RateLimitGuard } = d('common/guards/rate-limit.guard');
const { RequestSafetyPipe } = d('common/pipes/request-safety.pipe');
const { HttpErrorFilter } = d('common/filters/http-error.filter');
const { User } = d('users/schemas/user.schema');
const { Restaurant } = d('restaurants/schemas/restaurant.schema');
const { RestaurantMember } = d('restaurant-members/schemas/restaurant-member.schema');
const { Table } = d('tables/schemas/table.schema');
const { AuditLog } = d('audit/audit-log.schema');
const { PlatformAdminController } = d('platform-admin/platform-admin.controller');
const { PlatformAdminService } = d('platform-admin/platform-admin.service');
const { TablesController } = d('tables/tables.controller');
const { TablesService } = d('tables/tables.service');

const same = (a, b) => String(a) === String(b);
const matches = (doc, f = {}) =>
  Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$in' in v ? v.$in.some((x) => same(x, doc[k])) : same(doc[k], v)));

class FakeModel {
  constructor() { this.docs = []; }
  q(fn, ctx = {}) {
    let skip = 0, limit = Infinity, populate = null;
    const run = () => {
      let r = fn();
      if (Array.isArray(r)) {
        r = r.slice(skip, skip + limit);
        if (populate && ctx.populate) r = r.map((m) => ctx.populate(m));
      }
      return r;
    };
    const query = {
      lean: () => query, select: () => query, sort: () => query,
      skip: (n) => { skip = n; return query; }, limit: (n) => { limit = n; return query; },
      populate: (p) => { populate = p; return query; },
      then: (res, rej) => Promise.resolve().then(run).then(res, rej),
    };
    return query;
  }
  make(doc) {
    const out = { _id: new Types.ObjectId(), createdAt: new Date(), ...doc };
    for (const k of ['restaurantId', 'userId']) if (typeof out[k] === 'string') out[k] = new Types.ObjectId(out[k]);
    this.docs.push(out);
    return out;
  }
  findById(id) { return this.q(() => this.docs.find((x) => same(x._id, id)) ?? null); }
  findOne(f) { return this.q(() => this.docs.find((x) => matches(x, f)) ?? null); }
  find(f) { return this.q(() => this.docs.filter((x) => matches(x, f)), this.popCtx); }
  exists(f) { return this.q(() => (this.docs.some((x) => matches(x, f)) ? { _id: 1 } : null)); }
  countDocuments(f) { return this.q(() => this.docs.filter((x) => matches(x, f)).length); }
  async create(doc) { return this.make(doc); }
  async syncIndexes() {}
}

const models = { User: new FakeModel(), Restaurant: new FakeModel(), RestaurantMember: new FakeModel(), Table: new FakeModel(), AuditLog: new FakeModel() };
// membership.populate('restaurantId') -> { _id, name } like Mongoose does
models.RestaurantMember.popCtx = {
  populate: (m) => {
    const r = models.Restaurant.docs.find((x) => same(x._id, m.restaurantId));
    return { ...m, restaurantId: { _id: r._id, name: r.name } };
  },
};

class Empty {}
Reflect.decorate([Module({
  controllers: [AuthController, PlatformAdminController, TablesController],
  providers: [
    ...Object.entries({ [User.name]: 'User', [Restaurant.name]: 'Restaurant', [RestaurantMember.name]: 'RestaurantMember', [Table.name]: 'Table', [AuditLog.name]: 'AuditLog' })
      .map(([name, key]) => ({ provide: getModelToken(name), useValue: models[key] })),
    AuthService, AuthorizationService, SuperAdminGuard, RateLimitGuard, PlatformAdminService, TablesService,
  ],
})], Empty);

const PASSWORD = 'a-sufficiently-long-passphrase';
let app, base;
const ids = {};

const post = async (url, body, token) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (url, token) => {
  const res = await fetch(base + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

before(async () => {
  const hash = bcrypt.hashSync(PASSWORD, 4);
  ids.A = models.Restaurant.make({ name: 'Restaurant A' })._id.toString();
  ids.B = models.Restaurant.make({ name: 'Restaurant B' })._id.toString();
  ids.C = models.Restaurant.make({ name: 'Restaurant C' })._id.toString();
  ids.super = models.User.make({ name: 'Root', email: 'root@example.com', passwordHash: hash, platformRole: 'SUPER_ADMIN' })._id.toString();
  ids.adminA = models.User.make({ name: 'Admin A', email: 'a@example.com', passwordHash: hash, platformRole: 'USER' })._id.toString();
  ids.adminB = models.User.make({ name: 'Admin B', email: 'b@example.com', passwordHash: hash, platformRole: 'USER' })._id.toString();
  // Legacy account created before platformRole existed: must behave as a normal USER.
  models.User.make({ name: 'Legacy', email: 'legacy@example.com', passwordHash: hash });
  models.RestaurantMember.make({ userId: ids.adminA, restaurantId: ids.A, role: 'RESTAURANT_ADMIN' });
  models.RestaurantMember.make({ userId: ids.adminB, restaurantId: ids.B, role: 'RESTAURANT_ADMIN' });

  app = await NestFactory.create(Empty, { logger: false });
  app.useGlobalPipes(new RequestSafetyPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => { await app?.close(); });
// The limiter is process-local and keyed by IP, so every test here (same IP) would
// otherwise share one bucket. Reset it between tests; the dedicated test at the end
// proves the limit itself still applies to /auth/login.
beforeEach(() => { app.get(RateLimitGuard).buckets.clear(); });

// ---------------------------------------------------------------- authentication
test('Super Admin signs in through the SAME /auth/login used by everyone', async () => {
  const r = await post('/auth/login', { email: 'root@example.com', password: PASSWORD });
  assert.equal(r.status, 201);
  assert.equal(r.body.platformRole, 'SUPER_ADMIN');
  assert.equal(r.body.user.platformRole, 'SUPER_ADMIN');
  assert.ok(r.body.token);
  ids.superToken = r.body.token;
});

test('Restaurant Admin signs in through /auth/login and is a normal USER with only their restaurant', async () => {
  const r = await post('/auth/login', { email: 'a@example.com', password: PASSWORD });
  assert.equal(r.status, 201);
  assert.equal(r.body.platformRole, 'USER');
  assert.deepEqual(r.body.memberships.map((m) => [m.restaurant_id, m.role]), [[ids.A, 'RESTAURANT_ADMIN']]);
  ids.adminAToken = r.body.token;
});

test('email is case/whitespace-insensitive and a legacy account without platformRole logs in as USER', async () => {
  const r1 = await post('/auth/login', { email: '  ROOT@Example.com ', password: PASSWORD });
  assert.equal(r1.status, 201);
  const r2 = await post('/auth/login', { email: 'legacy@example.com', password: PASSWORD });
  assert.equal(r2.status, 201);
  assert.notEqual(r2.body.platformRole, 'SUPER_ADMIN');
});

test('invalid credentials are rejected identically (no user enumeration), for both account types', async () => {
  const cases = [
    { email: 'root@example.com', password: 'wrong-password-123' },
    { email: 'a@example.com', password: 'wrong-password-123' },
    { email: 'nobody@example.com', password: PASSWORD },
    { email: 'root@example.com' },
    { password: PASSWORD },
    { email: 12345, password: PASSWORD },
    {},
  ];
  const messages = new Set();
  for (const c of cases) {
    const r = await post('/auth/login', c);
    assert.equal(r.status, 401, JSON.stringify(c));
    messages.add(r.body.message);
  }
  assert.equal(messages.size, 1, `differing messages leak account info: ${[...messages]}`);
});

test('no role selector: client-supplied role/portal fields are ignored, the backend decides', async () => {
  for (const extra of [{ platformRole: 'SUPER_ADMIN' }, { role: 'SUPER_ADMIN' }, { portal: 'super-admin' }, { as: 'SUPER_ADMIN' }]) {
    const r = await post('/auth/login', { email: 'a@example.com', password: PASSWORD, ...extra });
    // Either ignored (201, still USER) or rejected by the safety pipe; never elevated.
    if (r.status === 201) assert.equal(r.body.platformRole, 'USER', JSON.stringify(extra));
    else assert.ok(r.status >= 400 && r.status < 500);
  }
  // and the opposite: the Super Admin cannot be "downgraded" by a client field either
  const s = await post('/auth/login', { email: 'root@example.com', password: PASSWORD, platformRole: 'USER' });
  if (s.status === 201) assert.equal(s.body.platformRole, 'SUPER_ADMIN');
});

test('login responses never include password hashes', async () => {
  const r = await post('/auth/login', { email: 'root@example.com', password: PASSWORD });
  assert.equal(/passwordHash|\$2[aby]\$/.test(JSON.stringify(r.body)), false);
});

test('/auth/me reports the role from the backend (used to restore state after a refresh)', async () => {
  const sa = await get('/auth/me', ids.superToken);
  assert.equal(sa.body.platformRole, 'SUPER_ADMIN');
  const ra = await get('/auth/me', ids.adminAToken);
  assert.equal(ra.body.platformRole, 'USER');
  assert.equal((await get('/auth/me')).status, 401);
  assert.equal((await get('/auth/me', 'garbage.token.value')).status, 401);
});

// ---------------------------------------------------------------- obsolete architecture is really gone
test('the separate Super Admin login/registration endpoints no longer exist (404)', async () => {
  for (const url of ['/auth/super-admin/login', '/super-admin/login', '/auth/super-admin/register', '/super-admin/register']) {
    const r = await post(url, { email: 'root@example.com', password: PASSWORD });
    assert.equal(r.status, 404, url);
  }
});

test('public registration cannot mint a Super Admin (platformRole in the body is ignored)', async () => {
  const r = await post('/auth/register', {
    restaurant_name: 'Sneaky', name: 'Eve', email: 'eve@example.com', password: PASSWORD, password_confirmation: PASSWORD, platformRole: 'SUPER_ADMIN',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.platformRole, 'USER');
  const stored = models.User.docs.find((u) => u.email === 'eve@example.com');
  assert.equal(stored.platformRole, 'USER');
  assert.equal(models.User.docs.filter((u) => u.platformRole === 'SUPER_ADMIN').length, 1);
});

// ---------------------------------------------------------------- authorization after login
test('Super Admin token: platform routes and EVERY restaurant are accessible; unknown restaurant is 404', async () => {
  for (const url of ['/super-admin/dashboard', '/super-admin/restaurants', `/super-admin/restaurants/${ids.A}`]) {
    assert.equal((await get(url, ids.superToken)).status, 200, url);
  }
  for (const rid of [ids.A, ids.B, ids.C]) assert.equal((await get(`/restaurants/${rid}/tables`, ids.superToken)).status, 200, rid);
  assert.equal((await get(`/restaurants/${new Types.ObjectId()}/tables`, ids.superToken)).status, 404);
});

test('Restaurant Admin token: own restaurant only; other restaurants and ALL /super-admin/* are 403', async () => {
  assert.equal((await get(`/restaurants/${ids.A}/tables`, ids.adminAToken)).status, 200);
  for (const rid of [ids.B, ids.C]) assert.equal((await get(`/restaurants/${rid}/tables`, ids.adminAToken)).status, 403, rid);
  for (const url of ['/super-admin/dashboard', '/super-admin/restaurants', `/super-admin/restaurants/${ids.A}`]) {
    assert.equal((await get(url, ids.adminAToken)).status, 403, url);
  }
});

test('unauthenticated requests cannot reach platform or restaurant routes (401)', async () => {
  for (const url of ['/super-admin/dashboard', '/super-admin/restaurants', `/restaurants/${ids.A}/tables`]) {
    assert.equal((await get(url)).status, 401, url);
  }
});

test('Super Admin can perform a write on a selected restaurant, and it lands only there', async () => {
  const before = models.Table.docs.length;
  const r = await post(`/restaurants/${ids.B}/tables`, { tableNumber: '7' }, ids.superToken);
  assert.ok(r.status === 201, `status ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(models.Table.docs.length, before + 1);
  assert.ok(same(models.Table.docs.at(-1).restaurantId, ids.B));
  // and a Restaurant Admin still cannot write to it
  assert.equal((await post(`/restaurants/${ids.B}/tables`, { tableNumber: '8' }, ids.adminAToken)).status, 403);
});

test('the single /auth/login endpoint is rate limited (429 after 10 attempts/minute), incl. for the Super Admin account', async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post('/auth/login', { email: 'root@example.com', password: 'wrong-password-123' })).status);
  assert.equal(statuses.slice(0, 10).every((s) => s === 401), true, statuses.join(','));
  assert.equal(statuses[10], 429, statuses.join(','));
  assert.equal(statuses[11], 429);
});
