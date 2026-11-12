import { Prisma, type ActivityType, type LeaderboardPeriod } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { forbidden, notFound } from '../../shared/errors';
import { getSetting } from '../platform/settings';

const DAY = 86_400_000;

export function periodStart(period: LeaderboardPeriod, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'MONTH') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
}
function periodEnd(period: LeaderboardPeriod, start: Date) {
  const e = new Date(start);
  if (period === 'MONTH') e.setUTCMonth(e.getUTCMonth() + 1);
  else e.setTime(start.getTime() + 7 * DAY);
  return e;
}

/**
 * Ranked distance totals with a per-day cap (no rewards for dangerous extremes) and flagged
 * activities excluded. `extra` scopes the population (global eligibility, club shares, follows).
 */
async function rankDistance(from: Date, to: Date, cap: number, type: ActivityType | null, extra: Prisma.Sql, limit = 100) {
  return prisma.$queryRaw<{ user_id: string; value: number }[]>`
    WITH daily AS (
      SELECT a.user_id, (a.started_at AT TIME ZONE 'Africa/Nairobi')::date AS day, LEAST(sum(a.distance_m), ${cap}) AS d
        FROM activities a
       WHERE a.status = 'COMPLETED' AND a.flagged = false AND a.started_at >= ${from} AND a.started_at < ${to}
         ${type ? Prisma.sql`AND a.type = ${type}::"ActivityType"` : Prisma.empty}
         ${extra}
       GROUP BY 1, 2
    )
    SELECT user_id, round(sum(d))::int AS value FROM daily GROUP BY 1 HAVING sum(d) > 0 ORDER BY 2 DESC, 1 LIMIT ${limit}`;
}

async function store(
  scope: 'GLOBAL' | 'CLUB',
  clubId: string | null,
  period: LeaderboardPeriod,
  start: Date,
  type: ActivityType | null,
  rows: { user_id: string; value: number }[],
) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.leaderboard.findFirst({ where: { scope, clubId, period, periodStart: start, activityType: type } });
    const lb = existing
      ? await tx.leaderboard.update({ where: { id: existing.id }, data: { computedAt: new Date() } })
      : await tx.leaderboard.create({ data: { scope, clubId, period, periodStart: start, activityType: type } });
    await tx.leaderboardEntry.deleteMany({ where: { leaderboardId: lb.id } });
    await tx.leaderboardEntry.createMany({ data: rows.map((r, i) => ({ leaderboardId: lb.id, rank: i + 1, userId: r.user_id, value: r.value })) });
  });
}

/** Hourly job: materialises global and club leaderboards for the current week and month. */
export async function computeLeaderboards(now = new Date()) {
  const cap = await getSetting('leaderboards.maxDailyDistanceM');
  let computed = 0;
  for (const period of ['WEEK', 'MONTH'] as const) {
    const start = periodStart(period, now);
    const end = periodEnd(period, start);
    for (const type of [null, 'WALK', 'RUN'] as const) {
      // Global: only people with public profiles who show their stats.
      const global = await rankDistance(
        start,
        end,
        cap,
        type,
        Prisma.sql`AND EXISTS (SELECT 1 FROM user_privacy_settings ps JOIN users u ON u.id = ps.user_id WHERE ps.user_id = a.user_id AND ps.profile_visibility = 'PUBLIC' AND ps.show_stats AND u.status = 'ACTIVE') AND a.visibility = 'PUBLIC'`,
      );
      await store('GLOBAL', null, period, start, type, global);
      computed++;
    }
    // Clubs: only activities members explicitly shared with that club.
    const clubs = await prisma.$queryRaw<
      { club_id: string }[]
    >`SELECT DISTINCT s.club_id FROM activity_club_shares s JOIN activities a ON a.id = s.activity_id WHERE a.started_at >= ${start} AND a.started_at < ${end}`;
    for (const { club_id } of clubs) {
      const rows = await rankDistance(
        start,
        end,
        cap,
        null,
        Prisma.sql`AND EXISTS (SELECT 1 FROM activity_club_shares s JOIN club_memberships m ON m.club_id = s.club_id AND m.user_id = a.user_id AND m.status = 'ACTIVE' WHERE s.activity_id = a.id AND s.club_id = ${club_id}::uuid)`,
      );
      await store('CLUB', club_id, period, start, null, rows);
      computed++;
    }
  }
  return { computed };
}

async function withUsers(entries: { rank: number; userId: string; value: number }[], viewerId?: string) {
  const users = await prisma.user.findMany({
    where: { id: { in: entries.map((e) => e.userId) } },
    select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return entries.map((e) => {
    const u = byId.get(e.userId);
    return {
      rank: e.rank,
      valueM: e.value,
      isMe: e.userId === viewerId,
      user: u ? { id: u.id, username: u.username, displayName: u.profile?.displayName ?? u.username, avatarUrl: u.profile?.avatarUrl ?? null } : null,
    };
  });
}

export async function getLeaderboard(q: { scope: 'GLOBAL' | 'CLUB'; clubId?: string; period: LeaderboardPeriod; activityType?: ActivityType }, viewerId?: string) {
  if (q.scope === 'CLUB') {
    if (!q.clubId || !viewerId) throw notFound('Leaderboard not found');
    const m = await prisma.clubMembership.findFirst({ where: { clubId: q.clubId, userId: viewerId, status: 'ACTIVE' } });
    if (!m) throw forbidden('Join the club to see its leaderboard', 'MEMBERS_ONLY');
  }
  const lb = await prisma.leaderboard.findFirst({
    where: { scope: q.scope, clubId: q.scope === 'CLUB' ? q.clubId : null, period: q.period, periodStart: periodStart(q.period), activityType: q.activityType ?? null },
    include: { entries: { orderBy: { rank: 'asc' }, take: 100 } },
  });
  return { period: q.period, periodStart: periodStart(q.period), computedAt: lb?.computedAt ?? null, entries: lb ? await withUsers(lb.entries, viewerId) : [] };
}

/** "Personal" leaderboard: you vs the people you follow, computed on demand (bounded by follows). */
export async function followingLeaderboard(viewerId: string, period: LeaderboardPeriod) {
  const cap = await getSetting('leaderboards.maxDailyDistanceM');
  const start = periodStart(period);
  const rows = await rankDistance(
    start,
    periodEnd(period, start),
    cap,
    null,
    Prisma.sql`AND (a.user_id = ${viewerId}::uuid OR (a.visibility IN ('PUBLIC','FOLLOWERS') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId}::uuid AND f.followee_id = a.user_id AND f.status = 'ACCEPTED')))`,
    200,
  );
  return {
    period,
    periodStart: start,
    entries: await withUsers(
      rows.map((r, i) => ({ rank: i + 1, userId: r.user_id, value: r.value })),
      viewerId,
    ),
  };
}
