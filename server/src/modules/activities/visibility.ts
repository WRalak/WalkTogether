import { prisma } from '../../database/prisma';

/**
 * Who may view an activity:
 *  - the owner, always;
 *  - PUBLIC: anyone not blocked;
 *  - FOLLOWERS: accepted followers (social module) — never club admins by virtue of their role;
 *  - any visibility: active members of a club the owner explicitly shared it with.
 * Blocking (either direction) always hides.
 */
export async function canViewActivity(activity: { id: string; userId: string; visibility: string; status: string }, viewerId: string | undefined) {
  if (activity.status !== 'COMPLETED') return viewerId === activity.userId;
  if (viewerId === activity.userId) return true;
  if (viewerId) {
    const blocked = await prisma.userBlock.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: activity.userId }, { blockerId: activity.userId, blockedId: viewerId }] }, select: { blockerId: true } });
    if (blocked) return false;
  }
  if (activity.visibility === 'PUBLIC') return true;
  if (!viewerId) return false;
  if (activity.visibility === 'FOLLOWERS' && (await isFollower(viewerId, activity.userId))) return true;
  const shared = await prisma.activityClubShare.findFirst({
    where: { activityId: activity.id, club: { status: 'ACTIVE', memberships: { some: { userId: viewerId, status: 'ACTIVE' } } } },
    select: { clubId: true },
  });
  return !!shared;
}

export async function isFollower(followerId: string, followeeId: string) {
  const row = await prisma.follow.findUnique({ where: { followerId_followeeId: { followerId, followeeId } }, select: { status: true } });
  return row?.status === 'ACCEPTED';
}
