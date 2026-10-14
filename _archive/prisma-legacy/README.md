# Archived — pre-migration Prisma implementation

This folder is **not part of the build** (it lives outside `src/`, which
is the compiled source root per `nest-cli.json`). It's kept only so the
prior Prisma + MongoDB implementation isn't lost, per the migration
instruction to not delete working code until the Mongoose replacement is
verified.

- `prisma/` — the old `schema.prisma` (User/Restaurant/RestaurantMember,
  already pointed at `provider = "mongodb"`) and its seed script.
- `src-prisma/` — the old `PrismaService`/`PrismaModule` that wrapped
  `PrismaClient` for Nest's DI container.

These were never fully exercised end-to-end against a real MongoDB in any
sandbox session (`prisma generate` couldn't reach `binaries.prisma.sh`),
so "working" here means "typechecked and reviewed," not "verified live."

Safe to delete once the Mongoose implementation (`apps/api/src/database/`,
`apps/api/src/users/`, `apps/api/src/restaurants/`,
`apps/api/src/restaurant-members/`) has been run against a real MongoDB
instance and confirmed working.
