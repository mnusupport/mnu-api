# MnU — Backend

NestJS 10 + Mongoose (MongoDB). Standalone project: it has its own `package.json`,
`package-lock.json`, `.env.example` and local MongoDB `docker-compose.yml`, and shares
no code or workspace tooling with the frontend. The frontend (`../frontend`) calls it
over HTTP only; allow its origin through `CORS_ORIGINS`.

## Setup
```bash
npm ci                         # or: npm install
cp .env.example .env           # set DATABASE_URL, JWT_SECRET (>= 32 chars), CORS_ORIGINS
docker compose up -d           # optional: local MongoDB 7 on :27017
npm run dev                    # http://localhost:3001  (GET /health)
```

## Scripts
- `npm run dev` — watch mode · `npm run build` — compile to `dist/` · `npm run start` — `node dist/main`
- `npm run db:seed` — seed local demo data
- `npm run db:bootstrap-super-admin` — create the first Super Admin (see `../docs/DEPLOYMENT.md`)
- `npm run lint`

## Environment
All variable names (with explanations) are in `.env.example`. Never commit real values.

## Docs
Project documentation lives in `../docs/` (`DEPLOYMENT.md`, `DATABASE.md`, `PROGRESS.md`).
