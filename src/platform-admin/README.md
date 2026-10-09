# MnU Platform Admin

There is **one** login for every account (`/login` -> `POST /auth/login`). The backend authenticates the
credentials and reports the account's role (`User.platformRole`: `USER` or `SUPER_ADMIN`); the web app then
lands the user in the matching panel. There is no separate Super Admin login, no role selector and no public
Super Admin registration.

Platform routes (`/super-admin/*`) are protected server-side by `JwtAuthGuard` + `SuperAdminGuard`, which re-check
the persisted role on every request. The role is never taken from the client.

The initial account is created manually from an operator machine:

```bash
pnpm --filter @mnu/api db:bootstrap-super-admin
```

Required environment variables are documented in `.env.example`. The script refuses to create a second Super
Admin and refuses to convert an existing regular account unless `SUPER_ADMIN_PROMOTE_EXISTING=true`.
