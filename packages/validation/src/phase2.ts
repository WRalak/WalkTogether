import { z } from 'zod';
import { CLUB_PERMISSIONS, ENTITLEMENTS } from '@walktogether/shared-types';
import { cursorPaginationSchema } from './common';

export const roleInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(255).nullable().optional(),
    permissions: z.array(z.enum(CLUB_PERMISSIONS)).max(CLUB_PERMISSIONS.length),
  })
  .strict();

export const updateRoleSchema = roleInputSchema.partial().strict();

export const transferOwnershipSchema = z.object({ membershipId: z.string().uuid(), password: z.string().max(128).optional() }).strict();

export const announcementSchema = z
  .object({ title: z.string().trim().min(2).max(140), body: z.string().trim().min(1).max(5000), pinned: z.boolean().default(false), notify: z.boolean().default(true) })
  .strict();
export const updateAnnouncementSchema = z
  .object({ title: z.string().trim().min(2).max(140).optional(), body: z.string().trim().min(1).max(5000).optional(), pinned: z.boolean().optional() })
  .strict();

export const listQuerySchema = cursorPaginationSchema.strict();

const entitlementKey = z.enum(Object.keys(ENTITLEMENTS) as [keyof typeof ENTITLEMENTS, ...(keyof typeof ENTITLEMENTS)[]]);

export const planInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{2,50}$/),
    audience: z.enum(['CLUB', 'INDIVIDUAL']),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    currency: z.string().trim().toUpperCase().length(3),
    amountMinor: z.number().int().min(0).max(100_000_000),
    interval: z.enum(['MONTH', 'YEAR']),
    trialDays: z.number().int().min(0).max(90).default(0),
    graceDays: z.number().int().min(0).max(60).default(7),
    isActive: z.boolean().default(false),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    entitlements: z
      .array(z.object({ key: entitlementKey, intLimit: z.number().int().min(0).max(1_000_000).nullable().optional(), boolValue: z.boolean().nullable().optional() }).strict())
      .max(50)
      .default([]),
  })
  .strict();
export const updatePlanSchema = planInputSchema.omit({ code: true, audience: true }).partial().strict();
