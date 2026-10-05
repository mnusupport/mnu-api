# MnU

Two independent projects (no shared workspace, no shared code):

| Folder | What | Run |
|---|---|---|
| `backend/` | NestJS + MongoDB API | `cd backend && npm ci && npm run dev` (port 3001) |
| `frontend/` | Next.js customer menu + admin UI | `cd frontend && npm ci && npm run dev` (port 3000) |

The frontend reaches the backend only through `NEXT_PUBLIC_API_URL`; the backend allows the
frontend origin through `CORS_ORIGINS`. Each can be installed, built and deployed on its own
(each has its own `package-lock.json` and `.env.example`).

- `docs/` — documentation (`PROGRESS.md` is the running history).
- `scripts/` — source-level regression tests that read both projects:
  `node --test scripts/*.test.mjs`
