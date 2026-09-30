import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const adminControllers = [
  'src/menu/menu.controller.ts',
  'src/orders/orders.controller.ts',
  'src/restaurants/restaurants.controller.ts',
  'src/tables/tables.controller.ts',
];

test('restaurant admin controllers are protected by JwtAuthGuard', () => {
  for (const file of adminControllers) {
    const source = read(file);
    assert.match(source, /@UseGuards\(JwtAuthGuard\)/, file);
  }
});

test('customer order access is bound to authenticated customer and restaurant', () => {
  const source = read('src/orders/orders.service.ts');
  assert.match(source, /find\(\{ restaurantId, customerId \}\)/);
  assert.match(source, /findOne\(\{ _id: orderId, restaurantId, customerId \}\)/);
});

test('admin object lookups remain restaurant-scoped', () => {
  const menu = read('src/menu/menu.service.ts');
  const tables = read('src/tables/tables.service.ts');
  const orders = read('src/orders/orders.service.ts');
  assert.match(menu, /_id: itemId,\s*restaurantId/);
  assert.match(menu, /_id: categoryId,\s*restaurantId/);
  assert.match(tables, /findOne\(\{ _id: tableId, restaurantId \}\)/);
  assert.match(orders, /findOne\(\{ _id: orderId, restaurantId \}\)/);
});

test('destructive public table-session end route is absent', () => {
  assert.doesNotMatch(read('src/table-sessions/table-sessions.controller.ts'), /@Patch\(['"]end['"]\)/);
});

test('production CORS is environment allowlisted', () => {
  const source = read('src/main.ts');
  assert.match(source, /process\.env\.NODE_ENV === 'production'/);
  assert.match(source, /configuredCorsOrigins/);
  assert.doesNotMatch(source, /enableCors\(\s*\)/);
});

test('JWT secret is read from environment rather than hardcoded', () => {
  const source = read('src/auth/jwt.util.ts');
  assert.match(source, /process\.env\.JWT_SECRET/);
  assert.doesNotMatch(source, /JWT_SECRET\s*=\s*['"][^'"]+['"]/);
});
