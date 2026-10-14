import 'dotenv/config';
import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { PlatformRole } from '../common/enums/platform-role.enum';
import { UserSchema } from '../users/schemas/user.schema';

async function main() {
  const uri = process.env.DATABASE_URL;
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME?.trim() || 'Mr.wiserr Super Admin';

  if (!uri || !email || !password) {
    throw new Error('DATABASE_URL, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required.');
  }
  if (password.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('SUPER_ADMIN_EMAIL must be a valid email.');

  await mongoose.connect(uri);
  const UserModel = mongoose.model('User', UserSchema);
  const existingSuperAdmin = await UserModel.findOne({ platformRole: PlatformRole.SUPER_ADMIN, email: { $ne: email } }).select({ email: 1 }).lean();
  if (existingSuperAdmin) {
    throw new Error(`A different Super Admin already exists (${existingSuperAdmin.email}). Refusing to create another.`);
  }

  // With a single /login for everyone, silently promoting (and resetting the password of) an
  // ordinary account that shares this email, e.g. a restaurant owner, would be a quiet
  // privilege escalation. Require an explicit, deliberate opt-in for that.
  const existingUser = await UserModel.findOne({ email }).select({ platformRole: 1 }).lean();
  if (existingUser && existingUser.platformRole !== PlatformRole.SUPER_ADMIN && process.env.SUPER_ADMIN_PROMOTE_EXISTING !== 'true') {
    throw new Error(
      `A regular account already exists for ${email}. Use a dedicated email for the Super Admin, or set SUPER_ADMIN_PROMOTE_EXISTING=true to promote it deliberately.`,
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await UserModel.findOneAndUpdate(
    { email },
    { $set: { name, passwordHash, platformRole: PlatformRole.SUPER_ADMIN } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`Super Admin bootstrap complete for ${email}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
