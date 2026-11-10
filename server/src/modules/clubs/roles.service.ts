import type { ClubPermissionKey } from '@walktogether/shared-types';
import { prisma, type Tx } from '../../database/prisma';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../shared/errors';
import { verifyPassword } from '../../shared/password';
import { audit, type AuditContext } from '../audit/audit.service';
import { requireWithinLimit } from '../subscriptions/entitlements.service';
import { isSubset, requireClubPermission } from './club-access';

/** Permissions every member holds; anything beyond these makes a role an "admin seat" for plan limits. */
export const BASIC_PERMISSIONS: ClubPermissionKey[] = ['club.view_private', 'members.view'];
export const isAdminRole = (perms: string[], isOwner = false) => !isOwner && perms.some((p) => !BASIC_PERMISSIONS.includes(p as ClubPermissionKey));

export async function countAdminSeats(clubId: string, tx: Tx = prisma) {
  const rows = await tx.clubMembership.findMany({
    where: { clubId, status: 'ACTIVE', role: { isOwner: false } },
    select: { role: { select: { permissions: { select: { permissionKey: true } } } } },
  });
  return rows.filter((r) => isAdminRole(r.role.permissions.map((p) => p.permissionKey))).length;
}

/** Enforces the plan's admin-seat limit when someone is about to gain an admin role. */
export async function assertAdminSeatAvailable(clubId: string, newRolePerms: string[], currentRolePerms: string[] = []) {
  if (!isAdminRole(newRolePerms) || isAdminRole(currentRolePerms)) return;
  await requireWithinLimit({ clubId }, 'club.max_admins', await countAdminSeats(clubId));
}

export async function createRole(clubId: string, actorId: string, input: { name: string; description?: string | null; permissions: ClubPermissionKey[] }, ctx: AuditContext) {
  const actor = await requireClubPermission(clubId, actorId, 'roles.manage');
  if (!actor.role?.isOwner && !isSubset(input.permissions, actor.permissions)) throw forbidden('You cannot create a role with permissions you do not hold', 'PRIVILEGE_ESCALATION');
  if (await prisma.clubRole.findUnique({ where: { clubId_name: { clubId, name: input.name } } })) throw conflict('A role with that name already exists', 'ROLE_EXISTS');
  return prisma.$transaction(async (tx) => {
    const role = await tx.clubRole.create({
      data: { clubId, name: input.name, description: input.description ?? null, permissions: { create: [...new Set(input.permissions)].map((permissionKey) => ({ permissionKey })) } },
      include: { permissions: true },
    });
    await audit({ actorType: 'USER', actorId, action: 'role.created', targetType: 'role', targetId: role.id, clubId, metadata: { name: role.name, permissions: input.permissions } }, ctx, tx);
    return role;
  });
}

export async function updateRole(clubId: string, roleId: string, actorId: string, input: { name?: string; description?: string | null; permissions?: ClubPermissionKey[] }, ctx: AuditContext) {
  const actor = await requireClubPermission(clubId, actorId, 'roles.manage');
  const role = await prisma.clubRole.findFirst({ where: { id: roleId, clubId }, include: { permissions: true } });
  if (!role) throw notFound('Role not found');
  if (role.isOwner) throw forbidden('The owner role cannot be edited', 'OWNER_PROTECTED');
  if (role.id === actor.role?.id) throw forbidden('You cannot edit your own role', 'SELF_ACTION');
  const current = role.permissions.map((p) => p.permissionKey);
  if (!actor.role?.isOwner) {
    // Non-owners may only edit roles they fully contain, and only grant what they hold.
    if (!isSubset(current, actor.permissions)) throw forbidden('You cannot edit a role with more permissions than you', 'INSUFFICIENT_RANK');
    if (input.permissions && !isSubset(input.permissions, actor.permissions)) throw forbidden('You cannot grant permissions you do not hold', 'PRIVILEGE_ESCALATION');
  }
  if (input.name && role.systemKey) throw badRequest('System roles cannot be renamed');
  if (input.permissions && isAdminRole(input.permissions) && !isAdminRole(current)) {
    const holders = await prisma.clubMembership.count({ where: { clubId, roleId, status: 'ACTIVE' } });
    if (holders) await requireWithinLimit({ clubId }, 'club.max_admins', (await countAdminSeats(clubId)) + holders - 1);
  }
  return prisma.$transaction(async (tx) => {
    await tx.clubRole.update({ where: { id: roleId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
    if (input.permissions) {
      await tx.clubRolePermission.deleteMany({ where: { roleId } });
      await tx.clubRolePermission.createMany({ data: [...new Set(input.permissions)].map((permissionKey) => ({ roleId, permissionKey })) });
    }
    await audit({ actorType: 'USER', actorId, action: 'role.updated', targetType: 'role', targetId: roleId, clubId, metadata: { from: current, to: input.permissions ?? current } }, ctx, tx);
    return tx.clubRole.findUniqueOrThrow({ where: { id: roleId }, include: { permissions: true } });
  });
}

export async function deleteRole(clubId: string, roleId: string, actorId: string, ctx: AuditContext) {
  const actor = await requireClubPermission(clubId, actorId, 'roles.manage');
  const role = await prisma.clubRole.findFirst({ where: { id: roleId, clubId }, include: { permissions: true, _count: { select: { memberships: true, invitations: true } } } });
  if (!role) throw notFound('Role not found');
  if (role.systemKey) throw forbidden('System roles cannot be deleted', 'SYSTEM_ROLE');
  if (!actor.role?.isOwner && !isSubset(role.permissions.map((p) => p.permissionKey), actor.permissions)) throw forbidden(undefined, 'INSUFFICIENT_RANK');
  if (role._count.memberships || role._count.invitations) throw conflict('Reassign members and invitations using this role first', 'ROLE_IN_USE');
  await prisma.$transaction(async (tx) => {
    await tx.clubRole.delete({ where: { id: roleId } });
    await audit({ actorType: 'USER', actorId, action: 'role.deleted', targetType: 'role', targetId: roleId, clubId, metadata: { name: role.name } }, ctx, tx);
  });
}

/**
 * Ownership transfer: only the current owner, re-authenticated by password when they have one.
 * The new owner must be an active member; the previous owner becomes a Club Administrator.
 */
export async function transferOwnership(clubId: string, actorId: string, membershipId: string, password: string | undefined, ctx: AuditContext) {
  const actor = await requireClubPermission(clubId, actorId, 'club.delete', { allowInactiveClub: true });
  if (!actor.role?.isOwner) throw forbidden('Only the owner can transfer ownership');
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  if (me.passwordHash && !(password && (await verifyPassword(me.passwordHash, password)))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  const target = await prisma.clubMembership.findFirst({ where: { id: membershipId, clubId } });
  if (!target) throw notFound('Membership not found');
  if (target.userId === actorId) throw badRequest('You already own this club');
  if (target.status !== 'ACTIVE') throw conflict('The new owner must be an active member', 'NOT_ACTIVE');
  const [ownerRole, adminRole] = await Promise.all([
    prisma.clubRole.findUniqueOrThrow({ where: { clubId_systemKey: { clubId, systemKey: 'OWNER' } } }),
    prisma.clubRole.findUniqueOrThrow({ where: { clubId_systemKey: { clubId, systemKey: 'ADMIN' } } }),
  ]);
  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({ where: { id: actor.membership!.id }, data: { roleId: adminRole.id } });
    await tx.clubMembership.update({ where: { id: target.id }, data: { roleId: ownerRole.id } });
    await tx.club.update({ where: { id: clubId }, data: { ownerId: target.userId } });
    await audit({ actorType: 'USER', actorId, action: 'club.ownership_transferred', targetType: 'club', targetId: clubId, clubId, metadata: { from: actorId, to: target.userId } }, ctx, tx);
  });
  return { ownerId: target.userId };
}
