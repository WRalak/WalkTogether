/** Optional two-step verification (TOTP + recovery codes) for members. */
import { authenticator } from 'otplib';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { redis } from '../src/database/redis';
import { devSmsOutbox } from '../src/modules/notifications/sms';
import { api, bearer, registerUser, teardown } from './helpers';

afterAll(teardown);
authenticator.options = { window: 1, step: 30 };

/** A valid code for the current step that has not been used yet (codes are single-use). */
async function freshCode(userId: string, secret: string) {
  const code = authenticator.generate(secret);
  await redis.del(`member:totp:${userId}:${code}`);
  return code;
}

async function enrol(u: Awaited<ReturnType<typeof registerUser>>) {
  const setup = await api().post('/api/v1/auth/mfa/setup').set(bearer(u)).expect(200);
  expect(setup.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  const enable = await api().post('/api/v1/auth/mfa/enable').set(bearer(u)).send({ code: authenticator.generate(setup.body.data.secret) }).expect(200);
  return { secret: setup.body.data.secret as string, recoveryCodes: enable.body.data.recoveryCodes as string[] };
}

describe('member two-step verification', () => {
  it('enrolment needs a valid code; secrets and recovery codes are never stored in plain text', async () => {
    const u = await registerUser();
    expect((await api().get('/api/v1/auth/mfa').set(bearer(u)).expect(200)).body.data.enabled).toBe(false);
    const setup = await api().post('/api/v1/auth/mfa/setup').set(bearer(u)).expect(200);
    await api().post('/api/v1/auth/mfa/enable').set(bearer(u)).send({ code: '000000' }).expect(400);
    const enable = await api().post('/api/v1/auth/mfa/enable').set(bearer(u)).send({ code: authenticator.generate(setup.body.data.secret) }).expect(200);
    expect(enable.body.data.recoveryCodes).toHaveLength(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaSecretEncrypted).not.toContain(setup.body.data.secret);
    const hashes = await prisma.userMfaRecoveryCode.findMany({ where: { userId: u.id } });
    expect(hashes.some((h) => enable.body.data.recoveryCodes.includes(h.codeHash))).toBe(false);
    const st = await api().get('/api/v1/auth/mfa').set(bearer(u)).expect(200);
    expect(st.body.data).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
  });

  it('password sign-in returns a challenge, not tokens; codes cannot be replayed', async () => {
    const u = await registerUser();
    const { secret } = await enrol(u);
    const login = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    expect(login.body.data).toMatchObject({ mfaRequired: true });
    expect(login.body.data.accessToken).toBeUndefined();
    expect(login.body.data.refreshToken).toBeUndefined();
    // The challenge token is not an access token.
    await api().get('/api/v1/users/me').set({ Authorization: `Bearer ${login.body.data.mfaToken}` }).expect(401);

    const code = await freshCode(u.id, secret);
    const ok = await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code }).expect(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    const again = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: again.body.data.mfaToken, code }).expect(401);
  });

  it('recovery codes work exactly once', async () => {
    const u = await registerUser();
    const { recoveryCodes } = await enrol(u);
    const l1 = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: l1.body.data.mfaToken, recoveryCode: recoveryCodes[0] }).expect(200);
    const l2 = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: l2.body.data.mfaToken, recoveryCode: recoveryCodes[0] }).expect(401);
    expect((await api().get('/api/v1/auth/mfa').set(bearer(u)).expect(200)).body.data.recoveryCodesRemaining).toBe(9);
  });

  it('repeated wrong codes lock the account', async () => {
    const u = await registerUser();
    await enrol(u);
    const l = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    for (let i = 0; i < 10; i++) await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: l.body.data.mfaToken, code: '000000' }).expect(401);
    await api().post('/api/v1/auth/mfa/verify').send({ mfaToken: l.body.data.mfaToken, code: '000000' }).expect(429);
  });

  it('phone OTP sign-in also requires the second factor', async () => {
    const phone = `+2547${Math.floor(10000000 + Math.random() * 89999999)}`;
    const u = await registerUser();
    await prisma.user.update({ where: { id: u.id }, data: { phone, phoneVerifiedAt: new Date() } });
    await enrol(u);
    await api().post('/api/v1/auth/phone/request-otp').send({ phone, purpose: 'LOGIN' }).expect(202);
    const code = [...devSmsOutbox].reverse().find((m) => m.to === phone)!.body.match(/\b(\d{6})\b/)![1]!;
    const res = await api().post('/api/v1/auth/phone/verify-otp').send({ phone, purpose: 'LOGIN', code }).expect(200);
    expect(res.body.data).toMatchObject({ status: 'mfa_required', mfaRequired: true });
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('turning MFA off needs the password and a valid second factor', async () => {
    const u = await registerUser();
    const { secret } = await enrol(u);
    await api().post('/api/v1/auth/mfa/disable').set(bearer(u)).send({ code: await freshCode(u.id, secret), password: 'wrong-password-1' }).expect(401);
    await api().post('/api/v1/auth/mfa/disable').set(bearer(u)).send({ code: '000000', password: u.password }).expect(401);
    await api().post('/api/v1/auth/mfa/disable').set(bearer(u)).send({ code: await freshCode(u.id, secret), password: u.password }).expect(204);
    const login = await api().post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    expect(login.body.data.accessToken).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { targetId: u.id, action: { in: ['mfa.enabled', 'mfa.disabled'] } } })).toBe(2);
  });
});
