import { Router } from 'express';
import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';

export const healthRouter = Router();

/** Liveness: the process is up. Never touches dependencies. */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness: dependencies reachable. Used by load balancers / orchestrators. */
healthRouter.get('/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => (checks.database = 'ok')).catch(() => (checks.database = 'error')),
    redis
      .ping()
      .then(() => (checks.redis = 'ok'))
      .catch(() => (checks.redis = 'error')),
  ]);
  const healthy = Object.values(checks).every((c) => c === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});
