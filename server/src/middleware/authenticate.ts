import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../modules/auth/tokens';
import { isSessionRevoked } from '../modules/auth/session-revocation';
import { unauthorized } from '../shared/errors';

function bearer(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

async function resolve(req: Request) {
  const token = bearer(req);
  if (!token) return undefined;
  const payload = await verifyToken<{ sid: string }>('access', token);
  if (typeof payload.sid !== 'string') throw unauthorized('Invalid token', 'INVALID_TOKEN');
  if (await isSessionRevoked(payload.sid)) throw unauthorized('Session has been revoked', 'SESSION_REVOKED');
  return { userId: payload.sub, sessionId: payload.sid };
}

/** Requires a valid member access token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const auth = await resolve(req);
  if (!auth) throw unauthorized();
  req.auth = auth;
  next();
}

/** Attaches auth if a valid token is present; anonymous requests continue. Invalid tokens are rejected. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = await resolve(req);
  next();
}

export function authUserId(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}
