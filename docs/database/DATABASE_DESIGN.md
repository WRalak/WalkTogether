# Database Design

PostgreSQL 16 + PostGIS 3, accessed through Prisma 6. Schema: `server/prisma/schema.prisma`;
migrations: `server/prisma/migrations`.

## 1. Conventions

* UUID primary keys; `snake_case` tables/columns via `@map`; `created_at`/`updated_at` everywhere.
* Every club-scoped table carries `club_id` with an index leading on it.
* Enumerations as PostgreSQL enums for closed sets; permission keys as rows (open, catalogued sets).
* Keyset (cursor) pagination on `(created_at DESC, id DESC)` — no `OFFSET` on large tables.
* Secrets are never stored in plain text: passwords (Argon2id), refresh/reset/verification tokens and
  invitation codes (HMAC-SHA256), OTPs (HMAC), TOTP secrets (AES-256-GCM).
* Things Prisma cannot express live in hand-written SQL inside migrations (CHECK constraints,
  partial unique indexes, triggers). GIST/GIN indexes are declared in the schema so drift checks pass.

## 2. Phase 1 schema (implemented)

### Identity & accounts

| Table | Purpose / notable constraints |
| --- | --- |
| `users` | email (unique, lower-case CHECK), phone (unique, E.164), username (unique, lower-case CHECK), password hash (nullable for OAuth/phone users), status, lockout counters, suspension, deletion schedule. CHECK: email or phone present unless deleted. Trigram index on username |
| `user_profiles` | 1:1 profile: display name (trigram index), bio, avatar URL, location, country, interests, preferred activity types |
| `user_privacy_settings` | profile/activity visibility, show clubs/stats, follow requests, **hide start/end (default true)**, privacy-zone radius (CHECK 0–2000 m) |
| `user_notification_settings` | channel + category preferences (marketing default off) |
| `user_sessions` | one per signed-in device: auth method, device info, IP, UA, expiry, revocation |
| `refresh_tokens` | hashed tokens per session, `used_at`, `replaced_by_id` (rotation chain) |
| `email_verifications`, `password_resets` | hashed single-use tokens with expiry |
| `phone_verifications` | hashed OTPs, attempts, purpose, expiry |
| `oauth_accounts` | `(provider, provider_account_id)` unique |
| `user_devices` | push tokens (unique) |
| `login_events` | sign-in history and suspicious flags |
| `user_blocks` | `(blocker, blocked)` PK, CHECK not self |

### Clubs (tenants)

| Table | Purpose / notable constraints |
| --- | --- |
| `clubs` | slug (unique, CHECK format), visibility, status, contact, socials (JSON), city/country, **`location geography(Point,4326)` with GIST index**, owner, denormalised `member_count` (CHECK ≥ 0), trigram index on name |
| `club_settings` | per-club settings (member invites, member list visibility, timezone, membership questions) |
| `club_permissions` | global catalogue of permission keys (synced from code at start-up) |
| `club_roles` | per-club roles; unique `(club_id, name)`, `(club_id, system_key)`, `(id, club_id)`; **partial unique index: one owner role per club** |
| `club_role_permissions` | role ↔ permission |
| `club_memberships` | unique `(club_id, user_id)`; status; **composite FK `(role_id, club_id)` → `club_roles(id, club_id)`** |
| `club_invitations` | hashed codes, optional recipient binding, role (composite FK), CHECK `0 ≤ use_count ≤ max_uses` |

### Platform administration

| Table | Purpose |
| --- | --- |
| `admin_users`, `admin_roles`, `admin_permissions`, `admin_role_permissions` | separate admin identity + RBAC; encrypted TOTP secret |
| `admin_sessions` | hashed current + previous refresh token for replay detection |
| `audit_logs` | append-only (trigger blocks UPDATE/DELETE/TRUNCATE); indexed by actor, target, club, time |
| `platform_settings` | JSON values editable by super-admins (e.g. `clubs.maxOwnedPerUser`) |
| `feature_flags` | enabled, rollout % (CHECK 0–100), rules |

## 3. Later-phase models (designed, not yet migrated)

Added by the phase that needs them, each with its own migration.

**Clubs (Phase 2):** `ClubAnnouncement`, `ClubSubscription` (club_id, plan_id, status, period, grace_until).

**Fitness (Phase 3):**

```
activities(id, user_id, type, status[RECORDING|PROCESSING|COMPLETED|REJECTED], client_id UNIQUE per user,
           started_at, ended_at, moving_seconds, elapsed_seconds, distance_m, avg_pace_s_per_km,
           max_speed_mps, elevation_gain_m NULL, calories_estimate, visibility, route_simplified geography(LineString),
           start_point geography(Point), end_point geography(Point), flags JSONB, created_at)
activity_gps_points(activity_id, seq, recorded_at, location geography(Point), accuracy_m, altitude_m NULL,
                    speed_mps NULL, PRIMARY KEY(activity_id, seq))   -- range-partitioned by month
activity_visibility(activity_id, audience[PUBLIC|FOLLOWERS|PRIVATE|CLUB], club_id NULL)  -- explicit club shares
activity_media, activity_likes, activity_comments, personal_goals, fitness_achievements, user_achievements
```

GPS points are rows, **never** a JSON blob. `activity_gps_points` is partitioned by month
(`recorded_at`), has a BRIN index on time and a GIST index on location; raw points older than the
retention window can be down-sampled once `route_simplified` is stored.

**Events (Phase 4):** `events` (club_id, recurrence rule, location geography), `event_registrations`,
`event_attendance` (method QR|ORGANIZER|GPS_PROXIMITY, proximity_m), `event_reminders`.

**Social (Phase 5):** `follows`, `posts`, `post_media`, `comments`, `comment_reactions`,
`content_reports`, `conversations`, `conversation_members`, `messages`, `media_assets`, `notifications`.

**Challenges (Phase 6):** `challenges` (scope PERSONAL|CLUB|PLATFORM|SPONSORED, rules JSONB),
`challenge_participants`, `challenge_progress`, `challenge_results`, `leaderboards`, `leaderboard_entries`.

**Monetization (Phase 7):** `subscription_plans` (audience CLUB|INDIVIDUAL, price, currency, interval,
trial days — all admin-configurable), `subscription_entitlements` (plan_id, key, limit), `subscriptions`
(subject_type CLUB|USER, subject_id, status, current_period_end, grace_until), `payments`,
`payment_transactions`, `invoices`, `refunds`, `webhook_events` (provider, event_id UNIQUE — idempotency),
`sponsors`, `sponsored_campaigns`, `sponsored_events`.

**Infrastructure:** `background_jobs` is not needed as a table (BullMQ/Redis is the job store); job
outcomes that matter for business logic are recorded in their own domain tables.

## 4. Indexing strategy

| Query | Index |
| --- | --- |
| Nearby clubs | GIST on `clubs.location` + `ST_DWithin` |
| Club / user search | GIN trigram on `clubs.name`, `users.username`, `user_profiles.display_name` |
| Discovery listing | `(status, visibility)`, `(country_code, category)` |
| Member lists | `(club_id, status, created_at)` |
| A user's clubs | `(user_id, status)` |
| Sessions | `(user_id, revoked_at)` |
| Audit | `(actor_type, actor_id, created_at)`, `(target_type, target_id)`, `(club_id, created_at)` |

## 5. Migration policy

* Create migrations with `prisma migrate dev --create-only`, review the SQL, add hand-written parts,
  then apply. Never edit an applied migration.
* CI runs `prisma migrate diff --exit-code` so the schema and migrations cannot drift.
* Production applies migrations with `prisma migrate deploy` as a separate job **before** new
  application versions start. Destructive changes use expand → migrate data → contract across releases
  and require a verified backup (see the deployment guide).
* The permission catalogue and admin roles are synced idempotently at API start-up and by the seed.

## 6. Scaling notes

* Connection pooling via PgBouncer/RDS Proxy (transaction mode) in front of Postgres.
* Read replicas for discovery and analytics queries once needed.
* `activity_gps_points` partitioning and retention as above; leaderboards are materialised by jobs.
* Counters like `member_count` are maintained transactionally to avoid `COUNT(*)` on hot paths.
