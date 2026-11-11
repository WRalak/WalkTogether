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

if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
  const { crossSiteOrigins } = await import('./config/hosting');
  const crossSite = crossSiteOrigins(env.API_PUBLIC_URL, env.CORS_ORIGINS);
  if (crossSite.length)
    logger.warn(
      { origins: crossSite, api: env.API_PUBLIC_URL },
      'These web origins are not on the same site as the API: browser sign-in (SameSite=Strict refresh cookie) will fail there. Host every app on subdomains of one domain.',
    );
}
const app = createApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'WalkTogether API listening'));
server.requestTimeout = 30_000;
const { attachRealtime, closeRealtime } = await import('./modules/messaging/realtime');
attachRealtime(server);
server.headersTimeout = 35_000;

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await Promise.allSettled([closeRealtime(), prisma.$disconnect(), closeQueues(), redis.quit()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
