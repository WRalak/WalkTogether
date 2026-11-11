import { TrackingSession, type LocationFix, type LocationSource } from '@/services/tracking/session';
import { createMemoryRepository } from '@/services/tracking/memory-repository';
import { syncPending } from '@/services/tracking/sync';

function fakeLocation(): LocationSource & { running: boolean } {
  return {
    running: false,
    async start() {
      this.running = true;
      return { background: true };
    },
    async stop() {
      this.running = false;
    },
    async isRunning() {
      return this.running;
    },
  };
}

const fixes = (n: number, t0 = Date.now() - n * 3000, from = 0): LocationFix[] =>
  Array.from({ length: n }, (_, i) => ({ lat: -1.2921 + ((i + from) * 4.2) / 111_195, lng: 36.8219, t: t0 + i * 3000, accuracy: 5, altitude: null, altitudeAccuracy: null, speed: 1.4 }));

let id = 0;
const newId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;

describe('tracking session', () => {
  it('records, persists every accepted point, pauses/resumes and saves', async () => {
    const repo = createMemoryRepository();
    const loc = fakeLocation();
    const s = new TrackingSession(repo, loc, newId);
    await s.start('WALK');
    expect(loc.running).toBe(true);
    await s.handleLocations(fixes(50));
    const localId = s.state.activity!.localId;
    expect(repo.points.get(localId)).toHaveLength(50);
    expect(s.state.snapshot!.distanceM).toBeGreaterThan(190);
    await s.pause();
    expect(loc.running).toBe(false);
    await s.handleLocations(fixes(5, Date.now()));
    expect(repo.points.get(localId)).toHaveLength(50); // ignored while paused
    await s.resume();
    await s.stop();
    const saved = await s.save({ title: 'Test', visibility: 'PRIVATE', clubIds: [] });
    expect((await repo.getActivity(saved!))!.status).toBe('finished');
    expect(s.state.activity).toBeNull();
  });

  it('recovers an interrupted session after the app is killed', async () => {
    const repo = createMemoryRepository();
    const s1 = new TrackingSession(repo, fakeLocation(), newId);
    await s1.start('RUN');
    await s1.handleLocations(fixes(30));
    // New process: background task was killed with the app.
    const s2 = new TrackingSession(repo, fakeLocation(), newId);
    await s2.restore();
    expect(s2.state.activity?.status).toBe('paused');
    expect(s2.state.recent).toHaveLength(30);
    await s2.resume();
    await s2.handleLocations(fixes(10, Date.now() - 10_000, 40));
    expect((await repo.allPoints(s2.state.activity!.localId)).length).toBe(40);
  });
});

describe('offline sync', () => {
  it('uploads in batches, resumes after failure and never duplicates', async () => {
    const repo = createMemoryRepository();
    const s = new TrackingSession(repo, fakeLocation(), newId);
    await s.start('WALK');
    await s.handleLocations(fixes(1200));
    await s.stop();
    const localId = (await s.save({ visibility: 'FOLLOWERS', clubIds: [] }))!;

    const uploaded: number[] = [];
    let failOnce = true;
    const api = {
      activities: {
        create: jest.fn(async (b: { clientId: string }) => ({ id: `srv-${b.clientId}` })),
        addPoints: jest.fn(async (_id: string, pts: { seq: number }[]) => {
          if (failOnce && uploaded.length >= 500) {
            failOnce = false;
            throw new Error('network down');
          }
          uploaded.push(...pts.map((p) => p.seq));
          return { accepted: pts.length, ignored: 0 };
        }),
        complete: jest.fn(async () => ({})),
      },
    };
    const r1 = await syncPending(repo, api as never);
    expect(r1.failed).toHaveLength(1);
    expect((await repo.getActivity(localId))!.syncedSeq).toBe(499);
    const r2 = await syncPending(repo, api as never);
    expect(r2.synced).toEqual([localId]);
    expect(api.activities.create).toHaveBeenCalledTimes(1); // server id was remembered
    expect(new Set(uploaded).size).toBe(uploaded.length);
    expect(uploaded).toHaveLength(1200);
    expect((await repo.getActivity(localId))!.status).toBe('synced');
  });
});
