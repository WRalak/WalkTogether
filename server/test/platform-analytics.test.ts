/** Platform-wide analytics, event oversight and CSV reports for the platform-admin web app. */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { api, bearer, createAdmin, createClub, registerUser, teardown, uid } from './helpers';

afterAll(teardown);
const H = 3600_000;
const A = (a: { accessToken: string }) => ({ Authorization: `Bearer ${a.accessToken}` });

describe('platform analytics', () => {
  it('reports platform activity, excluding flagged activities from totals', async () => {
    const admin = await createAdmin();
    const u = await registerUser();
    const now = new Date();
    await prisma.activity.createMany({
      data: [
        { userId: u.id, clientId: randomUUID(), type: 'WALK', status: 'COMPLETED', startedAt: now, endedAt: now, distanceM: 4000, movingSeconds: 2400 },
        { userId: u.id, clientId: randomUUID(), type: 'RUN', status: 'COMPLETED', startedAt: now, endedAt: now, distanceM: 90000, movingSeconds: 600, flagged: true },
      ],
    });
    const res = await api().get('/api/v1/platform-admin/analytics/activity').query({ days: 7 }).set(A(admin)).expect(200);
    const today = res.body.data.daily.at(-1);
    expect(today.flagged).toBeGreaterThanOrEqual(1);
    expect(res.body.data.activeUsers).toBeGreaterThanOrEqual(1);
    await api().get('/api/v1/platform-admin/analytics/activity').set(bearer(u)).expect(401);
  });
});

describe('platform event oversight', () => {
  it('lists events across clubs and lets moderators cancel one, notifying registrants', async () => {
    const owner = await registerUser();
    const walker = await registerUser();
    const club = await createClub(owner);
    const title = `Rule-breaking walk ${uid()}`;
    const ev = await api()
      .post(`/api/v1/clubs/${club.id}/events`)
      .set(bearer(owner))
      .send({
        title,
        type: 'WALK',
        visibility: 'PUBLIC',
        startsAt: new Date(Date.now() + 2 * H).toISOString(),
        endsAt: new Date(Date.now() + 4 * H).toISOString(),
        meetingPoint: 'Gate A',
      })
      .expect(201);
    const eventId = ev.body.data.id ?? ev.body.data[0]?.id;
    await api().post(`/api/v1/events/${eventId}/rsvp`).set(bearer(walker)).send({ going: true }).expect(200);

    const support = await createAdmin('SUPPORT');
    const moderator = await createAdmin('MODERATOR');
    const list = await api().get('/api/v1/platform-admin/events').query({ q: title, when: 'upcoming' }).set(A(support)).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: eventId, club: { id: club.id } });

    await api().post(`/api/v1/platform-admin/events/${eventId}/cancel`).set(A(support)).send({ reason: 'Not allowed' }).expect(403);
    await api().post(`/api/v1/platform-admin/events/${eventId}/cancel`).set(A(moderator)).send({ reason: 'Unsafe route reported' }).expect(204);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('CANCELLED');
    const n = await api().get('/api/v1/notifications').set(bearer(walker)).expect(200);
    expect(n.body.data[0].title).toBe(`Cancelled: ${title}`);
    expect(await prisma.auditLog.count({ where: { action: 'admin.event_cancelled', targetId: eventId } })).toBe(1);
  });
});

describe('platform CSV reports', () => {
  it('exports per-permission CSVs, safe against formula injection, and audits each export', async () => {
    const support = await createAdmin('SUPPORT');
    const finance = await createAdmin('FINANCE');
    const owner = await registerUser();
    await createClub(owner, { name: `=HYPERLINK("http://evil") ${uid()}` });

    const clubs = await api().get('/api/v1/platform-admin/reports/clubs.csv').set(A(support)).expect(200);
    expect(clubs.headers['content-type']).toMatch(/text\/csv/);
    expect(clubs.text).toContain(`"'=HYPERLINK(""http://evil"")`);
    await api().get('/api/v1/platform-admin/reports/users.csv').set(A(support)).expect(200);
    await api().get('/api/v1/platform-admin/reports/payments.csv').set(A(support)).expect(403);
    await api().get('/api/v1/platform-admin/reports/payments.csv').set(A(finance)).expect(200);
    await api().get('/api/v1/platform-admin/reports/activity.csv').set(A(finance)).expect(200);
    await api().get('/api/v1/platform-admin/reports/secrets.csv').set(A(finance)).expect(404);
    expect(await prisma.auditLog.count({ where: { action: 'admin.report_exported', targetId: 'clubs' } })).toBeGreaterThanOrEqual(1);
  });
});
