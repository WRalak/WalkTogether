import { z } from 'zod';
import { cursorPaginationSchema, emailSchema, otpCodeSchema } from './common';

export const adminLoginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const adminMfaVerifySchema = z.object({ mfaToken: z.string().min(20).max(2048), code: otpCodeSchema }).strict();
export const adminMfaSetupSchema = z.object({ mfaToken: z.string().min(20).max(2048) }).strict();

export const adminListUsersQuerySchema = cursorPaginationSchema
  .extend({ q: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED']).optional() })
  .strict();

export const adminListClubsQuerySchema = cursorPaginationSchema
  .extend({ q: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'ARCHIVED']).optional() })
  .strict();

export const adminStatusChangeSchema = z
  .object({ action: z.enum(['SUSPEND', 'REACTIVATE']), reason: z.string().trim().min(3).max(500) })
  .strict();

export const adminAuditQuerySchema = cursorPaginationSchema
  .extend({
    actorType: z.enum(['ADMIN', 'USER', 'SYSTEM']).optional(),
    action: z.string().trim().max(100).optional(),
    targetType: z.string().trim().max(50).optional(),
    targetId: z.string().trim().max(100).optional(),
  })
  .strict();
