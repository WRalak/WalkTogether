import type { ClubPermissionKey } from '@walktogether/shared-types';
import { prisma } from '../../database/prisma';
import { forbidden, notFound } from '../../shared/errors';

/**
 * Central tenant-authorization primitive.
 *
 * Every club-scoped operation resolves the club from the route (never from a body field),
 * then resolves the *caller's* membership in *that* club on the server. Permissions are the
 * union of the permissions on the caller's role in that club and nothing else: a role in
 * club A never grants anything in club B.
 */
export interface ClubAccess {
  club: {
    id: string;
    slug: string;
    status: 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED' | 'ARCHIVED';
    visibility: 'PUBLIC' | 'PRIVATE' | 'INVITE_ONLY';
    ownerId: string;
  };
  membership: { id: string; status: string; roleId: string } | null;
  role: { id: string; name: string; systemKey: string | null; isOwner: boolean } | null;
  permissions: Set<ClubPermissionKey>;
  isActiveMember: boolean;
}

export async function loadClubAccess(clubId: string, userId: string | undefined): Promise<ClubAccess> {
  const club = await prisma.club.findFirst({
    where: { id: clubId, deletedAt: null },
    select: { id: true, slug: true, status: true, visibility: true, ownerId: true },
  });
  if (!club) throw notFound('Club not found');

  if (!userId) return { club, membership: null, role: null, permissions: new Set(), isActiveMember: false };

  const membership = await prisma.clubMembership.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: {
      id: true,
      status: true,
      roleId: true,
      role: { select: { id: true, name: true, systemKey: true, isOwner: true, permissions: { select: { permissionKey: true } } } },
    },
  });
  const isActiveMember = membership?.status === 'ACTIVE';
  const permissions = new Set<ClubPermissionKey>(isActiveMember ? membership!.role.permissions.map((p) => p.permissionKey as ClubPermissionKey) : []);
  return {
    club,
    membership: membership ? { id: membership.id, status: membership.status, roleId: membership.roleId } : null,
    role: isActiveMember ? { id: membership!.role.id, name: membership!.role.name, systemKey: membership!.role.systemKey, isOwner: membership!.role.isOwner } : null,
    permissions,
    isActiveMember,
  };
}

/** Whether the club's existence/profile may be revealed to this caller. */
export function canSeeClub(access: ClubAccess, platformVisible = true): boolean {
  if (access.isActiveMember) return true;
  if (access.club.status !== 'ACTIVE') return false;
  if (access.club.visibility === 'INVITE_ONLY') return access.membership?.status === 'PENDING';
  return platformVisible;
}

/**
 * Loads access and asserts a permission. Callers who cannot see the club get 404 (not 403),
 * so club ids cannot be probed. Mutations on suspended/archived clubs are refused.
 */
export async function requireClubPermission(clubId: string, userId: string, permission: ClubPermissionKey, opts: { allowInactiveClub?: boolean } = {}): Promise<ClubAccess> {
  const access = await loadClubAccess(clubId, userId);
  if (!canSeeClub(access)) throw notFound('Club not found');
  if (!access.permissions.has(permission)) throw forbidden();
  if (!opts.allowInactiveClub && access.club.status !== 'ACTIVE') {
    throw forbidden('This club is not active', 'CLUB_NOT_ACTIVE');
  }
  return access;
}

/** True when every permission in `subset` is held in `superset`. Used to prevent privilege escalation. */
export function isSubset(subset: Iterable<string>, superset: Set<string>) {
  for (const p of subset) if (!superset.has(p)) return false;
  return true;
}
