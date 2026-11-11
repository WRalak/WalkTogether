# Development Status

_Last updated: 2026-11-10 — Phases 1–9 implemented. Everything that can be built and verified without
physical devices, live provider credentials or third parties is done; those items are listed at the end._

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Monorepo, auth, profiles, RBAC, multi-tenant clubs, web/mobile/admin foundations | ✅ |
| 2 Club SaaS | Custom roles, ownership transfer, announcements, plans & entitlements, notifications | ✅ |
| 3 GPS tracking | Shared engine, background/offline recording, sync, server validation, stats, goals, step counts | ✅ |
| 4 Events & attendance | Events, recurrence, RSVP/waitlist, QR check-in, reminders, reports, analytics | ✅ |
| 5 Social community | Follows, posts, feed, comments, image + video pipeline, messaging (Socket.IO), moderation | ✅ |
| 6 Challenges | Challenge engine, club-vs-club, leaderboards, achievements | ✅ |
| 7 Monetization | M-Pesa/Stripe providers, verified checkout, invoices, refunds (incl. M-Pesa reversals), promotions, sponsorships | ✅ |
| 8 Platform administration | KPIs, revenue, plans, sponsors, moderation, security, system health, admins | ✅ |
| 9 Production hardening | Audit, metrics, OpenAPI, Zod 4, partitioning, security suite, load test, Docker/CI, backup drill | ✅ |

## What exists (by area)

**Backend (`server/`)** — Express 5 modular monolith, Prisma/PostgreSQL+PostGIS, Redis, BullMQ worker,
Socket.IO. Modules: auth, users, clubs, memberships, announcements, subscriptions/entitlements,
activities, gps (point storage, validation, partitions), events, social (follows, posts, comments, feed), media, messaging, moderation,
challenges/leaderboards/achievements, payments, sponsorships, administration, notifications, audit.
11 migrations (`init` … `phase9_daily_steps`), no schema drift.

**Shared packages** — `shared-types`, `validation` (Zod), `api-client`, `shared-utils` (formatting/labels), `gps` (filtering, statistics,
`TrackingEngine`, polyline, privacy trimming), `ui`, `configuration`.

**Mobile (`mobile`)** — auth (email, phone OTP), Record (background location task with
foreground fallback, SQLite offline store, crash recovery, resumable batched sync), activity
history/detail with maps, home/profile stats, explore (clubs, events, sponsored), club detail/chat,
events with RSVP + QR scanner check-in, community feed (photos and video posters), composer with photo upload, comments,
messaging, user profiles/follows, notifications + push registration, challenges & leaderboards,
achievements, step counts from Health Connect/HealthKit, Premium subscription (M-Pesa/card), privacy & security settings.

**Club admin (`club-admin`, `/dashboard/<section>?club=<id>`)** — overview, shared member activities, attendance reports, members, invitations, roles & ownership transfer,
announcements, events + live QR + attendance + CSV, challenges, analytics & reports, community
moderation, sponsorship offers, billing (plans, checkout, invoices), settings with logo/cover upload,
and a sponsor portal (apply, campaigns, pay, reports).

**Platform admin (`platform-admin`, `/dashboard/<section>`)** — MFA sign-in, subscriptions list and plan grants, payments & refunds, sponsors, campaigns, overview KPIs (incl. MRR/ARR,
sponsorship revenue), revenue, users (detail + history), clubs, plans/promotions/payments/refunds,
sponsors & campaigns (review, reports, rewards), challenges & achievement rules, moderation queue,
audit log, security monitoring, system health, settings/flags, administrators.

**Public website (`website`)** — marketing pages, club discovery/SEO pages, public events with schema.org markup, live pricing from the plans
API, sponsor portal entry, email-link pages.

## Tests (all passing)

| Suite | Tests |
| --- | --- |
| Server integration/unit (16 files: auth, users, clubs, tenant isolation, security, phase 2, activities, events, social/media/video/messaging, challenges, payments/sponsorships, M-Pesa (mocked Daraja), platform admin, admin, journey, unit) | 156 |
| `packages/gps` | 8 |
| `packages/validation` | 6 |
| `packages/api-client` | 4 |
| `packages/shared-utils` | 4 |
| Web apps (website, club-admin, platform-admin) | 5 |
| Mobile (Jest: schemas, token store, tracking session, offline sync, QR parsing, component) | 9 |
| **Total** | **192** |

Also verified: workspace typecheck; GitHub Actions CI (typecheck, unit, integration against
PostGIS/Redis service containers, migration drift check, production builds of all Next.js apps,
Android JS bundle export, Docker image builds for API/web/club-admin/platform-admin with an API
boot smoke test, `pnpm audit`, gitleaks); real-browser runs of club-admin and platform-admin; a
database backup/restore drill; and a load test (`infrastructure/loadtest/README.md`).

## Phase 9 — done

* **Dependencies:** Zod 3 → 4 migration (closes GHSA-mrhx-c7xc-m3w5), `sharp` 0.35.5, `nodemailer`
  10.5, `postcss`, `deepmerge-ts`; remaining dev-tooling advisories documented in
  `docs/security/DEPENDENCY_RISK_REGISTER.md`.
* **Security suite** (`server/test/security.test.ts`): headers/CSP/HSTS, CORS allow-list, body limits,
  no stack traces, protected metrics, `alg=none`/wrong-key/wrong-audience/expired/revoked tokens,
  member↔admin token separation, account-enumeration resistance, SQL-injection inputs, mass
  assignment, cross-tenant body ids, unsigned payment webhooks. Plus the tenant-isolation suite.
* **Video pipeline:** ffmpeg transcoding to H.264 ≤720p MP4 with all metadata (incl. GPS atoms)
  stripped, poster frame, 180 s cap; mobile feed shows the poster and plays the video.
* **M-Pesa refunds** via the Daraja Reversal API with an authenticated asynchronous result callback;
  refunds tracked `PENDING → SUCCEEDED/FAILED`.
* **GPS storage:** `activity_gps_points` range-partitioned by month with automatic partition creation
  and a default partition; partition pruning verified by test.
* **Step counts** from Health Connect (Android) and HealthKit (iOS), read-only, merged per day without
  double counting, never inferred from GPS.
* **Load test** baseline (single node): club discovery ~1 000 req/s, feed ~440 req/s (query 5 ms on
  200k posts), GPS ingestion ~33 000 points/s, zero errors. No capacity claims beyond these numbers.
* Prometheus metrics, OpenAPI for all 123 paths, encrypted backups with a verified restore drill,
  production configuration guards (the API refuses unsafe providers/secrets in staging/production).

## Cannot be completed in this environment

These need hardware, accounts or people that a code repository cannot provide. Everything around them
(code, configuration, scripts, tests with mocked providers) is in place.

* **Physical-device testing.** Background GPS accuracy and battery use, camera QR scanning, maps,
  push notifications and Health Connect/HealthKit permissions must be exercised on real Android/iOS
  devices with an EAS development build (no emulator acceleration is available here).
* **Live payment-provider runs.** M-Pesa (STK push, callbacks, reversals) and Stripe are implemented
  to the providers' documented APIs and tested against mocked responses; an end-to-end run needs your
  Daraja sandbox and Stripe test credentials.
* **External penetration test** by an independent firm before public launch.
* **Legal review** of the privacy policy and terms (Kenya Data Protection Act 2019, ODPC
  registration) and of sponsorship terms.

## Required external configuration for launch

SMTP, Africa's Talking (SMS), Expo push (EAS project), S3/R2 bucket, ClamAV, M-Pesa initiator credentials for reversals, Google/Apple OAuth
client ids, Google Maps Android key, M-Pesa Daraja credentials + callback secret, Stripe keys +
webhook secret, Sentry DSN, `METRICS_TOKEN`. All documented in `server/.env.example` and
`docs/deployment/DEPLOYMENT_GUIDE.md`.
