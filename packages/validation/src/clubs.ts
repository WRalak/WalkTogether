import { z } from 'zod';
import { CLUB_CATEGORIES, CLUB_VISIBILITY } from '@walktogether/shared-types';
import { countryCodeSchema, cursorPaginationSchema, emailSchema, latitudeSchema, longitudeSchema, phoneSchema, urlSchema } from './common';

export const RESERVED_CLUB_SLUGS = [
  'admin',
  'api',
  'app',
  'new',
  'create',
  'clubs',
  'club',
  'events',
  'challenges',
  'settings',
  'login',
  'register',
  'walktogether',
  'support',
  'help',
  'pricing',
  'about',
  'www',
  'static',
  'assets',
  'platform',
  'me',
];

export const clubSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(50)
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, alternatives cannot overlap (≈1 ms on 100 KB input, see security/GAP_ANALYSIS.md)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, numbers and single hyphens')
  .refine((s) => !RESERVED_CLUB_SLUGS.includes(s), 'This slug is reserved');

const socialLinksSchema = z
  .object({
    instagram: urlSchema.optional(),
    facebook: urlSchema.optional(),
    x: urlSchema.optional(),
    tiktok: urlSchema.optional(),
    whatsapp: urlSchema.optional(),
    strava: urlSchema.optional(),
  })
  .strict();

const clubBase = {
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(CLUB_CATEGORIES),
  visibility: z.enum(CLUB_VISIBILITY),
  requiresApproval: z.boolean().optional(),
  logoUrl: urlSchema.nullable().optional(),
  coverUrl: urlSchema.nullable().optional(),
  websiteUrl: urlSchema.nullable().optional(),
  socialLinks: socialLinksSchema.optional(),
  contactEmail: emailSchema.nullable().optional(),
  contactPhone: phoneSchema.nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  countryCode: countryCodeSchema.nullable().optional(),
  operatingArea: z.string().trim().max(200).nullable().optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
};

function coordsTogether<T extends { latitude?: number | null; longitude?: number | null }>(v: T) {
  return (v.latitude == null) === (v.longitude == null);
}

export const createClubSchema = z
  .object({ ...clubBase, slug: clubSlugSchema })
  .strict()
  .refine(coordsTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });
export type CreateClubInput = z.infer<typeof createClubSchema>;

export const updateClubSchema = z
  .object({
    name: clubBase.name.optional(),
    description: clubBase.description,
    category: clubBase.category.optional(),
    visibility: clubBase.visibility.optional(),
    requiresApproval: clubBase.requiresApproval,
    logoUrl: clubBase.logoUrl,
    coverUrl: clubBase.coverUrl,
    websiteUrl: clubBase.websiteUrl,
    socialLinks: clubBase.socialLinks,
    contactEmail: clubBase.contactEmail,
    contactPhone: clubBase.contactPhone,
    city: clubBase.city,
    countryCode: clubBase.countryCode,
    operatingArea: clubBase.operatingArea,
    latitude: clubBase.latitude,
    longitude: clubBase.longitude,
  })
  .strict()
  .refine(coordsTogether, { message: 'latitude and longitude must be provided together', path: ['latitude'] });
export type UpdateClubInput = z.infer<typeof updateClubSchema>;

export const listClubsQuerySchema = cursorPaginationSchema
  .extend({
    q: z.string().trim().max(80).optional(),
    category: z.enum(CLUB_CATEGORIES).optional(),
    countryCode: countryCodeSchema.optional(),
    near: z
      .string()
      // eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, alternatives cannot overlap (≈1 ms on 100 KB input, see security/GAP_ANALYSIS.md)
      .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'near must be "lat,lng"')
      .optional(),
    radiusKm: z.coerce.number().min(1).max(500).default(25),
  })
  .strict();

export const joinClubSchema = z
  .object({
    invitationCode: z.string().trim().min(6).max(64).optional(),
    message: z.string().trim().max(500).optional(),
  })
  .strict();

export const listMembersQuerySchema = cursorPaginationSchema
  .extend({
    q: z.string().trim().max(80).optional(),
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional(),
    roleId: z.string().uuid().optional(),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    roleId: z.string().uuid().optional(),
    maxUses: z.number().int().min(1).max(1000).default(1),
    expiresInDays: z.number().int().min(1).max(90).default(14),
  })
  .strict();

export const reviewMembershipSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(300).optional() }).strict();

export const assignRoleSchema = z.object({ roleId: z.string().uuid() }).strict();

export const memberModerationSchema = z.object({ action: z.enum(['SUSPEND', 'REINSTATE', 'REMOVE', 'BAN']), reason: z.string().trim().max(300).optional() }).strict();
