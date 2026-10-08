# MnU — Current Project Status Report

Generated from a direct inspection of the repository's actual code —
no assumptions from prior progress notes, chat history, or intent.
Every claim below is backed by a specific file. "Code exists" and
"feature works" are treated as different claims throughout; almost
nothing here has been exercised against a live database (see the
sandbox-limitation note repeated in `docs/PROGRESS.md` — no live
MongoDB has ever been reachable in the environment these sessions ran
in), so most ✅/🟡 ratings below are "correct by code review," not
"confirmed by running it."

---

## 1. Project setup — ✅ COMPLETE
Turborepo monorepo (`turbo.json`, `pnpm-workspace.yaml`), two apps:
`apps/api` (NestJS 10) and `apps/web` (Next.js 15 / React 19 / Tailwind
v4). `docker-compose.yml` defines a local `mongo:7` service. Both apps
have working `tsc --noEmit` and build scripts.
- ⚠️ NEEDS VERIFICATION: `pnpm install && pnpm build` at the repo root
  via Turborepo — every verification in this project's history has run
  `npm install`/`npm run build` inside each app individually, not the
  root Turborepo pipeline itself.

## 2. Frontend — ✅ COMPLETE (as a shell), 🟡 PARTIAL (as a product)
Next.js App Router, 12 routes total. Real pages: `/`, `/login`,
`/register`, `/dashboard` (restaurant picker), `/restaurants/[id]/menu`,
`/restaurants/[id]/tables`, `/restaurants/[id]/dashboard`, plus a shared
`layout.tsx` (sidebar + header) and `restaurant-context.tsx` for
everything under `/restaurants/[id]/`. Stub pages: `orders`, `analytics`,
`settings` (all under `/restaurants/[id]/`) — clean "coming soon" states,
no fake data. `/menu/demo` is a hardcoded dummy page (`lib/dummy-menu.ts`),
not connected to any API.
- Frontend/backend connection: real for auth, menu, tables. Not wired for
  anything else (nothing else has a backend to wire to).

## 3. Backend/API — 🟡 PARTIAL
NestJS with three real feature modules: `AuthModule`, `MenuModule`,
`TablesModule`, plus `DatabaseModule` (global Mongoose connection) and
`AppController` (`GET /health`). No modules exist yet for orders,
payments, QR, analytics, or any AI feature — there is nothing to rate
there beyond ❌.

## 4. MongoDB/Mongoose — ✅ COMPLETE (setup), ⚠️ NEEDS VERIFICATION (live)
`@nestjs/mongoose` + `mongoose`, no Prisma anywhere in `apps/api/src`
(fully migrated; legacy Prisma files were deleted in this branch's
history, not archived). `apps/api/.env` has a real `DATABASE_URL`
pointing at an Atlas cluster (`cluster0.0gxalhd.mongodb.net`).
`User`/`Restaurant`/`RestaurantMember` explicitly pin `collection:` to
match pre-existing Prisma-era collection names (a real bug was found and
fixed here — see `docs/PROGRESS.md`, "Fixed: Mongoose was writing to the
wrong collections"). `Category`/`MenuItem`/`Table` are new collections
with no such legacy concern.
- ⚠️ No environment in this project's history has ever had network
  access to that Atlas cluster or any MongoDB instance. Every "verified"
  claim in `docs/PROGRESS.md` for anything DB-related is "boots cleanly
  and attempts the connection," not "confirmed read/write against real
  data." Whether the Atlas cluster is currently reachable, has the right
  IP allowlist, correct credentials, etc. is unverified from here.

## 5. Authentication — ✅ COMPLETE (code-level)
`POST /auth/register`, `POST /auth/login`, `GET /auth/me`,
`POST /auth/logout` (`apps/api/src/auth/`). Bcrypt password hashing,
JWT via `jsonwebtoken` (`{ user_id }` payload only), `JwtAuthGuard` +
`@CurrentUserId()` decorator reused by every protected route in the
project. Frontend `/login` and `/register` call the real
`authApi` (`lib/api.ts`), store the token as `localStorage['mnu_token']`.
- ⚠️ NEEDS VERIFICATION: never run against a live database. Logic has
  been reviewed and boot-tested but never actually round-tripped.
- Known gaps: no password reset, no email verification, no rate
  limiting on login attempts, JWT has no expiry check visible in
  `jwt.util.ts` beyond whatever `jsonwebtoken`'s default `sign()`/`verify()`
  behavior provides (worth confirming an expiry is actually set).

## 6. User management — 🟡 PARTIAL
A `User` exists only as a byproduct of `/auth/register` (name, email,
password hash). There is:
- ❌ No endpoint to invite another user to a restaurant.
- ❌ No endpoint to change a user's role after registration.
- ❌ No endpoint to remove a user from a restaurant.
- ❌ No user profile/edit-account screen or endpoint.
The only way a `RestaurantMember` row is ever created is inside
`AuthService.register()`, which always assigns `RESTAURANT_ADMIN` to the
person creating the restaurant. There is no code path that ever
produces a `RESTAURANT_STAFF` membership other than manual database
insertion (e.g. via `seed.ts`, which does create one for demonstration).

## 7. Roles/RBAC — ✅ COMPLETE (enforcement), 🟡 PARTIAL (management)
`RestaurantRole` enum (`SUPER_ADMIN`/`RESTAURANT_ADMIN`/`RESTAURANT_STAFF`).
Enforcement is real and consistent: `MenuService` and `TablesService`
both implement `requireMembership()` (any role, gates reads) and
`requireManager()` (admin/super-admin only, gates writes), checked
server-side on every request — not just in the UI. Frontend mirrors this
client-side (`canManage` hides edit controls for staff) but the actual
security boundary is the backend check.
- 🟡 As per #6, there's no way to *create* a staff-role user through the
  product itself — RBAC enforcement exists, but role assignment doesn't.

## 8. Restaurant management — 🟡 PARTIAL
`Restaurant` model (`apps/api/src/restaurants/schemas/restaurant.schema.ts`)
has exactly one field: `name`. No address, phone, cuisine type, logo,
hours, or description. Created only as a side effect of `/auth/register`.
- ❌ No endpoint to update a restaurant's own details.
- `/restaurants/[id]/settings` (frontend) shows restaurant name, role,
  and signed-in user as **read-only** fields — explicitly not editable,
  because no backend endpoint exists for it.

## 9. Restaurant Admin Dashboard — ✅ COMPLETE (as a shell)
`apps/web/app/restaurants/[restaurantId]/dashboard/page.tsx` + shared
`layout.tsx` (sidebar: Dashboard/Menu/Tables/Orders/Analytics/Settings,
header with role badge + restaurant switcher when a user has multiple
memberships + logout). Shows real counts from `menuApi.getMenu()` and
`tablesApi.list()` (categories/items/available-items, table count) with
"Set up"/"Not set up" badges — no fabricated numbers anywhere. A
"Getting started" checklist self-checks off from real menu/table data;
QR/Orders rows are static "Coming soon."
- Frontend-only — no backend endpoint exists specifically for "dashboard
  data"; it's composed client-side from the menu and tables APIs.
- ⚠️ NEEDS VERIFICATION: never rendered against a live backend in this
  project's history — only against a throwaway local mock, per
  `docs/PROGRESS.md`'s Day 6 entry.

## 10. Menu management — ✅ COMPLETE (code-level)
`MenuModule` (`apps/api/src/menu/`): full CRUD-equivalent —
`GET /restaurants/:id/menu`, category create/update/delete, item
create/update/delete, item availability toggle. RBAC as described in
#7. Frontend: `/restaurants/[id]/menu` — real page, add/rename/delete
category, add/edit/delete item, availability toggle, loading/empty/error
states, delete confirmation.
- ⚠️ NEEDS VERIFICATION: never exercised against a live database.

## 11. Category management — ✅ COMPLETE (code-level)
Covered above as part of Menu management — `Category` is its own schema
and its own set of endpoints (not a sub-field of Menu), cascade-deletes
its items via an explicit `deleteMany()` (Mongoose has no automatic
cascade, unlike the Prisma version this replaced).

## 12. Table management — ✅ COMPLETE (code-level)
`TablesModule` (`apps/api/src/tables/`): full CRUD, `tableNumber`
(string) + `capacity` + `status` enum (`AVAILABLE`/`OCCUPIED`/`INACTIVE`).
Unique compound index prevents duplicate table numbers per restaurant.
Frontend: `/restaurants/[id]/tables` — same shape as the menu page
(cards, add/edit/delete, status badges, staff read-only view,
loading/empty/error states, delete confirmation).
- Status is set manually via the edit form only — nothing updates it
  automatically (no session/order system exists to drive that yet).
- ⚠️ NEEDS VERIFICATION: never exercised against a live database.

## 13. QR system — ❌ NOT IMPLEMENTED
No QR-related code anywhere in the repository. No QR generation library
in either `package.json`. `Table` has no QR token/slug field. The
dashboard's "Generate QR codes" checklist item is a static, disabled
"Coming soon" row.

## 14. Customer menu — ❌ NOT IMPLEMENTED (as a real feature)
`/menu/demo` exists but is explicitly a hardcoded static mockup
(`apps/web/lib/dummy-menu.ts`) — no restaurant id, no API call, same
fixed data for everyone. There is no public/unauthenticated menu-read
endpoint on the backend (the only menu-read endpoint,
`GET /restaurants/:id/menu`, requires a valid JWT and restaurant
membership — a customer could not call it). A customer-facing menu
backed by real data does not exist.

## 15. Customer table/session — ❌ NOT IMPLEMENTED
No session model, no table-scan-to-session flow, no customer identity
concept anywhere in the codebase.

## 16. Cart — ❌ NOT IMPLEMENTED
No cart model, endpoint, or UI. No client-side state management library
installed for it either (no Redux/Zustand/Context beyond the admin-side
`restaurant-context.tsx`, which is unrelated).

## 17. Orders — ❌ NOT IMPLEMENTED
No `Order` schema, no orders module/controller/service. The frontend
`/restaurants/[id]/orders` page is a static "Coming soon" empty state.
The dashboard's "View Orders" quick action is visibly disabled.

## 18. Restaurant order management — ❌ NOT IMPLEMENTED
Depends entirely on #17, which doesn't exist.

## 19. Kitchen workflow — ❌ NOT IMPLEMENTED
No kitchen-display, ticket, or order-status-progression concept anywhere.

## 20. Payments — ❌ NOT IMPLEMENTED
No payment provider SDK in either `package.json` (no Stripe/Razorpay/
PayPal/etc.), no payment model or endpoint.

## 21. Analytics — ❌ NOT IMPLEMENTED
`/restaurants/[id]/analytics` is a static "Coming soon" empty state, no
backend endpoint, no data model. Explicitly, per `docs/PROGRESS.md`, "no
invented order/revenue/customer numbers anywhere."

## 22. MnU Revenue Engine — ❌ NOT IMPLEMENTED
No code, no model, no mention outside of task/planning text. Depends on
Orders + Payments + Analytics, none of which exist.

## 23. Menu Intelligence Score — ❌ NOT IMPLEMENTED
No scoring logic, no related field on `Category`/`MenuItem`, no endpoint.

## 24. Dynamic Menu — ❌ NOT IMPLEMENTED
Menu items are static once saved; nothing conditionally changes prices,
availability, or ordering based on time/demand/anything else. (Manual
`isAvailable` toggling exists — that's staff-operated, not dynamic.)

## 25. Smart recommendations — ❌ NOT IMPLEMENTED
No recommendation logic, model, or UI anywhere.

## 26. Upselling/cross-selling — ❌ NOT IMPLEMENTED
Same — no code.

## 27. Customer profile/memory — ❌ NOT IMPLEMENTED
No customer entity exists at all (see #15). There is nothing to attach
a profile or memory to.

## 28. Gamification — ❌ NOT IMPLEMENTED
No code.

## 29. Retention features — ❌ NOT IMPLEMENTED
No code (no email/SMS sending capability exists in either app's
dependencies, which would be a prerequisite for most retention
mechanics).

## 30. AI Menu Engineer — ❌ NOT IMPLEMENTED
No AI/LLM SDK in either `package.json` (no OpenAI/Anthropic/etc. client
libraries), no related code.

## 31. A/B testing — ❌ NOT IMPLEMENTED
No experimentation framework or flagging system of any kind.

## 32. Weather-aware menu — ❌ NOT IMPLEMENTED
No weather API integration, no related field or logic.

## 33. Event-aware menu — ❌ NOT IMPLEMENTED
No code.

## 34. Multilingual menu — ❌ NOT IMPLEMENTED
No i18n library installed, no translated-content fields on `Category`/
`MenuItem` (both are single-locale strings only).

## 35. Voice ordering — ❌ NOT IMPLEMENTED
No speech/voice SDK, no related code.

## 36. Group ordering — ❌ NOT IMPLEMENTED
No code — and would depend on Cart + Customer session, neither of which
exist.

## 37. AI food photography — ❌ NOT IMPLEMENTED
No image-generation SDK, no image field on `MenuItem` at all currently
(not even a manually-uploaded photo URL).

## 38. WhatsApp ordering — ❌ NOT IMPLEMENTED
No WhatsApp Business API / Twilio / messaging SDK in either
`package.json`.

## 39. Mobile applications — ❌ NOT IMPLEMENTED
No React Native, Expo, Flutter, or any mobile project in the repository.
The web app is responsive (Tailwind breakpoints, a mobile drawer nav in
`layout.tsx`) but that is a responsive website, not a mobile application.

---

## A. Features that are completely finished
Nothing in this codebase has been confirmed finished in the sense of
"built, connected, and verified working end-to-end against a live
database." The closest candidates — Auth, Menu management, Table
management — are complete at the code level (✅ by review) but
carry an unresolved ⚠️ NEEDS VERIFICATION for the "actually works
against real data" claim, because no environment in this project's
history has ever had a reachable MongoDB.

## B. Features that are partially finished
Restaurant management (name only, no edit), User management (no
invite/role-change/remove flow), RBAC (enforcement solid, management
absent), Restaurant Admin Dashboard (real shell + real counts, but
unverified live).

## C. Features that exist only as UI/prototype
`/menu/demo` (hardcoded dummy data, no API). The `/restaurants/[id]/orders`,
`/analytics`, `/settings` pages are real code but intentionally inert
placeholders — settings shows real data read-only; orders/analytics show
no data because none exists.

## D. Features that exist only in backend
None. Every backend module built so far (auth, menu, tables) has a
matching, wired frontend screen.

## E. Features that have no implementation
QR system, Customer menu (real), Customer session, Cart, Orders,
Restaurant order management, Kitchen workflow, Payments, Analytics
(real), MnU Revenue Engine, Menu Intelligence Score, Dynamic Menu, Smart
recommendations, Upselling, Customer profile/memory, Gamification,
Retention features, AI Menu Engineer, A/B testing, Weather-aware menu,
Event-aware menu, Multilingual menu, Voice ordering, Group ordering, AI
food photography, WhatsApp ordering, Mobile applications. That's 25 of
the 39 requested areas.

## F. Bugs or incomplete integrations
- No known open bugs in the currently-implemented code — the two real
  bugs found in this project's history (Mongoose writing to the wrong
  collections; a `CannotDetermineTypeError` crash from an untyped union
  `@Prop`) were both found and fixed, per `docs/PROGRESS.md`.
- Incomplete integration: the entire product has never been run end to
  end against a real, reachable MongoDB. Every "it works" claim to date
  is "correct by static review and a clean boot," not "confirmed by
  actually reading/writing data."
- `/auth/logout` doesn't invalidate anything server-side (JWTs are
  stateless, by design) — worth knowing, not really a bug.

## G. Missing frontend screens
- Public/customer-facing menu (real one, not `/menu/demo`)
- Any customer-facing screen at all (session, cart, checkout, order
  status)
- QR code display/download screen for admins
- Staff invite / team management screen
- Restaurant profile edit screen
- Order management / kitchen display screen
- Analytics dashboard (real, data-backed)
- Any settings that are actually editable

## H. Missing backend functionality
- Public (unauthenticated) menu-read endpoint for customers
- QR token generation/validation
- Order creation, status transitions, retrieval
- Payment intent creation/webhook handling
- Staff invite / role management endpoints
- Restaurant profile update endpoint
- Any analytics aggregation endpoint
- Everything under MnU Intelligence / Advanced AI (39.14–39.31 in the
  numbered list above)

## I. Missing database models
`Order`, `OrderItem`, `Cart`, `CustomerSession`/`CustomerProfile`,
`Payment`, `QRCode`/table QR token field, any analytics/event-log
collection, any AI/recommendation-related collection.

## J. Security/multi-tenant concerns
- Multi-tenant isolation for Menu and Tables is real and consistent:
  every single-resource lookup scopes by `{ _id, restaurantId }`
  together, so a valid id from a different restaurant 404s rather than
  leaking data or a distinguishing error. This has been verified by
  code review, not by an actual cross-tenant request test.
- No rate limiting anywhere (login, register, or otherwise) —
  brute-force risk on `/auth/login` in particular.
- JWT secret lives in `apps/api/.env` (gitignored, correctly not
  committed) — but its actual value has not been rotated/audited as
  part of any session; it's whatever was copied over from the `mnu_v1`
  upload early in this project's history.
- No input sanitization beyond basic presence/type checks (e.g. no XSS
  sanitization on menu item names/descriptions before they'd eventually
  render on a public customer menu, once one exists).
- No audit logging of who changed what.

## K. Items that need real-world/end-to-end testing
Every single ✅/🟡 item above. Concretely, in priority order:
1. `/auth/register` → `/auth/login` → `/auth/me` against the real Atlas
   cluster in `.env`.
2. Category/item CRUD + availability toggle on `/restaurants/:id/menu`,
   as both `RESTAURANT_ADMIN` and `RESTAURANT_STAFF`.
3. Table CRUD on `/restaurants/:id/tables`, same two roles.
4. A genuine cross-restaurant access attempt (a valid table/category/item
   id from Restaurant A, requested while authenticated as a member of
   Restaurant B only) — the 404-not-403 behavior described in §7/§12 has
   never been tested against a live server.
5. The dashboard's real-count display, against actual saved menu/table
   data rather than a mock.
6. `pnpm build`/`pnpm dev` at the repo root via Turborepo, not just each
   app individually.

---

## CURRENT COMPLETION SUMMARY

| Area | Estimate |
|---|---|
| Foundation | 80% |
| Restaurant Management | 55% |
| Customer Ordering | 2% |
| Operations | 0% |
| Analytics | 0% |
| MnU Intelligence | 0% |
| Advanced AI | 0% |

**Overall estimated implementation status: ~17%**

*(Method: Foundation = project setup/frontend shell/backend shell/DB
layer/auth/RBAC, all code-complete but unverified live. Restaurant
Management = restaurant/dashboard/menu/category/table, real and
code-complete except restaurant-profile editing and staff/role
management, which don't exist. Customer Ordering counts only the static
`/menu/demo` mockup as any signal at all — everything a real customer
would touch is unbuilt. Operations/Analytics/MnU Intelligence/Advanced
AI are 0% by direct code absence — no models, no endpoints, no UI logic,
not even a stub beyond a "coming soon" page for two of them. The overall
17% is a rough weighted read of "how much of the full 39-item vision
this document was asked to check against actually exists," not a
statement about code quality of what has been built.)*

---

## NEXT RECOMMENDED TASK

**Run the existing system end-to-end against a real, reachable
MongoDB — with no new code.**

Every feature rated ✅/🟡 above (auth, RBAC, menu, tables, dashboard)
has been reviewed, typechecked, and boot-tested, but never actually
exercised against live data, because no sandbox in this project's
history has had network access to MongoDB. This is the single highest-
leverage next step: it's zero new code, and it either confirms the
entire foundation is solid (in which case Orders/QR/Customer Menu can be
built on top with confidence) or it surfaces a real integration bug
before more features get built on top of an unverified base.
