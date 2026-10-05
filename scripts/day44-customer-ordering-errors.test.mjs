import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('the old customer-record creation error path is removed', () => {
  const files = [
    'backend/src/orders/orders.service.ts',
    'backend/src/orders/public-orders.controller.ts',
    'frontend/app/menu/[restaurantId]/review/page.tsx',
  ];
  for (const file of files) assert.doesNotMatch(read(file), /Could not create the customer record/);
  assert.equal(exists('backend/src/customers/customer-auth.service.ts'), false);
});

test('normal order creation does not create, find, or require a customer', () => {
  const service = read('backend/src/orders/orders.service.ts');
  const publicStart = service.indexOf('async createOrder(');
  const publicEnd = service.indexOf('// ---- Public: popular items');
  const publicSection = service.slice(publicStart, publicEnd);
  assert.doesNotMatch(publicSection, /customerModel\.find/);
  assert.doesNotMatch(publicSection, /customerModel\.create/);
  assert.doesNotMatch(publicSection, /customerId/);
});

test('order creation keeps server-side restaurant/item/price/quantity validation', () => {
  const service = read('backend/src/orders/orders.service.ts');
  assert.match(service, /this\.assertValidId\(restaurantId, 'Restaurant'\)/);
  assert.match(service, /Number\.isInteger\(raw\.quantity\)/);
  assert.match(service, /restaurantId \}/);
  assert.match(service, /menuItem\.price \* raw\.quantity/);
  assert.match(service, /const subtotal = items\.reduce/);
});

test('orders page does not attempt customer identification when no identity exists', () => {
  const page = read('frontend/app/menu/[restaurantId]/orders/page.tsx');
  assert.doesNotMatch(page, /customerAuth|customerToken|customerProfile|CustomerIdentityPanel|\/identify/);
  assert.match(page, /No saved orders/);
});

test('review page has no customer-authentication redirect or customer fields', () => {
  const review = read('frontend/app/menu/[restaurantId]/review/page.tsx');
  assert.doesNotMatch(review, /identify|customerAuth|CustomerProfile|customerToken|Customer identified/);
  assert.match(review, /Place order/);
});

test('group order no longer depends on Customer records', () => {
  const service = read('backend/src/group-orders/group-orders.service.ts');
  const controller = read('backend/src/group-orders/group-orders.controller.ts');
  assert.doesNotMatch(service, /customerModel|CustomerDocument|customerId/);
  assert.doesNotMatch(controller, /CustomerAuthGuard|CurrentCustomerId/);
  assert.match(service, /participantId/);
});

test('group participant identity is anonymous browser state, not customer authentication', () => {
  const helper = read('frontend/lib/groupParticipant.ts');
  assert.match(helper, /localStorage/);
  assert.match(helper, /randomUUID/);
  assert.doesNotMatch(helper, /phone|customer|OTP|token/i);
});

test('public order history returns an empty identity-free state instead of a 400/500', () => {
  const service = read('backend/src/orders/orders.service.ts');
  assert.match(service, /return \{ restaurant: \{ id: restaurantId, name: restaurant\.name \}, customer: null, orders: \[\] \}/);
});

test('QR checkout asks for a name only - no phone number - and creates no Customer record', () => {
  const review = read('frontend/app/menu/[restaurantId]/review/page.tsx');
  const api = read('frontend/lib/api.ts');
  const controller = read('backend/src/orders/public-orders.controller.ts');
  const service = read('backend/src/orders/orders.service.ts');
  const schema = read('backend/src/orders/schemas/order.schema.ts');
  // Part 1.7: the name-only field now lives in CustomerIdentifier (the fallback
  // and recognized-without-a-name case); the review page renders it. The order
  // request itself is unchanged and the review page itself has no phone input.
  const identifier = read('frontend/app/menu/[restaurantId]/_components/CustomerIdentifier.tsx');
  assert.match(review, /<CustomerIdentifier/);
  assert.match(identifier, /id="customer-name"/);
  assert.doesNotMatch(review, /type="tel"|mobileNumber/);
  assert.match(api, /customerName/);
  assert.match(controller, /customerName/);
  assert.doesNotMatch(controller, /mobileNumber|phone/i);
  assert.match(service, /Please enter your name to place the order\./);
  const section = service.slice(service.indexOf('async createOrder('), service.indexOf('// ---- Public: popular items'));
  assert.doesNotMatch(section, /mobileNumber|phone/i);
  assert.match(schema, /customerName\?: string \| null/);
});
