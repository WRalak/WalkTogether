import * as Sentry from '@sentry/node';
import { env } from './config/env';

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1, sendDefaultPii: false });

const { createApp } = await import('./app');
const { prisma } = await import('./database/prisma');
const { redis } = await import('./database/redis');
const { closeQueues } = await import('./queues');
const { logger } = await import('./shared/logger');

const { syncPermissionCatalog } = await import('./modules/platform/catalog');

await syncPermissionCatalog();
const app = createApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'WalkTogether API listening'));
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), closeQueues(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
