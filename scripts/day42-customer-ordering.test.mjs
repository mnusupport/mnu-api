import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('customer checkout is name + phone with no OTP gate', () => {
  const controller = read('src/orders/public-orders.controller.ts');
  const service = read('src/orders/orders.service.ts');
  assert.match(controller, /@Post\(\)/);
  assert.match(controller, /customer\?: \{ name: string; phone: string \}/);
  assert.match(service, /customerAuthService\.identify/);
});

test('customer identity is restaurant-scoped and does not claim phone verification', () => {
  const schema = read('src/customers/schemas/customer.schema.ts');
  const service = read('src/customers/customer-auth.service.ts');
  const jwt = read('src/auth/jwt.util.ts');
  const guard = read('src/customers/customer-auth.guard.ts');
  assert.match(schema, /restaurantId: Types\.ObjectId/);
  assert.match(schema, /restaurantId: 1, mobileNumber: 1/);
  assert.match(service, /findOne\(\{ restaurantId, mobileNumber \}\)/);
  assert.match(service, /signCustomerToken\(customer\._id\.toString\(\), restaurantId\)/);
  assert.match(jwt, /restaurant_id: string/);
  assert.match(guard, /payload\.restaurant_id !== restaurantId/);
  assert.doesNotMatch(service, /Twilio|OTP|verifySms|otpHash/);
});

test('production API no longer requires Twilio customer OTP configuration', () => {
  const main = read('src/main.ts');
  const env = read('.env.example');
  const customersModule = read('src/customers/customers.module.ts');
  assert.doesNotMatch(main, /TWILIO_|OTP_PROVIDER|OTP_DEV_MODE/);
  assert.doesNotMatch(env, /TWILIO_|OTP_PROVIDER|OTP_DEV_MODE/);
  assert.doesNotMatch(customersModule, /OtpProviderService|OtpChallenge/);
  assert.ok(!fs.existsSync(path.join(root, 'src/customers/otp/otp-provider.service.ts')));
});
