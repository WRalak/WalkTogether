# WalkTogether — System Architecture

## 1. Goals and constraints

WalkTogether is a **multi-club fitness social network and SaaS platform**. From day one it serves many
independent clubs (tenants), individual members who may belong to several clubs, sponsors, and the
platform owner. The architecture optimises for:

| Priority | Implication |
| --- | --- |
| Strong tenant isolation | Club data is only reachable through tenant-aware services that resolve the caller's membership server-side. |
| Personal data ownership | Personal fitness records belong to the user, never to a club. Clubs see activities only through explicit sharing records. |
| Reliable GPS on low-end Android | Offline-first recording, local persistence, idempotent sync, server-side validation. |
| Kenya-first, globally extensible | SMS OTP sign-in, M-Pesa via a provider abstraction, configurable countries/currencies. |
| Small team velocity | A **modular monolith** with clear module boundaries instead of premature microservices. |

## 2. High-level view

```
                    ┌──────────────────────────┐
  Android / iOS ───▶│  Mobile app (Expo/RN)    │──┐
                    └──────────────────────────┘  │  HTTPS (JSON, Bearer access token)
                    ┌──────────────────────────┐  │
  Browsers ────────▶│  apps/website (Next.js)  │──┤  SSR fetches public endpoints only
                    │  apps/club-admin         │──┤  httpOnly refresh cookie + in-memory access token
                    │  apps/platform-admin     │──┤  separate admin identity + TOTP MFA
                    └──────────────────────────┘  ▼
                                         ┌───────────────────────────┐
                                         │ Nginx / managed ingress   │ TLS, rate limits, HSTS
                                         └─────────────┬─────────────┘
                                                       ▼
                         ┌──────────────────────────────────────────────────┐
                         │ API (Express 5, TypeScript) — modular monolith    │
                         │  auth · users · clubs · memberships · platform    │
                         │  administration · notifications · audit · health  │
                         │  (Phase 3+: activities/gps · events · social ·    │
                         │   messaging · challenges · subscriptions ·        │
                         │   payments · sponsorships)                        │
                         └───────┬─────────────────┬────────────────┬───────┘
                                 │                 │                │
                     ┌───────────▼───┐   ┌─────────▼──────┐  ┌──────▼─────────┐
                     │ PostgreSQL 16 │   │ Redis 7        │  │ Object storage │
                     │ + PostGIS 3   │   │ cache, rate    │  │ (S3 / R2) +CDN │
                     │ (Prisma)      │   │ limits, queues │  │ (Phase 5 media)│
                     └───────────────┘   └───────┬────────┘  └────────────────┘
                                                 │ BullMQ
                                         ┌───────▼────────┐
                                         │ Worker process │ email, SMS, purges,
                                         │ (same codebase)│ cleanup; later: push,
                                         └────────────────┘ leaderboards, media
```

## 3. Repository layout (pnpm monorepo)

```
apps/
  mobile/           Expo SDK 54, Expo Router, NativeWind, TanStack Query, Zustand, SecureStore
                    app/(auth), app/(tabs)/{index,explore,record,community,profile}, clubs/, activities/,
                    challenges/, events/, messages/, settings/ + components/ features/ hooks/ services/ store/ utils/
  club-admin/       Club dashboard (Next.js): app/(auth)/{login,signup}, app/dashboard/{overview, members,
                    events, activities, challenges, attendance, announcements, analytics, subscription,
                    settings, moderation, sponsorships}. The managed club is selected by `?club=<id>`.
  platform-admin/   Platform super-admin (Next.js), separate hostname: app/(auth)/login,
                    app/dashboard/{overview, users, clubs, subscriptions, payments, sponsors, campaigns,
                    challenges, moderation, analytics, audit-logs, settings, security, system, admins}
  website/          Public site (Next.js): home, pricing, clubs, events, about, contact, legal pages
server/
  prisma/           schema.prisma, SQL migrations, idempotent seed
  src/
    config/         zod-validated environment (refuses unsafe prod config)
    database/       Prisma + Redis clients
    middleware/     request context, auth, admin auth, validation, rate limits, errors
    modules/        feature modules (routes → services → Prisma): auth, users, clubs, memberships,
                    activities, gps, events, social, messaging, challenges, subscriptions, payments,
                    sponsorships, notifications, administration (+ announcements, media, moderation,
                    audit, platform, health)
    queues/         typed job catalogue, processors, BullMQ wiring
    shared/         crypto, password hashing, pagination, logger, errors
    app.ts          HTTP composition root; main.ts / worker.ts entry points
  test/             integration + tenant-isolation + security suites (real Postgres + Redis)
packages/
  shared-types/     permission catalogues, enums, API envelope types
  validation/       Zod schemas shared by server and clients
  api-client/       typed fetch client (single-flight refresh, web/native token modes)
  shared-utils/     framework-free helpers (money, distance, duration, pace, labels, relative time)
  ui/               shadcn-style React components for the web apps
  gps/              GPS filtering, statistics, tracking engine, polyline, privacy trimming
  configuration/    shared Tailwind preset/tokens and tsconfig
infrastructure/     docker/ (local Postgres init), nginx/ (self-hosting), deployment/ (backup + restore drill)
                    Each deployable unit keeps its own Dockerfile / vercel.json / eas.json and README.
docs/               this documentation
```

Workspace packages are consumed as TypeScript source. The server bundles them with `tsup`; Next.js uses
`transpilePackages`; Metro resolves them natively.

## 4. Module boundaries (server)

Each module owns its routes, services and data access. Cross-module calls go through exported service
functions, never through another module's tables directly (exceptions are documented, e.g. account
anonymisation touching memberships).

| Module | Responsibility | Status |
| --- | --- | --- |
| `auth` | Registration, password/phone/OAuth login, sessions & refresh rotation, verification, resets | Phase 1 ✅ |
| `users` | Profile, privacy, notification settings, devices, blocking, export, deletion | Phase 1 ✅ |
| `clubs` | Club CRUD, discovery (PostGIS), per-club roles, **tenant authorization (`club-access.ts`)** | Phase 1 ✅ |
| `memberships` | Join/leave, approvals, invitations, role assignment, moderation | Phase 1 ✅ (foundation of Phase 2) |
| `administration` | Platform admin identity (MFA), user/club management, audit log, settings, flags | Phase 1 ✅ |
| `platform` | Permission catalogue sync, configurable platform settings | Phase 1 ✅ |
| `notifications` | Email/SMS providers + templates (push in Phase 5) | Phase 1 ✅ (email/SMS) |
| `audit` | Append-only audit trail | Phase 1 ✅ |
| `activities`, `gps` | Recording ingestion, validation, statistics | Phase 3 |
| `events` | Events, RSVP, attendance, QR check-in | Phase 4 |
| `social`, `messaging` | Feed, posts, comments, follows, DMs (Socket.IO) | Phase 5 |
| `challenges` | Challenge engine, leaderboards, achievements | Phase 6 |
| `subscriptions`, `payments`, `sponsorships` | Plans, entitlements, M-Pesa/Stripe, sponsors | Phase 2 (entitlements) / Phase 7 |

**Extraction path.** Module boundaries, the typed job catalogue and the absence of cross-module table
access mean a module (most likely GPS ingestion or notifications) can later become a separate service
behind the same API contract if load testing shows it is needed.

## 5. Request lifecycle

1. `requestContext` assigns/propagates `X-Request-Id`.
2. `pino-http` logs method + path (never query strings, bodies or credentials).
3. `helmet` security headers; strict CORS allow-list with credentials.
4. JSON body parser (1 MB limit) + cookie parser.
5. Per-IP global rate limit (Redis store) and stricter per-route limits on credential endpoints.
6. Route handler: `requireAuth` / `optionalAuth` / `requireAdmin` → `parse(zodSchema, input)` →
   service call. Club-scoped services call `requireClubPermission(clubId, userId, permission)`.
7. Errors are mapped centrally to `{ error: { code, message, details?, requestId } }`.

Express 5 propagates async errors automatically, so no handler can silently swallow a rejection.

## 6. Background processing

`queues/jobs.ts` is a typed job catalogue mapping each job to a queue (`notifications`,
`maintenance`). The API only enqueues; `worker.ts` processes with retries and exponential backoff and
registers recurring schedulers (account purge, session cleanup). Tests use `QUEUE_DRIVER=inline`, which
the configuration loader forbids in staging/production.

## 7. Clients

| Client | Auth transport | State |
| --- | --- | --- |
| Mobile | Access token in memory; refresh token in OS keystore (SecureStore) | TanStack Query for server state, Zustand for session |
| Club admin / platform admin | Access token in memory; refresh token in `httpOnly; Secure; SameSite=Strict` cookie scoped to the refresh path; `X-WT-Client: web` header required (CSRF defence) | TanStack Query |
| Public web | Server-side fetches of **public endpoints only**, cached with ISR | — |

The shared `@walktogether/api-client` performs **single-flight refresh** so concurrent 401s never
present the same refresh token twice (which reuse detection would treat as theft).

## 8. Maps

Map rendering is abstracted behind a provider interface (Phase 3): the tracking engine produces
provider-neutral GeoJSON-like coordinates, and a `MapView` adapter renders them with Google Maps or
Mapbox depending on configuration. Tracking, storage and statistics never depend on the map SDK.

## 9. Key technology decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Monolith vs services | Modular monolith | Team size, transactional integrity across clubs/memberships, simpler ops |
| ORM | Prisma 6 (pinned) | Type-safety, migrations; raw SQL for PostGIS. Prisma 7 upgrade tracked separately |
| Validation | Zod 3 shared package | One schema for server validation, client forms and OpenAPI |
| API docs | OpenAPI 3.1 generated from Zod (`/api/docs`) | Cannot drift from validation |
| Tokens | Short-lived HS256 JWT + opaque rotating refresh tokens | Immediate revocation via Redis deny-list; refresh reuse detection |
| Admin identity | Separate `admin_users` table, secret and audience | Club admins can never become platform admins |
| Versions | Next 15, Expo SDK 54, Express 5, React 19.1 | Stable, well-supported versions pinned exactly |
