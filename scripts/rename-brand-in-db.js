#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * One-off data fix for the MnU -> Mr.wiserr rebrand.
 *
 * The Super Admin's display name is stored in the database ("MnU Super Admin"),
 * so changing the code alone does not change what the header says. This script
 * renames the word "MnU" to "Mr.wiserr" in the `name` of USER accounts only
 * (never restaurant names, emails, or anything else).
 *
 *   node scripts/rename-brand-in-db.js --dry-run   # list what would change
 *   node scripts/rename-brand-in-db.js --yes       # apply (--yes needed for non-localhost)
 *
 * Reads DATABASE_URL from mnu-api/.env. Safe to re-run: names that no longer
 * contain "MnU" are left alone.
 */
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const YES = process.argv.includes('--yes');
const WORD = /\bmnu\b/i;

async function main() {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No connection string. Set DATABASE_URL in mnu-api/.env.');
    process.exitCode = 1;
    return;
  }
  let host = '(unknown)';
  let db = '(default)';
  let local = false;
  try {
    const u = new URL(uri);
    host = u.host;
    db = u.pathname.replace(/^\//, '') || '(default)';
    local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch { /* leave defaults */ }
  console.log(`Target: ${host} / database "${db}"   Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  if (!DRY_RUN && !local && !YES) {
    console.error('Not a localhost database. Re-run with --yes to confirm, or use --dry-run to preview.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 });
    const users = mongoose.connection.db.collection('User');
    const all = await users.find({}, { projection: { name: 1, email: 1 } }).toArray();
    const targets = all.filter((u) => typeof u.name === 'string' && WORD.test(u.name));

    if (targets.length === 0) {
      console.log('No user names contain "MnU". Nothing to do.');
      return;
    }
    const ops = targets.map((u) => {
      const next = u.name.replace(/\bmnu\b/gi, 'Mr.wiserr');
      console.log(`  ${u.email ?? u._id}:  "${u.name}"  ->  "${next}"`);
      return { updateOne: { filter: { _id: u._id }, update: { $set: { name: next, updatedAt: new Date() } } } };
    });
    if (DRY_RUN) {
      console.log(`\n${ops.length} user name(s) would be updated. Run without --dry-run to apply.`);
      return;
    }
    const res = await users.bulkWrite(ops, { ordered: false });
    console.log(`\nUpdated ${res.modifiedCount} user name(s). Log out and back in to see the new name.`);
  } catch (err) {
    console.error('Failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main();
