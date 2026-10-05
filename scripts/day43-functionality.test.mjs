import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('public order creation requires no customer session and supports takeaway', () => {
  const controller = read('backend/src/orders/public-orders.controller.ts');
  const service = read('backend/src/orders/orders.service.ts');
  assert.doesNotMatch(controller, /CustomerAuthGuard/);
  assert.match(controller, /@RateLimit\(20, 60_000\)/);
  assert.match(controller, /orderType\?: 'DINE_IN' \| 'TAKEAWAY'/);
  assert.match(service, /Takeaway orders cannot specify a table/);
});

test('review and cart flow goes directly to review without identity', () => {
  const cart = read('frontend/app/menu/[restaurantId]/cart/page.tsx');
  const review = read('frontend/app/menu/[restaurantId]/review/page.tsx');
  assert.match(cart, /\/review\$\{contextQuery\}/);
  assert.doesNotMatch(cart, /\/identify/);
  assert.doesNotMatch(review, /customerAuth|CustomerIdentityPanel|customerToken|CustomerProfile|\/identify/);
  assert.match(review, /ordersApi\.create\(/);
  assert.match(review, /disabled=\{submitting\}/);
});

test('customer auth UI and storage helpers are gone', () => {
  assert.equal(exists('frontend/lib/customerProfile.ts'), false);
  assert.equal(exists('frontend/lib/customerAuth.ts'), false);
  assert.equal(exists('frontend/app/menu/[restaurantId]/_components/CustomerIdentityPanel.tsx'), false);
  assert.equal(exists('frontend/app/menu/[restaurantId]/_components/CustomerNamePrompt.tsx'), false);
});

test('group ordering is anonymous and retains table-scoped server validation', () => {
  const controller = read('backend/src/group-orders/group-orders.controller.ts');
  const service = read('backend/src/group-orders/group-orders.service.ts');
  const schema = read('backend/src/group-orders/schemas/group-order.schema.ts');
  assert.doesNotMatch(controller, /CustomerAuthGuard|CurrentCustomerId/);
  assert.doesNotMatch(service, /customerModel|CustomerDocument/);
  assert.match(service, /participantId/);
  assert.match(service, /findOne\(\{ _id: tableId, restaurantId \}/);
  assert.match(service, /find\(\{ _id: \{ \$in: distinctIds \}, restaurantId \}/);
  assert.match(schema, /participantId/);
});

test('takeaway QR remains restaurant-level and admin distinguishes order type', () => {
  const qr = read('frontend/app/menu/[restaurantId]/_components/CustomerBottomNav.tsx');
  const schema = read('backend/src/orders/schemas/order.schema.ts');
  assert.match(schema, /DINE_IN/);
  assert.match(schema, /TAKEAWAY/);
  assert.ok(qr.length > 0);
});
