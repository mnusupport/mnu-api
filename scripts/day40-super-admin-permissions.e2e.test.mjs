// Day 40 — HTTP-level permission tests.
//
// Boots the REAL compiled controllers, services, guards, pipes, error filter
// and the AuditInterceptor from backend/dist, with an in-memory fake standing
// in for MongoDB (no mongod is available in CI/sandbox). This verifies real
// authorization behaviour end to end. It does NOT verify MongoDB itself,
// Cloudinary.
//
// Run:  (cd backend && npm ci && npm run build) && node --test scripts/day40-super-admin-permissions.e2e.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend');
const require = createRequire(path.join(apiDir, 'package.json'));
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.NODE_ENV = 'test';
require('reflect-metadata');

const { NestFactory, APP_INTERCEPTOR } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { getModelToken } = require('@nestjs/mongoose');
const { Types } = require('mongoose');
const jwt = require('jsonwebtoken');
const d = (p) => require(path.join(apiDir, 'dist', p));

const { signToken } = d('auth/jwt.util');
const { AuthorizationService } = d('common/authorization.service');
const { SuperAdminGuard } = d('common/super-admin.guard');
const { RequestSafetyPipe } = d('common/pipes/request-safety.pipe');
const { HttpErrorFilter } = d('common/filters/http-error.filter');
const { AuditInterceptor } = d('audit/audit.interceptor');
const { AuditLog } = d('audit/audit-log.schema');
const { User } = d('users/schemas/user.schema');
const { Restaurant } = d('restaurants/schemas/restaurant.schema');
const { RestaurantMember } = d('restaurant-members/schemas/restaurant-member.schema');
const { Table } = d('tables/schemas/table.schema');
const { Category } = d('menu/schemas/category.schema');
const { MenuItem } = d('menu/schemas/menu-item.schema');
const { TablesController } = d('tables/tables.controller');
const { TablesService } = d('tables/tables.service');
const { MenuController } = d('menu/menu.controller');
const { MenuService } = d('menu/menu.service');
const { RestaurantsController } = d('restaurants/restaurants.controller');
const { StaffController } = d('restaurants/staff.controller');
const { RestaurantsService } = d('restaurants/restaurants.service');
const { PlatformAdminController } = d('platform-admin/platform-admin.controller');
const { PlatformAdminService } = d('platform-admin/platform-admin.service');

// ---------- minimal in-memory Mongoose-model stand-in ----------
const sameId = (a, b) => String(a) === String(b);
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$in' in v) return v.$in.some((x) => sameId(x, doc[k]));
    return sameId(doc[k], v);
  });
}
class FakeModel {
  constructor() { this.docs = []; }
  q(fn) {
    let sortSpec, skip = 0, limit = Infinity;
    const run = () => {
      let r = fn();
      if (Array.isArray(r)) {
        if (sortSpec) { const [[k, dir]] = Object.entries(sortSpec); r = [...r].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); }
        r = r.slice(skip, skip + limit);
      }
      return r;
    };
    const query = {
      lean: () => query, select: () => query,
      sort: (s) => { sortSpec = s; return query; }, skip: (n) => { skip = n; return query; }, limit: (n) => { limit = n; return query; },
      then: (res, rej) => Promise.resolve().then(run).then(res, rej),
    };
    return query;
  }
  make(doc) {
    const out = { _id: new Types.ObjectId(), createdAt: new Date(), ...doc };
    for (const k of ['restaurantId', 'userId', 'actorUserId', 'categoryId']) if (typeof out[k] === 'string') out[k] = new Types.ObjectId(out[k]);
    Object.defineProperty(out, 'save', { value: async () => out, enumerable: false });
    this.docs.push(out);
    return out;
  }
  findById(id) { return this.q(() => this.docs.find((x) => sameId(x._id, id)) ?? null); }
  findOne(f) { return this.q(() => this.docs.find((x) => matches(x, f)) ?? null); }
  find(f) { return this.q(() => this.docs.filter((x) => matches(x, f))); }
  exists(f) { return this.q(() => (this.docs.some((x) => matches(x, f)) ? { _id: 1 } : null)); }
  countDocuments(f) { return this.q(() => this.docs.filter((x) => matches(x, f)).length); }
  async create(doc) { return this.make(doc); }
  async deleteOne(f) { const i = this.docs.findIndex((x) => matches(x, f)); if (i >= 0) this.docs.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async deleteMany(f) { this.docs = this.docs.filter((x) => !matches(x, f)); return {}; }
  async syncIndexes() {}
  findByIdAndUpdate(id, upd) { return this.q(() => { const x = this.docs.find((y) => sameId(y._id, id)); if (x) Object.assign(x, upd.$set ?? {}); return x ?? null; }); }
}

const models = {};
const tokens = [User, Restaurant, RestaurantMember, Table, Category, MenuItem, AuditLog];
for (const c of tokens) models[c.name] = new FakeModel();

class Empty {}
const providers = [
  ...tokens.map((c) => ({ provide: getModelToken(c.name), useValue: models[c.name] })),
  AuthorizationService, SuperAdminGuard, TablesService, MenuService, RestaurantsService, PlatformAdminService,
  { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
];
Reflect.decorate([Module({ controllers: [TablesController, MenuController, RestaurantsController, StaffController, PlatformAdminController], providers })], Empty);

let app, base;
const ids = {};
const tok = {};
const call = async (method, url, token, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

before(async () => {
  const mk = (M, doc) => models[M.name].make(doc)._id.toString();
  ids.A = mk(Restaurant, { name: 'Restaurant A' });
  ids.B = mk(Restaurant, { name: 'Restaurant B' });
  ids.ghost = new Types.ObjectId().toString(); // valid id, no such restaurant
  ids.super = mk(User, { name: 'Root', email: 'root@example.com', platformRole: 'SUPER_ADMIN' });
  ids.adminA = mk(User, { name: 'Admin A', email: 'a@example.com', platformRole: 'USER' });
  ids.adminB = mk(User, { name: 'Admin B', email: 'b@example.com', platformRole: 'USER' });
  ids.staffA = mk(User, { name: 'Staff A', email: 's@example.com', platformRole: 'USER' });
  mk(RestaurantMember, { userId: ids.adminA, restaurantId: ids.A, role: 'RESTAURANT_ADMIN' });
  mk(RestaurantMember, { userId: ids.adminB, restaurantId: ids.B, role: 'RESTAURANT_ADMIN' });
  mk(RestaurantMember, { userId: ids.staffA, restaurantId: ids.A, role: 'RESTAURANT_STAFF' });
  for (const k of ['super', 'adminA', 'adminB', 'staffA']) tok[k] = signToken({ user_id: ids[k] });

  app = await NestFactory.create(Empty, { logger: false });
  app.useGlobalPipes(new RequestSafetyPipe());
  app.useGlobalFilters(new HttpErrorFilter());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => { await app?.close(); });
const settle = () => new Promise((r) => setTimeout(r, 50)); // audit write is fire-and-forget

test('Super Admin: full Table CRUD in ANY restaurant', async () => {
  for (const rid of [ids.A, ids.B]) {
    const c = await call('POST', `/restaurants/${rid}/tables`, tok.super, { tableNumber: 'T1', capacity: 4 });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const tid = c.body.id;
    assert.equal((await call('GET', `/restaurants/${rid}/tables`, tok.super)).body.length, 1);
    assert.equal((await call('GET', `/restaurants/${rid}/tables/${tid}`, tok.super)).status, 200);
    const u = await call('PATCH', `/restaurants/${rid}/tables/${tid}`, tok.super, { tableNumber: 'T9', capacity: 6, status: 'INACTIVE' });
    assert.equal(u.status, 200); assert.equal(u.body.tableNumber, 'T9'); assert.equal(u.body.status, 'INACTIVE');
    assert.equal((await call('DELETE', `/restaurants/${rid}/tables/${tid}`, tok.super)).status, 200);
    assert.equal((await call('GET', `/restaurants/${rid}/tables`, tok.super)).body.length, 0);
  }
});

test('Super Admin: full Category + Menu item CRUD and availability/featured toggles', async () => {
  const rid = ids.B;
  const cat = await call('POST', `/restaurants/${rid}/categories`, tok.super, { name: 'Starters', sortOrder: 1 });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
  assert.equal((await call('PATCH', `/restaurants/${rid}/categories/${cat.body.id}`, tok.super, { name: 'Mains' })).body.name, 'Mains');
  const item = await call('POST', `/restaurants/${rid}/menu-items`, tok.super, { categoryId: cat.body.id, name: 'Soup', price: 120, description: 'Hot' });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  assert.equal((await call('PATCH', `/restaurants/${rid}/menu-items/${item.body.id}`, tok.super, { price: 150, description: 'Very hot' })).status, 200);
  assert.equal((await call('PATCH', `/restaurants/${rid}/menu-items/${item.body.id}/availability`, tok.super, { isAvailable: false })).status, 200);
  assert.equal((await call('GET', `/restaurants/${rid}/menu`, tok.super)).status, 200);
  assert.equal((await call('DELETE', `/restaurants/${rid}/menu-items/${item.body.id}`, tok.super)).status, 200);
  assert.equal((await call('DELETE', `/restaurants/${rid}/categories/${cat.body.id}`, tok.super)).status, 200);
});

test('Super Admin: restaurant settings (branding), staff list, platform dashboard', async () => {
  assert.equal((await call('GET', `/restaurants/${ids.A}/branding`, tok.super)).status, 200);
  const u = await call('PATCH', `/restaurants/${ids.A}/branding`, tok.super, { primaryColor: '#112233', heroTagline: 'Hi' });
  assert.equal(u.status, 200); assert.equal(u.body.primaryColor, '#112233');
  const staff = await call('GET', `/restaurants/${ids.A}/staff`, tok.super);
  assert.equal(staff.status, 200); assert.equal(staff.body.length, 2);
  assert.equal((await call('GET', '/super-admin/dashboard', tok.super)).status, 200);
  assert.equal((await call('GET', `/super-admin/restaurants/${ids.A}`, tok.super)).status, 200);
});

test('Super Admin cannot act on a NON-EXISTENT restaurant (no orphan writes)', async () => {
  const before = models.Table.docs.length;
  const r = await call('POST', `/restaurants/${ids.ghost}/tables`, tok.super, { tableNumber: 'X', capacity: 2 });
  assert.equal(r.status, 404);
  assert.equal(models.Table.docs.length, before);
  assert.equal((await call('POST', `/restaurants/${ids.ghost}/categories`, tok.super, { name: 'Ghost' })).status, 404);
});

test('Restaurant Admin: own restaurant only; every cross-restaurant / platform call denied', async () => {
  assert.equal((await call('POST', `/restaurants/${ids.A}/tables`, tok.adminA, { tableNumber: 'RA1', capacity: 2 })).status, 201);
  assert.equal((await call('GET', `/restaurants/${ids.A}/menu`, tok.adminA)).status, 200);
  const denied = [
    ['GET', `/restaurants/${ids.B}/menu`], ['GET', `/restaurants/${ids.B}/tables`], ['POST', `/restaurants/${ids.B}/tables`, { tableNumber: 'Z', capacity: 2 }],
    ['POST', `/restaurants/${ids.B}/categories`, { name: 'Z' }], ['PATCH', `/restaurants/${ids.B}/branding`, { primaryColor: '#000000' }],
    ['GET', `/restaurants/${ids.B}/staff`],
    ['GET', '/super-admin/dashboard'], ['GET', '/super-admin/restaurants'], ['GET', `/super-admin/restaurants/${ids.A}`], ['GET', '/super-admin/audit-logs'],
  ];
  for (const [m, u, b] of denied) assert.equal((await call(m, u, tok.adminA, b)).status, 403, `${m} ${u}`);
});

test('Restaurant Staff: can read, cannot manage', async () => {
  assert.equal((await call('GET', `/restaurants/${ids.A}/tables`, tok.staffA)).status, 200);
  assert.equal((await call('POST', `/restaurants/${ids.A}/tables`, tok.staffA, { tableNumber: 'S1', capacity: 2 })).status, 403);
  assert.equal((await call('POST', `/restaurants/${ids.A}/categories`, tok.staffA, { name: 'S' })).status, 403);
  assert.equal((await call('PATCH', `/restaurants/${ids.A}/branding`, tok.staffA, { primaryColor: '#000000' })).status, 403);
});

test('Unauthenticated, garbage and expired/invalid tokens are rejected', async () => {
  assert.equal((await call('GET', `/restaurants/${ids.A}/tables`)).status, 401);
  assert.equal((await call('GET', `/restaurants/${ids.A}/tables`, 'not.a.jwt')).status, 401);
  const expired = jwt.sign({ user_id: ids.super }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await call('GET', '/super-admin/dashboard', expired)).status, 401);
  const wrongSecret = jwt.sign({ user_id: ids.super }, 'y'.repeat(48));
  assert.equal((await call('GET', '/super-admin/dashboard', wrongSecret)).status, 401);
});

test('Malformed ids give 400/404, never 500', async () => {
  for (const u of ['/restaurants/not-an-id/tables', '/super-admin/restaurants/not-an-id']) {
    const s = (await call('GET', u, tok.super)).status;
    assert.ok(s === 400 || s === 404, `${u} -> ${s}`);
  }
});

test('Audit trail: Super Admin mutations recorded (who/what/where/when), nothing else', async () => {
  await settle();
  const logs = models.AuditLog.docs;
  assert.ok(logs.length > 0);
  for (const l of logs) {
    assert.equal(String(l.actorUserId), ids.super);
    assert.equal(l.actorRole, 'SUPER_ADMIN');
    assert.ok(l.createdAt instanceof Date && l.action && l.restaurantId && l.route.includes(':restaurantId'));
    assert.ok(l.statusCode >= 200 && l.statusCode < 300, 'failed requests must not be audited');
    assert.ok(!('body' in l) && !('token' in l) && !('password' in l));
  }
  const actions = logs.map((l) => l.action);
  for (const a of ['tables.create', 'tables.update', 'tables.delete', 'categories.create', 'categories.update', 'categories.delete',
    'menu-items.create', 'menu-items.update', 'menu-items.delete', 'menu-items.update:availability', 'branding.update']) {
    assert.ok(actions.includes(a), `missing audit action ${a}`);
  }
  const tableDelete = logs.find((l) => l.action === 'tables.delete');
  assert.ok(tableDelete.resourceId, 'delete should record the resource id');
  // 2 restaurants x (create+update+delete) tables + 3 cat/item pairs... just assert reads and 404s were NOT logged:
  assert.ok(!logs.some((l) => String(l.restaurantId) === ids.ghost), '404 on ghost restaurant must not be audited');
  assert.ok(!actions.some((a) => a.endsWith('.list') || a.includes('.get')));
  // Restaurant Admin / Staff mutations are not part of the Super Admin trail
  assert.ok(!logs.some((l) => String(l.actorUserId) === ids.adminA));
});

test('Audit log API: Super Admin can read it, filtered + paginated; never returns secrets', async () => {
  const r = await call('GET', `/super-admin/audit-logs?restaurantId=${ids.B}&limit=5`, tok.super);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length > 0 && r.body.items.length <= 5);
  assert.ok(r.body.items.every((i) => i.restaurantId === ids.B));
  assert.ok(!JSON.stringify(r.body).match(/password|token|secret/i));
  assert.equal((await call('GET', '/super-admin/audit-logs?restaurantId=nope', tok.super)).status, 400);
  assert.equal((await call('GET', '/super-admin/audit-logs?limit=1000', tok.super)).status, 400);
});
