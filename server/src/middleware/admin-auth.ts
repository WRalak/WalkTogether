import type { NextFunction, Request, Response } from 'express';
import type { AdminPermissionKey } from '@walktogether/shared-types';
import { resolveAdminSession } from '../modules/administration/admin-auth.service';
import { forbidden, unauthorized } from '../shared/errors';

/**
 * Platform-admin authentication. Admin tokens are signed with a different secret and audience
 * than member tokens, so a member token can never pass this check (and vice versa).
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const ctx = await resolveAdminSession(header.slice(7).trim());
  req.admin = { adminId: ctx.adminId, sessionId: ctx.sessionId, roleKey: ctx.roleKey, permissions: ctx.permissions };
  next();
}

export function requireAdminPermission(permission: AdminPermissionKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin) throw unauthorized();
    if (!req.admin.permissions.has(permission)) throw forbidden();
    next();
  };
}
