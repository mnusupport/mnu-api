import 'dotenv/config';
import mongoose from 'mongoose';
import { RestaurantRole } from '../common/enums/restaurant-role.enum';
import { PlatformRole } from '../common/enums/platform-role.enum';
import { RestaurantMemberSchema } from '../restaurant-members/schemas/restaurant-member.schema';
import { RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { UserSchema } from '../users/schemas/user.schema';

// Minimal seed proving the User -> RestaurantMember -> Restaurant
// relationship: one user with two different roles across two restaurants.
// Standalone script (run with `npm run db:seed`), same role Prisma's
// `prisma/seed.ts` played — not wired into Nest's DI container.

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  await mongoose.connect(uri);

  const RestaurantModel = mongoose.model('Restaurant', RestaurantSchema);
  const UserModel = mongoose.model('User', UserSchema);
  const RestaurantMemberModel = mongoose.model('RestaurantMember', RestaurantMemberSchema);

  const restaurant = await RestaurantModel.create({ name: 'Demo Restaurant' });
  const secondRestaurant = await RestaurantModel.create({ name: 'Second Kitchen' });

  const owner = await UserModel.create({
    name: 'Alex Owner',
    email: 'alex@example.com',
    passwordHash: 'placeholder',
    platformRole: PlatformRole.USER,
  });

  await RestaurantMemberModel.create({
    userId: owner._id,
    restaurantId: restaurant._id,
    role: RestaurantRole.RESTAURANT_ADMIN,
  });
  await RestaurantMemberModel.create({
    userId: owner._id,
    restaurantId: secondRestaurant._id,
    role: RestaurantRole.RESTAURANT_STAFF,
  });

  console.log('Seeded: 1 user with memberships across 2 restaurants.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
