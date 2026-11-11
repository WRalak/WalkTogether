# WalkTogether API (`server/`)

Express 5 + TypeScript modular monolith: REST API (`/api/v1`), Socket.IO (`/rt`), and a BullMQ
background worker. PostgreSQL 16 + PostGIS, Redis 7. **Hosted on its own** as a container
(`api.walktogether.app`). See [`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

## Layout

```
server/
  Dockerfile          one image → API, worker or migration job (build from repo root)
  prisma/             schema.prisma, migrations/, seed.ts
  scripts/            create-admin, export-openapi
  src/
    main.ts           API entry point        worker.ts  background worker entry point
    app.ts            HTTP composition root  openapi.ts OpenAPI document (/api/docs)
    config/           Zod-validated env (refuses unsafe prod config), hosting checks
    database/         Prisma + Redis clients
    middleware/       auth, admin auth, validation, rate limits, request context, errors
    queues/           typed job catalogue, processors, BullMQ wiring
    shared/           crypto, passwords, pagination, logger, metrics, errors
    modules/          auth, users, clubs, memberships, activities, gps, events, social,
                      messaging, challenges, subscriptions, payments, sponsorships,
                      notifications, administration, announcements, media, moderation,
                      audit, platform, health
  test/               integration, tenant-isolation and security suites (real Postgres + Redis)
```

## Run locally

```bash
docker compose up -d postgres redis
```

```bash
cp server/.env.example server/.env
```

```bash
pnpm --filter @walktogether/server exec prisma migrate deploy
```

```bash
pnpm --filter @walktogether/server dev
```

```bash
pnpm --filter @walktogether/server dev:worker
```

## Deploy

| Role | Command (same image) | Scaling | Health |
| --- | --- | --- | --- |
| API | `node dist/main.js` (default) | ≥ 2 instances, stateless | `GET /health/live`, `GET /health/ready` |
| Worker | `node dist/worker.js` | ≥ 1 | process up |
| Migrate | `npx prisma migrate deploy` | one-off per release, before the API | exit code |

Build: `docker build -f server/Dockerfile -t walktogether-api .` (from the repository root).
Without Docker: `pnpm install --frozen-lockfile --filter @walktogether/server...`, then
`pnpm --filter @walktogether/server exec prisma generate`, `pnpm --filter @walktogether/server build`,
and `pnpm --filter @walktogether/server start`.

Required alongside it: PostgreSQL 16 + PostGIS, Redis 7 (`noeviction`), S3/R2 bucket, ClamAV.
All variables are documented in [`.env.example`](.env.example); `NODE_ENV=production` refuses to start
with unsafe values. Set `CORS_ORIGINS` to every web app's origin — all on the same parent domain.

## Test

```bash
pnpm --filter @walktogether/server test
```
