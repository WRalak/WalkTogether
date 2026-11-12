# Development Status

_Last updated: 2026-11-12 — Phases 1–9 implemented, plus the DevSecOps & security architecture phase
(section below). Everything that can be built and verified without physical devices, live provider
credentials, cloud accounts or third parties is done; those items are listed at the end._

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
| 10 DevSecOps | Secure CI/CD (18 stages), SAST/DAST/IaC/container scanning, SBOM, signed images, Terraform + Kubernetes baseline, member MFA, least-privilege DB, threat detection, security policies | ✅ (see open items) |

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

## DevSecOps & security architecture — done (2026-11-12)

Started from a gap analysis of the repository (`security/GAP_ANALYSIS.md`, gaps G1–G19 with evidence
and status). Decisions are recorded where they are made: inline `#checkov:skip` reasons, the
vulnerability exception register, the RLS decision (`ACCESS_CONTROL_POLICY.md` §6).

* **Pipeline** (`security/policies/DEPLOYMENT_SECURITY.md`): `ci.yml` (lockfile install, ESLint with
  security rules + Prettier, typecheck, unit, API security and integration tests **as the
  least-privilege `wt_app` role**, encrypted backup → restore drill, migration drift, builds, non-root
  image check, Trivy CRITICAL gate, Syft SBOM); `security-scan.yml` (Semgrep registry packs + 10
  tested custom rules, Gitleaks full history, npm audit + Trivy fs, Checkov + Trivy config + Terraform
  validate, Prometheus/Alertmanager/nginx/Compose validation, OWASP ZAP API scan; weekly schedule);
  `mobile-build.yml` (tests, hardened release-config checks, EAS on tags); `deploy-staging.yml`
  (only after green CI + security scan; GHCR by digest, re-scan, SBOM attestation, Cosign keyless
  signing, AWS OIDC → SSM deploy, smoke/security checks, ZAP baseline); `deploy-production.yml`
  (signature + attestation verification, re-scan, exception-register gate, `production` environment
  approval, health verification). Critical findings can only pass through a documented, approved,
  expiring entry in `security/vulnerability-management/exceptions.yaml` (`check_exceptions.py`).
* **Application:** optional member TOTP MFA with recovery codes (API + mobile, all sign-in paths);
  RS256 pinned for Google/Apple ID tokens; production start-up guard requires TLS to PostgreSQL
  (`sslmode`) and Redis (`rediss://`); security-event metrics (auth/MFA failures, token reuse,
  suspicious logins, rate limiting, 401/403, admin actions, forged payment webhooks) with Prometheus
  alerts and a Grafana dashboard; payments protected by a DB trigger (no deletes, no edits to
  amounts); login history purged after 12 months; Android `allowBackup=false`, cleartext only in dev
  builds, release builds refuse a non-HTTPS API URL.
* **Database:** roles `wt_migrator` / `wt_app` / `wt_readonly` (`infrastructure/deployment/database-roles.sql`);
  the app role cannot run DDL or alter audit logs, invoices or payments — the whole server suite runs as it in CI.
* **Infrastructure:** `infrastructure/docker` (hardened production Compose: read-only, cap-drop ALL,
  limits, segmented networks, digests), `infrastructure/nginx` (TLS 1.2/1.3, headers, rate limits),
  `infrastructure/terraform` (AWS: VPC tiers + flow logs, WAF + ALB, private SSM-only host with IMDSv2,
  RDS with force_ssl/pgaudit/PITR, ElastiCache TLS+AUTH, KMS everywhere, Object-Lock backups, Secrets
  Manager, CloudWatch alarms, GuardDuty, CloudTrail, GitHub OIDC; dev/staging/prod), `infrastructure/kubernetes`
  (PSA restricted, default-deny network policies — for later scale), `infrastructure/monitoring`,
  `infrastructure/deployment/deploy.sh` (signature verification, secrets from Secrets Manager, rollback).
  Checkov: 0 failed checks.
* **Documentation:** `SECURITY.md`; `security/threat-model/THREAT_MODEL.md`;
  `security/incident-response/INCIDENT_RESPONSE.md`; `security/vulnerability-management/VULNERABILITY_MANAGEMENT.md`;
  `security/policies/{ACCESS_CONTROL_POLICY,BACKUP_AND_RECOVERY,DEPLOYMENT_SECURITY,DATA_PROTECTION_POLICY}.md`;
  `security/security-checklists/*`.

Note on the spec's file tree: it lists `pnpm-workspace.yaml`; this repository uses **npm
workspaces** (root `package.json` → `workspaces`) by the owner's choice, so that file does not exist.

**Not claimed:** no external penetration test, certification or compliance attestation has been done.

### Open security items

| Item | Why open | Owner action |
| --- | --- | --- |
| Pin GitHub Actions to commit SHAs | Needs GitHub API access to resolve SHAs | Run a pinning tool (e.g. `pinact`), Dependabot then maintains them |
| Branch protection, `production` reviewers, CODEOWNERS enforcement, secret-scanning push protection | Repository settings, not code | `DEPLOYMENT_SECURITY.md` §6 |
| Apply Terraform, populate Secrets Manager, first deploys | Needs AWS accounts | `security/security-checklists/NEW_ENVIRONMENT_CHECKLIST.md` |
| Terraform provider lock files | Registry unreachable from the build environment | `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64` in each environment, commit |
| Cross-region backup copy | Cost/scale decision | `BACKUP_AND_RECOVERY.md` §6 |
| Audit-log archival job (> 7 years) | Not needed before year 7 | `DATA_PROTECTION_POLICY.md` §4 |
| PostgreSQL RLS | Deliberately deferred | `ACCESS_CONTROL_POLICY.md` §6 |
| MASVS dynamic testing on devices, external pen test, ODPC registration/DPIA | Needs devices, a firm, counsel | below |

## Tests (all passing)

| Suite | Tests |
| --- | --- |
| Server integration/unit (19 files: auth, MFA, users, clubs, tenant isolation, security (incl. threat-detection metrics, retention), links, platform analytics, phase 2, activities, events, social/media/video/messaging, challenges, payments/sponsorships, M-Pesa (mocked Daraja), platform admin, admin, journey, unit (incl. production config guard)) | 173 |
| `packages/shared-utils` (formatting + GPS engine) | 12 |
| `packages/validation` | 6 |
| `packages/api-client` | 4 |
| `platform-admin` | 1 |
| Mobile (Jest: schemas, token store, tracking session, offline sync, QR parsing, component, club-admin access) | 12 |
| **Total** | **208** |

Also verified: workspace typecheck, ESLint and Prettier; the GitHub Actions pipeline described above
(run results on GitHub); a real-browser run of every
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
