import { z } from 'zod';
import { ACTIVITY_TYPES, PROFILE_VISIBILITY } from '@walktogether/shared-types';
import { countryCodeSchema, urlSchema, usernameSchema } from './common';

export const updateMeSchema = z
  .object({
    username: usernameSchema.optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    location: z.string().trim().max(100).nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    avatarUrl: urlSchema.nullable().optional(),
    fitnessInterests: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
    preferredActivityTypes: z.array(z.enum(ACTIVITY_TYPES)).max(ACTIVITY_TYPES.length).optional(),
  })
  .strict();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updatePrivacySchema = z
  .object({
    profileVisibility: z.enum(PROFILE_VISIBILITY).optional(),
    activityDefaultVisibility: z.enum(PROFILE_VISIBILITY).optional(),
    showClubs: z.boolean().optional(),
    showStats: z.boolean().optional(),
    allowFollowRequests: z.boolean().optional(),
    hideStartEndPoints: z.boolean().optional(),
    privacyZoneRadiusMeters: z.number().int().min(0).max(2000).optional(),
  })
  .strict();

export const updateNotificationSettingsSchema = z
  .object({
    pushEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    newFollower: z.boolean().optional(),
    comments: z.boolean().optional(),
    reactions: z.boolean().optional(),
    clubAnnouncements: z.boolean().optional(),
    eventReminders: z.boolean().optional(),
    challengeUpdates: z.boolean().optional(),
    marketing: z.boolean().optional(),
  })
  .strict();

export const registerDeviceSchema = z
  .object({
    pushToken: z.string().trim().min(10).max(512),
    platform: z.enum(['ios', 'android', 'web']),
    deviceId: z.string().trim().min(8).max(128).optional(),
  })
  .strict();
