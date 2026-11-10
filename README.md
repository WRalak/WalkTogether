# WalkTogether

**WalkTogether** is a multi-club fitness social network and SaaS platform for walking and running
communities: GPS tracking for individuals, a management dashboard for clubs, sponsored challenges for
organisations, and a control centre for the platform owner. It targets Kenya first, then East Africa and
international markets.

It is multi-tenant from day one: any user can create a club, belong to several clubs with different roles,
and keep ownership of their personal fitness data. The first pilot walking club is just the first club.

> Current state: **Phase 1 (Foundation) is complete.** See [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md)
> for exactly what works today and what is next.

## Repository

| Path | What it is |
| --- | --- |
| `server/` | Express 5 + TypeScript modular-monolith API, Prisma/PostgreSQL+PostGIS, Redis, BullMQ worker |
| `apps/mobile/` | Expo SDK 54 / React Native member app (Expo Router, NativeWind, TanStack Query, Zustand) |
| `apps/web/` | Public website and SEO club pages (Next.js 15) |
| `apps/club-admin/` | Club administration dashboard (Next.js 15) |
| `apps/platform-admin/` | Platform super-admin dashboard (Next.js 15), separate identity with mandatory MFA |
| `packages/` | `shared-types`, `validation` (Zod), `api-client`, `ui`, `configuration` |
| `infrastructure/` | Dockerfiles, Nginx config |
| `docs/` | Architecture, database, security, API, multi-tenancy, GPS, monetization, deployment |

## Prerequisites

* Node.js 22 and pnpm 10 (`corepack enable`)
* PostgreSQL 16 with PostGIS 3, and Redis 7. The easiest way is Docker:

```bash
docker compose up -d postgres redis
```

## Getting started

```bash
pnpm install
```

```bash
cp server/.env.example server/.env
```

```bash
pnpm --filter @walktogether/server exec prisma migrate deploy
```

```bash
pnpm --filter @walktogether/server exec tsx --env-file=.env prisma/seed.ts --demo
```

The `--demo` flag creates two demo users (`owner@demo.walktogether.local`, `member@demo.walktogether.local`,
password `walktogether-demo-1`) and a demo club. Omit it for a clean database.

Run the API and the background worker (separate terminals):

```bash
pnpm dev:server
```

```bash
pnpm --filter @walktogether/server dev:worker
```

API docs (development): <http://localhost:4000/api/docs>. Health: <http://localhost:4000/health/ready>.
In development, emails and SMS codes are printed to the API console.

Web apps (copy each `apps/*/.env.example` to `.env.local` first if you need non-default URLs):

```bash
pnpm dev:web
```

```bash
pnpm dev:club-admin
```

```bash
pnpm dev:platform-admin
```

They run on <http://localhost:3000> (public site), <http://localhost:3001> (club dashboard) and
<http://localhost:3002> (platform admin).

Create the first platform administrator (prompts for a password; MFA enrolment is forced at first sign-in):

```bash
pnpm --filter @walktogether/server admin:create -- --email you@example.com --name "Your Name"
```

### Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

```bash
pnpm dev:mobile
```

Use an Android emulator (the default API URL `http://10.0.2.2:4000` reaches your machine) or set
`EXPO_PUBLIC_API_URL` to your LAN IP for a physical device. Background location (Phase 3) requires a
development build (`pnpm --filter @walktogether/mobile android` or EAS), not Expo Go.

## Tests

The server's integration tests need PostgreSQL+PostGIS and Redis; they use a separate
`walktogether_test` database (created automatically by `docker compose`) and Redis DB 15.

```bash
pnpm test
```

```bash
pnpm typecheck
```

Highlights: authentication and session security, platform-admin MFA, and a dedicated
**tenant-isolation suite** (`server/test/tenant-isolation.test.ts`) proving users cannot read or modify
other clubs' data.

## Documentation

* [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)
* [Multi-tenant design](docs/architecture/MULTI_TENANT_DESIGN.md)
* [Security architecture](docs/security/SECURITY_ARCHITECTURE.md)
* [Database design](docs/database/DATABASE_DESIGN.md)
* [API design](docs/api/API_DESIGN.md)
* [GPS tracking design](docs/architecture/GPS_TRACKING_DESIGN.md)
* [Monetization design](docs/architecture/MONETIZATION_DESIGN.md)
* [Deployment guide](docs/deployment/DEPLOYMENT_GUIDE.md)
