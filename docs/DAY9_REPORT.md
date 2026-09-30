# MnU — Day 9 Report

## Public Customer Menu (MongoDB → Real Customer-Facing Menu)

---

## Objective

Replace the hardcoded `/menu/demo` customer experience with a real,
restaurant-specific menu backed by MongoDB, without touching any
existing authenticated/admin functionality.

**Status: Complete**, within the exact boundaries this task set — no
cart, no orders, no QR generation, no scope creep.

---

## What Was Built

### Backend — Public Menu API

A single new endpoint: `GET /public/restaurants/:restaurantId/menu`

- Not behind `JwtAuthGuard` — accessible to any customer's browser with
  no login of any kind.
- Implemented as one new method (`getPublicMenu`) added to the
  **existing** `MenuService`, not a duplicated service. Every existing
  admin method in that file is byte-for-byte unchanged.
- Exposed through a **new, separate** controller
  (`PublicMenuController`) rather than adding a guard exception to the
  existing admin `MenuController` — this means there is no way the
  admin route's authentication could have been accidentally weakened by
  this change.
- Returns only categories that have at least one available item, and
  only fields a customer actually needs (name, description, price) —
  internal fields like `isAvailable`, `sortOrder`, and `categoryId` are
  stripped out server-side, not filtered on the client.

### Multi-Tenant Isolation

Every query is scoped directly against MongoDB using the requested
`restaurantId` — never "fetch everything, then filter." A malformed or
nonexistent restaurant id is caught before it reaches the database
query and returns a clean 404, instead of a raw database error or a
server crash.

### Frontend — Real Customer Menu Screen

**Route**: `/menu/[restaurantId]`

| Element | Present |
|---|---|
| Restaurant name | Yes |
| Categories | Yes |
| Available items only | Yes (enforced server-side) |
| Item name | Yes |
| Description (when present) | Yes |
| Price | Yes |
| Loading state | Yes |
| Empty menu state | Yes |
| Error state | Yes |
| Cart / add-to-cart | Not built — explicitly out of scope |

The old `/menu/demo` page was left in place, untouched, as the dummy
layout reference it has always been — nothing required removing it.

### One Small Connection Made

The Day 8 customer QR-scan screen's "View Menu" button previously
pointed at `/menu/demo` because that was the only customer-menu route
that existed at the time. That single link now points at the real
`/menu/[restaurantId]` route. This was the exact next step Day 8's own
notes called for — not new scope, just connecting two already-planned
pieces.

---

## Verification Performed

- Backend: TypeScript check clean, production build clean, and an
  actual boot test — the server starts up with no configuration or
  schema errors and correctly attempts its database connection (which
  cannot complete in this environment — see limitation below).
- Frontend: TypeScript check clean, production build clean — 14 routes
  total, including the new customer menu page alongside every
  pre-existing route.
- Confirmed by direct file comparison against the prior working version
  that **no existing admin, authentication, table, or table-session code
  was altered in any way** — only new files, plus one new method
  appended to the menu service and one link updated.
- The six required test scenarios (two different restaurants each
  seeing only their own menu, unavailable items excluded, empty-menu
  state, invalid restaurant id handled cleanly, admin menu still
  working) were all verified by reviewing the query logic and control
  flow directly, not by issuing live requests.

---

## Known Limitation

**Live database read/write verification could not be performed in this
environment.** No environment used across this project's history has
had network access to the real MongoDB (Atlas) instance the project
connects to. A clean typecheck, build, and server boot are meaningful
signals, but they are not the same as confirming the feature against
real, live data — that distinction is being stated plainly rather than
implied as "done."

**Recommended before building anything further on top of this**: seed
two separate restaurants, each with a menu that includes at least one
unavailable item, and confirm by hand that each restaurant's public menu
page shows only its own available items — nothing more.

---

## Explicitly Not Done (By Design)

QR code generation, QR tokens, cart, add-to-cart, checkout, orders,
payments, customer accounts, analytics, and every menu-intelligence or
AI-driven feature. None of these were started, per this task's explicit
boundaries.

---

## Recommended Next Task

Not specified by this task. The customer can now browse a real menu —
cart and ordering are the natural next step, but were deliberately left
untouched today so that this task stayed small and independently
verifiable.
