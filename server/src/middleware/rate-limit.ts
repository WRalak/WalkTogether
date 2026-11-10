import { rateLimit, type Options } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../config/env';
import { redis } from '../database/redis';

function store(prefix: string) {
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

function limiter(prefix: string, opts: Partial<Options>) {
  return rateLimit({
    windowMs: 60_000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !env.RATE_LIMIT_ENABLED,
    store: env.RATE_LIMIT_ENABLED ? store(prefix) : undefined,
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later', requestId: req.requestId } });
    },
    ...opts,
  });
}

/** Global per-IP ceiling. */
export const globalLimiter = limiter('global', { windowMs: 60_000, limit: 300 });
/** Credential endpoints: login, register, OTP, password reset. */
export const authLimiter = limiter('auth', { windowMs: 15 * 60_000, limit: 30 });
/** Very sensitive endpoints such as OTP sending (cost + abuse). */
export const otpLimiter = limiter('otp', { windowMs: 60 * 60_000, limit: 10 });
export const adminAuthLimiter = limiter('admin-auth', { windowMs: 15 * 60_000, limit: 10 });
