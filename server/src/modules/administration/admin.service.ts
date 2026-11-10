import type { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { conflict, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { revokeSessions } from '../auth/auth.service';

const DAY = 24 * 3600_000;

export async function platformOverview() {
  const now = Date.now();
  const [totalUsers, activeUsers30d, newUsers7d, suspendedUsers, totalClubs, activeClubs, pendingClubs, suspendedClubs, activeMemberships] = await Promise.all([
    prisma.user.count({ where: { status: { not: 'DELETED' } } }),
    prisma.user.count({ where: { status: 'ACTIVE', lastLoginAt: { gte: new Date(now - 30 * DAY) } } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.club.count({ where: { deletedAt: null } }),
    prisma.club.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.club.count({ where: { deletedAt: null, status: 'PENDING_APPROVAL' } }),
    prisma.club.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    prisma.clubMembership.count({ where: { status: 'ACTIVE' } }),
  ]);
  return {
    users: { total: totalUsers, active30d: activeUsers30d, new7d: newUsers7d, suspended: suspendedUsers },
    clubs: { total: totalClubs, active: activeClubs, pendingApproval: pendingClubs, suspended: suspendedClubs },
    memberships: { active: activeMemberships },
    // Revenue, subscription, activity and challenge metrics are added with their phases (see DEVELOPMENT_STATUS.md).
    generatedAt: new Date().toISOString(),
  };
}

export async function listUsers(query: { cursor?: string; limit: number; q?: string; status?: Prisma.EnumUserStatusFilter['equals'] }) {
  const cursor = decodeCursor(query.cursor);
  const q = query.q?.trim();
  const where: Prisma.UserWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q.toLowerCase() } },
            { username: { contains: q.toLowerCase() } },
            { phone: { contains: q } },
            { profile: { displayName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : {}),
  };
  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: {
      id: true, email: true, phone: true, username: true, status: true, createdAt: true, lastLoginAt: true,
      emailVerifiedAt: true, phoneVerifiedAt: true,
      profile: { select: { displayName: true } },
      _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
    },
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return {
    items: items.map((u) => ({
      id: u.id, email: u.email, phone: u.phone, username: u.username, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      emailVerified: !!u.emailVerifiedAt, phoneVerified: !!u.phoneVerifiedAt, displayName: u.profile?.displayName ?? null, clubCount: u._count.memberships,
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, phone: true, username: true, status: true, createdAt: true, lastLoginAt: true, suspendedAt: true, suspensionReason: true,
      emailVerifiedAt: true, phoneVerifiedAt: true, deletionScheduledAt: true,
      profile: { select: { displayName: true, location: true, countryCode: true } },
      memberships: { select: { status: true, joinedAt: true, role: { select: { name: true } }, club: { select: { id: true, name: true, slug: true } } }, take: 100 },
      loginEvents: { orderBy: { createdAt: 'desc' }, take: 20, select: { method: true, success: true, suspicious: true, ipAddress: true, createdAt: true, failureReason: true } },
      oauthAccounts: { select: { provider: true } },
    },
  });
  if (!user) throw notFound('User not found');
  return user;
}

export async function changeUserStatus(adminId: string, userId: string, action: 'SUSPEND' | 'REACTIVATE', reason: string, ctx: AuditContext) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) throw notFound('User not found');
  if (action === 'SUSPEND' && user.status !== 'ACTIVE') throw conflict('Only active users can be suspended', 'INVALID_TRANSITION');
  if (action === 'REACTIVATE' && user.status !== 'SUSPENDED') throw conflict('Only suspended users can be reactivated', 'INVALID_TRANSITION');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: action === 'SUSPEND' ? { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason } : { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    });
    if (action === 'SUSPEND') await revokeSessions({ userId }, 'account_suspended', tx);
    await audit({ actorType: 'ADMIN', actorId: adminId, action: action === 'SUSPEND' ? 'admin.user_suspended' : 'admin.user_reactivated', targetType: 'user', targetId: userId, metadata: { reason } }, ctx, tx);
  });
  return getUser(userId);
}

export async function listClubs(query: { cursor?: string; limit: number; q?: string; status?: Prisma.EnumClubStatusFilter['equals'] }) {
  const cursor = decodeCursor(query.cursor);
  const where: Prisma.ClubWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q.toLowerCase() } }] } : {}),
    ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : {}),
  };
  const rows = await prisma.club.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: {
      id: true, slug: true, name: true, status: true, visibility: true, category: true, city: true, countryCode: true, memberCount: true, createdAt: true,
      owner: { select: { id: true, username: true } },
    },
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function getClub(clubId: string) {
  const club = await prisma.club.findFirst({
    where: { id: clubId, deletedAt: null },
    include: { owner: { select: { id: true, username: true, email: true } }, settings: true, _count: { select: { memberships: true, invitations: true } } },
  });
  if (!club) throw notFound('Club not found');
  const membershipBreakdown = await prisma.clubMembership.groupBy({ by: ['status'], where: { clubId }, _count: true });
  return { ...club, membershipBreakdown: Object.fromEntries(membershipBreakdown.map((m) => [m.status, m._count])) };
}

export async function changeClubStatus(adminId: string, clubId: string, action: 'SUSPEND' | 'REACTIVATE' | 'APPROVE', reason: string, ctx: AuditContext) {
  const club = await prisma.club.findFirst({ where: { id: clubId, deletedAt: null }, select: { status: true } });
  if (!club) throw notFound('Club not found');
  const allowed: Record<typeof action, string[]> = { SUSPEND: ['ACTIVE', 'PENDING_APPROVAL'], REACTIVATE: ['SUSPENDED'], APPROVE: ['PENDING_APPROVAL'] };
  if (!allowed[action].includes(club.status)) throw conflict(`Cannot ${action.toLowerCase()} a club whose status is ${club.status}`, 'INVALID_TRANSITION');
  await prisma.$transaction(async (tx) => {
    await tx.club.update({
      where: { id: clubId },
      data: action === 'SUSPEND' ? { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason } : { status: 'ACTIVE', suspendedAt: null, suspensionReason: null },
    });
    await audit({ actorType: 'ADMIN', actorId: adminId, action: `admin.club_${action.toLowerCase()}`, targetType: 'club', targetId: clubId, clubId, metadata: { reason } }, ctx, tx);
  });
  return getClub(clubId);
}

export async function listAuditLogs(query: { cursor?: string; limit: number; actorType?: 'ADMIN' | 'USER' | 'SYSTEM'; action?: string; targetType?: string; targetId?: string }) {
  const cursor = decodeCursor(query.cursor);
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function listSettings() {
  return prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
}

export async function upsertSetting(adminId: string, key: string, value: Prisma.InputJsonValue, description: string | undefined, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.platformSetting.findUnique({ where: { key } });
    const row = await tx.platformSetting.upsert({ where: { key }, create: { key, value, description, updatedById: adminId }, update: { value, description, updatedById: adminId } });
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.setting_updated', targetType: 'platform_setting', targetId: key, metadata: { from: (before?.value ?? null) as Prisma.InputJsonValue, to: value } }, ctx, tx);
    return row;
  });
}

export async function listFeatureFlags() {
  return prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
}

export async function upsertFeatureFlag(adminId: string, key: string, data: { enabled: boolean; rolloutPercentage: number; description?: string }, ctx: AuditContext) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.featureFlag.upsert({ where: { key }, create: { key, ...data, updatedById: adminId }, update: { ...data, updatedById: adminId } });
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.feature_flag_updated', targetType: 'feature_flag', targetId: key, metadata: data }, ctx, tx);
    return row;
  });
}
