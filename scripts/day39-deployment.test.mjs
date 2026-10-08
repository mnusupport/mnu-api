import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const main = read('backend/src/main.ts');
const db = read('backend/src/database/database.module.ts');
const health = read('backend/src/app.controller.ts');
const web = read('frontend/lib/api.ts');
const env = read('backend/.env.example');

test('production refuses local DB and still requires Cloudinary, without Twilio', () => {
  assert.match(main, /must not point to a local MongoDB in production/);
  assert.match(main, /CLOUDINARY_API_SECRET/);
  assert.doesNotMatch(main, /TWILIO_|OTP_/);
  assert.equal(existsSync(new URL('../backend/src/customers/customer-auth.service.ts', import.meta.url)), false);
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
test('web has no production localhost fallback', () => {
  assert.match(web, /NODE_ENV === 'production'/);
});
test('customer ordering env template has no OTP/Twilio configuration', () => {
  assert.doesNotMatch(env, /TWILIO_|OTP_/);
  assert.doesNotMatch(env, /AC[0-9a-f]{32}|VA[0-9a-f]{32}|mongodb\+srv:\/\/[^:]+:[^@]+@/);
  assert.match(env, /TRUST_PROXY/);
});
