// MnU — shared role enum.
// Was a Prisma `enum RestaurantRole` in schema.prisma; now a plain TS enum
// referenced by the Mongoose RestaurantMember schema and by application
// code, since Mongoose has no first-class enum type of its own.
export enum RestaurantRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  RESTAURANT_ADMIN = 'RESTAURANT_ADMIN',
  RESTAURANT_STAFF = 'RESTAURANT_STAFF',
}
