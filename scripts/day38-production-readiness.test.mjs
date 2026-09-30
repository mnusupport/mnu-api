import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('new-order notification is server-authorized and restaurant-scoped', () => {
  const controller = read('src/orders/orders.controller.ts');
  const service = read('src/orders/orders.service.ts');
  assert.match(controller, /JwtAuthGuard/);
  assert.match(controller, /notifications\/summary/);
  assert.match(controller, /CurrentUserId/);
  assert.match(service, /requireMembership\(restaurantId, userId\)/);
  assert.match(service, /restaurantId: restaurantObjectId/);
  assert.match(service, /createdAt: \{ \$gt: cursor/);
});

test('pending badge reuses canonical actionable order lifecycle', () => {
  const service = read('src/orders/orders.service.ts');
  for (const status of ['OrderStatus.NEW', 'OrderStatus.CONFIRMED', 'OrderStatus.PREPARING', 'OrderStatus.READY']) {
    assert.match(service, new RegExp(status.replace('.', '\\.' )));
  }
  assert.match(service, /pendingCount/);
  assert.doesNotMatch(service, /COMPLETED,\s*OrderStatus\.CANCELLED[\s\S]{0,80}pendingCount/);
});

test('normal checkout has an idempotency key and database uniqueness guard', () => {
  const schema = read('src/orders/schemas/order.schema.ts');
  const service = read('src/orders/orders.service.ts');
  const controller = read('src/orders/public-orders.controller.ts');
  assert.match(schema, /idempotencyKey/);
  assert.match(schema, /unique: true/);
  assert.match(service, /findOne\(\{ restaurantId, customerId, idempotencyKey \}\)/);
  assert.match(service, /code === 11000/);
  assert.match(controller, /body\?\.idempotencyKey/);
});

test('production configuration fails closed for core deployment settings', () => {
  const main = read('src/main.ts');
  assert.match(main, /DATABASE_URL/);
  assert.match(main, /JWT_SECRET/);
  assert.match(main, /CORS_ORIGINS/);
  assert.match(main, /at least 32 characters/);
  assert.match(main, /https:/);
});

test('Super Admin remains a separate platform authorization boundary', () => {
  const controller = read('src/platform-admin/platform-admin.controller.ts');
  const guard = read('src/common/super-admin.guard.ts');
  const auth = read('src/auth/auth.service.ts');
  assert.match(controller, /JwtAuthGuard/);
  assert.match(controller, /SuperAdminGuard/);
  assert.match(guard, /requireSuperAdmin/);
  assert.doesNotMatch(auth, /Use the Super Admin sign-in/); // single /login architecture: no separate sign-in
});

test('Cloudinary remains an explicit external dependency; customer ordering does not require Twilio', () => {
  const main = read('src/main.ts');
  const cloudinary = read('src/common/cloudinary.ts');
  const customer = read('src/customers/customer-auth.service.ts');
  assert.match(main, /CLOUDINARY_CLOUD_NAME/);
  assert.match(cloudinary, /cloud_name: process\.env\.CLOUDINARY_CLOUD_NAME/);
  assert.doesNotMatch(main, /TWILIO_|OTP_/);
  assert.doesNotMatch(customer, /Twilio|OTP|verifySms|otpHash/);
});
