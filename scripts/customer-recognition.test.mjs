import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// ---------------------------------------------------------------------------
// Static architecture guarantees: recognition must stay OUT of the order path.
// ---------------------------------------------------------------------------

test('order creation stays independent of customer recognition', () => {
  const service = read('backend/src/orders/orders.service.ts');
  const start = service.indexOf('async createOrder(');
  const end = service.indexOf('// ---- Public: popular items');
  const section = service.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(section, /recognition/i);
  assert.doesNotMatch(section, /customerModel\./);
  assert.doesNotMatch(section, /customerId/);
  for (const file of fs.readdirSync(path.join(root, 'backend/src/orders'), { recursive: true })) {
    const f = String(file);
    if (!f.endsWith('.ts')) continue;
    assert.doesNotMatch(read(`backend/src/orders/${f}`), /customer-recognition|CustomerRecognition/, `orders/${f} must not use recognition`);
  }
  const controller = read('backend/src/orders/public-orders.controller.ts');
  assert.doesNotMatch(controller, /CustomerAuthGuard|recognition|customerId|phone/i);
});

test('no OTP / Twilio / customer auth or session was reintroduced', () => {
  for (const f of ['customer-recognition.service.ts', 'customer-recognition.controller.ts', 'customer-recognition.module.ts']) {
    // Comments may legitimately explain that OTP is NOT used; check code only.
    const src = read(`backend/src/customers/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /twilio|otp|CustomerAuthGuard|signCustomerToken|jsonwebtoken|password/i, f);
  }
  assert.equal(fs.existsSync(path.join(root, 'backend/src/customers/customer-auth.service.ts')), false);
  assert.equal(fs.existsSync(path.join(root, 'backend/src/customers/customer-auth.guard.ts')), false);
});

test('no second customer collection and no existing index was changed', () => {
  const schema = read('backend/src/customers/schemas/customer.schema.ts');
  assert.match(schema, /CustomerSchema\.index\(\{ restaurantId: 1, mobileNumber: 1 \}, \{ unique: true, sparse: true \}\);/);
  const schemas = fs.readdirSync(path.join(root, 'backend/src/customers/schemas'));
  assert.deepEqual(schemas, ['customer.schema.ts']);
  // The only new index is non-unique + partial.
  const added = schema.slice(schema.indexOf("'recognitionTokens.tokenHash': 1 }"));
  assert.doesNotMatch(added.split(');')[0], /unique/);
  assert.match(schema, /select: false/);
});

test('browser token is opaque, restaurant-scoped and stores no personal data', () => {
  const store = read('frontend/lib/customerRecognition.ts');
  assert.match(store, /mnu_customer_identity:\$\{restaurantId\}/);
  assert.doesNotMatch(store, /setItem\([^)]*(phone|name|customerId)/i);
  const hook = read('frontend/lib/useCustomerRecognition.ts');
  assert.doesNotMatch(hook, /localStorage|sessionStorage/);
  const service = read('backend/src/customers/customer-recognition.service.ts');
  assert.match(service, /randomBytes\(32\)/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.doesNotMatch(service, /fingerprint|\.ip\b|x-forwarded/i);
});

test('review page still sends the ordinary name-only order request', () => {
  const review = read('frontend/app/menu/[restaurantId]/review/page.tsx');
  assert.match(review, /ordersApi\.create\(\s*restaurantId,\s*tableId \?\? undefined,\s*orderType,\s*items\.map\(\(i\) => \(\{ itemId: i\.itemId, quantity: i\.quantity \}\)\),\s*getIdempotencyKey\(\),\s*name,\s*\)/);
  // Footer (Place order) is reachable for recognized AND for the name-only fallback.
  assert.match(review, /canOrder = rec\.phase === 'recognized' \|\| rec\.phase === 'nameOnly'/);
  const api = read('frontend/lib/api.ts');
  assert.match(api, /catch \{\s*return \{ status: 'unavailable' \};/);
});

test('every identification step offers the name-only escape hatch', () => {
  const ui = read('frontend/app/menu/[restaurantId]/_components/CustomerIdentifier.tsx');
  const skips = ui.match(/\{skip\}/g) ?? [];
  assert.ok(skips.length >= 4, `expected skip link in checking/ask/returning/new, found ${skips.length}`);
  assert.match(ui, /Continue with just my name/);
  assert.match(ui, /Change customer/);
  // Phone is never a field on the final review (recognized card shows masked text only).
  const recognized = ui.slice(ui.indexOf("rec.phase === 'recognized'"), ui.indexOf('// nameOnly'));
  assert.doesNotMatch(recognized, /type="tel"/);
});

// ---------------------------------------------------------------------------
// Behavior: compile the REAL service with tsc against stand-ins and run it
// against an in-memory Customer model (unique indexes + failure injection).
// ---------------------------------------------------------------------------

function findTsc() {
  const candidates = [
    path.join(root, 'backend/node_modules/.bin/tsc'),
    path.join(root, 'node_modules/.bin/tsc'),
    'tsc',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['-v'], { stdio: 'ignore' });
      return c;
    } catch { /* try next */ }
  }
  return null;
}

const tsc = findTsc();
const skipBehavior = tsc ? false : 'tsc not found; behavior tests skipped (this is NOT a pass)';
let svc;
let nest;
let Types;
let contact;

if (tsc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnu-recog-'));
  const harness = path.join(root, 'scripts/recognition-harness');
  const nm = (p) => path.join(tmp, 'node_modules', p);
  for (const [stub, dest] of [['nestjs-common.js', '@nestjs/common'], ['nestjs-mongoose.js', '@nestjs/mongoose'], ['mongoose.js', 'mongoose']]) {
    fs.mkdirSync(nm(dest), { recursive: true });
    fs.copyFileSync(path.join(harness, 'stubs', stub), path.join(nm(dest), 'index.js'));
  }
  const src = path.join(root, 'backend/src');
  fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2021', module: 'commonjs', moduleResolution: 'node', ignoreDeprecations: '6.0',
      strict: false, strictNullChecks: true, noImplicitAny: true, experimentalDecorators: true, skipLibCheck: true,
      esModuleInterop: true, outDir: path.join(tmp, 'out'), rootDir: src, types: [],
    },
    files: [
      path.join(harness, 'shims.d.ts'),
      path.join(src, 'customers/customer-recognition.service.ts'),
      path.join(src, 'customers/customer-contact.util.ts'),
    ],
  }));
  try {
    execFileSync(tsc, ['-p', path.join(tmp, 'tsconfig.json')], { stdio: 'pipe' });
  } catch (e) {
    // Surface compile errors in OUR files; anything else would indicate a harness gap.
    throw new Error(`recognition service failed to compile:\n${e.stdout}`);
  }
  const require = createRequire(path.join(tmp, 'out', 'x.js'));
  svc = require(path.join(tmp, 'out/customers/customer-recognition.service.js'));
  contact = require(path.join(tmp, 'out/customers/customer-contact.util.js'));
  nest = require(path.join(tmp, 'node_modules/@nestjs/common'));
  Types = require(path.join(tmp, 'node_modules/mongoose')).Types;
}

class FakeCustomerModel {
  constructor() { this.docs = []; this.hooks = {}; this.calls = 0; }
  get(path_, doc) { return path_.split('.').reduce((v, k) => (Array.isArray(v) ? v.flatMap((x) => x?.[k]) : v?.[k]), doc); }
  matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      const value = this.get(k, doc);
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(value);
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$ne' in v) return value !== v.$ne;
      const vals = Array.isArray(value) ? value : [value];
      return vals.some((x) => String(x) === String(v));
    });
  }
  guard() { this.calls += 1; if (this.hooks.fail) throw new Error('simulated customer database outage'); }
  findOne(filter) {
    const self = this;
    const q = {
      select: () => q,
      lean: async () => { self.guard(); await Promise.resolve(); const d = self.docs.find((x) => self.matches(x, filter)); return d ? { _id: d._id, name: d.name, mobileNumber: d.mobileNumber } : null; },
    };
    return q;
  }
  async create(doc) {
    this.guard();
    await Promise.resolve();
    if (this.hooks.createError) { const e = this.hooks.createError(doc); if (e) throw e; }
    if (this.docs.some((d) => d.customerCode === doc.customerCode)) throw Object.assign(new Error('E11000'), { code: 11000, keyPattern: { customerCode: 1 }, index: 'customerCode_1' });
    if (this.docs.some((d) => String(d.restaurantId) === String(doc.restaurantId) && d.mobileNumber === doc.mobileNumber)) throw Object.assign(new Error('E11000'), { code: 11000, keyPattern: { restaurantId: 1, mobileNumber: 1 }, index: 'restaurantId_1_mobileNumber_1' });
    const stored = { ...doc };
    this.docs.push(stored);
    return { ...stored };
  }
  async updateOne(filter, update) {
    this.guard();
    await Promise.resolve();
    const d = this.docs.find((x) => this.matches(x, filter));
    if (!d) return { matchedCount: 0 };
    if (update.$set) Object.assign(d, update.$set);
    if (update.$push?.recognitionTokens) {
      const { $each, $slice } = update.$push.recognitionTokens;
      d.recognitionTokens = [...(d.recognitionTokens ?? []), ...$each].slice($slice);
    }
    if (update.$pull?.recognitionTokens) d.recognitionTokens = (d.recognitionTokens ?? []).filter((t) => t.tokenHash !== update.$pull.recognitionTokens.tokenHash);
    return { matchedCount: 1 };
  }
}

function setup() {
  const customers = new FakeCustomerModel();
  const restaurants = new Set();
  const restaurantModel = { exists: async ({ _id }) => (restaurants.has(String(_id)) ? { _id } : null) };
  const R1 = new Types.ObjectId().toString();
  const R2 = new Types.ObjectId().toString();
  restaurants.add(R1); restaurants.add(R2);
  nest.__logs.length = 0;
  return { recognition: new svc.CustomerRecognitionService(customers, restaurantModel), customers, R1, R2 };
}

const PHONE = '9876543210';
const behavior = { skip: skipBehavior };

test('A. new customer + new browser: registered once, token saved hashed, order-independent', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const res = await recognition.register(R1, '  Ruchit  ', PHONE);
  assert.equal(res.status, 'recognized');
  assert.equal(res.customer.name, 'Ruchit');
  assert.equal(res.customer.maskedPhone, '98XXXXXX10');
  assert.match(res.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(customers.docs.length, 1);
  assert.equal(customers.docs[0].mobileNumber, '+919876543210');
  assert.match(customers.docs[0].customerCode, /^CUST-[0-9A-F]{6}$/);
  // Only the hash is stored; raw token never reaches the database.
  const stored = JSON.stringify(customers.docs[0]);
  assert.ok(!stored.includes(res.token));
  assert.equal(customers.docs[0].recognitionTokens.length, 1);
  assert.equal('email' in customers.docs[0], false); // keeps the global sparse unique email index safe
  // The response never exposes the raw phone or an internal id.
  const body = JSON.stringify(res);
  assert.ok(!body.includes('9876543210') && !body.includes(String(customers.docs[0]._id)));
});

test('B. same customer + same browser: token alone recognizes (no name/phone input)', behavior, async () => {
  const { recognition, R1 } = setup();
  const { token } = await recognition.register(R1, 'Ruchit', PHONE);
  const res = await recognition.resolve(R1, token);
  assert.deepEqual(res, { status: 'recognized', customer: { name: 'Ruchit', maskedPhone: '98XXXXXX10' } });
});

test('C. existing customer + new browser: phone variants resolve to ONE customer, new device remembered', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const deviceA = (await recognition.register(R1, 'Ruchit', PHONE)).token;
  const tokens = [deviceA];
  for (const variant of ['+919876543210', '919876543210', '98765 43210', '98765-43210', '(98765) 43210']) {
    const res = await recognition.identifyReturning(R1, variant);
    assert.equal(res.status, 'recognized', variant);
    assert.equal(res.customer.name, 'Ruchit');
    tokens.push(res.token);
  }
  assert.equal(new Set(tokens).size, tokens.length, 'each device gets its own token');
  assert.equal(customers.docs.length, 1, 'no duplicate customer');
  for (const t of tokens) assert.equal((await recognition.resolve(R1, t)).status, 'recognized');
});

test('D. new browser + phone not found -> not_found, then register creates exactly one customer', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  assert.deepEqual(await recognition.identifyReturning(R1, PHONE), { status: 'not_found' });
  assert.equal(customers.docs.length, 0, 'lookup must never create a customer');
  const res = await recognition.register(R1, 'Asha', PHONE);
  assert.equal(res.status, 'recognized');
  assert.equal(customers.docs.length, 1);
});

test('E. change customer: only THIS browser token is revoked; customer and other devices survive', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const a = (await recognition.register(R1, 'Ruchit', PHONE)).token;
  const b = (await recognition.identifyReturning(R1, PHONE)).token;
  assert.deepEqual(await recognition.forget(R1, a), { status: 'cleared' });
  assert.equal((await recognition.resolve(R1, a)).status, 'unrecognized');
  assert.equal((await recognition.resolve(R1, b)).status, 'recognized');
  assert.equal(customers.docs.length, 1, 'customer not deleted');
  // idempotent / safe with junk
  assert.deepEqual(await recognition.forget(R1, a), { status: 'cleared' });
  assert.deepEqual(await recognition.forget(R1, 'junk'), { status: 'cleared' });
  // identify a different customer afterwards
  const other = await recognition.register(R1, 'Meera', '9123456780');
  assert.equal(other.status, 'recognized');
  assert.equal(other.customer.name, 'Meera');
});

test('F/I. missing, malformed or injected tokens are rejected without touching the database', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  await recognition.register(R1, 'Ruchit', PHONE);
  const before = customers.calls;
  for (const bad of [undefined, null, '', 'abc', 'x'.repeat(43) + '!', 'a'.repeat(44), { $ne: null }, ['a'], 123]) {
    assert.deepEqual(await recognition.resolve(R1, bad), { status: 'unrecognized' }, JSON.stringify(bad));
  }
  assert.equal(customers.calls, before, 'malformed tokens never reach the database');
  // well-formed but unknown token
  assert.deepEqual(await recognition.resolve(R1, 'A'.repeat(43)), { status: 'unrecognized' });
});

test('G. restaurant isolation: token and phone are scoped per restaurant', behavior, async () => {
  const { recognition, customers, R1, R2 } = setup();
  const { token } = await recognition.register(R1, 'Ruchit', PHONE);
  assert.deepEqual(await recognition.resolve(R2, token), { status: 'unrecognized' });
  assert.deepEqual(await recognition.identifyReturning(R2, PHONE), { status: 'not_found' });
  const second = await recognition.register(R2, 'Ruchit', PHONE);
  assert.equal(second.status, 'recognized');
  assert.equal(customers.docs.length, 2, 'same phone => separate customer per restaurant');
  assert.equal((await recognition.resolve(R1, token)).status, 'recognized');
  assert.deepEqual(await recognition.forget(R2, token), { status: 'cleared' }); // wrong restaurant: no effect
  assert.equal((await recognition.resolve(R1, token)).status, 'recognized');
});

test('H. database failure: every operation returns "unavailable" and never throws', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const { token } = await recognition.register(R1, 'Ruchit', PHONE);
  customers.hooks.fail = true;
  assert.deepEqual(await recognition.resolve(R1, token), { status: 'unavailable' });
  assert.deepEqual(await recognition.identifyReturning(R1, PHONE), { status: 'unavailable' });
  assert.deepEqual(await recognition.register(R1, 'Ruchit', PHONE), { status: 'unavailable' });
  assert.deepEqual(await recognition.forget(R1, token), { status: 'unavailable' });
});

test('J. customer deleted: token no longer matches, no crash', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const { token } = await recognition.register(R1, 'Ruchit', PHONE);
  customers.docs.length = 0;
  assert.deepEqual(await recognition.resolve(R1, token), { status: 'unrecognized' });
});

test('K. repeated + concurrent registration of one phone yields exactly one customer', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  for (let i = 0; i < 3; i += 1) assert.equal((await recognition.register(R1, 'Ruchit', PHONE)).status, 'recognized');
  assert.equal(customers.docs.length, 1);
  const { recognition: r2, customers: c2, R1: id } = setup();
  const results = await Promise.all(Array.from({ length: 6 }, () => r2.register(id, 'Ruchit', PHONE)));
  assert.ok(results.every((r) => r.status === 'recognized'));
  assert.equal(c2.docs.length, 1, 'unique index arbitrates the race; losers reuse the winner');
});

test('existing customer keeps stored name; legacy phone formats and missing names are handled', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  await recognition.register(R1, 'Ruchit', PHONE);
  const again = await recognition.register(R1, 'Somebody Else', '+91 98765 43210');
  assert.equal(again.customer.name, 'Ruchit', 'name is not overwritten by a different submission');
  // Legacy record stored as bare 10-digit, no name.
  customers.docs.push({ _id: new Types.ObjectId(), restaurantId: new Types.ObjectId(R1), mobileNumber: '9123456780', customerCode: 'CUST-LEGACY' });
  const legacy = await recognition.identifyReturning(R1, '+919123456780');
  assert.equal(legacy.status, 'recognized');
  assert.equal(legacy.customer.name, null, 'missing legacy name is reported as null, never invented');
  assert.equal(customers.docs.length, 2);
  const filled = await recognition.register(R1, 'Neha', '9123456780');
  assert.equal(filled.customer.name, 'Neha');
  assert.equal(customers.docs.length, 2, 'legacy customer reused, not duplicated');
});

test('input validation returns safe messages (no database access)', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const before = customers.calls;
  assert.deepEqual(await recognition.identifyReturning(R1, 'abc'), { status: 'invalid', message: 'Please enter a valid phone number.' });
  assert.equal((await recognition.register(R1, '', PHONE)).status, 'invalid');
  assert.equal((await recognition.register(R1, 'R', PHONE)).status, 'invalid');
  assert.equal((await recognition.register(R1, 'Ruchit', '12')).status, 'invalid');
  assert.equal((await recognition.register(R1, { $ne: 1 }, PHONE)).status, 'invalid');
  assert.equal(customers.calls, before);
});

test('browser cap: only the newest 10 remembered browsers are kept', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const tokens = [(await recognition.register(R1, 'Ruchit', PHONE)).token];
  for (let i = 0; i < 11; i += 1) tokens.push((await recognition.identifyReturning(R1, PHONE)).token);
  assert.equal(customers.docs[0].recognitionTokens.length, 10);
  assert.equal((await recognition.resolve(R1, tokens[0])).status, 'unrecognized');
  assert.equal((await recognition.resolve(R1, tokens.at(-1))).status, 'recognized');
});

test('duplicate-key problems: customerCode collision retries; unresolvable index conflict degrades safely', behavior, async () => {
  // customerCode collision on first insert -> retried with a new id, still one customer.
  let a = setup();
  let first = true;
  a.customers.hooks.createError = () => {
    if (!first) return null;
    first = false;
    return Object.assign(new Error('E11000'), { code: 11000, keyPattern: { customerCode: 1 }, index: 'customerCode_1' });
  };
  assert.equal((await a.recognition.register(a.R1, 'Ruchit', PHONE)).status, 'recognized');
  assert.equal(a.customers.docs.length, 1);

  // Legacy/global phone index that no same-restaurant lookup can resolve.
  const b = setup();
  b.customers.hooks.createError = () => Object.assign(new Error('E11000 dup key: mobileNumber_1'), { code: 11000, keyPattern: { mobileNumber: 1 }, index: 'mobileNumber_1' });
  const res = await b.recognition.register(b.R1, 'Ruchit', PHONE);
  assert.deepEqual(res, { status: 'unavailable' }, 'no MongoDB error is exposed and nothing throws');
  assert.ok(nest.__logs.some((l) => l.includes('duplicate-key conflict') && l.includes('mobileNumber_1')), 'diagnostics keep index details');
});

test('logs never contain raw phone numbers, tokens or token hashes', behavior, async () => {
  const { recognition, customers, R1 } = setup();
  const { token } = await recognition.register(R1, 'Ruchit', PHONE);
  customers.hooks.fail = true;
  await recognition.resolve(R1, token);
  await recognition.identifyReturning(R1, PHONE);
  await recognition.register(R1, 'Ruchit', PHONE);
  const all = nest.__logs.join('\n');
  assert.ok(nest.__logs.length >= 3);
  assert.ok(!all.includes('9876543210'));
  assert.ok(!all.includes(token));
  assert.match(all, /98XXXXXX10/);
});

test('phone masking and canonical normalization (single implementation)', behavior, () => {
  const { normalizeMobile, maskMobile, validateMobile, legacyMobileCandidates } = contact;
  for (const v of ['9876543210', '+919876543210', '919876543210', '98765 43210', '98765-43210']) assert.equal(normalizeMobile(v), '+919876543210', v);
  assert.equal(normalizeMobile('+14155550123'), '+14155550123', 'non-Indian numbers are not rewritten');
  assert.deepEqual(legacyMobileCandidates('+919876543210').sort(), ['+919876543210', '919876543210', '9876543210']);
  assert.equal(maskMobile('+919876543210'), '98XXXXXX10');
  assert.equal(maskMobile('+14155550123'), '14XXXXXXX23');
  assert.equal(maskMobile(undefined), '');
  assert.throws(() => validateMobile('not-a-phone'), /valid phone/);
});
