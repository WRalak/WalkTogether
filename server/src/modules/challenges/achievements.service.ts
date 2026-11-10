import type { ActivityType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { notify } from '../notifications/notifications.service';

/** Rule DSL for achievements (validated when admins save definitions). */
export const achievementRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('first_activity'), activityType: z.enum(['WALK', 'RUN', 'HIKE']).optional() }),
  z.object({ type: z.literal('single_distance'), minM: z.number().int().positive(), activityType: z.enum(['WALK', 'RUN', 'HIKE']).optional() }),
  z.object({ type: z.literal('total_distance'), minM: z.number().int().positive(), activityType: z.enum(['WALK', 'RUN', 'HIKE']).optional() }),
  z.object({ type: z.literal('activity_count'), min: z.number().int().positive(), activityType: z.enum(['WALK', 'RUN', 'HIKE']).optional() }),
  z.object({ type: z.literal('streak_days'), days: z.number().int().min(2).max(365) }),
  z.object({ type: z.literal('challenges_completed'), min: z.number().int().positive() }),
  z.object({ type: z.literal('challenge_winner') }),
  z.object({ type: z.literal('events_attended'), min: z.number().int().positive() }),
  z.object({ type: z.literal('posts'), min: z.number().int().positive() }),
]);
export type AchievementRule = z.infer<typeof achievementRuleSchema>;

export const DEFAULT_ACHIEVEMENTS: { code: string; name: string; description: string; icon: string; rule: AchievementRule }[] = [
  { code: 'first_walk', name: 'First Walk', description: 'Recorded your first walk', icon: '🚶', rule: { type: 'first_activity', activityType: 'WALK' } },
  { code: 'first_run', name: 'First Run', description: 'Recorded your first run', icon: '🏃', rule: { type: 'first_activity', activityType: 'RUN' } },
  { code: '5k', name: '5 KM Completed', description: 'Completed 5 km in a single activity', icon: '5️⃣', rule: { type: 'single_distance', minM: 5000 } },
  { code: '10k', name: '10 KM Completed', description: 'Completed 10 km in a single activity', icon: '🔟', rule: { type: 'single_distance', minM: 10000 } },
  { code: 'total_50k', name: '50 KM Total', description: 'Covered 50 km in total', icon: '🥉', rule: { type: 'total_distance', minM: 50000 } },
  { code: 'total_100k', name: '100 KM Total', description: 'Covered 100 km in total', icon: '🥈', rule: { type: 'total_distance', minM: 100000 } },
  { code: 'streak_7', name: 'Seven-Day Consistency', description: 'Moved on seven days in a row', icon: '🔥', rule: { type: 'streak_days', days: 7 } },
  { code: 'challenge_winner', name: 'Challenge Winner', description: 'Finished first in a challenge', icon: '🏆', rule: { type: 'challenge_winner' } },
  { code: 'community_contributor', name: 'Community Contributor', description: 'Shared 10 posts with the community', icon: '💬', rule: { type: 'posts', min: 10 } },
  { code: 'event_participant', name: 'Event Participant', description: 'Checked in to a club event', icon: '📍', rule: { type: 'events_attended', min: 1 } },
];

export async function seedDefaultAchievements() {
  for (const [i, a] of DEFAULT_ACHIEVEMENTS.entries()) {
    await prisma.fitnessAchievement.upsert({ where: { code: a.code }, create: { ...a, sortOrder: i }, update: {} });
  }
}

const valid = (type?: ActivityType) => ({ status: 'COMPLETED' as const, flagged: false, ...(type ? { type } : {}) });

async function longestStreak(userId: string) {
  const days = await prisma.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT (started_at AT TIME ZONE 'Africa/Nairobi')::date AS day FROM activities
     WHERE user_id = ${userId}::uuid AND status = 'COMPLETED' AND flagged = false AND started_at > now() - interval '400 days' ORDER BY 1`;
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const { day } of days) {
    const d = Math.round(new Date(day).getTime() / 86_400_000);
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

async function satisfied(userId: string, rule: AchievementRule): Promise<boolean> {
  switch (rule.type) {
    case 'first_activity':
      return (await prisma.activity.count({ where: { userId, ...valid(rule.activityType) } })) > 0;
    case 'single_distance':
      return (await prisma.activity.count({ where: { userId, ...valid(rule.activityType), distanceM: { gte: rule.minM } } })) > 0;
    case 'total_distance': {
      const agg = await prisma.activity.aggregate({ where: { userId, ...valid(rule.activityType) }, _sum: { distanceM: true } });
      return (agg._sum.distanceM ?? 0) >= rule.minM;
    }
    case 'activity_count':
      return (await prisma.activity.count({ where: { userId, ...valid(rule.activityType) } })) >= rule.min;
    case 'streak_days':
      return (await longestStreak(userId)) >= rule.days;
    case 'challenges_completed':
      return (await prisma.challengeParticipant.count({ where: { userId, completedAt: { not: null } } })) >= rule.min;
    case 'challenge_winner':
      return (await prisma.challengeResult.count({ where: { userId, rank: 1, value: { gt: 0 } } })) > 0;
    case 'events_attended':
      return (await prisma.eventAttendance.count({ where: { userId } })) >= rule.min;
    case 'posts':
      return (await prisma.post.count({ where: { authorId: userId, deletedAt: null, hiddenAt: null, activityId: null } })) >= rule.min;
  }
}

/**
 * Server-side evaluation only: clients can never award achievements. Idempotent — safe to call
 * after any relevant event (activity completed, check-in, challenge end, post).
 */
export async function evaluateAchievements(userId: string, triggers?: AchievementRule['type'][]) {
  const [defs, have] = await Promise.all([
    prisma.fitnessAchievement.findMany({ where: { active: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
  ]);
  const owned = new Set(have.map((h) => h.achievementId));
  const earned: string[] = [];
  for (const def of defs) {
    if (owned.has(def.id)) continue;
    const parsed = achievementRuleSchema.safeParse(def.rule);
    if (!parsed.success || (triggers && !triggers.includes(parsed.data.type))) continue;
    if (await satisfied(userId, parsed.data)) {
      const r = await prisma.userAchievement.createMany({ data: [{ userId, achievementId: def.id }], skipDuplicates: true });
      if (r.count) {
        earned.push(def.name);
        await notify({ userIds: [userId], type: 'achievement.earned', title: `${def.icon} ${def.name}`, body: def.description, data: { achievementId: def.id } });
      }
    }
  }
  return earned;
}

export async function listAchievements(userId: string) {
  const [defs, mine] = await Promise.all([
    prisma.fitnessAchievement.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId } }),
  ]);
  const earned = new Map(mine.map((m) => [m.achievementId, m.earnedAt]));
  return defs.map((d) => ({ id: d.id, code: d.code, name: d.name, description: d.description, icon: d.icon, earnedAt: earned.get(d.id) ?? null }));
}
