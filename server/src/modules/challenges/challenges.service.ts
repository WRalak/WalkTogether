import type { ActivityType, ChallengeMetric, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { canSeeClub, loadClubAccess, requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';
import { requireFeature } from '../subscriptions/entitlements.service';
import { evaluateAchievements } from './achievements.service';

export interface ChallengeInput {
  title: string;
  description?: string | null;
  metric: ChallengeMetric;
  activityTypes: ActivityType[];
  target?: number | null;
  startsAt: Date;
  endsAt: Date;
  visibility: 'PUBLIC' | 'MEMBERS';
  isPremium?: boolean;
  rules?: string | null;
  rewardDescription?: string | null;
  maxDailyDistanceM?: number;
  coverUrl?: string | null;
}

const MAX_DAILY_CAP = 100_000; // never reward more than 100 km/day, whatever a creator configures

function validateInput(i: ChallengeInput) {
  if (i.endsAt <= i.startsAt) throw badRequest('endsAt must be after startsAt');
  if (i.endsAt.getTime() - i.startsAt.getTime() > 366 * 86_400_000) throw badRequest('Challenges can last at most a year');
  if (i.maxDailyDistanceM && i.maxDailyDistanceM > MAX_DAILY_CAP) throw badRequest('Daily distance cap is too high');
  if (!i.activityTypes.length) throw badRequest('Choose at least one activity type');
}

export async function createClubChallenge(clubId: string, actorId: string, input: ChallengeInput, ctx: AuditContext) {
  await requireClubPermission(clubId, actorId, 'challenges.manage');
  await requireFeature({ clubId }, 'club.challenges');
  validateInput(input);
  if (input.isPremium) throw badRequest('Only platform challenges can be premium');
  const c = await prisma.$transaction(async (tx) => {
    const c = await tx.challenge.create({ data: { ...input, scope: 'CLUB', clubId, createdById: actorId } });
    await audit({ actorType: 'USER', actorId, action: 'challenge.created', targetType: 'challenge', targetId: c.id, clubId }, ctx, tx);
    return c;
  });
  const members = await prisma.clubMembership.findMany({ where: { clubId, status: 'ACTIVE', userId: { not: actorId } }, select: { userId: true }, take: 5000 });
  await notify({
    userIds: members.map((m) => m.userId),
    type: 'challenge.invitation',
    title: `New challenge: ${c.title}`,
    body: 'Join your club’s new challenge.',
    data: { challengeId: c.id },
  });
  return c;
}

/** Platform / sponsored / club-vs-club challenges are created by platform admins. */
export async function createPlatformChallenge(
  adminId: string,
  input: ChallengeInput & { scope: 'PLATFORM' | 'CLUB_VS_CLUB' | 'SPONSORED'; clubIds?: string[]; sponsorName?: string | null },
  ctx: AuditContext,
) {
  validateInput(input);
  if (input.scope === 'CLUB_VS_CLUB' && (input.clubIds?.length ?? 0) < 2) throw badRequest('Club-vs-club challenges need at least two clubs');
  if (input.scope === 'SPONSORED' && !input.sponsorName) throw badRequest('Sponsored challenges must name the sponsor');
  const { clubIds, ...data } = input;
  return prisma.$transaction(async (tx) => {
    const c = await tx.challenge.create({ data: { ...data, createdByAdminId: adminId, teams: clubIds?.length ? { create: clubIds.map((clubId) => ({ clubId })) } : undefined } });
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.challenge_created', targetType: 'challenge', targetId: c.id, metadata: { scope: c.scope } }, ctx, tx);
    return c;
  });
}

async function loadVisible(challengeId: string, viewerId?: string) {
  const c = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { teams: { include: { club: { select: { id: true, name: true, slug: true } } } }, club: { select: { id: true, name: true, slug: true } } },
  });
  if (!c || c.status === 'DRAFT') throw notFound('Challenge not found');
  if (c.clubId) {
    const access = await loadClubAccess(c.clubId, viewerId);
    if (!canSeeClub(access)) throw notFound('Challenge not found');
    if (c.visibility === 'MEMBERS' && !access.permissions.has('club.view_private')) throw notFound('Challenge not found');
  }
  return c;
}

export async function getChallenge(id: string, viewerId?: string) {
  const c = await loadVisible(id, viewerId);
  const [participants, me] = await Promise.all([
    prisma.challengeParticipant.count({ where: { challengeId: id } }),
    viewerId ? prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: id, userId: viewerId } } }) : null,
  ]);
  return {
    ...c,
    isSponsored: c.scope === 'SPONSORED',
    participants,
    me: me && {
      progressValue: me.progressValue,
      completedAt: me.completedAt,
      teamClubId: me.teamClubId,
      hideFromLeaderboard: me.hideFromLeaderboard,
      progress: c.target ? Math.min(1, me.progressValue / c.target) : null,
    },
  };
}

/** Discovery: active public platform/sponsored/club-vs-club challenges + challenges of the viewer's clubs. */
export async function listChallenges(viewerId: string | undefined, q: { cursor?: string; limit: number; mine?: boolean }) {
  const cursor = decodeCursor(q.cursor);
  const myClubIds = viewerId ? (await prisma.clubMembership.findMany({ where: { userId: viewerId, status: 'ACTIVE' }, select: { clubId: true } })).map((m) => m.clubId) : [];
  const where: Prisma.ChallengeWhereInput = q.mine
    ? { participants: { some: { userId: viewerId } }, status: { in: ['ACTIVE', 'ENDED'] } }
    : {
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
        OR: [
          { clubId: null, visibility: 'PUBLIC' },
          { clubId: { in: myClubIds } },
          { clubId: { not: null }, visibility: 'PUBLIC', club: { visibility: 'PUBLIC', status: 'ACTIVE' } },
        ],
      };
  const rows = await prisma.challenge.findMany({
    where: { ...where, ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    include: { club: { select: { id: true, name: true, slug: true } }, _count: { select: { participants: true } } },
  });
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit).map((c) => ({ ...c, isSponsored: c.scope === 'SPONSORED' }));
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function joinChallenge(challengeId: string, userId: string, input: { teamClubId?: string; hideFromLeaderboard?: boolean; acceptTerms?: boolean }) {
  const c = await loadVisible(challengeId, userId);
  if (c.status !== 'ACTIVE' || c.endsAt < new Date()) throw conflict('This challenge is not open', 'CHALLENGE_CLOSED');
  if (c.isPremium) await requireFeature({ userId }, 'user.premium_challenges');
  if (c.scope === 'SPONSORED' && input.acceptTerms !== true) throw badRequest('Accept the sponsor’s competition terms to join', { requiresConsent: true });
  if (c.clubId) {
    const m = await prisma.clubMembership.findFirst({ where: { clubId: c.clubId, userId, status: 'ACTIVE' } });
    if (!m) throw forbidden('Join the club to take part', 'MEMBERS_ONLY');
  }
  let teamClubId: string | null = null;
  if (c.scope === 'CLUB_VS_CLUB') {
    if (!input.teamClubId || !c.teams.some((t) => t.clubId === input.teamClubId)) throw badRequest('Choose which participating club you represent');
    const m = await prisma.clubMembership.findFirst({ where: { clubId: input.teamClubId, userId, status: 'ACTIVE' } });
    if (!m) throw forbidden('You can only represent a club you are an active member of', 'NOT_A_MEMBER');
    teamClubId = input.teamClubId;
  }
  await prisma.challengeParticipant.upsert({
    where: { challengeId_userId: { challengeId, userId } },
    create: { challengeId, userId, teamClubId, hideFromLeaderboard: input.hideFromLeaderboard ?? false, consentedAt: c.scope === 'SPONSORED' ? new Date() : null },
    update: { hideFromLeaderboard: input.hideFromLeaderboard ?? undefined },
  });
  // Activities already recorded during the challenge window count immediately.
  await recomputeParticipant(challengeId, userId);
  return getChallenge(challengeId, userId);
}

export async function leaveChallenge(challengeId: string, userId: string) {
  const res = await prisma.challengeParticipant.deleteMany({ where: { challengeId, userId, completedAt: null } });
  if (!res.count) throw conflict('You are not in this challenge, or have already completed it', 'CANNOT_LEAVE');
  await prisma.challengeProgress.deleteMany({ where: { challengeId, userId } });
}

/**
 * Recomputes one participant's progress from scratch (idempotent; robust to activity deletion).
 * Only non-flagged, completed activities inside the window count; distance is capped per day.
 */
export async function recomputeParticipant(challengeId: string, userId: string) {
  const c = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const p = await prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
  if (!p) return;
  const daily = await prisma.$queryRaw<{ day: Date; distance: number; moving: bigint; n: bigint }[]>`
    SELECT (started_at AT TIME ZONE 'Africa/Nairobi')::date AS day, sum(distance_m) AS distance, sum(moving_seconds) AS moving, count(*) AS n
      FROM activities
     WHERE user_id = ${userId}::uuid AND status = 'COMPLETED' AND flagged = false
       AND started_at >= ${c.startsAt} AND started_at < ${c.endsAt}
       AND type::text = ANY(${c.activityTypes as string[]})
     GROUP BY 1`;
  const perDay = daily.map((d) => {
    const value =
      c.metric === 'DISTANCE_M'
        ? Math.min(Math.round(d.distance), c.maxDailyDistanceM)
        : c.metric === 'MOVING_SECONDS'
          ? Number(d.moving)
          : c.metric === 'ACTIVITIES'
            ? Number(d.n)
            : 1; // ACTIVE_DAYS
    return { day: d.day, value };
  });
  const total = perDay.reduce((s, d) => s + d.value, 0);
  const completedNow = !p.completedAt && c.target != null && total >= c.target && c.status === 'ACTIVE';
  const halfway = !p.notifiedHalfway && c.target != null && total >= c.target / 2 && total < c.target;
  await prisma.$transaction([
    prisma.challengeProgress.deleteMany({ where: { challengeId, userId } }),
    prisma.challengeProgress.createMany({ data: perDay.map((d) => ({ challengeId, userId, day: d.day, value: d.value })) }),
    prisma.challengeParticipant.update({
      where: { challengeId_userId: { challengeId, userId } },
      data: { progressValue: total, progressUpdatedAt: new Date(), ...(completedNow ? { completedAt: new Date() } : {}), ...(halfway ? { notifiedHalfway: true } : {}) },
    }),
  ]);
  if (halfway)
    await notify({ userIds: [userId], type: 'challenge.progress', title: `Halfway there: ${c.title}`, body: 'Keep going — you’re 50% of the way.', data: { challengeId } });
  if (completedNow) {
    await notify({ userIds: [userId], type: 'challenge.completed', title: `Challenge complete: ${c.title} 🎉`, body: c.rewardDescription ?? 'Great work!', data: { challengeId } });
    await evaluateAchievements(userId, ['challenges_completed']);
  }
}

/** Activity job hook: refresh every active challenge this activity could count toward. */
export async function onActivityChanged(userId: string, startedAt?: Date) {
  const entries = await prisma.challengeParticipant.findMany({
    where: { userId, challenge: { status: 'ACTIVE', ...(startedAt ? { startsAt: { lte: startedAt }, endsAt: { gt: startedAt } } : {}) } },
    select: { challengeId: true },
  });
  for (const e of entries) await recomputeParticipant(e.challengeId, userId);
}

/**
 * Leaderboard with fair tie-breaking: higher value first, then whoever reached it earlier.
 * Participants who chose privacy are shown anonymously.
 */
export async function challengeLeaderboard(challengeId: string, viewerId: string | undefined, limit = 100) {
  const c = await loadVisible(challengeId, viewerId);
  const rows = await prisma.challengeParticipant.findMany({
    where: { challengeId },
    orderBy: [{ progressValue: 'desc' }, { progressUpdatedAt: 'asc' }, { joinedAt: 'asc' }],
    take: limit,
    include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
  });
  const entries = rows.map((r, i) => ({
    rank: i + 1,
    value: r.progressValue,
    completed: !!r.completedAt,
    teamClubId: r.teamClubId,
    user:
      r.hideFromLeaderboard && r.userId !== viewerId
        ? null
        : { id: r.user.id, username: r.user.username, displayName: r.user.profile?.displayName ?? r.user.username, avatarUrl: r.user.profile?.avatarUrl ?? null },
    isMe: r.userId === viewerId,
  }));
  let teams: { clubId: string; name: string; participants: number; total: number; average: number; rank: number }[] = [];
  if (c.scope === 'CLUB_VS_CLUB') {
    const agg = await prisma.challengeParticipant.groupBy({ by: ['teamClubId'], where: { challengeId }, _sum: { progressValue: true }, _count: true });
    // Ranked by average per participant so small clubs can compete fairly with large ones.
    teams = c.teams
      .map((t) => {
        const a = agg.find((x) => x.teamClubId === t.clubId);
        const total = a?._sum.progressValue ?? 0;
        const participants = a?._count ?? 0;
        return { clubId: t.clubId, name: t.club.name, participants, total, average: participants ? Math.round(total / participants) : 0, rank: 0 };
      })
      .sort((x, y) => y.average - x.average || y.total - x.total)
      .map((t, i) => ({ ...t, rank: i + 1 }));
  }
  return { challenge: { id: c.id, title: c.title, metric: c.metric, target: c.target, status: c.status }, entries, teams };
}

/** Hourly job: close ended challenges, snapshot results, award winners. */
export async function finalizeEndedChallenges(now = new Date()) {
  const ended = await prisma.challenge.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, take: 50 });
  for (const c of ended) {
    const participants = await prisma.challengeParticipant.findMany({
      where: { challengeId: c.id },
      orderBy: [{ progressValue: 'desc' }, { progressUpdatedAt: 'asc' }, { joinedAt: 'asc' }],
    });
    for (const p of participants) await recomputeParticipant(c.id, p.userId);
    const finalRows = await prisma.challengeParticipant.findMany({
      where: { challengeId: c.id },
      orderBy: [{ progressValue: 'desc' }, { progressUpdatedAt: 'asc' }, { joinedAt: 'asc' }],
    });
    await prisma.$transaction([
      prisma.challengeResult.createMany({
        data: finalRows.map((p, i) => ({ challengeId: c.id, userId: p.userId, rank: i + 1, value: p.progressValue, completed: !!p.completedAt })),
        skipDuplicates: true,
      }),
      prisma.challenge.update({ where: { id: c.id }, data: { status: 'ENDED' } }),
    ]);
    const winner = finalRows[0];
    if (winner && winner.progressValue > 0) await evaluateAchievements(winner.userId, ['challenge_winner']);
    await notify({
      userIds: finalRows.map((p) => p.userId),
      type: 'challenge.completed',
      title: `${c.title} has ended`,
      body: 'See the final standings.',
      data: { challengeId: c.id },
    });
  }
  return { finalized: ended.length };
}

export async function cancelChallenge(challengeId: string, actor: { userId?: string; adminId?: string }, ctx: AuditContext) {
  const c = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!c) throw notFound('Challenge not found');
  if (actor.userId) {
    if (!c.clubId) throw forbidden();
    await requireClubPermission(c.clubId, actor.userId, 'challenges.manage');
  }
  await prisma.challenge.update({ where: { id: challengeId }, data: { status: 'CANCELLED' } });
  await audit(
    {
      actorType: actor.adminId ? 'ADMIN' : 'USER',
      actorId: actor.adminId ?? actor.userId,
      action: 'challenge.cancelled',
      targetType: 'challenge',
      targetId: challengeId,
      clubId: c.clubId,
    },
    ctx,
  );
}
