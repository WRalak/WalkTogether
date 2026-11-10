import { authenticator } from 'otplib';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { api, bearer, createAdmin, createClub, registerUser, teardown } from './helpers';

afterAll(teardown);

const adminBearer = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });

describe('platform admin authentication', () => {
  it('requires MFA: the password step never yields an access token', async () => {
    const admin = await createAdmin();
    const res = await api().post('/api/v1/platform-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.mfaSetupRequired).toBe(false);
    // The MFA token is not an access token.
    await api().get('/api/v1/platform-admin/me').set({ Authorization: `Bearer ${res.body.data.mfaToken}` }).expect(401);
    await api().post('/api/v1/platform-admin/auth/mfa/verify').send({ mfaToken: res.body.data.mfaToken, code: '000000' }).expect(401);
  });

  it('rejects replayed TOTP codes', async () => {
    const admin = await createAdmin();
    const login = await api().post('/api/v1/platform-admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const code = authenticator.generate(admin.totpSecret);
    // createAdmin may already have used this exact code; ensure the second use of any code fails.
    const first = await api().post('/api/v1/platform-admin/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code });
    const second = await api().post('/api/v1/platform-admin/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code });
    expect(second.status).toBe(401);
    expect([200, 401]).toContain(first.status);
  });

  it('stores the TOTP secret encrypted', async () => {
    const admin = await createAdmin();
    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email: admin.email } });
    expect(row.mfaSecretEncrypted).toMatch(/^v1\./);
    expect(row.mfaSecretEncrypted).not.toContain(admin.totpSecret);
  });

  it('rotates admin refresh tokens and revokes the session on replay', async () => {
    const admin = await createAdmin();
    const next = await api().post('/api/v1/platform-admin/auth/refresh').send({ refreshToken: admin.refreshToken }).expect(200);
    await api().post('/api/v1/platform-admin/auth/refresh').send({ refreshToken: admin.refreshToken }).expect(401);
    await api().get('/api/v1/platform-admin/me').set(adminBearer(next.body.data)).expect(401);
  });

  it('admin tokens are not accepted on member endpoints', async () => {
    const admin = await createAdmin();
    await api().get('/api/v1/users/me').set(adminBearer(admin)).expect(401);
  });
});

describe('platform admin permissions & actions', () => {
  it('support staff cannot manage platform settings or feature flags', async () => {
    const support = await createAdmin('SUPPORT');
    await api().get('/api/v1/platform-admin/users').set(adminBearer(support)).expect(200);
    await api().get('/api/v1/platform-admin/settings').set(adminBearer(support)).expect(403);
    await api().put('/api/v1/platform-admin/feature-flags/gps_tracking').set(adminBearer(support)).send({ enabled: true }).expect(403);
  });

  it('suspending a user revokes their sessions and is audited', async () => {
    const admin = await createAdmin();
    const u = await registerUser();
    await api().post(`/api/v1/platform-admin/users/${u.id}/status`).set(adminBearer(admin)).send({ action: 'SUSPEND', reason: 'Spam reports' }).expect(200);
    await api().get('/api/v1/users/me').set(bearer(u)).expect(401);
    const login = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
    const logs = await api().get('/api/v1/platform-admin/audit-logs').query({ targetId: u.id, action: 'admin.user_suspended' }).set(adminBearer(admin)).expect(200);
    expect(logs.body.data[0]).toMatchObject({ actorType: 'ADMIN', metadata: { reason: 'Spam reports' } });
    await api().post(`/api/v1/platform-admin/users/${u.id}/status`).set(adminBearer(admin)).send({ action: 'REACTIVATE', reason: 'Appeal accepted' }).expect(200);
    await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
  });

  it('suspends and reactivates clubs; suspended clubs disappear from discovery', async () => {
    const admin = await createAdmin();
    const owner = await registerUser();
    const club = await createClub(owner);
    await api().post(`/api/v1/platform-admin/clubs/${club.id}/status`).set(adminBearer(admin)).send({ action: 'SUSPEND', reason: 'Terms violation' }).expect(200);
    const list = await api().get('/api/v1/clubs').query({ q: club.slug.replace('club-', '') }).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(club.id);
    await api().post(`/api/v1/platform-admin/clubs/${club.id}/status`).set(adminBearer(admin)).send({ action: 'REACTIVATE', reason: 'Resolved' }).expect(200);
  });

  it('approves pending clubs and records platform settings changes in the audit log', async () => {
    const admin = await createAdmin();
    const owner = await registerUser();
    const club = await createClub(owner);
    // Simulate a club created while `clubs.requireApproval` is on, without flipping the global
    // setting (other test files run in parallel against the same database).
    await prisma.club.update({ where: { id: club.id }, data: { status: 'PENDING_APPROVAL' } });
    await api().post(`/api/v1/platform-admin/clubs/${club.id}/approve`).set(adminBearer(admin)).send({}).expect(200);
    expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).status).toBe('ACTIVE');
    await api().post(`/api/v1/platform-admin/clubs/${club.id}/approve`).set(adminBearer(admin)).send({}).expect(409);

    const key = `test.setting.${Date.now()}`;
    await api().put(`/api/v1/platform-admin/settings/${key}`).set(adminBearer(admin)).send({ value: { enabled: true } }).expect(200);
    const logs = await api().get('/api/v1/platform-admin/audit-logs').query({ targetId: key }).set(adminBearer(admin)).expect(200);
    expect(logs.body.data[0]).toMatchObject({ action: 'admin.setting_updated', metadata: { to: { enabled: true } } });
  });

  it('serves overview metrics', async () => {
    const admin = await createAdmin();
    const res = await api().get('/api/v1/platform-admin/overview').set(adminBearer(admin)).expect(200);
    expect(res.body.data.users.total).toBeGreaterThan(0);
    expect(res.body.data.clubs).toHaveProperty('active');
  });
});

describe('audit log integrity', () => {
  it('the database refuses to update or delete audit records', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
