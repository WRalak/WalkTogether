import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: string; sessionId: string };
      admin?: { adminId: string; sessionId: string; permissions: Set<string>; roleKey: string };
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function auditCtx(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null, requestId: req.requestId };
}
