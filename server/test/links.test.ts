/** Pages served by the API for links opened outside the app (there is no separate website). */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { api, bearer, createClub, lastEmailTo, registerUser, teardown, tokenFromEmail } from './helpers';

afterAll(teardown);

describe('email links', () => {
  it('verification email links to the API page, which verifies the address', async () => {
    const u = await registerUser({ verified: false });
    expect(lastEmailTo(u.email).text).toContain('/links/verify-email?token=');
    const res = await api().get('/links/verify-email').query({ token: tokenFromEmail(u.email) }).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Email verified');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.emailVerifiedAt).not.toBeNull();
    await api().get('/links/verify-email').query({ token: tokenFromEmail(u.email) }).expect(400);
    await api().get('/links/verify-email').query({ token: 'x' }).expect(400);
  });

  it('reset link shows a form; mismatched or weak passwords are rejected; a valid one resets', async () => {
    const u = await registerUser();
    await api().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(202);
    const token = tokenFromEmail(u.email);
    const form = await api().get('/links/reset-password').query({ token }).expect(200);
    expect(form.text).toContain('<form method="post"');
    const mismatch = await api().post('/links/reset-password').type('form').send({ token, password: 'a-new-strong-pass-1', confirm: 'different-pass-123' }).expect(400);
    expect(mismatch.text).toContain('don’t match');
    await api().post('/links/reset-password').type('form').send({ token, password: 'short', confirm: 'short' }).expect(400);
    const ok = await api().post('/links/reset-password').type('form').send({ token, password: 'a-new-strong-pass-1', confirm: 'a-new-strong-pass-1' }).expect(200);
    expect(ok.text).toContain('Password changed');
    await api().post('/api/v1/auth/login').send({ email: u.email, password: 'a-new-strong-pass-1' }).expect(200);
    await api().post('/links/reset-password').type('form').send({ token, password: 'another-pass-123', confirm: 'another-pass-123' }).expect(400);
  });
});

describe('invitation, payment and legal pages', () => {
  it('invitation links open the app; output is escaped', async () => {
    const owner = await registerUser();
    const club = await createClub(owner, { name: 'Night <script>alert(1)</script> Walkers' });
    const inv = await api().post(`/api/v1/clubs/${club.id}/invitations`).set(bearer(owner)).send({}).expect(201);
    expect(inv.body.data.link).toContain(`/links/invite/${inv.body.data.code}`);
    const res = await api().get(`/links/invite/${inv.body.data.code}`).expect(200);
    expect(res.text).toContain(`walktogether://clubs/${club.slug}?invite=`);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
    await api().get('/links/invite/doesnotexist').expect(404);
  });

  it('payment return pages never confirm payments themselves', async () => {
    const res = await api().get('/links/payment').query({ result: 'success' }).expect(200);
    expect(res.text).toContain('as soon as the payment provider does');
    expect((await api().get('/links/payment').expect(200)).text).toContain('cancelled');
  });

  it('serves privacy and terms pages for app-store listings', async () => {
    expect((await api().get('/legal/privacy').expect(200)).text).toContain('Kenya Data Protection Act');
    expect((await api().get('/legal/terms').expect(200)).text).toContain('Terms of service');
  });
});
