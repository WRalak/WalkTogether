# WalkTogether

**WalkTogether** is a multi-club fitness social network and SaaS platform for walking and running
communities: GPS tracking for individuals, club management for club owners and admins (inside the
mobile app), sponsored challenges for organisations, and a web control centre for the platform owner. It targets Kenya first, then East Africa and
international markets.

It is multi-tenant from day one: any user can create a club, belong to several clubs with different roles,
and keep ownership of their personal fitness data. The first pilot walking club is just the first club.

> Current state: **Phases 1–9 are implemented.** See [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md)
> for exactly what works today and what is next.

## Repository

Every application lives directly in the repository root (there is deliberately no `apps/` directory).
There are **two frontends and one backend**, each built and hosted separately (own README,
`.env.example`, Dockerfile or EAS config, CI workflow), all talking to the same API and — through it —
the same PostgreSQL database. Full hosting map: [`docs/deployment/HOSTING.md`](docs/deployment/HOSTING.md).

| Folder | What it is | Hosted as | Docs |
| --- | --- | --- | --- |
| `mobile/` | Expo / React Native app for **everyone in a club**: members, owners, administrators, organisers, moderators. Club administration is a role-aware section of the app. | EAS → app stores | [README](mobile/README.md) |
| `platform-admin/` | The **only web app**: platform-level administration for WalkTogether staff, with mandatory MFA | Vercel or container (`admin.`, IP-restricted) | [README](platform-admin/README.md) |
| `server/` | Express 5 API + Socket.IO + BullMQ worker, Prisma/PostgreSQL+PostGIS, Redis; also email-link and legal pages | Container (`api.`) | [README](server/README.md) |
| `packages/` | `shared-types`, `validation`, `api-client`, `shared-utils` | not deployed | — |
| `infrastructure/` | Dockerfiles + production Compose, nginx, Terraform (AWS), Kubernetes baseline, monitoring, backup/restore, deploy script, load tests | — | [README](infrastructure/README.md) |
| `docs/` | Architecture, database, security, API, multi-tenancy, GPS, monetization, deployment | — | below |

## Prerequisites

* Node.js 22 and npm 10 (bundled with Node). The repository uses **npm workspaces** — run every
  command from the repository root with npm.
* PostgreSQL 16 with PostGIS 3, and Redis 7. The easiest way is Docker:

```bash
docker compose up -d postgres redis
```

## Getting started

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

```bash
npm exec -w @walktogether/server -- prisma migrate deploy
```

```bash
npm exec -w @walktogether/server -- tsx --env-file=.env prisma/seed.ts --demo
```

The `--demo` flag creates two demo users (`owner@demo.walktogether.local`, `member@demo.walktogether.local`,
password `walktogether-demo-1`) and a demo club. Omit it for a clean database.

Run the API and the background worker (separate terminals):

```bash
npm run dev:server
```

```bash
npm run dev:worker -w @walktogether/server
```

API docs (development): <http://localhost:4000/api/docs>. Health: <http://localhost:4000/health/ready>.
In development, emails and SMS codes are printed to the API console.

Platform admin (copy `platform-admin/.env.example` to `.env.local` if you need a non-default API URL):

```bash
npm run dev:platform-admin
```

It runs on <http://localhost:3002>.

Create the first platform administrator (prompts for a password; MFA enrolment is forced at first sign-in):

```bash
npm run admin:create -w @walktogether/server -- --email you@example.com --name "Your Name"
```

### Mobile app

```bash
cp mobile/.env.example mobile/.env
```

```bash
npm run dev:mobile
```

Use an Android emulator (the default API URL `http://10.0.2.2:4000` reaches your machine) or set
`EXPO_PUBLIC_API_URL` to your LAN IP for a physical device. Background location, the camera (QR
check-in) and Health Connect need a development build (`npm run android -w @walktogether/mobile`
or EAS), not Expo Go. Club owners and admins find club management under **Clubs → Manage my clubs**.

## Tests

The server's integration tests need PostgreSQL+PostGIS and Redis; they use a separate
`walktogether_test` database (created automatically by `docker compose`) and Redis DB 15.

```bash
npm test
```

```bash
npm run typecheck
```

199 automated tests. Highlights: authentication and session security, platform-admin MFA, an OWASP-oriented
**security suite** (`server/test/security.test.ts`), and a dedicated **tenant-isolation suite** (`server/test/tenant-isolation.test.ts`) proving users cannot read or modify
other clubs' data.

## Documentation

* [System architecture](docs/architecture/SYSTEM_ARCHITECTURE.md)
* [Multi-tenant design](docs/architecture/MULTI_TENANT_DESIGN.md)
* [Security architecture](docs/security/SECURITY_ARCHITECTURE.md)
* [Database design](docs/database/DATABASE_DESIGN.md)
* [API design](docs/api/API_DESIGN.md)
* [GPS tracking design](docs/architecture/GPS_TRACKING_DESIGN.md)
* [Monetization design](docs/architecture/MONETIZATION_DESIGN.md)
* [Hosting map](docs/deployment/HOSTING.md)
* [Deployment guide](docs/deployment/DEPLOYMENT_GUIDE.md)
* [Dependency risk register](docs/security/DEPENDENCY_RISK_REGISTER.md)
* [Load-test baseline](infrastructure/loadtest/README.md)
