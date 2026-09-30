// Static architecture guard for the FINAL authentication architecture:
//   one /login -> backend authenticates and reports the role -> role-based landing.
// These are source-level checks (no browser is available here); the behavioural
// proof is scripts/day41-single-login.e2e.test.mjs, which exercises the real API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', '.git'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const sourceFiles = walk(root).filter((f) => /\.(ts|tsx|mjs|md|yml|yaml|example)$/.test(f) && !f.endsWith('.test.mjs') && !f.endsWith(path.join('docs', 'PROGRESS.md')));

test('no obsolete separate-Super-Admin-login references remain in source or docs', () => {
  const banned = [
    /super-admin\/login/i,
    /super-admin\/register/i,
    /superAdminLogin/,
    /Use the Super Admin sign-in/i,
    /Login as Super Admin/i,
    /Super Admin Login/, // case-sensitive: catches a UI label, not prose like "no separate Super Admin login"
  ];
  for (const f of sourceFiles) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of banned) assert.doesNotMatch(s, re, `${path.relative(root, f)} still references ${re}`);
  }
});

test('backend exposes one login endpoint and no Super Admin login/registration route', () => {
  const ctrl = read('src/auth/auth.controller.ts');
  assert.equal((ctrl.match(/@Post\('login'\)/g) || []).length, 1);
  assert.doesNotMatch(ctrl, /@Post\('super-admin/);
  const svc = read('src/auth/auth.service.ts');
  assert.doesNotMatch(svc, /superAdminLogin/);
  // authenticate() takes credentials only: no role/portal parameter from the client
  assert.match(svc, /private async authenticate\(input: LoginInput\)/);
  // registration always creates a normal user and never reads a role from the request
  assert.match(svc, /platformRole: PlatformRole\.USER/);
});

test('no hard-coded Super Admin credentials in tracked source/config', () => {
  for (const f of sourceFiles) {
    const s = fs.readFileSync(f, 'utf8');
    // SUPER_ADMIN_PASSWORD may appear only as a variable name / placeholder, never with a real value
    for (const m of s.matchAll(/SUPER_ADMIN_PASSWORD[ \t]*[=:][ \t]*([^\s#]+)/g)) {
      assert.match(m[1], /^(replace-with|<|\$|process\.env|\$\{|your-|change|['"`]?$)/i, `${path.relative(root, f)} has a concrete SUPER_ADMIN_PASSWORD value`);
    }
  }
});
