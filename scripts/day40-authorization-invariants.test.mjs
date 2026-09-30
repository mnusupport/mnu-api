import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(src).filter((f) => f.endsWith('.ts'));
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => path.relative(src, f);

test('every restaurant-scoped admin controller is behind JwtAuthGuard', () => {
  for (const f of files.filter((x) => x.endsWith('.controller.ts'))) {
    const s = read(f);
    if (/@Controller\(\s*['"]restaurants\/:restaurantId/.test(s)) {
      assert.match(s, /@UseGuards\(JwtAuthGuard/, `${rel(f)} exposes restaurant routes without JwtAuthGuard`);
    }
  }
});

test('restaurant access decisions live only in AuthorizationService (no duplicated Super Admin services)', () => {
  // auth.service.ts is exempt: it only authenticates credentials and reports the account's
  // role at the single /login endpoint; it makes no access decision about restaurant data.
  const svc = files.filter((f) => f.endsWith('.service.ts') && !f.includes('common/authorization') && !f.endsWith('auth/auth.service.ts'));
  for (const f of svc) {
    assert.doesNotMatch(read(f), /platformRole\s*[!=]==?\s*['"]?(PlatformRole\.)?SUPER_ADMIN/, `${rel(f)} makes its own Super Admin decision`);
  }
  assert.ok(!files.some((f) => /super-?admin.*(menu|table|order|categor)/i.test(rel(f))), 'no parallel Super Admin menu/table/order services');
});

test('nothing can grant or strip platformRole via the API (no lock-out / privilege escalation path)', () => {
  const writes = files.filter((f) => !f.includes('database/') && !f.includes('schemas/') && !f.includes('enums/'))
    .filter((f) => /platformRole\s*:/.test(read(f)) && /(\$set|create\(|findOneAndUpdate|findByIdAndUpdate|updateOne)/.test(read(f)));
  for (const f of writes) {
    const s = read(f);
    assert.doesNotMatch(s, /platformRole:\s*(?!PlatformRole\.USER)[^,}\n]*SUPER_ADMIN/, `${rel(f)} may assign SUPER_ADMIN`);
  }
  // self-registration must always produce a normal USER
  assert.match(read(path.join(src, 'auth/auth.service.ts')), /platformRole:\s*PlatformRole\.USER/);
});

test('audit interceptor never persists bodies, headers or tokens', () => {
  const s = read(path.join(src, 'audit/audit.interceptor.ts'));
  assert.doesNotMatch(s, /request\.(body|headers)|authorization/i);
  assert.match(s, /SUPER_ADMIN/);
});
