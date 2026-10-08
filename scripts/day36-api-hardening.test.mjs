import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('global request safety and controlled error handling are installed', () => {
  const main = read('backend/src/main.ts');
  assert.match(main, /new RequestSafetyPipe\(\)/);
  assert.match(main, /new HttpErrorFilter\(\)/);
  assert.match(main, /express\.json\(\{ limit: '1mb' \}\)/);
  assert.match(main, /X-Content-Type-Options/);
});

test('request safety blocks Mongo operator/path injection keys', () => {
  const pipe = read('backend/src/common/pipes/request-safety.pipe.ts');
  assert.match(pipe, /key\.startsWith\('\$'\)/);
  assert.match(pipe, /key\.includes\('\.'\)/);
  assert.match(pipe, /__proto__/);
});

test('route ObjectIds are validated before Mongoose', () => {
  const pipe = read('backend/src/common/pipes/request-safety.pipe.ts');
  assert.match(pipe, /Types\.ObjectId\.isValid\(value\)/);
  assert.match(pipe, /Invalid \$\{metadata\.data\}/);
});

test('abuse-prone endpoints have application rate limits', () => {
  const auth = read('backend/src/auth/auth.controller.ts');
  const orders = read('backend/src/orders/public-orders.controller.ts');
  const analytics = read('backend/src/orders/orders.controller.ts');
  const upload = read('backend/src/menu/menu.controller.ts');
  assert.match(auth, /@RateLimit\(10, 60_000\)/);
  assert.doesNotMatch(orders, /CustomerAuthGuard|customer-auth/);
  assert.match(orders, /@RateLimit\(20, 60_000\)/);
  assert.match(analytics, /@RateLimit\(30, 60_000\)/);
  assert.match(upload, /@RateLimit\(30, 60 \* 60_000\)/);
});

test('list endpoints apply bounded pagination', () => {
  const controller = read('backend/src/orders/orders.controller.ts');
  const service = read('backend/src/orders/orders.service.ts');
  assert.match(controller, /parsePagination\(\{ page, limit \}\)/);
  assert.match(service, /\.skip\(pagination\.skip\)\.limit\(pagination\.limit\)/);
  assert.match(service, /\{ \$skip: pagination\.skip \}/);
  assert.match(service, /\{ \$limit: pagination\.limit \}/);
});

test('restaurant branding uses an explicit update allowlist', () => {
  const service = read('backend/src/restaurants/restaurants.service.ts');
  assert.match(service, /const allowedFields = new Set/);
  assert.match(service, /Unsupported branding field/);
});

test('public customer ordering has no OTP/Twilio dependency', () => {
  const orders = read('backend/src/orders/public-orders.controller.ts');
  assert.doesNotMatch(orders, /CustomerAuthGuard|customer-auth|Twilio|OTP/i);
  assert.doesNotMatch(read('backend/src/auth/jwt.util.ts'), /CustomerToken|customer_id/);
});
