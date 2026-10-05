import { PrismaClient } from '@prisma/client';

// Minimal seed proving the User -> RestaurantMember -> Restaurant
// relationship: one user with two different roles across two restaurants.
const prisma = new PrismaClient();

async function main() {
  const restaurant = await prisma.restaurant.create({
    data: { name: 'Demo Restaurant' },
  });
  const secondRestaurant = await prisma.restaurant.create({
    data: { name: 'Second Kitchen' },
  });

  const owner = await prisma.user.create({
    data: {
      name: 'Alex Owner',
      email: 'alex@example.com',
      passwordHash: 'placeholder',
    },
  });

  await prisma.restaurantMember.create({
    data: { userId: owner.id, restaurantId: restaurant.id, role: 'RESTAURANT_ADMIN' },
  });
  await prisma.restaurantMember.create({
    data: { userId: owner.id, restaurantId: secondRestaurant.id, role: 'RESTAURANT_STAFF' },
  });

  console.log('Seeded: 1 user with memberships across 2 restaurants.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
