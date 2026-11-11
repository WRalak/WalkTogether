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

## Architecture in one paragraph

Two frontends and one backend. The **mobile app** serves every club role — members, owners,
administrators, organisers and moderators — and the interface adapts to each user's permissions in
each club; club management needs no separate website. The **platform admin** is the only web
application, for WalkTogether staff. Both talk to one **API**, the only component with database
access, which enforces RBAC and tenant isolation on every request. There is no public marketing
website: email-link, invitation, payment-return and legal pages are served by the API.

## What exists (by area)

**Backend (`server/`)** — Express 5 modular monolith, Prisma/PostgreSQL+PostGIS, Redis, BullMQ worker,
Socket.IO. Modules: auth, users, clubs, memberships, announcements, subscriptions/entitlements,
activities, gps (point storage, validation, partitions), events, social (follows, posts, comments,
feed), media, messaging, moderation, challenges/leaderboards/achievements, payments, sponsorships,
notifications, analytics (club analytics, platform activity, CSV reports), administration, links
(email/invite/payment/legal pages), audit. 11 migrations, no schema drift.

**Shared packages** — `shared-types`, `validation` (Zod), `api-client`, `shared-utils` (formatting
helpers and the GPS engine: filtering, statistics, `TrackingEngine`, polyline, privacy trimming).

**Mobile (`mobile/`)** — auth (email, phone OTP), Activity tab (background location with foreground
fallback, SQLite offline store, crash recovery, resumable batched sync), activity history/detail with
maps, home/profile stats, Clubs tab (my clubs, discovery, events, sponsored), club detail/chat, events
with RSVP + QR scanner check-in, community feed (photos and video posters), composer, comments,
messaging, profiles/follows, notifications + push, challenges & leaderboards, achievements, step
counts from Health Connect/HealthKit, Premium (M-Pesa/card), privacy & security settings.
**Club administration (`mobile/app/admin`)**, shown only to users with an administrative club
permission: create club; overview KPIs; members (requests, roles, suspend/remove, CSV share);
invitations (share link, copy code, revoke); roles & ownership transfer; events (create with date
pickers, GPS-pinned meeting point, recurrence; manage with rotating check-in QR, attendance marking,
CSV share, cancel); attendance report; shared activities; challenges; announcements; analytics with
charts; subscription (plans, M-Pesa/card checkout, invoices); settings with logo/cover upload;
moderation; sponsorship offers. **Sponsor portal (`mobile/app/sponsor`)**: apply, create and submit
campaigns, pay, aggregated reports.

**Platform admin (`platform-admin/`, `/dashboard/<section>`)** — MFA sign-in; overview KPIs (MRR/ARR,
sponsorship revenue); clubs (approve, suspend); users (detail, suspend); subscriptions (plans,
promotions, subscriptions list, grants); payments & refunds; sponsorships (sponsors, campaigns,
competitions & badges); events across all clubs (moderator cancel); analytics (platform activity,
flagged activities, revenue); reports (CSV: users, clubs, payments, daily activity); moderation queue;
settings & feature flags; audit logs; security monitoring; system health; administrators.

## Tests (all passing)

| Suite | Tests |
| --- | --- |
| Server integration/unit (18 files: auth, users, clubs, tenant isolation, security, links, platform analytics, phase 2, activities, events, social/media/video/messaging, challenges, payments/sponsorships, M-Pesa (mocked Daraja), platform admin, admin, journey, unit) | 164 |
| `packages/shared-utils` (formatting + GPS engine) | 12 |
| `packages/validation` | 6 |
| `packages/api-client` | 4 |
| `platform-admin` | 1 |
| Mobile (Jest: schemas, token store, tracking session, offline sync, QR parsing, component, club-admin access) | 12 |
| **Total** | **199** |

Also verified: workspace typecheck; per-application GitHub Actions workflows (integration against
PostGIS/Redis, migration drift check, platform-admin build, Android JS bundle export, Docker image
builds with an API boot smoke test, `npm run audit:prod`, gitleaks); a real-browser run of every
platform-admin section against a live API (MFA sign-in, CSV download); a database backup/restore
drill; and a load test (`infrastructure/loadtest/README.md`).

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
  push notifications, Health Connect/HealthKit permissions, and the club-admin screens' native pieces
  (date pickers, QR display, CSV/invoice share sheet, logo upload) must be exercised on real
  Android/iOS devices with an EAS development build. The app type-checks, passes its Jest suite and
  bundles for Android, but no emulator acceleration is available here to run it.
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
