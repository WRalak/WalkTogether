import { z } from 'zod';
import { PROFILE_VISIBILITY } from '@walktogether/shared-types';
import { cursorPaginationSchema } from './common';

export const createPostSchema = z
  .object({
    body: z.string().trim().max(5000).nullable().optional(),
    visibility: z.enum(PROFILE_VISIBILITY).default('FOLLOWERS'),
    clubId: z.string().uuid().nullable().optional(),
    mediaIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

export const commentSchema = z.object({ body: z.string().trim().min(1).max(2000), parentId: z.string().uuid().optional() }).strict();
export const feedQuerySchema = cursorPaginationSchema.extend({ clubId: z.string().uuid().optional() }).strict();
export const followResponseSchema = z.object({ accept: z.boolean() }).strict();

export const reportSchema = z
  .object({
    targetType: z.enum(['POST', 'COMMENT', 'MESSAGE', 'USER', 'CLUB', 'ACTIVITY']),
    targetId: z.string().uuid(),
    reason: z.enum(['SPAM', 'HARASSMENT', 'HATE', 'NUDITY', 'VIOLENCE', 'DANGEROUS', 'MISINFORMATION', 'IMPERSONATION', 'PRIVACY', 'OTHER']),
    details: z.string().trim().max(1000).optional(),
  })
  .strict();

export const reportListQuerySchema = cursorPaginationSchema.extend({ status: z.enum(['OPEN', 'ACTIONED', 'DISMISSED']).optional() }).strict();
export const clubReportResolveSchema = z.object({ action: z.enum(['DISMISS', 'HIDE']), note: z.string().trim().max(300).optional() }).strict();
export const adminReportResolveSchema = z.object({ action: z.enum(['DISMISS', 'HIDE_CONTENT', 'SUSPEND_USER']), note: z.string().trim().min(3).max(300) }).strict();
export const moderateContentSchema = z.object({ targetType: z.enum(['POST', 'COMMENT']), targetId: z.string().uuid(), hide: z.boolean(), reason: z.string().trim().max(200).optional() }).strict();

export const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(4000), clientId: z.string().uuid().optional() }).strict();
export const mediaRefSchema = z.object({ mediaId: z.string().uuid() }).strict();
export const clubBrandingSchema = z.object({ logoMediaId: z.string().uuid().optional(), coverMediaId: z.string().uuid().optional() }).strict();
