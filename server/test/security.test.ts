/**
 * Automated security regression tests (OWASP-oriented). They complement, not replace, an external
 * penetration test before launch.
 */
import { SignJWT } from 'jose';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { api, bearer, createAdmin, createClub, registerUser, teardown, uid } from './helpers';
import { testEnv } from './env';

afterAll(teardown);

const memberKey = new TextEncoder().encode(testEnv.JWT_ACCESS_SECRET);

async function forge(opts: { key?: Uint8Array; aud?: string; typ?: string; exp?: number; sub: string; sid?: string }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: opts.typ ?? 'access', sid: opts.sid ?? 'x' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('walktogether-api')
    .setAudience(opts.aud ?? 'walktogether:member')
    .setSubject(opts.sub)
    .setIssuedAt(now - 10)
    .setExpirationTime(opts.exp ?? now + 300)
    .sign(opts.key ?? memberKey);
}

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await api().get('/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('does not grant CORS to unknown origins', async () => {
    const evil = await api().get('/health/live').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const good = await api().get('/health/live').set('Origin', 'http://localhost:3001');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });

  it('rejects oversized and malformed JSON bodies without leaking internals', async () => {
    const big = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send(`{"email":"${'a'.repeat(1_100_000)}"}`);
    expect(big.status).toBe(413);
    const bad = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  it('protects the metrics endpoint', async () => {
    await api().get('/metrics').expect((r) => expect([401, 404]).toContain(r.status));
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await api().get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('authentication bypass attempts', () => {
  it('rejects missing, garbage and alg=none tokens', async () => {
    await api().get('/api/v1/users/me').expect(401);
    await api().get('/api/v1/users/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    const u = await registerUser();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: u.id, typ: 'access', aud: 'walktogether:member', iss: 'walktogether-api', exp: 9999999999 })).toString('base64url');
    await api().get('/api/v1/users/me').set('Authorization', `Bearer ${header}.${body}.`).expect(401);
  });

  it('rejects tokens signed with the wrong key, wrong audience, wrong type or expired', async () => {
    const u = await registerUser();
    const wrongKey = await forge({ sub: u.id, sid: u.sessionId, key: new TextEncoder().encode('attacker-secret-0123456789abcdef0123456789') });
    const wrongAud = await forge({ sub: u.id, sid: u.sessionId, aud: 'walktogether:platform-admin' });
    const wrongTyp = await forge({ sub: u.id, sid: u.sessionId, typ: 'phone_registration' });
    const expired = await forge({ sub: u.id, sid: u.sessionId, exp: Math.floor(Date.now() / 1000) - 60 });
    for (const t of [wrongKey, wrongAud, wrongTyp, expired]) {
      await api().get('/api/v1/users/me').set('Authorization', `Bearer ${t}`).expect(401);
    }
  });

  it('a valid signature for a revoked session is refused', async () => {
    const u = await registerUser();
    await api().post('/api/v1/auth/logout').set(bearer(u)).send({ refreshToken: u.refreshToken }).expect((r) => expect(r.status).toBeLessThan(300));
    await api().get('/api/v1/users/me').set(bearer(u)).expect(401);
  });

  it('member tokens cannot reach the platform-admin API and vice versa', async () => {
    const u = await registerUser();
    await api().get('/api/v1/platform-admin/users').set(bearer(u)).expect(401);
    const admin = await createAdmin();
    await api().get('/api/v1/users/me').set(bearer(admin)).expect(401);
  });

  it('member secret cannot mint admin tokens', async () => {
    const admin = await createAdmin();
    const row = await prisma.adminUser.findUniqueOrThrow({ where: { email: admin.email } });
    const forged = await forge({ sub: row.id, aud: 'walktogether:platform-admin', typ: 'admin_access' });
    await api().get('/api/v1/platform-admin/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('login errors do not reveal whether an account exists', async () => {
    const u = await registerUser();
    const wrongPw = await api().post('/api/v1/auth/login').send({ email: u.email, password: 'wrong-password-123' });
    const noUser = await api().post('/api/v1/auth/login').send({ email: `nobody_${uid()}@example.com`, password: 'wrong-password-123' });
    expect(wrongPw.status).toBe(noUser.status);
    expect(wrongPw.body.error.code).toBe(noUser.body.error.code);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });
});

describe('injection and mass assignment', () => {
  it('search parameters are treated as data, not SQL', async () => {
    const owner = await registerUser();
    await createClub(owner);
    for (const q of ["' OR 1=1 --", "'; DROP TABLE users; --", '%_%', '\\']) {
      const res = await api().get('/api/v1/clubs').query({ q });
      expect(res.status).toBe(200);
    }
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  it('registration ignores privileged fields', async () => {
    const id = uid();
    const res = await api().post('/api/v1/auth/register').send({
      email: `mass_${id}@example.com`, password: 'walk2gether-strong', username: `m_${id}`, displayName: 'M',
      acceptTerms: true, status: 'ACTIVE', emailVerifiedAt: new Date().toISOString(), role: 'SUPER_ADMIN', isAdmin: true,
    });
    expect([201, 422]).toContain(res.status);
    if (res.status === 201) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.userId } });
      expect(user.emailVerifiedAt).toBeNull();
    }
  });

  it('a club id in the body cannot redirect a write to another tenant', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const clubA = await createClub(a);
    const clubB = await createClub(b);
    const before = await prisma.club.findUniqueOrThrow({ where: { id: clubB.id } });
    await api().patch(`/api/v1/clubs/${clubA.id}`).set(bearer(a)).send({ id: clubB.id, clubId: clubB.id, name: `Renamed ${uid()}` });
    const untouched = await prisma.club.findUniqueOrThrow({ where: { id: clubB.id } });
    expect(untouched.name).toBe(before.name);
  });

  it('stored text is returned verbatim (escaping is the renderer’s job) and never executed server-side', async () => {
    const u = await registerUser();
    const payload = '<script>alert(1)</script>{{7*7}}${7*7}';
    await api().patch('/api/v1/users/me').set(bearer(u)).send({ bio: payload }).expect(200);
    const res = await api().get('/api/v1/users/me').set(bearer(u)).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.data.profile.bio).toBe(payload);
  });
});

describe('payment webhooks', () => {
  it('rejects unsigned or forged Stripe and M-Pesa callbacks', async () => {
    const stripe = await api().post('/api/v1/payments/webhooks/stripe').send({ type: 'checkout.session.completed', data: { object: { id: 'cs_x' } } });
    expect(stripe.status).toBeGreaterThanOrEqual(400);
    const mpesa = await api().post('/api/v1/payments/webhooks/mpesa').send({ Body: { stkCallback: { CheckoutRequestID: 'ws_x', ResultCode: 0 } } });
    expect(mpesa.status).toBeGreaterThanOrEqual(400);
  });
});
