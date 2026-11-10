import * as Sentry from '@sentry/node';
import { Worker } from 'bullmq';
import { env } from './config/env';
import { createQueueConnection } from './database/redis';
import { getQueue } from './queues';
import type { JobMap, JobName } from './queues/jobs';
import { processors } from './queues/processors';
import { logger } from './shared/logger';
import { jobCounter } from './shared/metrics';

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

/** Background worker process. Run separately from the API so heavy jobs never block requests. */
const workers = (['notifications', 'maintenance', 'activity'] as const).map(
  (queueName) =>
    new Worker(
      queueName,
      async (job) => {
        const processor = processors[job.name as JobName] as ((d: JobMap[JobName]) => Promise<unknown>) | undefined;
        if (!processor) throw new Error(`No processor registered for job ${job.name}`);
        try {
          const r = await processor(job.data);
          jobCounter.inc({ job: job.name, outcome: 'ok' });
          return r;
        } catch (err) {
          jobCounter.inc({ job: job.name, outcome: 'error' });
          throw err;
        }
      },
      { connection: createQueueConnection(), concurrency: queueName === 'notifications' ? 10 : queueName === 'activity' ? 5 : 2 },
    ),
);

for (const w of workers) {
  w.on('failed', (job, err) => {
    logger.error({ job: job?.name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed');
    Sentry.captureException(err, { tags: { job: job?.name } });
  });
}

// Recurring maintenance jobs (idempotent: BullMQ de-duplicates by scheduler id).
const maintenance = getQueue('maintenance');
await maintenance.upsertJobScheduler('account-purge', { pattern: '17 3 * * *' }, { name: 'account.purge-due', data: {} });
await maintenance.upsertJobScheduler('sessions-cleanup', { pattern: '47 2 * * *' }, { name: 'sessions.cleanup', data: {} });
await maintenance.upsertJobScheduler('challenges-finalize', { pattern: '3 * * * *' }, { name: 'challenges.finalize', data: {} });
await maintenance.upsertJobScheduler('leaderboards-compute', { pattern: '*/30 * * * *' }, { name: 'leaderboards.compute', data: {} });
await maintenance.upsertJobScheduler('payments-reconcile', { pattern: '*/5 * * * *' }, { name: 'payments.reconcile', data: {} });
await maintenance.upsertJobScheduler('campaigns-end', { pattern: '13 * * * *' }, { name: 'campaigns.end', data: {} });
await maintenance.upsertJobScheduler('media-cleanup', { pattern: '37 4 * * *' }, { name: 'media.cleanup', data: {} });
await maintenance.upsertJobScheduler('event-reminders', { pattern: '*/10 * * * *' }, { name: 'events.reminders', data: {} });
await maintenance.upsertJobScheduler('subscriptions-lifecycle', { pattern: '7 * * * *' }, { name: 'subscriptions.lifecycle', data: {} });

logger.info('WalkTogether worker started');

async function shutdown() {
  await Promise.allSettled(workers.map((w) => w.close()));
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
