# Security Architecture

Security is part of the architecture, not a final step. This document lists the controls that exist
today (✅), and those designed for later phases (🗓).

## 1. Identity and authentication

| Control | Implementation |
| --- | --- |
| ✅ Password hashing | Argon2id, OWASP parameters (m=19 MiB, t=2, p=1); transparent rehash on login when parameters change |
| ✅ Password policy | ≥10 chars, letters + numbers (length-first, NIST 800-63B style); admins ≥14 |
| ✅ User enumeration resistance | Generic login errors; dummy-hash timing equalisation; identical forgot-password responses |
| ✅ Brute force | Per-IP rate limits (Redis) + per-account lockout (10 failures → 15 min; admins 5 → 30 min) |
| ✅ Access tokens | HS256 JWT, 15 min, `iss`/`aud`/`typ` checked; algorithm pinned |
| ✅ Refresh tokens | 384-bit opaque random, **stored only as HMAC-SHA256**, rotated on every use |
| ✅ Refresh reuse detection | Presenting a used token revokes the whole session (token family) and is audited |
| ✅ Immediate revocation | Revoked session ids are pushed to a Redis deny-list checked on every request; DB fallback fails closed |
| ✅ Device sessions | List devices, revoke one, revoke all; password change/reset revokes other sessions |
| ✅ Suspicious login detection | New device **and** new IP vs 90-day history → flagged + email notice |
| ✅ Phone OTP | 6-digit codes, HMAC-hashed, 10-min expiry, single use, 5 attempts, 60 s cooldown, 5/hour per number |
| ✅ OAuth | Google/Apple ID tokens verified against provider JWKS (`iss`, `aud`, `exp`); auto-link only when both sides have verified the email |
| ✅ Email verification / reset | Single-use HMAC-hashed tokens (24 h / 30 min); resets invalidate older links |
| ✅ Account deletion | Re-authentication, immediate global sign-out, 30-day grace, then irreversible anonymisation job |

### Token storage on clients

* **Mobile:** refresh token in Android Keystore / iOS Keychain via `expo-secure-store`
  (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); access token only in memory. Nothing in AsyncStorage.
* **Web dashboards:** refresh token in an `httpOnly; Secure; SameSite=Strict` cookie scoped to
  `/api/v1/auth` (or `/api/v1/platform-admin/auth`); access token in memory only. The refresh endpoint
  only reads the cookie when the custom `X-WT-Client: web` header is present, which cross-site forms
  cannot send and CORS blocks for scripts — a CSRF defence on top of SameSite.

## 2. Platform administrators

* Separate identity table (`admin_users`), separate JWT secret and audience; no self-registration —
  admins are created with `scripts/create-admin.ts` (audited).
* **MFA is mandatory**: the password step returns only a 5-minute MFA token; TOTP enrolment is forced at
  first sign-in. TOTP secrets are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`). Codes cannot be
  replayed within their window (Redis `SET NX`).
* Admin sessions are validated against the database on every request (low volume, high privilege) and
  last at most 8 hours; refresh tokens rotate with replay detection.
* Role-based admin permissions (`SUPER_ADMIN`, `SUPPORT`, `FINANCE`, `MODERATOR`).
* Recommended deployment: separate hostname behind VPN / IP allow-list / zero-trust proxy.

## 3. Authorization and tenant isolation

See `docs/architecture/MULTI_TENANT_DESIGN.md`. Summary: route-derived club id, server-side membership
resolution, 404 for invisible tenants, scoped sub-resource loads, composite FKs, privilege-escalation
guards, and a dedicated test suite.

## 4. Input handling

| Threat | Control |
| --- | --- |
| ✅ Mass assignment | All bodies parsed with `.strict()` Zod schemas — unknown fields → 422 |
| ✅ SQL injection | Prisma parameterisation; PostGIS uses `Prisma.sql` tagged templates (bound parameters); `LIKE` wildcards escaped |
| ✅ XSS | React escaping; JSON-LD serialised with `<` escaped; strict CSP on all web apps; URLs restricted to `http(s)` (blocks `javascript:`) |
| ✅ Open redirects | Dashboard `?next=` accepts only same-app relative paths |
| ✅ Payload abuse | 1 MB JSON limit; 413/400 mapped cleanly |
| 🗓 File uploads (Phase 5) | Pre-signed S3 uploads, MIME sniffing (magic bytes), size limits, image re-encoding (strips EXIF GPS), async malware scan (ClamAV/GuardDuty) before publish |

## 5. Transport and headers

* TLS everywhere (Nginx/ALB), HSTS with preload.
* API: `helmet` defaults, `X-Powered-By` disabled, CORS allow-list with credentials.
* Web apps: CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, restrictive
  `Permissions-Policy`; dashboards also send `X-Robots-Tag: noindex`.

## 6. Secrets and configuration

* Environment validated at boot with Zod. In `staging`/`production` the server **refuses to start**
  with console email/SMS providers, inline queues, disabled rate limiting, placeholder-looking secrets, or
  identical member/admin JWT secrets.
* No secrets in frontend bundles: only `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` values (URLs) are exposed.
* Production secrets are injected from AWS Secrets Manager / SSM; `.env` files are git-ignored and
  only `.env.example` files are committed.

## 7. Logging, audit and privacy of logs

* Structured JSON logs (pino) with **redaction** of authorization headers, cookies, passwords, tokens,
  OTP codes and MFA tokens. Query strings are never logged (reset links carry tokens).
* Append-only `audit_logs`: a PostgreSQL trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. Records
  actor, action, target, club, metadata, IP, user agent and request id. Sensitive actions (auth events,
  role changes, moderation, admin actions, settings changes) are audited inside the same transaction as
  the change.
* Grant the application DB role only `INSERT, SELECT` on `audit_logs` in production for defence in depth.

## 8. Data protection (Kenya DPA 2019, GDPR-aligned)

* Data minimisation: only data needed for the service; phone and location are optional.
* Privacy by default: route start/end hidden; FOLLOWERS-default activity visibility; private club
  membership never shown on public profiles.
* Data-subject rights: self-service export (`GET /users/me/export`), correction (profile editing),
  deletion (grace period + anonymisation), objection to marketing (opt-in notifications).
* Calories and fitness estimates are labelled as estimates, not medical data. Step counts will only come
  from Health Connect / HealthKit, never inferred.
* Register as a data controller with the ODPC before launch; keep a record of processing; DPIA for GPS.

## 9. Planned controls by phase

| Phase | Control |
| --- | --- |
| 3 | GPS anti-spoofing heuristics, privacy zones applied server-side before any share |
| 5 | Socket.IO auth handshake with access tokens; per-conversation membership checks; message/report rate limits; upload pipeline above |
| 7 | Webhook signature verification (Stripe signatures, Daraja callback secret + IP allow-list + query-status confirmation), idempotency keys, no client-trusted payment success |
| 9 | External penetration test, load test, backup-restore drills, WAF rules |

## 10. Dependency and supply-chain security

* Exact version pinning + lockfile; Dependabot; `pnpm audit --prod` and gitleaks in CI.
* `onlyBuiltDependencies` allow-list in `pnpm-workspace.yaml` restricts install scripts.
