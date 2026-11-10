import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { decodePolyline, haversine } from '@walktogether/gps';
import { prisma } from '../src/database/prisma';
import { addMember, api, bearer, createClub, registerUser, teardown, type TestUser } from './helpers';

afterAll(teardown);

const START = { lat: -1.2921, lng: 36.8219 };
/** n points walking north at speedMps, one every 3 s, ending ~now. */
function walk(n: number, speedMps = 1.4, offsetSeg = 0) {
  const t0 = Date.now() - n * 3000 - 60_000;
  const dLat = (speedMps * 3) / 111_195;
  return Array.from({ length: n }, (_, i) => ({ seq: i, segment: offsetSeg, t: t0 + i * 3000, lat: START.lat + dLat * i, lng: START.lng, accuracy: 5 }));
}

async function record(u: TestUser, points = walk(401), extra: Record<string, unknown> = {}, type = 'WALK') {
  const clientId = randomUUID();
  const a = await api().post('/api/v1/activities').set(bearer(u)).send({ clientId, type, startedAt: new Date(points[0]!.t).toISOString() }).expect(201);
  for (let i = 0; i < points.length; i += 150) await api().post(`/api/v1/activities/${a.body.data.id}/gps-points`).set(bearer(u)).send({ points: points.slice(i, i + 150) }).expect(200);
  const done = await api()
    .post(`/api/v1/activities/${a.body.data.id}/complete`)
    .set(bearer(u))
    .send({ endedAt: new Date(points.at(-1)!.t).toISOString(), ...extra })
    .expect(200);
  return { id: a.body.data.id as string, clientId, data: done.body.data };
}

describe('recording & sync', () => {
  it('creation is idempotent per clientId and point batches tolerate retries', async () => {
    const u = await registerUser();
    const clientId = randomUUID();
    const startedAt = new Date(Date.now() - 600_000).toISOString();
    const a1 = await api().post('/api/v1/activities').set(bearer(u)).send({ clientId, type: 'RUN', startedAt }).expect(201);
    const a2 = await api().post('/api/v1/activities').set(bearer(u)).send({ clientId, type: 'RUN', startedAt }).expect(201);
    expect(a2.body.data.id).toBe(a1.body.data.id);
    const pts = walk(20, 3);
    const first = await api().post(`/api/v1/activities/${a1.body.data.id}/gps-points`).set(bearer(u)).send({ points: pts }).expect(200);
    const retry = await api().post(`/api/v1/activities/${a1.body.data.id}/gps-points`).set(bearer(u)).send({ points: pts }).expect(200);
    expect(first.body.data.accepted).toBe(20);
    expect(retry.body.data).toEqual({ accepted: 0, ignored: 20 });
    // Another user cannot write to it.
    const other = await registerUser();
    await api().post(`/api/v1/activities/${a1.body.data.id}/gps-points`).set(bearer(other)).send({ points: pts }).expect(404);
  });

  it('server recomputes statistics and ignores client-claimed numbers', async () => {
    const u = await registerUser();
    const { data } = await record(u, walk(401), { clientStats: { distanceM: 42_195, movingSeconds: 1200 }, title: 'Morning walk' });
    expect(data.status).toBe('COMPLETED');
    expect(data.distanceM).toBeGreaterThan(1650);
    expect(data.distanceM).toBeLessThan(1710);
    expect(data.movingSeconds).toBe(1200);
    expect(data.flagged).toBe(true);
    expect(data.flags.clientMismatch).toBeTruthy();
    // PostGIS agrees with the engine (route length ≈ distance)
    const [row] = await prisma.$queryRaw<{ len: number }[]>`SELECT ST_Length(route) AS len FROM activities WHERE id = ${data.id}::uuid`;
    expect(Math.abs(row!.len - data.distanceM)).toBeLessThan(25);
  });

  it('flags spoofed/impossible tracks and mock locations', async () => {
    const u = await registerUser();
    const fast = walk(100, 25); // 25 m/s "walk"
    const { data } = await record(u, fast, { mockLocationDetected: true });
    expect(data.flagged).toBe(true);
    expect(data.flags.mockLocation).toBe(true);
  });

  it('completed activities are closed and completion is idempotent', async () => {
    const u = await registerUser();
    const r = await record(u, walk(50));
    await api().post(`/api/v1/activities/${r.id}/gps-points`).set(bearer(u)).send({ points: walk(5) }).expect(409);
    const again = await api().post(`/api/v1/activities/${r.id}/complete`).set(bearer(u)).send({ endedAt: new Date().toISOString() }).expect(200);
    expect(again.body.data.distanceM).toBe(r.data.distanceM);
  });

  it('rejects future timestamps and invalid coordinates', async () => {
    const u = await registerUser();
    await api().post('/api/v1/activities').set(bearer(u)).send({ clientId: randomUUID(), type: 'WALK', startedAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
    const a = await api().post('/api/v1/activities').set(bearer(u)).send({ clientId: randomUUID(), type: 'WALK', startedAt: new Date().toISOString() }).expect(201);
    await api().post(`/api/v1/activities/${a.body.data.id}/gps-points`).set(bearer(u)).send({ points: [{ seq: 0, t: Date.now(), lat: 123, lng: 0 }] }).expect(422);
  });
});

describe('visibility & privacy', () => {
  it('enforces PRIVATE / PUBLIC / club shares and trims route ends for others', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const clubmate = await registerUser();
    const clubOwner = await registerUser();
    const club = await createClub(clubOwner);
    await addMember(club.id, owner.id);
    await addMember(club.id, clubmate.id);

    const priv = await record(owner, walk(401), { visibility: 'PRIVATE' });
    await api().get(`/api/v1/activities/${priv.id}`).set(bearer(stranger)).expect(404);
    await api().get(`/api/v1/activities/${priv.id}`).set(bearer(clubOwner)).expect(404); // club admins get nothing implicitly

    await api().patch(`/api/v1/activities/${priv.id}`).set(bearer(owner)).send({ clubIds: [club.id] }).expect(200);
    await api().get(`/api/v1/activities/${priv.id}`).set(bearer(clubmate)).expect(200);
    const foreignClub = await createClub(stranger);
    await api().patch(`/api/v1/activities/${priv.id}`).set(bearer(owner)).send({ clubIds: [foreignClub.id] }).expect(403);

    const pub = await record(owner, walk(401), { visibility: 'PUBLIC' });
    const own = await api().get(`/api/v1/activities/${pub.id}`).set(bearer(owner)).expect(200);
    const seen = await api().get(`/api/v1/activities/${pub.id}`).expect(200);
    expect(seen.body.data.flags).toBeUndefined();
    const ownRoute = decodePolyline(own.body.data.routePolyline);
    const publicRoute = decodePolyline(seen.body.data.routePolyline);
    expect(haversine(publicRoute[0]!, ownRoute[0]!)).toBeGreaterThan(195);
    expect(haversine(publicRoute.at(-1)!, ownRoute.at(-1)!)).toBeGreaterThan(195);

    // Blocking hides even public activities.
    await api().post(`/api/v1/users/${stranger.id}/block`).set(bearer(owner)).expect(204);
    await api().get(`/api/v1/activities/${pub.id}`).set(bearer(stranger)).expect(404);

    const list = await api().get(`/api/v1/users/${owner.id}/activities`).expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([pub.id]);
  });

  it('leaving a club never removes personal activities', async () => {
    const owner = await registerUser();
    const clubOwner = await registerUser();
    const club = await createClub(clubOwner);
    await addMember(club.id, owner.id);
    const r = await record(owner, walk(60), { clubIds: [club.id] });
    await api().post(`/api/v1/clubs/${club.id}/leave`).set(bearer(owner)).expect(204);
    await api().get(`/api/v1/activities/${r.id}`).set(bearer(owner)).expect(200);
    const mine = await api().get('/api/v1/activities').set(bearer(owner)).expect(200);
    expect(mine.body.data).toHaveLength(1);
  });
});

describe('stats, goals and premium features', () => {
  it('summarises weekly/monthly totals, records and goals; premium analytics are gated', async () => {
    const u = await registerUser();
    await record(u, walk(401));
    await record(u, walk(200, 3), {}, 'RUN');
    await api().post('/api/v1/activities/goals').set(bearer(u)).send({ metric: 'DISTANCE_M', period: 'WEEK', target: 5000 }).expect(201);
    const s = await api().get('/api/v1/activities/stats').set(bearer(u)).expect(200);
    expect(s.body.data.allTime.activities).toBe(2);
    expect(s.body.data.thisWeek.byType.WALK.activities).toBe(1);
    expect(s.body.data.weekly).toHaveLength(12);
    expect(s.body.data.personalRecords.RUN.fastestPace1k).toBeTruthy();
    expect(s.body.data.goals[0].progress).toBeGreaterThan(0.4);
    expect(s.body.data.steps).toBeNull();

    const gated = await api().get('/api/v1/activities/stats/trends').set(bearer(u)).expect(402);
    expect(gated.body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
    const profile = await api().get(`/api/v1/users/${u.username}`).expect(200);
    expect(profile.body.data.stats.totalActivities).toBe(2);
  });

  it('deleting an activity removes its points', async () => {
    const u = await registerUser();
    const r = await record(u, walk(30));
    await api().delete(`/api/v1/activities/${r.id}`).set(bearer(u)).expect(204);
    expect(await prisma.activityGpsPoint.count({ where: { activityId: r.id } })).toBe(0);
  });
});
