# Development Status

_Last updated: 2026-11-10 — end of Phase 1._

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Monorepo, backend, PostgreSQL/PostGIS, Prisma, Redis, auth, profiles, RBAC, multi-tenant club foundation, public website, mobile navigation, admin authentication | ✅ Complete |
| 2 Club SaaS | Custom roles UI, ownership transfer, announcements, club plans & entitlements, dashboard analytics, browser E2E tests | ⏭ Next (membership core already built in Phase 1) |
| 3 GPS tracking | Recording engine, background/offline, sync, activity history, personal stats | Designed (`docs/architecture/GPS_TRACKING_DESIGN.md`) |
| 4 Events & attendance | Events, recurrence, RSVP, QR check-in, reminders, reports | Planned |
| 5 Social community | Feed, posts, media pipeline, likes, comments, follows, messaging, push, moderation | Planned |
| 6 Challenges | Challenge engine, leaderboards, badges/achievements | Planned |
| 7 Monetization | Plans, payments (M-Pesa, Stripe), webhooks, invoices, sponsorships | Designed (`docs/architecture/MONETIZATION_DESIGN.md`) |
| 8 Platform administration | Revenue analytics, plan management, sponsor management, moderation queues | Foundation built in Phase 1 |
| 9 Production hardening | Pen test, load test, backup drills, monitoring, Play Store release | Planned |

## Phase 1 report

### What was implemented

**Backend (`server/`)**
* Express 5 modular monolith with request ids, structured logging with secret redaction, helmet, strict
  CORS, Redis-backed rate limits, central error envelope, Zod validation (`strict`, rejects unknown fields),
  generated OpenAPI 3.1 docs, liveness/readiness probes, graceful shutdown, Sentry hook.
* **Auth:** email/password registration and login (Argon2id), refresh-token rotation with reuse detection,
  per-device sessions, logout one/all, immediate revocation (Redis deny-list), account lockout, login
  history, suspicious-login detection + email, email verification, forgot/reset/change password,
  **phone OTP sign-in and phone-first sign-up**, Google/Apple ID-token sign-in (JWKS-verified; returns
  503 until client ids are configured), web cookie mode with CSRF header.
* **Users:** profile, username/email change (re-verification), privacy settings (privacy-by-default),
  notification preferences, push device registration, blocking (bidirectional 404), public profiles
  respecting privacy, data export, account deletion with 30-day grace and anonymisation job.
* **Clubs (tenants):** creation (verified accounts, per-user limit from platform settings, optional
  platform approval), per-club system roles, discovery with search/category/country and **PostGIS
  nearby search**, slug/id lookup with visibility rules, updates with audit.
* **Memberships:** join (public instant / approval / private requests / invite-only), leave, approve/reject,
  role assignment and moderation (suspend/reinstate/remove/ban) with **hierarchy and privilege-escalation
  guards**, hashed invitation codes (recipient-bound, max uses, expiry, revoke, preview), "my clubs".
* **Platform admin:** separate identity, **mandatory TOTP MFA** (encrypted secrets, replay protection),
  admin RBAC, overview KPIs, user search/suspend/reactivate (revokes sessions), club
  search/suspend/reactivate/approve, append-only audit log, platform settings, feature flags, CLI bootstrap.
* Background jobs: typed BullMQ catalogue, worker with retries/backoff, recurring purge/cleanup schedulers.

**Web**
* `apps/web`: home, features, discover clubs (search/filter/pagination), club pages (JSON-LD, Open Graph,
  `noindex` for private clubs), for clubs, for organizations, sponsors, pricing (no hardcoded prices),
  about, contact, privacy, terms, verify-email, reset-password, sitemap, robots, CSP.
* `apps/club-admin`: sign up/in, session restore via httpOnly cookie, club picker, create club (with
  verification prompt), overview, members (tabs, search, approve/reject, roles, suspend/reinstate/remove),
  invitations (create/copy once/revoke), settings. Navigation shows only permitted sections.
* `apps/platform-admin`: password → TOTP (QR enrolment) sign-in, overview, users, clubs, audit log,
  settings & feature flags; permission-aware navigation.

**Mobile (`apps/mobile`)**
* Expo SDK 54 app with Expo Router, NativeWind design system, TanStack Query, Zustand session store,
  SecureStore token storage, auth flows (welcome, email sign-in/up, phone OTP sign-in/up, forgot password),
  tabs (Home, Explore, Record, Community, Profile), club discovery with infinite scroll and club detail with
  join/request/invitation/leave, privacy settings, security settings (devices, sign out everywhere,
  account deletion). App config declares background-location permissions and the foreground service.

### Honest limitations (not complete yet)

* **Record tab**: only the real location-permission flow; GPS recording is Phase 3.
* **Community tab, Home weekly stats, Profile statistics**: explanatory placeholders until Phases 3/5.
* Mobile app has **not been run on a physical device or emulator** in this environment; it typechecks,
  passes Jest tests, and its Android JS bundle compiles (`expo export`). Device testing is required.
* Dockerfiles and the CI workflow have not been executed here (no Docker daemon / GitHub runner); the same
  commands were run locally.
* Image uploads are URL fields for now; the S3 upload/processing pipeline is Phase 5.
* No subscription plans, entitlements or payments yet (Phase 2/7). The pricing page lists tiers only.
* Club ownership transfer and custom-role editing UI are Phase 2.
* Privacy policy and terms are drafts requiring legal review (Kenya DPA 2019).

### Files and modules created

`server/src/{config,database,middleware,queues,shared}`, `server/src/modules/{auth,users,clubs,memberships,administration,platform,notifications,audit,health}`,
`server/prisma/{schema.prisma,migrations/*_init,seed.ts,seed-demo.ts}`, `server/scripts/create-admin.ts`,
`server/test/*` · `packages/{shared-types,validation,api-client,ui,configuration}` ·
`apps/{web,club-admin,platform-admin,mobile}` · `infrastructure/{docker,nginx}` · `docker-compose.yml` ·
`.github/workflows/ci.yml`, `.github/dependabot.yml` · `docs/**`.

### Database changes

Migration `20261110100047_init`: PostGIS + pg_trgm extensions; 28 tables (identity, sessions/tokens,
verification, OAuth, devices, login events, blocks, clubs, settings, permissions, roles, memberships,
invitations, admin users/roles/permissions/sessions, audit logs, platform settings, feature flags);
GIST/GIN indexes; CHECK constraints; composite tenant FKs; one-owner-per-club partial unique index;
append-only audit trigger. Schema/migration drift check: no difference.

### Tests executed (all passing)

| Suite | Tests |
| --- | --- |
| Server integration & unit (auth, users, clubs, **tenant isolation**, platform admin, audit immutability, journey) | 79 |
| `packages/validation` | 6 |
| `packages/api-client` (single-flight refresh, cookie mode, errors) | 4 |
| `apps/web`, `apps/club-admin`, `apps/platform-admin` | 5 |
| `apps/mobile` (Jest: schemas, token store, component) | 5 |
| **Total** | **99** |

Also verified: workspace typecheck, production builds of the API and all three Next.js apps, Android JS
bundle export, schema drift check, and real-browser runs (Playwright) of club-admin sign-in → members →
invitation creation → session restore, and platform-admin sign-in with TOTP enrolment → overview → audit log.

### Required environment variables

Documented in `server/.env.example` and `apps/*/.env.example`. External credentials needed for a real
launch (none are faked): SMTP (email), Africa's Talking (SMS OTP), Google/Apple OAuth client ids, Sentry.
See `docs/deployment/DEPLOYMENT_GUIDE.md` §7.

### How to run

See `README.md` → Getting started.

### Next (Phase 2: Club SaaS)

1. Club ownership transfer, custom roles CRUD (`roles.manage`), membership questions.
2. Club announcements with notification fan-out (queue) respecting preferences.
3. `subscription_plans` / `subscription_entitlements` / `subscriptions` tables, admin plan management,
   entitlement resolution + `requireEntitlement` guard, Free plan limits.
4. Club dashboard analytics (growth, engagement) and CSV export (`reports.export`).
5. Playwright browser E2E suite in CI for club-admin and platform-admin.
6. Media upload pipeline groundwork (pre-signed S3 uploads for logos/covers).
