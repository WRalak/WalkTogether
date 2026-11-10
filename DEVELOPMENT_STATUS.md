# Development Status

_Last updated: 2026-11-10 — Phases 1–8 implemented; Phase 9 hardening partially complete._

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Monorepo, auth, profiles, RBAC, multi-tenant clubs, web/mobile/admin foundations | ✅ |
| 2 Club SaaS | Custom roles, ownership transfer, announcements, plans & entitlements, notifications | ✅ |
| 3 GPS tracking | Shared engine, background/offline recording, sync, server validation, stats, goals | ✅ (device testing pending) |
| 4 Events & attendance | Events, recurrence, RSVP/waitlist, QR check-in, reminders, reports, analytics | ✅ |
| 5 Social community | Follows, posts, feed, comments, media pipeline, messaging (Socket.IO), moderation | ✅ |
| 6 Challenges | Challenge engine, club-vs-club, leaderboards, achievements | ✅ |
| 7 Monetization | M-Pesa/Stripe providers, verified checkout, invoices, refunds, promotions, sponsorships | ✅ (live provider testing pending) |
| 8 Platform administration | KPIs, revenue, plans, sponsors, moderation, security, system health, admins | ✅ |
| 9 Production hardening | Audit, metrics, OpenAPI, backup drill — load test, pen test, device builds outstanding | 🟡 Partial |

## What exists (by area)

**Backend (`server/`)** — Express 5 modular monolith, Prisma/PostgreSQL+PostGIS, Redis, BullMQ worker,
Socket.IO. Modules: auth, users, clubs, memberships, announcements, subscriptions/entitlements,
activities/GPS, events, social (follows, posts, comments, feed), media, messaging, moderation,
challenges/leaderboards/achievements, payments, sponsorships, administration, notifications, audit.
8 migrations (`init` … `phase7_payments_sponsorships`), no schema drift.

**Shared packages** — `shared-types`, `validation` (Zod), `api-client`, `gps` (filtering, statistics,
`TrackingEngine`, polyline, privacy trimming), `ui`, `configuration`.

**Mobile (`apps/mobile`)** — auth (email, phone OTP), Record (background location task with
foreground fallback, SQLite offline store, crash recovery, resumable batched sync), activity
history/detail with maps, home/profile stats, explore (clubs, events, sponsored), club detail/chat,
events with RSVP + QR scanner check-in, community feed, composer with photo upload, comments,
messaging, user profiles/follows, notifications + push registration, challenges & leaderboards,
achievements, Premium subscription (M-Pesa/card), privacy & security settings.

**Club admin (`apps/club-admin`)** — members, invitations, roles & ownership transfer,
announcements, events + live QR + attendance + CSV, challenges, analytics & reports, community
moderation, sponsorship offers, billing (plans, checkout, invoices), settings with logo/cover upload,
and a sponsor portal (apply, campaigns, pay, reports).

**Platform admin (`apps/platform-admin`)** — MFA sign-in, overview KPIs (incl. MRR/ARR,
sponsorship revenue), revenue, users (detail + history), clubs, plans/promotions/payments/refunds,
sponsors & campaigns (review, reports, rewards), challenges & achievement rules, moderation queue,
audit log, security monitoring, system health, settings/flags, administrators.

**Public web (`apps/web`)** — marketing pages, club discovery/SEO pages, live pricing from the plans
API, sponsor portal entry, email-link pages.

## Tests (all passing)

| Suite | Tests |
| --- | --- |
| Server integration/unit (14 files: auth, users, clubs, tenant isolation, phase 2, activities, events, social/media/messaging, challenges, payments/sponsorships, platform admin, admin, journey, unit) | 132 |
| `packages/gps` | 8 |
| `packages/validation` | 6 |
| `packages/api-client` | 4 |
| Web apps (web, club-admin, platform-admin) | 5 |
| Mobile (Jest: schemas, token store, tracking session, offline sync, QR parsing, component) | 9 |
| **Total** | **164** |

Also verified: workspace typecheck, production builds of all three Next.js apps, Android JS bundle
export (`expo export`), migration drift check, real-browser runs of club-admin and platform-admin
(Phase 1), and a database backup/restore drill (`infrastructure/deployment/restore-drill.sh`).

## Phase 9 — done

* Dependency audit: upgraded `sharp` 0.35.5 (untrusted image processing), `nodemailer` 10.5,
  `postcss` 8.5.32, `deepmerge-ts` 8; remaining advisories documented with mitigations in
  `docs/security/DEPENDENCY_RISK_REGISTER.md`.
* Prometheus metrics (`/metrics`, token-protected): HTTP latency by route, job and payment counters.
* OpenAPI document covers Phases 1–8 (`/api/docs`).
* Backup (`backup.sh`, encrypted pg_dump to S3) and a verified restore drill script.
* Production configuration guards: the API refuses to start in staging/production with console
  email/SMS/push providers, local storage, no malware scanner, sandbox payments, incomplete M-Pesa or
  Stripe credentials, inline queues or placeholder secrets.

## Honest limitations / remaining work

* **Not run on real devices.** Background GPS, camera QR scanning, maps and push need an EAS
  development build on Android hardware; battery and distance-accuracy testing are outstanding.
* **Payments not tested against live providers.** M-Pesa (Daraja) and Stripe integrations are
  implemented to their documented APIs; end-to-end runs need sandbox credentials. M-Pesa refunds are
  recorded as `PENDING_MANUAL` (reversals are a separate Daraja product). Tests use the sandbox
  provider, which is refused in staging/production.
* **No load test or penetration test yet.** No scalability claims are made. Planned: k6 scenarios
  for discovery, feed, GPS ingestion and messaging against staging; external pen test.
* Video uploads are malware-scanned but not transcoded (metadata may remain); MediaConvert is the
  planned next step. ClamAV must be deployed alongside the API in production.
* GPS point table is not yet partitioned; add monthly partitioning before very large volumes.
* Zod 3 → 4 migration pending (see risk register). Apple Health / Health Connect step counts not integrated.
* Dockerfiles and the CI/deploy pipeline have not been executed in this environment.
* Privacy policy and terms are drafts requiring legal review (Kenya DPA 2019).

## Required external configuration for launch

SMTP, Africa's Talking (SMS), Expo push (EAS project), S3/R2 bucket, ClamAV, Google/Apple OAuth
client ids, Google Maps Android key, M-Pesa Daraja credentials + callback secret, Stripe keys +
webhook secret, Sentry DSN, `METRICS_TOKEN`. All documented in `server/.env.example` and
`docs/deployment/DEPLOYMENT_GUIDE.md`.
