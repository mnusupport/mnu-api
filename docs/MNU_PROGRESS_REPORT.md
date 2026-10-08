# MnU — Project Progress Report

*Covering Day 1 through Day 8. Consolidated from docs/PROGRESS.md into a
readable narrative — see that file for the full technical changelog.*

---

## Executive Summary

MnU is a restaurant technology platform being built in stages: QR-based
table ordering, restaurant management, menu intelligence, and revenue
optimization. Eight work sessions in, the **admin-facing foundation is
solid** — authentication, role-based access, menu management, and table
management are all built and internally consistent. The **customer-facing
product has just begun** — a table-session foundation now exists, but
QR generation, a real customer menu, cart, and ordering do not yet exist.

**Overall estimated completion: ~17-20% of the full product vision**
(see the full feature-by-feature audit in
`docs/MNU_CURRENT_PROJECT_STATUS.md` for the complete breakdown).

**The single most important open item is not a missing feature — it's
verification.** No environment used across this project's history has
ever had network access to a real, running MongoDB instance. Every
"complete" rating below means "reviewed, typechecked, and confirmed to
boot without errors" — not "confirmed working against real data." This
is flagged repeatedly below because it's the same caveat every session
has run into, not a one-off gap.

---

## Timeline

### Day 1 — Foundation
Monorepo scaffolded (Turborepo, `apps/web` + `apps/api`). At this point
`apps/web` was an empty placeholder — the frontend wasn't actually built
until later (see below).

### Day 2 — Database connection foundation
Prisma wired into the NestJS backend, `GET /health` endpoint, local dev
infrastructure (`docker-compose.yml`). Originally built and verified
against **PostgreSQL**.

### Day 3 — Users, roles, restaurants foundation
Core data model defined: `User`, `Restaurant`, `RestaurantMember` (a
join table so one user can hold different roles at different
restaurants), and the `RestaurantRole` enum
(`SUPER_ADMIN`/`RESTAURANT_ADMIN`/`RESTAURANT_STAFF`). Verified against
a real PostgreSQL database at the time — schema applied, multi-role
membership confirmed, unique constraints confirmed, cascade delete
confirmed.

### Database provider switch: PostgreSQL to MongoDB
The project's direction changed to MongoDB. Schema, health check,
Docker config, and environment templates were all updated accordingly.
Not verified end-to-end at the time — no sandbox in this project's
history has had network access to MongoDB's tooling.

### Frontend actually built
`apps/web` went from an empty placeholder to a real Next.js 15
application — landing page, project structure, build pipeline
confirmed working.

### Authentication built (ahead of schedule, at request)
Real registration, login, and session-check endpoints, plus matching
frontend screens, built ahead of their formally scheduled task:
`POST /auth/register`, `POST /auth/login`, `GET /auth/me`, with
JWT-based sessions and bcrypt password hashing. Frontend gained real
`/login`, `/register`, and `/dashboard` screens.

### Day 4 — Authentication system completed
Filled in the remaining pieces: a reusable `JwtAuthGuard` (so every
future protected route reuses the same mechanism), a `/auth/logout`
endpoint, and email format validation. **One real bug fixed**: the
production environment file was missing `JWT_SECRET` entirely, which
would have made every authenticated request fail at runtime.

### Database layer migrated: Prisma to Mongoose
The entire data-access layer was rewritten from Prisma to native
Mongoose, per project direction — same models, same validation rules,
same behavior, different underlying library. Old Prisma code was
archived, not deleted, until the replacement was confirmed safe.

### Reconciliation with a separately-provided working build
A separately-uploaded version of the project (`mnu_v1`) turned out to
already contain a full **menu management feature** (categories and
items, with create/edit/delete) that the Mongoose migration had not
carried forward — an unintentional feature loss during the migration.
This was caught and fixed: the menu feature was rebuilt natively on
Mongoose rather than copied as-is, and that upload's real, working
database connection details were adopted going forward (replacing
placeholder configuration that had never actually been tested).

### Bug fix: login and registration were disconnected from the backend
A pre-existing bug was found and fixed: the login and registration
pages were leftover placeholders that never actually called the real
backend — they were written to always show a "not built yet" message
regardless of whether the backend worked. A second, independent bug
compounded this: even a successful login would have stored its session
token under the wrong name, breaking every subsequent request. Both
pages were replaced with working versions.

### Bug fix: database was writing to the wrong collections
A significant bug was discovered directly from a MongoDB dashboard
screenshot: two parallel sets of database collections existed side by
side — the original, real data (from when the project ran on Prisma),
and a second, nearly-empty set that the Mongoose-based code had
actually been reading and writing to, due to a naming-convention
mismatch between the two libraries. This meant the live application
could not see any of its own real data. Fixed by explicitly pinning
every collection name to match the original data.

### End-to-end verification pass
A dedicated session to actually boot the application (not just
typecheck it) and verify all core flows. This surfaced **one further
real bug**: a single field in the menu-item data model was declared in
a way that crashed the entire application on startup, before it ever
reached the database — a defect that static type-checking alone could
never have caught. Fixed, and confirmed the application now starts
cleanly.

### Day 7 — Table Management
The first real operational feature beyond menu management: restaurants
can now create, view, edit, and delete physical tables (table
number/name, seating capacity, and status). Full admin/staff role
separation, consistent with the menu feature's existing pattern. This
session also reconciled with another separately-provided build that
already contained a fuller restaurant admin dashboard (sidebar
navigation, per-restaurant overview) — that dashboard shell was adopted
as a prerequisite, while its backend code was deliberately *not* copied
as-is, since it predated the two bug fixes above and would have
reintroduced both.

### Full project status audit
A complete, code-only audit was performed against 39 requested feature
areas spanning the entire product vision (from basic auth through
QR ordering, payments, analytics, and advanced AI features), producing
`docs/MNU_CURRENT_PROJECT_STATUS.md`. No code was changed — this was a
reporting exercise. Result: strong admin-side foundation, essentially
no customer-facing product yet, and zero implementation of every
analytics/intelligence/AI feature in the long-term vision.

### Day 8 — Customer Table Session
The first genuinely customer-facing (not admin) feature: when a
customer's device identifies a specific restaurant table, the system
can now start, retrieve, and end a lightweight "table session" — the
foundation QR ordering will sit on top of. This is also the first
public, unauthenticated part of the API; everything before this point
required a logged-in admin/staff account. Real QR *code generation*
does not exist yet — the underlying web address that would eventually
be encoded in a QR code already works, which is intentionally the
smaller, correct first step.

---

## Recurring Bug Pattern Worth Noting

Three of the real bugs found across this project's history share a
common shape: **they were only catchable by actually running the
application**, not by reviewing code or type-checking it.

1. A missing production secret that would only fail at request time.
2. A database-naming mismatch only visible by inspecting the actual
   database contents.
3. A data-model declaration that crashed the server on startup, which
   static type analysis had no way to flag.

This is the direct argument for why "verify against a live database" is
the standing top recommendation across every recent report — the
project's own history shows that meaningful bugs have consistently
hidden in exactly the gap between "the code looks right" and "the code
was actually run."

---

## Current State Snapshot

| Area | Status |
|---|---|
| Project setup (monorepo, both apps, local dev infra) | Complete |
| Database layer (MongoDB via Mongoose) | Complete, unverified live |
| Authentication (register/login/session) | Complete, unverified live |
| Roles & permissions (enforcement) | Complete |
| Roles & permissions (inviting/managing staff) | Not implemented |
| Restaurant profile management | Minimal (name only, not editable) |
| Restaurant admin dashboard | Complete as a shell |
| Menu & category management | Complete, unverified live |
| Table management | Complete, unverified live |
| Customer table session | Complete, unverified live |
| QR code generation | Not implemented |
| Real customer-facing menu | Not implemented (dummy preview only) |
| Cart, orders, payments | Not implemented |
| Analytics | Not implemented |
| Menu intelligence / revenue optimization / AI features | Not implemented |

*(Full detail, including exactly what "complete" does and doesn't mean
for each item, is in `docs/MNU_CURRENT_PROJECT_STATUS.md`.)*

---

## What's Genuinely Working vs. What Looks Working

To be direct about the distinction this report keeps drawing:

- **Code exists and is well-structured** for: authentication, roles,
  restaurant/menu/table management, and now table sessions.
- **None of it has been confirmed working against real, live data** in
  any environment used so far — every verification to date has been
  code review, type-checking, and successful application startup.
- **The customer-facing product is a URL and a screen, not a product
  yet** — a customer can identify their table, but cannot yet see a
  real menu, add anything to a cart, or place an order.

---

## Recommended Next Steps

1. **Highest priority, zero new code**: run the existing system against
   a real, reachable MongoDB and walk through registration, login, menu
   management, table management, and the new table-session flow by
   hand. This closes the single largest source of risk across the
   entire project.
2. **Immediate next feature** (already identified at the end of Day 8):
   connect the real, restaurant-specific menu to the customer QR/session
   flow, replacing the placeholder menu preview a customer currently
   sees.
3. Everything past that — QR code generation, cart, orders, payments,
   analytics, and the full menu-intelligence/AI feature set — remains
   entirely unbuilt and should be sequenced deliberately rather than
   started in parallel.
