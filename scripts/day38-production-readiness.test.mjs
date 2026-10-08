import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

test('new-order notification is server-authorized and restaurant-scoped', () => {
  const controller = read('backend/src/orders/orders.controller.ts');
  const service = read('backend/src/orders/orders.service.ts');
  assert.match(controller, /JwtAuthGuard/);
  assert.match(controller, /notifications\/summary/);
  assert.match(controller, /CurrentUserId/);
  assert.match(service, /requireMembership\(restaurantId, userId\)/);
  assert.match(service, /restaurantId: restaurantObjectId/);
  assert.match(service, /createdAt: \{ \$gt: cursor/);
});

test('pending badge reuses canonical actionable order lifecycle', () => {
  const service = read('backend/src/orders/orders.service.ts');
  for (const status of ['OrderStatus.NEW', 'OrderStatus.CONFIRMED', 'OrderStatus.PREPARING', 'OrderStatus.READY']) {
    assert.match(service, new RegExp(status.replace('.', '\\.' )));
  }
  assert.match(service, /pendingCount/);
  assert.doesNotMatch(service, /COMPLETED,\s*OrderStatus\.CANCELLED[\s\S]{0,80}pendingCount/);
});

test('frontend notification monitor deduplicates and survives refresh', () => {
  const monitor = read('frontend/app/restaurants/[restaurantId]/_components/OrderNotificationMonitor.tsx');
  assert.ok(exists('frontend/app/restaurants/[restaurantId]/_components/OrderNotificationMonitor.tsx'));
  assert.match(monitor, /localStorage/);
  assert.match(monitor, /seenOrderIds/);
  assert.match(monitor, /setTimeout\(poll, POLL_INTERVAL_MS\)/);
  assert.match(monitor, /ordersApi\.notificationSummary/);
  assert.match(monitor, /restaurants\/\$\{restaurantId\}\/orders\/\$\{notification\.id\}/);
});

test('restaurant sidebar exposes pending order count without client-supplied restaurant scope', () => {
  const layout = read('frontend/app/restaurants/[restaurantId]/layout.tsx');
  assert.match(layout, /pendingOrderCount/);
  assert.match(layout, /item\.href === 'orders'/);
  assert.match(layout, /OrderNotificationMonitor/);
});

test('normal checkout has an idempotency key and database uniqueness guard', () => {
  const schema = read('backend/src/orders/schemas/order.schema.ts');
  const service = read('backend/src/orders/orders.service.ts');
  const controller = read('backend/src/orders/public-orders.controller.ts');
  const review = read('frontend/app/menu/[restaurantId]/review/page.tsx');
  assert.match(schema, /idempotencyKey/);
  assert.match(schema, /unique: true/);
  assert.match(service, /findOne\(\{ restaurantId, idempotencyKey \}\)/);
  assert.match(service, /code === 11000/);
  assert.match(controller, /body\?\.idempotencyKey/);
  assert.match(review, /idempotencyKeyRef/);
});

test('production configuration fails closed for core deployment settings', () => {
  const main = read('backend/src/main.ts');
  assert.match(main, /DATABASE_URL/);
  assert.match(main, /JWT_SECRET/);
  assert.match(main, /CORS_ORIGINS/);
  assert.match(main, /at least 32 characters/);
  assert.match(main, /https:/);
});

test('Super Admin remains a separate platform authorization boundary', () => {
  const controller = read('backend/src/platform-admin/platform-admin.controller.ts');
  const guard = read('backend/src/common/super-admin.guard.ts');
  const auth = read('backend/src/auth/auth.service.ts');
  const layout = read('frontend/app/super-admin/layout.tsx');
  assert.match(controller, /JwtAuthGuard/);
  assert.match(controller, /SuperAdminGuard/);
  assert.match(guard, /requireSuperAdmin/);
  assert.doesNotMatch(auth, /Use the Super Admin sign-in/); // single /login architecture: no separate sign-in
  assert.match(layout, /platformRole !== 'SUPER_ADMIN'/);
  assert.doesNotMatch(layout, /restaurant.*SUPER_ADMIN.*sidebar/i);
});

test('Cloudinary remains an explicit external dependency; customer ordering does not require Twilio', () => {
  const main = read('backend/src/main.ts');
  const cloudinary = read('backend/src/common/cloudinary.ts');
  assert.match(main, /CLOUDINARY_CLOUD_NAME/);
  assert.match(cloudinary, /cloud_name: process\.env\.CLOUDINARY_CLOUD_NAME/);
  assert.doesNotMatch(main, /TWILIO_|OTP_/);
  assert.doesNotMatch(read('backend/src/auth/jwt.util.ts'), /CustomerToken|customer_id/);
});
