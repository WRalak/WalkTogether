import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { devPushOutbox } from '../src/modules/notifications/push';
import { runSubscriptionLifecycle, activateSubscription } from '../src/modules/subscriptions/subscriptions.service';
import { resolveEntitlements, invalidateEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { addMember, api, bearer, createAdmin, createClub, membershipId, registerUser, roleId, teardown, uid } from './helpers';

afterAll(teardown);

async function plan(code: string, audience: 'CLUB' | 'INDIVIDUAL', ent: Record<string, number | boolean>) {
  return prisma.subscriptionPlan.create({
    data: {
      code: `${code}_${uid()}`,
      audience,
      name: code,
      isActive: true,
      amountMinor: 100000,
      entitlements: { create: Object.entries(ent).map(([key, v]) => (typeof v === 'number' ? { key, intLimit: v } : { key, boolValue: v })) },
    },
  });
}

describe('custom roles & ownership', () => {
  it('owners create custom roles; non-owners cannot escalate; system roles are protected', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, admin.id, 'ADMIN');
    const role = await api()
      .post(`/api/v1/clubs/${club.id}/roles`)
      .set(bearer(owner))
      .send({ name: 'Ride Captain', permissions: ['events.manage', 'attendance.manage', 'members.view'] })
      .expect(201);
    await api()
      .post(`/api/v1/clubs/${club.id}/roles`)
      .set(bearer(admin))
      .send({ name: 'Treasurer', permissions: ['billing.manage'] })
      .expect(403);
    await api()
      .patch(`/api/v1/clubs/${club.id}/roles/${await roleId(club.id, 'OWNER')}`)
      .set(bearer(owner))
      .send({ permissions: [] })
      .expect(403);
    await api()
      .delete(`/api/v1/clubs/${club.id}/roles/${await roleId(club.id, 'MEMBER')}`)
      .set(bearer(owner))
      .expect(403);
    await api()
      .patch(`/api/v1/clubs/${club.id}/roles/${role.body.data.id}`)
      .set(bearer(owner))
      .send({ permissions: ['events.manage'] })
      .expect(200);
    await api().delete(`/api/v1/clubs/${club.id}/roles/${role.body.data.id}`).set(bearer(owner)).expect(204);
  });

  it('transfers ownership with re-authentication', async () => {
    const owner = await registerUser();
    const heir = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, heir.id);
    const mid = await membershipId(club.id, heir.id);
    await api().post(`/api/v1/clubs/${club.id}/transfer-ownership`).set(bearer(owner)).send({ membershipId: mid, password: 'wrong-password-1' }).expect(401);
    await api().post(`/api/v1/clubs/${club.id}/transfer-ownership`).set(bearer(heir)).send({ membershipId: mid }).expect(403);
    await api().post(`/api/v1/clubs/${club.id}/transfer-ownership`).set(bearer(owner)).send({ membershipId: mid, password: owner.password }).expect(200);
    const c = await prisma.club.findUniqueOrThrow({ where: { id: club.id } });
    expect(c.ownerId).toBe(heir.id);
    // Former owner can now leave; new owner cannot.
    await api().post(`/api/v1/clubs/${club.id}/leave`).set(bearer(owner)).expect(204);
    await api().post(`/api/v1/clubs/${club.id}/leave`).set(bearer(heir)).expect(409);
  });
});

describe('announcements', () => {
  it('are members-only and notify members by preference', async () => {
    const owner = await registerUser();
    const fan = await registerUser();
    const quiet = await registerUser();
    const outsider = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, fan.id);
    await addMember(club.id, quiet.id);
    await api().patch('/api/v1/users/me/notification-settings').set(bearer(quiet)).send({ clubAnnouncements: false }).expect(200);
    await api()
      .post(`/api/v1/users/me/devices`)
      .set(bearer(fan))
      .send({ pushToken: `ExponentPushToken[${uid()}]`, platform: 'android' })
      .expect(201);

    await api().post(`/api/v1/clubs/${club.id}/announcements`).set(bearer(fan)).send({ title: 'Hi', body: 'x' }).expect(403);
    const a = await api().post(`/api/v1/clubs/${club.id}/announcements`).set(bearer(owner)).send({ title: 'Saturday walk moved', body: 'We start at 6:30 at Gate A.' }).expect(201);

    const fanNotes = await api().get('/api/v1/notifications').set(bearer(fan)).expect(200);
    expect(fanNotes.body.data[0]).toMatchObject({ type: 'club.announcement' });
    expect(fanNotes.body.meta.unread).toBe(1);
    const quietNotes = await api().get('/api/v1/notifications').set(bearer(quiet)).expect(200);
    expect(quietNotes.body.data).toHaveLength(0);
    expect(devPushOutbox.some((p) => p.title.includes('Saturday walk moved'))).toBe(true);

    await api().get(`/api/v1/clubs/${club.id}/announcements`).set(bearer(outsider)).expect(403);
    const list = await api().get(`/api/v1/clubs/${club.id}/announcements`).set(bearer(fan)).expect(200);
    expect(list.body.data[0].id).toBe(a.body.data.id);
    await api().post('/api/v1/notifications/read-all').set(bearer(fan)).expect(200);
    expect((await api().get('/api/v1/notifications').set(bearer(fan))).body.meta.unread).toBe(0);
  });
});

describe('plans & entitlements', () => {
  it('enforces the admin seat limit and lifts it when the club upgrades', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const free = await plan('free_test', 'CLUB', { 'club.max_admins': 1 });
    await prisma.subscription.create({
      data: { clubId: club.id, planId: free.id, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000) },
    });
    await invalidateEntitlements({ clubId: club.id });
    const [a, b] = [await registerUser(), await registerUser()];
    await addMember(club.id, a.id);
    await addMember(club.id, b.id);
    const adminRole = await roleId(club.id, 'ADMIN');
    await api()
      .put(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, a.id)}/role`)
      .set(bearer(owner))
      .send({ roleId: adminRole })
      .expect(200);
    const blocked = await api()
      .put(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, b.id)}/role`)
      .set(bearer(owner))
      .send({ roleId: adminRole })
      .expect(402);
    expect(blocked.body.error.code).toBe('PLAN_LIMIT_REACHED');

    const pro = await plan('pro_test', 'CLUB', { 'club.max_admins': 10 });
    await prisma.$transaction((tx) => activateSubscription({ clubId: club.id }, pro.id, tx));
    await api()
      .put(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, b.id)}/role`)
      .set(bearer(owner))
      .send({ roleId: adminRole })
      .expect(200);
  });

  it('club and individual subscriptions are independent', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const pro = await plan('pro_indep', 'CLUB', { 'club.exports': true });
    await prisma.$transaction((tx) => activateSubscription({ clubId: club.id }, pro.id, tx));
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(true);
    const mine = await api().get('/api/v1/subscriptions/me').set(bearer(owner)).expect(200);
    expect(mine.body.data.subscription).toBeNull();
    expect(mine.body.data.entitlements.values['user.advanced_analytics']).toBe(false);
    expect(mine.body.data.entitlements.values['club.exports']).toBeUndefined();
  });

  it('lifecycle: period end → grace → expired, keeping data and falling back to free', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const pro = await plan('pro_life', 'CLUB', { 'club.exports': true });
    const sub = await prisma.subscription.create({
      data: { clubId: club.id, planId: pro.id, status: 'ACTIVE', currentPeriodStart: new Date(Date.now() - 40 * 86400000), currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    await runSubscriptionLifecycle();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('GRACE');
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(true);
    await prisma.subscription.update({ where: { id: sub.id }, data: { graceUntil: new Date(Date.now() - 1000) } });
    await runSubscriptionLifecycle();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('EXPIRED');
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(false);
    const notes = await api().get('/api/v1/notifications').set(bearer(owner)).expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toEqual(expect.arrayContaining(['subscription.expired', 'subscription.expiring']));
  });

  it('billing details require billing.view; plans are admin-managed', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, member.id);
    await api().get(`/api/v1/subscriptions/clubs/${club.id}`).set(bearer(member)).expect(403);
    await api().get(`/api/v1/subscriptions/clubs/${club.id}`).set(bearer(owner)).expect(200);

    const admin = await createAdmin('FINANCE');
    const created = await api()
      .post('/api/v1/platform-admin/plans')
      .set({ Authorization: `Bearer ${admin.accessToken}` })
      .send({
        code: `pro_${uid()}`,
        audience: 'CLUB',
        name: 'Pro KE',
        currency: 'kes',
        amountMinor: 150000,
        interval: 'MONTH',
        isActive: true,
        entitlements: [{ key: 'club.exports', boolValue: true }],
      })
      .expect(201);
    const plans = await api().get('/api/v1/subscriptions/plans').query({ audience: 'CLUB' }).expect(200);
    expect(plans.body.data.some((p: { id: string; currency: string }) => p.id === created.body.data.id && p.currency === 'KES')).toBe(true);
    await api()
      .post('/api/v1/platform-admin/subscriptions/grant')
      .set({ Authorization: `Bearer ${admin.accessToken}` })
      .send({ planId: created.body.data.id, clubId: club.id })
      .expect(201);
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(true);
  });
});
