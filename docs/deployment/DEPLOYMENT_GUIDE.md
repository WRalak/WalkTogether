# Deployment Guide

## 1. Environments

| Environment | Purpose | Data | Notes |
| --- | --- | --- | --- |
| Local | Development | Seed/demo data | `docker compose up -d postgres redis` + `pnpm dev:*` |
| Test | Automated tests | Disposable `walktogether_test` DB rebuilt each run | CI services: `postgis/postgis:16-3.4`, `redis:7` |
| Staging | Pre-release verification, mobile preview builds | Synthetic data only | Same topology as production, smaller sizes |
| Production | Live | Real data | Multi-AZ, backups, alerting |

`NODE_ENV=staging|production` activates strict configuration checks: the API refuses to start with
console email/SMS providers, inline queues, disabled rate limits, placeholder secrets, or identical
member/admin JWT secrets.

## 2. Reference AWS topology

* **Compute:** ECS Fargate services — `api` (≥2 tasks), `worker` (≥1), `web`, `club-admin`,
  `platform-admin`; one-off `migrate` task per release.
* **Ingress:** ALB with ACM certificates (or Nginx per `infrastructure/nginx/walktogether.conf`);
  AWS WAF managed rules; platform admin hostname restricted by IP/VPN.
* **Data:** RDS PostgreSQL 16 Multi-AZ with the PostGIS extension; RDS Proxy for pooling;
  ElastiCache Redis 7 (cluster mode off, Multi-AZ, `noeviction` for BullMQ).
* **Storage/CDN (Phase 5):** S3 (or Cloudflare R2) + CloudFront; private buckets, pre-signed uploads.
* **Secrets:** AWS Secrets Manager → ECS task env. Rotate JWT/HMAC secrets with dual-key overlap.
* **Observability:** CloudWatch logs (JSON from pino), Sentry (`SENTRY_DSN`), ALB/RDS/Redis alarms,
  uptime checks on `/health/ready`.

## 3. Images

```bash
docker build -f infrastructure/docker/server.Dockerfile -t walktogether-api .
```

```bash
docker build -f infrastructure/docker/next-app.Dockerfile --build-arg APP=web --build-arg NEXT_PUBLIC_API_URL=https://api.walktogether.app --build-arg NEXT_PUBLIC_SITE_URL=https://walktogether.app --build-arg NEXT_PUBLIC_CLUB_ADMIN_URL=https://clubs.walktogether.app -t walktogether-web .
```

Repeat with `APP=club-admin` and `APP=platform-admin`. The API image runs `node dist/main.js` by
default; the worker uses `node dist/worker.js`; migrations use `npx prisma migrate deploy`.

> The Dockerfiles were written for this repository layout but have not yet been built in CI with a
> Docker daemon; add an image-build job before the first staging deploy.

## 4. Release procedure

1. CI green on `main` (typecheck, unit, integration incl. tenant isolation, migration drift, builds,
   audit, secret scan).
2. Build and push images tagged with the git SHA.
3. **Back up / snapshot** the database (automated RDS snapshot + verify it completed).
4. Run the `migrate` task (`prisma migrate deploy`). Migrations must be backwards-compatible with the
   running version (expand → migrate → contract). Destructive steps (dropping columns/tables) ship in a
   later release after code no longer uses them, and only after a verified backup.
5. Deploy `worker`, then `api` (rolling, health-checked on `/health/ready`), then web apps.
6. The API syncs the permission catalogue at start-up; run `node dist/create-admin.js` only to
   bootstrap the first platform admin.
7. Smoke test: `/health/ready`, sign-in, club discovery; watch Sentry and error-rate alarms.
8. Rollback: redeploy the previous image; migrations are forward-only and backwards-compatible by
   policy, so code rollback does not require schema rollback.

## 5. Backups and recovery

| Item | Policy |
| --- | --- |
| RDS automated backups | 14–35 days PITR; snapshots before every migration; cross-region copy daily |
| Redis | Queues are recoverable state; AOF on; jobs are idempotent |
| Object storage | Versioning + lifecycle rules |
| Restore drill | Quarterly: restore PITR into an isolated instance, run smoke tests, record RTO/RPO |

Targets: RPO ≤ 5 minutes, RTO ≤ 2 hours (to be validated by drills in Phase 9).

## 6. Mobile releases

* Development builds: `eas build --profile development --platform android` (background location
  requires a dev/production build, not Expo Go).
* Staging: `preview` profile (internal APK) pointing at the staging API.
* Production: `production` profile (AAB) → Google Play internal testing → closed → production.
* Play Console declarations: background location justification video, data safety form (location,
  personal info, fitness), account deletion URL.

## 7. Required configuration

See `server/.env.example` (documented line by line) and each app's `.env.example`. External
credentials needed before a real launch:

| Integration | Variables | Where to obtain |
| --- | --- | --- |
| Email | `EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM` | Amazon SES / Postmark / SendGrid |
| SMS OTP | `SMS_PROVIDER=africastalking`, `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_SENDER_ID` | Africa's Talking account + registered sender ID |
| Google sign-in | `GOOGLE_CLIENT_IDS` | Google Cloud Console OAuth clients (web, Android, iOS) |
| Apple sign-in | `APPLE_CLIENT_IDS` | Apple Developer: Services ID + bundle ID |
| Errors | `SENTRY_DSN` | Sentry project |
| M-Pesa (Phase 7) | `MPESA_*` | Safaricom Daraja portal (sandbox → go-live) |
| Stripe (Phase 7) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard |
| Maps (Phase 3) | `GOOGLE_MAPS_ANDROID_KEY` or `MAPBOX_TOKEN` | Google Cloud / Mapbox (restricted keys) |
| Push (Phase 5) | `EAS_PROJECT_ID`, FCM credentials in EAS | Expo / Firebase |

None of these are faked: without credentials, OAuth returns `503 PROVIDER_NOT_CONFIGURED` and
deployed environments refuse to start with console email/SMS providers.
