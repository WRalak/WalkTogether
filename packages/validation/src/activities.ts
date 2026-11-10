import { z } from 'zod';
import { ACTIVITY_TYPES, PROFILE_VISIBILITY } from '@walktogether/shared-types';
import { cursorPaginationSchema } from './common';

const isoDate = z.union([z.string().max(40), z.number(), z.date()]).pipe(z.coerce.date());

export const createActivitySchema = z
  .object({
    clientId: z.string().uuid(),
    type: z.enum(ACTIVITY_TYPES),
    startedAt: isoDate,
    visibility: z.enum(PROFILE_VISIBILITY).optional(),
    title: z.string().trim().max(120).optional(),
  })
  .strict();

export const gpsPointSchema = z
  .object({
    seq: z.number().int().min(0).max(1_000_000),
    segment: z.number().int().min(0).max(10_000).default(0),
    t: z.number().int().positive(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(10_000).nullable().optional(),
    altitude: z.number().min(-500).max(9_000).nullable().optional(),
    altitudeAccuracy: z.number().min(0).max(10_000).nullable().optional(),
    speed: z.number().min(0).max(200).nullable().optional(),
  })
  .strict();

export const gpsBatchSchema = z.object({ points: z.array(gpsPointSchema).min(1).max(2000) }).strict();

export const activitySharingSchema = {
  title: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  visibility: z.enum(PROFILE_VISIBILITY).optional(),
  clubIds: z.array(z.string().uuid()).max(10).optional(),
};

export const completeActivitySchema = z
  .object({
    endedAt: isoDate,
    ...activitySharingSchema,
    /** Client-side figures are hints only; the server recomputes authoritative statistics. */
    clientStats: z.object({ distanceM: z.number().min(0).max(1_000_000), movingSeconds: z.number().int().min(0).max(1_000_000) }).strict().optional(),
    mockLocationDetected: z.boolean().optional(),
  })
  .strict();

export const updateActivitySchema = z.object(activitySharingSchema).strict();

export const listActivitiesQuerySchema = cursorPaginationSchema
  .extend({ type: z.enum(ACTIVITY_TYPES).optional(), from: isoDate.optional(), to: isoDate.optional() })
  .strict();

export const statsQuerySchema = z.object({ type: z.enum(ACTIVITY_TYPES).optional(), from: isoDate.optional(), to: isoDate.optional() }).strict();

export const goalSchema = z
  .object({
    metric: z.enum(['DISTANCE_M', 'ACTIVITIES', 'MOVING_SECONDS']),
    period: z.enum(['WEEK', 'MONTH', 'YEAR']),
    activityType: z.enum(ACTIVITY_TYPES).nullable().optional(),
    target: z.number().int().min(1).max(100_000_000),
  })
  .strict();

export const stepsSyncSchema = z
  .object({
    source: z.enum(['HEALTH_CONNECT', 'HEALTHKIT']),
    days: z
      .array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), steps: z.number().int().min(0).max(200_000) }).strict())
      .min(1)
      .max(31),
  })
  .strict();
