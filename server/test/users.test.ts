import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { purgeDueAccounts } from '../src/modules/users/account-deletion';
import { addMember, api, bearer, createClub, registerUser, teardown, uid } from './helpers';

afterAll(teardown);

describe('profile', () => {
  it('updates the profile and rejects taken usernames', async () => {
    const u = await registerUser();
    const other = await registerUser();
    const res = await api()
      .patch('/api/v1/users/me')
      .set(bearer(u))
      .send({ displayName: 'Njeri', bio: 'Morning walker', preferredActivityTypes: ['WALK', 'RUN'], countryCode: 'ke' })
      .expect(200);
    expect(res.body.data.profile).toMatchObject({ displayName: 'Njeri', countryCode: 'KE', preferredActivityTypes: ['WALK', 'RUN'] });
    await api().patch('/api/v1/users/me').set(bearer(u)).send({ username: other.username }).expect(409);
    await api().patch('/api/v1/users/me').set(bearer(u)).send({ avatarUrl: 'javascript:alert(1)' }).expect(422);
  });

  it('changing email requires re-verification', async () => {
    const u = await registerUser();
    const email = `new_${uid()}@example.com`;
    await api().post('/api/v1/users/me/email').set(bearer(u)).send({ email }).expect(202);
    const me = await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    expect(me.body.data).toMatchObject({ email, emailVerified: false });
  });
});

describe('privacy', () => {
  it('private profiles expose only minimal information', async () => {
    const u = await registerUser();
    await api().patch('/api/v1/users/me').set(bearer(u)).send({ bio: 'secret bio', location: 'Westlands' }).expect(200);
    await api().patch('/api/v1/users/me/privacy').set(bearer(u)).send({ profileVisibility: 'PRIVATE' }).expect(200);
    const res = await api().get(`/api/v1/users/${u.username}`).expect(200);
    expect(res.body.data.isPrivate).toBe(true);
    expect(res.body.data.bio).toBeUndefined();
    expect(res.body.data.location).toBeUndefined();
    const self = await api().get(`/api/v1/users/${u.username}`).set(bearer(u)).expect(200);
    expect(self.body.data.bio).toBe('secret bio');
  });

  it('public profiles hide membership of non-public clubs from others', async () => {
    const u = await registerUser();
    const owner = await registerUser();
    const pub = await createClub(owner);
    const priv = await createClub(owner, { visibility: 'PRIVATE' });
    await addMember(pub.id, u.id);
    await addMember(priv.id, u.id);
    const res = await api().get(`/api/v1/users/${u.username}`).expect(200);
    const ids = res.body.data.clubs.map((c: { id: string }) => c.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
  });

  it('blocking hides profiles in both directions', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api().post(`/api/v1/users/${b.id}/block`).set(bearer(a)).expect(204);
    await api().get(`/api/v1/users/${b.username}`).set(bearer(a)).expect(404);
    await api().get(`/api/v1/users/${a.username}`).set(bearer(b)).expect(404);
    await api().post(`/api/v1/users/${a.id}/block`).set(bearer(a)).expect(400);
    await api().delete(`/api/v1/users/${b.id}/block`).set(bearer(a)).expect(204);
    await api().get(`/api/v1/users/${b.username}`).set(bearer(a)).expect(200);
  });
});

describe('data rights', () => {
  it('exports personal data without credentials', async () => {
    const u = await registerUser();
    const res = await api().get('/api/v1/users/me/export').set(bearer(u)).expect(200);
    expect(res.body.data.account.email).toBe(u.email);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('account deletion signs out everywhere; sign-in during grace cancels; purge anonymises', async () => {
    const u = await registerUser();
    await api().delete('/api/v1/users/me').set(bearer(u)).send({ confirm: 'DELETE', password: 'wrong-password-1' }).expect(401);
    await api().delete('/api/v1/users/me').set(bearer(u)).send({ confirm: 'DELETE', password: u.password }).expect(202);
    await api().get('/api/v1/users/me').set(bearer(u)).expect(401);
    await api().get(`/api/v1/users/${u.username}`).expect(404);

    // Signing in again cancels deletion.
    const login = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('ACTIVE');

    await api().delete('/api/v1/users/me').set(bearer(login.body.data)).send({ confirm: 'DELETE', password: u.password }).expect(202);
    await prisma.user.update({ where: { id: u.id }, data: { deletionScheduledAt: new Date(Date.now() - 1000) } });
    await purgeDueAccounts();
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { profile: true } });
    expect(gone).toMatchObject({ status: 'DELETED', email: null, phone: null, passwordHash: null });
    expect(gone.profile?.displayName).toBe('Deleted user');
    await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(401);
  });

  it('club owners must transfer ownership before deleting their account', async () => {
    const u = await registerUser();
    await createClub(u);
    const res = await api().delete('/api/v1/users/me').set(bearer(u)).send({ confirm: 'DELETE', password: u.password }).expect(409);
    expect(res.body.error.code).toBe('OWNS_CLUBS');
  });
});

describe('devices', () => {
  it('registers push devices and scopes removal to the owner', async () => {
    const u = await registerUser();
    const other = await registerUser();
    const res = await api().post('/api/v1/users/me/devices').set(bearer(u)).send({ pushToken: `ExponentPushToken[${uid()}]`, platform: 'android' }).expect(201);
    await api().delete(`/api/v1/users/me/devices/${res.body.data.id}`).set(bearer(other)).expect(404);
    await api().delete(`/api/v1/users/me/devices/${res.body.data.id}`).set(bearer(u)).expect(204);
  });
});
