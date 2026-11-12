# Incident response

Aligned with NIST SP 800-61 (prepare → detect & analyse → contain → eradicate & recover →
post-incident). Every Prometheus security alert links to a playbook anchor in this file.

## 1. Severity

| Level | Examples | Response | Who is told |
| --- | --- | --- | --- |
| **SEV1** | Confirmed breach of personal data or credentials; payment fraud in progress; admin account compromised; production down | Immediately, 24/7 | Incident lead, owner, affected clubs; **ODPC within 72 h** if personal data is affected (Kenya DPA 2019 s.43) |
| **SEV2** | Suspected breach under investigation; active credential-stuffing; vulnerability with a working exploit | Within 1 h | Incident lead, owner |
| **SEV3** | Contained attack (blocked by controls), non-exploitable finding | Next business day | Engineering |

## 2. Roles

* **Incident lead** (on-call engineer): owns the timeline, decides containment, keeps the log.
* **Communications** (owner, @WRalak until the team grows): users, clubs, ODPC, payment providers.
* **Scribe**: timestamps every action in the incident doc (UTC).

## 3. First 30 minutes (any security incident)

1. Open an incident record (private GitHub security advisory or private doc). Start the timeline.
2. **Preserve evidence before changing anything**: export relevant CloudWatch/CloudTrail/WAF logs,
   `audit_logs` rows, `login_events`, Prometheus snapshots; snapshot the RDS instance
   (`aws rds create-db-snapshot`); never wipe a host before imaging its volume.
3. Contain with the narrowest effective action (playbooks below).
4. Assess personal-data impact → if likely, start the 72-hour ODPC clock.

## 4. Playbooks

### Credential attacks
_Alerts: `AuthenticationFailureSpike`, `MfaFailureSpike`, `SuspiciousLoginSurge`, `RateLimitAbuse`._
1. Identify source IPs/ASNs from WAF logs and `login_events`.
2. Add an IP set block rule to the WAF web ACL (or lower the rate rule) — no deploy needed.
3. Check for successful logins from the same sources; for each affected account, suspend it in
   the platform admin (Users → Suspend; this revokes every session), contact the owner, and
   reactivate once they have reset their password.
4. Encourage MFA for affected users; consider temporarily requiring phone OTP step-up.

### Session theft
_Alert: `RefreshTokenReuseDetected`._
1. The API already revoked the whole session family. Look up the user and both IPs/devices.
2. If several users are affected, suspect device malware or a leaking proxy; check for a
   pattern (app version, network).
3. If systemic: rotate `JWT_ACCESS_SECRET` (invalidates all access tokens within 15 min) and
   revoke all refresh tokens (`UPDATE user_sessions SET revoked_at = now()` via the migrator role,
   recorded in the incident log).

### Tenant isolation
_Alert: `AuthorizationDenialSpike`._
1. Find the actor(s) and routes from structured logs (`requestId`, `userId`, `clubId`).
2. Confirm denials held (403s). If any **2xx** cross-tenant access is found → SEV1: disable the
   route (feature flag or hotfix), notify the affected clubs, assess data exposed.
3. Add a regression test to `server/test/tenant-isolation.test.ts` before closing.

### Admin compromise
_Alert: `PrivilegedAdminActivityBurst`._
1. Suspend the admin (`/platform-admin/admins/:id/status` → `SUSPENDED`, revokes sessions) from a
   different super-admin account.
2. Review `audit_logs` for the actor since their last legitimate session; reverse changes.
3. Reset the admin's password and TOTP; review how the second factor was obtained.

### Payment fraud
_Alert: `ForgedPaymentWebhooks`, `PaymentFailureRate`._
1. Forged webhooks are rejected and changed nothing (verification precedes any state change);
   block the source at the WAF.
2. Run reconciliation for the window and compare with the provider dashboards (Daraja, Stripe).
3. If a provider credential leaked: rotate it at the provider, update Secrets Manager, redeploy.
4. Never edit payment rows by hand — the DB forbids it; corrections are new refund/adjustment rows.

### Secret leaked (git, logs, screenshot)
1. Rotate immediately at the source (provider console / Secrets Manager) — assume it was used.
2. Redeploy so the new value is loaded; confirm the old one is rejected.
3. Purge from git history only after rotation (the value is already compromised).

### Infrastructure compromise (host, container, cloud account)
1. Isolate: replace the app host's security group with an empty one (keeps the disk for forensics).
2. Snapshot the EBS volume and RDS; rotate every secret in `walktogether/<env>/*`.
3. Rebuild from Terraform + signed images; never reuse the compromised host.
4. Review CloudTrail for the IAM principal; check GuardDuty findings.

### Data loss / corruption
Follow `security/policies/BACKUP_AND_RECOVERY.md` (PITR or encrypted dump restore).

## 5. Communication templates

* **Users**: what happened, what data, what we did, what they should do (reset password, enable
  MFA), contact address. Plain language, English and Swahili.
* **ODPC notification**: nature of breach, categories and approximate number of data subjects,
  likely consequences, measures taken, DPO contact.

## 6. After the incident (within 5 business days)

Blameless review: timeline, root cause, what detected it, what slowed us down. Every action item
gets an owner and a due date; security fixes ship with a regression test. Update the threat model
if a new threat was found.
