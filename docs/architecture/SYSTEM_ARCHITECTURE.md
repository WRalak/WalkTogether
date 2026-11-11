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

Two frontends, one backend, one database:

* **Mobile app** (`mobile/`) — the only app for members, club owners, club administrators, event
  organisers and moderators. The interface adapts to the user's role in each club; club
  administration (members, events, attendance, challenges, subscriptions, analytics…) is a section of
  the app (`mobile/app/admin`).
* **Platform admin** (`platform-admin/`) — the only web application, used exclusively by the
  WalkTogether operator with a separate admin identity and mandatory TOTP MFA.
* **API** (`server/`) — the single entry point to PostgreSQL. It enforces role-based access control and
  tenant isolation on every request. It also serves the few pages opened outside the app: email
  verification, password reset, invitation links, payment returns and the privacy/terms pages.

```
  Members, club owners, admins,     ┌─────────────────────────────┐
  organisers, moderators ──────────▶│ Mobile app (Expo/RN)        │──┐ HTTPS, Bearer access token
  (Android / iOS)                   │ role-aware; club admin tab  │  │ (refresh token in SecureStore)
                                    └─────────────────────────────┘  │
  Platform operator ───────────────▶┌─────────────────────────────┐  │ httpOnly refresh cookie +
  (browser, VPN/IP-restricted)      │ Platform admin (Next.js)    │──┤ in-memory access token,
                                    └─────────────────────────────┘  │ separate admin JWT + MFA
  Email / Stripe / invite links ───────────────────────────────────▶ │ /links/*, /legal/*
                                                                     ▼
                                         ┌───────────────────────────┐
                                         │ Nginx / managed ingress   │ TLS, rate limits, HSTS
                                         └─────────────┬─────────────┘
                                                       ▼
                         ┌──────────────────────────────────────────────────┐
                         │ API (Express 5, TypeScript) — modular monolith    │
                         │  auth · users · clubs · memberships · activities │
                         │  gps · events · social · messaging · challenges  │
                         │  subscriptions · payments · sponsorships ·       │
                         │  notifications · analytics · administration ·    │
                         │  links · media · moderation · audit · health     │
                         └───────┬─────────────────┬────────────────┬───────┘
                                 │                 │                │
                     ┌───────────▼───┐   ┌─────────▼──────┐  ┌──────▼─────────┐
                     │ PostgreSQL 16 │   │ Redis 7        │  │ Object storage │
                     │ + PostGIS 3   │   │ cache, rate    │  │ (S3 / R2) +CDN │
                     │ (Prisma)      │   │ limits, queues │  │ media          │
                     └───────────────┘   └───────┬────────┘  └────────────────┘
                                                 │ BullMQ
                                         ┌───────▼────────┐
                                         │ Worker process │ email, SMS, push, reminders,
                                         │ (same codebase)│ challenges, partitions, purges
                                         └────────────────┘
```

Access control: club administrators reach club data only through `requireClubPermission(clubId, …)`,
which loads their membership and role in **that** club on the server — a club id from the client is a
selector, never a grant. Platform administrators use a separate identity, JWT secret and audience, and
their platform-wide access is explicit per admin permission (`platform.overview.view`, `billing.view`,
`moderation.manage`, …) and audit-logged.

## 3. Repository layout (npm workspaces monorepo)

```
# Every top-level folder except packages/, infrastructure/ and docs/ is built and deployed separately.
mobile/           Expo SDK 54, Expo Router, NativeWind, TanStack Query, Zustand, SecureStore
                  app/(auth), app/(tabs)/{index, activity, clubs, community, profile}, clubs/,
                  activities/, events/, challenges/, messages/, admin/ (club administration),
                  sponsor/ (sponsor portal), settings/ + components/ features/ hooks/ services/ store/ utils/
platform-admin/   Platform super-admin (Next.js), separate hostname: app/(auth)/login,
                  app/dashboard/{overview, clubs, users, subscriptions, payments, sponsorships,
                  events, analytics, reports, moderation, settings, audit-logs, security, system,
                  admins} + components/ (incl. ui/) features/ lib/
server/
  prisma/         schema.prisma, SQL migrations, idempotent seed
  src/
    config/       zod-validated environment (refuses unsafe prod config), hosting checks
    database/     Prisma + Redis clients
    middleware/   request context, auth, admin auth, validation, rate limits, errors
    modules/      auth, users, clubs, memberships, activities, gps, events, social, messaging,
                  challenges, subscriptions, payments, sponsorships, notifications, analytics,
                  administration, links, announcements, media, moderation, audit, platform, health
    queues/       typed job catalogue, processors, BullMQ wiring
    shared/       crypto, password hashing, pagination, logger, metrics, errors
    app.ts        HTTP composition root; main.ts / worker.ts entry points
  test/           integration, tenant-isolation and security suites (real Postgres + Redis)
packages/
  shared-types/   permission catalogues, enums, API envelope types
  validation/     Zod schemas shared by server and clients
  api-client/     typed fetch client (single-flight refresh, web/native token modes)
  shared-utils/   formatting helpers and the GPS engine (filtering, stats, tracking, polylines)
infrastructure/   docker/ (local Postgres init), nginx/, deployment/ (backup + restore drill), loadtest/
docs/             this documentation
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
