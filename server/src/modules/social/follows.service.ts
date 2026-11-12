import { prisma } from '../../database/prisma';
import { badRequest, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { notify } from '../notifications/notifications.service';
import { isBlockedEitherWay } from '../users/users.service';

export async function follow(followerId: string, followeeId: string) {
  if (followerId === followeeId) throw badRequest('You cannot follow yourself');
  const target = await prisma.user.findUnique({ where: { id: followeeId }, include: { privacySettings: true, profile: true } });
  if (!target || target.status !== 'ACTIVE' || (await isBlockedEitherWay(followerId, followeeId))) throw notFound('User not found');
  const existing = await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId, followeeId } } });
  if (existing) return { status: existing.status };
  const needsApproval = target.privacySettings?.profileVisibility !== 'PUBLIC';
  if (needsApproval && target.privacySettings?.allowFollowRequests === false) throw forbidden('This person is not accepting follow requests', 'FOLLOW_REQUESTS_OFF');
  const status = needsApproval ? 'PENDING' : 'ACCEPTED';
  await prisma.follow.create({ data: { followerId, followeeId, status } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: followerId }, include: { profile: true } });
  await notify({
    userIds: [followeeId],
    type: 'follow.new',
    title: status === 'PENDING' ? 'New follow request' : 'New follower',
    body: `${me.profile?.displayName ?? me.username} ${status === 'PENDING' ? 'wants to follow you' : 'started following you'}`,
    data: { userId: followerId, username: me.username },
  });
  return { status };
}

export async function unfollow(followerId: string, followeeId: string) {
  await prisma.follow.deleteMany({ where: { followerId, followeeId } });
}

export async function respondToRequest(followeeId: string, followerId: string, accept: boolean) {
  const row = await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId, followeeId } } });
  if (!row || row.status !== 'PENDING') throw notFound('Follow request not found');
  if (accept) await prisma.follow.update({ where: { followerId_followeeId: { followerId, followeeId } }, data: { status: 'ACCEPTED' } });
  else await prisma.follow.delete({ where: { followerId_followeeId: { followerId, followeeId } } });
}

/** Removing a follower (e.g. after switching to private). */
export async function removeFollower(followeeId: string, followerId: string) {
  await prisma.follow.deleteMany({ where: { followerId, followeeId } });
}

const userSelect = { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } as const;

export async function listFollows(userId: string, viewerId: string | undefined, direction: 'followers' | 'following', q: { cursor?: string; limit: number }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { privacySettings: true } });
  if (!user || user.status === 'DELETED' || (viewerId && (await isBlockedEitherWay(viewerId, userId)))) throw notFound('User not found');
  if (viewerId !== userId && user.privacySettings?.profileVisibility !== 'PUBLIC') {
    const accepted = viewerId ? await prisma.follow.findFirst({ where: { followerId: viewerId, followeeId: userId, status: 'ACCEPTED' } }) : null;
    if (!accepted) throw forbidden('This account is private', 'PRIVATE_ACCOUNT');
  }
  const cursor = decodeCursor(q.cursor);
  const where = direction === 'followers' ? { followeeId: userId, status: 'ACCEPTED' as const } : { followerId: userId, status: 'ACCEPTED' as const };
  const rows = await prisma.follow.findMany({
    where: {
      ...where,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, [direction === 'followers' ? 'followerId' : 'followeeId']: { lt: cursor.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { [direction === 'followers' ? 'followerId' : 'followeeId']: 'desc' }],
    take: q.limit + 1,
    select: { createdAt: true, follower: { select: userSelect }, followee: { select: userSelect } },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit).map((r) => ({ ...(direction === 'followers' ? r.follower : r.followee), since: r.createdAt }));
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.since, id: last.id }) : null };
}

export async function pendingRequests(userId: string) {
  const rows = await prisma.follow.findMany({
    where: { followeeId: userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { createdAt: true, follower: { select: userSelect } },
  });
  return rows.map((r) => ({ ...r.follower, requestedAt: r.createdAt }));
}

export async function followCounts(userId: string) {
  const [followers, following] = await Promise.all([
    prisma.follow.count({ where: { followeeId: userId, status: 'ACCEPTED' } }),
    prisma.follow.count({ where: { followerId: userId, status: 'ACCEPTED' } }),
  ]);
  return { followers, following };
}
