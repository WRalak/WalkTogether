import type { LocalActivity, LocalPoint, TrackingRepository } from './types';

/** In-memory repository for tests. */
export function createMemoryRepository(): TrackingRepository & { points: Map<string, LocalPoint[]> } {
  const acts = new Map<string, LocalActivity>();
  const points = new Map<string, LocalPoint[]>();
  return {
    points,
    async insertActivity(a) {
      acts.set(a.localId, { ...a });
    },
    async updateActivity(id, patch) {
      const a = acts.get(id);
      if (a) acts.set(id, { ...a, ...patch });
    },
    async getActivity(id) {
      return acts.get(id) ?? null;
    },
    async findUnfinished() {
      return [...acts.values()].find((a) => a.status === 'recording' || a.status === 'paused') ?? null;
    },
    async listPendingSync() {
      return [...acts.values()].filter((a) => a.status === 'finished');
    },
    async listLocal() {
      return [...acts.values()].filter((a) => a.status !== 'synced' && a.status !== 'discarded');
    },
    async appendPoints(id, pts) {
      const list = points.get(id) ?? [];
      for (const p of pts) if (!list.some((x) => x.seq === p.seq)) list.push(p);
      points.set(id, list.sort((a, b) => a.seq - b.seq));
    },
    async pointsAfter(id, after, limit) {
      return (points.get(id) ?? []).filter((p) => p.seq > after).slice(0, limit);
    },
    async allPoints(id) {
      return points.get(id) ?? [];
    },
    async deleteActivity(id) {
      acts.delete(id);
      points.delete(id);
    },
  };
}
