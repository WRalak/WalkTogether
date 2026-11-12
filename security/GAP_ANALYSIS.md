# Security gap analysis — 2026-11-12

Baseline review of the repository against the DevSecOps & Security Architecture specification
(OWASP ASVS / API Top 10 / MASVS, NIST CSF, CIS, SLSA). "Status" records what was done about each
gap in this iteration; anything not closed is tracked in `DEVELOPMENT_STATUS.md`.

## Already in place before this review (evidence)

| Control | Evidence |
| --- | --- |
| Argon2id hashing, short-lived JWT (15 min), rotating refresh tokens with reuse detection, session revocation, account lockout, suspicious-login detection | `server/src/modules/auth/*`, `server/test/auth.test.ts` |
| Separate platform-admin identity with mandatory TOTP MFA | `server/src/modules/administration/admin-auth.service.ts`, `server/test/platform-admin.test.ts` |
| Server-side RBAC + tenant isolation (`requireClubPermission`), privilege-escalation guards | `server/src/modules/clubs/club-access.ts`, `server/test/tenant-isolation.test.ts` |
| Zod validation on every input, Prisma parameterised queries, body size limit, CORS allow-list, Helmet headers, per-route rate limits | `server/src/app.ts`, `server/test/security.test.ts` |
| Payment callbacks verified server-side (signatures, provider status query), idempotency keys, reconciliation job, append-only audit log, immutable invoices | `server/src/modules/payments/*`, `server/test/payments.test.ts`, `mpesa.test.ts` |
| Upload magic-byte sniffing, ClamAV, EXIF/metadata stripping | `server/src/modules/media/*` |
| Log redaction of credentials | `server/src/shared/logger.ts` |
| Mobile tokens in Keystore/Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), no AsyncStorage for secrets, validated QR deep links | `mobile/services/secure-storage.ts`, `mobile/app/events/scan.tsx` |
| Encrypted backups + tested restore drill, gitleaks, dependency audit, Dependabot, non-root multi-stage images | `infrastructure/backup/*`, `.github/*` |
| No server-side fetch of user-supplied URLs (SSRF surface): outbound calls go only to fixed provider hosts (Africa's Talking, Daraja, Stripe, Google/Apple JWKS, Expo) | `grep fetch( server/src` |

## Gaps found and status

| # | Gap | Spec | Status |
| --- | --- | --- | --- |
| G1 | "lint" was only `tsc`; no ESLint, no format check | §3 stages 3 | Closed: ESLint (typescript-eslint, react-hooks, security rules) + Prettier check in CI |
| G2 | No SAST, container scanning, IaC scanning, DAST, SBOM or image signing | §3 | Closed in CI: Semgrep, Trivy, Checkov, OWASP ZAP, Syft, Cosign |
| G3 | No staging/production deploy pipelines, no approval gate, no documented exception process | §3 stages 14–18 | Closed: `deploy-staging.yml`, `deploy-production.yml` (GitHub environment approval, signature verification, critical-finding gate with `security/vulnerability-management/exceptions.yaml`, health verification) |
| G4 | No infrastructure-as-code; network isolation only described in docs | §7 | Closed: Terraform modules + dev/staging/prod; private data subnets; SSM instead of public SSH; Checkov in CI |
| G5 | No metrics for authentication failures, rate-limit hits, authorization denials, admin actions or payment anomalies; no dashboards/alerts | §9 | Closed: `walktogether_security_events_total` etc., Prometheus rules, Grafana dashboard |
| G6 | MFA only for platform admins; members could not opt in | §4 Authentication | Closed: optional TOTP MFA + recovery codes for members (API + mobile) |
| G7 | Production config did not require TLS to PostgreSQL or Redis | §5, §7 | Closed: start-up guard requires `sslmode=require|verify-full` and `rediss://` |
| G8 | App connected to PostgreSQL with one all-powerful role | §5 least privilege | Closed: separate migrator / application / read-only roles (`infrastructure/deployment/database-roles.sql`) |
| G9 | Payment rows could be deleted or their amount/currency altered in SQL | §11 immutable financial records | Closed: trigger blocks DELETE and edits to financial fields |
| G10 | Android backups and cleartext traffic not explicitly disabled | §6 MASVS-STORAGE/NETWORK | Closed: `allowBackup: false`, cleartext only in development builds |
| G11 | Compose stack lacked read-only filesystems, resource limits, network segmentation | §7 | Closed: `infrastructure/docker/docker-compose.yml` |
| G12 | Security policy documents missing | §12 | Closed: `SECURITY.md` + `security/*` (threat model, incident response, vulnerability management, access control, backup & recovery, deployment security, data protection, checklists) |
| G13 | PostgreSQL Row-Level Security not used | §5 (consider) | **Decision recorded, not implemented** — see `security/policies/ACCESS_CONTROL_POLICY.md` §6 |
| G15 | Login history kept forever (data-protection retention not enforced) | §5, DPA 2019 | Closed: daily purge after 12 months (`session-maintenance.ts`, tested) |
| G16 | Backup restorability only checked manually | §10 | Closed: encrypted backup → restore drill runs in CI on every push |
| G17 | GitHub Actions pinned by tag, not commit SHA | §3 SLSA | Closed: every action pinned to a commit SHA (version in a comment for Dependabot, 7-day cooldown) |
| G18 | GitHub branch protection, environment reviewers, CODEOWNERS enforcement | §3, §8 | **Owner action** — repository settings, listed in `DEPLOYMENT_SECURITY.md` §6 |
| G20 | Semgrep registry findings (first CI run): AES-GCM decrypt without fixed tag length; `Math.random` fallback for the mobile device id; nginx forwarded any `Upgrade` value (h2c smuggling); HTTP→HTTPS redirect reflected the Host header; no package-age delay | §3 SAST | Closed: 128-bit tag enforced (tested), `expo-crypto` CSPRNG, WebSocket-only upgrade map, per-host redirects, `min-release-age=7` + Dependabot cooldown. Remaining matches are documented `nosemgrep` false positives (escaped CSV/GPX/HTML output, dev-only seed, docs-only CSP relaxation) |
| G21 | Container images on Debian 12 carried CRITICAL OS CVEs (zlib, libxml2, glib, mbedtls, libaom via ffmpeg) — found by the new CI Trivy gate | §3, §7 | Mostly closed: base image moved to Debian 13 (`node:22-trixie-slim`, pinned by digest) with security updates applied at build (7 → 1 CRITICAL). The remaining libxml2 CVE has no Debian fix; ffmpeg input is now restricted to the MP4/QuickTime demuxer and local files (makes the libxml2 path unreachable, tested) and a **pending** exception blocks production until the owner approves |
| G19 | No cross-region copy of backups/media | §10 | **Open** — planned, `BACKUP_AND_RECOVERY.md` §6 |
| G14 | Physical-device mobile security testing (background GPS permissions, MASVS dynamic checks), external pen test | §6, §13 | **Open** — needs devices / an external firm |
