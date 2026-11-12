# Data protection policy

WalkTogether processes personal data of members in Kenya and is subject to the **Kenya Data
Protection Act, 2019** and its 2021 regulations (registration with the ODPC as data controller and
processor is required before launch). This document describes how the product meets it; it is
**not legal advice** and must be reviewed by counsel before launch.

## 1. Data inventory

| Category | Examples | Purpose | Legal basis |
| --- | --- | --- | --- |
| Account | Name, username, email, phone, password hash, OAuth subject | Provide the service, security | Contract |
| Location (sensitive in practice) | GPS tracks, privacy zones | Activity recording, routes, challenges | Consent (OS permission + in-app explanation) |
| Health-adjacent | Distance, pace, heart rate (if imported), steps | Fitness features | Explicit consent |
| Social | Posts, photos, comments, follows, club memberships | Community features | Contract |
| Payments | Subscription, invoices, M-Pesa phone and receipt, Stripe customer id (**no card data**) | Billing, tax, fraud prevention | Contract, legal obligation |
| Security | IP, device, login history, audit logs | Fraud and abuse prevention | Legitimate interest |

## 2. Principles in the product

* **Minimisation:** only fields the feature needs; analytics are aggregate.
* **Privacy by default:** activities default to *followers*; routes shown to others are trimmed
  around start/finish; profile and activity visibility are user-controlled.
* **Purpose limitation:** location is never sold or shared with sponsors; sponsors see aggregate
  campaign metrics only.
* **Security:** TLS everywhere, encryption at rest (KMS), field encryption for MFA secrets,
  least-privilege access (`ACCESS_CONTROL_POLICY.md`), logs redact credentials, tokens and OTPs.

## 3. Data-subject rights

| Right | How |
| --- | --- |
| Access / portability | Settings → *Export my data* (`GET /api/v1/users/me/export`, JSON) |
| Rectification | Profile and settings screens |
| Erasure | Settings → *Delete account*: sessions revoked immediately, profile hidden, anonymised after a 30-day grace period (`account-deletion.ts`); financial records kept anonymised as required by tax law |
| Objection / withdraw consent | Location and health permissions can be revoked in OS settings and the app; marketing notifications opt-in |

Requests through support are answered within 30 days, after verifying identity.

## 4. Retention

| Data | Retention |
| --- | --- |
| Active account data | While the account exists |
| Deleted accounts | Anonymised after 30 days |
| Login history | 12 months — purged daily by the `sessions.cleanup` job (`session-maintenance.ts`) |
| Expired sessions, OTPs, reset/verification tokens | 30 days after expiry (same job) |
| Audit logs | Kept (append-only; the application role cannot delete them). Minimum 7 years; an archival job for older rows is a tracked follow-up |
| Invoices and payments | 7 years (Kenya Tax Procedures Act), anonymised payer after account deletion |
| Backups | Per `BACKUP_AND_RECOVERY.md` (max 365 days) — deleted data ages out of backups |
| Application container logs | Rotated on the host (20 MB × 5 files per container) |
| WAF, VPC flow, CloudTrail logs | 365–400 days (Terraform `log_retention_days`) |

## 5. Processors and transfers

AWS (af-south-1, South Africa), Safaricom (M-Pesa), Stripe, Africa's Talking (SMS), the email
provider, Expo (push notifications), Google/Apple (sign-in). Each requires a data processing
agreement; transfers outside Kenya rely on the safeguards in DPA 2019 s.48–49 (to be confirmed by
counsel and recorded with the ODPC).

## 6. Breaches

Follow `security/incident-response/INCIDENT_RESPONSE.md`. The ODPC must be notified within
**72 hours** of becoming aware of a breach likely to risk data subjects; affected members are told
without undue delay when the risk is high.

## 7. Open items before launch

ODPC registration, Data Protection Impact Assessment (location data at scale), counsel review of
privacy policy (`server/src/modules/links/legal.ts`) and processor agreements, appointment of a DPO
contact.
