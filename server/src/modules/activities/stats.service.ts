import { Prisma, type ActivityType } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { notFound } from '../../shared/errors';
import { stepsSummary } from './steps.service';

const DAY = 86_400_000;

function startOfWeek(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}
function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfYear(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

interface Totals {
  activities: number;
  distanceM: number;
  movingSeconds: number;
}

async function totals(userId: string, from?: Date, to?: Date, type?: ActivityType): Promise<Totals & { byType: Record<string, Totals> }> {
  const rows = await prisma.activity.groupBy({
    by: ['type'],
    where: { userId, status: 'COMPLETED', ...(type ? { type } : {}), ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}) },
    _count: true,
    _sum: { distanceM: true, movingSeconds: true },
  });
  const byType: Record<string, Totals> = {};
  const all: Totals = { activities: 0, distanceM: 0, movingSeconds: 0 };
  for (const r of rows) {
    const t = { activities: r._count, distanceM: Math.round(r._sum.distanceM ?? 0), movingSeconds: r._sum.movingSeconds ?? 0 };
    byType[r.type] = t;
    all.activities += t.activities;
    all.distanceM += t.distanceM;
    all.movingSeconds += t.movingSeconds;
  }
  return { ...all, byType };
}

/** Bucketed series via SQL (no full-history loads). */
async function series(userId: string, unit: 'week' | 'month', count: number, type?: ActivityType) {
  const since = unit === 'week' ? new Date(startOfWeek(new Date()).getTime() - (count - 1) * 7 * DAY) : (() => {
    const d = startOfMonth(new Date());
    d.setUTCMonth(d.getUTCMonth() - (count - 1));
    return d;
  })();
  const rows = await prisma.$queryRaw<{ bucket: Date; activities: bigint; distance_m: number; moving_seconds: bigint; avg_pace: number | null }[]>`
    SELECT date_trunc(${unit}, started_at AT TIME ZONE 'UTC') AS bucket,
           count(*) AS activities, coalesce(sum(distance_m), 0) AS distance_m, coalesce(sum(moving_seconds), 0) AS moving_seconds,
           CASE WHEN sum(distance_m) > 0 THEN sum(moving_seconds) / (sum(distance_m) / 1000.0) END AS avg_pace
      FROM activities
     WHERE user_id = ${userId}::uuid AND status = 'COMPLETED' AND started_at >= ${since}
       ${type ? Prisma.sql`AND type = ${type}::"ActivityType"` : Prisma.empty}
     GROUP BY 1 ORDER BY 1`;
  const map = new Map(rows.map((r) => [new Date(r.bucket).toISOString().slice(0, 10), r]));
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(since);
    if (unit === 'week') d.setTime(since.getTime() + i * 7 * DAY);
    else d.setUTCMonth(since.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 10);
    const r = map.get(key);
    out.push({ start: key, activities: Number(r?.activities ?? 0), distanceM: Math.round(r?.distance_m ?? 0), movingSeconds: Number(r?.moving_seconds ?? 0), avgPaceSecPerKm: r?.avg_pace ? Math.round(r.avg_pace) : null });
  }
  return out;
}

/** Personal records from non-flagged activities (flagged ones never count). */
async function personalRecords(userId: string) {
  const base = { userId, status: 'COMPLETED' as const, flagged: false };
  const pick = { id: true, type: true, distanceM: true, movingSeconds: true, avgPaceSecPerKm: true, startedAt: true };
  const records: Record<string, unknown> = {};
  for (const type of ['WALK', 'RUN', 'HIKE'] as const) {
    const [longest, longestTime, fastest5k, fastest1k] = await Promise.all([
      prisma.activity.findFirst({ where: { ...base, type }, orderBy: { distanceM: 'desc' }, select: pick }),
      prisma.activity.findFirst({ where: { ...base, type }, orderBy: { movingSeconds: 'desc' }, select: pick }),
      prisma.activity.findFirst({ where: { ...base, type, distanceM: { gte: 5000 }, avgPaceSecPerKm: { not: null } }, orderBy: { avgPaceSecPerKm: 'asc' }, select: pick }),
      prisma.activity.findFirst({ where: { ...base, type, distanceM: { gte: 1000 }, avgPaceSecPerKm: { not: null } }, orderBy: { avgPaceSecPerKm: 'asc' }, select: pick }),
    ]);
    if (longest) records[type] = { longestDistance: longest, longestDuration: longestTime, fastestPace5k: fastest5k, fastestPace1k: fastest1k };
  }
  return records;
}

export async function goalProgress(userId: string) {
  const goals = await prisma.personalGoal.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } });
  const now = new Date();
  return Promise.all(
    goals.map(async (g) => {
      const from = g.period === 'WEEK' ? startOfWeek(now) : g.period === 'MONTH' ? startOfMonth(now) : startOfYear(now);
      const t = await totals(userId, from, undefined, g.activityType ?? undefined);
      const value = g.metric === 'DISTANCE_M' ? t.distanceM : g.metric === 'ACTIVITIES' ? t.activities : t.movingSeconds;
      return { ...g, periodStart: from, value, progress: Math.min(1, value / g.target) };
    }),
  );
}

export async function myStats(userId: string, q: { type?: ActivityType; from?: Date; to?: Date }) {
  const now = new Date();
  const [all, week, month, range, weekly, monthly, records, goals] = await Promise.all([
    totals(userId, undefined, undefined, q.type),
    totals(userId, startOfWeek(now), undefined, q.type),
    totals(userId, startOfMonth(now), undefined, q.type),
    q.from || q.to ? totals(userId, q.from, q.to, q.type) : null,
    series(userId, 'week', 12, q.type),
    series(userId, 'month', 12, q.type),
    personalRecords(userId),
    goalProgress(userId),
  ]);
  return {
    allTime: all,
    thisWeek: week,
    thisMonth: month,
    range,
    avgPaceSecPerKm: all.distanceM > 0 ? Math.round(all.movingSeconds / (all.distanceM / 1000)) : null,
    weekly,
    monthly,
    personalRecords: records,
    goals,
    // Step counts come only from Health Connect / HealthKit, never from GPS (null = not connected).
    steps: await stepsSummary(userId),
  };
}

/** Premium: trend comparisons (current vs previous period, pace trend). */
export async function advancedTrends(userId: string, type?: ActivityType) {
  const now = new Date();
  const thisMonth = startOfMonth(now);
  const prevMonth = new Date(thisMonth);
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const [cur, prev, weekly] = await Promise.all([totals(userId, thisMonth, undefined, type), totals(userId, prevMonth, thisMonth, type), series(userId, 'week', 26, type)]);
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const paces = weekly.filter((w) => w.avgPaceSecPerKm).map((w) => w.avgPaceSecPerKm!);
  const half = Math.floor(paces.length / 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const early = avg(paces.slice(0, half));
  const late = avg(paces.slice(half));
  return {
    monthOverMonth: { distancePct: pct(cur.distanceM, prev.distanceM), activitiesPct: pct(cur.activities, prev.activities), movingTimePct: pct(cur.movingSeconds, prev.movingSeconds) },
    paceTrend: early && late ? { earlierAvg: Math.round(early), recentAvg: Math.round(late), improvingSecPerKm: Math.round(early - late) } : null,
    weekly,
  };
}

export async function publicStats(userId: string) {
  const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId } });
  if (privacy?.showStats === false) return null;
  const t = await totals(userId);
  return { totalActivities: t.activities, walkingDistanceM: t.byType.WALK?.distanceM ?? 0, runningDistanceM: t.byType.RUN?.distanceM ?? 0, hikingDistanceM: t.byType.HIKE?.distanceM ?? 0 };
}

export async function createGoal(userId: string, input: { metric: 'DISTANCE_M' | 'ACTIVITIES' | 'MOVING_SECONDS'; period: 'WEEK' | 'MONTH' | 'YEAR'; activityType?: ActivityType | null; target: number }) {
  return prisma.personalGoal.create({ data: { userId, ...input, activityType: input.activityType ?? null } });
}
export async function deleteGoal(userId: string, id: string) {
  const res = await prisma.personalGoal.updateMany({ where: { id, userId, active: true }, data: { active: false } });
  if (!res.count) throw notFound('Goal not found');
}
