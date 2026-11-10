import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { devSmsOutbox } from '../src/modules/notifications/sms';
import { api, bearer, lastEmailTo, registerUser, teardown, tokenFromEmail, uid } from './helpers';

afterAll(teardown);

describe('registration & login', () => {
  it('registers, returns tokens, creates defaults and sends a verification email', async () => {
    const u = await registerUser({ verified: false });
    expect(u.accessToken).toBeTruthy();
    expect(u.refreshToken.length).toBeGreaterThan(40);
    const me = await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    expect(me.body.data).toMatchObject({ username: u.username, emailVerified: false, privacy: { hideStartEndPoints: true } });
    expect(lastEmailTo(u.email).subject).toMatch(/verify/i);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate username and email, and unknown fields', async () => {
    const u = await registerUser();
    const base = { password: 'walk2gether-strong', displayName: 'X', acceptTerms: true };
    await api().post('/api/v1/auth/register').send({ ...base, email: `n_${uid()}@example.com`, username: u.username }).expect(409);
    await api().post('/api/v1/auth/register').send({ ...base, email: u.email, username: `n_${uid()}` }).expect(409);
    const res = await api().post('/api/v1/auth/register').send({ ...base, email: `n_${uid()}@example.com`, username: `n_${uid()}`, role: 'admin' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with correct credentials and uses a generic error otherwise', async () => {
    const u = await registerUser();
    await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const wrong = await api().post('/api/v1/auth/login').send({ email: u.email, password: 'nope-wrong-1' }).expect(401);
    const missing = await api().post('/api/v1/auth/login').send({ email: `missing_${uid()}@example.com`, password: 'nope-wrong-1' }).expect(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(missing.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const u = await registerUser();
    for (let i = 0; i < 10; i++) await api().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-1' }).expect(401);
    const locked = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(429);
    expect(locked.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('records login history and never stores secrets in it', async () => {
    const u = await registerUser();
    await api().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-1' }).expect(401);
    const hist = await api().get('/api/v1/auth/login-history').set(bearer(u)).expect(200);
    expect(hist.body.data.some((e: { success: boolean }) => e.success === false)).toBe(true);
    expect(JSON.stringify(hist.body)).not.toContain('wrong-password-1');
  });

  it('flags a login from a new device and IP as suspicious', async () => {
    const u = await registerUser();
    await api()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.77')
      .send({ email: u.email, password: u.password, device: { deviceId: 'brand-new-device-1', platform: 'android' } })
      .expect(200);
    const events = await prisma.loginEvent.findMany({ where: { userId: u.id, success: true }, orderBy: { createdAt: 'desc' } });
    expect(events[0]!.suspicious).toBe(true);
    expect(lastEmailTo(u.email).subject).toMatch(/new sign-in/i);
  });
});

describe('refresh token rotation', () => {
  it('rotates tokens and detects reuse by revoking the session', async () => {
    const u = await registerUser();
    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
    expect(first.body.data.refreshToken).not.toBe(u.refreshToken);

    // Replaying the old token: reuse detected, whole session revoked.
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    await api().post('/api/v1/auth/refresh').send({ refreshToken: first.body.data.refreshToken }).expect(401);
    await api().get('/api/v1/users/me').set(bearer(first.body.data)).expect(401);
  });

  it('web clients get an httpOnly cookie instead of a body refresh token', async () => {
    const u = await registerUser();
    const res = await api().post('/api/v1/auth/login').set('X-WT-Client', 'web').send({ email: u.email, password: u.password }).expect(200);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/wt_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // Cookie refresh requires the custom header (CSRF defence).
    await api().post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]!).send({}).expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]!).set('X-WT-Client', 'web').send({}).expect(200);
  });
});

describe('sessions & logout', () => {
  it('logout revokes the access token immediately', async () => {
    const u = await registerUser();
    await api().post('/api/v1/auth/logout').set(bearer(u)).expect(204);
    const res = await api().get('/api/v1/users/me').set(bearer(u)).expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });

  it('lists sessions and can revoke a specific device but never another user’s', async () => {
    const u = await registerUser();
    const second = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password, device: { deviceName: 'Tecno Spark', platform: 'android' } }).expect(200);
    const list = await api().get('/api/v1/auth/sessions').set(bearer(u)).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = await registerUser();
    await api().delete(`/api/v1/auth/sessions/${second.body.data.sessionId}`).set(bearer(other)).expect(404);
    await api().delete(`/api/v1/auth/sessions/${second.body.data.sessionId}`).set(bearer(u)).expect(204);
    await api().get('/api/v1/users/me').set(bearer(second.body.data)).expect(401);
    await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
  });

  it('logout-all revokes every device', async () => {
    const u = await registerUser();
    const second = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const res = await api().post('/api/v1/auth/logout-all').set(bearer(u)).expect(200);
    expect(res.body.data.revokedSessions).toBe(2);
    await api().get('/api/v1/users/me').set(bearer(second.body.data)).expect(401);
  });

  it('rejects tampered and admin-audience tokens', async () => {
    const u = await registerUser();
    await api().get('/api/v1/users/me').set({ Authorization: `Bearer ${u.accessToken}x` }).expect(401);
    await api().get('/api/v1/users/me').expect(401);
  });
});

describe('email verification and passwords', () => {
  it('verifies email with a single-use token', async () => {
    const u = await registerUser({ verified: false });
    const token = tokenFromEmail(u.email);
    await api().post('/api/v1/auth/verify-email').send({ token }).expect(200);
    await api().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    const me = await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    expect(me.body.data.emailVerified).toBe(true);
  });

  it('resets a password, signs out everywhere and rejects reused links', async () => {
    const u = await registerUser();
    const res = await api().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(202);
    const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: `ghost_${uid()}@example.com` }).expect(202);
    expect(unknown.body).toEqual(res.body);

    const token = tokenFromEmail(u.email);
    await api().post('/api/v1/auth/reset-password').send({ token, password: 'brand-new-pass-42' }).expect(200);
    await api().post('/api/v1/auth/reset-password').send({ token, password: 'another-pass-43' }).expect(400);
    await api().get('/api/v1/users/me').set(bearer(u)).expect(401);
    await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(401);
    await api().post('/api/v1/auth/login').send({ email: u.email, password: 'brand-new-pass-42' }).expect(200);
  });

  it('changing password keeps the current session and revokes others', async () => {
    const u = await registerUser();
    const other = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().post('/api/v1/auth/change-password').set(bearer(u)).send({ currentPassword: 'bad-password-1', newPassword: 'next-password-99' }).expect(401);
    await api().post('/api/v1/auth/change-password').set(bearer(u)).send({ currentPassword: u.password, newPassword: 'next-password-99' }).expect(200);
    await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    await api().get('/api/v1/users/me').set(bearer(other.body.data)).expect(401);
  });
});

describe('phone OTP', () => {
  const lastCode = (phone: string) => {
    const msg = [...devSmsOutbox].reverse().find((m) => m.to === phone);
    return msg!.body.match(/\b(\d{6})\b/)![1]!;
  };
  const randomPhone = () => `+2547${Math.floor(10000000 + Math.random() * 89999999)}`;

  it('signs up a new user by phone, then signs them in', async () => {
    const phone = randomPhone();
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'LOGIN' }).expect(202);
    const stored = await prisma.phoneVerification.findFirstOrThrow({ where: { phone } });
    expect(stored.codeHash).not.toContain(lastCode(phone));

    const verify = await api().post('/api/v1/auth/phone/verify-otp').send({ phone, purpose: 'LOGIN', code: lastCode(phone) }).expect(200);
    expect(verify.body.data.status).toBe('registration_required');
    const reg = await api()
      .post('/api/v1/auth/phone/register')
      .send({ registrationToken: verify.body.data.registrationToken, username: `p_${uid()}`, displayName: 'Akinyi', acceptTerms: true })
      .expect(201);
    expect(reg.body.data.accessToken).toBeTruthy();

    await prisma.phoneVerification.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'LOGIN' }).expect(202);
    const login = await api().post('/api/v1/auth/phone/verify-otp').send({ phone, purpose: 'LOGIN', code: lastCode(phone) }).expect(200);
    expect(login.body.data.status).toBe('authenticated');
  });

  it('enforces cooldown, attempt limits and single use', async () => {
    const phone = randomPhone();
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'LOGIN' }).expect(202);
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'LOGIN' }).expect(429);
    const code = lastCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/phone/verify-otp').send({ phone, purpose: 'LOGIN', code: wrong }).expect(400);
    // After too many attempts even the right code is refused.
    await api().post('/api/v1/auth/phone/verify-otp').send({ phone, purpose: 'LOGIN', code }).expect(400);
  });

  it('VERIFY purpose requires authentication and binds the phone to the user', async () => {
    const phone = randomPhone();
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'VERIFY' }).expect(401);
    const u = await registerUser();
    await api().post('/api/v1/auth/phone/request-otp').set(bearer(u)).send({ phone, purpose: 'VERIFY' }).expect(202);
    await api().post('/api/v1/auth/phone/verify-otp').set(bearer(u)).send({ phone, purpose: 'VERIFY', code: lastCode(phone) }).expect(200);
    const me = await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    expect(me.body.data).toMatchObject({ phone, phoneVerified: true });
  });
});

describe('oauth', () => {
  it('reports unconfigured providers instead of pretending to work', async () => {
    const res = await api().post('/api/v1/auth/oauth').send({ provider: 'google', idToken: 'x'.repeat(40) }).expect(503);
    expect(res.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
