import { authenticator } from 'otplib';
import { afterAll, describe, expect, it } from 'vitest';
import { api, bearer, createAdmin, registerUser, teardown, uid } from './helpers';

afterAll(teardown);
const auth = (a: { accessToken: string }) => ({ Authorization: `Bearer ${a.accessToken}` });

describe('platform administration', () => {
  it('overview reports users, clubs, activities, events, challenges and revenue', async () => {
    const admin = await createAdmin();
    const o = (await api().get('/api/v1/platform-admin/overview').set(auth(admin)).expect(200)).body.data;
    expect(o).toHaveProperty('users.premium');
    expect(o).toHaveProperty('clubs.paid');
    expect(o).toHaveProperty('clubs.free');
    expect(o).toHaveProperty('activities.totalDistanceM');
    expect(o).toHaveProperty('events.held');
    expect(o).toHaveProperty('challenges.participants');
    expect(o).toHaveProperty('revenue.mrr');
    expect(o).toHaveProperty('revenue.cancellations30d');
  });

  it('system health and security monitoring', async () => {
    const admin = await createAdmin();
    const sys = (await api().get('/api/v1/platform-admin/system').set(auth(admin)).expect(200)).body.data;
    expect(sys).toMatchObject({ status: 'ok', database: { ok: true }, redis: { ok: true } });
    // The health page reports the newest applied migration.
    const { readdirSync } = await import('node:fs');
    const newest = readdirSync('prisma/migrations').filter((d) => /^\d{14}_/.test(d)).sort().at(-1);
    expect(sys.latestMigration.migration_name).toBe(newest);
    const u = await registerUser();
    await api().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-pass-123' }).expect(401);
    const sec = (await api().get('/api/v1/platform-admin/security').set(auth(admin)).expect(200)).body.data;
    expect(sec.failedLogins).toBeGreaterThan(0);
    expect(sec.activeAdminSessions.length).toBeGreaterThan(0);
  });

  it('user detail includes account history', async () => {
    const admin = await createAdmin('SUPPORT');
    const u = await registerUser();
    const d = (await api().get(`/api/v1/platform-admin/users/${u.id}`).set(auth(admin)).expect(200)).body.data;
    expect(d.history.map((h: { action: string }) => h.action)).toContain('auth.registered');
    expect(d).not.toHaveProperty('passwordHash');
  });

  it('super admins manage admins (MFA forced); suspension revokes sessions; support cannot', async () => {
    const root = await createAdmin('SUPER_ADMIN');
    const support = await createAdmin('SUPPORT');
    const email = `newadmin_${uid()}@walktogether.test`;
    await api().post('/api/v1/platform-admin/admins').set(auth(support)).send({ email, displayName: 'New', roleKey: 'FINANCE', password: 'finance-admin-pass-1' }).expect(403);
    await api().post('/api/v1/platform-admin/admins').set(auth(root)).send({ email, displayName: 'New', roleKey: 'FINANCE', password: 'short-pass-1' }).expect(422);
    const created = await api().post('/api/v1/platform-admin/admins').set(auth(root)).send({ email, displayName: 'New', roleKey: 'FINANCE', password: 'finance-admin-pass-1' }).expect(201);
    const login = await api().post('/api/v1/platform-admin/auth/login').send({ email, password: 'finance-admin-pass-1' }).expect(200);
    expect(login.body.data.mfaSetupRequired).toBe(true);
    const setup = await api().post('/api/v1/platform-admin/auth/mfa/setup').send({ mfaToken: login.body.data.mfaToken }).expect(200);
    const s = await api().post('/api/v1/platform-admin/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code: authenticator.generate(setup.body.data.secret) }).expect(200);
    await api().get('/api/v1/platform-admin/revenue').set(auth(s.body.data)).expect(200); // FINANCE may view revenue
    await api().get('/api/v1/platform-admin/admins').set(auth(s.body.data)).expect(403);
    await api().post(`/api/v1/platform-admin/admins/${created.body.data.id}/status`).set(auth(root)).send({ status: 'SUSPENDED' }).expect(204);
    await api().get('/api/v1/platform-admin/revenue').set(auth(s.body.data)).expect(401);
  });

  it('admins configure achievements with validated rules', async () => {
    const admin = await createAdmin();
    await api().put('/api/v1/platform-admin/achievements/marathon').set(auth(admin)).send({ name: 'Marathoner', description: 'Ran 42.2 km in one go', rule: { type: 'nonsense' } }).expect(422);
    await api().put('/api/v1/platform-admin/achievements/marathon').set(auth(admin)).send({ name: 'Marathoner', description: 'Ran 42.2 km in one go', icon: '🏃', rule: { type: 'single_distance', minM: 42195, activityType: 'RUN' } }).expect(200);
    const u = await registerUser();
    expect((await api().get('/api/v1/achievements/me').set(bearer(u))).body.data.some((a: { code: string }) => a.code === 'marathon')).toBe(true);
  });
});
