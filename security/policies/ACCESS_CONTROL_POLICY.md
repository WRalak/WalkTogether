# Access control policy

## 1. Principles

* **Server-side enforcement only.** The mobile app and platform admin hide controls a user cannot
  use, but every decision is made by the API from the database. Client-side checks are UX, never
  a security boundary.
* **Deny by default, least privilege, separation of duties.**
* **Every privileged action is audited** in the append-only `audit_logs` table.

## 2. Identities

| Identity | Authentication | Token audience |
| --- | --- | --- |
| Member (mobile app) | Password (Argon2id), phone OTP, Google/Apple ID token; **optional TOTP MFA** with single-use recovery codes | `walktogether:member` access token (15 min) + rotating refresh token |
| Platform admin (web) | Separate account table, password + **mandatory TOTP** | `walktogether:admin` (10 min), session max 8 h, httpOnly cookie |
| Services | API/worker use DB role `wt_app`; migrations `wt_migrator`; CI uses GitHub OIDC → AWS role | — |

Member and admin tokens are signed with different keys and audiences; one can never be used as the
other.

## 3. Club roles (tenant-scoped RBAC)

Roles are per club. Permissions are checked on every request by `requireClubPermission(<perm>)`,
with the club id taken from the route and the membership loaded from the database.

| Spec role | System role key | Typical permissions |
| --- | --- | --- |
| Member | `MEMBER` | View club content, join events, post where allowed |
| Club Moderator | `MODERATOR` | Moderate posts/comments, manage reports |
| — | `EVENT_ORGANIZER` | Create/manage events, scan check-ins |
| Club Admin | `ADMIN` | Manage members, roles below their own, events, settings, billing view |
| Club Owner | `OWNER` | Everything, including billing, ownership transfer and deletion |

Guards (`server/src/modules/clubs/roles.service.ts`): nobody can grant permissions they do not
hold, edit their own role, edit a role above theirs, or edit the owner role; only the owner can
transfer ownership; an owner cannot delete their account while owning an active club.

## 4. Platform roles

| Spec role | Role | Scope |
| --- | --- | --- |
| Platform Super Admin | `SUPER_ADMIN` | All permissions, admin management |
| — | `SUPPORT` | Users/clubs read, limited support actions |
| — | `FINANCE` | Revenue, payments, refunds |
| — | `MODERATOR` | Content moderation |

Each admin route declares `requireAdminPermission('<perm>')`. Admin accounts are created only by
a super admin (or the `admin:create` CLI on the server for the first one), must enrol TOTP at first
login, and are suspended (sessions revoked) when someone leaves.

## 5. Infrastructure access

| Access | How | Who |
| --- | --- | --- |
| AWS console/CLI | IAM Identity Center (SSO) with MFA; no IAM user access keys; root locked with hardware MFA | Owner + named engineers |
| Production host | SSM Session Manager (logged), **no SSH** (daemon disabled, no key pairs) | On-call engineers |
| Database | No direct access in normal operation. Break-glass via SSM port forwarding with the read-only role, recorded in the incident/change log | On-call, with second-person approval |
| Secrets Manager | Read: the app host role (own environment only). Write: owner | — |
| Deploy | GitHub `production` environment with required reviewers; OIDC role usable only from that environment | Reviewers in CODEOWNERS |
| GitHub | 2FA required; branch protection on `main`; CODEOWNERS review for `security/**`, `infrastructure/**`, `.github/**`, auth and payments | — |

Access is reviewed quarterly and removed the same day someone leaves.

## 6. Decision: PostgreSQL Row-Level Security (RLS) — not adopted now

Tenant isolation is enforced in the application layer (`requireClubPermission` + `club_id`
filters in every query) and proven by `server/test/tenant-isolation.test.ts`. RLS was considered
as defence in depth. **Not adopted in this iteration** because: (a) Prisma uses a pooled
connection, so RLS needs a per-transaction `SET LOCAL app.club_id/user_id`, touching every query
path; (b) many queries legitimately span clubs (feeds, discovery, platform admin), requiring
policy bypasses that would weaken the benefit; (c) a wrong policy fails silently (empty results)
rather than loudly. Compensating controls: least-privilege `wt_app` role (no DDL, no audit/financial
edits), mandatory review checklist for new club routes, tenant-isolation tests in CI, authorization
denial alerting. **Revisit** when a second team writes database code, or before any SQL is
written outside Prisma's typed API.
