import { z } from 'zod';
import { cursorPaginationSchema, latitudeSchema, longitudeSchema, urlSchema } from './common';

const date = z.union([z.string().max(40), z.number(), z.date()]).pipe(z.coerce.date());
export const EVENT_TYPES = ['WALK', 'RUN', 'HIKE', 'CHARITY_WALK', 'FITNESS', 'SOCIAL'] as const;

const eventFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(5000).nullable().optional(),
  type: z.enum(EVENT_TYPES),
  visibility: z.enum(['PUBLIC', 'MEMBERS']).default('MEMBERS'),
  startsAt: date,
  endsAt: date,
  timezone: z.string().max(64).default('Africa/Nairobi'),
  meetingPoint: z.string().trim().min(2).max(200),
  meetingLat: latitudeSchema.nullable().optional(),
  meetingLng: longitudeSchema.nullable().optional(),
  routeDescription: z.string().trim().max(2000).nullable().optional(),
  distanceM: z.number().int().min(0).max(500_000).nullable().optional(),
  difficulty: z.enum(['EASY', 'MODERATE', 'HARD']).default('EASY'),
  maxParticipants: z.number().int().min(1).max(100_000).nullable().optional(),
  registrationClosesAt: date.nullable().optional(),
  coverUrl: urlSchema.nullable().optional(),
};

export const createEventSchema = z
  .object({
    ...eventFields,
    recurrence: z
      .object({ frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), interval: z.number().int().min(1).max(12).default(1), count: z.number().int().min(2).max(52) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((e) => e.endsAt > e.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .refine((e) => (e.meetingLat == null) === (e.meetingLng == null), { message: 'meetingLat and meetingLng must be provided together', path: ['meetingLat'] });

export const updateEventSchema = z
  .object({ ...Object.fromEntries(Object.entries(eventFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), applyToSeries: z.boolean().default(false) })
  .strict() as z.ZodType<Partial<z.infer<z.ZodObject<typeof eventFields>>> & { applyToSeries: boolean }>;

export const cancelEventSchema = z.object({ reason: z.string().trim().min(3).max(300), applyToSeries: z.boolean().default(false) }).strict();

export const listEventsQuerySchema = cursorPaginationSchema
  .extend({ from: date.optional(), to: date.optional(), includeCancelled: z.coerce.boolean().default(false) })
  .strict();

export const discoverEventsQuerySchema = cursorPaginationSchema
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, alternatives cannot overlap (≈1 ms on 100 KB input, see security/GAP_ANALYSIS.md)
  .extend({ near: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/).optional(), radiusKm: z.coerce.number().min(1).max(500).default(50), type: z.enum(EVENT_TYPES).optional() })
  .strict();

export const rsvpSchema = z.object({ going: z.boolean() }).strict();

export const checkInSchema = z
  .object({ code: z.string().trim().min(10).max(80), lat: latitudeSchema.optional(), lng: longitudeSchema.optional() })
  .strict()
  .refine((v) => (v.lat == null) === (v.lng == null), { message: 'lat and lng must be provided together' });

export const organizerAttendanceSchema = z.object({ userId: z.string().uuid(), present: z.boolean() }).strict();
