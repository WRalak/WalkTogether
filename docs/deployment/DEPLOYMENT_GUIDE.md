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

All four images are built on every CI run (`docker-images` job); the API image is additionally
smoke-tested to confirm it refuses to start with an unsafe production configuration. The API image
includes `ffmpeg` for video transcoding.

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

### Supporting services

* **ClamAV** (`clamd`, e.g. `clamav/clamav:1.4` as an ECS sidecar or service): set
  `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`. Every upload is scanned before processing.
* **ffmpeg/ffprobe** are in the API/worker image (`FFMPEG_PATH`/`FFPROBE_PATH` to override). Videos are
  limited to 180 s, re-encoded to H.264 ≤720p with all container metadata (including GPS atoms) removed.
* **GPS partitions:** `activity_gps_points` is range-partitioned by month. The worker's daily
  `partitions.maintain` job creates partitions four months ahead; rows outside them land in the default
  partition, so ingestion never fails. Detach/archive old partitions per the retention policy.
* **Health data:** Android builds need Health Connect (minSdk 26, `READ_STEPS` declared and justified
  in the Play Console health-apps form); iOS builds need the HealthKit entitlement. Steps are read-only
  and never inferred from GPS.

## 5. Backups and recovery

| Item | Policy |
| --- | --- |
| RDS automated backups | 14–35 days PITR; snapshots before every migration; cross-region copy daily |
| Redis | Queues are recoverable state; AOF on; jobs are idempotent |
| Object storage | Versioning + lifecycle rules |
| Restore drill | Quarterly: restore PITR into an isolated instance, run smoke tests, record RTO/RPO |

Targets: RPO ≤ 5 minutes, RTO ≤ 2 hours. `infrastructure/deployment/backup.sh` produces encrypted
`pg_dump` archives to S3; `restore-drill.sh` restores the latest into a scratch database and verifies
row counts and migrations (drill executed successfully during Phase 9). Repeat quarterly on staging.

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
| M-Pesa (Phase 7) | `MPESA_*` incl. `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL` (reversals/refunds) | Safaricom Daraja portal (sandbox → go-live; Reversal API enabled on the shortcode) |
| Stripe (Phase 7) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe dashboard |
| Maps (Phase 3) | `GOOGLE_MAPS_ANDROID_KEY` or `MAPBOX_TOKEN` | Google Cloud / Mapbox (restricted keys) |
| Push (Phase 5) | `PUSH_PROVIDER=expo`, `EXPO_ACCESS_TOKEN`, `EAS_PROJECT_ID`, FCM credentials in EAS | Expo / Firebase |
| Media | `STORAGE_DRIVER=s3`, `S3_*`, `MEDIA_PUBLIC_BASE_URL`, `MALWARE_SCANNER=clamav` | S3 / Cloudflare R2 + ClamAV |
| Metrics | `METRICS_TOKEN` | Generate; give to Prometheus |

None of these are faked: without credentials, OAuth returns `503 PROVIDER_NOT_CONFIGURED` and
deployed environments refuse to start with console email/SMS providers.
