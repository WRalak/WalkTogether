import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { sendEventReminders } from '../src/modules/events/events.service';
import { activateSubscription } from '../src/modules/subscriptions/subscriptions.service';
import { addMember, api, bearer, createClub, registerUser, teardown, uid } from './helpers';

afterAll(teardown);
const H = 3600_000;

async function proClub(ownerToken: { accessToken: string }, club: { id: string }) {
  const plan = await prisma.subscriptionPlan.create({
    data: { code: `ev_${uid()}`, audience: 'CLUB', name: 'Pro', isActive: true, entitlements: { create: [{ key: 'club.recurring_events', boolValue: true }, { key: 'club.exports', boolValue: true }, { key: 'club.analytics_advanced', boolValue: true }, { key: 'club.max_events_per_month', intLimit: 500 }] } },
  });
  await prisma.$transaction((tx) => activateSubscription({ clubId: club.id }, plan.id, tx));
  void ownerToken;
}

const eventBody = (o: Record<string, unknown> = {}) => ({
  title: 'Karura Saturday Walk',
  type: 'WALK',
  startsAt: new Date(Date.now() + 2 * H).toISOString(),
  endsAt: new Date(Date.now() + 4 * H).toISOString(),
  meetingPoint: 'Karura Gate A',
  meetingLat: -1.2341,
  meetingLng: 36.8327,
  ...o,
});

describe('events', () => {
  it('organizers create events; members see them; outsiders do not see MEMBERS events', async () => {
    const owner = await registerUser();
    const organizer = await registerUser();
    const member = await registerUser();
    const outsider = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, organizer.id, 'EVENT_ORGANIZER');
    await addMember(club.id, member.id);
    await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(member)).send(eventBody()).expect(403);
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(organizer)).send(eventBody()).expect(201);
    await api().get(`/api/v1/events/${ev.body.data.id}`).set(bearer(member)).expect(200);
    await api().get(`/api/v1/events/${ev.body.data.id}`).set(bearer(outsider)).expect(404);
    const list = await api().get(`/api/v1/clubs/${club.id}/events`).set(bearer(outsider)).expect(200);
    expect(list.body.data).toHaveLength(0);
    // Public events of public clubs are discoverable, also by location.
    const pub = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(organizer)).send(eventBody({ visibility: 'PUBLIC', title: `Public ${uid()}` })).expect(201);
    const near = await api().get('/api/v1/events').query({ near: '-1.2341,36.8327', radiusKm: 2 }).expect(200);
    expect(near.body.data.map((e: { id: string }) => e.id)).toContain(pub.body.data.id);
  });

  it('enforces the monthly event limit and gates recurring events by plan', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const free = await prisma.subscriptionPlan.create({ data: { code: `lim_${uid()}`, audience: 'CLUB', name: 'Tiny', isActive: true, entitlements: { create: [{ key: 'club.max_events_per_month', intLimit: 1 }] } } });
    await prisma.$transaction((tx) => activateSubscription({ clubId: club.id }, free.id, tx));
    await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody()).expect(201);
    expect((await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody()).expect(402)).body.error.code).toBe('PLAN_LIMIT_REACHED');
    const rec = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody({ recurrence: { frequency: 'WEEKLY', count: 4 } })).expect(402);
    expect(rec.body.error.code).toBe('PLAN_UPGRADE_REQUIRED');
  });

  it('recurring events create occurrences; series cancellation notifies registrants', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await proClub(owner, club);
    await addMember(club.id, member.id);
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody({ recurrence: { frequency: 'WEEKLY', count: 4 } })).expect(201);
    const series = await prisma.event.findMany({ where: { seriesId: ev.body.data.seriesId }, orderBy: { startsAt: 'asc' } });
    expect(series).toHaveLength(4);
    expect(series[1]!.startsAt.getTime() - series[0]!.startsAt.getTime()).toBe(7 * 24 * H);
    await api().post(`/api/v1/events/${series[2]!.id}/rsvp`).set(bearer(member)).send({ going: true }).expect(200);
    await api().post(`/api/v1/events/${series[1]!.id}/cancel`).set(bearer(owner)).send({ reason: 'Venue closed for repairs', applyToSeries: true }).expect(204);
    expect(await prisma.event.count({ where: { seriesId: ev.body.data.seriesId, status: 'CANCELLED' } })).toBe(3);
    const notes = await api().get('/api/v1/notifications').set(bearer(member)).expect(200);
    expect(notes.body.data[0].type).toBe('event.cancelled');
  });

  it('RSVP respects capacity with a waitlist and promotes on cancellation', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    for (const u of [a, b, c]) await addMember(club.id, u.id);
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody({ maxParticipants: 2 })).expect(201);
    const id = ev.body.data.id;
    const results = await Promise.all([a, b, c].map((u) => api().post(`/api/v1/events/${id}/rsvp`).set(bearer(u)).send({ going: true })));
    const statuses = results.map((r) => r.body.data.status).sort();
    expect(statuses).toEqual(['GOING', 'GOING', 'WAITLISTED']);
    expect((await prisma.event.findUniqueOrThrow({ where: { id } })).goingCount).toBe(2);
    const goingUser = [a, b, c][results.findIndex((r) => r.body.data.status === 'GOING')]!;
    const waitUser = [a, b, c][results.findIndex((r) => r.body.data.status === 'WAITLISTED')]!;
    await api().post(`/api/v1/events/${id}/rsvp`).set(bearer(goingUser)).send({ going: false }).expect(200);
    const promoted = await prisma.eventRegistration.findUniqueOrThrow({ where: { eventId_userId: { eventId: id, userId: waitUser.id } } });
    expect(promoted.status).toBe('GOING');
    expect((await prisma.event.findUniqueOrThrow({ where: { id } })).goingCount).toBe(2);
  });

  it('QR check-in requires the rotating organizer code; GPS proximity is only recorded', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, member.id);
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody({ startsAt: new Date(Date.now() + 10 * 60_000).toISOString() })).expect(201);
    const id = ev.body.data.id;
    await api().get(`/api/v1/events/${id}/check-in-code`).set(bearer(member)).expect(403);
    const code = (await api().get(`/api/v1/events/${id}/check-in-code`).set(bearer(owner)).expect(200)).body.data.code;
    await api().post(`/api/v1/events/${id}/check-in`).set(bearer(member)).send({ code: `${code.split('.')[0]}.forgedforgedforgedforg` }).expect(400);
    const res = await api().post(`/api/v1/events/${id}/check-in`).set(bearer(member)).send({ code, lat: -1.2345, lng: 36.833 }).expect(200);
    expect(res.body.data.method).toBe('QR');
    expect(res.body.data.distanceFromMeetingM).toBeLessThan(100);
    // A code from another event is rejected.
    const other = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody({ startsAt: new Date(Date.now() + 10 * 60_000).toISOString() })).expect(201);
    await api().post(`/api/v1/events/${other.body.data.id}/check-in`).set(bearer(member)).send({ code }).expect(400);
  });

  it('organizer-assisted attendance, reports and CSV export (with formula-injection guard)', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await proClub(owner, club);
    await addMember(club.id, member.id);
    await prisma.userProfile.update({ where: { userId: member.id }, data: { displayName: '=HYPERLINK("evil")' } });
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody()).expect(201);
    const id = ev.body.data.id;
    await api().post(`/api/v1/events/${id}/rsvp`).set(bearer(member)).send({ going: true }).expect(200);
    await api().post(`/api/v1/events/${id}/attendance`).set(bearer(owner)).send({ userId: member.id, present: true }).expect(204);
    const p = await api().get(`/api/v1/events/${id}/participants`).set(bearer(owner)).expect(200);
    expect(p.body.data).toMatchObject({ going: 1, attended: 1 });
    const csv = await api().get(`/api/v1/events/${id}/attendance.csv`).set(bearer(owner)).expect(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""evil"")"`);
    const members = await api().get(`/api/v1/clubs/${club.id}/reports/members.csv`).set(bearer(owner)).expect(200);
    expect(members.text.split('\r\n')[0]).toBe('name,username,role,status,joined_at');
    await api().get(`/api/v1/clubs/${club.id}/reports/members.csv`).set(bearer(member)).expect(403);
    const overview = await api().get(`/api/v1/clubs/${club.id}/analytics`).set(bearer(owner)).expect(200);
    expect(overview.body.data.members.active).toBe(2);
    const growth = await api().get(`/api/v1/clubs/${club.id}/analytics/growth`).set(bearer(owner)).expect(200);
    expect(growth.body.data.newMembers).toHaveLength(12);
  });

  it('sends each reminder once to people going', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, member.id);
    const ev = await api().post(`/api/v1/clubs/${club.id}/events`).set(bearer(owner)).send(eventBody()).expect(201);
    await api().post(`/api/v1/events/${ev.body.data.id}/rsvp`).set(bearer(member)).send({ going: true }).expect(200);
    await sendEventReminders();
    await sendEventReminders();
    const notes = (await api().get('/api/v1/notifications').set(bearer(member)).expect(200)).body.data.filter((n: { type: string }) => n.type === 'event.reminder');
    expect(notes).toHaveLength(1);
  });

  it('event ids from another club cannot be managed (tenant isolation)', async () => {
    const ownerA = await registerUser();
    const ownerB = await registerUser();
    const clubA = await createClub(ownerA);
    await createClub(ownerB);
    const ev = await api().post(`/api/v1/clubs/${clubA.id}/events`).set(bearer(ownerA)).send(eventBody()).expect(201);
    // Club A is public, so the event's club is visible (403); invite-only clubs would yield 404.
    await api().patch(`/api/v1/events/${ev.body.data.id}`).set(bearer(ownerB)).send({ title: 'Hijacked' }).expect(403);
    await api().get(`/api/v1/events/${ev.body.data.id}/participants`).set(bearer(ownerB)).expect(403);
    await api().post(`/api/v1/events/${ev.body.data.id}/cancel`).set(bearer(ownerB)).send({ reason: 'nope nope' }).expect(403);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: ev.body.data.id } })).title).not.toBe('Hijacked');
  });
});
