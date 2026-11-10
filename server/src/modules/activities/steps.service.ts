import type { StepsSource } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { badRequest } from '../../shared/errors';

/** Upserts daily step totals reported by the phone's health platform (last 31 days only). */
export async function syncSteps(userId: string, source: StepsSource, days: { day: string; steps: number }[]) {
  const today = new Date();
  const earliest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 31));
  for (const d of days) {
    const day = new Date(`${d.day}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day < earliest || day.getTime() > today.getTime() + 86_400_000) throw badRequest(`Day ${d.day} is outside the accepted range`);
  }
  await prisma.$transaction(
    days.map((d) =>
      prisma.dailySteps.upsert({
        where: { userId_day_source: { userId, day: new Date(`${d.day}T00:00:00Z`), source } },
        create: { userId, day: new Date(`${d.day}T00:00:00Z`), source, steps: d.steps },
        update: { steps: d.steps, syncedAt: new Date() },
      }),
    ),
  );
  return { synced: days.length };
}

/** Steps summary; null when the user has never connected a health platform. */
export async function stepsSummary(userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.dailySteps.findMany({ where: { userId, day: { gte: since } }, orderBy: { day: 'asc' } });
  if (!rows.length && !(await prisma.dailySteps.count({ where: { userId } }))) return null;
  // If both platforms reported a day, take the larger value rather than double counting.
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const k = r.day.toISOString().slice(0, 10);
    byDay.set(k, Math.max(byDay.get(k) ?? 0, r.steps));
  }
  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const daily = [...byDay.entries()].map(([day, steps]) => ({ day, steps }));
  return {
    today: byDay.get(now.toISOString().slice(0, 10)) ?? 0,
    thisWeek: daily.filter((d) => new Date(`${d.day}T00:00:00Z`) >= weekStart).reduce((s, d) => s + d.steps, 0),
    last30Days: daily,
    sources: [...new Set(rows.map((r) => r.source))],
  };
}
