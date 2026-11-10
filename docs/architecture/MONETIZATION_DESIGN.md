# Monetization, Subscriptions & Payments Design

Status: **designed.** Plan entitlements arrive in Phase 2; payments, invoices and sponsorships in Phase 7.
Phase 1 already provides the configurable `platform_settings`, feature flags, and the audit trail these
build on.

## 1. Revenue streams

1. **Club subscriptions** — Free Club, Club Pro, Club Enterprise.
2. **Individual premium subscriptions** — WalkTogether Premium.
3. **Sponsored events and competitions** — campaigns purchased by organisations.

## 2. Core rules (enforced in code and tests)

* Club and individual subscriptions are **independent**: `subscriptions.subject_type ∈ {CLUB, USER}`.
  A club subscription never grants members individual premium entitlements.
* **Basic personal GPS tracking is always free** and never depends on any club's plan.
* Prices, intervals, trials, limits and entitlements are **data, not code** — managed in the platform
  admin. The marketing site does not hardcode prices.
* A subscription is activated **only** after a verified provider confirmation (webhook with valid
  signature or a server-side status query). Client "success" screens are informational only.
* When a subscription lapses: grace period → downgrade entitlements; **no data is deleted**; history is
  preserved; affected users/admins are told clearly what changed.

## 3. Data model

```
subscription_plans(id, code, audience CLUB|INDIVIDUAL, name, description, currency, amount_minor,
                   interval MONTH|YEAR, trial_days, is_active, sort_order, created_at)
subscription_entitlements(plan_id, key, int_limit NULL, bool_value NULL)   -- e.g. club.max_admins=3,
                                                                             -- club.recurring_events=true
subscriptions(id, subject_type CLUB|USER, subject_id, plan_id, status TRIALING|ACTIVE|PAST_DUE|
              GRACE|CANCELED|EXPIRED, current_period_start, current_period_end, grace_until,
              cancel_at_period_end, provider, provider_ref, created_at)
              UNIQUE (subject_type, subject_id) WHERE status IN (TRIALING, ACTIVE, PAST_DUE, GRACE)
payments(id, subscription_id NULL, campaign_id NULL, payer_user_id, amount_minor, currency, status
         PENDING|SUCCEEDED|FAILED|REFUNDED, provider, idempotency_key UNIQUE, created_at)
payment_transactions(payment_id, provider_txn_id UNIQUE, raw_status, payload JSONB, received_at)
invoices(id, number UNIQUE, subject_type, subject_id, payment_id, amounts, tax, pdf_key, issued_at)
refunds(id, payment_id, amount_minor, reason, provider_ref, status)
webhook_events(provider, event_id, received_at, processed_at, signature_valid, payload JSONB,
               PRIMARY KEY (provider, event_id))   -- idempotent webhook processing
sponsors, sponsored_campaigns(status DRAFT|REVIEW|ACTIVE|ENDED, budget, terms_url, eligibility JSONB),
sponsored_events
```

## 4. Entitlement resolution

`entitlements.service.resolve(subject)` returns the effective map (plan entitlements; free-plan
defaults when no active subscription; grace keeps current entitlements until `grace_until`). It is cached
in Redis per subject and invalidated on subscription changes. Feature checks call
`requireEntitlement(clubId, 'club.recurring_events')` **after** `requireClubPermission` — permissions
answer "may this person do it?", entitlements answer "does this club's plan include it?".

Limits (e.g. `club.max_admins`, `club.max_events_per_month`) are checked transactionally at the point of
creation. Downgrades never delete over-limit data; they block creating more.

## 5. Payment provider abstraction

```ts
interface PaymentProvider {
  id: 'mpesa' | 'stripe' | string;
  initiate(input: { paymentId; amountMinor; currency; payer: { phone?; email? }; description;
                    idempotencyKey }): Promise<{ status: 'PENDING' | 'REQUIRES_ACTION'; providerRef; clientAction? }>;
  verifyWebhook(req): Promise<{ eventId; providerRef; outcome: 'SUCCEEDED' | 'FAILED' | 'PENDING'; raw }>;
  queryStatus(providerRef): Promise<'SUCCEEDED' | 'FAILED' | 'PENDING'>;
  refund?(providerRef, amountMinor): Promise<{ refundRef }>;
}
```

### M-Pesa (Safaricom Daraja) — initial Kenyan provider

* **STK Push** (Lipa Na M-Pesa Online) for subscriptions and campaign payments.
* Credentials (never committed): `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
  `MPESA_PASSKEY`, `MPESA_ENV=sandbox|production`, `MPESA_CALLBACK_SECRET`.
* Callback hardening: secret path token + Safaricom IP allow-list at the ingress + **mandatory
  `STK Push Query` confirmation** before activation (callbacks are not signed).
* Recurring billing: Daraja has no card-style auto-renew for STK; renewals send a reminder and a new
  STK push before period end, with grace on failure. Ratiba (standing orders) can be evaluated later.

### Stripe — international cards

Checkout Sessions / Billing subscriptions; webhook signatures verified with `STRIPE_WEBHOOK_SECRET`;
`STRIPE_SECRET_KEY` server-side only.

## 6. Flow

```
client → POST /subscriptions/checkout {planId, subject, provider, Idempotency-Key}
  server: authorize (billing.manage for clubs / self for individuals) → create payment(PENDING)
          → provider.initiate → 202 {paymentId, status}
provider → POST /payments/webhooks/:provider
  server: verify signature/secret → insert webhook_events (dedupe) → confirm via queryStatus
          → in one transaction: payment SUCCEEDED, subscription ACTIVE/extended, invoice issued, audit
          → enqueue receipt email/notification
client polls GET /payments/:id (or receives a push) to update UI.
```

Jobs: `subscriptions.renewal-reminders`, `subscriptions.expire-and-grace`, `payments.reconcile-pending`
(queries providers for stale PENDING payments).

## 7. Sponsorships

* Sponsor profiles and campaigns are created by sponsors or platform staff and **reviewed** before
  activation (moderation state machine).
* Sponsored content is always labelled "Sponsored" in UI and API (`isSponsored: true`).
* Every sponsored challenge publishes eligibility, competition terms, prize rules and data-use consent;
  participants opt in explicitly. Reports to sponsors are aggregated and privacy-preserving.
* Prize fulfilment is recorded (`campaign_rewards`) with audit logs; no rules that reward unsafe
  behaviour (e.g. no "fastest at night" incentives; caps on daily distance credit).

## 8. Revenue analytics (platform admin)

MRR/ARR from active subscriptions normalised to monthly amounts per currency; churn from cancellations;
sponsorship revenue from succeeded campaign payments. Computed by scheduled jobs into snapshot tables
to keep dashboards fast.

## 9. Testing

Unit tests for entitlement resolution and state transitions; integration tests for checkout idempotency,
webhook signature failure, duplicate webhooks, out-of-order webhooks, "client says success but provider
says pending" (must not activate), grace and downgrade behaviour, and independence of club vs individual
subscriptions. Production refuses mock providers (same pattern as email/SMS today).
