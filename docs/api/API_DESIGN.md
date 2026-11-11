# API Design

* Base path: **`/api/v1`** (breaking changes → `/api/v2`, old version supported for a deprecation window).
* JSON over HTTPS. Interactive docs (non-production): **`/api/docs`**; raw spec: `/api/v1/openapi.json`.
  The OpenAPI 3.1 document is generated from the same Zod schemas used for validation
  (`server/src/openapi.ts`), so it cannot drift from behaviour.
* Health: `GET /health/live` (process up), `GET /health/ready` (database + Redis reachable).

## 1. Conventions

### Envelopes

```jsonc
// success
{ "data": { ... }, "meta": { "nextCursor": "eyJ...", "limit": 20 } }   // meta only on lists
// error
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "path": "email", "message": "Invalid email" }], "requestId": "…" } }
```

### Status codes

| Code | Meaning |
| --- | --- |
| 200/201/202/204 | OK / created / accepted (async or pending approval) / no content |
| 400 | Malformed input or business-rule rejection (e.g. invalid invitation) |
| 401 | Missing/invalid/expired token (`TOKEN_EXPIRED`, `SESSION_REVOKED`, `REFRESH_TOKEN_REUSED`…) |
| 403 | Authenticated but not permitted (`FORBIDDEN`, `PRIVILEGE_ESCALATION`, `CLUB_NOT_ACTIVE`…) |
| 404 | Not found **or not visible to the caller** (prevents tenant/resource enumeration) |
| 409 | Conflict (duplicate slug/username, invalid state transition) |
| 413 | Payload too large |
| 422 | Validation error (Zod) — includes unknown fields |
| 429 | Rate limited / temporarily locked |
| 503 | Dependency or provider not configured (e.g. OAuth client ids missing) |

### Pagination, filtering, sorting

* Cursor pagination: `?limit=1..100&cursor=<opaque>`; responses carry `meta.nextCursor` (null at end).
* Default sort is newest first; nearby searches sort by distance with a `(distance, id)` cursor.
* Filters are explicit, validated query parameters (`q`, `category`, `status`, `near=lat,lng`, `radiusKm`).

### Headers

| Header | Purpose |
| --- | --- |
| `Authorization: Bearer <access token>` | Member or admin access token |
| `X-WT-Client: web` | Browser clients: refresh token via httpOnly cookie (also CSRF defence) |
| `X-Request-Id` | Correlation id (generated if absent, echoed back) |
| `Idempotency-Key` | Accepted by CORS now; required on payment/checkout and activity upload endpoints (Phases 3, 7) |
| `RateLimit`, `RateLimit-Policy`, `Retry-After` | IETF draft-7 rate-limit headers |

## 2. Implemented endpoints (Phase 1)

### Auth — `/api/v1/auth`

| Method & path | Notes |
| --- | --- |
| `POST /register` | email + password + username + display name + `acceptTerms: true` |
| `POST /login` | email + password (+ optional device info) |
| `POST /refresh` | rotate; body `refreshToken` (mobile) or cookie + `X-WT-Client: web` |
| `POST /logout`, `POST /logout-all` | revoke current / all sessions |
| `GET /sessions`, `DELETE /sessions/:sessionId` | device management (own sessions only) |
| `GET /login-history` | last 50 sign-in attempts |
| `POST /verify-email`, `POST /verify-email/resend` | single-use emailed token |
| `POST /forgot-password`, `POST /reset-password` | always 202 for forgot; reset revokes all sessions |
| `POST /change-password` | keeps current session, revokes others |
| `POST /phone/request-otp` | `purpose: LOGIN` (anonymous) or `VERIFY` (authenticated) |
| `POST /phone/verify-otp` | LOGIN → tokens or `registration_required` + short-lived token; VERIFY → binds phone |
| `POST /phone/register` | complete phone sign-up |
| `POST /oauth` | Google/Apple ID token |

### Users — `/api/v1/users`

`GET/PATCH /me`, `POST /me/email`, `PATCH /me/privacy`, `GET/PATCH /me/notification-settings`,
`POST /me/devices`, `DELETE /me/devices/:id`, `GET /me/clubs`, `GET /me/blocks`, `GET /me/export`,
`DELETE /me` (deletion request), `POST|DELETE /:id/block`, `GET /:username` (privacy-filtered profile).

### Clubs & memberships — `/api/v1/clubs`

| Method & path | Permission |
| --- | --- |
| `POST /` | verified account; becomes Owner |
| `GET /` | public discovery (`q`, `category`, `countryCode`, `near`, `radiusKm`) |
| `GET /:slugOrId` | visibility rules (invite-only → 404) |
| `PATCH /:clubId` | `club.settings.update` |
| `POST /:clubId/join`, `POST /:clubId/leave` | authenticated |
| `GET /:clubId/members?status=` | `members.view` / `members.approve` (PENDING) / `members.suspend` (SUSPENDED) |
| `POST /:clubId/members/:membershipId/review` | `members.approve` |
| `PUT /:clubId/members/:membershipId/role` | `members.roles.assign` + hierarchy guards |
| `POST /:clubId/members/:membershipId/moderation` | `members.suspend` / `members.remove` + hierarchy guards |
| `GET /:clubId/roles` | `members.view` |
| `POST|GET /:clubId/invitations`, `DELETE /:clubId/invitations/:invitationId` | `members.invite` |
| `GET /invitations/:code` | public preview of a valid invitation |

Club administration in the mobile app uses these club-scoped routes directly. Aggregate views
(analytics, attendance and member reports, shared activities) live under `/api/v1/clubs/:clubId/...` (the analytics module) and use the
same `requireClubPermission` guard.

### Platform admin — `/api/v1/platform-admin`

`POST /auth/login` → `POST /auth/mfa/setup` (first time) → `POST /auth/mfa/verify` → tokens;
`POST /auth/refresh`, `POST /auth/logout`; `GET /me`, `GET /overview`, `GET /users`, `GET /users/:id`,
`POST /users/:id/status`, `GET /clubs`, `GET /clubs/:id`, `POST /clubs/:id/status`,
`POST /clubs/:id/approve`, `GET /audit-logs`, `GET|PUT /settings/:key`, `GET|PUT /feature-flags/:key`.

## 3. Planned endpoints (by phase)

| Phase | Endpoints |
| --- | --- |
| 2 | `GET /subscriptions/plans`, club announcements, custom roles CRUD (`roles.manage`), ownership transfer, `/clubs/:clubId/analytics|reports/*` |
| 3 | `POST /activities` (client UUID, idempotent), `POST /activities/:id/gps-points` (batched, ordered `seq`), `POST /activities/:id/complete`, `GET /activities`, `GET /activities/:id`, `DELETE /activities/:id`, `GET /users/:id/activities`, `GET /me/stats` |
| 4 | `POST|GET /clubs/:clubId/events`, `POST /events/:id/rsvp`, `POST /events/:id/check-in` (QR token / organizer / proximity) |
| 5 | `GET /feed`, `POST /posts`, comments, likes, follows, reports, conversations/messages (+ Socket.IO namespace `/rt`) |
| 6 | `POST /challenges`, `POST /challenges/:id/join`, `GET /challenges/:id/leaderboard`, leaderboards |
| 7 | `POST /subscriptions/checkout`, `GET /subscriptions/me`, `POST /payments/webhooks/:provider`, invoices, sponsors/campaigns |

## 4. Client SDK

`@walktogether/api-client` wraps the API for all clients: typed methods, consistent `ApiError`,
single-flight refresh, and two token modes (web cookie / native keystore).
