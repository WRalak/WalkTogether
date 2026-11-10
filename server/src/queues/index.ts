import { Queue } from 'bullmq';
import { env } from '../config/env';
import { createQueueConnection } from '../database/redis';
import { logger } from '../shared/logger';
import { JOB_QUEUES, type JobMap, type JobName } from './jobs';

type QueueName = (typeof JOB_QUEUES)[JobName];
const queues = new Map<QueueName, Queue>();

function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a background job. With QUEUE_DRIVER=inline (tests only) the processor runs
 * synchronously so tests are deterministic and need no worker process.
 */
export async function enqueue<K extends JobName>(name: K, data: JobMap[K], opts?: { jobId?: string; delayMs?: number }) {
  if (env.QUEUE_DRIVER === 'inline') {
    const { processors } = await import('./processors');
    await (processors[name] as (d: JobMap[K]) => Promise<unknown>)(data);
    return;
  }
  try {
    await getQueue(JOB_QUEUES[name]).add(name, data, { jobId: opts?.jobId, delay: opts?.delayMs });
  } catch (err) {
    // Surface enqueue failures; callers decide whether the request should fail.
    logger.error({ err, job: name }, 'failed to enqueue job');
    throw err;
  }
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
}

export { getQueue };
