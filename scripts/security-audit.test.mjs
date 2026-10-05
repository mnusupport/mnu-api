import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const adminControllers = [
  'backend/src/menu/menu.controller.ts',
  'backend/src/orders/orders.controller.ts',
  'backend/src/restaurants/restaurants.controller.ts',
  'backend/src/tables/tables.controller.ts',
];

test('restaurant admin controllers are protected by JwtAuthGuard', () => {
  for (const file of adminControllers) {
    const source = read(file);
    assert.match(source, /@UseGuards\(JwtAuthGuard\)/, file);
  }
});

test('public order access is anonymous but remains restaurant-scoped', () => {
  const source = read('backend/src/orders/orders.service.ts');
  assert.match(source, /getPublicOrderForRestaurant/);
  assert.match(source, /findOne\(\{ _id: orderId, restaurantId \}/);
});

test('admin object lookups remain restaurant-scoped', () => {
  const menu = read('backend/src/menu/menu.service.ts');
  const tables = read('backend/src/tables/tables.service.ts');
  const orders = read('backend/src/orders/orders.service.ts');
  assert.match(menu, /_id: itemId,\s*restaurantId/);
  assert.match(menu, /_id: categoryId,\s*restaurantId/);
  assert.match(tables, /findOne\(\{ _id: tableId, restaurantId \}\)/);
  assert.match(orders, /findOne\(\{ _id: orderId, restaurantId \}\)/);
});

test('destructive public table-session end route is absent', () => {
  assert.doesNotMatch(read('backend/src/table-sessions/table-sessions.controller.ts'), /@Patch\(['"]end['"]\)/);
  assert.doesNotMatch(read('frontend/lib/api.ts'), /session\/end/);
});

test('production CORS is environment allowlisted', () => {
  const source = read('backend/src/main.ts');
  assert.match(source, /process\.env\.NODE_ENV === 'production'/);
  assert.match(source, /configuredCorsOrigins/);
  assert.doesNotMatch(source, /enableCors\(\s*\)/);
});

test('JWT secret is read from environment rather than hardcoded', () => {
  const source = read('backend/src/auth/jwt.util.ts');
  assert.match(source, /process\.env\.JWT_SECRET/);
  assert.doesNotMatch(source, /JWT_SECRET\s*=\s*['"][^'"]+['"]/);
});
