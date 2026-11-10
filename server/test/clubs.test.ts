import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { addMember, api, bearer, createClub, membershipId, registerUser, teardown, uid } from './helpers';

afterAll(teardown);

describe('club creation', () => {
  it('requires a verified email or phone', async () => {
    const u = await registerUser({ verified: false });
    const res = await api().post('/api/v1/clubs').set(bearer(u)).send({ name: 'Unverified Club', slug: `c-${uid()}`, category: 'WALKING', visibility: 'PUBLIC' }).expect(403);
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
  });

  it('creates a club with system roles and makes the creator the owner', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { latitude: -1.2921, longitude: 36.8219, city: 'Nairobi', countryCode: 'KE' });
    const detail = await api().get(`/api/v1/clubs/${club.slug}`).set(bearer(owner)).expect(200);
    expect(detail.body.data).toMatchObject({ memberCount: 1, viewer: { membershipStatus: 'ACTIVE', role: 'Club Owner' }, latitude: -1.2921, longitude: 36.8219 });
    expect(detail.body.data.viewer.permissions).toContain('billing.manage');
    const roles = await api().get(`/api/v1/clubs/${club.id}/roles`).set(bearer(owner)).expect(200);
    expect(roles.body.data.map((r: { systemKey: string }) => r.systemKey)).toEqual(['OWNER', 'ADMIN', 'EVENT_ORGANIZER', 'MODERATOR', 'MEMBER']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'club.created', targetId: club.id } });
    expect(audit?.actorId).toBe(owner.id);
  });

  it('rejects duplicate and reserved slugs', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    await api().post('/api/v1/clubs').set(bearer(owner)).send({ name: 'Dup', slug: club.slug, category: 'WALKING', visibility: 'PUBLIC' }).expect(409);
    await api().post('/api/v1/clubs').set(bearer(owner)).send({ name: 'Admin', slug: 'admin', category: 'WALKING', visibility: 'PUBLIC' }).expect(422);
  });

  it('enforces the per-user owned club limit from platform settings', async () => {
    const owner = await registerUser();
    await prisma.platformSetting.upsert({ where: { key: 'clubs.maxOwnedPerUser' }, create: { key: 'clubs.maxOwnedPerUser', value: 5 }, update: {} });
    for (let i = 0; i < 5; i++) await createClub(owner);
    const res = await api().post('/api/v1/clubs').set(bearer(owner)).send({ name: 'Too many', slug: `c-${uid()}`, category: 'RUNNING', visibility: 'PUBLIC' }).expect(403);
    expect(res.body.error.code).toBe('CLUB_LIMIT_REACHED');
  });
});

describe('club discovery', () => {
  it('lists public and private clubs but never invite-only clubs', async () => {
    const owner = await registerUser();
    const tag = uid();
    const pub = await createClub(owner, { name: `Disc ${tag} Public` });
    const priv = await createClub(owner, { name: `Disc ${tag} Private`, visibility: 'PRIVATE' });
    const hidden = await createClub(owner, { name: `Disc ${tag} Hidden`, visibility: 'INVITE_ONLY' });
    const res = await api().get('/api/v1/clubs').query({ q: `Disc ${tag}` }).expect(200);
    const ids = res.body.data.map((c: { id: string }) => c.id);
    expect(ids).toContain(pub.id);
    expect(ids).toContain(priv.id);
    expect(ids).not.toContain(hidden.id);

    const stranger = await registerUser();
    await api().get(`/api/v1/clubs/${hidden.slug}`).set(bearer(stranger)).expect(404);
    await api().get(`/api/v1/clubs/${hidden.slug}`).expect(404);
    await api().get(`/api/v1/clubs/${priv.slug}`).expect(200);
  });

  it('finds nearby clubs ordered by distance with cursor pagination', async () => {
    const owner = await registerUser();
    const tag = uid();
    // Points in Kisumu, far from other tests' Nairobi clubs.
    const near = await createClub(owner, { name: `Geo ${tag} near`, latitude: -0.0917, longitude: 34.768 });
    const mid = await createClub(owner, { name: `Geo ${tag} mid`, latitude: -0.12, longitude: 34.8 });
    await createClub(owner, { name: `Geo ${tag} far`, latitude: -1.2921, longitude: 36.8219 });
    const page1 = await api().get('/api/v1/clubs').query({ near: '-0.0917,34.768', radiusKm: 20, limit: 1, q: `Geo ${tag}` }).expect(200);
    expect(page1.body.data[0].id).toBe(near.id);
    expect(page1.body.data[0].distanceKm).toBeLessThan(0.1);
    const page2 = await api().get('/api/v1/clubs').query({ near: '-0.0917,34.768', radiusKm: 20, limit: 1, q: `Geo ${tag}`, cursor: page1.body.meta.nextCursor }).expect(200);
    expect(page2.body.data[0].id).toBe(mid.id);
    expect(page2.body.meta.nextCursor).toBeNull();
  });

  it('paginates with stable cursors and rejects garbage cursors', async () => {
    const owner = await registerUser();
    const tag = uid();
    for (let i = 0; i < 3; i++) await createClub(owner, { name: `Page ${tag} ${i}` });
    const p1 = await api().get('/api/v1/clubs').query({ q: `Page ${tag}`, limit: 2 }).expect(200);
    const p2 = await api().get('/api/v1/clubs').query({ q: `Page ${tag}`, limit: 2, cursor: p1.body.meta.nextCursor }).expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p2.body.data).toHaveLength(1);
    expect(new Set([...p1.body.data, ...p2.body.data].map((c: { id: string }) => c.id)).size).toBe(3);
    await api().get('/api/v1/clubs').query({ cursor: 'not-a-cursor' }).expect(400);
  });
});

describe('membership lifecycle', () => {
  it('public clubs: instant join and leave keeps member count accurate', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { requiresApproval: false });
    const member = await registerUser();
    const join = await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(member)).send({}).expect(201);
    expect(join.body.data.status).toBe('ACTIVE');
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(member)).send({}).expect(409);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).memberCount).toBe(2);
    await api().post(`/api/v1/clubs/${club.id}/leave`).set(bearer(member)).expect(204);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).memberCount).toBe(1);
    // Rejoining after leaving is allowed.
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(member)).send({}).expect(201);
  });

  it('private clubs: request, approval and rejection', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { visibility: 'PRIVATE' });
    const a = await registerUser();
    const b = await registerUser();
    expect((await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(a)).send({ message: 'I walk daily' }).expect(202)).body.data.status).toBe('PENDING');
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(b)).send({}).expect(202);

    // Pending members have no member permissions.
    await api().get(`/api/v1/clubs/${club.id}/members`).set(bearer(a)).expect(403);

    const pending = await api().get(`/api/v1/clubs/${club.id}/members`).query({ status: 'PENDING' }).set(bearer(owner)).expect(200);
    expect(pending.body.data).toHaveLength(2);
    expect(pending.body.data.find((m: { user: { id: string } }) => m.user.id === a.id).requestMessage).toBe('I walk daily');

    await api().post(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, a.id)}/review`).set(bearer(owner)).send({ decision: 'APPROVE' }).expect(200);
    await api().post(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, b.id)}/review`).set(bearer(owner)).send({ decision: 'REJECT' }).expect(200);
    await api().post(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, a.id)}/review`).set(bearer(owner)).send({ decision: 'APPROVE' }).expect(409);

    await api().get(`/api/v1/clubs/${club.id}/members`).set(bearer(a)).expect(200);
    const myClubs = await api().get('/api/v1/users/me/clubs').set(bearer(a)).expect(200);
    expect(myClubs.body.data.find((c: { id: string }) => c.id === club.id)).toMatchObject({ membershipStatus: 'ACTIVE', roleKey: 'MEMBER' });
  });

  it('invite-only clubs require a valid invitation; codes are single-use and club-bound', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { visibility: 'INVITE_ONLY' });
    const other = await createClub(owner);
    const invitee = await registerUser();
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(invitee)).send({}).expect(404);

    const inv = await api().post(`/api/v1/clubs/${club.id}/invitations`).set(bearer(owner)).send({ maxUses: 1 }).expect(201);
    const code = inv.body.data.code as string;
    const stored = await prisma.clubInvitation.findUniqueOrThrow({ where: { id: inv.body.data.id } });
    expect(stored.codeHash).not.toBe(code);

    await api().get(`/api/v1/clubs/invitations/${code}`).expect(200);
    // A code for club X cannot be used on club Y.
    await api().post(`/api/v1/clubs/${other.id}/join`).set(bearer(invitee)).send({ invitationCode: code }).expect(400);
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(invitee)).send({ invitationCode: code }).expect(201);
    const second = await registerUser();
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(second)).send({ invitationCode: code }).expect(400);
  });

  it('recipient-bound invitations only work for the verified recipient', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { visibility: 'PRIVATE' });
    const intended = await registerUser();
    const inv = await api().post(`/api/v1/clubs/${club.id}/invitations`).set(bearer(owner)).send({ email: intended.email }).expect(201);
    const intruder = await registerUser();
    const res = await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(intruder)).send({ invitationCode: inv.body.data.code }).expect(403);
    expect(res.body.error.code).toBe('INVITATION_RECIPIENT_MISMATCH');
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(intended)).send({ invitationCode: inv.body.data.code }).expect(201);
  });

  it('revoked invitations stop working', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { visibility: 'INVITE_ONLY' });
    const inv = await api().post(`/api/v1/clubs/${club.id}/invitations`).set(bearer(owner)).send({ maxUses: 10 }).expect(201);
    await api().delete(`/api/v1/clubs/${club.id}/invitations/${inv.body.data.id}`).set(bearer(owner)).expect(204);
    const u = await registerUser();
    await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(u)).send({ invitationCode: inv.body.data.code }).expect(400);
  });

  it('the owner cannot leave without transferring ownership', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const res = await api().post(`/api/v1/clubs/${club.id}/leave`).set(bearer(owner)).expect(409);
    expect(res.body.error.code).toBe('OWNER_MUST_TRANSFER');
  });

  it('banned users cannot rejoin', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const u = await registerUser();
    await addMember(club.id, u.id);
    await api().post(`/api/v1/clubs/${club.id}/members/${await membershipId(club.id, u.id)}/moderation`).set(bearer(owner)).send({ action: 'BAN' }).expect(200);
    const res = await api().post(`/api/v1/clubs/${club.id}/join`).set(bearer(u)).send({}).expect(403);
    expect(res.body.error.code).toBe('BANNED');
  });

  it('a user can belong to several clubs with different roles', async () => {
    const owner1 = await registerUser();
    const owner2 = await registerUser();
    const c1 = await createClub(owner1);
    const c2 = await createClub(owner2);
    const u = await registerUser();
    await addMember(c1.id, u.id, 'ADMIN');
    await addMember(c2.id, u.id, 'MEMBER');
    const mine = await api().get('/api/v1/users/me/clubs').set(bearer(u)).expect(200);
    const byId = Object.fromEntries(mine.body.data.map((c: { id: string; roleKey: string }) => [c.id, c.roleKey]));
    expect(byId[c1.id]).toBe('ADMIN');
    expect(byId[c2.id]).toBe('MEMBER');
  });
});

describe('platform approval setting', () => {
  it('new clubs start as PENDING_APPROVAL when the platform requires approval', async () => {
    // Exercised through the service with a scoped setting override, to avoid mutating global state
    // that parallel test files depend on.
    const settings = await import('../src/modules/platform/settings');
    const { vi } = await import('vitest');
    const spy = vi.spyOn(settings, 'getSetting');
    spy.mockImplementation(async (key) => (key === 'clubs.requireApproval' ? true : settings.PLATFORM_SETTING_DEFAULTS[key]) as never);
    try {
      const owner = await registerUser();
      const { createClub: create } = await import('../src/modules/clubs/clubs.service');
      const club = await create(owner.id, { name: 'Approval Club', slug: `appr-${uid()}`, category: 'WALKING', visibility: 'PUBLIC' }, {});
      expect(club.status).toBe('PENDING_APPROVAL');
    } finally {
      spy.mockRestore();
    }
  });
});
