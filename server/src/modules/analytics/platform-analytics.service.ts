/**
 * Platform-wide analytics and reports for the platform-admin web app. Callers must already hold the
 * relevant admin permission (checked in the admin routes). Aggregates only — no GPS routes.
 */
import { prisma } from '../../database/prisma';
import { conflict, notFound } from '../../shared/errors';
import { decodeCursor, encodeCursor } from '../../shared/pagination';
import { audit, type AuditContext } from '../audit/audit.service';
import { toCsv } from '../events/events.service';
import { notify } from '../notifications/notifications.service';

const DAY = 86_400_000;

/** Daily activity volume across the platform. Flagged (spoofed) activities are counted separately. */
export async function platformActivity(days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const daily = await prisma.$queryRaw<{ day: Date; activities: bigint; distance_m: number | null; active_users: bigint; flagged: bigint }[]>`
    SELECT date_trunc('day', started_at) AS day,
           count(*) FILTER (WHERE NOT flagged) AS activities,
           sum(distance_m) FILTER (WHERE NOT flagged) AS distance_m,
           count(DISTINCT user_id) AS active_users,
           count(*) FILTER (WHERE flagged) AS flagged
      FROM activities
     WHERE status = 'COMPLETED' AND started_at >= ${since}
     GROUP BY 1 ORDER BY 1`;
  const byType = await prisma.activity.groupBy({ by: ['type'], where: { status: 'COMPLETED', startedAt: { gte: since }, flagged: false }, _count: true, _sum: { distanceM: true } });
  const [activeUsers, clubShares, steps] = await Promise.all([
    prisma.activity.findMany({ where: { status: 'COMPLETED', startedAt: { gte: since } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
    prisma.activityClubShare.count({ where: { createdAt: { gte: since } } }),
    prisma.dailySteps.count({ where: { day: { gte: since } } }),
  ]);
  return {
    days,
    activeUsers,
    clubShares,
    stepSyncDays: steps,
    byType: byType.map((t) => ({ type: t.type, activities: t._count, distanceM: t._sum.distanceM ?? 0 })),
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), activities: Number(d.activities), distanceM: Math.round(d.distance_m ?? 0), activeUsers: Number(d.active_users), flagged: Number(d.flagged) })),
  };
}

export async function platformEvents(q: { cursor?: string; limit: number; status?: 'SCHEDULED' | 'CANCELLED'; when?: 'upcoming' | 'past'; q?: string }) {
  const cursor = decodeCursor(q.cursor);
  const now = new Date();
  const rows = await prisma.event.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.when === 'upcoming' ? { startsAt: { gte: now } } : q.when === 'past' ? { startsAt: { lt: now } } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' as const } } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    select: {
      id: true, title: true, type: true, status: true, visibility: true, startsAt: true, goingCount: true, maxParticipants: true, cancelReason: true, createdAt: true,
      club: { select: { id: true, name: true, slug: true } },
      sponsorship: { select: { acceptedAt: true, campaign: { select: { name: true, sponsor: { select: { name: true } } } } } },
      _count: { select: { attendance: true } },
    },
  });
  const items = rows.slice(0, q.limit);
  const last = items.at(-1);
  return {
    items: items.map(({ _count, sponsorship, ...e }) => ({ ...e, attended: _count.attendance, sponsor: sponsorship?.acceptedAt ? sponsorship.campaign.sponsor.name : null })),
    nextCursor: rows.length > q.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/** Platform moderation: cancel an event that breaks the rules. Registrants are notified; the action is audited. */
export async function adminCancelEvent(adminId: string, eventId: string, reason: string, ctx: AuditContext) {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, title: true, status: true, startsAt: true, clubId: true } });
  if (!e) throw notFound('Event not found');
  if (e.status === 'CANCELLED') throw conflict('Event is already cancelled', 'ALREADY_CANCELLED');
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: e.id }, data: { status: 'CANCELLED', cancelReason: reason } });
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.event_cancelled', targetType: 'event', targetId: e.id, clubId: e.clubId, metadata: { reason } }, ctx, tx);
  });
  const regs = await prisma.eventRegistration.findMany({ where: { eventId: e.id, status: { in: ['GOING', 'WAITLISTED'] } }, select: { userId: true } });
  await notify({ userIds: regs.map((r) => r.userId), type: 'event.cancelled', title: `Cancelled: ${e.title}`, body: `${e.startsAt.toUTCString()} — ${reason}`, data: { eventId: e.id } });
}

export const REPORT_KINDS = ['users', 'clubs', 'payments', 'activity'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
const MAX_ROWS = 50_000;

/** CSV exports (formula-injection safe). Range filters on creation/start date. */
export async function platformReportCsv(kind: ReportKind, from: Date, to: Date) {
  const range = { gte: from, lte: to };
  switch (kind) {
    case 'users': {
      const rows = await prisma.user.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, select: { id: true, username: true, status: true, emailVerifiedAt: true, createdAt: true, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } } });
      return toCsv(['user_id', 'username', 'status', 'email_verified', 'active_clubs', 'joined_at'], rows.map((u) => [u.id, u.username, u.status, u.emailVerifiedAt ? 'yes' : 'no', u._count.memberships, u.createdAt.toISOString()]));
    }
    case 'clubs': {
      const rows = await prisma.club.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, select: { id: true, name: true, slug: true, status: true, visibility: true, category: true, city: true, countryCode: true, memberCount: true, createdAt: true } });
      return toCsv(['club_id', 'name', 'slug', 'status', 'visibility', 'category', 'city', 'country', 'members', 'created_at'], rows.map((c) => [c.id, c.name, c.slug, c.status, c.visibility, c.category, c.city, c.countryCode, c.memberCount, c.createdAt.toISOString()]));
    }
    case 'payments': {
      const rows = await prisma.payment.findMany({ where: { createdAt: range }, orderBy: { createdAt: 'asc' }, take: MAX_ROWS, select: { id: true, createdAt: true, purpose: true, amountMinor: true, currency: true, provider: true, status: true, providerReceipt: true, invoice: { select: { number: true } } } });
      return toCsv(['payment_id', 'created_at', 'purpose', 'amount', 'currency', 'provider', 'status', 'receipt', 'invoice'], rows.map((p) => [p.id, p.createdAt.toISOString(), p.purpose, (p.amountMinor / 100).toFixed(2), p.currency, p.provider, p.status, p.providerReceipt, p.invoice?.number ?? null]));
    }
    case 'activity': {
      const days = await prisma.$queryRaw<{ day: Date; activities: bigint; distance_m: number | null; active_users: bigint; flagged: bigint }[]>`
        SELECT date_trunc('day', started_at) AS day, count(*) FILTER (WHERE NOT flagged) AS activities, sum(distance_m) FILTER (WHERE NOT flagged) AS distance_m,
               count(DISTINCT user_id) AS active_users, count(*) FILTER (WHERE flagged) AS flagged
          FROM activities WHERE status = 'COMPLETED' AND started_at BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`;
      return toCsv(['day', 'activities', 'distance_km', 'active_users', 'flagged'], days.map((d) => [d.day.toISOString().slice(0, 10), Number(d.activities), ((d.distance_m ?? 0) / 1000).toFixed(1), Number(d.active_users), Number(d.flagged)]));
    }
  }
}
