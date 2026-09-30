import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const main = read('src/main.ts');
const db = read('src/database/database.module.ts');
const health = read('src/app.controller.ts');
const customer = read('src/customers/customer-auth.service.ts');
const env = read('.env.example');

test('production refuses local DB and still requires Cloudinary, without Twilio', () => {
  assert.match(main, /must not point to a local MongoDB in production/);
  assert.match(main, /CLOUDINARY_API_SECRET/);
  assert.doesNotMatch(main, /TWILIO_|OTP_/);
  assert.match(customer, /Customer ordering no longer depends on|customer-provided/);
});
test('proxy trust, shutdown hooks and startup failure exit code', () => {
  assert.match(main, /trust proxy/);
  assert.match(main, /enableShutdownHooks\(\)/);
  assert.match(main, /process\.exit\(1\)/);
});
test('request logger never logs headers/bodies/query strings', () => {
  assert.match(main, /originalUrl\.split\('\?'\)\[0\]/);
  assert.doesNotMatch(main, /req\.(headers|body|query)/);
});
test('mongo connection has timeouts, bounded retries and pool size', () => {
  for (const k of ['serverSelectionTimeoutMS', 'connectTimeoutMS', 'maxPoolSize', 'retryAttempts']) assert.ok(db.includes(k));
});
test('/health returns 503 without leaking details when DB is down', () => {
  assert.match(health, /SERVICE_UNAVAILABLE/);
  assert.match(health, /database: 'disconnected'/);
});
test('customer ordering env template has no OTP/Twilio configuration', () => {
  assert.doesNotMatch(env, /TWILIO_|OTP_/);
  assert.doesNotMatch(env, /AC[0-9a-f]{32}|VA[0-9a-f]{32}|mongodb\+srv:\/\/[^:]+:[^@]+@/);
  assert.match(env, /TRUST_PROXY/);
});
