import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../shared/logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  lazyConnect: false,
});

redis.on('error', (err) => logger.error({ err: err.message }, 'redis error'));

/** BullMQ requires maxRetriesPerRequest=null on its own connections. */
export function createQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
