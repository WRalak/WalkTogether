import { prisma } from '../../database/prisma';
import { redis } from '../../database/redis';
import { env } from '../../config/env';
import { getQueue } from '../../queues';
import { enabledProviders } from '../payments/providers';

const startedAt = new Date();

/** System health for the platform admin: dependencies, queues, migrations, configuration. */
export async function systemHealth() {
  const t0 = Date.now();
  const db = await prisma.$queryRaw`SELECT 1`.then(() => ({ ok: true, latencyMs: Date.now() - t0 })).catch((e) => ({ ok: false, error: String(e).slice(0, 200) }));
  const t1 = Date.now();
  const cache = await redis
    .ping()
    .then(() => ({ ok: true, latencyMs: Date.now() - t1 }))
    .catch((e) => ({ ok: false, error: String(e).slice(0, 200) }));
  const queues: Record<string, unknown> = {};
  if (env.QUEUE_DRIVER === 'bullmq') {
    for (const name of ['notifications', 'maintenance', 'activity'] as const) {
      queues[name] = await getQueue(name)
        .getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
        .catch((e) => ({ error: String(e).slice(0, 100) }));
    }
  }
  const migrations = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null }[]
  >`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 1`.catch(() => []);
  const [webhookErrors, pendingPayments, openReports] = await Promise.all([
    prisma.webhookEvent.count({ where: { error: { not: null }, receivedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.payment.count({ where: { status: 'PENDING' } }),
    prisma.contentReport.count({ where: { status: 'OPEN' } }),
  ]);
  return {
    status: db.ok && cache.ok ? 'ok' : 'degraded',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    node: process.version,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    database: db,
    redis: cache,
    queues,
    latestMigration: migrations[0] ?? null,
    integrations: {
      email: env.EMAIL_PROVIDER,
      sms: env.SMS_PROVIDER,
      push: env.PUSH_PROVIDER,
      storage: env.STORAGE_DRIVER,
      malwareScanner: env.MALWARE_SCANNER,
      payments: enabledProviders().map((p) => p.id),
      oauth: { google: env.GOOGLE_CLIENT_IDS.length > 0, apple: env.APPLE_CLIENT_IDS.length > 0 },
      sentry: !!env.SENTRY_DSN,
    },
    signals: { webhookErrors24h: webhookErrors, pendingPayments, openReports },
  };
}

/** Security monitoring: suspicious sign-ins, lockouts, token reuse, admin auth failures. */
export async function securityOverview() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [suspicious, failedLogins, lockedUsers, tokenReuse, adminFailures, adminSessions] = await Promise.all([
    prisma.loginEvent.findMany({
      where: { suspicious: true, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, userId: true, ipAddress: true, userAgent: true, method: true, createdAt: true, user: { select: { username: true } } },
    }),
    prisma.loginEvent.count({ where: { success: false, createdAt: { gte: since } } }),
    prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
    prisma.auditLog.findMany({
      where: { action: { in: ['auth.refresh_token_reuse_detected', 'admin.refresh_token_reuse_detected'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.auditLog.findMany({ where: { action: { in: ['admin.login_failed', 'admin.mfa_failed'] }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.adminSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' }, include: { admin: { select: { email: true } } } }),
  ]);
  const topFailingIps = await prisma.loginEvent.groupBy({
    by: ['ipAddress'],
    where: { success: false, createdAt: { gte: since } },
    _count: true,
    orderBy: { _count: { ipAddress: 'desc' } },
    take: 10,
  });
  return {
    window: '7d',
    failedLogins,
    lockedUsers,
    suspiciousLogins: suspicious,
    tokenReuse,
    adminAuthFailures: adminFailures,
    topFailingIps: topFailingIps.map((r) => ({ ip: r.ipAddress, failures: r._count })),
    activeAdminSessions: adminSessions.map((s) => ({ id: s.id, admin: s.admin.email, ipAddress: s.ipAddress, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt })),
  };
}
