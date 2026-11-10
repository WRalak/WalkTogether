import type { Prisma } from '@prisma/client';
import type { UpdateMeInput } from '@walktogether/validation';
import { prisma } from '../../database/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors';
import { audit, type AuditContext } from '../audit/audit.service';
import { issueEmailVerification } from '../auth/auth.service';
import { publicStats } from '../activities/stats.service';

const meInclude = { profile: true, privacySettings: true } satisfies Prisma.UserInclude;
type UserWithMe = Prisma.UserGetPayload<{ include: typeof meInclude }>;

export function serializeMe(u: UserWithMe) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    phone: u.phone,
    phoneVerified: !!u.phoneVerifiedAt,
    username: u.username,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    profile: u.profile && {
      displayName: u.profile.displayName,
      bio: u.profile.bio,
      avatarUrl: u.profile.avatarUrl,
      location: u.profile.location,
      countryCode: u.profile.countryCode,
      fitnessInterests: u.profile.fitnessInterests,
      preferredActivityTypes: u.profile.preferredActivityTypes,
    },
    privacy: u.privacySettings && {
      profileVisibility: u.privacySettings.profileVisibility,
      activityDefaultVisibility: u.privacySettings.activityDefaultVisibility,
      showClubs: u.privacySettings.showClubs,
      showStats: u.privacySettings.showStats,
      allowFollowRequests: u.privacySettings.allowFollowRequests,
      hideStartEndPoints: u.privacySettings.hideStartEndPoints,
      privacyZoneRadiusMeters: u.privacySettings.privacyZoneRadiusMeters,
    },
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: meInclude });
  if (!user || user.status === 'DELETED') throw notFound('User not found');
  return serializeMe(user);
}

export async function updateMe(userId: string, input: UpdateMeInput, ctx: AuditContext) {
  const { username, ...profile } = input;
  if (username) {
    const taken = await prisma.user.findFirst({ where: { username, id: { not: userId } }, select: { id: true } });
    if (taken) throw conflict('That username is already taken', 'USERNAME_TAKEN');
  }
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(username ? { username } : {}),
        profile: Object.keys(profile).length ? { update: profile } : undefined,
      },
      include: meInclude,
    });
    if (username) await audit({ actorType: 'USER', actorId: userId, action: 'user.username_changed', targetType: 'user', targetId: userId }, ctx, tx);
    return updated;
  });
  return serializeMe(user);
}

export async function changeEmail(userId: string, email: string, ctx: AuditContext) {
  const taken = await prisma.user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } });
  if (taken) throw conflict('That email is already in use', 'EMAIL_TAKEN');
  const send = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: null }, include: { profile: true } });
    await audit({ actorType: 'USER', actorId: userId, action: 'user.email_changed', targetType: 'user', targetId: userId }, ctx, tx);
    return issueEmailVerification(userId, email, u.profile?.displayName ?? u.username, tx);
  });
  await send();
}

export async function updatePrivacy(userId: string, data: Prisma.UserPrivacySettingsUpdateInput) {
  return prisma.userPrivacySettings.upsert({ where: { userId }, create: { userId, ...(data as object) }, update: data });
}

export async function getNotificationSettings(userId: string) {
  return prisma.userNotificationSettings.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateNotificationSettings(userId: string, data: Prisma.UserNotificationSettingsUpdateInput) {
  return prisma.userNotificationSettings.upsert({ where: { userId }, create: { userId, ...(data as object) }, update: data });
}

export async function registerDevice(userId: string, input: { pushToken: string; platform: 'ios' | 'android' | 'web'; deviceId?: string }) {
  // A push token belongs to exactly one user: re-registering moves it (e.g. account switch on a shared phone).
  return prisma.userDevice.upsert({
    where: { pushToken: input.pushToken },
    create: { userId, ...input },
    update: { userId, platform: input.platform, deviceId: input.deviceId, lastSeenAt: new Date() },
    select: { id: true, platform: true, lastSeenAt: true },
  });
}

export async function removeDevice(userId: string, deviceId: string) {
  const res = await prisma.userDevice.deleteMany({ where: { id: deviceId, userId } });
  if (!res.count) throw notFound('Device not found');
}

export async function isBlockedEitherWay(a: string, b: string) {
  const row = await prisma.userBlock.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { blockerId: true },
  });
  return !!row;
}

/**
 * Public profile with privacy enforcement. Blocked relationships return 404 so a blocked
 * user cannot even confirm the account exists.
 */
export async function getPublicProfile(username: string, viewerId?: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, include: meInclude });
  if (!user || user.status === 'DELETED' || user.status === 'PENDING_DELETION') throw notFound('User not found');
  if (viewerId && viewerId !== user.id && (await isBlockedEitherWay(viewerId, user.id))) throw notFound('User not found');

  const isSelf = viewerId === user.id;
  const privacy = user.privacySettings;
  // Follow relationships arrive in Phase 5; until then FOLLOWERS-only profiles are limited for everyone but the owner.
  const full = isSelf || privacy?.profileVisibility === 'PUBLIC';

  const base = {
    id: user.id,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    avatarUrl: user.profile?.avatarUrl ?? null,
    isPrivate: !full,
    suspended: user.status === 'SUSPENDED',
  };
  if (!full) return base;

  const showClubs = isSelf || privacy?.showClubs !== false;
  const clubs = showClubs
    ? await prisma.clubMembership.findMany({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          // Only reveal membership of PUBLIC clubs to others (private membership is club-private data).
          club: { status: 'ACTIVE', deletedAt: null, ...(isSelf ? {} : { visibility: 'PUBLIC' }) },
        },
        select: { club: { select: { id: true, slug: true, name: true, logoUrl: true } } },
        take: 50,
      })
    : [];

  return {
    ...base,
    bio: user.profile?.bio ?? null,
    location: user.profile?.location ?? null,
    countryCode: user.profile?.countryCode ?? null,
    fitnessInterests: user.profile?.fitnessInterests ?? [],
    preferredActivityTypes: user.profile?.preferredActivityTypes ?? [],
    joinedAt: user.createdAt.toISOString(),
    clubs: clubs.map((c) => c.club),
    stats: await publicStats(user.id),
  };
}

export async function blockUser(blockerId: string, blockedId: string) {
  if (blockerId === blockedId) throw badRequest('You cannot block yourself');
  const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true, status: true } });
  if (!target || target.status === 'DELETED') throw notFound('User not found');
  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
}

export async function listBlocked(userId: string) {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { createdAt: true, blocked: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
  });
  return rows.map((r) => ({ id: r.blocked.id, username: r.blocked.username, displayName: r.blocked.profile?.displayName, avatarUrl: r.blocked.profile?.avatarUrl, blockedAt: r.createdAt }));
}

/** Data-subject access / portability (Kenya DPA s.26, GDPR art. 15/20). */
export async function exportMyData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      profile: true,
      privacySettings: true,
      notificationSettings: true,
      oauthAccounts: { select: { provider: true, email: true, createdAt: true } },
      devices: { select: { platform: true, createdAt: true, lastSeenAt: true } },
      sessions: { select: { deviceName: true, platform: true, ipAddress: true, createdAt: true, lastUsedAt: true, revokedAt: true } },
      loginEvents: { select: { method: true, success: true, ipAddress: true, userAgent: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 500 },
      memberships: { select: { status: true, joinedAt: true, createdAt: true, club: { select: { name: true, slug: true } }, role: { select: { name: true } } } },
      blocking: { select: { blockedId: true, createdAt: true } },
      activities: { select: { id: true, type: true, title: true, startedAt: true, endedAt: true, distanceM: true, movingSeconds: true, visibility: true }, orderBy: { startedAt: 'desc' } },
      goals: true,
    },
  });
  const { passwordHash: _p, failedLoginCount: _f, lockedUntil: _l, ...rest } = user;
  return { exportedAt: new Date().toISOString(), account: rest };
}
