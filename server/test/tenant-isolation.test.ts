/**
 * Multi-tenant isolation & privilege-escalation tests.
 * These prove that permissions held in one club grant nothing in another, that resource ids
 * from another tenant are rejected (IDOR), and that role hierarchy cannot be bypassed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { addMember, api, bearer, createClub, membershipId, registerUser, roleId, teardown, type TestUser } from './helpers';

afterAll(teardown);

let ownerA: TestUser, ownerB: TestUser, adminA: TestUser, memberA: TestUser, memberB: TestUser, pendingB: TestUser;
let clubA: { id: string; slug: string }, clubB: { id: string; slug: string }, secretClub: { id: string; slug: string };

beforeAll(async () => {
  [ownerA, ownerB, adminA, memberA, memberB, pendingB] = await Promise.all([registerUser(), registerUser(), registerUser(), registerUser(), registerUser(), registerUser()]);
  clubA = await createClub(ownerA);
  clubB = await createClub(ownerB, { visibility: 'PRIVATE' });
  secretClub = await createClub(ownerB, { visibility: 'INVITE_ONLY' });
  await addMember(clubA.id, adminA.id, 'ADMIN');
  await addMember(clubA.id, memberA.id, 'MEMBER');
  await addMember(clubB.id, memberB.id, 'MEMBER');
  await api().post(`/api/v1/clubs/${clubB.id}/join`).set(bearer(pendingB)).send({}).expect(202);
});

describe('cross-club access is denied', () => {
  it('an admin of club A cannot list members of club B', async () => {
    await api().get(`/api/v1/clubs/${clubB.id}/members`).set(bearer(adminA)).expect(403);
    await api().get(`/api/v1/clubs/${clubB.id}/members`).query({ status: 'PENDING' }).set(bearer(adminA)).expect(403);
  });

  it('invite-only clubs are indistinguishable from non-existent ones to outsiders', async () => {
    const res = await api().get(`/api/v1/clubs/${secretClub.id}/members`).set(bearer(adminA)).expect(404);
    const ghost = await api().get(`/api/v1/clubs/00000000-0000-4000-8000-000000000000/members`).set(bearer(adminA)).expect(404);
    expect(res.body.error.code).toBe(ghost.body.error.code);
  });

  it('an admin of club A cannot update club B', async () => {
    await api().patch(`/api/v1/clubs/${clubB.id}`).set(bearer(adminA)).send({ name: 'Hijacked' }).expect(403);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: clubB.id } })).name).not.toBe('Hijacked');
  });

  it('cannot approve club B requests through club A’s route (membership IDOR)', async () => {
    const pendingId = await membershipId(clubB.id, pendingB.id);
    await api().post(`/api/v1/clubs/${clubA.id}/members/${pendingId}/review`).set(bearer(ownerA)).send({ decision: 'APPROVE' }).expect(404);
    expect((await prisma.clubMembership.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('PENDING');
  });

  it('cannot moderate or re-role a club B member through club A’s route', async () => {
    const bMember = await membershipId(clubB.id, memberB.id);
    await api().post(`/api/v1/clubs/${clubA.id}/members/${bMember}/moderation`).set(bearer(ownerA)).send({ action: 'REMOVE' }).expect(404);
    await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${bMember}/role`)
      .set(bearer(ownerA))
      .send({ roleId: await roleId(clubA.id, 'ADMIN') })
      .expect(404);
    expect((await prisma.clubMembership.findUniqueOrThrow({ where: { id: bMember } })).status).toBe('ACTIVE');
  });

  it('cannot assign a role belonging to another club', async () => {
    const target = await membershipId(clubA.id, memberA.id);
    await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${target}/role`)
      .set(bearer(ownerA))
      .send({ roleId: await roleId(clubB.id, 'ADMIN') })
      .expect(404);
  });

  it('the database rejects a membership whose role belongs to a different club', async () => {
    await expect(prisma.clubMembership.update({ where: { id: await membershipId(clubA.id, memberA.id) }, data: { roleId: await roleId(clubB.id, 'ADMIN') } })).rejects.toThrow();
  });

  it('cannot create or list invitations for another club', async () => {
    await api().post(`/api/v1/clubs/${clubB.id}/invitations`).set(bearer(adminA)).send({}).expect(403);
    await api().get(`/api/v1/clubs/${clubB.id}/invitations`).set(bearer(adminA)).expect(403);
    await api().post(`/api/v1/clubs/${secretClub.id}/invitations`).set(bearer(adminA)).send({}).expect(404);
  });

  it('club detail exposes no viewer permissions from other clubs', async () => {
    const res = await api().get(`/api/v1/clubs/${clubB.id}`).set(bearer(adminA)).expect(200);
    expect(res.body.data.viewer).toEqual({ membershipStatus: null, role: null, permissions: [] });
    expect(res.body.data.contactEmail).toBeNull();
  });
});

describe('role hierarchy and privilege escalation', () => {
  it('ordinary members cannot change roles, approve, invite or edit the club', async () => {
    const target = await membershipId(clubA.id, adminA.id);
    await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${target}/role`)
      .set(bearer(memberA))
      .send({ roleId: await roleId(clubA.id, 'MEMBER') })
      .expect(403);
    await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, memberA.id)}/role`)
      .set(bearer(memberA))
      .send({ roleId: await roleId(clubA.id, 'ADMIN') })
      .expect(403);
    await api().post(`/api/v1/clubs/${clubA.id}/invitations`).set(bearer(memberA)).send({}).expect(403);
    await api().patch(`/api/v1/clubs/${clubA.id}`).set(bearer(memberA)).send({ name: 'Nope' }).expect(403);
  });

  it('an event organizer cannot approve members or manage billing-level settings', async () => {
    const organizer = await registerUser();
    await addMember(clubA.id, organizer.id, 'EVENT_ORGANIZER');
    await api().get(`/api/v1/clubs/${clubA.id}/members`).query({ status: 'PENDING' }).set(bearer(organizer)).expect(403);
    await api().patch(`/api/v1/clubs/${clubA.id}`).set(bearer(organizer)).send({ description: 'x' }).expect(403);
  });

  it('nobody can assign the OWNER role or modify the owner', async () => {
    const ownerRole = await roleId(clubA.id, 'OWNER');
    const res = await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, memberA.id)}/role`)
      .set(bearer(ownerA))
      .send({ roleId: ownerRole })
      .expect(403);
    expect(res.body.error.code).toBe('OWNER_ROLE_NOT_ASSIGNABLE');
    const ownerMembership = await membershipId(clubA.id, ownerA.id);
    const demote = await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${ownerMembership}/role`)
      .set(bearer(adminA))
      .send({ roleId: await roleId(clubA.id, 'MEMBER') })
      .expect(403);
    expect(demote.body.error.code).toBe('OWNER_PROTECTED');
    await api().post(`/api/v1/clubs/${clubA.id}/members/${ownerMembership}/moderation`).set(bearer(adminA)).send({ action: 'REMOVE' }).expect(403);
  });

  it('members cannot act on themselves', async () => {
    const res = await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, adminA.id)}/role`)
      .set(bearer(adminA))
      .send({ roleId: await roleId(clubA.id, 'ADMIN') })
      .expect(403);
    expect(res.body.error.code).toBe('SELF_ACTION');
  });

  it('a moderator cannot suspend an admin (target has more permissions)', async () => {
    const mod = await registerUser();
    await addMember(clubA.id, mod.id, 'MODERATOR');
    const res = await api()
      .post(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, adminA.id)}/moderation`)
      .set(bearer(mod))
      .send({ action: 'SUSPEND' })
      .expect(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_RANK');
  });

  it('an admin cannot grant a custom role with permissions they do not hold', async () => {
    const powerful = await prisma.clubRole.create({
      data: { clubId: clubA.id, name: 'Treasurer', permissions: { create: [{ permissionKey: 'billing.manage' }] } },
    });
    const res = await api()
      .put(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, memberA.id)}/role`)
      .set(bearer(adminA))
      .send({ roleId: powerful.id })
      .expect(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    const inv = await api().post(`/api/v1/clubs/${clubA.id}/invitations`).set(bearer(adminA)).send({ roleId: powerful.id }).expect(403);
    expect(inv.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });

  it('suspended members immediately lose club permissions', async () => {
    const helper = await registerUser();
    await addMember(clubA.id, helper.id, 'ADMIN');
    await api().get(`/api/v1/clubs/${clubA.id}/members`).set(bearer(helper)).expect(200);
    await api()
      .post(`/api/v1/clubs/${clubA.id}/members/${await membershipId(clubA.id, helper.id)}/moderation`)
      .set(bearer(ownerA))
      .send({ action: 'SUSPEND' })
      .expect(200);
    await api().get(`/api/v1/clubs/${clubA.id}/members`).set(bearer(helper)).expect(403);
  });

  it('suspended clubs refuse mutations', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    await prisma.club.update({ where: { id: club.id }, data: { status: 'SUSPENDED' } });
    const res = await api().patch(`/api/v1/clubs/${club.id}`).set(bearer(owner)).send({ name: 'Still here' }).expect(403);
    expect(res.body.error.code).toBe('CLUB_NOT_ACTIVE');
  });
});

describe('member and admin planes are separate', () => {
  it('member tokens (even club owners) cannot reach platform-admin endpoints', async () => {
    await api().get('/api/v1/platform-admin/me').set(bearer(ownerA)).expect(401);
    await api().get('/api/v1/platform-admin/users').set(bearer(ownerA)).expect(401);
  });
});

describe('club activity feed', () => {
  it('shows only activities shared with that club, and only to its members', async () => {
    const { randomUUID } = await import('node:crypto');
    const now = new Date();
    const shared = await prisma.activity.create({
      data: {
        userId: memberA.id,
        clientId: randomUUID(),
        type: 'WALK',
        status: 'COMPLETED',
        startedAt: now,
        endedAt: now,
        distanceM: 3200,
        movingSeconds: 2400,
        routePolyline: 'secret',
        clubShares: { create: { clubId: clubA.id } },
      },
    });
    const notShared = await prisma.activity.create({
      data: { userId: memberA.id, clientId: randomUUID(), type: 'RUN', status: 'COMPLETED', startedAt: now, endedAt: now, distanceM: 5000, movingSeconds: 1500 },
    });
    const res = await api().get(`/api/v1/clubs/${clubA.id}/activities`).set(bearer(adminA)).expect(200);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).toContain(shared.id);
    expect(ids).not.toContain(notShared.id);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body.meta.lastSevenDays.activities).toBeGreaterThanOrEqual(1);

    await api()
      .get(`/api/v1/clubs/${clubA.id}/activities`)
      .set(bearer(memberB))
      .expect((r) => expect([403, 404]).toContain(r.status));
    await api()
      .get(`/api/v1/clubs/${clubB.id}/activities`)
      .set(bearer(adminA))
      .expect((r) => expect([403, 404]).toContain(r.status));
  });
});
