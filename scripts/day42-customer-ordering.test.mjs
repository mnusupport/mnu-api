import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('public QR order creation is anonymous and does not use customer auth', () => {
  const controller = read('backend/src/orders/public-orders.controller.ts');
  const service = read('backend/src/orders/orders.service.ts');
  assert.doesNotMatch(controller, /CustomerAuthGuard|CurrentCustomerId/);
  assert.match(controller, /@UseGuards\(RateLimitGuard\)/);
  assert.match(controller, /createOrder\(restaurantId, body\?\.tableId/);
  assert.doesNotMatch(service.slice(0, service.indexOf('async listPublicOrdersForRestaurant')), /customerModel\.findOne\(\{ _id: customerId/);
  assert.doesNotMatch(service.slice(0, service.indexOf('async listPublicOrdersForRestaurant')), /Customer session is not valid/);
});

test('customer authentication implementation is removed from the public ordering project', () => {
  assert.equal(exists('backend/src/customers/customer-auth.service.ts'), false);
  assert.equal(exists('backend/src/customers/customer-auth.controller.ts'), false);
  assert.equal(exists('backend/src/customers/customer-auth.guard.ts'), false);
  assert.equal(exists('frontend/lib/customerAuth.ts'), false);
  assert.equal(exists('frontend/app/menu/[restaurantId]/identify/page.tsx'), false);
});

test('anonymous order schema keeps customer linkage optional for legacy/admin records', () => {
  const schema = read('backend/src/orders/schemas/order.schema.ts');
  assert.match(schema, /customerId\?: Types\.ObjectId \| null/);
  assert.match(schema, /required: false/);
});

test('public order validation remains server-side', () => {
  const service = read('backend/src/orders/orders.service.ts');
  assert.match(service, /findOne\(\{ _id: tableId, restaurantId \}/);
  assert.match(service, /find\(\{ _id: \{ \$in: distinctIds \}, restaurantId \}/);
  assert.match(service, /if \(!menuItem\.isAvailable\)/);
  assert.match(service, /const lineTotal = menuItem\.price \* raw\.quantity/);
  assert.match(service, /const total = subtotal/);
});
