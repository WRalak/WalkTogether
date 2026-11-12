# Threat model

_Method: data-flow diagram + STRIDE per trust boundary. Reviewed: 2026-11-12. Review again for any
change to authentication, payments, tenant boundaries, infrastructure topology, or at least
every six months._

## 1. System and assets

| Asset | Why it matters | Where |
| --- | --- | --- |
| Member credentials and sessions (password hashes, refresh tokens, TOTP secrets) | Account takeover | PostgreSQL (`users`, `user_sessions`, encrypted MFA secrets), device keystore |
| Live and historical GPS tracks, home/privacy zones | Physical safety of members (stalking) | PostgreSQL (`gps_partitions`), Redis (live), mobile |
| Personal data: name, email, phone (KE), photos, health metrics | Kenya DPA 2019 obligations | PostgreSQL, S3 media |
| Club data and member lists (multi-tenant) | One club must never see or change another's data | PostgreSQL, scoped by `club_id` |
| Payments, invoices, subscriptions, payouts | Fraud, financial loss, regulatory | PostgreSQL (append-only), M-Pesa / Stripe |
| Platform-admin accounts | Full platform control | Separate identity, mandatory MFA |
| Signing keys and secrets (JWT, HMAC, encryption key, provider credentials) | Forge tokens / decrypt data / move money | AWS Secrets Manager only |
| Build and deploy pipeline | Supply-chain compromise ships malicious code to everyone | GitHub Actions, GHCR |

## 2. Trust boundaries (data flow)

```
 [Mobile app]──HTTPS──┐                     ┌──[M-Pesa Daraja / Stripe] (webhooks: signature + status query)
 [Admin browser]─HTTPS─┼─▶ WAF ─▶ ALB ─▶ nginx ─▶ API ──┬─▶ PostgreSQL (TLS, wt_app role)
 [Provider webhooks]───┘   (TB1: internet)   (TB2: VPC) ├─▶ Redis (TLS + AUTH)
                                                         ├─▶ S3 (VPC endpoint, KMS)
                                                         └─▶ Worker ─▶ SMS / email / push providers
 [GitHub Actions]─OIDC─▶ AWS SSM ─▶ host deploy.sh (TB3: CI → production; Cosign verification)
 [Operator]─SSO/IAM─▶ SSM Session Manager (TB4: humans → production; no SSH)
```

## 3. STRIDE analysis

| # | Boundary / component | Threat (STRIDE) | Mitigation (evidence) | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | Login | **S** credential stuffing / brute force | Argon2id; per-IP + per-account rate limits; lockout after 10 failures (15 min); suspicious-login detection; optional TOTP MFA; `AuthenticationFailureSpike` alert (`server/src/modules/auth`, `server/test/auth.test.ts`, `mfa.test.ts`) | Users without MFA reusing breached passwords |
| T2 | Session | **S** stolen refresh token | Rotation with reuse detection → whole session family revoked; mobile keystore storage; web httpOnly SameSite=Strict cookie; `RefreshTokenReuseDetected` alert | Token theft from a rooted device until next rotation |
| T3 | Phone OTP | **S** SIM swap / OTP brute force | Hashed single-use OTPs, attempt limits, OTP rate limit, MFA still required after OTP when enabled | SIM swap for members without MFA |
| T4 | Club APIs | **E/I** cross-tenant access (BOLA, OWASP API1) | Every club route goes through `requireClubPermission` with the club id from the path and membership from the DB; tested in `tenant-isolation.test.ts` | New routes forgetting the guard → covered by review checklist |
| T5 | Club roles | **E** member grants themselves admin | Role assignment requires `members.roles.assign`; owner role protected; cannot assign a role above your own (`roles.service.ts`) | — |
| T6 | Platform admin | **E/S** admin takeover | Separate identity, mandatory TOTP, short sessions (8 h, 10 min tokens), permission per action, audit log, `PrivilegedAdminActivityBurst` alert, optional IP allow-list at the ALB | Phishing of an admin's TOTP in real time |
| T7 | Payments | **T** forged webhook / client claims "paid" | Status changes only from verified callbacks (signature / STK query); idempotency keys; DB trigger forbids changing amounts or deleting payments; reconciliation job; `ForgedPaymentWebhooks` alert | Provider-side compromise |
| T8 | Payments | **R** disputed refund / admin manipulation | Append-only `audit_logs` and invoices (DB grants + triggers); every admin action audited | — |
| T9 | GPS | **I** location disclosure / stalking | Routes shown to anyone but the owner are privacy-trimmed around start/finish (`activities.service.ts`); activity visibility public/followers/private (default followers); realtime rooms authorised per join against the DB (`messaging/realtime.ts`); location is never broadcast live | Inference from repeated partial routes |
| T10 | Uploads | **T/E** malware, polyglots, metadata leakage | Magic-byte sniffing, size limits, ClamAV, EXIF/GPS stripping, private bucket + signed URLs | Zero-day in image decoders (sandboxed by container limits) |
| T11 | API | **D** request floods | WAF rate rule + managed rules, nginx and app rate limits, body size limits, statement timeouts on `wt_app` | Large distributed attacks (consider AWS Shield Advanced) |
| T12 | API | **I** injection (SQLi/XSS/SSRF) | Zod validation, Prisma parameterisation (Semgrep rule blocks `$queryRawUnsafe` interpolation), HTML escaping on server pages, no fetch of user URLs; ZAP in CI | — |
| T13 | Data tier | **I** direct DB/Redis access | Data subnets without internet routes; SG only from app host; TLS enforced (`rds.force_ssl`, `rediss://` start-up guard); least-privilege roles | Compromise of the app host |
| T14 | Secrets | **I** secrets leaked in git / logs / images | Secrets Manager only, Gitleaks on full history, pino redaction, `.env.example` placeholders, images contain no env | Operator mishandling (runbook + least-privilege IAM) |
| T15 | CI/CD | **T** malicious dependency or tampered image | Lockfile installs, npm audit + Dependabot, Trivy, SBOM, Cosign keyless signing verified in CI **and** on the host, production approval, CODEOWNERS | Actions pinned by tag, not SHA (gap, see `DEVELOPMENT_STATUS.md`) |
| T16 | Infrastructure | **E** instance credential theft from a container | IMDSv2, hop limit 1, read-only containers, no capabilities, no-new-privileges | — |
| T17 | Operators | **R/E** untracked production changes | No SSH; SSM sessions logged; CloudTrail with log validation; GitHub OIDC deploy role usable only from the protected environment | Account root user compromise (MFA + no access keys required) |
| T18 | Mobile | **I** data on lost device / backups | Keystore storage, `allowBackup=false`, no secrets in AsyncStorage, HTTPS only in release builds | Rooted/jailbroken devices |

## 4. Abuse cases tested automatically

`server/test/security.test.ts`, `tenant-isolation.test.ts`, `auth.test.ts`, `mfa.test.ts`,
`payments.test.ts`, `mpesa.test.ts` and `admin.test.ts` encode the mitigations above (cross-club
access, privilege escalation, token reuse, forged callbacks, append-only records, rate limits,
MFA replay). They run in CI as the least-privilege database role.
