import { z } from 'zod';
import { ACTIVITY_TYPES } from '@walktogether/shared-types';
import { emailSchema, phoneSchema, urlSchema } from './common';

const date = z.union([z.string().max(40), z.number(), z.date()]).pipe(z.coerce.date());

export const checkoutSchema = z
  .object({ planId: z.string().uuid(), clubId: z.string().uuid().optional(), provider: z.string().min(2).max(20), phone: phoneSchema.optional(), promotionCode: z.string().trim().max(40).optional() })
  .strict();

export const campaignCheckoutSchema = z.object({ provider: z.string().min(2).max(20), phone: phoneSchema.optional() }).strict();

export const sponsorSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    // eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, alternatives cannot overlap (≈1 ms on 100 KB input, see security/GAP_ANALYSIS.md)
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(60),
    description: z.string().trim().max(2000).nullable().optional(),
    websiteUrl: urlSchema.nullable().optional(),
    logoUrl: urlSchema.nullable().optional(),
    contactEmail: emailSchema,
  })
  .strict();

export const campaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    type: z.enum(['CHALLENGE', 'EVENT']),
    budgetMinor: z.number().int().min(100).max(10_000_000_000),
    currency: z.string().trim().toUpperCase().length(3),
    startsAt: date,
    endsAt: date,
    terms: z.string().trim().min(50, 'Publish clear competition terms (at least 50 characters)').max(10000),
    eligibility: z.record(z.string(), z.unknown()).default({}),
    prizeDescription: z.string().trim().max(1000).nullable().optional(),
    challengeConfig: z
      .object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().max(3000).nullable().optional(),
        metric: z.enum(['DISTANCE_M', 'ACTIVITIES', 'MOVING_SECONDS', 'ACTIVE_DAYS']),
        activityTypes: z.array(z.enum(ACTIVITY_TYPES)).min(1),
        target: z.number().int().positive().nullable().optional(),
        maxDailyDistanceM: z.number().int().min(1000).max(100_000).default(42195),
      })
      .strict()
      .optional(),
    eventIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict();

export const promotionSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
    description: z.string().trim().max(200).optional(),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffMinor: z.number().int().min(1).nullable().optional(),
    planCodes: z.array(z.string().max(50)).max(20).default([]),
    maxRedemptions: z.number().int().min(1).nullable().optional(),
    expiresAt: date.nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((p) => (p.percentOff == null) !== (p.amountOffMinor == null), 'Provide either percentOff or amountOffMinor');
