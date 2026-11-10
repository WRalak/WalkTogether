import type { MembershipStatus, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { hashToken, randomToken } from '../../shared/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { canSeeClub, isSubset, loadClubAccess, requireClubPermission, type ClubAccess } from '../clubs/club-access';

// ---------------------------------------------------------------------------
// Joining & leaving
// ---------------------------------------------------------------------------

async function memberRoleId(clubId: string) {
  const role = await prisma.clubRole.findUnique({ where: { clubId_systemKey: { clubId, systemKey: 'MEMBER' } }, select: { id: true } });
  if (!role) throw new Error(`Club ${clubId} is missing its MEMBER role`);
  return role.id;
}

async function resolveInvitation(clubId: string, code: string, userId: string) {
  const invitation = await prisma.clubInvitation.findUnique({ where: { codeHash: hashToken(code) } });
  const invalid = badRequest('This invitation is invalid or has expired');
  // An invitation for another club is indistinguishable from an invalid one.
  if (!invitation || invitation.clubId !== clubId || invitation.revokedAt || invitation.expiresAt < new Date() || invitation.useCount >= invitation.maxUses) {
    throw invalid;
  }
  if (invitation.email || invitation.phone) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } });
    const emailOk = invitation.email && user.emailVerifiedAt && user.email === invitation.email;
    const phoneOk = invitation.phone && user.phoneVerifiedAt && user.phone === invitation.phone;
    if (!emailOk && !phoneOk) throw forbidden('This invitation was issued to a different (verified) email address or phone number', 'INVITATION_RECIPIENT_MISMATCH');
  }
  return invitation;
}

export async function joinClub(clubId: string, userId: string, input: { invitationCode?: string; message?: string }, ctx: AuditContext) {
  const access = await loadClubAccess(clubId, userId);
  const invitation = input.invitationCode ? await resolveInvitation(clubId, input.invitationCode, userId) : null;

  // INVITE_ONLY clubs are invisible without a valid invitation.
  if (!invitation && !canSeeClub(access)) throw notFound('Club not found');
  if (access.club.status !== 'ACTIVE') throw forbidden('This club is not accepting members right now', 'CLUB_NOT_ACTIVE');

  const existing = access.membership;
  if (existing) {
    if (existing.status === 'ACTIVE') throw conflict('You are already a member of this club', 'ALREADY_MEMBER');
    if (existing.status === 'PENDING' && !invitation) throw conflict('Your membership request is already pending', 'REQUEST_PENDING');
    if (existing.status === 'BANNED') throw forbidden('You cannot join this club', 'BANNED');
    if (existing.status === 'SUSPENDED') throw forbidden('Your membership is suspended', 'MEMBERSHIP_SUSPENDED');
  }

  const club = await prisma.club.findUniqueOrThrow({ where: { id: clubId }, select: { visibility: true, requiresApproval: true } });
  let status: MembershipStatus;
  if (invitation) status = 'ACTIVE';
  else if (club.visibility === 'INVITE_ONLY') throw forbidden('An invitation is required to join this club', 'INVITATION_REQUIRED');
  else if (club.visibility === 'PRIVATE' || club.requiresApproval) status = 'PENDING';
  else status = 'ACTIVE';

  const roleId = invitation?.roleId ?? (await memberRoleId(clubId));
  const now = new Date();

  const membership = await prisma.$transaction(async (tx) => {
    if (invitation) {
      // Atomic use-count increment guards against concurrent over-redemption.
      const used = await tx.clubInvitation.updateMany({
        where: { id: invitation.id, useCount: { lt: invitation.maxUses }, revokedAt: null },
        data: { useCount: { increment: 1 } },
      });
      if (used.count !== 1) throw badRequest('This invitation is invalid or has expired');
    }
    const data = {
      roleId,
      status,
      requestMessage: input.message ?? null,
      invitationId: invitation?.id ?? null,
      joinedAt: status === 'ACTIVE' ? now : null,
      statusReason: null,
      reviewedAt: null,
      reviewedById: null,
    };
    const m = existing
      ? await tx.clubMembership.update({ where: { id: existing.id }, data })
      : await tx.clubMembership.create({ data: { clubId, userId, ...data } });
    if (status === 'ACTIVE') await tx.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } });
    await audit(
      { actorType: 'USER', actorId: userId, action: status === 'ACTIVE' ? 'membership.joined' : 'membership.requested', targetType: 'membership', targetId: m.id, clubId, metadata: invitation ? { invitationId: invitation.id } : {} },
      ctx,
      tx,
    );
    return m;
  });
  return { membershipId: membership.id, status: membership.status };
}

export async function leaveClub(clubId: string, userId: string, ctx: AuditContext) {
  const access = await loadClubAccess(clubId, userId);
  const m = access.membership;
  if (!m || !['ACTIVE', 'PENDING'].includes(m.status)) throw notFound('You are not a member of this club');
  if (access.club.ownerId === userId) throw conflict('Transfer club ownership before leaving', 'OWNER_MUST_TRANSFER');
  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({ where: { id: m.id }, data: { status: 'LEFT' } });
    if (m.status === 'ACTIVE') await tx.club.update({ where: { id: clubId }, data: { memberCount: { decrement: 1 } } });
    await audit({ actorType: 'USER', actorId: userId, action: 'membership.left', targetType: 'membership', targetId: m.id, clubId }, ctx, tx);
  });
}

export async function listMyClubs(userId: string) {
  const rows = await prisma.clubMembership.findMany({
    where: { userId, status: { in: ['ACTIVE', 'PENDING'] }, club: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      status: true,
      joinedAt: true,
      role: { select: { name: true, systemKey: true, permissions: { select: { permissionKey: true } } } },
      club: { select: { id: true, slug: true, name: true, logoUrl: true, status: true, visibility: true, memberCount: true } },
    },
  });
  return rows.map((r) => ({
    ...r.club,
    membershipStatus: r.status,
    joinedAt: r.joinedAt,
    role: r.role.name,
    roleKey: r.role.systemKey,
    // Pending members hold no permissions until approved.
    permissions: r.status === 'ACTIVE' ? r.role.permissions.map((p) => p.permissionKey) : [],
  }));
}

// ---------------------------------------------------------------------------
// Member administration (all scoped by clubId taken from the route)
// ---------------------------------------------------------------------------

export interface ListMembersQuery {
  cursor?: string;
  limit: number;
  q?: string;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  roleId?: string;
}

export async function listMembers(clubId: string, userId: string, query: ListMembersQuery) {
  const status = query.status ?? 'ACTIVE';
  const permission = status === 'PENDING' ? 'members.approve' : status === 'SUSPENDED' ? 'members.suspend' : 'members.view';
  await requireClubPermission(clubId, userId, permission, { allowInactiveClub: true });

  const cursor = decodeCursor(query.cursor);
  const where: Prisma.ClubMembershipWhereInput = {
    clubId, // tenant scope — always from the route, never from the client body
    status,
    ...(query.roleId ? { roleId: query.roleId } : {}),
    ...(query.q
      ? {
          user: {
            OR: [
              { username: { contains: query.q.toLowerCase() } },
              { profile: { displayName: { contains: query.q, mode: 'insensitive' } } },
            ],
          },
        }
      : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
  };
  const rows = await prisma.clubMembership.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: {
      id: true,
      status: true,
      joinedAt: true,
      createdAt: true,
      requestMessage: true,
      statusReason: true,
      role: { select: { id: true, name: true, systemKey: true } },
      user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((m) => ({
      membershipId: m.id,
      status: m.status,
      joinedAt: m.joinedAt,
      requestedAt: m.createdAt,
      requestMessage: m.status === 'PENDING' ? m.requestMessage : undefined,
      statusReason: m.statusReason,
      role: m.role,
      user: { id: m.user.id, username: m.user.username, displayName: m.user.profile?.displayName ?? m.user.username, avatarUrl: m.user.profile?.avatarUrl ?? null },
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

/** Loads a membership *within* the given club. A membership id from another club yields 404 (IDOR guard). */
async function loadTargetMembership(clubId: string, membershipId: string) {
  const target = await prisma.clubMembership.findFirst({
    where: { id: membershipId, clubId },
    include: { role: { include: { permissions: { select: { permissionKey: true } } } } },
  });
  if (!target) throw notFound('Membership not found');
  return target;
}

/**
 * Hierarchy guard: an actor may only act on members whose current permissions are a subset of
 * the actor's own, may never act on the owner, and may never act on themselves.
 */
function assertCanManage(actor: ClubAccess, actorId: string, target: Awaited<ReturnType<typeof loadTargetMembership>>) {
  if (target.userId === actorId) throw forbidden('You cannot perform this action on your own membership', 'SELF_ACTION');
  if (target.role.isOwner) throw forbidden('The club owner cannot be modified', 'OWNER_PROTECTED');
  if (!actor.role?.isOwner && !isSubset(target.role.permissions.map((p) => p.permissionKey), actor.permissions)) {
    throw forbidden('You cannot manage a member with more permissions than you', 'INSUFFICIENT_RANK');
  }
}

export async function reviewMembership(clubId: string, membershipId: string, actorId: string, decision: 'APPROVE' | 'REJECT', reason: string | undefined, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'members.approve');
  const target = await loadTargetMembership(clubId, membershipId);
  if (target.status !== 'PENDING') throw conflict('This membership request is not pending', 'NOT_PENDING');
  const approved = decision === 'APPROVE';
  await prisma.$transaction(async (tx) => {
    const updated = await tx.clubMembership.updateMany({
      where: { id: target.id, clubId, status: 'PENDING' },
      data: { status: approved ? 'ACTIVE' : 'REJECTED', reviewedById: actorId, reviewedAt: new Date(), joinedAt: approved ? new Date() : null, statusReason: reason ?? null },
    });
    if (updated.count !== 1) throw conflict('This membership request is not pending', 'NOT_PENDING');
    if (approved) await tx.club.update({ where: { id: clubId }, data: { memberCount: { increment: 1 } } });
    await audit({ actorType: 'USER', actorId, action: approved ? 'membership.approved' : 'membership.rejected', targetType: 'membership', targetId: target.id, clubId, metadata: { userId: target.userId } }, ctx, tx);
  });
  return { membershipId: target.id, status: approved ? 'ACTIVE' : 'REJECTED' };
}

export async function assignRole(clubId: string, membershipId: string, actorId: string, roleId: string, ctx: AuditContext) {
  const actor = await requireClubPermission(clubId, actorId, 'members.roles.assign');
  const target = await loadTargetMembership(clubId, membershipId);
  assertCanManage(actor, actorId, target);
  if (target.status !== 'ACTIVE') throw conflict('Only active members can be assigned roles', 'NOT_ACTIVE');

  // The role must belong to the same club (a role id from another club is "not found").
  const role = await prisma.clubRole.findFirst({ where: { id: roleId, clubId }, include: { permissions: { select: { permissionKey: true } } } });
  if (!role) throw notFound('Role not found');
  if (role.isOwner) throw forbidden('Ownership must be transferred, not assigned', 'OWNER_ROLE_NOT_ASSIGNABLE');
  if (!actor.role?.isOwner && !isSubset(role.permissions.map((p) => p.permissionKey), actor.permissions)) {
    throw forbidden('You cannot assign a role with more permissions than your own', 'PRIVILEGE_ESCALATION');
  }
  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({ where: { id: target.id }, data: { roleId: role.id } });
    await audit({ actorType: 'USER', actorId, action: 'membership.role_assigned', targetType: 'membership', targetId: target.id, clubId, metadata: { userId: target.userId, from: target.roleId, to: role.id } }, ctx, tx);
  });
  return { membershipId: target.id, roleId: role.id, role: role.name };
}

export async function moderateMember(clubId: string, membershipId: string, actorId: string, action: 'SUSPEND' | 'REINSTATE' | 'REMOVE' | 'BAN', reason: string | undefined, ctx: AuditContext) {
  const permission = action === 'SUSPEND' || action === 'REINSTATE' ? 'members.suspend' : 'members.remove';
  const actor = await requireClubPermission(clubId, actorId, permission);
  const target = await loadTargetMembership(clubId, membershipId);
  assertCanManage(actor, actorId, target);

  const transitions: Record<typeof action, { from: MembershipStatus[]; to: MembershipStatus }> = {
    SUSPEND: { from: ['ACTIVE'], to: 'SUSPENDED' },
    REINSTATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
    REMOVE: { from: ['ACTIVE', 'SUSPENDED', 'PENDING'], to: 'REMOVED' },
    BAN: { from: ['ACTIVE', 'SUSPENDED', 'PENDING', 'LEFT', 'REMOVED', 'REJECTED'], to: 'BANNED' },
  };
  const t = transitions[action];
  if (!t.from.includes(target.status)) throw conflict(`Cannot ${action.toLowerCase()} a member whose status is ${target.status}`, 'INVALID_TRANSITION');

  const wasActive = target.status === 'ACTIVE';
  const isActive = t.to === 'ACTIVE';
  await prisma.$transaction(async (tx) => {
    await tx.clubMembership.update({ where: { id: target.id }, data: { status: t.to, statusReason: reason ?? null, reviewedById: actorId, reviewedAt: new Date() } });
    if (wasActive !== isActive) await tx.club.update({ where: { id: clubId }, data: { memberCount: { increment: isActive ? 1 : -1 } } });
    await audit({ actorType: 'USER', actorId, action: `membership.${action.toLowerCase()}`, targetType: 'membership', targetId: target.id, clubId, metadata: { userId: target.userId, reason } }, ctx, tx);
  });
  return { membershipId: target.id, status: t.to };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function createInvitation(
  clubId: string,
  actorId: string,
  input: { email?: string; phone?: string; roleId?: string; maxUses: number; expiresInDays: number },
  ctx: AuditContext,
) {
  let actor = await loadClubAccess(clubId, actorId);
  if (!canSeeClub(actor)) throw notFound('Club not found');
  if (!actor.permissions.has('members.invite')) {
    // Clubs may let ordinary members invite friends, but only into the default MEMBER role.
    const settings = await prisma.clubSettings.findUnique({ where: { clubId }, select: { allowMemberInvites: true } });
    if (!(actor.isActiveMember && settings?.allowMemberInvites && !input.roleId)) {
      actor = await requireClubPermission(clubId, actorId, 'members.invite');
    }
  }
  if (actor.club.status !== 'ACTIVE') throw forbidden('This club is not active', 'CLUB_NOT_ACTIVE');

  if (input.roleId) {
    const role = await prisma.clubRole.findFirst({ where: { id: input.roleId, clubId }, include: { permissions: { select: { permissionKey: true } } } });
    if (!role) throw notFound('Role not found');
    if (role.isOwner) throw forbidden('Ownership cannot be granted by invitation', 'OWNER_ROLE_NOT_ASSIGNABLE');
    if (!actor.role?.isOwner && !isSubset(role.permissions.map((p) => p.permissionKey), actor.permissions)) {
      throw forbidden('You cannot invite people into a role with more permissions than your own', 'PRIVILEGE_ESCALATION');
    }
    if (!actor.permissions.has('members.roles.assign')) throw forbidden('You cannot invite people into a specific role');
  }

  const code = randomToken(12);
  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.clubInvitation.create({
      data: {
        clubId,
        codeHash: hashToken(code),
        codeHint: code.slice(0, 4),
        email: input.email,
        phone: input.phone,
        roleId: input.roleId,
        maxUses: input.maxUses,
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 3600_000),
        createdById: actorId,
      },
    });
    await audit({ actorType: 'USER', actorId, action: 'invitation.created', targetType: 'invitation', targetId: inv.id, clubId, metadata: { maxUses: input.maxUses, roleId: input.roleId ?? null } }, ctx, tx);
    return inv;
  });
  // The plain code is returned exactly once; only its hash is stored.
  return { id: invitation.id, code, expiresAt: invitation.expiresAt, maxUses: invitation.maxUses, clubId };
}

export async function listInvitations(clubId: string, actorId: string) {
  await requireClubPermission(clubId, actorId, 'members.invite', { allowInactiveClub: true });
  return prisma.clubInvitation.findMany({
    where: { clubId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, codeHint: true, email: true, phone: true, roleId: true, maxUses: true, useCount: true, expiresAt: true, revokedAt: true, createdAt: true, createdById: true },
  });
}

export async function revokeInvitation(clubId: string, invitationId: string, actorId: string, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'members.invite', { allowInactiveClub: true });
  const res = await prisma.clubInvitation.updateMany({ where: { id: invitationId, clubId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!res.count) throw notFound('Invitation not found');
  await audit({ actorType: 'USER', actorId, action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, clubId }, ctx);
}

/** Lets a prospective member preview which club an invitation code belongs to before joining. */
export async function previewInvitation(code: string) {
  const inv = await prisma.clubInvitation.findUnique({
    where: { codeHash: hashToken(code) },
    select: { expiresAt: true, revokedAt: true, useCount: true, maxUses: true, club: { select: { id: true, slug: true, name: true, logoUrl: true, status: true, deletedAt: true } } },
  });
  if (!inv || inv.revokedAt || inv.expiresAt < new Date() || inv.useCount >= inv.maxUses || inv.club.status !== 'ACTIVE' || inv.club.deletedAt) {
    throw notFound('Invitation not found or expired');
  }
  const { status: _s, deletedAt: _d, ...club } = inv.club;
  return { club, expiresAt: inv.expiresAt };
}
