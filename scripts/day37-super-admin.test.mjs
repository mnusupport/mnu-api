import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('platform role is persisted separately from restaurant membership', () => {
  const user = read('src/users/schemas/user.schema.ts');
  const role = read('src/common/enums/platform-role.enum.ts');
  const member = read('src/restaurant-members/schemas/restaurant-member.schema.ts');
  assert.match(role, /SUPER_ADMIN/);
  assert.match(user, /platformRole/);
  assert.match(user, /partialFilterExpression/);
  assert.match(member, /RestaurantRole/);
});

// Superseded architecture decision: there is ONE login (/login -> POST /auth/login) for
// every account; the backend decides the role. See scripts/day41-single-login.test.mjs.
test('there is no separate Super Admin login or registration (single /login architecture)', () => {
  const auth = read('src/auth/auth.controller.ts');
  assert.doesNotMatch(auth, /super-admin\/login/);
  assert.doesNotMatch(auth, /super-admin\/register/);
});

test('Super Admin routes require JWT and platform authorization', () => {
  const controller = read('src/platform-admin/platform-admin.controller.ts');
  const guard = read('src/common/super-admin.guard.ts');
  assert.match(controller, /JwtAuthGuard/);
  assert.match(controller, /SuperAdminGuard/);
  assert.match(guard, /requireSuperAdmin/);
});

test('restaurant-scoped services delegate authorization to shared platform-aware access control', () => {
  for (const file of [
    'src/menu/menu.service.ts',
    'src/tables/tables.service.ts',
    'src/orders/orders.service.ts',
    'src/restaurants/restaurants.service.ts',
  ]) {
    assert.match(read(file), /AuthorizationService/);
    assert.match(read(file), /requireRestaurantAccess/);
  }
});

test('Super Admin can list real restaurants with bounded pagination', () => {
  const service = read('src/platform-admin/platform-admin.service.ts');
  assert.match(service, /countDocuments/);
  assert.match(service, /skip\(pagination\.skip\)/);
  assert.match(service, /limit\(pagination\.limit\)/);
  assert.match(service, /requireSuperAdmin/);
});

test('bootstrap uses environment credentials and never creates a public registration flow', () => {
  const script = read('src/database/bootstrap-super-admin.ts');
  assert.match(script, /SUPER_ADMIN_EMAIL/);
  assert.match(script, /SUPER_ADMIN_PASSWORD/);
  assert.match(script, /bcrypt\.hash/);
  assert.match(script, /platformRole: PlatformRole\.SUPER_ADMIN/);
  assert.match(read('package.json'), /db:bootstrap-super-admin/);
});

test('legacy membership SUPER_ADMIN is not used as the new platform authorization source', () => {
  for (const file of [
    'src/menu/menu.service.ts',
    'src/tables/tables.service.ts',
    'src/restaurants/restaurants.service.ts',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /MANAGE_ROLES[^\n]*SUPER_ADMIN/);
  }
});

test('development CORS does not turn rejected origins into HTTP 500 exceptions', () => {
  const main = read('src/main.ts');
  assert.match(main, /callback\(null, false\)/);
  assert.doesNotMatch(main, /callback\(new Error\('Origin not allowed by CORS\.'\)/);
  assert.match(main, /hostname === 'localhost' \|\| url\.hostname === '127\.0\.0\.1'/);
});

test('database seed assigns the new platform role to seeded users', () => {
  const seed = read('src/database/seed.ts');
  assert.match(seed, /PlatformRole/);
  assert.match(seed, /platformRole:\s*PlatformRole\.USER/);
});
