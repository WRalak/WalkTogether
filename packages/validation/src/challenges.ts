import { z } from 'zod';
import { ACTIVITY_TYPES } from '@walktogether/shared-types';
import { urlSchema } from './common';

const date = z.union([z.string().max(40), z.number(), z.date()]).pipe(z.coerce.date());

export const createChallengeSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(3000).nullable().optional(),
    metric: z.enum(['DISTANCE_M', 'ACTIVITIES', 'MOVING_SECONDS', 'ACTIVE_DAYS']),
    activityTypes: z.array(z.enum(ACTIVITY_TYPES)).min(1).max(3),
    target: z.number().int().min(1).max(100_000_000).nullable().optional(),
    startsAt: date,
    endsAt: date,
    visibility: z.enum(['PUBLIC', 'MEMBERS']).default('PUBLIC'),
    rules: z.string().trim().max(5000).nullable().optional(),
    rewardDescription: z.string().trim().max(500).nullable().optional(),
    maxDailyDistanceM: z.number().int().min(1000).max(100_000).default(42195),
    coverUrl: urlSchema.nullable().optional(),
    isPremium: z.boolean().default(false),
  })
  .strict();

export const adminChallengeSchema = createChallengeSchema
  .extend({ scope: z.enum(['PLATFORM', 'CLUB_VS_CLUB', 'SPONSORED']), clubIds: z.array(z.string().uuid()).max(50).optional(), sponsorName: z.string().trim().max(120).nullable().optional() })
  .strict();

export const achievementDefinitionSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9_]{2,50}$/),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().min(2).max(300),
    icon: z.string().max(16).default('🏅'),
    rule: z.record(z.string(), z.unknown()),
    active: z.boolean().default(true),
  })
  .strict();
