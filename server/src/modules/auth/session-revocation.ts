import { env } from '../../config/env';
import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';
import { logger } from '../../shared/logger';

/**
 * Access tokens are short-lived JWTs. To make logout / suspension effective immediately we
 * keep a Redis deny-list of revoked session ids for the lifetime of an access token. If Redis
 * is unavailable we fall back to the database (fail closed, never open).
 */
const key = (sid: string) => `sess:revoked:${sid}`;

export async function markSessionsRevoked(sessionIds: string[]) {
  if (!sessionIds.length) return;
  try {
    const pipeline = redis.pipeline();
    for (const sid of sessionIds) pipeline.set(key(sid), '1', 'EX', env.ACCESS_TOKEN_TTL_SECONDS + 60);
    await pipeline.exec();
  } catch (err) {
    logger.warn({ err }, 'could not write session revocation to redis; DB fallback remains authoritative');
  }
}

export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  try {
    const hit = await redis.exists(key(sessionId));
    if (hit) return true;
    // Cache miss: Redis only stores revocations, so a miss is authoritative while Redis is healthy.
    return false;
  } catch {
    const session = await prisma.userSession.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true } });
    return !session || session.revokedAt !== null || session.expiresAt < new Date();
  }
}
