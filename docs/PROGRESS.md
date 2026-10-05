# MnU — Progress Log

Consolidated as of the MongoDB switch. Reflects the current state of the
project end to end, not just the most recent session.

## Day 1 — Foundation
- Turborepo monorepo (`pnpm-workspace.yaml`, `turbo.json`) with `apps/web`
  (Next.js) and `apps/api` (NestJS).
- Base project structure and documentation.

*(Correction: `apps/web` was left as an empty placeholder folder through
Day 2 and Day 3 — it's now actually scaffolded; see "Frontend foundation
added" below.)*

## Day 2 — Database connection foundation
- Prisma installed and wired into the NestJS backend:
  - `apps/api/src/prisma/prisma.service.ts` — `PrismaService extends
    PrismaClient`, hooked into Nest's module lifecycle.
  - `apps/api/src/prisma/prisma.module.ts` — `@Global()` module exporting
    `PrismaService`.
  - `GET /health` on `AppController` round-trips a trivial DB call to prove
    the connection is alive.
- `.env.example` added (safe placeholder); real `.env` gitignored, never committed.
- `docker-compose.yml` added for local dev infrastructure.

*(Originally built and verified against PostgreSQL — see "Switched to
MongoDB" below for what changed.)*

## Day 3 — Users, roles, restaurants foundation
Three models added to `apps/api/prisma/schema.prisma`:
- `User` — id, name, email (unique), passwordHash (placeholder), timestamps
- `Restaurant` — id, name, timestamps
- `RestaurantMember` — join table: userId, restaurantId, role, createdAt;
  unique on (userId, restaurantId) so one user has exactly one role per
  restaurant, but can belong to many restaurants
- `RestaurantRole` enum — `SUPER_ADMIN`, `RESTAURANT_ADMIN`, `RESTAURANT_STAFF`
- `apps/api/prisma/seed.ts` — seeds one user with memberships (and
  different roles) across two restaurants.

**Verified (against PostgreSQL, before the Mongo switch):** applied the
schema, confirmed a user can hold different roles at different restaurants
simultaneously, confirmed the unique constraint blocks a duplicate
membership, and confirmed cascade delete removes only the affected
restaurant's membership rows.

No auth, JWT, login, or business features (QR/menu/orders/analytics/AI) —
those are later tasks. **Next task: Authentication foundation.**

## Switched to MongoDB (after Day 3)
Per request, the database provider was changed from PostgreSQL to MongoDB:
- `schema.prisma`: `provider = "mongodb"`, `relationMode = "prisma"` (Mongo
  has no native foreign keys, so Prisma enforces relations/cascades itself
  instead of the database). Every model's `id` now uses `@default(auto())
  @map("_id") @db.ObjectId`. Explicit `@@index` added on `userId` and
  `restaurantId` in `RestaurantMember` since Mongo doesn't auto-index
  foreign-key-style fields the way Postgres does.
- Removed the Postgres-specific SQL migration folder — Mongo uses
  `prisma db push`, not migration files.
- `docker-compose.yml` now runs `mongo:7` instead of `postgres:16-alpine`.
- `apps/api/package.json`: `prisma:migrate` script replaced with
  `prisma:push` (`prisma db push`).
- `AppController`'s `/health` check switched from `$queryRaw\`SELECT 1\``
  (SQL-only) to `$runCommandRaw({ ping: 1 })` (Mongo's equivalent).
- `.env.example` updated to a MongoDB connection string format
  (`mongodb://` for local, `mongodb+srv://` for Atlas).
- `prisma/seed.ts` unchanged — it never set IDs manually, so it works as-is
  against Mongo's auto-generated ObjectIds.

**Not yet verified end-to-end against a real MongoDB instance** — this
sandbox's network can't reach MongoDB's package repo (dropped from Ubuntu's
default apt repos over licensing) or Atlas, so the schema/config changes
above are correct by inspection but haven't been round-tripped through
`prisma generate` → `db push` → `db seed` → `prisma studio` the way the
Postgres version was. Run that sequence on your own machine or against
Atlas to confirm before building the next task on top of it.

## Frontend foundation added
`apps/web` was scaffolded for real (Next.js 15, App Router, React 19,
TypeScript, Tailwind v4):
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css` — a minimal landing
  page only, matching the backend's current foundation-only scope. No auth
  screens, QR menu, or dashboards yet.
- `.env.example` — `NEXT_PUBLIC_API_URL` pointing at the NestJS API.
- Verified: `npm run build` compiles cleanly (Next 15.5.25, static export of
  `/` succeeds).

Frontend features get built alongside each backend task going forward,
starting with login/register screens once "Authentication foundation" lands.

## Authentication (started early, at request)
Real register/login/me endpoints added to the backend, and real
login/register/dashboard screens added to the frontend — ahead of the
formal "Authentication foundation" day, at explicit request.

**Backend** (`apps/api/src/auth/`):
- `POST /auth/register` — creates a Restaurant + User + RestaurantMember
  (role `RESTAURANT_ADMIN`) and returns `{ token, user, membership }`.
- `POST /auth/login` — verifies credentials with bcrypt, returns
  `{ token, user, memberships }` (an array — a user isn't assumed to
  belong to only one restaurant, consistent with Day 3's design).
- `GET /auth/me` — verifies the bearer JWT, returns the current user +
  all their memberships.
- JWT payload is intentionally just `{ user_id }` — role/restaurant are
  contextual per request, not baked into the token, since one token
  shouldn't imply one fixed role.
- **Not wrapped in a Prisma `$transaction`**: MongoDB multi-document
  transactions require a replica set, which a default standalone `mongod`
  doesn't have. Register's three writes (restaurant, user, membership) run
  sequentially instead. Fine for this stage; revisit with a single-node
  replica set locally or Atlas (a replica set by default) before this
  matters for real data.
- New deps: `bcryptjs`, `jsonwebtoken`. New env var: `JWT_SECRET`.

**Frontend** (`apps/web/app/`):
- `/register`, `/login` — real forms calling the endpoints above via
  `lib/api.ts`, storing the JWT in `localStorage`.
- `/dashboard` — minimal page proving the token round-trips through
  `/auth/me` correctly; lists the signed-in user's restaurants + roles.
- `/menu/demo` — **dummy data only**, clearly labeled in-page. There is no
  menu/QR backend yet (still out of scope), so this previews layout only
  and is not wired to the API.
- Home page (`/`) updated to link to all of the above.

### Verified
- Both `apps/web` (`npm run build`) and the auth module's TypeScript
  (`npx tsc --noEmit`) compile cleanly.

### Known limitation (environment, not code) — same root cause as before
`npx prisma generate` still can't complete in this sandbox (`binaries.prisma.sh`
403), so the auth endpoints haven't been exercised against a real running
MongoDB in this environment — only reviewed and typechecked (with an
explicit interface added for the one spot that would otherwise have relied
on Prisma's generated types). Run `npm install` → `npx prisma generate` →
`npx prisma db push` → `npm run dev` on your machine or against Atlas, then
test `/auth/register` and `/auth/login` with curl or the frontend forms, to
confirm before building further on top of this.

## Day 4 — Authentication system completed

Registration, login, password hashing, and `/auth/me` already existed
(built ahead of schedule, see "Authentication (started early)" above).
This session added the two pieces still missing against the Day 4 spec:

- **`JwtAuthGuard`** (`apps/api/src/auth/jwt-auth.guard.ts`) + **`@CurrentUserId()`**
  decorator — a real, reusable NestJS guard. `/auth/me` previously parsed
  and verified the bearer token inline in the controller; it's now
  `@UseGuards(JwtAuthGuard)` like any future protected route will be.
- **`POST /auth/logout`** — guarded, confirms the token is valid, returns
  `{ message: 'Logged out.' }`. JWTs here are stateless (no server-side
  session to destroy), so real logout is the client discarding the token;
  this endpoint gives a consistent place to call and a hook point for a
  token-blocklist later if that's ever needed.
- **Email format validation** added to `register()` (simple regex) — the
  length/confirmation checks already existed, but format wasn't checked.
- **Frontend**: `authApi.logout()` added to `lib/api.ts`; the dashboard's
  "Sign out" button now calls it (best-effort) before clearing the local
  token, instead of only clearing local state.
- **Fixed a real bug**: `apps/api/.env` was missing `JWT_SECRET` entirely
  (only `.env.example` had it) — every authenticated request would have
  thrown `JWT_SECRET is not set in .env` at runtime. Added a dev-only value.

No database changes — logout needed none, and the User/RestaurantMember
models already supported everything else.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean.
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean (same 6
  routes as before: `/`, `/dashboard`, `/login`, `/menu/demo`, `/register`,
  plus `/_not-found`).
- Pure auth logic verified directly (12/12 checks passed, no DB needed):
  JWT sign/verify round-trip, JWT rejects a tampered token, JWT rejects a
  token signed with the wrong secret, bcrypt hash ≠ plaintext, bcrypt
  compare true/false cases, email regex accept/reject cases, password
  length rule.

### Not verified — same root cause as every prior session
The app can't actually **boot** in this sandbox: `PrismaClient did not
initialize yet` on startup, because `prisma generate` still can't reach
`binaries.prisma.sh` (403, network-blocked) here. So register/login/me/
logout/invalid-credentials could not be exercised against a real running
server + MongoDB in this environment — only reviewed, typechecked, and
logic-tested as above. On your machine or Atlas: `npm install` → `npx
prisma generate` → `npx prisma db push` → `npm run dev`, then:
- `curl -X POST :3001/auth/register -d '{...}'` → expect `{ token, user, membership }`
- `curl -X POST :3001/auth/login -d '{...}'` → expect `{ token, user, memberships }`
- `curl :3001/auth/me -H "Authorization: Bearer <token>"` → expect `{ user, memberships }`
- `curl :3001/auth/me` (no header) → expect `401 Unauthenticated.`
- `curl -X POST :3001/auth/logout -H "Authorization: Bearer <token>"` → expect `{ message: 'Logged out.' }`
- `curl -X POST :3001/auth/login -d '{"email":"x","password":"wrong"}'` → expect `401 Invalid email or password.`

Next task: **Role-based access control**.

## Migrated database layer from Prisma to Mongoose

Per project instruction, the database access layer was migrated from
**Prisma** (already pointed at MongoDB, per the earlier "Switched to
MongoDB" entry above) to **Mongoose**. Prisma is now removed entirely —
see [`docs/DATABASE.md`](./DATABASE.md) for the full breakdown of what
changed and why.

Summary:
- `PrismaService`/`PrismaModule` → `DatabaseModule`
  (`apps/api/src/database/database.module.ts`), a `@Global()` module using
  `MongooseModule.forRootAsync()` + `forFeature()`.
- `schema.prisma`'s three models became three Mongoose schemas:
  `apps/api/src/users/schemas/user.schema.ts`,
  `apps/api/src/restaurants/schemas/restaurant.schema.ts`,
  `apps/api/src/restaurant-members/schemas/restaurant-member.schema.ts`
  (plus `RestaurantRole` as a plain TS enum under `src/common/enums/`).
  Same fields, same compound-unique + individual indexes on
  `RestaurantMember`, same `User.email` unique constraint.
- `AuthService` rewritten to use `@InjectModel()` and Mongoose query
  methods instead of `this.prisma.<model>.<method>()`. Behavior
  (register/login/me responses, validation rules, error messages) is
  unchanged — this was a data-layer swap, not a feature change.
- `AppController`'s `/health` check now pings via the Mongoose connection
  instead of Prisma.
- `prisma/seed.ts` → `src/database/seed.ts` (same seed data: one user,
  two restaurants, two different roles).
- `apps/api/package.json`: `@prisma/client`/`prisma` removed;
  `@nestjs/mongoose`/`mongoose`/`dotenv` added; `prisma:*` scripts
  removed, `db:seed` repointed.
- No changes needed to `.env.example` or `docker-compose.yml` — already
  MongoDB-shaped from the earlier provider switch.
- **Old Prisma files preserved, not deleted** — moved to
  `apps/api/_archive/prisma-legacy/` (outside the compiled `src/` tree, so
  they don't break the build) per the instruction not to remove working
  code until the Mongoose replacement is verified.
- Preserved as required: `User`, `Restaurant`, `RestaurantMember` concepts
  and the `SUPER_ADMIN` / `RESTAURANT_ADMIN` / `RESTAURANT_STAFF` roles.
  No menu, QR, orders, analytics, AI, customer, or mobile work added —
  out of scope, same as every prior session.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean (both run
  with the archived legacy folder excluded from the TypeScript project).
- `apps/web`: `npx tsc --noEmit` clean, `next build` clean (unaffected —
  the frontend has no DB dependency).
- `pnpm build` at the repo root: both `@mnu/api` and `@mnu/web` build
  successfully via Turborepo.
- App boot check: the Nest app starts, `DatabaseModule`/`MongooseModule`
  initialize without DI or config errors, and the process correctly
  attempts to open a connection to `DATABASE_URL` (observed
  connecting/retrying against an unreachable local MongoDB URI, rather
  than failing with a code error).
- Schema-level validation checks (Mongoose `validateSync()`, no live DB
  required): 11/11 passed — valid documents pass, documents missing
  required fields fail, an invalid `role` enum value is rejected, and all
  expected indexes (`User.email` unique; `RestaurantMember`'s compound
  unique index plus its two individual indexes) are present on the
  schemas.

### Not verified — same root cause as every prior session, different package
This sandbox has no network path to any real MongoDB: not `apt` (dropped
from Ubuntu's default repos), not `fastdl.mongodb.org` (tried
`mongodb-memory-server` to get a throwaway local instance — blocked,
403), not Atlas. So register/login/me/logout have **not** been exercised
against a real running MongoDB in this environment — same class of
limitation every prior session hit with Prisma's binary downloads, just
against a different domain this time. See "Verified / Not verified" in
`docs/DATABASE.md` for the exact commands to confirm on your own machine
or against Atlas before building further on top of this.

Next task: **Authentication foundation** *(already substantially built —
see "Authentication (started early)" and "Day 4 — Authentication system
completed" above; this session only swapped its data layer, no auth
behavior changed)*.

## Reconciled with `mnu_v1` — menu feature ported onto Mongoose

`mnu_v1` (a separately-uploaded package: still Prisma-based, but with a
real filled-in `.env`, `node_modules`, and a completed `.next`/`dist`
build — i.e. actually run and working) turned out to contain a **menu
management feature** (categories + items CRUD, `/restaurants/[id]/menu`)
that this Mongoose-migrated codebase did not have. So the Mongoose
migration above was *not* a strict upgrade of `mnu_v1` — it rewrote the
data layer but silently dropped a working feature in the process.

**Fixed by porting the menu feature onto this codebase**, Mongoose-native
rather than copying the Prisma version verbatim:

- Two new Mongoose schemas, matching this codebase's existing
  conventions: `apps/api/src/menu/schemas/category.schema.ts` and
  `.../menu-item.schema.ts` (same fields as the old Prisma `Category`/
  `MenuItem` models), registered in the shared `DatabaseModule`.
- `MenuService` rewritten against `@InjectModel()` instead of
  `PrismaService` — same access-control logic (membership required to
  view, `RESTAURANT_ADMIN`/`SUPER_ADMIN` required to mutate,
  `RESTAURANT_STAFF` can still toggle `isAvailable`). One real behavior
  difference worth flagging: Prisma's `relationMode = "prisma"` emulated
  cascade delete (deleting a category deleted its items automatically);
  Mongoose has no such emulation, so `deleteCategory()` now explicitly
  `deleteMany()`s the category's items first.
- `MenuController` and the frontend page
  (`apps/web/app/restaurants/[restaurantId]/menu/page.tsx`) copied over
  **unchanged** from `mnu_v1` — both are pure HTTP/REST, with no
  Prisma/Mongoose dependency of their own, so nothing needed to change.
- `lib/api.ts`: added `menuApi` + its types alongside the existing
  `authApi` (which already had `logout()`, not present in `mnu_v1`'s
  version — kept, not overwritten).
- `/dashboard`: added `mnu_v1`'s "Manage menu" link per restaurant,
  kept this codebase's `authApi.logout()`-calling sign-out button.

**Also copied over `mnu_v1`'s real `.env` files** (`apps/api/.env`,
`apps/web/.env`) — the actual `DATABASE_URL`/`JWT_SECRET`/
`NEXT_PUBLIC_API_URL` values that were confirmed working when `mnu_v1`
was run, rather than leaving this codebase on placeholder
`.env.example` values only. Both `.env` files remain gitignored, as
before.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean.
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean — 7 routes,
  same as `mnu_v1`'s build output plus Day 4's `/menu/demo` and
  `/_not-found`: `/`, `/dashboard`, `/login`, `/menu/demo`, `/register`,
  `/restaurants/[restaurantId]/menu`, `/_not-found`.

### Not verified — same root cause as every prior session on *this*
### machine, but see the important caveat below
This sandbox still has no path to a real MongoDB, so register → login →
manage-menu has not been re-exercised end-to-end here.

**However**, unlike every prior "not verified" note in this log, the
`.env` now in place is not a placeholder — it's the connection string
`mnu_v1` was actually run and confirmed working with. So the remaining
gap isn't "does this config work" (already answered elsewhere), it's
"does the Mongoose menu code behave identically to the Prisma version it
replaced" — that's the one thing to specifically re-check first: sign
in, hit `/restaurants/:id/menu`, add a category and a couple of items,
delete a category that still has items in it (confirms the manual
cascade), and toggle an item's availability as a `RESTAURANT_STAFF`
member to confirm the role split still holds.

## Fixed: `/login` and `/register` were stub pages, disconnected from the real backend

**This bug predates the menu-feature merge above** — it was already
present, unnoticed, in the original Day-4 upload. Confirmed by diffing
against a fresh re-extraction of that original zip: every auth-related
backend file (`AuthService`, `AuthController`, `JwtAuthGuard`, the
`User`/`Restaurant`/`RestaurantMember` schemas) was byte-for-byte
identical before and after the menu merge — nothing there regressed.
The bug was in two frontend files nobody had touched since Day 4:

- `apps/web/app/login/page.tsx` and `.../register/page.tsx` were leftover
  placeholder pages from *before* the backend auth work existed. Their
  submit handlers called a bare `fetch()` inside a `try` that was
  **guaranteed to hit the `catch` block** and show a hardcoded
  `"Login isn't live yet — the authentication backend hasn't been
  built."` message — regardless of whether the backend was reachable or
  correct, because they never used the real `authApi` from `lib/api.ts`.
- Even setting that aside, they stored the token under
  `localStorage['auth_token']`, while `lib/api.ts` and `/dashboard` both
  read `localStorage['mnu_token']` — a second, independent bug that
  would have broken the session immediately after a hypothetical
  successful login.

**Fixed** by replacing both pages with the real, working versions from
`mnu_v1` (which do use `authApi` and `'mnu_token'`, matching everything
else in this codebase) — with two debug `console.log` calls dropped in
the process (one of which logged the raw JWT to the browser console;
neither existed for a functional reason).

### Checks
- `apps/api`: `npx tsc --noEmit` and `npx nest build` clean, and
  confirmed via diff against a fresh copy of the original Day-4 zip that
  no auth-related backend file changed at all in this fix or the earlier
  menu merge.
- `apps/web`: `npx tsc --noEmit` and `npm run build` clean; same 7 routes
  as before, `/login` and `/register` now slightly smaller in the build
  output (dropped an unused `Link` import and debug logging).
- Still not run against a live MongoDB in this sandbox — but this fix
  makes that the *only* remaining unverified piece; register/login can
  now actually be exercised once pointed at a real database.

## Fixed: Mongoose was writing to the wrong collections

Spotted from a MongoDB Atlas Data Explorer screenshot after connecting
this app to the real `mnu_dev` database: **two parallel sets of
collections existed side by side**.

- `Category`, `MenuItem`, `Restaurant`, `RestaurantMember`, `User`
  (PascalCase, singular, matching the model name exactly) — these had
  real documents: 2 restaurants, 2 users, 2 memberships, a category, a
  menu item. This is the original data from `mnu_v1` running on Prisma,
  which (with no `@@map` in `schema.prisma`) used the model name as the
  collection name verbatim.
- `categories`, `menuitems`, `restaurantmembers`, `restaurants`, `users`
  (lowercase, pluralized) — near-empty, freshly created. **This is what
  the Mongoose app had actually been reading and writing to**, because
  `@nestjs/mongoose` derives a collection name by lowercasing +
  pluralizing the class name when none is given, and none of the five
  schemas set one explicitly.

Net effect: the Mongoose backend could not see any of the real existing
data, and any registration done against it landed in a disconnected,
throwaway collection instead.

**Fixed** by adding an explicit `collection` option to all five
`@Schema(...)` decorators (`User`, `Restaurant`, `RestaurantMember`,
`Category`, `MenuItem` schemas), pinning each to the exact name Prisma
used. The app now reads and writes the same collections the real data
already lives in.

**Not automated — needs a manual step on your end**: the stray
lowercase-plural collections (`users`, `restaurants`, `restaurantmembers`,
`categories`, `menuitems`) still exist in `mnu_dev` with whatever test
data landed in them before this fix. This session has no database
access, so nothing there was touched. Worth deciding what to do with
them — drop them if the data in them was just from testing, or migrate
any documents you care about into the correctly-named collections
before dropping.

### Checks
- `apps/api`: `npx tsc --noEmit` and `npx nest build` clean after adding
  the `collection` options.
- Not re-verified against the live database in this sandbox (no DB
  access here) — please confirm on your end that `/auth/me` and
  `/restaurants/:id/menu` now return your original data (2 restaurants,
  etc.) instead of empty results.

## End-to-end verification pass

Inspected `database/`, `auth/`, `menu/`, `users/`, `restaurants/`,
`restaurant-members/`, `apps/web/`, and this file, then attempted to
actually boot the API (not just typecheck it) against the real
`DATABASE_URL` in `apps/api/.env` (an Atlas cluster,
`cluster0.0gxalhd.mongodb.net`).

**No local MongoDB tooling exists in this sandbox**: no `docker`, no
`mongod`/`mongosh` binary, no `mongodb`/`mongodb-server` apt package
(dropped from Ubuntu 24 repos), and the sandbox's network egress list
doesn't include `mongodb.net` or any MongoDB binary CDN — same
limitation noted in every prior session's notes above. `docker-compose.yml`'s
local `mongo:7` service cannot be started here either (no `docker`).

**Found and fixed one real bug in the process** — one only an actual
boot can catch, not `tsc --noEmit`: `MenuItem.description` was declared
`@Prop({ default: null }) description: string | null`. `@nestjs/mongoose`
needs an explicit `type` when a prop's TS type is a union (it reflects
`string | null` as ambiguous) and throws `CannotDetermineTypeError` at
module-load time — the whole API failed to boot, before ever reaching
Mongo. Fixed with `@Prop({ type: String, default: null })`. Confirmed
via `npx ts-node src/main.ts` and `node dist/main.js`: both now start
cleanly, initialize `DatabaseModule`/`MongooseModule`, and correctly hang
attempting the Atlas connection (expected — that host isn't reachable
from this sandbox) rather than crashing. No other schema in the project
has a union-typed `@Prop`.

**Flows 1–10 verified by code review** (register, login, `/auth/me`,
membership loading, category create, item create, menu retrieval,
availability update, category delete w/ cascade, RBAC) — logic confirmed
sound in `AuthService`/`MenuService` for each, but none were exercised
against live data; that requires an environment with real Mongo access
(local or Atlas-reachable).

**Frontend**: `apps/web` — `npx tsc --noEmit` and `npm run build` both
clean, 6 routes present (`/`, `/dashboard`, `/login`, `/menu/demo`,
`/register`, `/restaurants/[restaurantId]/menu`), matching what the
backend flows above expect to call.

**No new features added** — Tables, QR generation, Orders, Payments,
Analytics, and AI were explicitly out of scope and untouched. No further
database migration performed.

## Day 7 — Table Management

First real operational feature beyond menu, following the exact pattern
`MenuService`/`MenuController` already established (same RBAC shape, same
controller/service structure, same frontend conventions).

**Reconciliation note**: a separately-uploaded package
(`mnu-day6-dashboard.zip`) turned out to already contain a working Table
Management implementation plus a full "Restaurant Admin Dashboard v1"
(sidebar layout, per-restaurant dashboard, Orders/Analytics/Settings
stub pages) — a sibling branch of this codebase, not derived from it.
Per this task's own "CURRENT STATUS" (which describes the dashboard as
already existing), that dashboard was ported in as a prerequisite,
**not built fresh** — it's additive UI with no backend dependency, so
nothing existing was touched. It was **not copied verbatim**, though:
that upload predates the two fixes already on this branch (see the two
entries above — Mongoose collection-name pinning, and the
`CannotDetermineTypeError` union-type crash) and does not have them, so
copying its backend schemas as-is would have reintroduced both bugs.
Only the pure-frontend dashboard files were ported (`layout.tsx`,
`restaurant-context.tsx`, `dashboard/orders/analytics/settings` pages) —
Table Management itself was rewritten fresh against this branch's
current schemas.

**One deliberate field-naming deviation from that upload**: its version
used `tableName` throughout; this task's spec explicitly asks for
`tableNumber`, so every layer (schema, service, controller, frontend
types, form fields) uses `tableNumber` instead.

**Backend** (`apps/api/src/tables/`):
- `Table` schema — `restaurantId` (ref, required), `tableNumber`
  (required, trimmed string — kept as a string rather than a number so
  restaurants can use names like "Patio 3" or "Bar 1", not just digits),
  `capacity` (required, min 1), `status` enum (`AVAILABLE` | `OCCUPIED` |
  `INACTIVE`, defaults to `AVAILABLE`), timestamps. Every `@Prop` has an
  explicit `type:`, deliberately — see the schema file's own comment for
  why (the exact pitfall that caused the `MenuItem.description` boot
  crash two entries up).
- No `collection:` override needed here (unlike `User`/`Restaurant`/
  `RestaurantMember`/`Category`/`MenuItem`): `Table` is a brand-new
  collection with no prior Prisma-era data to stay compatible with, so
  Mongoose's default (`tables`) is fine as-is.
- Indexes: `{ restaurantId: 1 }` for restaurant-scoped lookups, and a
  unique compound index on `{ restaurantId: 1, tableNumber: 1 }` so two
  tables at the same restaurant can't share a number.
- `TablesService` — same access-control shape as `MenuService`:
  `requireMembership` (any role) gates reads, `requireManager`
  (`SUPER_ADMIN`/`RESTAURANT_ADMIN` only) gates writes. Every lookup is
  scoped by `{ _id, restaurantId }` together, not `_id` alone — this is
  what actually enforces the multi-tenant boundary: a valid table id
  belonging to a different restaurant just 404s instead of leaking data,
  same mechanism as `MenuService.findCategoryOrThrow`/
  `findMenuItemOrThrow`. Duplicate table numbers return a clean 400
  (translated from Mongo's error code 11000) instead of a raw 500.
- `TablesController` — `GET/POST /restaurants/:restaurantId/tables`,
  `GET/PATCH/DELETE /restaurants/:restaurantId/tables/:tableId`, all
  behind `JwtAuthGuard`.
- Registered in `DatabaseModule` (schema) and `AppModule`
  (`TablesModule`), alongside `AuthModule`/`MenuModule`.

**Frontend** (`apps/web/app/restaurants/[restaurantId]/tables/page.tsx`):
- Real page — fetches `GET /auth/me` (to resolve the caller's role for
  this restaurant, same pattern as the menu page) and
  `GET /restaurants/:id/tables`. No dummy/mock data anywhere.
- Table cards showing number, capacity, and a color-coded status badge.
- Add/Edit/Delete, gated client-side by role — staff get a read-only
  view (no edit/delete affordances rendered at all), matching the
  server-side rule exactly.
- Loading state, empty state (distinct copy for staff vs. admin), error
  state, `confirm()` before delete, responsive grid (`grid-cols-1` on
  mobile, `sm:grid-cols-2` up).
- Form validation: table number required, capacity must be a positive
  number — checked both client-side (before the request fires) and
  server-side (real validation, not just a UI nicety).
- `lib/api.ts` gained a `tablesApi` export (`list`, `get`, `create`,
  `update`, `delete`) plus `TableRecord`/`TableInput`/`TableStatus`
  types, matching `menuApi`'s shape exactly.

**Dashboard navigation** (ported from the reconciliation above, then
verified against this branch): the sidebar in
`apps/web/app/restaurants/[restaurantId]/layout.tsx` already listed
"Tables" linking to `/restaurants/:id/tables` — that link now resolves
to a real page instead of a 404. The nested per-restaurant dashboard
(`.../dashboard/page.tsx`) shows a real table count (e.g. "2 tables
configured") sourced from `tablesApi.list()`, with a "Set up"/"Not set
up" badge — no invented numbers. The top-level restaurant-picker
dashboard (`apps/web/app/dashboard/page.tsx`) also gained a "Tables"
shortcut per membership, alongside the existing "Manage menu" link.

### Security / RBAC status
- **Authentication**: every table route sits behind the existing
  `JwtAuthGuard` — unchanged, reused as-is.
- **Multi-tenant isolation**: enforced server-side by scoping every
  single-table lookup to `{ _id: tableId, restaurantId }`, not `_id`
  alone. A valid table id from a different restaurant 404s rather than
  returning data or a generic 403 — it's indistinguishable from a
  nonexistent id, which is the correct behavior (doesn't confirm or deny
  that the table exists elsewhere).
- **Role split**: `RESTAURANT_ADMIN`/`SUPER_ADMIN` — full CRUD.
  `RESTAURANT_STAFF` — read-only (`listTables`/`getTable` only;
  `createTable`/`updateTable`/`deleteTable` all call `requireManager()`
  and throw `ForbiddenException` otherwise). Enforced server-side
  (the actual boundary) and mirrored client-side (`canManage` gates the
  Add/Edit/Delete UI) so a staff member never even sees controls that
  would be rejected anyway.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean, and a
  boot test (`node dist/main.js` against the real `.env` Atlas URL) —
  `TablesModule` initializes alongside every other module with no DI,
  config, or schema-reflection errors, then correctly hangs on the
  network-blocked Atlas connection (same behavior the working
  auth/menu code already has, not a new failure).
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean — 12
  routes total: the 6 pre-existing ones plus `tables`, `dashboard`,
  `orders`, `analytics`, `settings` (all under
  `/restaurants/[restaurantId]/`, all dynamic) and `_not-found`.
- Verified by code review (no live database in this sandbox — see
  below): RBAC role split, cross-restaurant 404 behavior, and that no
  file under `apps/api/src/auth/` or `apps/api/src/menu/` was modified
  by this session — only new files (`tables/`) plus strictly additive
  changes to `database.module.ts` and `app.module.ts` (one new
  import/registration line each).

### Known limitations
- **Not verified against a live MongoDB** — same sandbox limitation as
  every prior session (no network path to the Atlas cluster in `.env`,
  no way to run MongoDB locally here). Verified instead via clean
  typecheck/build, an actual boot attempt (see Checks above), and code
  review. Run `npm run dev` and exercise create/list/edit/delete through
  the UI — including as both an admin and a staff-role user, and across
  two different restaurants — on your machine or against Atlas to close
  this out.
- Table `status` is set manually via the edit form for now; nothing
  updates it automatically yet (that's implied by QR/customer sessions,
  explicitly out of scope for this task).
- No table-deletion safety check for "table currently has an active
  order" — moot right now since Orders doesn't exist yet.

Next task: not specified by this task — QR generation, customer
sessions, cart, orders, payments, analytics, and AI/personalization were
all explicitly listed as out of scope and were not started.

## Full project status audit

A complete, code-only audit against all 39 requested feature areas was
performed and saved to
[`docs/MNU_CURRENT_PROJECT_STATUS.md`](./MNU_CURRENT_PROJECT_STATUS.md).
No code was changed as part of this audit. See that document for the
full breakdown; summary: Foundation ~80%, Restaurant Management ~55%,
Customer Ordering ~2%, Operations/Analytics/MnU Intelligence/Advanced AI
all 0%, overall ~17%. Recommended next step: verify the existing system
end-to-end against a real, reachable MongoDB before building anything
new — every current ✅/🟡 rating still carries an unresolved "never run
against live data" caveat.

## Day 8 — Customer Table Session

First piece of the customer-facing product. Everything before this task
was admin-only (behind `JwtAuthGuard`); this is the first genuinely
public, unauthenticated surface in the project.

**Backend** (`apps/api/src/table-sessions/`):
- `TableSession` schema — `restaurantId`, `tableId`, `sessionId` (opaque
  public token via `crypto.randomUUID()`, distinct from Mongo's own
  `_id`), `status` (`ACTIVE`/`ENDED`), `startedAt`, `endedAt`. Explicit
  `type: Date` on the nullable `endedAt` — same precaution as
  `MenuItem.description`, avoiding the union-type boot crash documented
  earlier in this file.
- A partial unique index on `{ tableId: 1 }` (only among `ACTIVE`
  documents) enforces at most one active session per table at the
  database level, not just in application logic.
- `TableSessionsController` — deliberately **not** behind
  `JwtAuthGuard`, under `/public/restaurants/:restaurantId/tables/:tableId/session`:
  `POST` (start-or-retrieve, idempotent — a page refresh doesn't spawn a
  duplicate session; a race between two near-simultaneous scans is
  resolved by catching the unique-index violation and returning the
  winner's session instead of erroring), `GET` (retrieve only, 404 if
  none active), `PATCH .../end`.
- `TableSessionsService` validates the table belongs to the given
  restaurant by querying `{ _id: tableId, restaurantId }` together —
  same isolation mechanism `MenuService`/`TablesService` already use. A
  real table id belonging to a *different* restaurant 404s exactly like
  a nonexistent id would.
- No QR code generation exists yet (separate task) and `Table` has no QR
  token field — so for now, the `(restaurantId, tableId)` pair in the
  URL *is* the "QR identifier." A real QR image would just encode this
  same URL; nothing here needs to change when QR generation is built.
- Registered in `DatabaseModule` and `AppModule`, alongside
  `AuthModule`/`MenuModule`/`TablesModule`.

**Customer frontend** (`apps/web/app/scan/[restaurantId]/[tableId]/page.tsx`):
- Real page, no dummy data — calls `tableSessionApi.start()` on load
  (via a new `tableSessionApi` in `lib/api.ts`), shows the restaurant
  name, table number, and a status badge (green "active" / gray
  "ended"), plus a "View Menu" button.
- No auth check of any kind (unlike every other page in this project) —
  intentional, since customer login/registration is explicitly out of
  scope for this task.
- "View Menu" links to `/menu/demo` — the only customer-menu route that
  currently exists (still dummy data, per its own long-standing note in
  this file). This is intentional, not an oversight: connecting it to
  the real, restaurant-specific menu is this task's own stated "next
  task," not this one.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean, boot
  test (`node dist/main.js`) — `TableSessionsModule` initializes
  alongside every other module with no DI/schema errors, then correctly
  hangs on the network-blocked Atlas connection, same as every other
  module before it.
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean — 13
  routes total (12 from before + `/scan/[restaurantId]/[tableId]`).
- Confirmed by diff against the previous packaged deliverable
  (`mnu-day7-tables`) that no file under `apps/api/src/auth/`,
  `.../menu/`, `.../tables/`, `.../users/`, `.../restaurants/`, or
  `.../restaurant-members/` changed — only new files
  (`table-sessions/`) plus strictly additive changes to
  `database.module.ts` and `app.module.ts`.

### Known limitations
- **Not verified against a live MongoDB** — same sandbox limitation as
  every prior session (no reachable database here). The 5 required
  validations (session creation, retrieval, ending, invalid-id
  rejection, restaurant/table isolation) were verified by code review
  and the boot test above, not by actually issuing requests. Concretely
  worth doing on a machine with real DB access: start a session, refresh
  the page and confirm it's the *same* session (not a new one), end it,
  then reload and confirm a *new* session starts; and try a tableId that
  belongs to a different restaurant than the one in the URL to confirm
  the 404 isolation behavior.
- No rate limiting on the public session endpoints — anyone who can
  guess or enumerate a `(restaurantId, tableId)` pair can start a
  session. Low risk today (no cart/order data attached to a session yet)
  but worth revisiting once sessions carry anything sensitive.
- Sessions never expire automatically — an `ACTIVE` session stays active
  until explicitly ended via the `/end` endpoint (which nothing calls
  yet from the UI). A future task should probably add a "leave" action
  and/or a staleness timeout.
- `/menu/demo` is still dummy data, unconnected to any real restaurant —
  explicitly deferred to next task, not a bug in this one.

Next task: Connect the real MongoDB menu to the customer QR flow.

## Day 9 — Public Customer Menu

Replaced the hardcoded `/menu/demo` customer experience with a real,
restaurant-scoped menu backed by MongoDB — the exact "next task" this
file called out at the end of Day 8.

**Docs read first, per this task's instructions**: `docs/DATABASE.md`
and this file. `docs/PRODUCT.md` and `docs/ARCHITECTURE.md` were listed
in the task's read list but do not exist in this repository — noted
here rather than fabricated or silently skipped.

**Backend** — reused the existing `MenuService` rather than duplicating
it: added one new method, `getPublicMenu(restaurantId)`, alongside the
existing admin methods. It's deliberately a separate method from
`getMenu()`, not a shared code path with a flag — the access rule is
different (no membership check at all) and the returned shape is
intentionally smaller (no `isAvailable`/`sortOrder`/`categoryId` on
items, unavailable items and empty categories excluded server-side, not
filtered on the client). Exposed via a new, separate
`PublicMenuController` (`GET /public/restaurants/:restaurantId/menu`),
**not** behind `JwtAuthGuard` — kept as its own controller rather than a
guard exception added to the existing admin `MenuController`, so there's
no risk of an admin-only route accidentally losing its guard. Same
`/public/...` convention `TableSessionsController` established in Day 8.
`MenuModule` now registers both controllers.

**Multi-tenant isolation**: identical mechanism to every other read in
this project — `Category`/`MenuItem` queries are scoped by
`{ restaurantId }` directly against MongoDB (never "fetch everything,
filter client-side"), and a malformed or nonexistent `restaurantId`
hits the same `assertValidId()`/`NotFoundException` guard `MenuService`
already uses elsewhere, so it 404s cleanly instead of throwing a raw
Mongoose `CastError`.

**Frontend** — `apps/web/app/menu/[restaurantId]/page.tsx`: real page,
no dummy data, no cart/add-to-cart (explicitly out of scope for this
task). Fetches via a new `menuApi.getPublicMenu()` (added to the
existing `menuApi` export, not a new API client) on mount; shows
restaurant name, categories, item name/description/price. Loading,
empty (`categories.length === 0`), and error states all present.
`/menu/demo` is untouched — left in place as the dummy layout reference
it's always been, not deleted, since nothing in this task required
removing it.

**One small, directly-related connection made**: the Day 8 customer
scan page's "View Menu" button previously linked to `/menu/demo`
(the only customer-menu route that existed at the time, by design). Now
that the real route exists, that one link was updated to
`/menu/${restaurant.id}`. This is the exact connection Day 8's own
"next task" note called for — not new scope, just wiring two
already-planned pieces together.

### What was NOT done (explicitly out of scope, per this task)
QR code generation, QR tokens, table sessions changes beyond the one
link update above, customer accounts/login, cart, orders, payments,
analytics, and every menu-intelligence/AI feature — none were started.

### Checks
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean, boot
  test (`node dist/main.js`) — `MenuModule` (with both controllers)
  initializes with no DI/schema errors, then correctly hangs on the
  network-blocked Atlas connection, same as every other module.
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean — 14
  routes total (13 from before + `/menu/[restaurantId]`), coexisting
  cleanly alongside the static `/menu/demo`.
- Confirmed by diff against the previous packaged deliverable
  (`mnu-day8-table-session`) that every existing method in
  `MenuService` is byte-for-byte unchanged (only additive: one new
  import, one new constructor parameter, one new method appended), the
  admin `MenuController` is byte-for-byte identical, and no file under
  `apps/api/src/auth/`, `.../tables/`, `.../table-sessions/`,
  `.../users/`, `.../restaurants/`, `.../restaurant-members/`, or any
  existing frontend admin page changed at all.
- Test cases 1–6 from this task's spec (Restaurant A isolation,
  Restaurant B isolation, unavailable-item exclusion, empty-menu state,
  invalid-id handling, admin menu still working) were all verified by
  **code review** of the query logic and control flow above, and by the
  diff-confirmed non-changes to the admin path — not by issuing live
  requests.

### Live database limitation
**Live MongoDB read/write verification could not be performed in this
environment.** Same root cause as every prior session: no sandbox used
across this project's history has had network access to the Atlas
cluster in `apps/api/.env` or to any MongoDB instance. Code review,
typecheck, build, and a clean boot are not the same as live DB
verification, and are not being represented as such here. Concretely
worth doing on a machine with real DB access: seed two restaurants each
with a category and a couple of items (one marked unavailable), hit
`/public/restaurants/:idA/menu` and confirm only A's available items
come back, repeat for restaurant B, request a garbage/nonexistent id and
confirm a clean 404 (not a 500), and confirm `/restaurants/:id/menu`
(the authenticated admin endpoint) still requires a valid token and
still returns unavailable items too (unlike the public one).

Next task: not specified by this task — cart and orders were explicitly
listed as out of scope and were not started, even though the customer
menu now technically supports browsing.

## Day 10 — QR Generation + Table Connection

Connected the admin-side Tables screen to the customer-facing flow
already built in Days 8–9, via a real, scannable QR code. **No new
backend model was introduced** — per this task's own instruction to
reuse existing infrastructure wherever possible, the QR simply encodes a
link to the already-existing `/scan/[restaurantId]/[tableId]` page
(Day 8), which already identifies the restaurant and table and hands off
to the real customer menu (Day 9). This meant almost all of Day 10's
work was frontend-only.

### QR generation — done
A "Generate QR" button now appears on every table card in
`/restaurants/[restaurantId]/tables`, visible to both admins and staff
(it's read-only/non-destructive, unlike Edit/Delete which stay
admin-only). Clicking it opens a preview modal. The QR itself is
rendered client-side with the new `qrcode.react` dependency (the one new
library this task added — genuinely required, since no existing code
in this project can produce a QR image). Each table's QR encodes
`{origin}/scan/{restaurantId}/{tableId}` — the table's own existing
identifiers, no duplicate records, no QR token field on `Table`.

### QR preview — done
The modal shows: restaurant name, table number, the QR code image, the
full customer URL as text (for manual entry as a fallback), a Download
button, and a Print button.
- Download converts the rendered `<canvas>` to a PNG data URL via
  `canvas.toDataURL()` and triggers a browser download — no server
  round-trip, no image-generation endpoint needed.
- Print uses `window.print()` with a scoped `@media print` rule (only
  the modal's card is set `visibility: visible`, everything else
  `hidden`) — the admin doesn't leave the page or hit a popup blocker
  from a new tab.

### Customer QR route — done, reusing Day 8/9 as-is
Scanning the QR opens `/scan/[restaurantId]/[tableId]` exactly as it did
in Day 8 — that page's session-start logic, error handling, and
restaurant/table validation were already correct and were not touched.

### Restaurant/table identification — done, via existing mechanism
Unchanged from Day 8: `TableSessionsService.findTableOrThrow()` looks up
`{ _id: tableId, restaurantId }` together, so a table id that's real but
belongs to a different restaurant 404s exactly like a nonexistent one —
the customer is never shown another restaurant's data. No new
identification logic was needed for the QR itself, since the QR just
carries the same two ids this method already validates.

### Validation
- Invalid/malformed restaurant or table id → existing `assertValidId()`
  → clean 404 (unchanged from Day 8).
- Nonexistent table/restaurant → existing `NotFoundException` (unchanged
  from Day 8).
- **Inactive table → new, small fix.** Previously, `startSession()` had
  no status check at all — a customer could start a session at a table
  marked `INACTIVE`. Added one guard: `startSession()` now rejects with
  a clean 400 ("This table is currently inactive.") if the table's
  status is `INACTIVE`, before creating anything. Deliberately scoped to
  `startSession()` only — `getActiveSession()`/`endSession()` still work
  unchanged, so an existing session at a table that became inactive
  mid-visit can still be viewed/ended normally.
- Deleted table → already handled: `findTableOrThrow()`'s query simply
  finds nothing, same 404 path as an invalid id.
- Loading/error states → already present in the scan page (Day 8) and
  menu page (Day 9); nothing new required here.

### Connected to the Day 9 customer menu — minimal, additive change
The customer menu (`/menu/[restaurantId]`) now reads an optional
`?table=` query string parameter (via `useSearchParams`) purely for
display — "Menu · Table 12" next to the header. It is never sent to any
API or used for a lookup; opening the menu with no `table` param (e.g. a
bookmarked link) behaves exactly as it did in Day 9. The scan page's
existing "View Menu" link now appends `?table={tableNumber}` when
building that link. The public menu API and menu screen from Day 9 were
otherwise untouched.

### Files changed
- `apps/api/src/table-sessions/table-sessions.service.ts` — one status
  check added to `startSession()`.
- `apps/web/app/restaurants/[restaurantId]/tables/page.tsx` — "Generate
  QR" button + new `QrPreviewModal` component.
- `apps/web/app/scan/[restaurantId]/[tableId]/page.tsx` — "View Menu"
  link now carries `?table=`.
- `apps/web/app/menu/[restaurantId]/page.tsx` — reads `?table=` for
  display only.
- `apps/web/package.json` — added `qrcode.react` (the one new
  dependency this task introduced).

Nothing under `apps/api/src/auth/`, `.../menu/`, `.../users/`,
`.../restaurants/`, `.../restaurant-members/`, or any existing admin
page changed — confirmed by diff against the Day 9 packaged
deliverable.

### Tests / checks performed
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean, boot
  test (`node dist/main.js`) — clean start, no DI/schema errors, hangs
  on the expected network-blocked Atlas connection, same as every prior
  module.
- `apps/web`: `npx tsc --noEmit` clean, `npm run build` clean — same 14
  routes as Day 9 (no new routes added; QR lives in a modal on the
  existing Tables page), including the `/restaurants/[id]/tables` route
  now bundling the QR library (size increased from ~2.9 kB to ~9.5 kB,
  expected).
- QR URL generation, valid restaurant/table, invalid restaurant/table,
  and "customer menu opens from the QR route" were all verified by code
  review of the (unchanged) Day 8/9 logic the QR links into, plus the
  new inactive-table guard — not by scanning a real QR against a live
  server.

### Live database limitation
**Live MongoDB read/write verification could not be performed in this
environment.** Same root cause as every prior session — no sandbox used
across this project's history has had network access to the Atlas
cluster in `apps/api/.env`. Code review, typecheck, build, and a clean
boot are not the same as live verification. Concretely worth doing on a
machine with real DB access: generate a QR for a real table, scan it (or
open the encoded URL) on a phone, confirm it lands on the correct
restaurant's menu with the right table number shown, then mark that
table `INACTIVE` from the admin screen and confirm scanning the same QR
now shows the new "table is currently inactive" error instead of
starting a session.

### Known issues / remaining work
- The QR encodes an absolute URL built from `window.location.origin` at
  generation time. If the app is later served from a different domain
  (e.g. a custom customer-facing domain distinct from the admin app),
  previously-printed QR codes would need to be regenerated — there's no
  redirect/alias mechanism today.
- No QR token/rotation exists — the QR is just the table's own database
  id. If a table is deleted and a new one created, its QR is naturally
  invalidated (new id), but there's no way to invalidate a specific
  QR's link independent of deleting the table itself.
- Print output isn't a dedicated print layout (e.g. no fixed physical
  size for table tent cards) — it prints the on-screen preview card as-is
  via browser print styles, which is functional but not
  print-shop-polished.

Next task: not specified by this task. Cart, Orders, Payments, AI,
Analytics, Revenue Engine, Personalization, A/B Testing, and Mobile App
were all explicitly out of scope and were not started.

## Day 11 — Menu Item Details + Cart

Added the first ordering interaction: menu item → cart, entirely
client-side, no backend changes at all (order creation is a later task).

**What was completed**: item detail view, quantity selector, add-to-cart,
a cart screen with quantity controls/remove/subtotal, and a sticky
cart bar on the menu list. All wired together with the existing
restaurant/table context from Days 8–10.

**Frontend added**:
- `apps/web/lib/cart.ts` — a `useCart(restaurantId)` hook, cart stored in
  `localStorage` under `mnu_cart_<restaurantId>`. Keying by restaurant id
  is what guarantees cart data can't mix between restaurants — each
  restaurant's cart is a fully separate storage entry.
- `apps/web/app/menu/[restaurantId]/[itemId]/page.tsx` — item detail
  page. Reuses the existing `menuApi.getPublicMenu()` call (no new "get
  single item" endpoint) and finds the item client-side. Shows a
  placeholder image block (MenuItem has no image field yet — not added,
  out of scope), name, description, price, an "Available" badge,
  quantity +/-, and Add to Cart.
- `apps/web/app/menu/[restaurantId]/cart/page.tsx` — cart screen: line
  items with quantity controls and remove, subtotal, item count, empty
  state, "Continue Browsing," and a **disabled, unwired** "Place Order"
  button with "Ordering isn't available yet" — present because the task
  asked for a Place Order area "if appropriate," explicitly not
  functional.
- `apps/web/app/menu/[restaurantId]/page.tsx` — items are now links to
  their detail page; a sticky bottom bar shows item count + subtotal
  once the cart is non-empty, linking to the cart screen.

**Backend/API/model changes**: none. No new endpoint, no new schema —
this was achievable entirely by reusing the Day 9 public menu response.

**Availability handling**: the public menu endpoint already excludes
unavailable items entirely (Day 9), so an unavailable item never appears
in the list to click into. If a stale link is opened for an item that
has since become unavailable, the detail page treats "not found in the
current public response" and "unavailable" as the same case — clean
message, no Add to Cart button, nothing addable.

**Tests performed** (code review + build; no live backend — same
sandbox limitation as every prior session): menu → item → add → cart
count/subtotal update; quantity +/- in both the detail page and the
cart; remove-to-zero removes the line; empty-cart state; unavailable
item can't be added (via the mechanism above); table context (`?table=`)
threaded through every link across menu → item → cart. `tsc --noEmit`
and `next build` both clean — 16 routes total (13 pre-existing + item
detail + cart, both registering as dynamic; `cart`, a static segment,
coexists correctly alongside the dynamic `[itemId]` segment, same
pattern already proven by `/menu/demo` vs `/menu/[restaurantId]`).
Confirmed by diff against the Day 10 deliverable: zero changes anywhere
under `apps/api/`.

**Known issues**: no image field exists on `MenuItem`, so every item
detail page shows the same placeholder graphic; cart is device-local
only (no sync across devices/tabs, no server persistence — acceptable
since there's no order to attach it to yet); no cross-tab live update
(a cart change in one tab won't reflect in another open tab until that
tab navigates, since there's no `storage` event listener — low priority
given this is a single-customer, single-device flow).

**Remaining work**: order creation, payment, kitchen workflow — all
explicitly deferred.

Next task: not specified by this task — order processing was explicitly
out of scope and was not started.

## Day 11 fixes (from uploaded `mnu-day11-cart-fixed`)

Two bugs reported after live testing, both fixed in a separately-uploaded
package and adopted here as the new base before Day 12 work began:

1. **"Add to cart" not available from the menu list** — Day 11 originally
   only allowed adding to cart from the item detail page. Fixed: each
   row on `/menu/[restaurantId]` now has its own quick add/quantity
   control, no longer requiring a trip to the detail page.
2. **"A table with that number already exists" on genuinely new table
   numbers** — root cause: `mongoose.autoIndex` only ever *adds* missing
   indexes, it never drops a stale one. Across several days of iterative
   schema changes against the same live database, an earlier, differently-
   scoped index on `tableNumber` was apparently still sitting in MongoDB
   even though the schema in code had looked correct for a while. Fixed
   with `TablesService.onModuleInit()` calling `tableModel.syncIndexes()`
   on every boot, which reconciles actual MongoDB indexes with the
   current schema (drops stale ones, builds missing ones) — safe to run
   every time, a no-op once in sync.

Both fixes verified by this session via `tsc --noEmit`/build on both
apps before Day 12 work began; the underlying live-database symptom
itself (bug 2) obviously couldn't be re-confirmed without live access,
but the fix directly addresses the documented root cause.

## Day 12 — First Real Ordering Transaction

Cart → Order Review → Place Order → MongoDB `Order` → Restaurant Admin
Orders screen. No payment, no kitchen workflow — status is `NEW` only.

**Order schema** (`apps/api/src/orders/schemas/order.schema.ts`):
`restaurantId`, `tableId`, `tableSessionId`, `orderNumber` (short
customer/admin-facing id, not the same as Mongo's `_id`), `items[]`
(each a *snapshot*: `menuItemId`, `name`, `price`, `quantity`,
`lineTotal` — copied in at order time so a later menu rename/price
change never rewrites history), `subtotal`, `total`, `status` (`NEW`
only today), `createdAt`/`updatedAt`. One addition beyond the task's
literal minimum field list: `tableNumber` is also snapshotted onto the
order, for the same reason item name/price are — the admin list (Part 5)
needs to show a table number per row without an extra lookup per order.
Indexes: `{ restaurantId, createdAt: -1 }` (admin list, newest first),
`{ tableSessionId }`, `{ orderNumber }` unique.

**Order API**:
- `POST /public/restaurants/:restaurantId/orders` — no auth. Validates,
  in order: restaurant exists → table exists and belongs to that
  restaurant → an `ACTIVE` table session currently exists for that table
  (derived server-side via the existing `TableSession` model — the
  client never submits a session token, so there's nothing to trust
  there) → every submitted item id resolves to a real `MenuItem`
  belonging to *this* restaurant (an id that's real but scoped to
  another restaurant fails the same count check as a fake id, so a
  cross-restaurant item can't be ordered) → every matched item is
  currently `isAvailable`. **Price and total are never read from the
  request body at all** — `OrderItemInput` only has `itemId`/`quantity`;
  every price is read fresh from the matched `MenuItem` document and
  used to compute `lineTotal`/`subtotal`/`total` server-side. All
  validation failures return a clean `BadRequestException`/
  `NotFoundException`, not a raw 500.
- `GET /restaurants/:restaurantId/orders` and
  `GET /restaurants/:restaurantId/orders/:orderId` — behind the existing
  `JwtAuthGuard`, scoped by restaurant membership (any role — there's no
  write action on this screen yet to restrict to managers only). Order
  lookup is scoped by `{ _id, restaurantId }` together, so a real order
  id from a different restaurant 404s exactly like a nonexistent one —
  same isolation mechanism as every other restaurant-scoped read in this
  project.

**Missing dependency identified and closed**: placing a real order needs
the table's actual database id, not just the human-readable table
number the customer flow carried before today. `?table=` (Day 10) was
always display-only; a new `?tableId=` query param now rides alongside
it from `/scan` all the way through menu → item → cart → review. This
was the one genuinely-new piece of frontend plumbing Day 12 required.

**Customer screens**:
- `/menu/[restaurantId]/cart` — "Review Order" now links to a real
  screen (previously a permanently-disabled "Place Order" placeholder),
  but only once `tableId` is present; otherwise it stays disabled with
  "Scan the table QR code to order."
- `/menu/[restaurantId]/review` — one component, two states. **Review**:
  restaurant name, table number, line items, subtotal, total, "Place
  Order" (loading + inline error states on submit failure — cart is
  *not* cleared on error, so the customer can retry). **Confirmation**
  (after a successful `POST`): order number, table, status (`NEW`),
  total, a plain confirmation message, "Back to Menu." Cart is cleared
  only after a confirmed success.

**Admin screens**:
- `/restaurants/[restaurantId]/orders` — replaces the Day 6 "Coming
  soon" stub with a real list (order number, table, item count, time,
  total, status), reusing `useRestaurantContext()` for the same access
  check every other restaurant page already uses. Loading/empty/error
  states.
- `/restaurants/[restaurantId]/orders/[orderId]` — new detail view (full
  line items, subtotal, total, status, timestamp).
- Two small, directly-related fixes made in the same file I was already
  touching for the dashboard's order count: the "Generate QR codes" and
  "Start accepting orders" checklist items had said "Coming soon" since
  before either was true — QR generation (Day 10) and now ordering (Day
  12) both exist, so both are now real, clickable, and marked done based
  on actual data instead of hardcoded `false`.

**Authentication/RBAC used**: entirely reused — `JwtAuthGuard` on the
admin routes, `useRestaurantContext()` on the admin pages, no new auth
mechanism. The public order endpoint intentionally has none, matching
`PublicMenuController`/`TableSessionsController`'s existing convention.

**Validation/security**: restaurant/table/session/item/availability/
quantity all validated server-side, in the order listed above; price and
total are computed exclusively from MongoDB. No new libraries, no
backend rewrite of Menu/Tables/Auth — `OrdersService` is new, standalone,
and reuses the existing models via `@InjectModel`.

### Tests performed
`apps/api`: `tsc --noEmit` clean, `nest build` clean, boot test
(`node dist/main.js`) — `OrdersModule` initializes with no DI/schema
errors, correctly hangs on the network-blocked Atlas connection like
every other module. `apps/web`: `tsc --noEmit` clean, `next build`
clean — 18 routes total. Confirmed by diff against the Day 11 baseline
that `apps/api/src/auth/`, `.../menu/`, `.../tables/`, `.../users/`,
`.../restaurants/`, `.../restaurant-members/` are all byte-for-byte
unchanged; only `orders/` (new) plus two-line additive changes to
`app.module.ts`/`database.module.ts`.

The required code-level test cases (valid order; empty cart; invalid
restaurant; invalid table; table belonging to another restaurant;
inactive/no session; unavailable item; item from another restaurant;
incorrect client-side price/total — moot, since price/total are never
read from the client at all; Restaurant A cannot access Restaurant B's
orders; successful confirmation) were all verified by **code review** of
the validation chain in `OrdersService.createOrder()` above — not by
issuing live requests.

**Live MongoDB read/write verification was NOT performed in this
environment.** Same root cause as every prior session: no sandbox used
across this project's history has had network access to the Atlas
cluster in `apps/api/.env`. A clean typecheck, build, and boot are not a
substitute for that, and are not being represented as such here.

### Known issues
- Refreshing the confirmation view loses it (cart's already cleared by
  then) — there's no `GET order by id` on the public side, only admin.
  Acceptable for today's scope; would need a small public read endpoint
  if persistent confirmation-page-reload becomes a requirement.
- No image field on `MenuItem` still (unchanged from Day 11) — order
  review/confirmation/admin views show text only, no photos.
- No order status beyond `NEW` — nothing marks an order
  confirmed/preparing/served yet; that's explicitly the next task.
- Admin orders list has no pagination — fine at current scale, would
  need one before a restaurant accumulates hundreds of orders.

### Remaining work
Full order-status workflow (CONFIRMED → PREPARING → READY → SERVED →
COMPLETED), kitchen display, payment, and everything under Analytics/
MnU Intelligence — all explicitly out of scope for Day 12 and untouched.

Next task: kitchen/order-operations — the status workflow beyond `NEW`,
which this task explicitly deferred.

## Day 13 — Customer QR Menu UI Redesign

UI/UX-only redesign of the customer-facing menu (`/menu/[restaurantId]`
and `/menu/[restaurantId]/[itemId]`). **No backend changes, no new
endpoints, no schema changes** — this session reused `menuApi.getPublicMenu()`
(Day 9) and `useCart()` (Day 11) exactly as they were; category, search,
and active-tab logic are all computed client-side over the already-fetched
response.

**Docs/code read first, per this task's instructions**: this file, the
existing `/menu/[restaurantId]` and `/menu/[restaurantId]/[itemId]` pages,
`lib/api.ts`, `lib/cart.ts`, and `app/globals.css` (the existing design
tokens — brand/ink/cream/success/danger — reused throughout, no new
palette introduced).

### Header
New `MenuHeader` component: an initial-letter avatar in place of a
restaurant logo (`Restaurant` has no logo field in the schema — not
fabricated), restaurant name, table number (from the existing `?table=`
param), a search toggle, and a cart icon with a live item-count badge.
Tapping search swaps the header content for a focused search input
in place, rather than opening a new screen.

### Category navigation
New `CategoryTabs` component: a horizontal, sticky "All | <real
categories>" bar built entirely from `menu.categories` — never
hard-coded. Tapping a tab scrolls to that section; scroll position is
also fed back into which tab is highlighted via an `IntersectionObserver`
(scrollspy), so the nav stays accurate whether the customer taps or
scrolls. Hidden automatically while a search query is active, since
results collapse into one filtered list at that point.

### Menu item cards
New `MenuItemCard` component: a deterministic placeholder image
(icon + tone derived from the item's id, via new `foodVisual.ts`) stands
in for a real photo — `MenuItem` has no image field yet (known limitation
since Day 11), so nothing was fabricated. Name, one-line-clamped
description, price, an "Available" indicator, and an Add button /
quantity stepper are all shown per card without needing the detail
screen. Responsive grid: 1 column on mobile, 2 on tablet, 3 on desktop.

### Item details
`[itemId]/page.tsx` restyled to match: the same placeholder visual, large,
plus name, description, price, an "Available" badge, quantity stepper,
and Add to Cart. Cart logic itself is completely unchanged — reuses
`useCart().addItem()` exactly as before.

### Sticky cart
New `StickyCartBar` component: "N items · ₹total" / "View Cart →", fixed
to the bottom, only rendered once the cart is non-empty. The page reserves
matching bottom padding so it never overlaps the last row of items.

### Mobile-first / responsive
Built mobile-first (single column, touch-sized 36px+ tap targets, sticky
header + nav), then widened progressively: `sm:` for tablet (2-column
grid), `lg:` for desktop (3-column grid, wider max content width).
Verified at 375px, 768px, and 1280px viewport widths (see Tests below).

### UX states
- **Loading** — new `MenuSkeleton`: pulsing header/tabs/card placeholders
  instead of a bare "Loading..." line.
- **Empty menu** (`menu.categories.length === 0`) — new `EmptyMenuState`.
- **Empty category / no search results** — new `EmptySearchState`, shown
  when a search query matches nothing; a true "empty category" can't
  occur from the API itself (empty categories are already excluded
  server-side, Day 9), so this state is reachable only via search.
- **Image loading/fallback** — moot for now given no image field exists;
  the deterministic placeholder *is* the fallback, always present, never
  a broken-image icon. Documented as the thing to replace once an image
  field is added.
- **Unavailable item** — the public endpoint already excludes unavailable
  items entirely (Day 9), so none can appear in the grid; the item-detail
  page's existing "not found" state (unchanged) already covers a stale
  link to an item that became unavailable after the fact.
- **API error** — new `MenuErrorState`, with a "Try again" button that
  re-triggers the fetch (no navigation needed to retry).

### Components changed/added
- `apps/web/app/menu/[restaurantId]/page.tsx` — rewritten.
- `apps/web/app/menu/[restaurantId]/[itemId]/page.tsx` — rewritten.
- `apps/web/app/menu/[restaurantId]/_components/` — new: `MenuHeader.tsx`,
  `CategoryTabs.tsx`, `MenuItemCard.tsx`, `StickyCartBar.tsx`,
  `MenuStates.tsx`, `icons.tsx`, `foodVisual.ts`.
- No changes to `lib/api.ts`, `lib/cart.ts`, `app/globals.css`, any admin
  page, or anything under `apps/api/` — confirmed by diff (only the
  files listed above are new/modified).

### Tests performed
- `apps/web`: `npx tsc --noEmit` clean.
- `apps/web`: `npm run build` clean — same 18 routes as the Day 12
  baseline, no new routes added (`/menu/[restaurantId]` grew from 3.5 kB
  to 5.25 kB page size from the new components, expected).
- `next start` boot test: `GET /menu/:id` returns `200` and the
  server-rendered HTML contains the new loading-skeleton markup,
  confirming the page renders correctly server-side even with no
  reachable backend in this sandbox.
- Category navigation, item details, Add to Cart, sticky cart, loading,
  empty, and error states were all verified by code review of the
  logic above (scrollspy, filtering, retry handler) and the build/boot
  checks — **not** against live MongoDB data, since no sandbox in this
  project's history has had network access to the Atlas cluster. Desktop
  (1280px), tablet (768px), and mobile (375px) layouts were verified via
  the responsive Tailwind classes (`grid-cols-1 sm:grid-cols-2
  lg:grid-cols-3`, sticky header offsets) — not a live-browser resize
  test with an actual data-backed page, since that also requires a
  reachable database.

**Customer authentication is intentionally deferred to Day 14.**

### Known issues / remaining UI work
- No real food photography — every card/detail view uses a deterministic
  icon+tone placeholder until `MenuItem` gains an image field.
- No restaurant logo — an initial-letter avatar stands in until
  `Restaurant` gains a logo field.
- Search is client-side only, scoped to the items already returned by
  the public menu response (name + description substring match) — fine
  at today's scale, would need a server-side search endpoint if a
  restaurant's menu grows very large.
- Not yet exercised against live data/a live server in a browser — same
  sandbox limitation noted in every prior session.

Next task recommendation: **Mobile + Email customer authentication.**

## Day 14 — Customer Home Page + Mobile-First Menu + Git Protection

Frontend-focused, as instructed. Small, additive backend changes only
where a section genuinely needed real (not fabricated) data that wasn't
exposed yet — no new schema fields, no new collections, no rewrite of
Day 9/11/12/13 logic.

**Docs/code read first**: this file in full, `/menu/[restaurantId]`,
`/menu/[restaurantId]/[itemId]`, `/menu/[restaurantId]/cart`,
`/menu/[restaurantId]/review`, `lib/api.ts`, `lib/cart.ts`,
`app/globals.css`, `/scan/[restaurantId]/[tableId]`, and the existing
`.gitignore`.

### Part 1 — Customer Home page (new)
`/menu/[restaurantId]/home` — the new first stop: QR → **Home** → Menu →
Item → Cart. Built entirely from `menuApi.getPublicMenu()` (Day 9) and a
new `ordersApi.getPopular()` call; no fake menu data anywhere.

- **Featured** — `MenuItem` has no `isFeatured` field and none was
  added today (per the task's explicit "don't build a complex backend
  system" instruction for this section). Uses the restaurant's own real,
  existing signal instead: the first item of each category in the
  admin's own `sortOrder` (the public menu API already returns items
  pre-sorted — Day 9). Documented in code as a stand-in, not a claim of
  editorial curation. **Dependency for a real version**: add an
  `isFeatured: boolean` to `MenuItem` (mirrors `isAvailable`) plus an
  admin toggle — small, but deliberately not done today since the task
  called it out as backend scope to avoid.
- **New Arrivals** — real data, sorted newest-first. Required one
  one-line backend addition: `MenuItem.createdAt` has always existed
  (`{ timestamps: true }`, since Day 3-era schemas) but was never
  exposed on the public menu endpoint. `menu.service.ts`'s
  `getPublicMenu()` now includes it per item; `MenuItem` schema gained
  an explicit `createdAt`/`updatedAt` class-field declaration (same
  pattern `Order` already used) purely so TypeScript knows they exist on
  a lean-queried document.
- **Popular** — real order history, not a fabricated field. New
  `OrdersService.getPopularItems()`: aggregates actual `Order` documents
  (`$unwind` items, `$group` by `menuItemId` summing quantity, `$sort`
  desc), joined against currently-available `MenuItem`s so a
  since-deleted or 86'd item never shows as "popular." Exposed via new
  `GET /public/restaurants/:restaurantId/orders/popular` (no auth, same
  convention as the rest of `PublicOrdersController`). **If a restaurant
  has no orders yet, this returns `[]` and the Home page hides the
  section entirely** — never padded with placeholder data, per the
  task's explicit instruction.
- **Categories** — from `menu.categories` only, shown as a tappable
  grid; tapping one links to `/menu/[restaurantId]#category-<id>`. The
  full menu page gained a small scroll-to-hash effect so this actually
  lands on the right section rather than just the top of the page.
- **Other Suggestions** — deliberately not added. Four real sections
  were already enough content; a fifth invented category would have
  worked against "keep the UI sophisticated and uncluttered."

### Part 2/4/5/6 — Mobile-first review of existing screens
Day 13 already did most of this well (mobile-first grid, sticky
header/cart bar, skeleton/empty/error states). Concrete gaps closed
today:
- **Touch targets**: quantity +/− buttons were 24px (`h-6 w-6`) in
  `MenuItemCard`, the item detail page, and the cart page — bumped to
  28-36px (`h-7`–`h-9`) everywhere, matching what Day 13's own notes had
  claimed but the code hadn't actually shipped.
- **Cart page rebuilt**: previously had no header at all and its
  Subtotal/"Review Order" sat wherever they fell in a scrolling list —
  Part 6 explicitly asks for the total and checkout action to be
  "clearly visible." Added a sticky top header (back-to-Menu, "Home"
  link, table number) and a sticky bottom checkout bar (item count,
  subtotal, Review Order / disabled state), mirroring the Menu page's
  existing `StickyCartBar` pattern. The scrollable item list reserves
  matching bottom padding so nothing sits underneath either fixed bar.
- **Menu page header**: gained an optional `homeHref` back-chevron (only
  rendered when passed — the menu page is the only current caller and
  passes it), answering "how do I get back to Home."
- **Review page**: gained a small "← Cart" back link for the same
  reason; its remaining links to Menu were unified onto the same
  `contextQuery` helper every other customer page already used, instead
  of ad hoc `?table=...&tableId=...` string-building.
- Item detail, menu cards, and the review screen were otherwise left
  alone — already responsive and already reusing `useCart()` correctly;
  Part 5/6 say "only improve if needed," and there was nothing broken
  there beyond the touch-target sizing above.

### Part 3 — Customer navigation
Chose a **consistent header pattern with back-navigation**, not a
second fixed bottom tab bar — a Home/Menu/Cart bottom bar would have
visually stacked with the Menu page's existing sticky "View Cart" bar
and the new Cart page's sticky checkout bar, working against "keep the
UI uncluttered." Instead: Home's header always has a cart icon (→ Cart
reachable in one tap from Home); Menu's header now has a back chevron
to Home; Cart's new header has both a back-to-Menu chevron and a "Home"
link. From any of the three, the other two are one tap away, and each
header visibly names where you are.

### Part 7 — Loading / empty / error / fallback states (Home)
New `HomeSkeleton`, `HomeErrorState` (with retry), `HomeEmptyState` (zero
categories) — same visual language as Day 13's `MenuStates.tsx`. Image
fallback and unavailable-item handling are inherited by construction,
not newly built: `foodVisual`'s placeholder is used for every Home card
exactly as it is on the Menu page (no image field exists yet, same
documented limitation), and the public menu endpoint already excludes
unavailable items entirely (Day 9), so none can appear in Featured/New
Arrivals; Popular independently re-checks `isAvailable` in the
aggregation join for the same reason.

### Part 8 — `.gitignore` and secrets check
`.gitignore` existed but was thin (`node_modules/`, `dist/`, `.next/`,
`.turbo/`, `.env`, `.env.local`, `*.log`). Rewritten to also cover:
`.env.*.local`/`.env.development`/`.env.production`/`.env.test` (root
and per-app), `out/`/`build/` and per-app build dirs, `coverage/`,
TypeScript `*.tsbuildinfo`, `next-env.d.ts`, npm/yarn/pnpm debug logs,
`.vscode/*`/`.idea/`, OS files (`.DS_Store`, `Thumbs.db`,
`desktop.ini`), temp files/dirs, and the local Mongo data volume
(`mnu_mongo_data/`, from `docker-compose.yml`). `.env.example` files
(placeholder values, meant to be committed) are explicitly kept, not
ignored.

**Secrets check — two findings to flag directly:**
1. **This sandbox has no `.git` directory at all** (confirmed: no
   `mnu-day12-orders/.git`). Git was never initialized here, in this
   session or any prior one in this project's history, so I could not
   run `git ls-files` / `git log` to check whether an env file is
   *already tracked* in your actual repository. That check needs to
   happen in your real local/CI environment: `git ls-files | grep
   '\.env$'` (should return nothing), and if either `apps/api/.env` or
   `apps/web/.env` shows up, `git rm --cached <path>` — adding a
   pattern to `.gitignore` does **not** untrack a file already
   committed.
2. **`apps/api/.env` currently holds what appears to be a real,
   non-placeholder value** — a MongoDB Atlas connection string with
   embedded credentials, and a JWT signing secret — not the
   documentation-style placeholder in `.env.example`. No values are
   reproduced here. If check #1 turns up this file as tracked, or if
   it's ever been pushed to a remote at any point in this project's
   history, treat that Atlas password and JWT secret as compromised:
   rotate both before relying on this app anywhere beyond a local
   sandbox.

### Components changed/added
- New: `apps/web/app/menu/[restaurantId]/home/page.tsx` and
  `home/_components/{HomeHeader,HomeSection,HomeItemCard,CategoryGrid,HomeStates}.tsx`.
- Modified: `apps/web/app/scan/[restaurantId]/[tableId]/page.tsx` (links
  to Home, not straight to the menu list); `.../menu/[restaurantId]/page.tsx`
  (homeHref prop, scroll-to-category-hash effect); `.../_components/MenuHeader.tsx`
  (optional `homeHref`); `.../_components/MenuItemCard.tsx` (touch
  targets); `.../[itemId]/page.tsx` (touch targets); `.../cart/page.tsx`
  (rebuilt: header + sticky checkout bar); `.../review/page.tsx` (back
  link, unified `contextQuery`).
- Backend: `apps/api/src/menu/menu.service.ts` (`createdAt` on public
  items), `apps/api/src/menu/schemas/menu-item.schema.ts`
  (`createdAt`/`updatedAt` class fields), `apps/api/src/orders/orders.service.ts`
  (`getPopularItems()`), `apps/api/src/orders/public-orders.controller.ts`
  (`GET .../orders/popular`).
- `.gitignore` rewritten (see Part 8).
- No changes to `apps/api/src/auth/`, `.../tables/`, `.../table-sessions/`,
  `.../users/`, `.../restaurants/`, `.../restaurant-members/`, or any
  admin frontend page.

### Tests performed
- `apps/web`: `npx tsc --noEmit` clean.
- `apps/web`: `npm run build` clean — **19 routes** (18 from the Day 13
  baseline + new `/menu/[restaurantId]/home`), all other route sizes
  essentially unchanged.
- `apps/api`: `npx tsc --noEmit` clean, `npx nest build` clean, boot test
  (`node dist/main.js`) — starts, initializes `DatabaseModule`/
  `MongooseModule`, then blocks on the network-blocked Atlas connection
  exactly like every prior day's boot test; no DI/schema error before
  that point (a schema bug would have thrown at import time, before
  Nest even logs "Starting Nest application").
- Featured/New Arrivals/Categories logic, the popular-items aggregation
  pipeline, the scroll-to-hash effect, the sticky-bar layout math, and
  all loading/empty/error states were verified by **code review** and
  the build/boot checks above — mobile (375px)/tablet (768px)/desktop
  (1280px) layouts were verified via the responsive Tailwind classes
  used (`grid-cols-3 sm:grid-cols-4 lg:grid-cols-6` for categories,
  `w-36 sm:w-40` carousel cards, sticky offsets), not a live-browser
  resize test against real data.

**Live MongoDB read/write verification was NOT performed.** Same root
cause as every prior session: no sandbox in this project's history has
had network access to the Atlas cluster in `apps/api/.env`. This
includes the new `getPopularItems()` aggregation — its query logic was
verified by code review only, never run against real `Order` documents.

**Customer mobile/email authentication remains deferred to the next
authentication task**, as instructed.

### Data dependencies identified for future work
- **Featured**: needs a real `isFeatured: boolean` on `MenuItem` (plus
  an admin toggle) to stop relying on `sortOrder` as a stand-in.
- **Popular**: works today from real `Order` data, but will only show
  anything once orders start accumulating in a live database — currently
  untested against real order volume. A later Revenue Engine/analytics
  task could replace or augment this with recency-weighted or
  time-windowed popularity (e.g. "popular this week") rather than
  all-time totals.
- **Recommendations/personalization**: explicitly out of scope today and
  not approximated with any proxy — no per-customer data exists to base
  it on (no accounts yet).
- **Images**: `MenuItem`/`Restaurant` still have no image/logo fields
  (known since Day 11/13) — the Home page's cards use the same
  `foodVisual` placeholder as the Menu page for this reason.

### Known issues / remaining UI work
- Popular section is untested against real order volume (see above).
- Search (Day 13, client-side only) is unchanged and not present on the
  Home page — only on the full Menu list, as before.
- No `.git` repository exists in any sandbox this project has run in;
  the tracked-file/secrets check in Part 8 needs to be run against the
  actual project repository, not this environment.
- Not yet exercised against live data/a live server in a browser — same
  sandbox limitation noted in every prior session.

### Remaining work
Customer mobile/email authentication (explicitly deferred, per this
task and Day 13's recommendation); real `isFeatured` field + admin
toggle; order-status workflow beyond `NEW`; payment; kitchen display;
Analytics/Revenue Engine.

Next task recommendation: **Mobile + Email customer authentication** —
unchanged from Day 13's recommendation; today intentionally deferred it
again per this task's explicit scope limit.

## Day 15 — Menu Item Images (single image per item)

**Implemented**: admin can add/replace/remove one image per menu item;
image displays on the customer menu grid, item detail page, and Home
page carousels, with a proper fallback everywhere else.

**Image storage approach**: no cloud storage existed in the project, so
this uses the simplest thing that fits — uploaded files are written to
local disk at `apps/api/uploads/menu-items/` and served back via
`@nestjs/platform-express`'s built-in `useStaticAssets()` (`main.ts`),
already-available infrastructure, no new provider/package beyond
`multer` (which was already a transitive dependency). `MenuItem` stores
only `imageUrl: string | null` — a path like
`/uploads/menu-items/<uuid>.jpg`, no other metadata. Uploading always
replaces the previous file (old file deleted); "remove" clears the
field and deletes the file. Swapping to S3/Cloudinary later only
touches `MenuService`'s two image methods and `main.ts`.

**Backend changes**: `MenuItem` schema (+`imageUrl`); `MenuService`
(+`uploadItemImage`, `removeItemImage`, `imageUrl` added to all three
serializers — admin `getMenu`, public `getPublicMenu`, and Day 14's
popular-items result); `MenuController` (+`POST`/`DELETE
.../menu-items/:itemId/image`, manager-only, multipart via
`FileInterceptor`+`memoryStorage`); `main.ts` (`NestExpressApplication`
+ `useStaticAssets`); `package.json` (+`multer`, `+@types/multer`);
`.gitignore` (+`apps/api/uploads/` — runtime data, not source).
Validation: JPEG/PNG/WebP only, 5MB max, clean `BadRequestException`
either way (no server errors).

**Frontend changes**: `lib/api.ts` (+`imageUrl` on the three item
types, `+resolveImageUrl()`, `+requestFormData()` for multipart,
`+menuApi.uploadItemImage/removeItemImage`); new shared `ItemImage.tsx`
(real photo with `object-cover` + consistent aspect ratio, falls back to
the existing icon placeholder on missing OR failed-to-load images);
wired into `MenuItemCard`, the item detail page, and Home's
`HomeItemCard`. Admin `restaurants/[restaurantId]/menu` page: `AddItemForm`
gained an optional photo picker + preview (uploads right after
creation succeeds); `EditItemForm` gained preview/replace/remove
(remove is immediate with a confirm prompt, not deferred to Save); the
item row list gained a small thumbnail.

**Tests performed**:
- `apps/web`: `tsc --noEmit` clean; `next build` clean (19 routes,
  unchanged route count/shapes).
- `apps/api`: `tsc --noEmit` clean; `nest build` clean; boot test
  (`node dist/main.js`) starts and reaches `MongooseModule` init with no
  DI/schema error before blocking on the (network-blocked) Atlas
  connection, same as every prior day.
- Upload validation + disk-write logic (mimetype allow-list, 5MB limit,
  actual file write/read-back) verified with a standalone Node script
  mirroring `MenuService`'s exact logic — confirmed: valid PNG writes
  and is readable back, a PDF is rejected with a clean message, a >5MB
  file is rejected with a clean message. Cleaned up before packaging.
- Everything touching MongoDB itself (create/edit item with image,
  replace, remove, an item created before this change still serializing
  with `imageUrl: null`, and the customer menu actually rendering a
  real photo end-to-end) was verified by **code review only** — no live
  database access in this sandbox, same limitation as every prior
  session. **Live database/browser verification was NOT performed.**

**Known issues**:
- Uploaded files live on local disk — fine for one sandbox/single
  instance, but won't survive a redeploy or work across multiple API
  instances. Documented in code as the reason to swap to real object
  storage before production.
- No image is ever optimized/resized server-side; a customer's phone
  downloads whatever the admin uploaded (up to 5MB). Acceptable for this
  stage per "don't over-engineer," but a candidate for a later pass.
- Not exercised against live data in a browser — see Tests above.

**Recommended next task**: Mobile + Email customer authentication
(carried over again — still the standing recommendation since Day 13,
deferred each time by that day's own explicit scope limit).

## Day 16 — Customer QR Menu UI Refresh (app-like ordering experience)

UI/UX only, as instructed — no backend changes, no new endpoints, no
schema changes. No reference image was actually attached to this task's
message, so this was built from the written UX principles (app-like
browsing, bottom nav, food-focused cards) directly, not by copying any
specific product's screens.

**UI changes**:
- **New persistent bottom navigation** (Home | Menu | Search | Cart) —
  the main ask today. One shared `CustomerBottomNav` on Home, Menu, and
  Cart, active-tab highlighted per screen. "Search" isn't a new page —
  it links back to the Menu route with `?openSearch=1`, which the Menu
  page reads on load to open its existing (Day 13) search UI; no
  duplicate fetch or search logic.
- Retired the old standalone `StickyCartBar` — its "N items · subtotal
  · View Cart" strip is now folded into the top of `CustomerBottomNav`
  itself (shown above the tab row whenever the cart has items and the
  customer isn't already on the Cart screen), so each page has exactly
  one fixed bottom element, not two competing ones.
- Cart page: kept its own sticky checkout bar (subtotal + Review Order)
  but moved it to sit just above the new bottom nav, so both are
  visible and neither overlaps the item list.
- Home page: removed the old sticky/blurred header in favor of a
  larger, static "entrance" header — restaurant initial avatar, name,
  and a real, computed stat line ("`N` categories · `M` items", plus
  table number) instead of just the name. No fabricated restaurant
  info — `Restaurant` only has a `name` field today (checked the
  schema), so this is the most substantive "restaurant information"
  section that real data supports.
- Menu page: header simplified (dropped the Day 14 back-to-Home
  chevron — the bottom nav's Home tab now covers that, so having both
  was redundant); menu item image bumped from 80/96px to 96/112px
  (`h-24/h-28`) for more "food-focused" visual weight, still
  `object-cover` via the existing shared `ItemImage` component so
  nothing stretches/distorts.
- Desktop/tablet: the bottom nav (and its cart strip) center and round
  off within the same `max-w-5xl` column every other screen already
  uses, rather than spanning the full browser width — keeps it reading
  as an app surface floating in the page, not a corporate site's footer
  bar. No other desktop-specific layout changes were needed; the
  existing `max-w-5xl`/responsive grid from Day 13-14 already avoided a
  "normal website" feel.

**Components changed**: new `CustomerBottomNav.tsx` (+ two new icons,
`HomeNavIcon`/`MenuNavIcon`, in `icons.tsx`); removed
`StickyCartBar.tsx`; edited `menu/[restaurantId]/page.tsx` (bottom nav,
`openSearch` param, dropped `homeHref`), `home/page.tsx` (bottom nav,
real stat computation), `home/_components/HomeHeader.tsx` (restaurant
info line, non-sticky), `cart/page.tsx` (bottom nav + repositioned
checkout bar), `_components/MenuItemCard.tsx` and `MenuStates.tsx`
(image size). Item detail and Review pages were left as-is — still
focused, single-purpose screens with their own back link, consistent
with Day 14's reasoning for not giving every screen the full nav chrome.

**Tests performed**:
- `apps/web`: `tsc --noEmit` clean; `next build` clean — same 19
  routes, no size regressions.
- Layout/overflow, category navigation, Add to Cart, cart access, and
  the existing QR/table-context query-string plumbing were checked by
  **code review** (every href threads `contextQuery` exactly as before;
  nothing about the table/session flow was touched) — not a live
  browser resize/interaction test. No backend or database is involved
  in this task, so there's no live-DB caveat to add here, but there's
  still no live-browser verification in this sandbox.

**Known issues**:
- The bottom nav's "Search" tab relies on an initial-render check of
  `?openSearch=1`; once the customer closes search, the URL still
  carries that param until they navigate again — cosmetically harmless
  (it's a one-time trigger, not re-read on every render) but worth a
  cleanup pass later (e.g., replacing the URL without the param once
  search opens).
- `HomeSkeleton`'s placeholder header height wasn't updated to match
  the new, taller Home header — a very brief visual mismatch during the
  loading flash only.
- Not exercised in a live browser at real breakpoints — see Tests above.

**Recommended next task**: Mobile + Email customer authentication —
unchanged standing recommendation, deferred again as this task was
explicitly UI/UX-only.

## Day 17 — Admin login fix, dynamic order status, customer auth foundation

**Part 1 — Admin login flow**: Login/register now redirect straight to
`/restaurants/[id]/dashboard` (using the `membership`/`memberships[0]`
already returned by `/auth/login` and `/auth/register`) instead of the
old intermediate "Welcome / Your Restaurants" page. `/dashboard` itself
is now a thin redirector (fetches `/auth/me`, sends the admin to their
restaurant) rather than deleted outright, so old bookmarks/back-nav
don't 404. The genuine multi-restaurant case isn't removed — the
restaurant layout's header switcher (`memberships.length > 1`) still
exists and still works; only the extra picker *screen* is gone.
Landing page (`app/page.tsx`) rewritten: removed the "View demo QR
menu" card from the main login/registration entry point, and fixed
copy that claimed auth "isn't live yet" (it's been live since Day 4).

**Part 2 — Dynamic order status**: `OrderStatus` enum expanded from
just `NEW` to `NEW → CONFIRMED → PREPARING → READY → COMPLETED`, plus
`CANCELLED` (reachable from any non-terminal state). New
`PATCH /restaurants/:id/orders/:orderId/status`
(`OrdersService.updateStatus`) validates the transition against a
`STATUS_TRANSITIONS` map (no illegal jumps, nothing changes once
COMPLETED/CANCELLED), persists to MongoDB, and returns the updated
order — the admin order detail page renders its "Mark as ___" buttons
from that same transition map and writes the *server's* response back
into state, never an optimistic local value, so refresh/logout-login
always shows what's actually in the database. Order list page now has
Active/Completed/Cancelled/All filter tabs (client-side filter over the
existing list — no new endpoint needed).

**Part 3–6 — Customer authentication foundation**: New `Customer` and
`OtpChallenge` schemas/collections (`apps/api/src/customers/`). OTP
flow: `POST /public/customer-auth/otp/request` (mobile or email, 6-digit
code, bcrypt-hashed, 5-min expiry, 5-attempt cap) →
`POST /public/customer-auth/otp/verify` (finds-or-creates the Customer
by mobile/email — never duplicates one that already exists — and issues
a session token). Session uses the *same* JWT mechanism as staff auth
(`jsonwebtoken` + `JWT_SECRET`) but a structurally distinct payload
(`{ customer_id, type: 'customer' }`) and its own `CustomerAuthGuard`,
so a customer token can never be used as a staff token or vice versa —
reusing the existing auth architecture, not building a second one.
Customer identity is global (not scoped per restaurant), stored client-
side as `mnu_customer_token` (separate from the staff `mnu_token`), so
the same phone/email is recognized across any restaurant's QR menu.
Frontend: `CustomerAuthPanel` (method choice → OTP entry → loading/error
states, all as sub-states of one component) is rendered inline on the
Review Order page — the one point in the flow between Cart and Order —
whenever no valid customer token is present; browsing the menu, adding
to cart, and reaching the Review page itself all still require zero
login. Because authentication happens *on* the Review page rather than
via a separate route, cart contents and the `table`/`tableId` query
params are never touched by the auth step — Part 6 falls out for free.

**Part 7/8 — Customer ID on orders, restaurant isolation**: `Order`
gained an optional `customerId` (ObjectId ref). `POST
/public/restaurants/:id/orders` is now behind `CustomerAuthGuard` —
placing an order requires a verified customer session, and the
customer id comes from the verified token, never the request body.
Admin order list/detail now also return a `customer` block (code, name,
mobile, email) for display. `OrdersService.listCustomerOrdersForRestaurant`
exists as the Part 7/8 foundation — every customer-order lookup filters
by both `{ restaurantId, customerId }` together, which is what prevents
one restaurant from ever seeing a customer's history at another. No
dedicated history UI was built — explicitly out of scope today ("do not
build the full Customer Memory UI yet").

**Backend changes**: `orders/schemas/order.schema.ts` (status enum,
`customerId`, new index), `orders/orders.service.ts` (`updateStatus`,
`listCustomerOrdersForRestaurant`, customer join in serialization),
`orders/orders.controller.ts` (`PATCH .../status`),
`orders/public-orders.controller.ts` (`CustomerAuthGuard` on create),
`orders/orders.module.ts` (imports `CustomersModule`), new
`customers/` module (schemas, `CustomerAuthService`,
`CustomerAuthController`, `CustomerAuthGuard`,
`current-customer.decorator.ts`), `auth/jwt.util.ts`
(`signCustomerToken`/`verifyCustomerToken`), `database/database.module.ts`
(registers `Customer`/`OtpChallenge` globally), `app.module.ts`
(registers `CustomersModule`).

**Frontend changes**: `login/page.tsx`, `register/page.tsx`,
`dashboard/page.tsx` (Part 1); `app/page.tsx` (Part 1 copy/demo-link);
`restaurants/[restaurantId]/layout.tsx` (removed the now-misleading
"← All restaurants" link); `restaurants/[restaurantId]/orders/page.tsx`
+ new `orders/[orderId]/page.tsx` + new `orders/_components/StatusBadge.tsx`
(Part 2); new `menu/[restaurantId]/_components/CustomerAuthPanel.tsx`,
new `lib/customerAuth.ts`, `menu/[restaurantId]/review/page.tsx` (Part
3–6); `lib/api.ts` (`OrderStatus` widened, `ACTIVE_ORDER_STATUSES`,
`ORDER_STATUS_TRANSITIONS`, `ordersApi.updateStatus`, `customerRequest`
helper, `customerAuthApi`, `AdminOrderRecord.customer`).

**Tests performed**:
- `apps/api`: `tsc --noEmit` clean; `nest build` clean.
- `apps/web`: `tsc --noEmit` clean; `next build` clean (all 19 routes
  compile, including the two new/changed order pages).
- Everything involving an actual running server or MongoDB — admin
  login → direct dashboard redirect, changing an order's status and
  confirming it survives refresh/logout-login, the OTP request/verify
  round trip, find-vs-create-customer behavior, and order→customer
  association — was verified by **code review only**. **No live
  database or browser testing was performed** (same sandbox limitation
  as every prior session: `DATABASE_URL` points at MongoDB Atlas, which
  this sandbox's network can't reach). This is explicitly flagged per
  the task's own instruction not to claim live testing that didn't
  happen.

**Known issues**:
- **No real SMS/email provider.** `CustomerAuthService.requestOtp`
  returns the generated code directly in the API response
  (`devOtp`), and the frontend shows it in an amber "dev mode" note.
  This is the only way to make the OTP flow testable end-to-end without
  a third-party integration in this environment — it must be removed
  (or gated behind a non-production flag) and replaced with a real
  SMS/email send before any real launch.
- Order status transitions are enforced by a hand-written map in
  `OrdersService`, not a formal state machine library — fine at this
  size, worth revisiting if more statuses/roles are added later.
- No RBAC split on who can change order status (any restaurant member
  can) — matches the existing "any member can view orders" precedent,
  but a real kitchen-vs-front-of-house role distinction doesn't exist
  yet.
- Customer order history has a backend query
  (`listCustomerOrdersForRestaurant`) and data model, but no admin UI —
  intentionally deferred per this task's own scope limit.
- No live browser/database verification — see Tests above.

**Recommended next task**: Build the restaurant-side Customer History
view (list of a customer's past orders at *this* restaurant only),
using `listCustomerOrdersForRestaurant` — the natural next step now
that Order → Customer association actually exists.

## Day 18 — Restaurant Analytics Dashboard + Menu Item Image Storage Migration

Two unrelated pieces of work, as scoped. **Customer Order History was
NOT implemented** — explicitly deferred again, per this task's own
instruction, even though it was the standing recommendation above.

### Part 1 — Analytics on the Dashboard

Real MongoDB aggregation, nothing hard-coded. New
`OrdersService.getDashboardAnalytics(restaurantId, userId)` + new
`GET /restaurants/:id/analytics/dashboard` (`AnalyticsController`, same
module as `OrdersController`, same `JwtAuthGuard` +
`requireMembership` restaurant-isolation check every other
restaurant-scoped endpoint in this project already uses — one
restaurant's admin can never query another's numbers). Rendered
directly on `restaurants/[restaurantId]/dashboard/page.tsx`, above
Quick Actions — not on a separate page, per this task's explicit
instruction. The old `/analytics` page now redirects the reader to the
Dashboard instead of showing a "coming soon" stub.

**Metrics implemented** (all in `getDashboardAnalytics` — see that
method's own comment block for the full reasoning on each definition
choice):
- **Today's Sales / Today's Orders** — sum(`total`)/count of
  non-cancelled orders created since UTC midnight today. "Today" is a
  UTC calendar day — this project has no restaurant-timezone field
  anywhere (checked `restaurant.schema.ts`), so there's no other
  well-defined "today" to use. Documented inline and on the dashboard
  itself ("UTC calendar day" hint under each card) rather than silently
  assumed.
- **Average Order Value** — all-time revenue ÷ all-time order count,
  excluding cancelled orders. Deliberately *not* scoped to just today:
  only Sales/Orders are explicitly "Today's" in this task's own metric
  list, and an average over one low-traffic day swings wildly; all-time
  is the standard AOV definition.
- **Active Orders** — count where status ∈ {NEW, CONFIRMED, PREPARING,
  READY} (anything non-terminal). **Completed Orders** — count where
  status = COMPLETED. Both are current totals describing the order
  queue's present state, not day-scoped.
- **Top-selling Items** — aggregated directly off `Order.items` (the
  name/quantity/lineTotal *snapshot* taken at order time — see
  `order.schema.ts`), not joined back to live `MenuItem` documents. A
  dish that was later renamed, 86'd, or deleted still correctly shows
  its historical sales; this is deliberately a different query from
  Day 14's `getPopularItems()` (which the customer Home page uses and
  *does* filter to currently-available items — right for "what can a
  customer order now", wrong for "what actually sold").
- **Recent Orders** — the restaurant's 5 most recent orders (any
  status), reusing the same `serializeOrderSummary()` the orders list
  page already uses — same shape, same customer-block field, no
  duplicate serialization logic.
- **7-day trend** — daily sales+order-count for the UTC window
  `[today-6, today]`, with every day in the window explicitly
  zero-filled if it had no orders, rather than only plotting days that
  had activity — a quiet day is real information for a trend, not
  something to skip. Rendered as new `TrendChart.tsx`: a small
  dependency-free bar chart (plain divs, height % of the window's max)
  — no charting library exists in `apps/web`'s dependencies, and 7 bars
  didn't justify adding one.
- **No metric was faked.** Nothing here needed a "document what's
  missing" placeholder — every metric the task asked for was
  computable from data that already existed (`Order`'s
  status/total/createdAt/items, all present since Day 12/17).

**Frontend**: `restaurants/[restaurantId]/dashboard/page.tsx` — new
`Analytics` section (own loading skeleton, its own error+retry state,
independent of the page's other three sections so one slow/failed
aggregation call doesn't block Quick Actions from rendering); new
`dashboard/_components/`: `MetricCard.tsx`, `TrendChart.tsx`,
`TopItemsList.tsx` (empty state: "No orders yet"), `RecentOrdersList.tsx`
(reuses the existing `StatusBadge` from the orders pages, links each row
to that order's detail page). `analytics/page.tsx` rewritten to point
at the Dashboard rather than showing a dead-end stub.

**Backend**: `orders/orders.service.ts` (`getDashboardAnalytics`),
`orders/orders.controller.ts` (new `AnalyticsController`, same file),
`orders/orders.module.ts` (registers it). No schema changes — every
field this reads already existed.

### Part 2 — Menu Item Image Storage Migration (local disk → Cloudinary)

**Inspected first**: confirmed via `package.json`/`.env.example`/
`docker-compose.yml` that no cloud storage provider existed anywhere in
this project (no AWS/GCS SDK, no bucket config) before choosing one.

**Approach**: local disk (`apps/api/uploads/menu-items/`, served via
`useStaticAssets` — the Day 16 architecture) replaced with
**Cloudinary**, chosen over hand-rolling S3/GCS because it needs three
env vars and one SDK call for a permanent HTTPS URL — no bucket/IAM/CORS
setup to also invent for this task. New `common/cloudinary.ts` (SDK
config from three new env vars, `secure: true` forces https). Target
flow now matches the task's spec exactly: admin uploads → Cloudinary →
Cloudinary returns a secure URL + public_id → MongoDB stores both →
customer/admin UI reads the stored URL directly (`<img src>`, same as
before — `ItemImage.tsx`/`resolveImageUrl()` needed no structural
change, just a fast-path for already-absolute URLs).

**Schema**: `MenuItem.imageUrl` is now a full Cloudinary HTTPS URL
(previously a local `/uploads/...` path — comment updated in
`menu-item.schema.ts`). New `MenuItem.imagePublicId` (Cloudinary's own
asset id) — needed to delete/replace the exact right remote asset on
edit/remove (Cloudinary has no "delete by URL"); **never serialized to
any API response** (checked `serializeItem()` — only `imageUrl` is
returned, same as before), purely an internal implementation detail.
Still single image per item, unchanged.

**Backend**: `menu.service.ts` — `uploadItemImage`/`removeItemImage`
rewritten against `cloudinary.uploader.upload_stream`/`.destroy()`
instead of `fs.writeFile`/`fs.unlink`; validation (JPEG/PNG/WebP
allow-list, 5MB cap) unchanged, same as the local-disk version. Old
`deleteImageFileIfAny` replaced by `destroyImageIfAny` (same
best-effort-cleanup shape, now against Cloudinary's API instead of the
filesystem). `main.ts`: removed the now-dead `useStaticAssets()` call
and the `NestExpressApplication` typing it required — nothing writes to
local disk anymore, so nothing needs serving from it.
`apps/api/.env.example`: added `CLOUDINARY_CLOUD_NAME` /
`CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` (placeholders only — no
real credentials exist in this sandbox, see Known limitations).
`apps/api/.gitignore`: added `uploads/` defensively, so a manually
recreated local-disk artifact can never end up committed, even though
nothing in the current code path writes there anymore.
`package.json`: added `cloudinary` (already installed, `npm install`
run in this session).

**Frontend**: `lib/api.ts`'s `resolveImageUrl()` now passes an
already-absolute `http(s)://` URL through unchanged (Cloudinary's own
`secure_url`) and only falls back to prefixing the API origin for a
value that isn't already absolute (backward-compat for any pre-existing
local-disk-style path — none is assumed to actually exist in this
sandbox's unreachable database, this is just not silently breaking one
if it did). **No other frontend change was needed** — the admin
create/edit-item image picker/preview/replace UI and the customer-facing
`ItemImage` component were both already storage-agnostic (they call
`menuApi.uploadItemImage`/`removeItemImage` and render through
`resolveImageUrl()`; neither ever assumed local disk).

### Tests performed
- `apps/api`: `tsc --noEmit` clean; `nest build` clean.
- `apps/api`: boot test (`node dist/main.js`) — starts, reaches
  `MongooseModule`/`ConfigModule` init with no DI/schema error, before
  blocking on the (network-blocked) Atlas connection, same as every
  prior session. This also confirms `cloudinary.config()` with unset
  env vars doesn't throw at boot (it only fails, cleanly, if an actual
  upload is attempted without real credentials).
- `apps/web`: `tsc --noEmit` clean; `next build` clean — same 19 routes,
  `restaurants/[restaurantId]/dashboard` grew from ~1.7 kB to 4.81 kB
  (the new analytics section), `analytics` page shrank (now a redirect
  card, not a stub with more markup).
- `apps/web`: `next start` boot test — `GET
  /restaurants/:id/dashboard` returns `200` and renders without a
  server-side crash (confirms the new imports/components/aggregation
  types all resolve correctly at runtime, not just at typecheck time);
  it shows the page's own loading guard rather than real numbers, which
  is expected — there's no reachable database in this sandbox for
  `restaurant-context` to actually authenticate against.
- **The actual aggregation math (does `getDashboardAnalytics` return
  the right numbers against real orders), the Cloudinary upload/destroy
  round trip, and MongoDB actually storing/reading back `imageUrl`/
  `imagePublicId` were all verified by code review only.** No live
  database, no live Cloudinary account, and no browser session were
  available in this sandbox — same limitation as every prior session,
  now compounded by Cloudinary also being outside this sandbox's
  network allow-list (only npm/GitHub/PyPI-family domains are
  reachable here), so even a throwaway free-tier account couldn't have
  been exercised end-to-end from inside this environment regardless of
  credentials.

### Known limitations
- **No real Cloudinary account/credentials exist in this sandbox** —
  `.env.example` documents the three variables needed; a real
  `cloud_name`/`api_key`/`api_secret` from an actual Cloudinary account
  must be added to `apps/api/.env` (not committed — already
  `.gitignore`d) before uploads will actually work anywhere this runs.
- Average Order Value and the two order-count metrics are intentionally
  all-time, not "today" — see the reasoning above; if a strictly
  today-scoped AOV/active/completed breakdown is wanted later, that's
  an additive change to the same aggregation, not a redesign.
- The 7-day trend is a fixed UTC window; a restaurant whose actual
  business day doesn't align with UTC will see activity from the tail
  end of "yesterday" or the start of "tomorrow" bleed across a bucket
  boundary. Same root cause as the "today" caveat above — no
  restaurant-timezone field exists yet.
- No image is resized/optimized before or after upload — Cloudinary
  itself is capable of on-the-fly transforms (thumbnails, format
  conversion) via URL parameters, but none are used yet; the stored
  `imageUrl` is whatever Cloudinary handed back for the original
  upload. A reasonable next pass, not done today (kept to the task's
  actual scope).
- Not exercised against live data in a browser, and not against a real
  Cloudinary account — see Tests above.

**Customer mobile/email authentication** was already live as of Day 17
and untouched today. **Customer Order History = NEXT TASK** (carried
over, explicitly not built today per this task's own scope limit).

**Recommended next task**: Build the restaurant-side Customer History
view — unchanged recommendation from Day 17, still the natural next
step now that this task didn't touch it either.

## Day 19 — Restaurant-Admin Customer History (read-only)

Dashboard → Customers → Customer List → Customer History → Order
Details. Read-only, restaurant-scoped, no customer-facing changes.

**What already existed (inspected first, reused as-is)**:
`OrdersService.listCustomerOrdersForRestaurant` (Day 17 — restaurant +
customer scoped query, no controller route yet); `OrdersService.getOrder`
(Day 12/17 — full restaurant-scoped order detail with customer block,
already has a controller route and an admin page:
`orders/[orderId]/page.tsx`); `JwtAuthGuard`/`requireMembership`
(auth + restaurant isolation, unchanged); `StatusBadge`, the
Orders list page's loading/empty/error visual pattern (copied, not
duplicated-and-diverged); the admin sidebar/layout
(`useRestaurantContext`, which already turns "not a member of this
restaurant" into a page-level unauthorized state for every admin route).

**What was missing**: a restaurant-scoped *customer list* endpoint (no
"customers" concept existed anywhere except the OTP-auth-created
`Customer` collection, which is global, not restaurant-scoped); a
controller route for the existing `listCustomerOrdersForRestaurant`
method; and every frontend screen for this flow (`Customers` didn't
exist as a section at all — sidebar had no entry for it).

**Created**:
- `OrdersService.listCustomersForRestaurant(restaurantId, userId)` —
  new. Aggregates *this restaurant's own* `Order` documents
  (`$match restaurantId` first, then `$group by customerId`) to get the
  distinct customers who've actually ordered here, with orderCount/
  totalSpent/lastOrderAt, then joins `Customer` for display fields.
  Deliberately never queries the global `Customer` collection first —
  a customer who has never ordered at this restaurant is never loaded,
  matching the task's explicit "do not fetch all global customers and
  filter in the frontend."
- `OrdersService.listCustomerOrdersForRestaurant` — **extended**, not
  duplicated: now also returns the customer's own profile
  (name/mobile/email/code) alongside their order list in one response
  (`{ customer, orders }` instead of a bare array), since it had no UI
  consumer before today and nothing depended on the old shape. See its
  updated security comment: the customer profile is only looked up
  *after* confirming at least one order exists for `{restaurantId,
  customerId}` together — looking it up by `customerId` alone first
  would let this restaurant's admin read another restaurant's
  customer's PII by guessing a valid id, even with zero shared history.
- `CustomersController` (`orders/orders.controller.ts`, same file/module
  as `OrdersController`/`AnalyticsController`, same reasoning as
  `AnalyticsController` — the data is fundamentally Orders data, so it
  reuses `OrdersService` rather than creating a `Customer`↔`Orders`
  cross-module dependency): `GET restaurants/:id/customers`,
  `GET restaurants/:id/customers/:customerId/orders`. Registered in
  `orders.module.ts`.
- Frontend: `lib/api.ts` gained `customersApi` (`list`, `getHistory`) +
  `RestaurantCustomerRecord`/`CustomerHistoryResponse` types (reusing
  the existing `CustomerProfile`/`AdminOrderRecord` shapes, not new
  ones). New pages: `restaurants/[restaurantId]/customers/page.tsx`
  (list) and `.../customers/[customerId]/page.tsx` (history, links each
  order straight into the **existing, unmodified** order-detail page).
  Sidebar (`layout.tsx`) gained a "Customers" nav item; Dashboard
  gained a matching Quick Action.

**Not touched**: `getOrder`/order-detail page (reused exactly as-is —
no new "read-only" variant was built, per the task's own instruction);
`Customer`/`Order` schemas (no new fields needed); customer-facing
anything; `CustomerAuthService`/OTP flow.

### Security / isolation
- Every new/extended method still goes through `requireMembership`
  first — a non-member of the restaurant gets the same
  `ForbiddenException` every other restaurant-scoped call already
  throws.
- Customer list: derived from this restaurant's `Order` rows only —
  structurally cannot include a customer with zero orders here.
- Customer history: scoped by `{restaurantId, customerId}` together,
  same isolation mechanism as every other restaurant-scoped lookup in
  this project. A customerId that's valid but belongs only to another
  restaurant's order history comes back as `{customer: null, orders:
  []}` — indistinguishable from a nonexistent id, same "shape-as-404"
  principle used everywhere else, and specifically prevents PII leakage
  (see above).
- Order details: unchanged, already restaurant-scoped (`{_id,
  restaurantId}`).
- Page-level "unauthorized" (not a member of this restaurant) was
  already handled by the shared layout for every admin route — nothing
  new needed there.

### Tests performed
- `apps/api`: `tsc --noEmit` clean; `nest build` clean; boot test
  (`node dist/main.js`) reaches `ConfigModule` init with no DI/schema
  error (a bad `@Controller`/provider wiring would throw before that
  point) before blocking on the network-blocked Atlas connection, same
  as every prior session.
- `apps/web`: `tsc --noEmit` clean; `next build` clean — **21 routes**
  (19 from Day 18 + the two new `/customers` routes).
- `apps/web`: `next start` boot test — `GET
  /restaurants/:id/customers` and `GET
  /restaurants/:id/customers/:customerId` both return `200` with no
  server-side crash.
- **The actual aggregation results, the PII-isolation behavior, and the
  full click-through flow were verified by code review only.** No live
  MongoDB and no live browser session were available in this sandbox —
  same limitation as every prior session. Concretely worth doing on a
  machine with real Atlas access: seed two restaurants with overlapping
  and non-overlapping customers, confirm Restaurant A's customer list
  never shows a customer who's only ordered at B, and confirm hitting
  `/restaurants/:A-id/customers/:a-customer-who-only-ordered-at-B` comes
  back with `customer: null` rather than leaking their profile.
- No lint script or existing test suite exists in either app
  (`package.json` has no `test`/`lint` runner beyond
  `next lint`, which was not separately invoked here) — `tsc --noEmit` +
  the production builds are what "TypeScript checks" and "build" mean
  in this project's existing convention, consistent with every prior
  day's Tests section.

### Known limitations
- No pagination on the customer list — fine at current scale, same
  caveat as the orders list.
- No search/filter on the customer list.
- `RestaurantCustomerRecord.totalSpent` includes cancelled orders'
  totals (unlike the Day 18 analytics AOV, which excludes them) — this
  list is "who has this restaurant served," not a revenue metric;
  worth reconciling if this number is ever shown next to the dashboard's
  revenue figures.
- Not exercised against live data in a browser — see Tests above.

**Recommended next task**: none carried over from this feature — the
standing Day 17 recommendation is now built. Next candidates: real
SMS/email OTP delivery (still dev-mode only, per Day 17/18 notes), or
closing the live-database verification gap that has applied to every
feature since Day 1.

## Day 20 — Customer Mobile UI Polish + Group Ordering Foundation

*Numbering note: this task was briefed as "Day 19", but Day 19 above is
already taken by Restaurant-Admin Customer History (the state this
session started from). Logged as Day 20 to avoid a duplicate heading.*

**Pinterest reference (Part 2) was NOT accessible** — `pin.it` returns
`ROBOTS_DISALLOWED` to automated fetches. Per the task's own fallback
instruction, the existing MnU customer UI was extended consistently
rather than a new design system invented. No visual language was
imported from anywhere.

### Part 1 — Customer mobile UI

Deliberately restrained: the customer flow had already had three
dedicated UI passes (Days 13/14/16), so this was targeted, not a
redesign.
- `CustomerAuthPanel` gained optional `title`/`description` props and
  made `restaurantName` optional — the group entry screen needs the
  same verification UI with different framing ("verify to join a
  group", not "verify to place your order") and doesn't fetch the menu,
  so requiring a restaurant name purely for one line of copy would have
  meant a wasted request. The Review page's wording is unchanged
  (defaults preserve it exactly).
- New `GroupOrderBanner` on Home and Cart, using the existing card
  language (`rounded-2xl`, `border-ink-100`, `active:scale-[0.99]`).
- No change to the bottom nav's four tabs. A fifth "Group" tab was
  considered and rejected: Part 11 explicitly warns against competing
  fixed navigation, and group ordering is a mode you enter, not a
  destination you toggle between. Every group screen therefore has
  **zero** fixed/sticky elements (verified by grep across all customer
  routes) — same treatment Review and Confirmation already get.

### Part 3–8 — Group ordering

Flow: Home/Cart banner → **Group Order** entry (Create / Join) →
**Join** (code entry) → **Lobby**.

**Codes**: 5 characters from a 31-character alphabet with `0/O/1/I/L`
removed — these get read aloud across a table, which is the one failure
mode a join screen can't recover from gracefully. Generated with
`crypto.randomInt` (not `Math.random`), retried against the unique index
on collision. Never hard-coded. The join input sanitizes to the same
alphabet as the customer types.

**Personal vs group cart (Part 7)**: no second cart system was built.
`lib/cart.ts` (localStorage, per-restaurant) remains the single source
of truth for what a customer is personally building; the lobby's
"Share my items with the group" pushes that cart into *that member's
own slot* on the server. So **My Items** = the caller's shared
contribution, **Group Items** = everyone else's. The sync is an explicit
push, not a background/live sync — real-time collaboration is out of
scope, and a silent sync would leave it unclear what the rest of the
table can already see. The lobby detects and prompts when the local cart
has drifted from what was shared.

**Prices in the lobby** are recomputed from live `MenuItem` prices on
every read, not stored on the group. The binding price *snapshot* is
still the one taken at order creation (`Order.items`, Day 12) — a group
lobby is a pre-order staging area, not an order.

**Group checkout is deliberately absent.** Each member still checks out
their own cart through the existing Cart → Review → Order flow, entirely
unchanged. The lobby says so in plain text rather than implying a
combined checkout exists.

### Part 9/10 — Backend / security

New `apps/api/src/group-orders/` module. Nothing existing was
rebuilt — `Customer`, `TableSession`, `Table`, `Order`, `MenuItem`,
`CustomerAuthGuard`, and `lib/cart.ts` are all reused as-is.

- `GroupOrder` schema pins `restaurantId` + `tableId` + `tableNumber` +
  `tableSessionId` (all stored, not derived) so a group can never be
  re-pointed at another restaurant and an ended session makes its groups
  verifiably stale. Members are embedded, each with their own item list.
- Every route is behind `CustomerAuthGuard` (the customer session from
  Day 17, not staff auth). `customerId` always comes from the verified
  token, never the body.
- **Every group lookup filters by `groupCode` AND `restaurantId`
  together** — a valid code belonging to another restaurant resolves to
  nothing, returning the same message as a typo (the "shape-as-404"
  principle used throughout this project).
- Non-members cannot read a lobby — otherwise anyone holding a code
  could watch a table's order build without joining.
- `syncMyItems` replaces *only the caller's own* slot; a member can
  never edit another member's items. Item ids are re-validated against
  `{_id, restaurantId}` exactly as `createOrder` does.
- Create is idempotent per table session: if a group is already open at
  this table, the caller is added to it rather than starting a rival
  group (two groups at one physical table has no good resolution).

**Endpoints**: `POST/join/GET :groupCode/PUT :groupCode/my-items` under
`public/restaurants/:restaurantId/group-orders`.

### Files changed

*Backend (new)*: `group-orders/schemas/group-order.schema.ts`,
`group-orders.service.ts`, `group-orders.controller.ts`,
`group-orders.module.ts`.
*Backend (edited)*: `app.module.ts`, `database/database.module.ts`
(register the new module/schema) — nothing else.
*Frontend (new)*: `lib/groupOrder.ts`, `menu/[restaurantId]/group/page.tsx`,
`group/join/page.tsx`, `group/[groupCode]/page.tsx`,
`group/_components/GroupShell.tsx`,
`menu/[restaurantId]/_components/GroupOrderBanner.tsx`.
*Frontend (edited)*: `lib/api.ts` (`groupOrdersApi` + types, appended),
`_components/CustomerAuthPanel.tsx` (optional props),
`home/page.tsx` + `cart/page.tsx` (banner insertion only).

### Tests performed

**Code-level / build verification (actually run):**
- `apps/api`: `tsc --noEmit` clean; `nest build` clean.
- `apps/api`: boot test — full DI graph initializes with `GroupOrdersModule`
  registered, no schema/provider errors. This surfaced and **fixed a real
  bug**: a duplicate `groupCode` index (declared via both
  `@Prop({ unique: true })` and `schema.index()`) that Mongoose warned
  about at boot; re-verified clean afterward.
- `apps/web`: `tsc --noEmit` clean; `next build` clean — **24 routes**
  (21 from Day 19 + 3 new group routes). No existing route changed size
  meaningfully.
- `apps/web`: `next start` runtime check — all three new group routes
  plus `/home` and `/cart` return `200` and render server-side without
  crashing (confirms imports/components resolve at runtime, not just at
  typecheck).
- Pure-logic tests (no DB needed): 200,000 generated codes contained
  **zero** ambiguous characters and were always 5 chars (collision rate
  0.362% across 200k draws against a 28.6M keyspace — which the retry
  loop handles); the join-input sanitizer round-trips every generated
  code unchanged and correctly strips/uppercases 5/5 malformed inputs;
  the lobby's "unshared changes" diff passed 6/6 cases (identical,
  qty-changed, item-added, item-removed, both-empty, cart-emptied).
- Layout audit by grep: group screens have zero fixed/sticky elements
  (no competing nav bars); no fixed pixel widths ≥100px anywhere in the
  new components that could overflow a 375px viewport; truncation
  guards (`min-w-0`/`truncate`) present on every variable-length string.

**NOT tested (no live environment available):**
- **No live MongoDB.** Group creation, joining, the member-isolation
  rules, cross-restaurant code rejection, and session-expiry behavior
  were verified **by code review only** — same standing limitation as
  every prior session (Atlas is unreachable from this sandbox).
- **No live browser session.** Responsive behavior at 375/390/430px and
  tablet/desktop was verified by reading the Tailwind classes used, not
  by rendering in a real viewport.
- **No live OTP.** The auth panel is reused unchanged and was not
  re-exercised; OTP delivery is still dev-mode-only (Day 17 limitation,
  untouched).

### Known limitations
- **Lobby is not live.** Members must tap "Refresh group" to see others'
  additions — no polling/websockets (out of scope per Part 12).
- **Sharing is manual.** Adding to your cart does not automatically
  appear in the group; you must tap "Share my items with the group".
- **No group checkout, no split payment** — explicitly out of scope.
- **No leave-group action.** A member can clear the remembered code by
  hitting a dead lobby, but there's no explicit "leave" button, and
  groups are never closed (`status` is written but nothing sets
  `CLOSED` yet).
- **No restaurant-admin visibility into groups** — out of scope per
  Part 12; groups are invisible to the admin side today.
- Group totals use live menu prices, so a mid-session price change
  shifts the displayed group total (correct for a pre-order view, worth
  knowing).

### What remains for complete group ordering
Live lobby sync (polling or websockets); leave/close-group lifecycle;
combined group checkout producing one `Order` (or linked orders) with
per-member attribution; split payment; restaurant-admin view of an
active group at a table.

**Recommended next task**: close the live-verification gap that now
spans every feature since Day 1 — stand this up against a real Atlas
instance and manually exercise at minimum the group flow
(create → join from a second identity → share items → cross-restaurant
code rejection) and the OTP flow. Every feature in this log is
build-verified and code-reviewed but has never actually run against a
database, and group ordering adds multi-party state where that gap
matters more than it did for single-customer features.

## Day 20 (fix) — Group ordering now produces ONE order

**Reported bug**: a group shared a code, the second person was asked to
verify separately, and then **both members' orders arrived in the admin
order panel as two separate orders for one table**. The table should
send one order.

**Root cause**: the Day 20 foundation deliberately shipped without group
checkout (logged as out of scope). So the lobby had no way to submit,
and each member fell back to the normal Cart → Review → Place Order
path, which correctly created one `Order` *per customer*. The group
lobby was effectively a shared shopping list that never became an order.

### Backend
- `Order.items[]` gained `addedByCustomerId` + `addedByName` — a single
  combined ticket is useless to floor staff if nobody can tell whose
  dish is whose.
- `Order` gained `groupOrderId` + `groupCode`. Their presence is what
  makes an order a group order; there is **no second order collection
  and no second order shape**. A group still produces exactly one
  `Order`.
- `GroupOrder` gained `ORDERED` status + `placedOrderId` /
  `placedOrderNumber`.
- New `GroupOrdersService.placeGroupOrder()`. Mirrors
  `OrdersService.createOrder`'s validation and server-side pricing
  rather than calling it, because the item shape differs (attribution).
  Notable decisions:
  - **Idempotent.** Two members tapping "Place Group Order" at the same
    moment is the expected case, not an edge case — the second call
    returns the same order instead of throwing or duplicating.
  - **Lines are not merged across members.** Two people each ordering a
    coffee is two attributable lines, not `coffee ×2` with the
    attribution lost. Same person + same item *is* merged.
  - Prices still come from MongoDB only; the group document stores just
    item ids and quantities, so there is no client-supplied price to
    trust even accidentally.
  - Requires a live table session and group membership, same as every
    other group operation.
- `POST .../group-orders/:groupCode/place-order`. Any member may submit
  on the group's behalf.
- Admin order serializer now returns `groupCode` and per-item
  `addedByName`.

### Frontend
- **Review page now blocks solo checkout when this browser is in a
  group** and routes to the lobby instead. This is the actual fix for
  the duplicate orders — without it, the old path remained reachable.
- Lobby gained "Place Group Order" (disabled at ₹0), a placed-order
  confirmation screen showing the single order number, the combined
  total, and each line with who it's for, and an "already placed" state.
  Placing clears the personal cart and the remembered group code so
  nobody can wander back into solo checkout with a stale copy of what
  they already ordered.
- Admin orders list + order detail badge group orders and show `for
  <name>` per line.

### Tests performed
- `apps/api`: `tsc --noEmit` clean; `nest build` clean; boot test clean
  (full DI graph, no schema/index warnings).
- `apps/web`: `tsc --noEmit` clean; `next build` clean; `next start`
  runtime check — lobby, review and cart all return `200`.
- Pure-logic tests of the new merge/attribution/idempotency code, run
  standalone: the exact reported scenario (two members, overlapping
  items) produces **one** order with 4 attributable lines and a correct
  combined total; two members ordering the same drink stay separate
  lines; same-person duplicates merge; an empty group yields zero lines
  (service throws); concurrent "place" calls return the same single
  order and leave the group `ORDERED`; join/sync are blocked afterwards.
  **7/7 passed.**
- **Still no live MongoDB, browser or OTP in this sandbox** — the
  end-to-end two-phone flow (create → join → both share → one order in
  the admin panel) is verified by code review and the logic tests above,
  **not** by actually running it. That remains the top thing to confirm
  manually against a real Atlas instance.

### Known limitations (unchanged or new)
- Lobby still isn't live — members tap "Refresh group" to see others'
  items. If someone places the order while another member is mid-add,
  the late items simply aren't included; they'd need a second order.
- Sharing is still manual ("Share my items with the group").
- No split payment, no per-member bill — one order, one total.
- No leave-group action; groups are never auto-closed.

## Day 21 — Customer mobile UI + MnU visual design system

Customer UI only. No backend changes, no admin changes, no new
group-ordering features.

### Design system
Tokens already existed in `app/globals.css` (`@theme`), so they were
**extended, not replaced**. The legacy `brand-*` / `ink-*` / `cream-*`
scales keep their original values on purpose: 30+ files including the
whole admin app consume them, and retuning in place would have silently
restyled admin too. New earthy tokens sit alongside and the customer
screens were migrated onto them.

Added: `canvas` / `canvas-deep` (#F9F5EB), `surface`, `terracotta-*`
(#E07A5F), `sage-*` (#556B2F), `night` (#111111), `carbon-*` text,
`hairline` borders; radii `soft`/`card`/`hero` (20/24/28px); utilities
`shadow-soft`, `shadow-soft-lg`, `shadow-nav`, `drop-food`,
`no-scrollbar`; and a `.mnu-customer` class that paints the canvas on
customer screens only.

**Deliberate deviation from the brief**: true neumorphism (matched
light+dark inset shadows on a same-colour surface) was not used. It
destroys contrast, and this is a menu people read in dim restaurants.
White cards + soft elevation over warm canvas reads as the same
aesthetic while staying legible.

### Home
Hero/featured area (new `FeaturedHeroCard`, variant B) using the first
of the same real featured items — no new "featured" backend flag, no
invented curation. Header rebuilt: restaurant avatar, time-of-day
greeting (from the diner's own device clock — no restaurant timezone
field exists), table + menu-size chips, and a search field that links
into the existing Menu-screen search. Categories became a horizontal
pill rail instead of a grid, keeping Home short and breathable.

### Menu
2-column mobile grid (was 1-column). `MenuItemCard` rebuilt as variant A
— square image, name, description, price, floating round add button
absolutely positioned so long names wrapping to two lines can never
collide with it. Category tabs restyled as dark/white pills, ≥38px.

### Cards + images
Three reusable variants, used where each suits: A standard grid card,
B featured hero, C carousel card (`HomeItemCard`). `QuantityControl`
was **extracted** — identical add/stepper markup was duplicated in three
places and had drifted to different touch-target sizes; one component
now keeps them all ≥32px.

`ItemImage` gained an opt-in `float` mode (`object-contain` +
`drop-food` drop-shadow + scoped `overflow-visible`) for transparent
food PNGs. It is **not** the default — applied to an opaque photo it
would letterbox and shadow a rectangle. Used only on the hero. No image
URLs, storage, or fallbacks were changed.

### Bottom navigation
Now a floating dark (`night`) rounded bar, inset on all breakpoints,
max-w-md, tabs ≥52px. Still exactly **one** fixed bottom element per
screen — the cart strip rides on the same block. The cart page's
checkout bar was repositioned to `bottom-[80px]` with matching inset and
radius, since it had been aligned to the old full-bleed nav height.

### Group ordering compatibility
Business logic untouched — only tokens migrated. Verified: all group
routes still return 200, group context/params preserved, the "in a
group → solo checkout blocked" guard intact, nav does not overlap group
controls (group screens intentionally carry no bottom nav, as before).

### Tests
**Code-level / build (actually run):** `tsc --noEmit` clean (web + api);
`next build` clean; `nest build` + API typecheck clean (API untouched).
`next start` runtime check — home, menu, search, item, cart, review,
group entry/join/lobby, and an admin route all return 200. Verified the
new tokens and all 11 custom utilities actually compile into the emitted
CSS (a bad `@theme` value fails silently otherwise — one typo was caught
this way). Audited: 0 admin files reference new tokens; ≤1 fixed bottom
element per route; `overflow-visible` appears in exactly 2 scoped
places; long-text guards (`line-clamp`/`truncate`/`min-w-0`) present on
all three card variants.

**NOT run:** no live browser, no device, no MongoDB. 375/390/430px
behaviour is verified by reading the Tailwind classes and the layout
audits above — **not** by rendering at those widths. ESLint is not
configured in this project, so no lint run.

### Limitations / remaining customer UI work
- No customer profile/avatar — the data model has no customer photo or
  display name on the menu side, so the header avatar is the restaurant.
  The brief's "Profile" nav tab was therefore **not** added; nav stays
  Home/Menu/Search/Cart, which are real routes.
- No favourites — no backend support; not faked.
- Most food items likely have opaque photos, so `float` mode is used
  only on the hero until transparent assets exist.
- Item detail, review, and confirmation screens got token migration only,
  not a layout redesign.
- Real-device verification at 375/390/430px is the top remaining check.

## Day 22 — Intelligent customer menu: branding, Featured, performance-based Popular

Brand → Featured → Popular → Categories → Full menu. No AI, no scoring
engine, no new group-ordering work.

### What already existed (inspected, reused)
`Category.sortOrder` (explicit category order — reused, never re-sorted
alphabetically); `OrdersService.getPopularItems()` (real order-derived
popularity, Day 14 — extended, not rebuilt); `getPublicMenu`,
`resolveImageUrl`, `ItemImage` fallbacks, Day 21 design tokens, the
admin menu-management screen, `CustomerBottomNav`, group ordering
(untouched).

### What was missing (inspection findings that changed the plan)
- `Restaurant` had **only** `name` — no branding fields of any kind.
- `MenuItem` had **no** `isFeatured`. Days 14 and 21 both stood in "first
  item of each category by sortOrder" as a placeholder. That placeholder
  is now removed.

### Backend
- `Restaurant`: +`logoUrl`, +`primaryColor`, +`accentColor` (minimum
  three; all nullable, all with defined customer-side fallbacks).
- `MenuItem`: +`isFeatured` (boolean flag on the item itself — **not** a
  separate collection, so the dish keeps one identity and is never
  duplicated).
- `MenuService.setFeatured()` + `PATCH /restaurants/:id/menu-items/:itemId/featured`.
  Manager-only (`requireManager`), deliberately stricter than
  `setAvailability`'s staff-level check: 86'ing a dish is operational,
  promoting one is editorial.
- `serializeItem` / `getMenu` / `getPublicMenu` expose `isFeatured`;
  `getPublicMenu` also returns a `branding` block (those three fields
  only — nothing else on the Restaurant document is public).
- **Security fix (Part 17)**: `getPopularItems` was returning
  `orderCount` on a public, unauthenticated endpoint — i.e. publishing
  real per-dish sales volume to anyone with a menu URL. Removed from the
  payload; it still ranks server-side. Customers see the ordering, never
  the numbers.
- Added `MIN_ORDERS_TO_BE_POPULAR = 3`. One or two orders is noise, not
  popularity; below the bar the item is dropped, which can legitimately
  leave the section empty — the intended outcome rather than padding it.

### Customer frontend
- **Header**: real logo when set, else an initial-letter avatar tinted
  with the brand colour; restaurant name promoted to `text-2xl` as the
  most prominent element; table chip picks up the brand colour. New
  `_components/branding.ts` validates hex colours before they reach an
  inline `style` and falls back to the MnU palette — the fields have no
  admin UI validating them, and unvalidated stored text must not land in
  a style attribute.
- **Loading**: skeleton rewritten to mirror the real Home layout
  block-for-block (logo/name, chips, search, banner, hero, two rails,
  category rail, button) so nothing shifts on load. **Honest constraint**:
  it cannot use brand colours — branding arrives in the very response
  being awaited — so it uses MnU defaults by necessity.
- **Featured section**: now driven by admin `isFeatured`. Empty ⇒ hero
  and rail both hidden, not backfilled.
- **Popular section**: renamed "Most ordered / Loved by other diners";
  hidden entirely when real data is insufficient.
- **Visibility hierarchy (Part 7)**: one badge maximum per item, resolved
  Featured > Popular > New. Featured items are excluded from the Popular
  rail, and both from New Arrivals, so Home doesn't repeat itself.
  Featured cards get a ring; Popular gets a plain chip; normal cards stay
  plain.
- **Category highlighting (Part 9)**: featured/popular items stay in
  their own category on the menu grid and are badged there. The menu
  page makes one extra `getPopular` call purely to know which ids to
  badge; it soft-fails to no badges.

### Admin
Featured toggle (`☆ Feature` / `★ Featured`) added to the **existing**
`ItemRow` on the menu management screen, plus a Featured pill next to the
86'd pill. No separate admin page.

### Tests
**Actually run:** `tsc --noEmit` clean (web + api); `nest build` clean;
`next build` clean — **24 routes, count unchanged** (no accidental new
routes). `next start` runtime check: home, menu, cart, review, group
entry, group join, admin menu, admin dashboard all **200**. Verified the
server-rendered Home contains the skeleton (`animate-pulse`,
`mnu-customer`) and **zero** "Featured"/"Popular" strings before data
arrives — i.e. no fabricated content at first paint. Verified all six
new/used design-token classes compile into the emitted CSS. Layout audit:
zero fixed widths ≥100px anywhere under `app/menu` (375px overflow
risk), truncation guards present on the card.

**NOT run:** no live MongoDB, no browser, no device. Featured toggling
end-to-end, the popularity threshold against real orders, and
375/390/430/768/1280px rendering are **code-level verification only** —
the responsive claims come from reading Tailwind classes, not from
rendering at those widths.

### Limitations / remaining work
- **No admin UI or write API for branding.** There is no
  `RestaurantsService`/`Controller` in this project at all, so the three
  new fields must currently be set directly in MongoDB. Day 22's admin
  scope was explicitly only the Featured toggle, so this was left as a
  documented gap rather than half-built.
- Loading skeleton can't be brand-coloured (see above).
- No vegetarian/non-vegetarian indicator: no such field exists on
  `MenuItem` and one was not invented.
- The menu grid makes one extra `getPopular` request for badge ids;
  acceptable (small, cached-per-load, soft-failing) but it is a second
  call, not a single combined one.
- Real-device verification remains the top outstanding check, as it has
  been since Day 1.

**Suggested next task**: restaurant settings screen + write API for
branding — the fields now exist and the customer UI consumes them, but
nothing can set them yet.

## Day 23 — Live customer UI: transitions, loading sequence, micro-interactions

Frontend-first, as instructed (~70/30). No backend changes — the
existing Featured/Popular/branding APIs (Day 22) already provided
everything this day's UI needed; inspected first, nothing was added.
No animation library installed (checked `package.json` before starting
— none was present, and the task says not to add one), so everything
below is plain CSS keyframes/utilities plus React state, reused as the
same few primitives across every screen rather than each screen
inventing its own motion.

### Motion primitives (`globals.css`)
Four keyframes/utilities: `animate-fade-in`, `animate-fade-slide-up`,
`animate-scale-in` (mount entrances, 220–320ms), `animate-pop` (one-shot
"that registered" pulse — not a loop). All neutralised to a 1ms snap
under `prefers-reduced-motion: reduce` rather than skipped outright,
so staggered content doesn't get stuck at `opacity:0` for a diner with
that setting on.

### New: `PageTransition`
One shared component (`_components/PageTransition.tsx`) — a mount-
triggered fade+slide, applied on Home, full Menu, Item Detail, and Cart.
This is the "connected transitions between routes" requirement, done
honestly: it is **not** a cross-route shared-element transition (the
image doesn't literally fly from card to detail page) — that needs
either a library or the browser's experimental View Transitions API,
neither of which this task allows/stably supports here. What it does
give: every screen enters the same way, so navigating Home → Category →
Dish → Cart feels like one continuous app rather than a stack of
documents snapping into place.

### Premium loading sequence
`HomeSkeleton` rewritten from one flat `animate-pulse` block into staged
entrances — header → context chips/search → group banner → hero → two
rails → category rail → CTA — each fading/sliding in with increasing
delay, each pulsing independently once visible. `MenuSkeleton`'s grid
cards got the same per-card stagger. **Honest constraint, unchanged
from Day 22**: this still can't be branded (logo/colour arrives in the
same response being awaited) and still doesn't block interaction —
`PageTransition` takes over the instant the real fetch resolves, there
is no artificial wait added anywhere.

### Menu card interactions / add-to-cart feedback
`QuantityControl` (the one shared add/stepper component) now plays a
`animate-pop` on itself and bumps the quantity number
(`key={quantity}` + `animate-scale-in`) the instant Add is tapped — this
is the "customer understands it was added without leaving the menu"
requirement, done inline rather than with a toast on every tap.
`MenuItemCard` / `HomeItemCard` gained hover/tap image scale
(`group-hover:scale-105`), card press feedback (`active:scale-[0.97-0.98]`),
and an optional `animationDelayMs` prop used by their grids/rails for a
staggered first appearance (capped — `Math.min(i, 9) * 40ms` on the
menu grid — so a big menu's last cards don't wait a visibly long time).

### Featured / Most Ordered visual variety
`FeaturedHeroCard` (the one large hero) gets a scale-in entrance and
image hover-scale; the rest of Featured and all of Most Ordered
continue to use the same compact `HomeItemCard` rail, which is what
already created the "large hero vs compact rail" contrast Day 21/22
built — kept, not rebuilt. Multiple featured items were already a
user-controlled horizontal rail (never autoplay); unchanged.

### Category navigation
`CategoryTabs` now scrolls the active tab into view within its own
rail (`scrollIntoView({inline:'center'})`) whenever the active category
changes — from a tap *or* from scrollspy as the diner scrolls the menu.
Previously a restaurant with many categories could scroll the active
highlight out of view with no way back to it except scrolling the pill
rail by hand.

### Bottom navigation
One shared translucent pill (`bg-surface/10`) now slides between tabs
via a CSS `transform` transition (`translateX(index * 100%)`) instead of
each tab independently swapping its own background — this is what
makes the active state read as *moving* rather than four buttons
blinking on/off. Cart badge plays `animate-pop` exactly once when the
count increases (tracked via a ref, not on every render/navigation).
Existing floating dark-bar identity, spacing, and the "exactly one
fixed bottom element per screen" rule are all unchanged.

### Item detail transition
Wrapped in `PageTransition`; image gets `animate-scale-in`, the price/
description block a slightly delayed `animate-fade-slide-up`, quantity
stepper the same bump-on-change as elsewhere, and the Add to Cart
button real press feedback (previously had none beyond the disabled
state). Business logic (fetch-whole-menu-then-find-item, the 500ms
redirect-after-add) is untouched — frontend polish only, per the task.

### Cart micro-interactions
Cart rows get a staggered entrance on mount; the sticky checkout bar
now enters with `animate-fade-slide-up` instead of appearing instantly;
quantity steppers get the same bump-on-change treatment as the menu
grid, so cart and menu now feel like the same control everywhere
instead of two different implementations (which they were, before
today, at slightly different touch sizes even).

### Group Ordering compatibility
**Not modified.** Grepped every file under `app/menu/[restaurantId]/group/`
for the components changed today (`CustomerBottomNav`, `QuantityControl`,
`MenuItemCard`, `HomeItemCard`) — zero matches. `GroupOrderBanner.tsx`
(used on Home and Cart, both changed today) was not edited at all, and
its call sites still pass it the same two props. Group routes appear
unchanged in the build's route list (same 24 total as Day 22).

### Visual identity
No new colours introduced — every addition uses the existing Day 21/22
token set (`terracotta`, `sage`, `night`, `carbon-*`, `canvas`,
`shadow-soft*`). Nothing here changes the palette; it changes how the
existing palette moves.

### Backend
None. Inspected `getPublicMenu`, `getPopularItems`, and the branding
fields (all Day 22) — all sufficient for everything above.

### Tests performed
**Actually run:** `apps/web`: `tsc --noEmit` clean; `next build` clean —
**24 routes, same as Day 22** (no accidental new/missing routes,
including all group routes). Reviewed the diff for: no new client/server
boundary violations (`'use client'` present everywhere a hook/animation
was added), no prop-signature changes to any shared component that
would break an existing call site (`QuantityControl`, `MenuItemCard`,
`HomeItemCard`, `CustomerBottomNav`, `FeaturedHeroCard` all kept their
existing required props; new props are optional/additive only), no
hydration-risk patterns (animation state is initialized identically on
server and client — `entered=false` — and only flips client-side via
`useEffect`, so SSR/CSR markup matches at hydration).

**NOT run — stated plainly, per the task's own instruction not to claim
otherwise:** no live browser, no real device, no MongoDB. **Responsive
behavior at 375 / 390 / 430 / 768 / 1280px is verified from code/static
analysis only** — reading the Tailwind classes and the layout patterns
carried over unchanged from Day 21/22 (which were themselves only
code-verified) — not by actually rendering at those widths. Nothing
about today's animations was exercised in a real browser; CSS keyframe
syntax and Tailwind's `@utility` compilation were checked by reading
the emitted rules in `next build`'s output, not by watching them play.

### Known limitations
- No true shared-element/cross-route image transition — see
  `PageTransition`'s comment above for why, and what would be needed
  (a library, or a stable View Transitions API) to do better.
- Loading sequence still can't be brand-coloured (unchanged from Day 22
  — branding arrives in the response being awaited).
- Entrance stagger on the menu grid resets on every search-query change
  (each filtered set is a fresh set of mounted cards) — acceptable
  (matches "results just appeared") but worth watching if it ever reads
  as jumpy with a fast typist.
- Real-device/browser verification remains the single largest
  outstanding gap in this project, unchanged since Day 1 — today added
  more motion that has specifically never been watched play.

**Suggested next task**: stand this project up against a real browser
and a real MongoDB Atlas instance (or any reachable instance) at least
once — verify the Day 23 animations actually run smoothly on a real
375px device, confirm the loading stagger doesn't feel slow on a real
network, and close the "code-review only" gap that has now spanned
every feature since Day 1.

## Day 24 — Premium customer UI redesign

No design-reference file was actually attached to this task's message
(only the text brief). Proceeded from the written spec directly
(premium/editorial/food-first) rather than inventing an unrelated
look — noted per this task's own instruction for when a reference isn't
accessible. No backend changes; 100% frontend, customer-side only.

**Approach**: did not patch the Day 21-23 soft-UI system with more
badges/shadows. Identified what read as generic — a hero that was
really a small badge (icon beside text on a flat panel), a menu card
with two stacked pills restating "this item is available," and a header
carrying three chips of overlapping information — and rebuilt those
specifically, keeping the token system, motion primitives, and
everything that already worked (`CategoryTabs` scrollspy,
`CustomerBottomNav`, the Day 23 motion utilities) untouched.

**Home**: `FeaturedHeroCard` rewritten as a full-bleed photographic hero
(4:5 mobile / 16:9 desktop) with a bottom scrim and large type set
directly over the photo, instead of a small square thumbnail beside a
text block. `HomeHeader` dropped its item/category-count pill — it
repeated what the customer was about to scroll into anyway — and now
shows table context as plain text rather than a chip. Section titles
(`HomeSection`) are now a proper heading with a quiet caption, not two
same-weight small labels.

**Menu cards**: `MenuItemCard`'s image area grew from a 1:1 square to
4:5, giving food more of the card. The "Available" dot/label present on
every single card was removed — it's always true (Day 9 excludes
unavailable items server-side), so restating it on every card was exact
badge-clutter the brief calls out. Featured/Popular badges became small
uppercase kickers over a short gradient, not solid pill badges.

**Item detail**: rebuilt around a full-bleed hero photo at the true top
of the page (not a rounded, margined card), with the content sheet
overlapping it via a rounded top edge and negative margin, and the Add
to Cart action moved to a sticky bottom bar for thumb reach instead of
an inline button positioned wherever the description's length pushed
it.

**Cart & Review**: item rows gained real food-photo thumbnails (via the
existing `ItemImage`, extended with an optional `imageUrl` on
`CartItem` — the only frontend "data" change today, populated from data
already in scope at every `addItem()` call site) and stronger
name/price hierarchy. Cart's empty state rebuilt as a considered visual
moment instead of a dashed placeholder box.

**Motion/interaction**: no new system — Day 23's primitives
(`animate-fade-slide-up`, `animate-scale-in`, `animate-pop`,
`PageTransition`) are reused throughout every redesigned surface
unchanged, which is what keeps the new look feeling like the same app
rather than a bolt-on.

**Not changed**: `CategoryTabs` (already had scrollspy + animated active
pill from Day 23 — genuinely nothing to fix), `CustomerBottomNav`,
`QuantityControl`, group-ordering screens (token-only from Day 21,
left alone today), all backend/API code.

### Tests
**Actually run**: `tsc --noEmit` clean, `next build` clean (24 routes,
sizes essentially unchanged), `next start` runtime check — all
redesigned routes (home, menu, item detail, cart, review, group, an
admin route) return 200. Code-level layout audit: 0 admin files
reference customer tokens (isolation intact); at most one fixed bottom
element outside cart/item-detail's intentional two (checkout bar/CTA
bar + nav, by design, matching Day 21's stacking pattern); the only
`overflow-visible` in the customer tree is the one documented, scoped
use in `ItemImage`'s float mode; truncation/wrap guards present on
every redesigned card and confirmed on the item-detail heading.

**NOT run — stated plainly per this task's explicit instruction**: this
environment has no real browser or device rendering capability
available to me (no screenshot/headless-browser tool, no display).
`curl`/`next start` confirm a route renders without a server error, not
that it looks correct at 375/390/430/768/1280px. **Visual rendering
could not be verified in a live browser in this environment** — code-
level verification and the audits above are not a substitute for
actually opening this on a device, and that remains the standing gap
this project has had since Day 1.

### Remaining visual work
- Real-device/browser check at the five target widths — the top
  priority, unchanged from every prior day's recommendation, and more
  important now given how much of today's work is visual/compositional
  rather than functional.
- Popular/recommendation card variant (`HomeItemCard`) still shares its
  base layout with the Featured rail card rather than having its own
  distinct compact/horizontal treatment (Part 9 of the brief allowed
  reusing one component "if it can handle it cleanly," which is the
  call made here — worth revisiting once real usage shows whether that
  reuse holds up).
- No dietary indicator on cards (brief mentioned this as optional/
  "if existing architecture supports it") — no such field exists on
  MenuItem, so nothing was added rather than fabricating one.
- Restaurant `secondaryColor`/`backgroundColor` branding fields
  mentioned in the brief don't exist in the schema (only
  `primaryColor`/`accentColor`/`logoUrl` do, per Day 22) — not invented
  today.

## Day 24 (fix) — Menu item images: missing Cloudinary config + 404 on image URL

**Reported**: photo uploads not working; pasted error was `Cannot GET
/restaurants/:restaurantId/menu-items/:itemId/image` (404).

**Two separate real issues found by inspection** (no live upload was
performed — see caveat below):

1. **`apps/api/.env` has no Cloudinary keys at all** — not placeholders,
   genuinely absent (only `DATABASE_URL`/`PORT`/`JWT_SECRET` are set).
   `cloudinary.config()` silently accepts `undefined` values; the actual
   failure only surfaces per-upload, as a `BadRequestException` wrapping
   whatever error Cloudinary's API returns (e.g. "Must supply
   api_key"). This is almost certainly the real cause of "not
   uploading." **Action needed on your end**: add real
   `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`
   to `apps/api/.env` from your Cloudinary dashboard (Settings → API
   Keys) — no code change can substitute for real credentials.
2. **The exact URL in the error has never had a GET handler.**
   `restaurants/:restaurantId/menu-items/:itemId/image` (no `/public`
   prefix) is the admin, JwtAuthGuard-protected mutation endpoint —
   POST to upload, DELETE to remove, same as every other resource in
   this API. Checked every place `imageUrl` is rendered in the
   frontend (menu grid, item detail, Home, cart, admin thumbnail/
   preview) and all of them correctly use the real Cloudinary URL
   returned by the API — nothing in this codebase constructs that
   mutation-endpoint path as an `<img src>`. Requesting it directly
   (browser address bar, manual check, a bookmark) was always going to
   404.

### Fixes made
- `main.ts`: logs a loud, explicit warning at API startup listing which
  Cloudinary env vars are missing, instead of the gap only being
  discoverable one failed upload at a time.
- New `GET /public/restaurants/:restaurantId/menu-items/:itemId/image`
  (`PublicMenuController`) — 302-redirects to the item's real Cloudinary
  URL, or a clean 404 ("This item has no image.") if none is set.
  Deliberately public and separate from the admin controller, matching
  this project's existing public/admin split (`PublicMenuController`,
  `PublicOrdersController`, `TableSessionsController`) — viewing an
  already-uploaded photo needs no admin session, and a plain `<img>` tag
  can't carry an Authorization header anyway. New
  `MenuService.getItemImageUrl()` backs it, reusing the existing
  `findMenuItemOrThrow` lookup.
- No frontend changes — nothing there was actually wrong.

### Tests
**Actually run**: `tsc --noEmit` and `nest build` clean (api); boot test
clean (starts, DI/schema wiring succeeds, blocks only on the
network-unreachable Atlas connection as always); the startup-warning
function itself verified standalone against three cases (all missing,
all present, one missing) since the real boot test never reaches past
the DB connection in this sandbox to actually print it; frontend
`tsc --noEmit` clean (untouched, confirmed nothing regressed).

**NOT run**: an actual image upload against a real Cloudinary account,
or a real browser request to the new redirect endpoint. Both require
real credentials and a reachable database/network that this sandbox has
never had, per every prior day's standing limitation. The redirect
endpoint's logic (service lookup → 302 vs. clean 404) was verified by
code review only.

### Remaining
- Real Cloudinary credentials still need to be added to `.env` by
  whoever owns that account — this is a configuration step, not
  something fixable in code.
- Once credentials are in place, an actual end-to-end upload test
  (admin form → Cloudinary → customer menu displaying the photo) is
  still unverified live, same standing gap as everything else in this
  project.

## Day 24 (fix, round 2) — the 404 was on the non-public path

Same error recurred on a second, different item after the first fix,
which only added the GET counterpart under
`/public/restaurants/:id/menu-items/:itemId/image`. The actual requests
are for the path **without** `/public` — `restaurants/:id/menu-items/
:itemId/image` — which is `MenuController`'s own admin path
(POST-upload/DELETE-remove, JwtAuthGuard-protected). Recurring across
different items means something in the deployed app consistently
requests that exact URL; rather than keep guessing which line, this
makes that literal URL work.

**Fix**: new `MenuImageRedirectController`, a separate class registered
on the same path prefix, GET-only, deliberately **not** behind
`JwtAuthGuard` — so the real admin controller's guard is never touched.
Also hardened `MenuService.getItemImageUrl()`: it now refuses to
redirect unless the stored `imageUrl` is a real `http(s)://` URL,
specifically to prevent a redirect loop if a stored value ever turned
out to be a self-referential path like this one instead of a real
Cloudinary URL — returns a clear 404 message in that case instead.

**Tests actually run**: `tsc --noEmit` and `nest build` clean; boot test
clean (no DI/route-registration error); a standalone Express simulation
confirming GET/POST/DELETE on the identical path resolve to their
correct, separate handlers with no collision; the URL-validation guard
tested against a real Cloudinary URL, null, the exact self-referential
bad value, and an old local-disk-style path — correct in all four
cases. **Not tested**: against the real, running app — I still don't
have access to what's actually issuing this GET request, so this fixes
the symptom (the URL now resolves) without confirming the root cause of
why something requests it.

If this doesn't fully resolve it: search the actual deployed frontend
for anywhere an image `src` is built by hand (e.g.
`` `${apiUrl}/restaurants/${id}/menu-items/${itemId}/image` `` or
similar string concatenation) instead of using the `imageUrl` field the
API returns — that's the remaining thing this session couldn't find,
since it isn't present in the code reviewed here.


## Day 25 — Premium Customer Experience 2.0
- Refined the existing customer frontend only; no new backend systems or admin redesign.
- Reworked Home hierarchy around restaurant identity, real customer greeting when authenticated, signature/real-popular/new discovery, and restrained editorial typography.
- Refined featured/menu cards with larger imagery, cleaner badge treatment, premium spacing, and shared motion.
- Refined category rail and bottom navigation with smoother active-state movement, blur, borders, and mobile-safe touch treatment.
- Elevated dish detail into an immersive product-style view with real featured/availability metadata and a premium sticky add-to-order CTA.
- Refined cart presentation, item hierarchy, quantity feedback, empty state, and sticky checkout composition.
- Extended shared customer motion/design tokens while preserving existing admin styles.
- Real data only: featured flags, order-derived popularity, menu content, branding, and authenticated customer name are sourced from existing APIs.

### Day 25 files changed
- `apps/web/app/globals.css`
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeItemCard.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeSection.tsx`
- `apps/web/app/menu/[restaurantId]/_components/MenuItemCard.tsx`
- `apps/web/app/menu/[restaurantId]/_components/CategoryTabs.tsx`
- `apps/web/app/menu/[restaurantId]/_components/CustomerBottomNav.tsx`
- `apps/web/app/menu/[restaurantId]/[itemId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/cart/page.tsx`

### Day 25 checks / limitations
- Customer frontend source was inspected before changes.
- TypeScript/build verification was attempted, but the extracted project did not include installed `node_modules`, so `next build` could not run in this environment (`next: not found`).
- The supplied `day 24 v2.zip` did not contain a separate AURA Bistro HTML file, so the requested reference could not be inspected directly; the implementation follows the stated AURA-inspired principles without copying its branding/assets.
- Visual browser/device verification was not available in this environment; code-level source verification was performed.

## Day 27 — Customer Home visual redesign (premium brand-first composition)
- Reworked the customer Home page composition instead of patching the previous card-heavy layout.
- Replaced the previous large dark hero treatment with a compact editorial brand stage: restaurant logo/monogram, real restaurant name, real customer greeting when authenticated, table context, and a restrained branded gradient driven by the existing restaurant branding fields.
- Added a floating search surface that overlaps the brand stage, reducing the feeling of separate dashboard-like sections.
- Redesigned category discovery into premium editorial tiles with restrained SVG line icons, real category names/counts, and contained horizontal scrolling.
- Refined group ordering into a quieter utility row using reusable SVG icons instead of emoji. Existing group-order logic is unchanged.
- Kept the real-data hierarchy intact: admin-featured items, real popular/order history, and real new-arrival timestamps only. No fake dishes, popularity, recommendations, or customer data were added.
- Refined Home section typography and spacing to use a stronger display/body hierarchy and more varied surface treatments.
- Updated the Home loading skeleton to mirror the new composition and reduce layout shift.
- Existing restaurant `logoUrl`, `primaryColor`, and `accentColor` values are consumed by the new top brand stage; when no logo exists, the restaurant initial is used as the neutral fallback.
- Added the minimum admin branding workflow around the existing Restaurant branding fields: authenticated manager-only GET/PATCH endpoint plus the restaurant Settings UI for logo URL and primary/accent colours. No new media/storage system was introduced.

### Day 27 checks
- Inspected the actual customer Home implementation and existing restaurant branding data flow before changes.
- TypeScript/TSX syntax transpilation checks passed for all modified customer Home files.
- Full `npm ci` / Next production build could not be completed in this sandbox because package installation requires unavailable network/package-cache access.
- Browser/device visual verification was not available; code-level verification was performed.

### Files changed — Day 27
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHero.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/CategoryGrid.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeSection.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeStates.tsx`
- `apps/web/app/menu/[restaurantId]/_components/GroupOrderBanner.tsx`
- `apps/web/app/menu/[restaurantId]/_components/icons.tsx`
- `apps/api/src/restaurants/restaurants.controller.ts`
- `apps/api/src/restaurants/restaurants.service.ts`
- `apps/api/src/restaurants/restaurants.module.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/restaurants/schemas/restaurant.schema.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/restaurants/[restaurantId]/settings/page.tsx`
- `docs/PROGRESS.md`

## Day 26 — Home page: immersive branded first viewport + scroll transition

Frontend-only (no backend changes — no hero/cover-image field exists on
Restaurant and the task explicitly says not to invent one; the branded
fallback path it describes was used instead, built entirely from
existing `logoUrl`/`primaryColor`/`accentColor`).

**New**: `HomeHero.tsx` — a full-first-viewport (`min-h-[86dvh]`) brand
introduction rendered above the existing Home content: restaurant logo
(or monogram fallback), a real greeting (+ the authenticated customer's
name when known, from the existing `customerAuthApi.me()` call already
on this page), the restaurant's name in large serif display type, and a
table-number chip — all real data, nothing hardcoded. Background is a
gradient built from the restaurant's own `primaryColor`/`accentColor`
(falls back to MnU's terracotta/sage), a subtle inlined-SVG grain
texture, and the existing `mnu-scrim` utility (which a Day 25 comment
already anticipated for exactly this) for text legibility — deliberately
not combining every technique the brief listed. Content staggers in
(logo → greeting → name → table chip → scroll cue) using the existing
`animate-fade-in`/`animate-fade-slide-up` utilities, not a new
animation system.

**Scroll transition**: a single passive, rAF-throttled scroll listener
computes one 0–1 `progress` value (scroll position ÷ hero height),
applied as inline `transform`/`opacity` to two layers only — the
background (slight zoom + scrim darkening) and the content (lifts and
fades). No scroll library, no per-frame layout thrashing, no
IntersectionObserver; re-renders are contained to this one component,
never the sections below it.

**`HomeHeader.tsx` restructured, not duplicated**: it previously showed
the same restaurant name/greeting the new hero now owns — kept would
have meant saying the restaurant's name twice on one screen. Trimmed to
what it's actually for: a "Discover the menu" marker + the categories/
dishes stat line + search/cart actions, i.e. exactly the wayfinding
utility a diner needs once they've scrolled past the introduction.

**`HomeSkeleton` updated to match**: the loading state's first block is
now hero-shaped (same `min-h-[86dvh]`, dark ground) instead of the old
compact header row, so nothing visibly jumps in height when the real
branded hero replaces it — same honest constraint as before: it can't
be branded with the restaurant's actual colour yet, since that arrives
in the same response being awaited.

**New**: `ChevronDownIcon` added to the existing `icons.tsx` (the hero's
static scroll cue — no bounce/loop, per the brief's own warning against
continuous motion).

### Files changed
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHero.tsx` (new)
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeStates.tsx`
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/_components/icons.tsx`

### Tests performed
`apps/web`: `tsc --noEmit` clean; `next build` clean — **24 routes,
unchanged from before this task** (confirms nothing else broke,
including group ordering, cart, and every admin route — none of which
were touched). No backend changes, so no API-side checks were needed.

**NOT performed**: live browser/device testing. Per this task's own
instruction, that is stated plainly rather than implied — the
375/390/430/768/1280px behavior above (hero sizing, safe-area padding,
scroll transition smoothness, type wrapping on a long restaurant name)
is verified from code/Tailwind-class review only, not by actually
rendering it.

### Remaining
- Real device/browser verification remains the standing gap across the
  whole project — today's scroll-transition math in particular (the
  `progress` calculation, the exact `translateY`/`opacity` curve) has
  never actually been watched play on a real phone.
- No restaurant-specific hero/cover photo field exists yet — if a
  future task wants an actual food/atmosphere photo behind the hero
  (rather than the branded colour-gradient fallback), that needs a new
  optional field on Restaurant plus an admin upload UI, deliberately not
  added today per the "don't invent backend, use the fallback" scope.

## Day 27 follow-up — Premium visual system + expanded restaurant theming
- Reworked the customer visual language toward the supplied editorial/glass reference: cinematic branded background, centered restaurant identity, large serif name, restrained glass controls, floating search, editorial category tiles, premium food cards, and a quieter floating navigation language.
- The restaurant admin can now control substantially more than primary/accent colours: background mode (`gradient`, `mesh`, `solid`, `image`), three gradient stops, gradient angle, background colour, background image URL, overlay colour/strength, card treatment (`glass`, `soft`, `solid`), surface colour, primary/muted text colours, button colour, hero eyebrow, and hero tagline.
- Added restaurant-level hero copy so the small top label and supporting line are configurable instead of hardcoded.
- Expanded the public restaurant branding response so the customer UI receives the same saved visual system. Existing restaurants remain backward-compatible through safe fallbacks.
- Added a reusable `CustomerTheme` wrapper so menu, dish detail and cart surfaces can inherit the restaurant theme rather than only the Home screen.
- Background image URLs are validated as HTTPS; colours are validated as hex values; gradient angle and overlay opacity are range-validated server-side.
- No new menu data, fake recommendations, fake popularity, AI, payments, or ordering logic was added.

### Day 27 follow-up checks / limitations
- Source-level TypeScript checks were run on the modified web/API files. The environment has no installed project dependencies, so module-resolution errors from missing `node_modules` remain; no new syntax error was observed in the modified files.
- Full Next/Nest production builds and browser/device visual verification were not available in this sandbox.
- The supplied visual reference was used as an inspiration for composition, spacing, glass surfaces, typography hierarchy, and cinematic background treatment; its branding, text, and assets were not copied.

### Day 27 follow-up files changed
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHero.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeItemCard.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeSection.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/CategoryGrid.tsx`
- `apps/web/app/menu/[restaurantId]/_components/branding.ts`
- `apps/web/app/menu/[restaurantId]/_components/CustomerTheme.tsx`
- `apps/web/app/menu/[restaurantId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/[itemId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/cart/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/lib/api.ts`
- `apps/web/app/restaurants/[restaurantId]/settings/page.tsx`
- `apps/api/src/restaurants/schemas/restaurant.schema.ts`
- `apps/api/src/restaurants/restaurants.service.ts`
- `apps/api/src/restaurants/restaurants.controller.ts`
- `apps/api/src/menu/menu.service.ts`
- `docs/PROGRESS.md`

## Day 27 visual correction — premium customer UI pass

The previous visual pass was reviewed against the supplied mobile screenshots. The screenshots exposed several concrete problems that were corrected:

- The customer page inherited the hero's white typography into light menu surfaces, producing very low-contrast / nearly invisible text. Customer surface text now has its own readable palette instead of inheriting hero text.
- Home contained two competing search/discovery bars. The hero now focuses on restaurant identity; one deliberate floating search bar owns menu discovery below it.
- Categories were oversized repeating cards. They are now compact editorial pills with icon, item count, and restrained interaction.
- Group ordering looked like another generic white card. It is now a compact dark premium action surface.
- Food sections repeated the same visual card treatment too aggressively. Home discovery cards now use a larger editorial food tile with cleaner information hierarchy.
- The menu grid had the same washed-out typography problem and excessive card treatment. Menu cards now use high-contrast typography, cleaner image framing, restrained badges, and stronger image-to-content hierarchy.
- Menu header, category navigation, dish detail, and cart were brought into the same dark-atmosphere / warm-surface visual language.
- Dish detail was refined into an image-led product experience with a floating back control, overlapping content sheet, compact quantity control, and premium sticky CTA.
- Cart was redesigned as a product-order surface rather than a utility list; empty cart now uses an icon-based designed state instead of an emoji.
- Bottom navigation and cart summary were tightened into one consistent dark floating control language.
- Restaurant admin visual identity now includes five starting atmosphere presets — Noir, Terracotta, Olive, Cream, Espresso — while retaining manual background mode, three gradient stops, angle, image overlay, surface, typography, accent, button, and card-treatment controls. Presets are starting points; administrators can continue to customize the individual values.

### Day 27 visual correction files changed
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHero.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/CategoryGrid.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeSection.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeItemCard.tsx`
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/_components/GroupOrderBanner.tsx`
- `apps/web/app/menu/[restaurantId]/_components/MenuHeader.tsx`
- `apps/web/app/menu/[restaurantId]/_components/CategoryTabs.tsx`
- `apps/web/app/menu/[restaurantId]/_components/MenuItemCard.tsx`
- `apps/web/app/menu/[restaurantId]/_components/CustomerBottomNav.tsx`
- `apps/web/app/menu/[restaurantId]/_components/branding.ts`
- `apps/web/app/menu/[restaurantId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/[itemId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/cart/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/app/restaurants/[restaurantId]/settings/page.tsx`

### Verification / limitation
- The uploaded screenshots were used as visual QA references for hierarchy, contrast, density, spacing, and mobile composition.
- `tsc --noEmit` was run after the correction. The earlier syntax error in dish detail was fixed; remaining TypeScript output is dominated by missing project dependencies/types because `node_modules` is not installed in this sandbox.
- Full production build and real browser/device rendering were not available, so no browser-rendering claim is made.


## Day 28 — Premium customer experience redesign ("Atelier")

### Frontend
**Screens created/modified**
- Home (`menu/[restaurantId]/home`), Menu (`menu/[restaurantId]`), Item detail (`[itemId]`), Cart (`cart`), Review / place order / confirmation (`review`). Loading skeletons for Home and Menu.

**Components created**
- `_components/DishCards.tsx` (LeadDishCard, PortraitDishCard "arch", DishRow)
- `_components/MenuSection.tsx` (per-category editorial spread)
- `_components/Reveal.tsx` (scroll-triggered reveal)
- `_components/StageLayout.tsx` (shared frame for Cart / Review / Confirmation)
- `lib/flyToCart.ts` (add-to-cart animation helper)

**Components modified**
- `HomeHero`, `HomeHeader`, `HomeSection`, `CategoryGrid`, `HomeItemCard` (arch / ranked / wide variants), `FeaturedHeroCard` (layered "Chef's pick"), `QuantityControl`, `CategoryTabs`, `MenuHeader`, `CustomerBottomNav` (single floating cart pill + `data-cart-target`), `ItemImage` (fade-in, `dark` fallback), `GroupOrderBanner` (two-line text), `MenuStates` / `HomeStates` skeletons, `branding.ts` (softer default stage gradient derived from primary colour; saved admin gradients unchanged), `globals.css` (Day 28 tokens/utilities).
- Removed `MenuItemCard.tsx` (unused after rewrite).

**UI/UX changes**
- Dark branded stage + warm sheet; serif display type; the arch as signature shape; whitespace instead of borders; one dish presentation per role (lead / arch / row / ranked / wide) so the menu has hierarchy.
- Home hero compact (~1/3 of first screen at 390x844) with blurred real dish photo as ambient layer; category tiles use real photos from their own dishes.
- Menu: editorial title, sticky category strip that follows the scrollspy, alternating lead-card / arch-carousel spreads, flat list for search.
- Item: parallax hero, quantity stepper, "Pairs well" rail (same-category real items), sticky CTA.

**Responsive**
- Designed for 375 / 390 / 430; safe-area padding; touch targets >= 40px; max-width containers for larger screens (desktop not separately designed).

**Animations / interactions**
- Staggered hero entrance, scroll reveals, fly-to-cart dot + cart pulse, pop on count change, sliding nav indicator, animated totals, cart-line collapse on remove, drawn checkmarks, shimmer skeletons, hero/item parallax. All respect `prefers-reduced-motion`.

### Backend
- No backend/API changes. No database or schema changes.

### Customer Experience
- **Home:** brand -> Chef's pick -> categories -> Signature / Most ordered / New rails -> group order + full menu CTA. Rails hide when no real data exists (no fake popularity).
- **Category/menu:** each category is an edited spread; featured/popular labels (one per dish max).
- **Order placement:** Menu/Item -> Cart -> Review (OTP gate unchanged) -> Place order -> Confirmation, all in the same visual frame. Existing table gating, group-order redirect and cart storage unchanged.

### Testing (only what was actually run)
- `tsc --noEmit` on apps/web: clean after final edits.
- `next build` (apps/web): compiled successfully.
- Browser test with Playwright/Chromium at 390x844 and 375x667 (Home), 430x932 and 1280x800 (Home, Menu) against a MOCK API (not the real Nest/Mongo backend): Home, Menu, add/stepper, category jump, search, Item, Cart, remove, Review, place order (mock POST), Confirmation. No page errors; horizontal overflow 0 on all measured pages.
- NOT run: ESLint, API build, tests against real MongoDB API, OTP verification, real-device/Safari testing. Not every screenshot was visually inspected (Pairs-well rail, cart-removal frame, Review step, search, 375/430/desktop shots were not).

### Known Limitations
- Image-less dishes fall back to an emoji tile; design depends on real photography.
- Desktop layout is basic; no real-device testing.
- `CustomerAuthPanel` and group pages keep old internal styling.
- Fly-to-cart only shows when a cart target is on screen.
- No dish options/modifiers (none exist in data).

### Recommended Next Task
- Run the redesign against the real API with real photography and complete an end-to-end pass (OTP, order placement, group order) on real devices; then restyle `CustomerAuthPanel` and group screens into the same system.

### Day 28 — Revision after design feedback

**Changes**
- Stage background: default palette is now a neutral deep espresso (no orange/salmon); default accent is a muted brass. Any saved stage colour brighter than a dark threshold is automatically deepened (hue kept) in `branding.ts` so bright brand gradients can no longer wash out the menu.
- Chef's pick: rewritten to picture + dish name + one small add icon (no frame, panel, border, description or cart-style pill).
- Home categories: replaced the tile carousel with a numbered index list (real-photo thumbnail, name, dish count); first 4 shown, the rest collapse behind an animated "Show all N / Show less" toggle.
- Add control: reduced to a 36px circle (stepper 32px buttons, larger invisible hit area) and moved off the photographs — it now sits on the price line in rows, arch cards, rail cards and the lead card.
- Responsiveness: menu payload is cached in memory with in-flight de-duplication (`menuApi.peekPublicMenu`), so navigating Home/Menu/Item paints instantly instead of showing a skeleton; removed `background-attachment: fixed` and all `backdrop-filter` blurs from customer screens; added `touch-action: manipulation`; hero/item parallax now mutates styles via refs instead of re-rendering React each scroll frame; hero ambient blur is static.

**Testing (actually run)**: `tsc --noEmit` clean; `next build` compiled; Chromium/Playwright at 390x844 against the MOCK API: home->menu 80ms, add tap->stepper 47ms, menu->item 123ms, horizontal overflow 0, no page errors. Not tested: real backend/network latency, real devices, ESLint.
**Backend**: none. **Limitation**: the mock uses placeholder images; real photography should be reviewed for the hero ambient layer.

### Day 28 — Second revision after design feedback

**1. Background gradient looked patchy/blotchy on real restaurant data**
- Root cause found: the Home hero blurred the restaurant's own dish photo as an "ambient" background layer (`HomeHero`'s `ambientImageUrl`). For a small, icon-style, or gradient-only image (e.g. the Ice Cream Parlour screenshot), blurring and scaling it up produced visible blobby artifacts — that was the bad texture in the feedback screenshot, not the gradient math.
- Fix: removed the per-dish ambient photo layer entirely. Added `_components/StageBackdrop.tsx` — a single, self-contained premium background (soft directional glow, fine static grain, a faint arch watermark) used on every dark stage (Home hero, Menu header). It never depends on a restaurant's photography, so it looks the same, reliably, for every restaurant.

**2. "One premium default theme"**
- The no-branding-set palette was already a single fixed set of colours; the visible defect was the ambient-image patchiness above, now removed. `StageBackdrop` is that one consistent premium look. Any restaurant-supplied stage colour brighter than a dark threshold is still auto-deepened (hue kept) so a bright saved gradient can't wash out the menu.

**3. Category tabs looked like a "news ticker" bar, with a bad gap below it**
- Rewrote `CategoryTabs.tsx`: tabs are no longer solid pill chips on a separate dark banner. They're quiet text tabs with a sliding underline, rendered directly on the cream sheet (same surface as the dish list), sticky when scrolling. Moved the component from between the dark header and the cream `<main>` to inside `<main>` itself, and removed the `-mt-1` offset hack — there is no longer a seam or gap between the tabs and the content for any scroll position, by construction (they're the same element tree/surface).

**4. Add (+) icon placement**
- Confirmed already fixed in the prior revision (icon sits beside the price on every card/row, never floating over the photo) — the screenshots showing it "in odd places" matched the pre-Day-28-revision layout. No further code change needed here beyond re-verifying with a fresh screenshot pass.

**5. "Still loading" between pages**
- Hardened the existing in-memory menu cache with a `sessionStorage` fallback (`lib/api.ts`), so a hard/full page reload (not just client-side `<Link>` navigation) can also paint instantly from the last-known menu while a fresh copy loads silently in the background.
- Re-measured client-side navigation against the mock API: Home→Menu 78ms, Menu→Home 51ms, both from warm cache, no visible skeleton flash.
- Noted: the plus-icon and gradient issues in the feedback screenshots match the FIRST Day 28 zip, not the revised one already delivered — flagged this to the user directly, since it means their environment may not yet be running the latest build.

**Testing (actually run)**: `tsc --noEmit` clean, `next build` compiled, Chromium/Playwright pass at 390×844 against the mock API (screens above), 0 horizontal overflow, 0 page errors, nav timings above. Not tested: real backend, real devices, ESLint, other viewport widths in this pass.
**Backend**: none. **Known gap**: still validated against mock/placeholder images, not the restaurant's real uploaded photos.

## Day 29 — Security Audit Part 1 (authentication + secret management only)

Scope, per today's task: audit only. No new features, no rate limiting,
no authorization/role audit, no MongoDB/deployment/frontend security —
those are separate future tasks. Nothing in the codebase was rebuilt.

### What was inspected
`auth/jwt.util.ts`, `auth/jwt-auth.guard.ts`, `auth/auth.service.ts`,
`auth/auth.controller.ts`, `users/schemas/user.schema.ts`,
`customers/customer-auth.service.ts`, `customers/customer-auth.guard.ts`,
`customers/customer-auth.controller.ts`,
`customers/schemas/otp-challenge.schema.ts`, `common/cloudinary.ts`,
`main.ts`, `apps/api/.env` / `.env.example` (keys only — no values
reproduced anywhere in this audit), plus a repo-wide grep for
hardcoded-secret-shaped string literals in `apps/api/src` and
`apps/web`.

### Findings

**CRITICAL**
1. **OTP codes are returned directly in the API response.**
   `CustomerAuthService.requestOtp()` returns a `devOtp` field containing
   the real 6-digit code, unconditionally, on the public/unauthenticated
   `POST /public/customer-auth/otp/request` endpoint. Anyone who can call
   that endpoint for any mobile number or email receives the real
   verification code back directly — no interception of an SMS/email is
   needed, which defeats the purpose of OTP verification entirely. This
   was already flagged in the code's own comment as a dev-only
   convenience that "must be removed ... before any real launch," but it
   is not currently gated behind any environment check, so it is live in
   every environment as written. **Not fixed today**: no real SMS/email
   provider exists yet in this project (adding one is explicitly out of
   scope for this task), and there is currently no `NODE_ENV`/deployment
   flag anywhere in the codebase to safely gate this on — adding one
   blind, without a way to run the app in this session to confirm login
   and the OTP flow still work, was judged not a safely-small change.
   **Recommended next security task, top priority.**

**MEDIUM**
2. **CORS is fully open.** `main.ts` calls `app.enableCors()` with no
   options, which allows requests from any origin. Practical risk today
   is limited because auth uses Bearer tokens in the `Authorization`
   header rather than cookies (so a malicious page can't silently ride
   an existing session), but it's a wider default than needed. Recommend
   restricting to the real frontend origin(s) via
   `enableCors({ origin: [...] })` before any real deployment.
3. **No rate limiting on OTP requests.** `POST
   /public/customer-auth/otp/request` is public and unthrottled.
   Explicitly deferred to a later task per this task's own scope, but
   flagged because it compounds Finding 1 — currently anyone can
   free-enumerate OTP codes for any destination with no limit.
4. **`User.passwordHash` has no `select: false`.** Every current response
   in the codebase is hand-built with only `id`/`name`/`email` (no leak
   found in practice), but the schema itself doesn't enforce that — a
   future `.find()`/`.findOne()` without explicit projection would
   include the hash. Recommend adding `select: false` to
   `User.passwordHash` (and `OtpChallenge.otpHash`) as defense-in-depth.
   Not done today: doing this correctly also requires updating
   `AuthService.login()` to explicitly `.select('+passwordHash')`, and
   this session has no way to run the app to confirm login still works
   after the change.

**LOW**
5. `POST /auth/register` returns "Email already in use." on a duplicate
   email — a standard account-enumeration pattern. `login()` correctly
   uses a generic "Invalid email or password." either way. Consider a
   generic register response too if enumeration matters for this
   product; this is common/accepted practice for many products as-is.

**PASS**
6. Passwords are hashed with bcrypt (cost factor 10) in
   `AuthService.register()`; never stored or returned in plaintext; no
   response payload anywhere in the codebase includes `passwordHash`.
7. JWT secret is read exclusively from `process.env.JWT_SECRET`
   (`jwt.util.ts`); no hardcoded fallback; the app throws a clear error
   if it's unset rather than silently defaulting to something weak.
8. JWTs have expiration (7d staff, 30d customer) and are verified
   (signature + expiry) via `jsonwebtoken`'s `verify()`; invalid,
   expired, or tampered tokens are caught and rejected with 401 by both
   `JwtAuthGuard` and `CustomerAuthGuard`.
9. Staff and customer tokens are structurally distinguished (a
   `type: 'customer'` discriminator on the customer payload), so a
   customer token cannot be used against staff-only routes or vice
   versa.
10. OTP codes are hashed (bcrypt) at rest — never stored in plaintext —
    time-limited (5 min TTL, plus a Mongo TTL index for housekeeping
    cleanup), attempt-limited (max 5 tries before the challenge is
    invalidated), and single-use (`consumedAt`).
11. Secrets (`JWT_SECRET`, `DATABASE_URL`, Cloudinary credentials) are
    read exclusively from `process.env` — no hardcoded literals found
    anywhere in `apps/api/src` or `apps/web` in a repo-wide grep.
    `.env` is excluded from git via `.gitignore`; `.env.example` ships
    placeholder-only values.

### Secret safety
No secret values are reproduced anywhere in this audit or in
`docs/PROGRESS.md`. Where `.env` was inspected, only key names were
checked, never printed.

### Small fixes made today
None. All findings above are documented rather than fixed — this
session has no way to install dependencies or run the app
(`node_modules` absent in this sandbox), so no code change could be
confirmed not to break login/OTP/customer sessions before being
recorded as "fixed." Per this task's own instruction, findings that
aren't safely-small were documented instead of expanding today's scope.

### Tests
**TESTED:** nothing — no automated test suite exists in this project
(`find . -iname "*.spec.ts"` returns zero results across the whole
repo), and `node_modules` is absent in this sandbox, so `tsc`/`build`
could not be run either.
**NOT TESTED:** runtime behavior of any kind — login, registration, JWT
verification, OTP request/verify, all guards.
**CODE REVIEW ONLY:** every finding and PASS above. This is the same
standing limitation as every prior session: nothing in this project has
ever been verified against a live, running instance in this sandbox.

### Known limitations
- No live MongoDB, ever, in this project's history (see all prior
  reports) — unchanged today.
- No automated tests exist for authentication, JWT, or OTP — today's
  audit is code review only, not regression coverage.
- Authorization/role-based access control (who can call which endpoint
  once authenticated) was explicitly out of scope today and has not
  been audited.

### Recommended next security task
1. **Gate or remove `devOtp`** (Finding 1, CRITICAL) — the top priority.
   Requires first deciding how "production" is identified in this
   project (a `NODE_ENV` convention doesn't exist yet) or wiring a real
   SMS/email provider, then removing the field from the response and
   confirming login + OTP still work end-to-end.
2. Add rate limiting to `/public/customer-auth/otp/request` and
   `/auth/login` (Finding 3), once the task scope includes it.
3. Restrict CORS to known frontend origin(s) (Finding 2) before any real
   deployment.
4. Add `select: false` to `passwordHash`/`otpHash` with a matching
   `AuthService.login()` update, verified against a running app
   (Finding 4).
5. Authorization/role-based access control audit (deliberately not done
   today).


## Day 30 V2 — Customer Name — Remaining Work

### Day 30 v1 status
- Day 30 v1 correctly reused the existing global `Customer` MongoDB model and optional `name` field.
- The authenticated customer JWT/session, `GET /public/customer-auth/me`, authenticated name-update endpoint, OTP → name flow, and existing-customer prompt were already implemented.
- Existing customers without a name remained valid without a migration, while existing names were not overwritten by authentication.

### Remaining work discovered
- The v1 name validation was authoritative in `CustomerAuthService`, but the Mongoose `Customer` schema itself did not enforce the same name constraints. That meant another backend write path could theoretically persist an invalid name while still bypassing the intended customer-name rules.
- Session restoration and name retrieval were already correctly handled by the existing customer token + `GET /public/customer-auth/me` flow, so no duplicate session/cache logic was needed.

### Changes made in v2
- Strengthened `apps/api/src/customers/schemas/customer.schema.ts` with model-level name normalization and validation.
- The existing `Customer.name` field now trims/collapses whitespace and enforces the same 2–80 character Unicode-name rules used by the customer auth service.
- Kept the existing authenticated `POST /public/customer-auth/me/name` endpoint and frontend flow unchanged because they already satisfy the required customer-name behavior.
- No new customer model, authentication system, session mechanism, API, or restaurant-specific identity record was introduced.

### Customer-name flow status
- New customer: OTP verification → name required → authenticated customer session.
- Existing customer with name: OTP verification → existing name returned → no replacement prompt.
- Existing customer without name: authenticated Home flow can show the existing `CustomerNamePrompt`; the customer can add a name without migration.
- Page refresh/session restoration: existing customer token is restored from `localStorage`, then `GET /public/customer-auth/me` retrieves the current name from MongoDB.
- Returning customer at the same restaurant: the same global customer identity is reused; restaurant context remains in the existing restaurant/menu route and is not used to create duplicate customer records.

### Files/components changed
- `apps/api/src/customers/schemas/customer.schema.ts` — model-level customer-name normalization/validation.
- `docs/PROGRESS.md` — this Day 30 V2 record.

### Tests
**TESTED:** static/code-path checks confirmed the existing customer model, customer JWT/guard, authenticated `me` retrieval, name update endpoint, OTP → name flow, existing-customer handling, Home profile prompt, and name display path. Schema-level validation code was reviewed for normalization, length, and Unicode character constraints.

**NOT TESTED:** live MongoDB persistence, live OTP delivery, browser interaction, page-refresh runtime behavior, and full end-to-end authentication. The supplied project has no installed `node_modules` and the previously documented environment cannot connect to a real MongoDB instance.

**CODE REVIEW ONLY:** restaurant isolation and cross-restaurant identity behavior. The architecture intentionally keeps `Customer` global; authenticated customer ID comes only from the customer token, while restaurant context remains separate.

### Remaining customer-name issues
- No known incomplete customer-name implementation remains within today's scope.
- Real OTP delivery remains outside this task and is unchanged.
- Live runtime verification against MongoDB is still an environment limitation.

## Day 30 — Customer Name & Customer Identity

### What already existed
- Customer identity already uses the existing `Customer` MongoDB model in `apps/api/src/customers/schemas/customer.schema.ts`.
- The model already had an optional `name` field, so no duplicate identity model or schema field was created.
- Customer authentication already uses the passwordless mobile/email OTP flow in `CustomerAuthService`, with a separate customer JWT/session and the `CustomerAuthGuard`.
- `GET /public/customer-auth/me` already exposed the authenticated customer profile, including `name`.
- The customer Home page already retrieved the authenticated customer through `customerAuthApi.me()` and passed the name to `HomeHero`, so the display foundation already existed.

### Changes made
- Kept the existing `Customer.name` field and existing customer identity/session architecture.
- Added an authenticated `POST /public/customer-auth/me/name` endpoint.
- Added backend name validation: trimmed/normalized whitespace, 2–80 characters, Unicode letters/marks plus common name punctuation.
- The endpoint derives the customer identity exclusively from the authenticated customer token; the client cannot select another customer ID.
- Added `customerAuthApi.updateName()` to the existing customer API client.
- Extended the existing `CustomerAuthPanel` with a name step after successful OTP verification when the authenticated customer has no name.
- Customers who already have a valid name skip the name step and continue unchanged.
- The same existing auth panel is reused by checkout/group-entry flows; no second customer identity flow was created.
- Existing customers without a name can therefore add it when they next authenticate through an existing customer-facing auth flow.

### Existing-customer handling
- `Customer.name` remains optional, so old records without a name do not require a migration.
- Existing non-empty names are never overwritten by the OTP flow.
- The name update endpoint only updates the currently authenticated customer's own record.

### Frontend
- Added a focused, mobile-first name input with autocomplete, character limit, validation/error display, loading state, and disabled submission until the minimum input is met.
- No broader customer menu redesign was made.
- Existing Home personalization remains the display surface: `customerAuthApi.me()` supplies the name to `HomeHero`.

### Validation
- Backend validation is authoritative; frontend constraints are only UX assistance.
- Name normalization collapses repeated whitespace before storage.

### Testing
**TESTED:** static source checks for the existing Customer model, customer JWT/guard flow, existing `me` retrieval, name field usage, new name endpoint/client wiring, and the customer auth panel flow. Verified no second customer model or alternate customer-token mechanism was introduced.

**NOT TESTED:** live MongoDB persistence, real OTP delivery, live authentication/session behavior, browser interaction, or end-to-end runtime tests. This sandbox has no installed `node_modules`/live backend, consistent with Day 29's documented limitation.

**CODE REVIEW ONLY:** restaurant/tenant isolation of the customer identity path and the new endpoint; it uses the existing global customer identity and authenticated customer ID rather than accepting restaurant or customer IDs from the client.

### Known limitations
- Real SMS/email OTP delivery remains a separate task; the existing development OTP behavior documented on Day 29 was not changed.
- No dedicated customer profile page was introduced because the existing Home/profile personalization path was sufficient for today's focused customer-name task.
- Existing unrelated security findings from Day 29 remain documented and were not expanded into today's scope.

## Day 31 — Customer Order History + Order Status

### Existing implementation reused
- The existing `Order` MongoDB model already stores `restaurantId`, `customerId`, `tableNumber`, order-number, item/price snapshots, subtotal, total, lifecycle status, timestamps, and optional group-order information.
- Customer order creation already required `CustomerAuthGuard`, so new orders were already associated with the authenticated customer rather than a client-supplied customer id.
- The existing lifecycle is `NEW → CONFIRMED → PREPARING → READY → COMPLETED`, with `CANCELLED` reachable from non-terminal states. The existing restaurant order screen already persists status changes through `PATCH /restaurants/:restaurantId/orders/:orderId/status`.
- `listCustomerOrdersForRestaurant()` already existed, but it is a **restaurant-staff authenticated** endpoint under `/restaurants/:restaurantId/customers/:customerId/orders`; it was not appropriate for the diner because it accepts a customer id in a staff context. Day 31 adds customer-authenticated reads rather than reusing that API incorrectly.
- The existing order confirmation used the create-order response but did not retain the Mongo order id, so a persistent tracking route could not be opened directly from confirmation. The create response was extended with the existing order `_id` only.

### Backend changes
- `apps/api/src/orders/orders.service.ts`
  - Added `listOwnOrdersForRestaurant(restaurantId, customerId)` using the authenticated customer id and `{ restaurantId, customerId }` filtering.
  - Added `getOwnOrderForRestaurant(restaurantId, orderId, customerId)` using `{ _id, restaurantId, customerId }` ownership filtering.
  - Added a customer-specific serializer that returns only the customer's necessary order information: restaurant, table, items, totals, status, timestamp, group code, and the customer's own name.
  - Cross-customer and cross-restaurant order ids resolve as `Order not found`, preventing an ownership/id oracle and preventing disclosure of another customer's order.
  - Extended the existing create-order confirmation payload with `id`; no new order model or parallel order lifecycle was introduced.
- `apps/api/src/orders/public-orders.controller.ts`
  - Added customer-authenticated `GET /public/restaurants/:restaurantId/orders` for the current customer's restaurant-scoped history.
  - Added customer-authenticated `GET /public/restaurants/:restaurantId/orders/:orderId` for the current customer's order details/tracking.
  - Existing `POST` order creation and public `GET /popular` remain unchanged.

### Frontend changes
- `apps/web/lib/api.ts`
  - Added `CustomerOrderRecord` / `CustomerOrderHistoryResponse` types.
  - Added `ordersApi.customerHistory()` and `ordersApi.customerOrder()` using the existing customer session token mechanism.
  - Extended `OrderConfirmation` with the returned order id.
- `apps/web/app/menu/[restaurantId]/orders/page.tsx`
  - Added mobile-first customer Order History.
  - Shows order number, date/time, table, item count, total, status, and `View order` action.
  - Includes loading, empty, error/retry, and customer-authentication states.
- `apps/web/app/menu/[restaurantId]/orders/[orderId]/page.tsx`
  - Added customer order details/tracking screen.
  - Shows restaurant, order number, date/time, table, customer name, item quantities/prices, subtotal, total, and current status.
  - Active orders poll every 10 seconds through the authenticated detail API.
  - Polling stops automatically for `COMPLETED` and `CANCELLED`.
  - Includes not-found/unauthorized-style handling without exposing another customer's order.
- `apps/web/app/menu/[restaurantId]/orders/_components/OrderStatusTimeline.tsx`
  - Added the customer-facing status timeline for the existing lifecycle.
  - Handles `CANCELLED` and unknown/unexpected runtime statuses safely.
- `apps/web/app/menu/[restaurantId]/review/page.tsx`
  - Existing successful confirmation now links directly to `Track order` using the returned order id.
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHeader.tsx`
  - Added a small `Orders` entry point without redesigning the customer menu.
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
  - Wires the existing Home header to the restaurant-scoped customer Order History route.

### Statuses supported
- `NEW` — Order placed
- `CONFIRMED` — Accepted
- `PREPARING` — Preparing
- `READY` — Ready
- `COMPLETED` — Completed/final
- `CANCELLED` — Cancelled/final
- Unexpected runtime status — shown as an unavailable-status state rather than silently mapped to a false lifecycle step.

### Security / isolation
- Customer read endpoints use `CustomerAuthGuard` and `CurrentCustomerId()`; no customer id is accepted from the frontend for ownership.
- Order detail queries require all three identifiers: order id, restaurant id, and authenticated customer id.
- History queries require both restaurant id and authenticated customer id.
- Customer PII is limited to the customer's own name on the customer-facing order payload.
- Existing restaurant/admin authentication and status-update endpoints were not changed.
- No second customer identity or order API architecture was introduced.

### Testing
**TESTED:** static/code-path checks confirmed the new customer history/detail methods, customer-authenticated routes, `{ restaurantId, customerId }` history filtering, `{ _id, restaurantId, customerId }` detail ownership filtering, order-id propagation from confirmation, customer API wiring, status timeline, active-order polling, terminal polling stop, confirmation tracking link, and Home Order History entry point.

**NOT TESTED:** live MongoDB persistence, real customer authentication/OTP, browser/mobile interaction, real restaurant status changes, cross-user requests against a running API, full end-to-end QR → order → status → history flow, and production builds. The archive has no installed `node_modules`; the sandbox also cannot download the project's `pnpm` package manager because registry DNS/network access is unavailable. `npm run build` could not execute because `next`/`nest` are not installed in the supplied environment.

**CODE REVIEW ONLY:** restaurant isolation, customer ownership checks, status lifecycle compatibility, session persistence behavior, and final-state polling behavior.

### Known limitations
- Real-time infrastructure was not added. The customer tracking page uses lightweight 10-second polling because no existing WebSocket/SSE order-update infrastructure was found. Polling stops at terminal states.
- Charges, taxes, and discounts are not invented or added; the existing order model currently supports only stored subtotal/total, so customer screens display those existing values.
- Real OTP remains outside Day 31 scope and is unchanged.
- Live runtime verification against MongoDB remains an environment limitation documented by earlier days.

## Day 32 — Dashboard Week / Month Filter
- Added a focused **Period** control to the existing restaurant dashboard with:
  - `This Week` (default)
  - `This Month`
- Reused the existing `/restaurants/:restaurantId/analytics/dashboard` endpoint; it now accepts `?period=week|month` rather than creating a second analytics API.
- Backend remains the source of truth for period boundaries and filtering.
- Week definition: Monday 00:00 through the current application-local date/time.
- Month definition: first calendar day of the current month 00:00 through the current application-local date/time.
- Dashboard timezone is centralized as `APP_TIMEZONE`, then Node `TZ`, with `Asia/Kolkata` as the current application default because the restaurant model does not yet store a timezone. `apps/api/.env.example` documents the setting.
- Date-dependent existing metrics changed with the period: **Sales**, **Orders**, and the daily **Sales trend**.
- Existing metrics that were intentionally not date-scoped remain unchanged: **Average Order Value** (all-time, excluding cancelled), **Active Orders** (current queue), **Completed Orders** (all-time), **Top-selling Items** (all-time), and **Recent Orders** (latest orders). No new KPI was invented.
- Switching periods updates the analytics request without a full-page reload and shows the existing skeleton/loading behavior while data is refreshed. Retry is available on analytics failure.
- Trend chart remains the existing lightweight bar chart; month view is horizontally scrollable on small screens and shows a no-data state when the selected period has no orders.
- Restaurant isolation remains enforced by the existing `requireMembership(restaurantId, userId)` path before analytics are calculated; query parameters do not select another restaurant.

### Day 32 checks
**TESTED / CODE-LEVEL**
- Verified `week` and `month` are the only accepted analytics periods.
- Verified the existing authenticated restaurant membership check remains the first backend authorization step.
- Verified both period sales/orders and trend use the same centralized period start and exclude cancelled orders, matching the existing analytics semantics.
- Verified date-boundary logic with a runtime smoke test for `Asia/Kolkata`: on 2026-09-26, week starts at Monday 2026-09-21 00:00 local and month starts at 2026-09-01 00:00 local.
- Verified frontend period switching changes only the analytics request and preserves the dashboard layout.
- Verified empty-period trend state and retry/loading paths in code.

**NOT TESTED**
- Live MongoDB aggregation results.
- Browser/mobile interaction against a running application.
- Full restaurant A/B isolation request test against a live API.
- Production build.

**BUILD LIMITATION**
- `npm run build` was attempted for both `apps/api` and `apps/web`, but both commands exited with `127` because this supplied project archive has no installed `node_modules` (`nest: not found`, `next: not found`). This is an environment limitation, so production-build success is **not claimed**.

### Known limitations
- Restaurant timezone is not currently stored in the restaurant model. Day 32 therefore uses the centralized application timezone setting rather than inventing a per-restaurant timezone.
- No unrelated analytics, customer, payment, OTP, POS, Super Admin, or UI redesign work was performed.

## Day 34 — Dashboard Graph Repair & UI Formatting

### Inspection / root cause
- Read this `PROGRESS.md` and inspected the current restaurant dashboard, `TrendChart`, dashboard API types/request, analytics controller, and `OrdersService.getDashboardAnalytics()`.
- The existing Week / Month API response shape is internally consistent: the backend returns `trend[]` points as `{ date, sales, orders }`, and the frontend consumes those same properties. No response-property mismatch or duplicate analytics API was found.
- The graph failure was in the frontend rendering layer: the existing chart depended on nested `h-full` / percentage-height flex sizing inside a horizontally scrolling container, with no runtime validation of the trend payload. That made the plot sizing fragile and allowed malformed/undefined points to affect rendering.
- The existing backend analytics aggregation remains the source of the graph data; no new metric or API was introduced.

### Frontend changes
- `apps/web/app/restaurants/[restaurantId]/dashboard/_components/TrendChart.tsx`
  - Repaired the existing sales-trend visualization without changing its meaning.
  - Replaced fragile percentage-height flex bars with a responsive SVG plot using the same real daily `sales` values and existing `orders` tooltip information.
  - Validates dates and numeric values before rendering and safely normalizes invalid/negative runtime values.
  - Keeps a stable chart height, responsive width, horizontal scrolling for longer month ranges, accessible chart labeling, and per-point hover titles.
  - Shows `No data available for this period.` instead of rendering a broken/empty chart.
- `apps/web/app/restaurants/[restaurantId]/dashboard/_components/MetricCard.tsx`
  - Standardized KPI card height, padding, typography, truncation, borders, and subtle shadow treatment.
- `apps/web/app/restaurants/[restaurantId]/dashboard/page.tsx`
  - Kept the existing Week / Month filter and request flow unchanged.
  - Improved hierarchy to header → Performance/period control → KPI cards → main sales graph → secondary analytics.
  - Expanded the dashboard content width while preserving responsive behavior.
  - Rebalanced secondary analytics into paired cards on larger screens and stacked cards on smaller screens.
  - Preserved existing loading, retry/error, KPI, top-items, recent-orders, quick-action, status, and getting-started content.
  - Active period control now uses the existing MnU terracotta token; no new dashboard metric or filter was added.

### Week / Month behavior
- `This Week` and `This Month` remain the only dashboard period choices.
- Changing the period still sends `period=week|month` to the existing restaurant analytics endpoint.
- The dashboard clears the previous analytics state before each request, so stale graph/KPI data is not retained while the new period loads.
- Backend period boundaries remain calendar-based: Monday 00:00 → current time for week, and first day of the calendar month 00:00 → current time for month, using the existing centralized application timezone.
- The graph consumes the same backend-selected period and daily buckets as the KPI period sales/orders.

### Backend
- No backend code was changed for Day 34. Code inspection confirmed the existing MongoDB aggregation already provides the required real data and restaurant-scoped membership check.

### Empty/loading/error handling
- Loading: existing KPI skeleton remains visible while analytics is requested.
- API error: existing dashboard error state and retry action remain intact.
- No data: the repaired chart renders a stable empty state rather than a broken plot.
- Invalid trend points: invalid dates/non-numeric values are ignored safely by the chart.

### Responsive UI
- Desktop: wider dashboard container, five KPI columns at XL, full-width main graph, paired secondary cards.
- Tablet: KPI cards reduce to two columns and secondary cards remain stacked until the large-screen breakpoint.
- Mobile: KPI cards stack, period controls remain accessible, and the graph uses a stable minimum plot width with horizontal scrolling rather than page overflow.

### Verification
**TESTED / CODE-LEVEL:**
- Confirmed the existing API response contract (`trend[].date/sales/orders`) matches the frontend analytics types and chart inputs.
- Confirmed the existing backend uses real MongoDB `Order` aggregation for period sales/order counts and daily trend data, with restaurant membership checked before aggregation.
- Confirmed Week / Month are the only accepted period values in the backend and that the frontend request changes with the selected period.
- Confirmed modified dashboard/chart files transpile successfully with the available TypeScript compiler.
- Confirmed the repaired chart has explicit no-data handling, invalid-point filtering, stable dimensions, and responsive overflow behavior by code inspection.

**NOT TESTED:**
- Live MongoDB analytics results.
- Browser interaction against a running Next.js/NestJS application.
- Actual Week → Month switching with live API responses.
- Desktop/tablet/mobile rendering in the real application.
- Full end-to-end restaurant isolation against a running API.

**BUILD / LINT LIMITATION:**
- `npm run build` and `npm run lint` were attempted at the repository root but could not start because `turbo` is not installed in the supplied archive (`turbo: not found`).
- Direct frontend/backend `tsc --noEmit` attempts also could not complete meaningful project typechecking because the archive has no installed `node_modules`; errors are dominated by missing `next`, React, NestJS, Mongoose, and related type packages. These are environment/dependency availability failures, not claimed Day 34 code failures.

### Known remaining issue
- Live verification remains required: the sandbox has no installed project dependencies and no live MongoDB/browser application runtime, so real database graph rendering and production build success cannot be claimed from this environment.

## Day 33 — Replace Test OTP with Real OTP Authentication

### Existing implementation reviewed
- The existing customer auth flow already used the global `Customer` model, customer JWT (`customer_id` + `type: 'customer'`), `CustomerAuthGuard`, and the Day 30 customer-name step.
- The old OTP implementation generated a local six-digit code, stored a bcrypt hash in `OtpChallenge`, and returned `devOtp` directly from the request API. This was the documented Day 29/30 production blocker.
- Customer order/history APIs already use the authenticated customer identity, so no second identity/session system was introduced.

### Real provider integration
- Added `apps/api/src/customers/otp/otp-provider.service.ts` as the provider boundary.
- Production provider: **Twilio Verify SMS** using Twilio's Verify REST API through Node's built-in `fetch`; no provider SDK dependency was added.
- Twilio Verify owns production OTP generation and delivery. MnU does not generate, store, log, or return the real production OTP.
- Provider credentials are environment variables only.
- Production startup fails fast when Twilio Verify is not configured.
- Provider responses are reduced to stable customer-safe errors; raw Twilio responses are not returned to clients.

### OTP security
- OTP expiry is configurable and defaults to 5 minutes. MnU also checks its local challenge expiry before provider verification.
- Successful challenges are marked `consumedAt` and cannot be reused.
- Verification attempts default to a maximum of 5 per challenge.
- Request cooldown defaults to 60 seconds per destination.
- Request rate limit defaults to 3 successful challenge records per destination per 10 minutes, plus a broader IP-based limit.
- Phone validation is performed server-side before provider delivery.
- The real OTP is never returned in production API responses and is never written to normal application logs.
- Provider-side Verify protections remain active in addition to MnU's local challenge controls.
- Old local `otpHash` remains optional only for compatibility with explicitly created development challenges; new production challenges do not store an OTP hash.

### Development vs production
- `OTP_DEV_MODE=true` is an explicit non-production-only local fallback. It is ignored when `NODE_ENV=production`.
- Development fallback codes are generated with `crypto.randomInt`, stored only as a bcrypt hash, and may be returned as `devOtp` solely in explicit non-production dev mode.
- The customer UI no longer offers the old email/mock option; the Day 33 production flow is phone/SMS verification through Twilio Verify.
- Production has no universal bypass code and cannot use the local development challenge path.

### Customer identity / session integration
- Existing `Customer` find-or-create behavior remains in `CustomerAuthService`.
- Indian 10-digit numbers are normalized to `+91XXXXXXXXXX` for provider delivery while lookup also accepts the legacy 10-digit representation, preventing duplicate customers for existing records.
- Existing customer names remain unchanged by authentication.
- Existing customer JWT/session issuance remains `signCustomerToken()` with the existing `CustomerAuthGuard`.
- Existing customer order/history ownership continues to derive from the authenticated customer token; restaurant context remains separate.
- Existing client-side logout/session clearing (`clearCustomerToken`) is unchanged; no second session system was introduced.

### Frontend
- `CustomerAuthPanel` now uses the phone/SMS flow only.
- Removed the old email/test-provider UI and direct test-code messaging.
- Added a resend countdown using the server-provided cooldown.
- Existing OTP validation, loading, error, name, and successful-authentication behavior remains intact.
- The API type now treats `devOtp` as optional, so production responses do not require or expect a code.

### Environment variables
Add these to `apps/api/.env` in deployment; values are placeholders only in `.env.example`:
- `OTP_PROVIDER=twilio`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `OTP_TTL_MINUTES` (default `5`)
- `OTP_MAX_ATTEMPTS` (default `5`)
- `OTP_REQUEST_COOLDOWN_SECONDS` (default `60`)
- `OTP_REQUEST_WINDOW_MINUTES` (default `10`)
- `OTP_MAX_REQUESTS_PER_WINDOW` (default `3`)
- `OTP_DEV_MODE=false` in production

Real Twilio credentials must never be committed to Git, frontend code, `PROGRESS.md`, screenshots, API responses, or normal logs.

### Testing
**TESTED / CODE-LEVEL:**
- Confirmed production provider boundary and environment-only credential handling.
- Confirmed no production response path includes the real OTP.
- Confirmed development OTP is explicitly gated by `NODE_ENV !== production` and `OTP_DEV_MODE=true`.
- Confirmed expiry, one-time consumption, attempt limit, destination cooldown, IP rate limit, phone validation, and provider-error handling paths.
- Confirmed existing Customer find-or-create and JWT/customer-guard path remains connected.
- Confirmed legacy Indian 10-digit customer lookup remains compatible with normalized `+91` numbers.
- Confirmed frontend no longer displays a test OTP unless explicit non-production dev mode returns one.
- Confirmed resend countdown and loading/error states are wired to the new response.

**NOT TESTED:**
- Actual SMS delivery through a live Twilio account.
- Successful live OTP verification against Twilio Verify.
- Live MongoDB persistence.
- Browser/device interaction.
- Full QR → OTP → name → order → order-history end-to-end flow.
- Production frontend/backend builds, because this supplied archive has no installed `node_modules` and the sandbox cannot retrieve dependencies from the package registry.

**CODE REVIEW ONLY:**
- Cross-restaurant customer/order isolation using the existing authenticated customer ID.
- JWT expiration/rejection using the existing `jsonwebtoken` implementation.
- Client-side logout behavior via existing `clearCustomerToken()`.

### Known production blocker
**Live provider verification remains required before claiming production readiness.** The Twilio integration is implemented, but this environment has no real Twilio credentials/phone delivery path, so actual SMS delivery and verification could not be proven here. The deployment must configure the required Twilio variables and successfully complete a real OTP smoke test before launch.

## Day 35 — Security & RBAC Audit

### Audit scope
- Reviewed `PROGRESS.md`, staff/customer JWT guards, JWT signing/verification, restaurant membership model and role enum, auth services/controllers, restaurant branding, menu/category/item/image APIs, table APIs, table-session APIs, order/customer/analytics APIs, group-order APIs, public menu/order APIs, Cloudinary configuration, OTP/Twilio configuration, and environment/ignore configuration.
- Reviewed restaurant-scoped object lookups for `{restaurantId, objectId}` scoping and customer order lookups for `{restaurantId, customerId}` ownership.

### Confirmed findings and fixes
- **Public destructive table-session endpoint:** `PATCH /public/restaurants/:restaurantId/tables/:tableId/session/end` had no authentication or ownership check and could terminate another table's active session if its identifiers were known. The web application did not call this endpoint. The route and its unused client API method were removed rather than leaving an unauthenticated destructive operation in place.
- **CORS was unrestricted:** `app.enableCors()` allowed any browser origin. Replaced it with an explicit allowlist using `CORS_ORIGINS`; localhost origins are allowed only outside production, while production uses only the configured deployment origins and non-browser/same-origin requests without an Origin header remain allowed.
- **Authentication input robustness:** registration/login and customer OTP request/verify now reject malformed request bodies/types with controlled 4xx responses instead of risking runtime type errors.
- **API input validation:** menu/category/item payloads now reject malformed text/boolean/numeric fields before mutation; order/group cart lines are type-checked and capped at 100 entries; public popular-item `limit` is constrained to integers 1–20.
- **Cart payload bounds:** normal and group-order cart line arrays are capped at 100 entries to prevent unnecessarily large request payloads from reaching database work.
- Added `apps/api/.env.example` documenting placeholder-only secrets and the production CORS allowlist configuration.

### Authentication / RBAC / isolation review
- Staff endpoints reviewed behind `JwtAuthGuard`; customer endpoints use the separate `CustomerAuthGuard` with a `type: 'customer'` JWT discriminator.
- Staff JWTs are 7 days and customer JWTs are 30 days; both require the environment `JWT_SECRET` and no secret is hardcoded in source.
- Restaurant membership is checked server-side before restaurant-scoped admin reads/analytics/orders/menu/tables/branding operations.
- Menu categories/items and tables are fetched with both object id and `restaurantId`, preventing cross-restaurant IDOR through a changed URL id.
- Orders are similarly scoped by both order id and `restaurantId`; customer order history/details are scoped by both `customerId` and `restaurantId` from the verified customer token.
- Group-order membership is checked from the verified customer token, and group/item lookups are restaurant-scoped.
- Existing role behavior remains: restaurant admins/super-admins manage menu/tables/branding; restaurant staff retain membership-level reads and order-status/availability operations as already documented by the application. No Super Admin feature was introduced.
- No password hashes, OTP hashes, JWT/Twilio secrets, or raw authentication secrets are returned by the reviewed customer/admin serializers. OTP hashes remain `select: false` and production OTPs are provider-owned.

### Security tests / verification
**SECURITY REGRESSION TESTS:**
- Added `scripts/security-audit.test.mjs` using Node's built-in test runner.
- Executed 6/6 tests successfully covering admin guards, customer+restaurant order ownership, restaurant-scoped object lookups, removal of the destructive public session-end route, production CORS allowlisting, and environment-based JWT secret handling.

**CODE-LEVEL / STATIC VERIFICATION:**
- Verified unauthenticated admin controllers are not present among restaurant-scoped admin controllers; customer-only controllers use `CustomerAuthGuard` where identity is required.
- Verified cross-restaurant menu/category/item/table/order lookups include `restaurantId` in the database predicate.
- Verified customer order list/detail predicates include the verified `customerId` and requested `restaurantId`.
- Verified malformed ObjectIds are rejected before Mongoose queries in the audited services.
- Verified the removed table-session end route has no remaining frontend caller.
- Verified `.gitignore` excludes `.env`/local environment files and no environment file with real credentials exists in the supplied archive.

**NOT FULLY EXECUTED:**
- The archive has no installed `node_modules`, no configured automated test runner, and no live MongoDB/API runtime. Therefore live cross-restaurant A/B requests, JWT expiry requests, browser CORS behavior, Twilio OTP delivery, and end-to-end regression tests could not be executed in this environment.
- No fake authorization tests were added merely to simulate HTTP behavior without the application's real test/runtime dependencies.

### Build status
- Production build/lint/test execution remains blocked by missing dependencies (`turbo`/Nest/Next toolchains are not installed in the supplied archive). This is an environment limitation, not a claim of build success.

### Remaining risks
- Live integration/security testing with two restaurants, two staff users, and two customers is still required before deployment.
- JWTs are stateless; logout discards the client token but does not revoke an already-issued token server-side.
- There is no dedicated automated authorization test suite in the supplied project yet; the repository should add real integration tests once its test runner/database test environment is established.

## Day 36 — API Hardening

### Audit scope
- Re-read the Day 35 security/RBAC/data-isolation work and reviewed the current NestJS bootstrap, guards, controllers, services, Mongoose queries/schemas, OTP flow, uploads, orders, menu, tables, customer APIs, analytics, and CORS.
- No new product feature or authentication provider was introduced.

### Global validation / request safety
- Added a global `RequestSafetyPipe`.
- Rejects dangerous Mongo/operator-style field names (`$...`, dotted paths, `__proto__`, `prototype`, `constructor`) before they reach business logic.
- Rejects excessively deep objects and oversized arrays at the request-object layer.
- Route parameters whose names end in `Id` are checked with `Types.ObjectId.isValid()` before Mongoose access, returning controlled `400` errors for malformed IDs.
- Existing service-level validation remains in place for required fields, types, enum values, quantities, prices, names, OTP inputs, and other domain-specific rules.
- Existing inline request types were not falsely treated as runtime validation; the hardening is implemented with the global runtime pipe plus service validators rather than adding a large DTO framework to the project.

### Authentication / OTP abuse protection
- Added a lightweight application rate-limit guard/decorator using existing NestJS infrastructure; no new third-party rate-limit dependency was introduced.
- Added limits to registration, login, OTP request, OTP verification, customer order creation/detail, analytics/dashboard, and authenticated menu-image upload.
- Existing Day 33 OTP protections remain: destination cooldown/window limits, IP window limit, verification-attempt limit, strict mobile validation, Twilio Verify in production, and no production OTP in responses/logs.
- Twilio Verify was not replaced.
- The rate limiter is process-local. A multi-instance deployment should move these counters to shared storage (for example Redis) before relying on them as a distributed control.

### Payload safety / uploads
- JSON and URL-encoded request bodies are now bounded to 1 MB at the API parser.
- Menu image upload remains separately bounded by Multer at 8 MB and the service at 5 MB, with MIME/type validation already present.
- No frontend upload contract was changed.

### Pagination / query limits
- Added validated `page`/`limit` parsing with default page size 50 and maximum page size 100.
- Applied bounded pagination to restaurant order lists, restaurant customer lists, customer order history, and customer self-history while preserving existing response shapes as arrays where they previously were arrays.
- Public popular-item `limit` now rejects malformed/out-of-range values instead of silently normalizing them; maximum remains 20.
- Dashboard period validation remains server-side (`week`/`month`) and dashboard recent/top-item work is already explicitly bounded.
- No user-controlled object is passed directly into a MongoDB filter. The remaining `$ne`, `$in`, `$gte`, `$lte`, etc. operators are server-generated query structures, not raw request objects.

### Mass assignment / update safety
- Restaurant branding update now has an explicit allowlist and rejects unsupported fields instead of accepting arbitrary update keys.
- Menu, table, order-status, customer-name, and other existing mutation paths already build/update only their intended fields; those controls were retained.
- Registration now uses the normalized email and trimmed user name when creating the user.

### Error handling / logging
- Added a global HTTP error filter.
- Known `HttpException` responses retain the project's normal `statusCode`/`message`/`error` shape.
- Unknown exceptions return a generic `500 Internal Server Error` without serializing stack traces, Mongoose internals, filesystem paths, connection details, or secrets.
- Server-side 500 logging records only method/path/status/error category, not exception payloads or request secrets.
- No passwords, OTP codes, JWTs, Twilio credentials, DB credentials, or API keys were added to logs.

### HTTP security headers / CORS
- Added standard API security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and production HSTS.
- Re-checked Day 35 CORS behavior: production remains explicit `CORS_ORIGINS` allowlist; development retains localhost origins plus configured origins.
- No wildcard production CORS was introduced.

### Tests / verification
- `node --test scripts/day36-api-hardening.test.mjs scripts/security-audit.test.mjs` — **13/13 passed**.
- Static TypeScript transpilation of all Day 36-modified TypeScript files — **all passed**.
- Full `tsc --noEmit` — **blocked by incomplete local dependencies/type packages** (TS2688 missing type-definition packages such as node, express-related packages, multer, mongoose dependencies, etc.).
- `npm run build` — **blocked because `apps/api/node_modules/.bin/nest` is missing**.
- Offline dependency restoration was attempted and failed because required packages were not cached; an online `npm install` attempt timed out.
- ESLint could not be run because the local API install is incomplete and no usable local eslint binary is present.
- No live MongoDB/API/Twilio/browser end-to-end regression was possible in this environment, so those are not claimed as passed.

### Regression status
- Day 35 authentication, RBAC, restaurant-isolation, customer-order privacy, CORS, and destructive-session-route regression checks remain green through the combined test run.
- Dashboard graph/frontend code was not modified by Day 36.
- No frontend API response-shape redesign was made.

### Remaining known risks
- Live integration testing against MongoDB is still required, including real authorization/validation/error paths and two-restaurant isolation scenarios.
- Rate limiting is in-memory/process-local and is not sufficient as a distributed control for a horizontally scaled deployment.
- The project still uses many inline controller request types instead of a full class-validator DTO layer; runtime domain validation is present, but a comprehensive DTO whitelist/metadata system is not installed.
- JWT logout remains stateless as documented previously; an already-issued JWT is not server-revoked by the logout endpoint.
- Full production build/lint/typecheck remains blocked until dependencies are restored in an environment with package-registry access.

## Day 37 — Super Admin Panel + Full Restaurant Management Access

### Architecture / authorization
- Added a persisted platform-level `User.platformRole` (`USER` / `SUPER_ADMIN`) separate from restaurant membership roles.
- Added a partial unique Mongo index so only one platform Super Admin account can exist through the bootstrap mechanism.
- Existing `RestaurantMember.role` remains for restaurant-scoped permissions; the legacy `RestaurantRole.SUPER_ADMIN` enum value is retained only for backward data compatibility and is no longer used as the source of platform authority.
- Added shared `AuthorizationService` and `SuperAdminGuard`.
- Restaurant-scoped menu, tables, orders, analytics, customers, and restaurant-settings services now use the shared platform-aware authorization path: normal users require restaurant membership; Super Admins can operate on any existing restaurant.
- No duplicate Super Admin versions of menu/order/customer/analytics services were created.

### Separate Super Admin authentication
- Added separate backend login endpoint: `POST /auth/super-admin/login`.
- Normal `POST /auth/login` rejects platform Super Admin accounts and directs them to the dedicated Super Admin sign-in flow.
- Added frontend entry point `/super-admin/login`.
- No `/super-admin/register` route exists.
- Existing password hashing and JWT infrastructure is reused; Twilio Verify was not changed or replaced.
- Added manual/bootstrap script: `pnpm --filter @mnu/api db:bootstrap-super-admin`.
- Bootstrap uses `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, and `SUPER_ADMIN_NAME`; it requires a 12+ character password and refuses to create a second Super Admin with a different email.
- No plaintext production credentials are stored in source.

### Super Admin platform panel
- Added protected `/super-admin/dashboard`.
- Added protected `/super-admin/restaurants` with real MongoDB restaurant records, bounded pagination, search, admin/member summary, loading/empty/error states, and explicit Manage actions.
- Added protected platform APIs:
  - `GET /super-admin/dashboard`
  - `GET /super-admin/restaurants`
  - `GET /super-admin/restaurants/:restaurantId`
- Dashboard only displays real `totalRestaurants` and recent restaurant records; no mock MRR/revenue/activation/partner metrics were introduced.

### Restaurant management context
- Super Admin selects a restaurant from All Restaurants and enters the existing `/restaurants/:restaurantId/...` management routes.
- The existing restaurant layout now recognizes a verified Super Admin and loads the selected restaurant through the protected platform endpoint.
- The UI clearly labels `Super Admin · Managing restaurant` and provides a return path to the Super Admin restaurant list.
- Existing Restaurant Admin pages/components are reused rather than duplicated.
- Shared backend authorization remains the security boundary; a frontend-selected restaurant ID alone is never trusted.

### Existing restaurant operations verified at code level
The selected-restaurant context continues to route through the existing implementation for:
- Dashboard and Week/Month analytics
- Menu / menu items / images
- Categories
- Tables / existing QR/table functionality
- Orders / order lifecycle
- Customers / customer order history
- Analytics
- Restaurant settings/branding
- Staff membership roster (read-only endpoint added because the repository previously had the membership data model but no staff UI/endpoint)

No separate Super Admin copies of these business services were introduced.

### Security / IDOR controls
- Restaurant Admin access remains membership-scoped.
- A Restaurant Admin cannot access `/super-admin/*` because the backend platform guard requires `User.platformRole === SUPER_ADMIN`.
- A Restaurant Admin cannot use another restaurant ID to bypass menu/table/order/customer/analytics/settings authorization because the shared authorization service checks membership for every existing restaurant-scoped service.
- Super Admin restaurant selection verifies that the restaurant exists before management context is entered.
- Normal restaurant login cannot be used to authenticate a Super Admin account; the dedicated Super Admin login is required.

### Tests / verification
- Combined Node security/static suite: **22/22 passed**.
- Static TypeScript transpilation across all API/frontend TS/TSX source: **137 files passed**.
- Verified no `/super-admin/register` route exists.
- Verified legacy membership `SUPER_ADMIN` is not used by the audited restaurant-scoped management services as platform authorization.

### Not fully executed
- No live MongoDB/API runtime was available, so real Super Admin credential login, real restaurant switching, live A/B cross-restaurant requests, CRUD operations, and browser route-protection flows could not be executed.
- Frontend and backend full typechecks are blocked by the supplied/inherited incomplete `node_modules` installations. API `tsc --noEmit` reports missing type-definition packages; web typecheck reports missing React/Next dependencies.
- Production Nest/Next builds and lint remain blocked because local `nest`/`next`/TypeScript package binaries are not installed. No build success is claimed.

### Future work / not implemented on Day 37
- POS Partner system
- Partner restaurant/referral workflows
- Partner revenue / MRR
- CRM
- Advanced platform analytics
- Partner portal
- Advanced audit-log product
- Production deployment/infrastructure
- Super Admin CRUD for staff memberships beyond the new read-only roster view

### Known risks
- The current platform Super Admin session still uses the existing stateless JWT mechanism; server-side token revocation is not introduced on Day 37.
- Live authorization tests with two or more real restaurants/users remain required before production deployment.
- The application still uses many inline request types rather than a full DTO/class-validator architecture.

## Day 37 — Post-implementation auth/CORS hotfix

### Confirmed issue
- Browser `OPTIONS /auth/login` and `OPTIONS /auth/register` requests were being converted into HTTP 500 responses by the global `HttpErrorFilter` when the CORS callback rejected an origin by throwing a plain `Error`.
- This was a middleware/error-handling interaction introduced during API hardening; it was not caused by invalid login credentials or by replacing the authentication/database architecture.

### Fix
- `apps/api/src/main.ts` now rejects disallowed CORS origins with `callback(null, false)` instead of throwing an exception, preventing rejected preflight requests from becoming misleading 500 responses.
- Development now accepts `localhost` and `127.0.0.1` on local HTTP/HTTPS ports so normal Next.js development ports do not fail CORS unexpectedly.
- Production remains explicitly allowlisted through `CORS_ORIGINS`; no production wildcard was introduced.

### Database/auth compatibility fix
- `apps/api/src/database/seed.ts` now explicitly creates seeded users with `platformRole: PlatformRole.USER` because the Day 37 User schema introduced the required platform-level role field.
- Existing users without a stored `platformRole` remain treated as normal `USER` by `AuthorizationService` for backward compatibility; no bulk destructive migration was performed.
- `docs/DATABASE.md` now documents the new platform-level role field.

### Verification
- Combined Day 35/36/37 static security suite: **24/24 passed**.
- Static TypeScript transpilation: **137 TS/TSX files passed**.
- The reported CORS error pattern (`callback(new Error('Origin not allowed by CORS.'), false)`) is removed.

### Live verification still required
- A real running API/browser should be used to confirm the exact development origin now used by the web app receives a successful preflight and that `/auth/login` and `/auth/register` POST requests reach the controllers.
- MongoDB-backed registration/login remains dependent on the user's configured `DATABASE_URL` and running MongoDB instance.

## Day 38 — Production Readiness, Order Notifications & Super Admin Isolation

### Completed
- Audited authentication, restaurant authorization, customer order ownership, order pricing/status lifecycle, API hardening, CORS, error handling, MongoDB/Mongoose wiring, Cloudinary, Twilio Verify, frontend routing, and the Day 37 Super Admin boundary against the actual current code.
- Added a server-authorized restaurant order notification summary endpoint. It derives restaurant access from the authenticated user and returns the canonical actionable-order count plus newly-created orders for a polling cursor.
- Added a controlled 10-second polling monitor to the Restaurant Admin layout. It has bounded timers, cleanup, transient-error tolerance, clickable in-app new-order notifications, and persisted per-user/per-restaurant deduplication across navigation and browser refreshes.
- Added the Orders sidebar badge using the existing lifecycle definition: `NEW`, `CONFIRMED`, `PREPARING`, `READY`. `COMPLETED` and `CANCELLED` are excluded.
- Added normal checkout idempotency: the customer review flow generates one checkout key and retries reuse it; MongoDB uniqueness plus a duplicate-key recovery path prevents duplicate order creation after network retries/race conditions. Group checkout already had its own server-side idempotency and remains unchanged.
- Added production fail-closed configuration checks for `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS`; production JWT secrets must be at least 32 characters and production CORS origins must be HTTPS.
- Made the web API URL a required production build/runtime configuration instead of silently falling back to localhost. Added `apps/web/.env.example`.
- Hardened Cloudinary replacement/removal ordering so an upload failure does not first delete the restaurant's existing image; provider errors are no longer returned verbatim to customers/logs.
- Preserved the existing Twilio Verify provider boundary and production configuration enforcement; no provider replacement was introduced.
- Preserved the separate Super Admin login, platform role, backend `SuperAdminGuard`, dedicated Super Admin UI, and shared restaurant-management services. Restaurant Admin login rejects Super Admin accounts and Super Admin APIs require both JWT authentication and platform-level authorization.
- Added Day 38 static regression/security tests covering notification isolation, pending-count lifecycle, duplicate notification protection, order idempotency, production configuration, Super Admin separation, and external provider configuration.

### Tests performed
- Combined static regression/security suite: **32/32 tests passed** (`security-audit`, Day 36 hardening, Day 37 Super Admin, Day 38 readiness).
- TypeScript/TSX syntax transpilation check for all Day 38 modified source files: **10/10 passed**.
- Attempted `npm ci --ignore-scripts` for the API so real type/build checks could run, but the dependency installation timed out and left an incomplete `node_modules`; a subsequent `tsc --noEmit` was blocked by missing type definitions.
- No real MongoDB, Twilio Verify, Cloudinary account, production deployment, or mobile browser session was available in this sandbox, so those live/E2E paths were not claimed as verified.

### Remaining
- **Real MongoDB E2E verification:** run the API against the actual MongoDB/Atlas database, confirm indexes (including the new order idempotency index), database connection, real order creation, status transitions, notification polling, and cross-restaurant isolation. **Blocks controlled pilot testing until verified.**
- **Twilio Verify live verification:** provide valid production `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`; test real OTP request/verification and failure/rate-limit behavior. **Blocks customer-order pilot testing until verified.**
- **Cloudinary live verification:** provide valid `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; test upload → URL persistence → display and replacement/removal against the real account. **Blocks image-dependent pilot testing; ordering itself can be tested without images.**
- **Production web/API builds:** rerun `npm/pnpm install`, API build/typecheck, web build/typecheck, and lint in a complete dependency environment. **Blocks deployment sign-off, not code review.**
- **Mobile/browser E2E:** verify QR → menu → customer OTP → cart → order → one restaurant notification → pending count → status update → customer order status on an actual mobile-sized browser/device. **Blocks final controlled-pilot sign-off.**
- **Deployment configuration:** the actual hosting provider/domain/HTTPS setup was not present in the repository, so final DNS, TLS, production `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, MongoDB URI, Twilio, Cloudinary, and Super Admin bootstrap values must be supplied/configured in the deployment environment. **Blocks deployment until configured.**

### Issue classification
- **P0 — Blocking:** No newly discovered code-level P0 remains from the audit. Live infrastructure verification is still required before calling the system pilot-ready.
- **P1 — Critical:** Real MongoDB/Twilio/Cloudinary and production build/E2E verification are unresolved environment requirements. The code paths are present and statically covered, but they are not marked production-tested without the external systems.
- **P2 — Important:** Server-side JWT logout is intentionally stateless: logout discards the browser token, while an already-issued JWT remains valid until expiry. A token-revocation/blocklist can be added later if immediate server-side invalidation becomes a requirement.
- **P3 — Future improvement:** Replace polling with WebSockets/SSE only if pilot traffic/user experience demonstrates a need; add richer notification history/preferences; remove or hide the explicitly-labelled demo menu before a polished public launch.

### Pilot standard
The Day 38 code is prepared for controlled testing, but **the project is not declared fully pilot-ready until the real MongoDB, Twilio, Cloudinary, production build, deployment, and mobile E2E checks above are completed.**


---

## Day 39 — Production Infrastructure, Deployment & Environment Setup

### Completed (implemented AND tested in the sandbox)
- Audited env vars, `.gitignore` (covers `.env`, `.env.*`, per-app), Next/Nest config, CORS, Mongoose config, JWT, Twilio, Cloudinary, Super Admin, health, logging, indexes, localhost usage. The uploaded zip has **no `.git` history**, so committed-secret history could not be checked (see P0).
- **Fixed a real build failure left from Day 38:** `apps/api` `nest build` failed (TS2339, `idempotencyKey` missing from the public order controller body type). Fixed; API build now passes.
- **API production build passes** (`nest build`) and **web production build passes** (`next build`, 11 static + dynamic routes incl. `/super-admin/*`).
- Web: production bundle contains **0** `localhost` references (dev-only fallback removed; build fails without `NEXT_PUBLIC_API_URL`, verified).
- Backend hardening: startup refuses localhost DB, `OTP_DEV_MODE=true`, missing Twilio/Cloudinary vars; startup failure logs a clear line and exits 1 (verified for 6 scenarios); `TRUST_PROXY` support (**without it, per-IP rate limits are shared by all users behind a proxy**); graceful shutdown hooks; listens on 0.0.0.0; MongoDB server-selection/connect/socket timeouts, pool size, bounded retries (unreachable DB now fails in ~35s instead of ~2min); Twilio fetch 10s timeout; `/health` returns 503 + `{status:'error',database:'disconnected'}` when DB is down (no details leaked); request logger (method/path/status/ms only; 401/403/429 warn, 5xx error); 500 handler logs top stack frames server-side only.
- Index added, justified by the notification-polling/pending-count queries: `orders {restaurantId, status, createdAt:-1}`. Other reviewed collections already had indexes matching their queries; none added blindly.
- `apps/api/.env.example` rewritten to match variables actually used (+`TRUST_PROXY`, `MONGO_MAX_POOL_SIZE`); `docs/DEPLOYMENT.md` created (env matrix, sequence, smoke test, backups, rollback).
- New `scripts/day39-deployment.test.mjs`; full static suite **39/39 pass**.

### Production Environment
- **Frontend deployment:** NOT DEPLOYED — no provider/config in repo. Build verified only.
- **Backend deployment:** NOT DEPLOYED — same.
- **Database:** Atlas cluster exists for development (`mnu_dev`); no separate production DB confirmed. Not connected from sandbox.
- **Domain / HTTPS:** none provided; not configured.
- **Environment configuration:** templates + startup validation done; no production values set.

### External Services
- **Twilio:** code path unchanged (Verify); 10s timeout added. **Not verified live.**
- **Cloudinary:** code path unchanged; **not verified live** (upload/display/delete untested).
- **MongoDB:** **not verified live** from sandbox; connection-failure behavior verified.

### Testing
- Static/security suites 39/39; API + web production builds; production-startup guard scenarios (missing config, local DB, dev OTP, missing services, unreachable DB) verified by running `dist/main.js`.
- **Not performed:** any live smoke test, real OTP, real image upload, CORS/HTTPS/isolation checks against a deployed system, backup/rollback exercises. No mock data was used to imply otherwise.

### Remaining Blockers
**P0 — Blocking**
- Real credentials for MongoDB, Twilio, Cloudinary, JWT secret and the Super Admin password were pasted in plain text into an AI chat session. **Treat all as compromised: rotate MongoDB user password, Twilio Auth Token, Cloudinary API secret, JWT_SECRET (invalidates sessions) and the Super Admin password before pilot.** If a real `.env` was ever committed, rotation is required regardless; `.git` history was not available to check.
- No hosting provider, domain, or DNS access → nothing deployed, no HTTPS.

**P1 — Critical**
- Live verification of Twilio OTP (trial accounts only text verified numbers; SMS to Indian numbers may need DLT/sender registration — confirm with Twilio), Cloudinary upload/display/delete, MongoDB connect, live smoke test incl. Super Admin isolation and CORS.
- Production DB must be separate from `mnu_dev` (own DB name/user); backups must be enabled and a restore tested (M0 has none).
- Set `TRUST_PROXY=1` on the host; run a single API instance.

**P2 — Important**
- `db:bootstrap-super-admin` upserts by email and can promote/overwrite an existing restaurant user with that email.
- JWTs (7d staff/30d customer) are stateless, no revocation; tokens in localStorage.
- Rate limiter is in-memory (single instance only). No external monitoring/alerting.
- No lint/CI pipeline run; root pnpm-lock and per-app package-lock coexist.

**P3 — Future**
- Redis-backed rate limiting, Helmet-style CSP on web, error tracking (Sentry), WebSocket/SSE notifications, Docker/IaC.


---

## Day 40 — Super Admin Full Permission Model

### Finding: most of the model already existed
Every restaurant-scoped service (menu, categories, tables, orders, customers, analytics, branding/settings, staff list, notifications) already authorizes through the single `AuthorizationService.requireRestaurantAccess()`, which lets `SUPER_ADMIN` cross restaurants and treats it as a manager. The frontend already reuses the Restaurant Admin pages under `/restaurants/:id/*` with `SUPER_ADMIN` treated as a manager. **No second set of Super Admin controllers/services was created** (enforced by a new test).

### Completed (implemented AND tested)
- **Orphan-write hole closed:** Super Admin access now verifies the restaurant actually exists (404 otherwise). Previously a Super Admin call with any well-formed but non-existent restaurantId would have passed authorization and could have created orphaned tables/categories/items.
- **Audit logging:** new `audit_logs` collection + global `AuditInterceptor`. Records every *successful* restaurant-scoped mutation (POST/PUT/PATCH/DELETE) made by a Super Admin: actor id + email, action (e.g. `tables.delete`, `menu-items.update:availability`, `branding.update`), method, route template, restaurant, resource type/id, status code, timestamp. Stores no bodies, headers, tokens or passwords. Failed requests, reads, and Restaurant Admin actions are not recorded. Audit write failures are logged loudly and never break the user's request.
- **`GET /super-admin/audit-logs`** (Super Admin only; paginated, filter by `restaurantId`). No UI yet.
- **Persistent context banner** (all screen sizes): "Super Admin — Managing Restaurant: <name>" with an "Exit to Super Admin panel" link.
- Tests: 53/53 across all suites, including:
  - `day40-super-admin-permissions.e2e.test.mjs` — boots the real compiled controllers/services/guards/filter/interceptor over HTTP against an in-memory fake DB. Verified: Super Admin full CRUD on tables, categories, menu items (incl. availability), branding/settings, staff list, platform dashboard, across two restaurants; Restaurant Admin denied on the other restaurant and all `/super-admin/*` (403); Staff read-only; missing/garbage/expired/wrong-secret/customer tokens rejected; malformed ids never 500; audit entries correct. Mutation-checked: removing the existence check or the audit write makes the tests fail.
  - `day40-authorization-invariants.test.mjs` — no restaurant route without JwtAuthGuard, no duplicated Super Admin services, no API path that grants/strips `platformRole`.

### NOT verified / not done (be explicit)
- **Staff Create/Update/Remove does not exist for anyone.** The current product only lists staff (read-only) for Restaurant Admin, and the spec says to match the existing implementation, so Super Admin has the same read access. Adding/editing/removing members needs product decisions (how new staff get credentials, last-admin protection) and was NOT invented. Self-lockout is currently impossible: no endpoint modifies `platformRole` (test-enforced).
- **Orders, customers, analytics, QR, image upload/replace/delete:** these use the same `requireRestaurantAccess` gate (statically verified and identical to the tested paths) but were **not** exercised over HTTP — orders/analytics need complex Mongo aggregations the fake DB doesn't support; QR codes are generated client-side (`canManage` includes SUPER_ADMIN); image upload needs real Cloudinary. Verify these manually against real MongoDB/Cloudinary.
- Frontend behaviour of the new banner was type-checked and built (`next build` passes) but not viewed in a browser.
- Real MongoDB was not available: the fake DB does not validate schemas, indexes or query semantics.

### Notes for deployment
- New collection `audit_logs` (indexes built on first start). Grows unbounded; plan retention if volume matters.
- Super Admin audit trail covers restaurant-scoped mutations only; platform-level Super Admin routes are read-only today.

### Remaining / suggested next
- **P1:** Manual pass of orders / analytics / customers / QR / image upload as Super Admin on a real staging DB.
- **P2:** Decide and build staff management (add/role/remove) with last-admin and self-lockout protection; audit-log UI; audit failed/denied attempts.
- **P3:** Platform-level modules (POS partners, CRM, platform analytics), tamper-evident audit storage.


---

## MnU Authentication Architecture (FINAL — source of truth)

```
Single login entry point:   /login   (POST /auth/login)
Role-based routing after login (decided from the role the BACKEND returns):
  SUPER_ADMIN       -> Super Admin Panel   (/super-admin/dashboard)
  RESTAURANT_ADMIN  -> Restaurant Panel    (/restaurants/:id/dashboard)

SUPER_ADMIN:
  - Platform-wide access; can manage all (existing) restaurants
  - Has all Restaurant Admin capabilities (same shared services, no duplicates)
  - Has additional platform-level capabilities (/super-admin/*)
RESTAURANT_ADMIN:
  - Restaurant-scoped access; only the restaurant(s) they are a member of

There is no separate Super Admin login page.
There is no public Super Admin registration.
Authorization is enforced server-side on every request.
```

This **supersedes** the "separate Super Admin login" described in the Day 37, Day 38 and Day 40 entries above
(`/super-admin/login`, `POST /auth/super-admin/login`, "Normal `/auth/login` rejects Super Admin accounts").
Those entries are left untouched as history; they no longer describe the code.

## Day 41 — Single login for all users (Super Admin merged into `/login`)

### What was found
The Day 40 code had two login flows: `/login` (rejected Super Admin accounts with "Use the Super Admin sign-in")
and `/super-admin/login` -> `POST /auth/super-admin/login`, plus a "Super Admin" card on the landing page,
`superAdminLogin` in the API client, login-path branches in both layouts, and three static tests that asserted
the separate flow. Everything else the spec asks for (shared `AuthorizationService`, `SuperAdminGuard`, restaurant
selection + persistent "Managing Restaurant" banner, audit logging, existence check) already existed and was kept.

### Changes
- **Backend:** `AuthService.authenticate()` now only verifies credentials (no role parameter, no Super-Admin gate).
  `login()` returns `platformRole` + memberships for any account; the role comes from the database, never from the
  request. **Removed** `superAdminLogin()` and `POST /auth/super-admin/login` (now 404). Registration is unchanged
  and always creates `platformRole: USER` (a `platformRole` field in the request body is ignored — tested).
- **Frontend:** `/login` is still the same email + password form (no role selector, no Super Admin option); after
  success it routes via a new shared helper `lib/roleRouting.ts` (`resolveLanding`): SUPER_ADMIN ->
  `/super-admin/dashboard`, others -> first restaurant dashboard. `/dashboard` (legacy redirector) uses the same helper.
  **Deleted** `app/super-admin/login`, `authApi.superAdminLogin`, and the landing-page "Super Admin" card
  (one "Sign in" entry now). `super-admin/layout.tsx`: unauthenticated -> `/login`; a signed-in non-Super-Admin who
  types a `/super-admin/*` URL is redirected to their own restaurant panel; removed the "Restaurant Admin" cross-link;
  logout from either panel returns to `/login`. A restaurant-only account with no restaurant no longer keeps a stored token.
- **Bootstrap safety (new, needed because there is now one login):** `db:bootstrap-super-admin` refuses to convert an
  existing regular/restaurant account to Super Admin unless `SUPER_ADMIN_PROMOTE_EXISTING=true`; it still refuses to
  create a second Super Admin. Passwords are bcrypt-hashed (cost 12); credentials come only from env vars.
- **Docs:** `docs/DEPLOYMENT.md` (bootstrap + smoke test), `platform-admin/README.md`, `.env.example` updated.
- **Also fixed while here:** `authApi` no longer exposes a dead endpoint; older static tests (`day37`, `day38`, `day40`)
  updated because they asserted the superseded two-login design.

### Tests (all executed in this sandbox)
- `scripts/day41-single-login.e2e.test.mjs` — **14 HTTP tests** against the real compiled `AuthController`/`AuthService`
  (real bcrypt + JWT), `JwtAuthGuard`, `SuperAdminGuard`, `AuthorizationService`, platform + tables controllers,
  safety pipe and error filter; Mongoose models are in-memory fakes. Verified: Super Admin and Restaurant Admin both log
  in via `/auth/login`; invalid credentials rejected with an identical message (no account enumeration); client-supplied
  role/portal fields cannot elevate; `/auth/me` returns the role (used to restore state after refresh); old
  `/auth/super-admin/login`, `/super-admin/login`, `*/register` -> 404; registration cannot mint a Super Admin; Super Admin
  can read/write Restaurants A, B, C (unknown restaurant -> 404) and a write lands only in the selected restaurant;
  Restaurant Admin -> own restaurant 200, other restaurants 403, all `/super-admin/*` 403; unauthenticated -> 401;
  `/auth/login` rate limit (429 after 10/min) applies to the Super Admin account too.
- `scripts/day41-single-login.test.mjs` — 9 static guards: no obsolete references anywhere in source/docs, no role selector on
  `/login`, one login endpoint, shared role-routing helper wired into `/login`, `/dashboard` and the Super Admin layout, logout ->
  `/login`, single landing entry, no concrete `SUPER_ADMIN_PASSWORD` in tracked files.
- **Mutation-checked:** re-adding the old endpoint/page fails the static guard (3 failures); re-adding the old "Super Admin cannot use
  /auth/login" gate fails 5 behavioural tests. Both restored -> green.
- Full suite: **76/76 pass** (`node --test scripts/*.test.mjs`). API `tsc --noEmit` + `nest build` pass. Web `tsc --noEmit` +
  `next build` pass (route list has `/login`, `/dashboard`, `/super-admin/dashboard`, `/super-admin/restaurants`; no `/super-admin/login`).

### NOT verified / limitations (explicit)
- **No browser was run.** Redirect-after-login, refresh persistence, the banner, and logout were verified by type-check, production
  build, source-level guards and the API tests (which prove the backend returns the right role / denies correctly) — not by
  clicking through the UI. A manual pass of the 12-step flow is still needed.
- **No real MongoDB / real Super Admin credentials.** HTTP tests use in-memory model fakes; the bootstrap script and the partial
  unique index were not executed. No credentials appear in code or docs.
- **Lint could not be run:** neither app has ESLint installed/configured (`next lint` only prints a deprecation notice; the API
  `lint` script has no config). No linter was added.
- Orders/analytics/customers/QR/image operations as Super Admin use the same `requireRestaurantAccess` gate but were not exercised
  over HTTP here (see Day 40 notes); staff create/update/delete still does not exist for anyone.
- JWTs remain stateless (no server-side revocation); a Super Admin token lives 7 days like any staff token — consider a shorter
  lifetime for platform-level sessions.
- The Super Admin sign-in itself is no longer separately audited (audit covers restaurant-scoped mutations only); login auditing and
  denied-attempt auditing remain future work.
- Existing sessions issued before this change keep working (same JWT format).

### Fix — SUPER_ADMIN restaurant management scope (2026-09-28)

- Fixed the restaurant management UI's menu and tables pages to consume the shared `/restaurants/:restaurantId` context established by the layout.
- Removed duplicate membership-only checks that incorrectly showed `You don't have access to this restaurant.` to `SUPER_ADMIN` users who intentionally have no `RestaurantMember` record for the selected restaurant.
- Backend `AuthorizationService.requireRestaurantAccess()` remains the single server-side restaurant authorization boundary: `SUPER_ADMIN` may access any existing restaurant; `RESTAURANT_ADMIN` remains restricted to explicit membership; invalid restaurants remain rejected.
- Added a regression test covering the membership-free Super Admin management flow.
- Existing authorization/security tests pass after the fix.

## Day 42 — Customer QR ordering without OTP + QR menu tag refresh (2026-09-29)

### Customer Ordering Authentication

- Removed Twilio Verify / SMS OTP from the customer QR-ordering path.
- New checkout flow is: QR Menu → Cart → Review Order → Customer Name + Phone → Place Order → Order Created.
- Customer identity is now restaurant-scoped and resolved from the customer-provided phone number plus restaurant context.
- Customer phone numbers are validated/normalized but are explicitly **not treated as verified**.
- The server creates/recognizes the customer during checkout and returns a restaurant-scoped customer session token for repeat ordering, customer history, and group ordering.
- Customer session tokens include the restaurant scope; customer-only history/detail/group requests cannot reuse a token against another restaurant.
- Existing customer names are preserved; a name is only filled when the existing scoped customer has no name.
- Existing server-side order protections remain: restaurant/table/session validation, restaurant-scoped menu-item lookup, server-side prices/totals, quantity validation, and idempotency.
- Restaurant Admin and Super Admin authentication remain unchanged.
- Removed obsolete Twilio/OTP provider code, OTP challenge model registration, customer OTP endpoints, Twilio production startup requirements, and OTP environment variables.

### QR Menu Tag UI

- Added a shared premium `MenuTag` presentation component used by the existing QR menu card variants.
- Popular, Most Ordered, Recommended, New, Signature, and fallback labels have differentiated treatments using the existing MnU visual direction (`#F9F5EB`, `#E07A5F`, `#556B2F`) with stronger typography, contrast, spacing, and badge treatment.
- Existing tag/business logic was not changed; the current Signature/Popular selection logic remains intact.
- Tags remain text-readable and mobile-safe and do not rely on color alone.

### Tests / Validation

- Added `scripts/day42-customer-ordering.test.mjs` covering no-OTP checkout, restaurant-scoped customer identity, tag presentation, and removal of Twilio production configuration.
- Day 42 focused regression suite: **4/4 pass**.
- Non-e2e static regression suite: **all available static tests pass**.
- Full e2e execution remains environment-limited because the ZIP did not include `node_modules`; dependency installation timed out and offline installation could not complete from the local npm cache.
- API type-check/build and frontend type-check/build could not be completed for the same missing dependency reason.

### Known deployment/data note

- New customer records require `restaurantId` and use a compound `(restaurantId, mobileNumber)` uniqueness rule. Existing legacy customer records created by the previous global OTP identity model are retained for historical order references; production deployment should review/migrate legacy customer records and old MongoDB indexes before relying on the new restaurant-scoped uniqueness constraint.


## Part 1 — Customer Ordering Functionality, Takeaway QR & Ordering Errors (2026-09-30)

- Customer QR checkout no longer requires OTP, Twilio Verify, SMS verification, or a customer-authentication guard. Name + phone are submitted directly to the public order endpoint.
- The backend resolves/creates the restaurant-scoped customer from phone + restaurant and keeps phone explicitly unverified. Server-side menu ownership, availability, quantity, pricing, totals, restaurant and table-session validation remain enforced.
- Customer name + phone are persisted in restaurant-scoped browser localStorage and prefilled on subsequent orders; the customer can edit them.
- Added a restaurant-level Takeaway QR at `/takeaway/:restaurantId`; takeaway orders use the existing `OrderType.TAKEAWAY` enum and require no table or table session. Dine-in remains table/session constrained.
- Admin Orders now distinguish DINE_IN vs TAKEAWAY and order-item image URLs are snapshotted from the menu item at order creation for historical display, with a no-photo fallback.
- Group ordering continues to use the existing restaurant-scoped customer identity session created from name + phone; it no longer depends on OTP/Twilio.
- Removed Staff from the restaurant Admin navigation because the current UI exposes only a read-only membership list and no implemented staff-management workflow is required by another active feature. Backend staff endpoints were preserved for compatibility.
- Admin JWT persistence remains the existing single `/login` flow: the token is retained in browser localStorage until logout or its 7-day expiry; passwords are never stored.
- Deployment documentation was updated so customer OTP/Twilio is no longer described as the active ordering flow.
- Full dependency-backed build/typecheck/lint/live MongoDB/browser E2E must still be run in an environment with installed dependencies and configured external services; these checks are not claimed as passed from this source-only sandbox.

## Part 1.1 — Customer Reorder & Orders Error Fix

- Fixed returning-customer identity resolution so a repeat order reuses the existing customer record for the same restaurant + normalized phone instead of creating duplicates.
- Added duplicate-key/race handling around customer creation so concurrent/repeat identity capture does not surface as an unexplained HTTP 500.
- Customer order creation continues to create a fresh Order document with a fresh Mongo `_id` / order number; idempotency is only applied when the same checkout idempotency key is intentionally retried.
- Customer order history/detail customer lookups are now explicitly scoped by both `customerId` and `restaurantId`.
- Customer convenience tokens are now stored per restaurant (`mnu_customer_token:<restaurantId>`), preventing a token from one restaurant from being reused in another restaurant context.
- The Orders screen no longer requests customer order history when no restaurant-scoped customer profile exists. It shows the existing empty/initial state instead.
- When a saved name + phone profile exists but its convenience token is missing/stale, the browser silently re-identifies from that saved profile and retries history once; this is not a customer login or phone verification flow.
- Customer identity forms reuse the locally saved restaurant-scoped name and phone so returning customers are not asked to re-enter them unnecessarily.
- No broad UI redesign was performed and Part 2 was not started.

### Part 1.1 validation

- Focused Part 1.1 regression tests: **5/5 passed**.
- Existing MnU security/auth/customer-ordering regression tests: **29/29 passed** in the combined static test run.
- Full TypeScript typecheck, lint, production build, and database-backed/e2e execution could not be completed in this environment because the supplied project has no installed Node dependencies and the required pnpm package manager could not be downloaded from the npm registry (`EAI_AGAIN`).

## Part 2A — Professional Admin Panel UI Upgrade (2026-10-01)
- Upgraded the restaurant admin frontend visual system only; backend logic, authentication, database schemas, API behavior, customer ordering logic, and business rules were not changed.
- Reworked the restaurant workspace shell: professional dark sidebar, semantic inline icons, clearer active navigation, restaurant context, user area, mobile drawer, responsive header, and restrained status/count treatments.
- Redesigned Menu management as the primary admin workflow: real client-side search across item name/category/description, category filter chips with real counts, compact item table/list, image thumbnails with fallback, availability/featured states, compact actions, polished empty/loading states, and preserved existing CRUD handlers.
- Refined Orders with service-oriented filtering, clear DINE-IN/TAKEAWAY badges, real item thumbnails, status hierarchy, totals, group-order indicator, and compact operational ticket cards. Existing order/status APIs are unchanged.
- Refined Tables + QR management with explicit separation between restaurant-level Takeaway QR and individual Table QR codes, while preserving existing QR generation/download/print behavior.
- Refined Customers into a professional data-list treatment and Analytics into a clearer dashboard-linked workspace state. Dashboard quick actions now use restrained semantic letter marks instead of emoji.
- Added scoped admin design tokens/components in `apps/web/app/globals.css`, including responsive layouts, skeletons, status treatments, table/list primitives, panels, controls, and mobile behavior. Customer QR-menu styling remains scoped separately.

### Files changed
- `apps/web/app/globals.css`
- `apps/web/app/restaurants/[restaurantId]/layout.tsx`
- `apps/web/app/restaurants/[restaurantId]/menu/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/orders/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/tables/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/customers/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/analytics/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/dashboard/page.tsx`
- `docs/PROGRESS.md`

### Checks
- Source-level TSX transpilation check: passed for all modified TSX files.
- `npm run lint`: not runnable because dependencies are not installed (`next: not found`).
- `npm run build`: not runnable for the same environment limitation (`next: not found`).
- `npm ci --no-audit --no-fund` was attempted but timed out in the sandbox before dependencies could be installed.
- Browser/manual visual verification was not available in this environment; responsive behavior was reviewed from the code/CSS breakpoints.
- No backend files or API/business logic were modified for Part 2A.

## Part 2B — Customer QR Menu & Group Order UI Upgrade (2026-10-01)

- Upgraded the customer QR menu presentation without changing ordering APIs, authentication, customer identity, database schemas, or backend business rules.
- Refined menu item cards into a clearer premium hierarchy: stronger food imagery, calmer typography, compact price/action controls, consistent fallbacks, and tighter mobile spacing.
- Reworked `MenuTag` into a restrained semantic badge system using the existing MnU palette rather than emoji-heavy/random colors. Tags support clean wrapping and are capped to avoid covering core content.
- Preserved real data only: Signature/Popular states still come from existing `isFeatured` and order-derived popular-item data. No fake Recommended/New analytics were introduced.
- Updated category navigation to a lighter editorial tab treatment with a moving active underline, sticky mobile behavior, and touch-safe spacing.
- Refined the customer Orders history UI with explicit DINE-IN/TAKEAWAY labels, text status badges, real order-item thumbnails, clearer totals, and a more useful card hierarchy. Existing order-history API/logic remains unchanged.
- Reworked Group Order entry, join, and lobby screens so they share the QR Menu's warm/cream/terracotta visual language while keeping the existing group create/join/sync/place-order behavior unchanged.
- Added a clearer Group Order information hierarchy: shared-table context, group code, members, My Items, Group Items, group total, Add Items, and one primary Place Group Order action.
- Added accessible focus states to customer links/buttons/inputs and retained reduced-motion behavior from the existing motion system.
- Added mobile-specific refinements for narrow 360–420px screens, including compact badges and group-code input sizing.

### Files changed
- `apps/web/app/globals.css`
- `apps/web/app/menu/[restaurantId]/_components/MenuTag.tsx`
- `apps/web/app/menu/[restaurantId]/_components/DishCards.tsx`
- `apps/web/app/menu/[restaurantId]/_components/CategoryTabs.tsx`
- `apps/web/app/menu/[restaurantId]/_components/MenuSection.tsx`
- `apps/web/app/menu/[restaurantId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/_components/GroupShell.tsx`
- `apps/web/app/menu/[restaurantId]/group/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/join/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/[groupCode]/page.tsx`
- `apps/web/app/menu/[restaurantId]/orders/page.tsx`
- `docs/PROGRESS.md`

### Checks
- TSX transpilation/syntax check for all modified customer TSX files: passed.
- `tsc --noEmit`: attempted; could not complete because the supplied ZIP has no installed Node dependencies, so React/Next/Node type packages are unavailable. This produced environment/dependency errors rather than a clean project typecheck.
- `npm run lint`: not runnable because dependencies are not installed (`next: not found`).
- `npm run build`: not runnable for the same environment limitation (`next: not found`).
- Backend/API files were not modified for Part 2B.
- Browser/device visual verification was not available in this environment; code-level and narrow-screen CSS review were performed. No browser verification is claimed.

## Part 1.2 — Customer Identity & Ordering Reliability Audit (2026-10-04)

### Findings and fixes
- Fixed Indian phone canonicalization: `9876543210`, `919876543210`, and `+919876543210` now normalize to the same `+91…` representation. Separators such as spaces, dots, parentheses, and hyphens are removed before normalization.
- Added restaurant-scoped compatibility lookup for legacy Indian phone representations (`+91…`, `91…`, and 10-digit national form). Legacy stored values are not rewritten automatically because live duplicate/index state has not been inspected and automatic rewrites could collide with an existing unique index.
- Existing customer names are updated when the same restaurant + phone submits a changed valid name; a name change does not create a new customer.
- Preserved the existing security boundary: public order creation resolves identity from restaurant + submitted phone, customer order history/detail uses the authenticated customer token and restaurant scope, and order creation inserts a new Order document. Existing idempotency is only for retries using the same checkout key.
- No UI redesign was performed. No backend API contract, database schema, or authentication architecture was changed.

### Root-cause certainty / limits
- The supplied archive has no configured live MongoDB connection or production database dump, and no backend stack trace/request log was supplied. Therefore the reported HTTP 500 and the exact MongoDB exception could not be reproduced in this environment. It would be inaccurate to claim a verified exception or claim the database index state was inspected.
- The observed code-level defect is inconsistent normalization for the `91XXXXXXXXXX` form, plus no compatibility lookup for legacy phone representations. These can cause returning-customer lookup misses and are fixed here.
- `CustomerSchema` declares a unique sparse compound index on `{ restaurantId, mobileNumber }`. A previously-created standalone unique index from an older deployment would not necessarily be removed just by changing the schema. Inspect live `customers` indexes before changing/dropping any index. Do not automatically drop production indexes or rewrite existing customer records without a backup and duplicate audit.
- The same-session HTTP 500 is not conclusively attributed to one backend operation without a real response/stack trace. The current code can legitimately reject a second dine-in order with a 400 if the table has no active session; that is distinct from a 500. A live reproduction with the actual table/session and MongoDB is still required to identify any remaining infrastructure/data-specific failure.

### Files changed
- `apps/api/src/customers/customer-auth.service.ts`
- `scripts/day44-customer-ordering-errors.test.mjs`
- `docs/PROGRESS.md`

### Checks
- Focused customer identity/order regression source tests: **7/7 passed** (`node --test scripts/day44-customer-ordering-errors.test.mjs`).
- Full existing source-test suite: **66 passed, 5 failed**. Failures include pre-existing assertions that expect older UI palette/text and unrelated source patterns; they are not runtime API tests. The suite is not fully green and these failures are recorded rather than hidden.
- Lint, typecheck, and production build: **not run successfully** because this archive has no installed `node_modules`, and package installation was not available in the sandbox.
- MongoDB-backed tests, browser/session matrix, live dine-in/takeaway/group order submissions, and database index audit: **not performed** because no configured database/service credentials or running app were available.

### Remaining work before production sign-off
- Run against a staging MongoDB and inspect `db.customers.getIndexes()`; verify the only phone uniqueness constraint is restaurant-scoped and identify any legacy standalone index.
- Capture the exact HTTP 500 response and backend stack trace for second-order checkout, then run the full first/second/third order matrix for dine-in and takeaway, plus group ordering and history isolation.

## Part 1.3 — Existing Customer Order Creation 400 Investigation (2026-10-04)

### Findings and code changes
- Traced the request path from `PublicOrdersController.create()` through `OrdersService.createOrder()` to `CustomerAuthService.identify()`. The controller passes the checkout name and phone to the existing identity service; order creation receives the resolved customer ID and creates a separate Order document. No frontend payload change was needed from source inspection.
- The reported message was thrown only after customer creation returned MongoDB duplicate-key (`E11000`) errors and the service failed to find a matching customer using its narrower fallback lookup. That explains the immediate code path behind the generic 400, but the supplied project has no live database/index listing or backend stack trace, so the underlying conflicting index/key cannot yet be proven.
- Unified the post-duplicate lookup with the same restaurant-scoped, legacy-compatible phone lookup used before creation. This supports canonical `+91…` and legacy `91…` / national-number representations consistently, including the concurrent-create recovery path.
- Removed the generic `Could not create the customer record` conversion for unresolved duplicate-key errors. The service now logs the operation, restaurant ID, masked phone suffix, duplicate key pattern/index details where available, and stack; it then preserves the original MongoDB exception so the actual conflict is visible to backend diagnostics. No full phone number, token, password, or OTP is logged.
- If MongoDB reports a phone-key duplicate but no matching customer exists in this restaurant, the service logs and surfaces that exception immediately instead of retrying a conflict that cannot be resolved by another insert. This is consistent with the need to audit a possible obsolete global unique index without dropping or weakening any index blindly.
- Existing customer names are preserved. A checkout name only fills a missing/blank name on a legacy customer; it does not silently overwrite an existing name. The customer session token is still signed for the resolved customer and restaurant.
- Customer identity remains restaurant-scoped. The frontend-supplied customer ID is not used to authorize or choose the customer. No UI, API payload, schema, or database index was changed; OTP was not reintroduced.

### Files changed
- `apps/api/src/customers/customer-auth.service.ts`
- `scripts/day44-customer-ordering-errors.test.mjs`
- `scripts/day42-customer-ordering.test.mjs` (updated a source assertion to match the current legacy-compatible scoped lookup)
- `docs/PROGRESS.md`

### Tests and validation
- Focused customer identity/order source regression tests: **9/9 passed** (`node --test scripts/day44-customer-ordering-errors.test.mjs`).
- Full source suite: **68 passed, 5 failed** after updating the stale Day 42 lookup assertion. The remaining failures are outside this fix: two HTTP/e2e test files cannot start because compiled API output/dependencies are unavailable, and three unrelated static assertions are stale against existing deployment/admin/menu code. See the command output for exact test names.
- No TypeScript check, API build, frontend build, MongoDB-backed test, browser checkout, or real concurrent order test was completed: this archive does not contain `node_modules`, a running app, database credentials, or a database dump.
- No live customer index was inspected and no migration/index modification was made.

### Required runtime follow-up before declaring the root cause resolved
1. Reproduce checkout against the same database and capture the new server-side `E11000` key pattern/index name and stack.
2. Run `db.customers.getIndexes()` and inspect for a legacy standalone unique index on `mobileNumber` (or another conflicting key). Audit duplicates before any index change; do not drop an index blindly.
3. Run existing-customer order/reorder, 3 separate orders, phone-format variants, missing-name customer, same phone across two restaurants, simultaneous new-customer requests, takeaway, group order, and history-isolation tests against staging.
4. Verify each successful request creates one new Order and reuses the same restaurant-scoped Customer record.

**Status:** Code-level customer resolution and diagnostics are improved, but the definition of done is **not yet verified** until the real MongoDB duplicate-key evidence and checkout matrix are captured. This report does not claim the database-specific root cause is conclusively identified.


## Part 1.4 — Customer Identification Before Order Creation (2026-10-04)

### Objective and architecture change

Separated customer identification/registration from order creation as requested in the customer ordering architecture brief. The QR checkout path is now intended to be:

`Cart → Customer identification/session → Read-only customer summary + order review → Authenticated order creation → Confirmation`

The order endpoint no longer receives customer name/phone and no longer calls the customer find-or-create service. It requires a customer session, obtains the customer ID from the signed token guard, checks that the customer record belongs to the requested restaurant, then validates the cart/table and recomputes prices and totals from database menu items.

### Changed files

- `apps/api/src/customers/customer-auth.service.ts` — added a returning-customer lookup that normalizes the phone, searches only within the requested restaurant, and creates a session only when a matching record exists. Existing registration/identify behavior remains available for first-time registration and avoids creating another record when one already exists.
- `apps/api/src/customers/customer-auth.controller.ts` — added `POST /public/customer-auth/returning`.
- `apps/api/src/orders/public-orders.controller.ts` — order creation now requires `CustomerAuthGuard` and passes the authenticated customer ID to the service; customer name/phone are no longer accepted in the order payload.
- `apps/api/src/orders/orders.service.ts` — removed inline customer identification from `createOrder`; verifies `{ _id: customerId, restaurantId }` before creating the order. Server-side menu availability/pricing and table/takeaway validation remain in the existing flow.
- `apps/web/lib/api.ts` — order creation now uses the restaurant-scoped customer token; added the returning-customer lookup client call.
- `apps/web/app/menu/[restaurantId]/identify/page.tsx` — added the customer identification step: valid-session welcome back, returning customer phone lookup, not-found-to-registration path, and new customer registration.
- `apps/web/app/menu/[restaurantId]/cart/page.tsx` — checkout CTA now goes through customer identification before final review.
- `apps/web/app/menu/[restaurantId]/review/page.tsx` — removed editable name/phone fields; displays the identified customer as a read-only summary and submits orders using the customer session.
- `scripts/day39-deployment.test.mjs` — updated customer-ordering assertions for the new returning-lookup endpoint.
- `scripts/day42-customer-ordering.test.mjs` — updated assertions for the new session-first flow and refreshed a stale menu-tag color assertion to match the existing UI source.
- `scripts/day43-functionality.test.mjs` — updated assertions for session-protected order creation, profile persistence in the identification step, and the new checkout route.
- `scripts/day44-customer-ordering-errors.test.mjs` — added source-level regression checks for authenticated order creation and customer identification states.
- `docs/DEPLOYMENT.md` — updated the documented customer checkout sequence.

### Database and existing data

- No customer schema change was made.
- No MongoDB index was changed or dropped.
- No data migration was run.
- Existing customers are resolved using the existing canonical/legacy phone candidates within the restaurant. The actual deployed MongoDB indexes still need to be inspected before concluding whether a legacy unique index contributed to the earlier 400/500 reports.

### Validation performed

- Focused customer/deployment/functionality source tests: `node --test scripts/day42-customer-ordering.test.mjs scripts/day44-customer-ordering-errors.test.mjs scripts/day43-functionality.test.mjs scripts/day39-deployment.test.mjs` — **27 passed, 0 failed**.
- Full source suite: `node --test scripts/*.test.mjs` — **72 passed, 3 failed**. The remaining failures are two standalone E2E test scripts (`day40-super-admin-permissions.e2e.test.mjs`, `day41-single-login.e2e.test.mjs`) and one unrelated restaurant-management source assertion.
- TypeScript check attempted for both apps (`tsc -p apps/web/tsconfig.json --noEmit` and `tsc -p apps/api/tsconfig.json --noEmit`) — **blocked by missing dependencies/types** (`react`, `next`, `@nestjs/common`, `mongoose`, etc. are not installed in this extracted workspace). API build and frontend build therefore could not be completed.

### Remaining verification

Run the app with its configured dependencies and MongoDB, then test: new customer registration; returning customer lookup and missing-account registration; a valid session bypassing identification; three orders using one customer; same phone at a second restaurant; invalid/cross-restaurant token rejection; takeaway without a table; group order; and customer history with no previous orders. Inspect `db.customers.getIndexes()` before making any index/migration decision.

## Part 1.5 — Completely Remove Customer Authentication From Public Ordering (2026-10-05)

### Objective

Removed the customer authentication/identity requirement from the public QR ordering flow. Public customers can now place orders without providing a name, phone number, OTP, customer login/session, registration, or Customer record.

The intended solo flow is now:

`QR Menu → Select Items → Cart → Review Order → Place Order → Order Created`

### Frontend changes

- Removed the public customer identification/registration route and its supporting customer-auth UI components.
- Removed customer token/profile browser storage used by public ordering.
- Cart now routes directly to `/review`.
- Review no longer loads or validates a customer session, redirects to identity, asks for name/phone, or sends customer information. The Place Order action calls the anonymous public order endpoint directly.
- Customer Home no longer loads customer profile/name or renders the customer-name prompt.
- Customer Orders no longer attempts customer identification. It shows an identity-free empty state because there is no reliable customer identity from which to retrieve personal history.
- Order tracking/detail is now public and restaurant-scoped by `{ restaurantId, orderId }`; it does not display customer identity.

### Backend changes

- Removed `CustomerAuthGuard`, customer session decorator, customer-auth controller/service, and the public customer-auth module wiring.
- Removed customer-token signing/verification from `auth/jwt.util.ts`.
- `POST /public/restaurants/:restaurantId/orders` is now anonymous and remains rate-limited.
- `OrdersService.createOrder()` no longer finds/creates/validates a Customer and never requires `customerId` for public order creation.
- Removed the old customer-creation failure path from public ordering, including the possibility of exposing `Could not create the customer record. Please try again.` during normal anonymous checkout.
- Order idempotency now uses `{ restaurantId, idempotencyKey }` for the anonymous public flow. Existing server-side duplicate-key handling remains.
- Public order validation is unchanged in principle: restaurant existence, order type, table ownership/active table session for DINE_IN, restaurant-scoped menu items, item availability, integer quantities, server-side prices, line totals, subtotal, total, and order creation are all validated/computed on the server.

### Order model / database

- `Order.customerId` remains **optional** for compatibility with historical/admin-managed orders. It is not populated by new anonymous public orders.
- Existing Customer schema/collection was **not dropped** because the admin customer-management/history surface still reads legacy customer records associated with historical orders.
- No Customer collection or index was dropped.
- No destructive database migration was run.
- Group Order records were changed to use anonymous `participantId` values instead of Customer IDs for new group participation. Legacy group fields remain optional for compatibility; new group orders do not create or require Customer records.

### Group Order

- Removed CustomerAuthGuard from Group Order routes.
- Group members are identified only by a random browser `participantId` stored locally per restaurant. This is not a customer account, phone number, OTP, login, or server customer session.
- Group create/join/read/sync/place-order routes no longer require a Customer record.
- Group item prices and availability are still resolved from the restaurant's MenuItem records server-side.
- DINE_IN table and active table-session validation remains enforced for Group Orders.

### Security preserved

Removing customer authentication did **not** remove order validation. The server still verifies:

- restaurant exists
- DINE_IN table belongs to the requested restaurant
- DINE_IN table has an active table session
- TAKEAWAY does not receive a table
- every menu item belongs to the restaurant
- every menu item is available
- quantities are positive integers
- prices come from MongoDB menu data
- line totals/subtotal/total are calculated server-side
- order type is valid
- public order/detail access remains restaurant-scoped
- public order creation remains rate-limited

The browser cannot supply a trusted price, total, or customer ID to authorize an order.

### Files changed

- `apps/api/src/orders/public-orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/schemas/order.schema.ts`
- `apps/api/src/orders/orders.module.ts`
- `apps/api/src/group-orders/group-orders.controller.ts`
- `apps/api/src/group-orders/group-orders.service.ts`
- `apps/api/src/group-orders/group-orders.module.ts`
- `apps/api/src/group-orders/schemas/group-order.schema.ts`
- `apps/api/src/auth/jwt.util.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/common/guards/rate-limit.guard.ts`
- `apps/api/src/main.ts`
- Removed `apps/api/src/customers/customer-auth.controller.ts`
- Removed `apps/api/src/customers/customer-auth.service.ts`
- Removed `apps/api/src/customers/customer-auth.guard.ts`
- Removed `apps/api/src/customers/current-customer.decorator.ts`
- Removed `apps/api/src/customers/customers.module.ts`
- `apps/web/lib/api.ts`
- Added `apps/web/lib/groupParticipant.ts`
- Removed `apps/web/lib/customerAuth.ts`
- Removed `apps/web/lib/customerProfile.ts`
- `apps/web/app/menu/[restaurantId]/cart/page.tsx`
- `apps/web/app/menu/[restaurantId]/review/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/_components/HomeHero.tsx`
- `apps/web/app/menu/[restaurantId]/orders/page.tsx`
- `apps/web/app/menu/[restaurantId]/orders/[orderId]/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/join/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/[groupCode]/page.tsx`
- Removed `apps/web/app/menu/[restaurantId]/identify/page.tsx`
- Removed `apps/web/app/menu/[restaurantId]/_components/CustomerIdentityPanel.tsx`
- Removed `apps/web/app/menu/[restaurantId]/_components/CustomerNamePrompt.tsx`
- `scripts/day36-api-hardening.test.mjs`
- `scripts/day38-production-readiness.test.mjs`
- `scripts/day39-deployment.test.mjs`
- `scripts/day40-super-admin-permissions.e2e.test.mjs`
- `scripts/day42-customer-ordering.test.mjs`
- `scripts/day43-functionality.test.mjs`
- `scripts/day44-customer-ordering-errors.test.mjs`
- `scripts/security-audit.test.mjs`
- `docs/PROGRESS.md`

### Validation performed

- Anonymous-ordering focused source tests: **45/45 passed** across the updated Day 36/38/39/42/43/44 checks plus the security audit.
- Full static/source suite: **69 passed, 3 failed**. Two failures are E2E scripts that cannot start because this extracted workspace has no installed API dependencies/compiled runtime (`reflect-metadata` is missing). One remaining static failure is unrelated restaurant-management behavior. The anonymous-ordering-focused checks are green.
- API `tsc --noEmit`: attempted, but blocked by missing project dependencies/types (`@nestjs/*`, `mongoose`, `express`, `@types/node`, etc.). No clean project-wide typecheck can be claimed.
- Web `tsc --noEmit`: attempted, but blocked by missing React/Next dependencies/types. The earlier JSX syntax error introduced during editing was corrected; the remaining reported errors are dependency/type-environment errors.
- `npm/pnpm lint`: not runnable because dependencies are not installed.
- Production builds: not runnable because dependencies are not installed.
- Live MongoDB/application/browser verification: **not performed**. No live database credentials, running API, browser session, or database dump is available in this workspace.

### Definition-of-done status

The source architecture now permits public QR orders without customer identity and the old customer-creation error path is removed. Runtime confirmation is still required for the full matrix: anonymous DINE_IN, anonymous TAKEAWAY, anonymous repeat order, Group Order, refresh at Cart/Review, Orders empty state, invalid/wrong-restaurant items, and server-calculated totals.

## Part 1.6 — QR Menu Ordering With Name Only, No Phone Number (2026-10-05)

### Request
Customers must be able to order directly from the QR menu with **only their name**
and **without a phone number**. Fix every error found, change only what relates to
this update, and do not create duplicate database collections/names.

### What changed
- Checkout (`/menu/[restaurantId]/review`) now has a required **Your name** field.
  It is validated in the browser (2-80 characters; letters, spaces, apostrophes,
  dots, hyphens) and again on the server. No phone/mobile field exists anywhere in
  the customer ordering flow.
- `POST /public/restaurants/:restaurantId/orders` accepts `customerName`.
  `OrdersService.createOrder` normalizes it (trim, collapse spaces), rejects a
  missing/invalid name with a clear 400 message, and stores it on the order. It still
  creates, finds or requires **no Customer record**, so the old customer-creation
  error path stays removed. Prices/totals remain server-calculated.
- **No new database collection or duplicate name was added.** The name is stored as a
  new optional `customerName` field on the existing `Order` schema/collection. Existing
  orders without it remain valid. The existing `Customer` schema, its `mobileNumber`
  field, and all indexes are untouched (still used only for legacy/admin records).
- Admin order detail shows `Customer · <name>` for QR orders that have no legacy
  Customer record; `AdminOrderRecord` gained optional `customerName`.
- Group ordering was intentionally **not** changed.

### Errors found and fixed
- `apps/web/app/menu/[restaurantId]/home/page.tsx` was an **empty (0-byte) file** in the
  uploaded archive, which broke `next build` ("not a module") and the customer Home
  route. Rebuilt it from the existing Home components, the same public menu/popular
  APIs and the same cart hook; no new endpoints.
- `group/_components/GroupShell.tsx`: `CustomerTheme` was rendered without its required
  `restaurantId` (TS2741). Now read via `useParams`.
- `app/takeaway/[restaurantId]/page.tsx`: read `menu.restaurant.name`, which does not
  exist on `PublicMenu` (TS2339, would crash at runtime). Now `menu.restaurantName`.

### Files changed
- `apps/api/src/orders/public-orders.controller.ts`
- `apps/api/src/orders/orders.service.ts`
- `apps/api/src/orders/schemas/order.schema.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/menu/[restaurantId]/review/page.tsx`
- `apps/web/app/menu/[restaurantId]/home/page.tsx`
- `apps/web/app/menu/[restaurantId]/group/_components/GroupShell.tsx`
- `apps/web/app/takeaway/[restaurantId]/page.tsx`
- `apps/web/app/restaurants/[restaurantId]/orders/[orderId]/page.tsx`
- `scripts/day44-customer-ordering-errors.test.mjs`
- `docs/PROGRESS.md`

### Validation performed
- API `tsc --noEmit`: clean (dependencies installed).
- Web `tsc --noEmit`: clean (was 2 errors + the empty home page).
- Web `next build` (with `NEXT_PUBLIC_API_URL` set, as the production guard requires): succeeds, all routes generated.
- Source tests: all pass except `day41-single-login` "restaurant management pages use the shared selected-restaurant context", a pre-existing failure unrelated to ordering (not touched).
- Not performed: live MongoDB/browser run and the two E2E scripts (need a running database).

## Part 1.7 — Optional Customer Recognition for QR Ordering (2026-10-06)

### Architecture
Customer recognition is an **optional convenience layer**, separate from order creation:

```
recognition (optional) -> display name -> sent as the normal `customerName` -> POST /public/restaurants/:id/orders (unchanged)
```

- `OrdersService.createOrder()`, `PublicOrdersController`, `OrdersModule`, Group Order, Takeaway, tables/sessions, admin and auth are **byte-identical** to the Part 1.6 archive. No OTP, Twilio, password, customer login, CustomerAuthGuard, customer session or `customerId` was reintroduced.
- Browser identity: a random 256-bit opaque token (`randomBytes(32)`, base64url) stored in `localStorage` under `mnu_customer_identity:<restaurantId>`. It contains no name, phone or customer id. No IP, fingerprinting or other tracking.
- Server: only the SHA-256 **hash** of the token is stored, inside the existing `Customer` document (`recognitionTokens`, max 10 newest browsers). Lookup is `{ restaurantId, recognitionTokens.tokenHash }`, so a token can only ever recognize a customer of the restaurant it was issued for. A deleted customer simply stops matching. `select: false` keeps hashes out of every existing query.
- Endpoints (`POST /public/restaurants/:restaurantId/customer-recognition/...`): `resolve` (token), `returning` (phone only), `register` (name + phone), `forget` (token). Always HTTP 200 with a `status` (`recognized | unrecognized | not_found | invalid | cleared | unavailable`); any database problem becomes `unavailable`, never a 500. `returning`/`register` are rate limited (10/min/IP), `resolve` 60/min, `forget` 30/min.
- Phone handling reuses the project's canonical normalization (`+91` handling and legacy `91…`/10-digit candidates), moved unchanged from the deleted `customer-auth.service.ts` into `customers/customer-contact.util.ts`; it is the only implementation. The browser only ever receives a masked phone (`98XXXXXX10`).

### Cases (review page `/menu/:id/review`)
- **New customer + new browser:** "Have you ordered here before?" -> No -> name + phone -> customer created or reused (never duplicated) -> token saved -> "Welcome back / Ordering as" -> review -> order.
- **Existing customer + new browser:** Yes -> phone only -> customer found -> *this browser* gets its own token -> welcome -> review. Phone not found -> registration (typed number carried over).
- **Existing customer + same browser:** token resolved automatically; no questions, no phone/name field; review shows `Customer / Ruchit / 98XXXXXX10 / ✓ Recognized customer`.
- **Change customer:** clears only this restaurant's token (and revokes it server-side); cart, table, admin login, other restaurants, the Customer and past orders are untouched.
- **Fallback (hard requirement):** every identification step has "Continue with just my name". Resolve failure/timeout (6 s) -> plain Part 1.6 name field. Place order is available in `recognized` and `nameOnly` states, and the order request is identical in both.

### Files changed
- API: `customers/customer-contact.util.ts` (new), `customers/customer-recognition.service.ts` (new), `customers/customer-recognition.controller.ts` (new), `customers/customer-recognition.module.ts` (new), `customers/schemas/customer.schema.ts`, `app.module.ts`
- Web: `lib/customerRecognition.ts` (new), `lib/useCustomerRecognition.ts` (new), `lib/api.ts`, `app/menu/[restaurantId]/_components/CustomerIdentifier.tsx` (new), `app/menu/[restaurantId]/review/page.tsx`
- Tests: `scripts/customer-recognition.test.mjs` (new), `scripts/recognition-harness/*` (new, test-only), `scripts/day44-customer-ordering-errors.test.mjs` (one location-based assertion updated: the `customer-name` input moved from `review/page.tsx` into `CustomerIdentifier.tsx`; all order-path assertions untouched)
- Docs: this entry

### Database
- Collections changed: **none** (no new collection; existing `Customer` reused).
- Schema changed: `Customer` gained optional `recognitionTokens: { tokenHash, createdAt }[]` (additive, `select: false`, no default).
- Indexes changed: **one added**, non-unique + partial: `{ restaurantId: 1, 'recognitionTokens.tokenHash': 1 }`. Existing indexes (unique sparse `{ restaurantId, mobileNumber }`, unique `customerCode`, unique sparse `email`) are untouched; nothing dropped.
- Migration required: **none**. Verify the new index is built in production (depends on `autoIndex`), and still run `db.customers.getIndexes()` for the legacy-index audit left open in Part 1.3.

### Validation performed
- `node --test scripts/*.test.mjs`: **92 passed, 3 failed** (baseline before this work: 70 passed, 3 failed). The same 3 failures as before: `day40`/`day41` E2E scripts (need a running API + MongoDB) and the unrelated "restaurant management pages…" assertion.
- New `customer-recognition.test.mjs`: 22/22. Static architecture checks plus behavior tests that compile the REAL service with `tsc` (project flags: `strictNullChecks`, `noImplicitAny`) against minimal NestJS/Mongoose stand-ins and an in-memory Customer model enforcing the unique indexes with failure injection. Covers matrix A–E, G–K, plus phone variants, legacy phone/nameless customers, concurrency (6 parallel registrations -> 1 customer), customerCode collision retry, unresolvable legacy-index conflict -> `unavailable`, token cap, input validation, and log hygiene (no raw phone/token/hash in logs).
- Web: new/changed files type-check clean under `strict` against typed React/Next stand-ins.

### NOT verified (environment limits)
- Real `pnpm install`, API/Web `tsc`, API/Web `build`: **not run** (package registry blocked, no `node_modules`). Only the stand-in checks above.
- Real MongoDB behavior (unique/partial index build, `$push/$slice`, `select:false`), a live API, and any browser run: **not performed**. Matrix F (cleared storage), L (takeaway), M (dine-in), N (group order) were not exercised end to end; for L/M/N the evidence is that all order, group, takeaway, table and session code is byte-identical to the previous archive.

### Known limitations / decisions
- **Phone-only recognition is not authentication.** Anyone who knows a customer's phone can be recognized as that customer on their own device and sees that customer's name and masked phone. Mitigations: restaurant scope, tight per-IP rate limit (in-memory, per API instance), no history exposed, no order linkage. Name is first-writer-wins (an existing name is never overwritten).
- Customer **order history was deliberately not wired to recognition** (Orders page unchanged): phone-only recognition is too weak to protect history, and orders are not linked to `customerId`. Consequently the admin customer list (driven by `Order.customerId`) does not show recognition-only customers. Linking orders to customers needs a separate decision.
- A recognized legacy customer with no valid stored name sees a name field inside the Customer card (the order still requires a name); no phone field is ever shown.
- Pre-existing, untouched: the unique sparse `{ restaurantId, mobileNumber }` index still indexes documents that have `restaurantId` but no `mobileNumber`, so two legacy phone-less customers in one restaurant would collide with each other. Recognition always sets `mobileNumber`.

## Part 1.8 — Backend and frontend separated (2026-10-06)

Structure change only; **no application logic was changed**.

```
apps/api  ->  backend/    (+ docker-compose.yml for local MongoDB, + README.md)
apps/web  ->  frontend/
docs/, scripts/, menu_tail.tsx stay at the repository root
```

- Removed the root workspace tooling that tied the two together: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `pnpm-lock.yaml`. Each project already had its own `package-lock.json` and is installed/built/deployed on its own with `npm ci`. (`pnpm-lock.yaml` spanned both apps and cannot be split without pnpm; run `pnpm install` inside a project if you want a pnpm lock.) Removed the stale build artifact `frontend/tsconfig.tsbuildinfo`.
- There were no shared packages and no cross-imports between the apps (verified: no `workspace:` dependencies, no source reaching outside its own app); they communicate only over HTTP via `NEXT_PUBLIC_API_URL` / `CORS_ORIGINS`.
- Updated paths in: `scripts/*.mjs` (`apps/api`->`backend`, `apps/web`->`frontend`), `docs/DEPLOYMENT.md`, `docs/DATABASE.md` (operational commands now use `npm`, not `pnpm --filter`), root `.gitignore`, `backend/.env.example`, `frontend/README.md`, and two strings in backend source (a comment in `common/cloudinary.ts` and the startup warning in `main.ts` that names where `.env` lives).
- **Reading older entries in this file:** they use the old paths. `apps/api` = `backend`, `apps/web` = `frontend`. They were intentionally left as written.
- Not changed: any `.ts`/`.tsx` logic, API routes, database, tests' assertions (paths only).
