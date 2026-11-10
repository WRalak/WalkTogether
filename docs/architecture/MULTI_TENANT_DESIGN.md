# Multi-Tenant Design

WalkTogether is multi-tenant from day one. **A tenant is a club.** Users are global identities that can
hold memberships in many clubs, each with a different role. The pilot walking club is simply the first
row in `clubs`; nothing in code or schema refers to it.

## 1. Tenancy model

```
User ──< ClubMembership >── Club ──< ClubRole ──< ClubRolePermission >── ClubPermission (global catalogue)
             │  status, roleId           │
             └── role must belong to the SAME club (composite FK)
```

* **Shared database, shared schema, row-level tenant key** (`club_id`) on every club-scoped table.
  This scales to thousands of clubs without per-tenant schema management.
* **Roles are per club.** Each new club receives copies of the system roles (Owner, Club
  Administrator, Event Organizer, Moderator, Member) with default permission sets defined in
  `@walktogether/shared-types`. Clubs may tailor non-owner roles; the Owner role always holds all
  permissions and exactly one Owner role exists per club (partial unique index).
* **Composite foreign keys** `(role_id, club_id) → club_roles(id, club_id)` on memberships and
  invitations make it *impossible at the database level* to attach a role from club A to a membership in
  club B.

## 2. Authorization flow

All club-scoped operations go through `server/src/modules/clubs/club-access.ts`:

```ts
const access = await requireClubPermission(clubIdFromRoute, authenticatedUserId, 'members.approve');
```

1. The club id comes from the **route** (`/clubs/:clubId/...`). Request bodies never carry a club id
   that is trusted.
2. The caller's membership is loaded **server-side** for that club. Only `ACTIVE` memberships grant
   permissions; `PENDING`, `SUSPENDED`, `BANNED`, `LEFT`, `REMOVED` grant none.
3. Visibility: if the caller cannot see the club (e.g. an `INVITE_ONLY` club they are not in, or a
   suspended club) the response is **404**, indistinguishable from a non-existent club. If they can
   see it but lack the permission, **403**.
4. Mutations on non-ACTIVE clubs (suspended/pending/archived) are refused with `CLUB_NOT_ACTIVE`.
5. Every sub-resource is loaded **scoped by the club**: `findFirst({ where: { id: membershipId, clubId } })`.
   A membership/invitation/role id from another club yields 404 (IDOR guard).

### Role hierarchy and privilege escalation

* Nobody can be assigned the Owner role (ownership transfer is a dedicated, future flow).
* The Owner cannot be modified, demoted, suspended or removed by anyone.
* Members cannot act on their own membership (`SELF_ACTION`).
* An actor may only manage members whose current permissions are a **subset** of the actor's own.
* An actor may only grant a role (directly or through an invitation) whose permissions are a subset of
  their own (`PRIVILEGE_ESCALATION`).

### Separation of planes

| Plane | Identity | Token secret / audience | Can access |
| --- | --- | --- | --- |
| Member (incl. club admins) | `users` | `JWT_ACCESS_SECRET`, `walktogether:member` | Own data; clubs per membership permissions |
| Platform admin | `admin_users` (separate table) | `JWT_ADMIN_SECRET`, `walktogether:platform-admin` | Platform management per admin role |

A club owner's token is rejected by every `/platform-admin` route, and an admin token is rejected by
member routes. Platform admins act on clubs through audited platform endpoints, not by impersonating
members. Support impersonation is intentionally not implemented; if added it requires explicit
authorisation, audit logging and a visible indicator.

## 3. Personal data vs club data

| Data | Owner | Club access |
| --- | --- | --- |
| Profile, privacy settings | User | Display name/avatar of members, nothing else |
| Activities and GPS points (Phase 3) | User | Only via explicit `ActivityVisibility`/share rows that the user creates; revocable |
| Membership, role, attendance at club events | Club + user | Club admins with permission |
| Club analytics | Club | Aggregates only; never raw routes |

Leaving a club, being removed, or a club's subscription lapsing never deletes or hides a user's own
activities. A club subscription never grants members individual premium features (see
`MONETIZATION_DESIGN.md`).

## 4. Discovery and visibility

| Visibility | Listed in discovery | Detail page | Join |
| --- | --- | --- | --- |
| `PUBLIC` | Yes | Full public profile, indexable | Instant, or request if `requiresApproval` |
| `PRIVATE` | Yes | Minimal profile, `noindex`, contacts hidden | Request → admin approval, or invitation |
| `INVITE_ONLY` | Never | 404 to non-members | Invitation code only |

Invitation codes are random 96-bit values shown once; only an HMAC hash is stored. Codes can be bound
to a verified email/phone, limited in uses (atomic counter) and expiry, and revoked.

## 5. Verification (tests)

`server/test/tenant-isolation.test.ts` proves, against a real database:

* an admin of club A cannot list, approve, moderate, re-role, invite into, or update club B;
* membership ids and role ids from another club are rejected (IDOR);
* the database itself rejects a cross-club role assignment;
* invite-only clubs return the same 404 as non-existent ids;
* ordinary members, event organizers and moderators cannot exceed their permissions;
* the Owner role cannot be assigned and the owner cannot be modified;
* suspended members and suspended clubs lose capabilities immediately;
* member tokens (even club owners) cannot reach platform-admin endpoints.

Every new club-scoped module must add equivalent tests before merge.

## 6. Checklist for new club-scoped features

1. Route shape `/clubs/:clubId/<resource>` (or resolve the club from the resource on the server).
2. First line of the service: `requireClubPermission(clubId, userId, '<permission>')`.
3. Load sub-resources with `where: { id, clubId }`.
4. Add the permission to `CLUB_PERMISSIONS` + defaults; the catalogue syncs on start-up.
5. Add `club_id` + a composite index; add composite FKs where a row references another club-scoped row.
6. Audit sensitive mutations with `clubId` set.
7. Add tenant-isolation tests.
