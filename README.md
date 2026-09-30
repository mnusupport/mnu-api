# mnu-api — MnU Backend

NestJS 10 + Mongoose (MongoDB) + JWT auth + Cloudinary image uploads.

The frontend lives in a separate project, **mnu-web** (Next.js), which calls
this API over HTTP. Both used to be one pnpm/Turborepo monorepo
(`apps/api` + `apps/web`); this project is the former `apps/api`.

## Setup
```bash
docker compose up -d          # local MongoDB on :27017 (optional if you use Atlas)
npm install
cp .env.example .env          # set JWT_SECRET, DATABASE_URL, CORS_ORIGINS, CLOUDINARY_*
npm run db:seed               # optional demo data
npm run dev                   # http://localhost:3001
```

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Watch mode on `PORT` (default 3001) |
| `npm run build` / `npm run start` | Compile to `dist/`, run `node dist/main` |
| `npm test` | Build, then run every test in `scripts/` (static + HTTP e2e) |
| `npm run db:seed` | Seed a dev database |
| `npm run db:bootstrap-super-admin` | One-time Super Admin creation (see `src/platform-admin/README.md`) |

## Connecting mnu-web
- `CORS_ORIGINS` must list the web origin (dev: `http://localhost:3000`).
- mnu-web's `NEXT_PUBLIC_API_URL` must point at this API (dev: `http://localhost:3001`).
- Health check: `GET /health`.

## Docs
`docs/` holds the project history and runbooks carried over from the
monorepo. Older entries use monorepo paths: read `apps/api/…` as this
project's root, and `apps/web/…` as the mnu-web project.
