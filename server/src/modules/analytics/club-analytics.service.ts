import { prisma } from '../../database/prisma';
import { toCsv } from '../events/events.service';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { requireClubPermission } from '../clubs/club-access';
import { requireFeature, resolveEntitlements } from '../subscriptions/entitlements.service';

const DAY = 86_400_000;

/** Club dashboard KPIs. Uses club-owned data only (memberships, events, attendance, explicit shares). */
export async function clubOverview(clubId: string, actorId: string) {
  await requireClubPermission(clubId, actorId, 'analytics.view', { allowInactiveClub: true });
  const since = new Date(Date.now() - 30 * DAY);
  const [active, pending, newMembers, upcoming, pastEvents, attendanceRows, sharedActivities, ent, engagedAttend, engagedShare] = await Promise.all([
    prisma.clubMembership.count({ where: { clubId, status: 'ACTIVE' } }),
    prisma.clubMembership.count({ where: { clubId, status: 'PENDING' } }),
    prisma.clubMembership.count({ where: { clubId, status: 'ACTIVE', joinedAt: { gte: since } } }),
    prisma.event.count({ where: { clubId, status: 'SCHEDULED', startsAt: { gte: new Date(), lte: new Date(Date.now() + 30 * DAY) } } }),
    prisma.event.findMany({ where: { clubId, status: 'SCHEDULED', startsAt: { gte: since, lte: new Date() } }, select: { id: true, goingCount: true } }),
    prisma.eventAttendance.count({ where: { event: { clubId }, checkedInAt: { gte: since } } }),
    prisma.activityClubShare.count({ where: { clubId, createdAt: { gte: since } } }),
    resolveEntitlements({ clubId }),
    prisma.eventAttendance.findMany({ where: { event: { clubId }, checkedInAt: { gte: since } }, distinct: ['userId'], select: { userId: true } }),
    prisma.activityClubShare.findMany({ where: { clubId, createdAt: { gte: since } }, select: { activity: { select: { userId: true } } } }),
  ]);
  const engaged = new Set([...engagedAttend.map((a) => a.userId), ...engagedShare.map((s) => s.activity.userId)]);
  const expected = pastEvents.reduce((s, e) => s + e.goingCount, 0);
  const challengeParticipants = await prisma.challengeParticipant.count({ where: { challenge: { clubId }, joinedAt: { gte: since } } });
  return {
    members: { active, pending, new30d: newMembers, engaged30d: engaged.size, engagementRate: active ? Math.round((engaged.size / active) * 100) : 0 },
    events: { upcoming30d: upcoming, held30d: pastEvents.length, attendance30d: attendanceRows, attendanceRate: expected ? Math.round((attendanceRows / expected) * 100) : null },
    activities: { shared30d: sharedActivities },
    challenges: { participants30d: challengeParticipants },
    plan: { name: ent.planName, status: ent.status },
  };
}

/** Advanced analytics (plan entitlement): 12-month growth, attendance trend and top attendees. */
export async function clubGrowth(clubId: string, actorId: string) {
  await requireClubPermission(clubId, actorId, 'analytics.view', { allowInactiveClub: true });
  await requireFeature({ clubId }, 'club.analytics_advanced');
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1));
  const [joins, attendance, top] = await Promise.all([
    prisma.$queryRaw<
      { month: Date; n: bigint }[]
    >`SELECT date_trunc('month', joined_at) AS month, count(*) AS n FROM club_memberships WHERE club_id = ${clubId}::uuid AND joined_at >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      { month: Date; n: bigint }[]
    >`SELECT date_trunc('month', a.checked_in_at) AS month, count(*) AS n FROM event_attendance a JOIN events e ON e.id = a.event_id WHERE e.club_id = ${clubId}::uuid AND a.checked_in_at >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      { user_id: string; n: bigint }[]
    >`SELECT a.user_id, count(*) AS n FROM event_attendance a JOIN events e ON e.id = a.event_id WHERE e.club_id = ${clubId}::uuid AND a.checked_in_at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: top.map((t) => t.user_id) } }, select: { id: true, username: true, profile: { select: { displayName: true } } } });
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  const series = (rows: { month: Date; n: bigint }[]) =>
    months.map((m) => ({ month: m, value: Number(rows.find((r) => new Date(r.month).toISOString().slice(0, 7) === m)?.n ?? 0) }));
  return {
    newMembers: series(joins),
    attendance: series(attendance),
    topAttendees: top.map((t) => {
      const u = users.find((x) => x.id === t.user_id);
      return { userId: t.user_id, username: u?.username, displayName: u?.profile?.displayName, events: Number(t.n) };
    }),
  };
}

export async function membersCsv(clubId: string, actorId: string) {
  await requireClubPermission(clubId, actorId, 'reports.export', { allowInactiveClub: true });
  await requireFeature({ clubId }, 'club.exports');
  const rows = await prisma.clubMembership.findMany({
    where: { clubId, status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING'] } },
    orderBy: { createdAt: 'asc' },
    select: { status: true, joinedAt: true, role: { select: { name: true } }, user: { select: { username: true, profile: { select: { displayName: true } } } } },
  });
  // Contact details are intentionally excluded: exports contain only club-relevant data.
  return toCsv(
    ['name', 'username', 'role', 'status', 'joined_at'],
    rows.map((r) => [r.user.profile?.displayName ?? r.user.username, r.user.username, r.role.name, r.status, r.joinedAt?.toISOString() ?? '']),
  );
}

export async function attendanceReport(clubId: string, actorId: string, from?: Date, to?: Date) {
  await requireClubPermission(clubId, actorId, 'analytics.view', { allowInactiveClub: true });
  const events = await prisma.event.findMany({
    where: { clubId, startsAt: { gte: from ?? new Date(Date.now() - 90 * DAY), lte: to ?? new Date() } },
    orderBy: { startsAt: 'desc' },
    take: 200,
    select: { id: true, title: true, startsAt: true, status: true, goingCount: true, maxParticipants: true, _count: { select: { attendance: true } } },
  });
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    status: e.status,
    going: e.goingCount,
    capacity: e.maxParticipants,
    attended: e._count.attendance,
    rate: e.goingCount ? Math.round((e._count.attendance / e.goingCount) * 100) : null,
  }));
}

/**
 * Activities members explicitly shared with this club (newest first). Summary fields only — routes are
 * never exposed here, and activities flagged by GPS validation are marked so admins can review them.
 */
export async function clubActivities(clubId: string, actorId: string, q: { cursor?: string; limit: number }) {
  await requireClubPermission(clubId, actorId, 'members.view', { allowInactiveClub: true });
  const cursor = decodeCursor(q.cursor);
  const shares = await prisma.activityClubShare.findMany({
    where: {
      clubId,
      activity: { status: 'COMPLETED' },
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, activityId: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { activityId: 'desc' }],
    take: q.limit + 1,
    include: {
      activity: {
        select: {
          id: true,
          type: true,
          title: true,
          startedAt: true,
          distanceM: true,
          movingSeconds: true,
          avgPaceSecPerKm: true,
          flagged: true,
          user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
        },
      },
    },
  });
  const page = shares.slice(0, q.limit);
  const last = page.at(-1);
  const since = new Date(Date.now() - 7 * DAY);
  const week = await prisma.activity.aggregate({
    where: { status: 'COMPLETED', startedAt: { gte: since }, clubShares: { some: { clubId } } },
    _sum: { distanceM: true, movingSeconds: true },
    _count: true,
  });
  return {
    items: page.map(({ activity: a, createdAt }) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      startedAt: a.startedAt,
      sharedAt: createdAt,
      distanceM: a.distanceM,
      movingSeconds: a.movingSeconds,
      avgPaceSecPerKm: a.avgPaceSecPerKm,
      flagged: a.flagged,
      athlete: { id: a.user.id, username: a.user.username, displayName: a.user.profile?.displayName ?? a.user.username, avatarUrl: a.user.profile?.avatarUrl ?? null },
    })),
    nextCursor: shares.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.activity.id }) : null,
    lastSevenDays: { activities: week._count, distanceM: week._sum.distanceM ?? 0, movingSeconds: week._sum.movingSeconds ?? 0 },
  };
}
