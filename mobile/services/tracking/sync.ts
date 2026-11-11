import type { MemberApi } from '@walktogether/api-client';
import type { TrackingRepository } from './types';

const BATCH = 500;

export interface SyncResult {
  synced: string[];
  failed: { localId: string; error: string }[];
}

/**
 * Uploads finished activities. Safe to run repeatedly and concurrently-guarded by the caller:
 *  - creation uses the local id as clientId (server-side idempotent),
 *  - point batches resume from `syncedSeq` and duplicates are ignored server-side,
 *  - completion is idempotent.
 */
export async function syncPending(repo: TrackingRepository, api: Pick<MemberApi, 'activities'>): Promise<SyncResult> {
  const result: SyncResult = { synced: [], failed: [] };
  for (const a of await repo.listPendingSync()) {
    try {
      let serverId = a.serverId;
      if (!serverId) {
        const created = await api.activities.create({ clientId: a.localId, type: a.type, startedAt: new Date(a.startedAt).toISOString(), visibility: a.visibility ?? undefined });
        serverId = created.id;
        await repo.updateActivity(a.localId, { serverId });
      }
      let synced = a.syncedSeq;
      for (;;) {
        const batch = await repo.pointsAfter(a.localId, synced, BATCH);
        if (!batch.length) break;
        await api.activities.addPoints(serverId, batch);
        synced = batch[batch.length - 1]!.seq;
        await repo.updateActivity(a.localId, { syncedSeq: synced });
      }
      await api.activities.complete(serverId, {
        endedAt: new Date(a.endedAt ?? Date.now()).toISOString(),
        title: a.title ?? undefined,
        visibility: a.visibility ?? undefined,
        clubIds: a.clubIds.length ? a.clubIds : undefined,
        clientStats: a.engine ? { distanceM: Math.round(a.engine.distanceM), movingSeconds: Math.round(a.engine.movingMs / 1000) } : undefined,
        mockLocationDetected: a.mockLocation || undefined,
      });
      await repo.updateActivity(a.localId, { status: 'synced', syncError: null });
      result.synced.push(a.localId);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'sync failed';
      await repo.updateActivity(a.localId, { attempts: a.attempts + 1, syncError: error });
      result.failed.push({ localId: a.localId, error });
    }
  }
  return result;
}
