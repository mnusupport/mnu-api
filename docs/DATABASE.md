# MnU — Database

**Database:** MongoDB
**Access layer:** Mongoose (via `@nestjs/mongoose`)

Prisma is no longer used anywhere in this project. See "Migration from
Prisma" below for what changed and why.

## Connection

`backend/src/database/database.module.ts` is a `@Global()` module that:

1. Opens the MongoDB connection with `MongooseModule.forRootAsync()`,
   reading the connection string from `DATABASE_URL` (via `ConfigService`,
   so it respects `.env`).
2. Registers the three schemas below with `MongooseModule.forFeature()`,
   so any module can `@InjectModel(...)` them without re-declaring the
   schema registration.

`DATABASE_URL` format (see `backend/.env.example`):
```
# Local:  mongodb://localhost:27017/mnu_dev
# Atlas:  mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/mnu_dev
```

`GET /health` (`backend/src/app.controller.ts`) round-trips
`connection.db.admin().ping()` to prove the connection is alive.

## Models

**Collection names are pinned explicitly** on every schema below via
`@Schema({ ..., collection: '<Name>' })`, matching exactly what Prisma
used to name them (model name verbatim — `schema.prisma` never set
`@@map`). This is deliberate, not Mongoose's default: left unset,
`@nestjs/mongoose` would lowercase+pluralize each class name (`User` →
`users`), producing a *different* collection than the one Prisma's data
already lives in. That mismatch actually happened once — see "Fixed:
Mongoose was writing to the wrong collections" in `docs/PROGRESS.md` —
so don't remove these `collection` options without re-reading that.

Same three concepts as before, now expressed as Mongoose schemas instead
of Prisma models. Mongo/Mongoose provide `_id` (`ObjectId`) automatically,
so — unlike `schema.prisma` — none of the schemas below declare an
explicit `id` field.

### User (`backend/src/users/schemas/user.schema.ts`)
| field          | type   | notes                          |
|----------------|--------|---------------------------------|
| `name`         | string | required                        |
| `email`        | string | required, unique                |
| `passwordHash` | string | required (bcrypt hash)          |
| `platformRole` | enum: `PlatformRole` | `USER` or `SUPER_ADMIN`; platform-level authority |
| `createdAt`    | Date   | auto (`{ timestamps: true }`)   |
| `updatedAt`    | Date   | auto (`{ timestamps: true }`)   |

### Restaurant (`backend/src/restaurants/schemas/restaurant.schema.ts`)
| field       | type   | notes                        |
|-------------|--------|-------------------------------|
| `name`      | string | required                      |
| `createdAt` | Date   | auto (`{ timestamps: true }`) |
| `updatedAt` | Date   | auto (`{ timestamps: true }`) |

### RestaurantMember (`backend/src/restaurant-members/schemas/restaurant-member.schema.ts`)
The join between a `User` and a `Restaurant`, carrying that user's role
*for that specific restaurant* — this is what lets one user belong to
zero, one, or many restaurants with a different role in each.

| field          | type                              | notes                              |
|----------------|------------------------------------|-------------------------------------|
| `userId`       | ObjectId (`ref: 'User'`)           | required                            |
| `restaurantId` | ObjectId (`ref: 'Restaurant'`)     | required                            |
| `role`         | enum: `RestaurantRole`             | required                            |
| `createdAt`    | Date                               | auto (`createdAt`-only timestamps)  |

Indexes:
- `{ userId: 1, restaurantId: 1 }` unique — one role per user per restaurant.
- `{ userId: 1 }` — list a user's memberships.
- `{ restaurantId: 1 }` — list a restaurant's members.

### RestaurantRole (`backend/src/common/enums/restaurant-role.enum.ts`)
Plain TypeScript enum (Mongoose has no first-class enum type of its own):
`SUPER_ADMIN`, `RESTAURANT_ADMIN`, `RESTAURANT_STAFF`.

### Category (`backend/src/menu/schemas/category.schema.ts`)
Ported from `mnu_v1`'s Prisma `Category` model — see "Reconciled with
`mnu_v1`" in `docs/PROGRESS.md` for why this exists on this codebase at all.

| field          | type                          | notes                          |
|----------------|-------------------------------|----------------------------------|
| `restaurantId` | ObjectId (`ref: 'Restaurant'`)| required                        |
| `name`         | string                        | required                        |
| `sortOrder`    | number                        | default `0`                     |
| `createdAt`    | Date                          | auto (`{ timestamps: true }`)   |
| `updatedAt`    | Date                          | auto (`{ timestamps: true }`)   |

Index: `{ restaurantId: 1 }`.

### MenuItem (`backend/src/menu/schemas/menu-item.schema.ts`)
Ported from `mnu_v1`'s Prisma `MenuItem` model.

| field          | type                          | notes                          |
|----------------|-------------------------------|----------------------------------|
| `restaurantId` | ObjectId (`ref: 'Restaurant'`)| required, denormalized (see below) |
| `categoryId`   | ObjectId (`ref: 'Category'`)  | required                        |
| `name`         | string                        | required                        |
| `description`  | string \| null                | default `null`                  |
| `price`        | number                        | required                        |
| `isAvailable`  | boolean                       | default `true`                  |
| `sortOrder`    | number                        | default `0`                     |
| `createdAt`    | Date                          | auto                             |
| `updatedAt`    | Date                          | auto                             |

Indexes: `{ restaurantId: 1 }`, `{ categoryId: 1 }`.

`restaurantId` is duplicated onto the item (not just reachable via
`categoryId`) so restaurant-scoped queries don't need to resolve the
category first — same rationale as the original Prisma schema.

**No cascade delete.** Prisma's `relationMode = "prisma"` emulated
`onDelete: Cascade` (deleting a `Category` deleted its `MenuItem`s
automatically). Mongoose has no equivalent — `MenuService.deleteCategory()`
now explicitly `deleteMany()`s the category's items before deleting the
category itself. Worth knowing if a schema is ever queried directly
outside that service method.

## Relationships / references

Mongo has no native foreign keys. `userId`/`restaurantId` on
`RestaurantMember` are `ref:` fields Mongoose can `.populate()` on read
(used by `AuthService.login()`/`.me()` to attach `restaurant_name` to each
membership). Referential integrity (e.g. cascade delete when a user or
restaurant is removed) is an application concern now rather than a
database one — not implemented yet, since no delete flow exists at this
stage.

Multi-document writes (e.g. register's restaurant + user + membership
creation) are **not** wrapped in a transaction: MongoDB multi-document
transactions require a replica set, which a default standalone `mongod`
doesn't have. The three writes run sequentially instead. Revisit with a
single-node replica set locally, or Atlas (a replica set by default),
before this matters for real data.

## Seeding

```bash
# run inside backend/
npm run db:seed
```
Runs `backend/src/database/seed.ts` — a standalone script (connects via
`mongoose.connect()` directly, outside Nest's DI container) that seeds one
user with memberships (and different roles) across two restaurants, same
as the old Prisma seed.

## Migration from Prisma

Per project instruction, the database access layer was migrated from
**PostgreSQL + Prisma** (already switched to **MongoDB + Prisma** in an
earlier session) to **MongoDB + Mongoose**. Prisma is removed entirely —
no `@prisma/client`, no `prisma` CLI, no `schema.prisma` in the active
codebase.

What changed:
- `backend/src/prisma/` (`PrismaService`, `PrismaModule`) → replaced by
  `backend/src/database/database.module.ts`.
- `backend/prisma/schema.prisma` → replaced by three Mongoose schema
  files under `backend/src/{users,restaurants,restaurant-members}/schemas/`.
- `backend/prisma/seed.ts` → replaced by `backend/src/database/seed.ts`.
- `AuthService` (`backend/src/auth/auth.service.ts`) rewritten to use
  `@InjectModel()` + Mongoose query methods (`findOne`, `create`, `find`,
  `.populate()`) instead of `this.prisma.<model>.<method>()`.
- `AppController`'s `/health` check: `$runCommandRaw({ ping: 1 })` →
  `connection.db.admin().ping()`.
- `backend/package.json`: removed `@prisma/client`, `prisma`, and the
  `prisma:generate`/`prisma:push`/`prisma:studio` scripts; added
  `@nestjs/mongoose`, `mongoose`, `dotenv`; `db:seed` now points at the
  new seed script.
- Nothing changed in `.env.example` or `docker-compose.yml` — both were
  already MongoDB-shaped from the earlier provider switch.
- `JwtAuthGuard`, `jwt.util.ts`, `current-user.decorator.ts` — untouched;
  none of them touch the database.

**Old Prisma files were not deleted** — they're preserved at
`backend/_archive/prisma-legacy/` (outside `src/`, so excluded from the
build) per the instruction not to remove working code until the Mongoose
replacement is verified. See that folder's own `README.md` for what's in
it and when it's safe to delete.

### What's verified, and what isn't

This sandbox has no network access to any MongoDB endpoint (not
`fastdl.mongodb.org` for a downloadable test binary, not Atlas, not a
local `apt` package — MongoDB was dropped from Ubuntu's default repos).
That's the same category of limitation earlier sessions hit with Prisma's
binary downloads, just for a different package. So this migration is
verified as follows:

**Verified:**
- `tsc --noEmit` and `nest build` (`backend`) — clean, no Prisma
  references remain in the compiled `src/` tree.
- `tsc --noEmit` and `next build` (`frontend`) — clean, unaffected (the
  frontend only talks HTTP to the API; it has no DB dependency).
- The Nest app **boots**: `DatabaseModule` and `MongooseModule` initialize
  in the DI container without error, and the process correctly attempts
  to open a connection to `DATABASE_URL` (observed connecting/retrying
  against `mongodb://localhost:27017/mnu_dev` with no server listening,
  rather than failing with a code/config error).
- Schema-level checks (Mongoose `validateSync()`, no live DB needed):
  valid `User`/`Restaurant`/`RestaurantMember` documents pass validation;
  documents missing required fields fail validation; an invalid `role`
  value is rejected by the enum constraint; the compound unique index on
  `(userId, restaurantId)` and the individual indexes on `userId` and
  `restaurantId` are all present on the schema; the unique index on
  `User.email` is present. 11/11 checks passed.

**Not verified:**
- A real connection to a running MongoDB, and therefore
  `/auth/register` → `/auth/login` → `/auth/me` → `/auth/logout` have
  not been exercised end-to-end. Run this on your machine or against
  Atlas to confirm:
  ```bash
  cd backend
  docker compose up -d          # starts mongo:7 locally
  npm install
  cp .env.example .env          # fill in DATABASE_URL + JWT_SECRET
  npm run db:seed
  npm run dev
  curl -X POST :3001/auth/register -d '{...}'
  curl :3001/health              # expect {"status":"ok","database":"connected"}
  ```
