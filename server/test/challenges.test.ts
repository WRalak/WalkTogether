import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { finalizeEndedChallenges } from '../src/modules/challenges/challenges.service';
import { computeLeaderboards } from '../src/modules/challenges/leaderboards.service';
import { activateSubscription } from '../src/modules/subscriptions/subscriptions.service';
import { addMember, api, bearer, createAdmin, createClub, registerUser, teardown, uid, type TestUser } from './helpers';

afterAll(teardown);
const DAY = 86_400_000;

/** Records a straight-line activity of ~distanceM at `speed` via the real API. */
async function record(u: TestUser, distanceM: number, opts: { type?: string; speed?: number; daysAgo?: number; visibility?: string; clubIds?: string[] } = {}) {
  const speed = opts.speed ?? 1.4;
  const n = Math.max(3, Math.round(distanceM / (speed * 3)) + 1);
  const t0 = Date.now() - (opts.daysAgo ?? 0) * DAY - n * 3000 - 120_000;
  const dLat = (speed * 3) / 111_195;
  const a = await api()
    .post('/api/v1/activities')
    .set(bearer(u))
    .send({ clientId: randomUUID(), type: opts.type ?? 'WALK', startedAt: new Date(t0).toISOString() })
    .expect(201);
  const pts = Array.from({ length: n }, (_, i) => ({ seq: i, t: t0 + i * 3000, lat: -1.29 + dLat * i, lng: 36.82, accuracy: 5 }));
  for (let i = 0; i < pts.length; i += 1000)
    await api()
      .post(`/api/v1/activities/${a.body.data.id}/gps-points`)
      .set(bearer(u))
      .send({ points: pts.slice(i, i + 1000) })
      .expect(200);
  await api()
    .post(`/api/v1/activities/${a.body.data.id}/complete`)
    .set(bearer(u))
    .send({ endedAt: new Date(t0 + n * 3000).toISOString(), visibility: opts.visibility ?? 'PUBLIC', clubIds: opts.clubIds })
    .expect(200);
  return a.body.data.id as string;
}

async function proClub(clubId: string) {
  const plan = await prisma.subscriptionPlan.create({
    data: { code: `ch_${uid()}`, audience: 'CLUB', name: 'Pro', isActive: true, entitlements: { create: [{ key: 'club.challenges', boolValue: true }] } },
  });
  await prisma.$transaction((tx) => activateSubscription({ clubId }, plan.id, tx));
}

const challengeBody = (o: Record<string, unknown> = {}) => ({
  title: 'November 50K',
  metric: 'DISTANCE_M',
  activityTypes: ['WALK', 'RUN'],
  target: 3000,
  startsAt: new Date(Date.now() - 3 * DAY).toISOString(),
  endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
  ...o,
});

describe('club challenges', () => {
  it('requires permission and plan; tracks server-computed progress, completion and achievements', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, member.id);
    expect((await api().post(`/api/v1/clubs/${club.id}/challenges`).set(bearer(owner)).send(challengeBody()).expect(402)).body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
    await proClub(club.id);
    await api().post(`/api/v1/clubs/${club.id}/challenges`).set(bearer(member)).send(challengeBody()).expect(403);
    const c = await api().post(`/api/v1/clubs/${club.id}/challenges`).set(bearer(owner)).send(challengeBody()).expect(201);
    const id = c.body.data.id;
    expect((await api().get('/api/v1/notifications').set(bearer(member))).body.data[0].type).toBe('challenge.invitation');

    await record(member, 1000, { daysAgo: 1 }); // before joining: still counts (inside window)
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(member)).send({}).expect(200);
    let me = (await api().get(`/api/v1/challenges/${id}`).set(bearer(member)).expect(200)).body.data.me;
    expect(me.progressValue).toBeGreaterThan(900);
    await record(member, 2200);
    me = (await api().get(`/api/v1/challenges/${id}`).set(bearer(member)).expect(200)).body.data.me;
    expect(me.completedAt).toBeTruthy();
    const types = (await api().get('/api/v1/notifications').set(bearer(member))).body.data.map((n: { type: string }) => n.type);
    expect(types).toEqual(expect.arrayContaining(['challenge.completed', 'achievement.earned']));
    const ach = (await api().get('/api/v1/achievements/me').set(bearer(member)).expect(200)).body.data;
    expect(ach.find((a: { code: string }) => a.code === 'first_walk').earnedAt).toBeTruthy();
    expect(ach.find((a: { code: string }) => a.code === '10k').earnedAt).toBeNull();
  });

  it('flagged (spoofed) activities and over-cap distance never count', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    await proClub(club.id);
    const c = await api()
      .post(`/api/v1/clubs/${club.id}/challenges`)
      .set(bearer(owner))
      .send(challengeBody({ target: null, maxDailyDistanceM: 2000 }))
      .expect(201);
    await api().post(`/api/v1/challenges/${c.body.data.id}/join`).set(bearer(owner)).send({}).expect(200);
    await record(owner, 5000, { speed: 30 }); // impossible "walk" → flagged
    await record(owner, 3000); // capped to 2000 for the day
    const lb = (await api().get(`/api/v1/challenges/${c.body.data.id}/leaderboard`).set(bearer(owner)).expect(200)).body.data;
    expect(lb.entries[0].value).toBe(2000);
  });

  it('members-only challenges are invisible to outsiders; outsiders cannot join', async () => {
    const owner = await registerUser();
    const outsider = await registerUser();
    const club = await createClub(owner);
    await proClub(club.id);
    const c = await api()
      .post(`/api/v1/clubs/${club.id}/challenges`)
      .set(bearer(owner))
      .send(challengeBody({ visibility: 'MEMBERS' }))
      .expect(201);
    await api().get(`/api/v1/challenges/${c.body.data.id}`).set(bearer(outsider)).expect(404);
    const pub = await api().post(`/api/v1/clubs/${club.id}/challenges`).set(bearer(owner)).send(challengeBody()).expect(201);
    await api().post(`/api/v1/challenges/${pub.body.data.id}/join`).set(bearer(outsider)).send({}).expect(403);
  });
});

describe('platform challenges, club-vs-club, premium and results', () => {
  it('club-vs-club ranks teams by average; privacy-hidden participants are anonymous; results are finalized', async () => {
    const admin = await createAdmin();
    const [o1, o2, a, b, c] = [await registerUser(), await registerUser(), await registerUser(), await registerUser(), await registerUser()];
    const [c1, c2] = [await createClub(o1), await createClub(o2)];
    await addMember(c1.id, a.id);
    await addMember(c1.id, b.id);
    await addMember(c2.id, c.id);
    const ch = await api()
      .post('/api/v1/platform-admin/challenges')
      .set({ Authorization: `Bearer ${admin.accessToken}` })
      .send(challengeBody({ scope: 'CLUB_VS_CLUB', clubIds: [c1.id, c2.id], target: null, title: `Derby ${uid()}` }))
      .expect(201);
    const id = ch.body.data.id;
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(a)).send({}).expect(400);
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(a)).send({ teamClubId: c2.id }).expect(403);
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(a)).send({ teamClubId: c1.id }).expect(200);
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(b)).send({ teamClubId: c1.id, hideFromLeaderboard: true }).expect(200);
    await api().post(`/api/v1/challenges/${id}/join`).set(bearer(c)).send({ teamClubId: c2.id }).expect(200);
    await record(a, 3000);
    await record(b, 300);
    await record(c, 2000);
    const lb = (await api().get(`/api/v1/challenges/${id}/leaderboard`).set(bearer(a)).expect(200)).body.data;
    expect(lb.teams[0].clubId).toBe(c2.id); // 2000 avg beats (3000+300)/2 = 1650
    expect(lb.entries.find((e: { user: unknown; isMe: boolean }) => e.user === null)).toBeTruthy();

    await prisma.challenge.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 5 * DAY) } });
    await finalizeEndedChallenges();
    const results = await prisma.challengeResult.findMany({ where: { challengeId: id }, orderBy: { rank: 'asc' } });
    expect(results[0]!.userId).toBe(a.id);
    const winnerAch = (await api().get('/api/v1/achievements/me').set(bearer(a))).body.data.find((x: { code: string }) => x.code === 'challenge_winner');
    expect(winnerAch.earnedAt).toBeTruthy();
  });

  it('premium challenges require an individual premium subscription (not a club plan)', async () => {
    const admin = await createAdmin();
    const u = await registerUser();
    const ch = await api()
      .post('/api/v1/platform-admin/challenges')
      .set({ Authorization: `Bearer ${admin.accessToken}` })
      .send(challengeBody({ scope: 'PLATFORM', isPremium: true }))
      .expect(201);
    expect((await api().post(`/api/v1/challenges/${ch.body.data.id}/join`).set(bearer(u)).send({}).expect(402)).body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
    const plan = await prisma.subscriptionPlan.create({
      data: { code: `prem_${uid()}`, audience: 'INDIVIDUAL', name: 'Premium', isActive: true, entitlements: { create: [{ key: 'user.premium_challenges', boolValue: true }] } },
    });
    await prisma.$transaction((tx) => activateSubscription({ userId: u.id }, plan.id, tx));
    await api().post(`/api/v1/challenges/${ch.body.data.id}/join`).set(bearer(u)).send({}).expect(200);
  });
});

describe('leaderboards', () => {
  it('global boards include only public profiles; club boards only shared activities; following board on demand', async () => {
    const [pub, priv, friend] = [await registerUser(), await registerUser(), await registerUser()];
    await api().patch('/api/v1/users/me/privacy').set(bearer(priv)).send({ profileVisibility: 'PRIVATE' }).expect(200);
    const owner = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, pub.id);
    await record(pub, 4000, { clubIds: [club.id] });
    await record(priv, 9000);
    await record(friend, 1500, { visibility: 'FOLLOWERS' });
    await computeLeaderboards();
    const global = (await api().get('/api/v1/leaderboards').query({ period: 'WEEK' }).expect(200)).body.data.entries.map((e: { user: { id: string } }) => e.user.id);
    expect(global).toContain(pub.id);
    expect(global).not.toContain(priv.id);
    const clubLb = (await api().get('/api/v1/leaderboards').query({ scope: 'CLUB', clubId: club.id }).set(bearer(pub)).expect(200)).body.data.entries;
    expect(clubLb.map((e: { user: { id: string } }) => e.user.id)).toEqual([pub.id]);
    await api().get('/api/v1/leaderboards').query({ scope: 'CLUB', clubId: club.id }).set(bearer(priv)).expect(403);
    await api().post(`/api/v1/users/${friend.id}/follow`).set(bearer(pub)).expect(200);
    const following = (await api().get('/api/v1/leaderboards/following').set(bearer(pub)).expect(200)).body.data.entries;
    expect(following.map((e: { user: { id: string } }) => e.user.id)).toEqual([pub.id, friend.id]);
  });
});
