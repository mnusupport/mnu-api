# MnU — Deployment Runbook (Day 39)

No hosting provider, domain, Dockerfile or platform config exists in the repo, so this
runbook is provider-neutral. Nothing here has been executed against a live host.

## Topology
Browser → **Web** (Next.js, `mnu-web` project) → HTTPS → **API** (NestJS, `mnu-api` project) → MongoDB Atlas / Twilio Verify / Cloudinary.
Two separately deployed services. Web and API must be on **HTTPS**; the API allow-lists the web origin via `CORS_ORIGINS`.

## Build & start
| | Install | Build | Start |
|---|---|---|---|
| API | `npm ci` (needs devDependencies for `nest build`) | `npm run build` | `npm run start` (`node dist/main`) |
| Web | `npm ci` | `NEXT_PUBLIC_API_URL=https://<api-origin> npm run build` | `npm run start` |

Both were built successfully on Day 39 with `npm ci` per app (each app has its own `package-lock.json`).
Set the host's **health check path to `GET /health`** (200 + `{"status":"ok","database":"connected"}`, 503 if MongoDB is down).

## Environment matrix (names only — see `mnu-api/.env.example`, `mnu-web/.env.example`)
| Variable | Dev | Production |
|---|---|---|
| `NODE_ENV` | development | `production` |
| `DATABASE_URL` | local/Atlas dev DB | Atlas URI, **separate DB name + user from dev** (`mnu_prod`); localhost refused |
| `JWT_SECRET` | any | ≥32 random chars, **different from dev** |
| `CORS_ORIGINS` | http://localhost:3000 | exact `https://` web origin(s) only |
| `TRUST_PROXY` | unset | `1` (one proxy hop) — **required** or rate limits collapse to one IP |
| `TWILIO_*`, `OTP_PROVIDER=twilio` | optional (`OTP_DEV_MODE=true` allowed) | all required; `OTP_DEV_MODE` must be false (startup refuses true) |
| `CLOUDINARY_*` | optional | all required (startup refuses if missing) |
| `APP_TIMEZONE` | Asia/Kolkata | Asia/Kolkata |
| `SUPER_ADMIN_*` | — | **not on the host** — used once from an operator machine |
| `NEXT_PUBLIC_API_URL` (web) | http://localhost:3001 | `https://<api-origin>` (build fails without it) |

The API validates production config at startup and exits non-zero with a clear message (names only, never values).

## First-time production sequence
1. Atlas: create a **dedicated production cluster/DB user** with least privilege; allow-list the API host's egress IPs (avoid `0.0.0.0/0` if the host has static IPs); confirm backups (below).
2. Deploy API with env vars; confirm logs show `MnU API listening` and `GET /health` → 200. Mongoose builds indexes on first start (incl. new `orders {restaurantId,status,createdAt}`); harmless on an empty DB.
3. Deploy Web with `NEXT_PUBLIC_API_URL`; then set API `CORS_ORIGINS` to the web's HTTPS origin.
4. Bootstrap Super Admin **once** from an operator machine (not the host):
   `DATABASE_URL=<prod> SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=<12+ chars> npm run db:bootstrap-super-admin` (in `mnu-api`), then clear those variables from the shell/history.
   The Super Admin then signs in at the normal `/login` page with these credentials (there is no separate Super Admin login). The script refuses to convert an existing regular/restaurant account unless `SUPER_ADMIN_PROMOTE_EXISTING=true` is set deliberately; re-running it for the existing Super Admin's own email rotates that password.
5. Run the smoke test below.

## Post-deploy smoke test
- `GET /health` → 200; stop/blocked DB → 503.
- CORS: `curl -i -H "Origin: https://evil.example" -X OPTIONS <api>/auth/login -H "Access-Control-Request-Method: POST"` → no `Access-Control-Allow-Origin`; with the real web origin → allowed.
- Customer: QR/menu → OTP (real phone) → cart → order → status page.
- Restaurant Admin: login → notification + pending count → open order → update status; upload menu image → displays; delete image.
- Super Admin: sign in at `/login` → lands on the Super Admin dashboard → All Restaurants → Manage.
- Restaurant Admin: sign in at the same `/login` → lands on their own restaurant dashboard.
- Isolation: Restaurant Admin token against `GET /super-admin/dashboard` → 403; Restaurant Admin token against another restaurant's `/restaurants/<id>/...` → 403; typing a `/super-admin/*` URL as a Restaurant Admin redirects to their own panel.
- Bad OTP (expect rejection), 4th OTP request in window (expect 429).

## Backups (production blocker until confirmed)
Atlas **M0 free tier has no backups**. Use M10+ with Cloud Backup (continuous or scheduled snapshots) or schedule `mongodump` to storage outside Atlas. Verify by doing one **test restore into a scratch cluster**. Record retention and who can restore.

## Rollback
- **Web/API:** use the host's "redeploy previous release/deploy" (Render/Railway/Vercel/Fly all keep prior builds). Record the last-known-good release ID/git commit before each deploy; tag it in Git (`git tag prod-YYYYMMDD-N`).
- **Order matters:** if a release changed API responses the web depends on, roll back web first only if the old web still works with the new API; otherwise roll back both, API second.
- **Config:** env changes are not in Git — keep a dated note of what changed; revert the variable and redeploy.
- **Data:** this release adds one index only (no data migration), so code rollback needs no DB rollback. Any future data migration must be backward-compatible or have a restore point (snapshot) taken first.
- Rollback was **not** exercised (no deployment exists).

## Audit log (Day 40)
Super Admin restaurant-scoped mutations are written to the `audit_logs` collection (who/what/restaurant/resource/time; no bodies or secrets). Read via `GET /super-admin/audit-logs`. Include this collection in backups; it has no retention policy yet.

## Logging
Structured Nest logger to stdout (host log viewer). Logged: startup/DB errors, 5xx (name + top stack frames, no message), 401/403/429 (method, path w/o query, status, ms), MongoDB disconnect/reconnect, failed health checks. Never logged: bodies, headers, JWTs, OTP codes, phone numbers, credentials. No external monitoring added; point an uptime monitor (e.g. host health check or UptimeRobot) at `/health`.

## Single-instance constraint
Rate-limit counters are in process memory. Run **one API instance** for the pilot; scaling out needs a shared store (Redis) first.
