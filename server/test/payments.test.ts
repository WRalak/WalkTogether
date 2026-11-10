import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/database/prisma';
import { sandboxSignature } from '../src/modules/payments/providers/sandbox';
import { StripeProvider } from '../src/modules/payments/providers/stripe';
import { finalizeEndedChallenges } from '../src/modules/challenges/challenges.service';
import { resolveEntitlements } from '../src/modules/subscriptions/entitlements.service';
import { addMember, api, bearer, createAdmin, createClub, registerUser, teardown, uid, type TestUser } from './helpers';

afterAll(teardown);

async function paidPlan(audience: 'CLUB' | 'INDIVIDUAL', ent: Record<string, boolean | number>, amountMinor = 150000) {
  return prisma.subscriptionPlan.create({
    data: { code: `p_${uid()}`, audience, name: `Plan ${uid()}`, isActive: true, amountMinor, currency: 'KES', entitlements: { create: Object.entries(ent).map(([key, v]) => (typeof v === 'number' ? { key, intLimit: v } : { key, boolValue: v })) } },
  });
}

function sandboxWebhook(providerRef: string, outcome: 'SUCCEEDED' | 'FAILED', eventId = randomUUID()) {
  const body = JSON.stringify({ eventId, providerRef, outcome });
  return api().post('/api/v1/payments/webhooks/sandbox').set('Content-Type', 'application/json').set('X-Sandbox-Signature', sandboxSignature(body)).send(body);
}

const checkout = (u: TestUser, body: Record<string, unknown>, key = randomUUID()) => api().post('/api/v1/subscriptions/checkout').set(bearer(u)).set('Idempotency-Key', key).send(body);

describe('subscription checkout', () => {
  it('activates only after a verified provider confirmation; idempotent and invoiced', async () => {
    const owner = await registerUser();
    const club = await createClub(owner);
    const plan = await paidPlan('CLUB', { 'club.exports': true });
    await api().post('/api/v1/subscriptions/checkout').set(bearer(owner)).send({ planId: plan.id, clubId: club.id, provider: 'sandbox' }).expect(400); // no idempotency key
    const key = randomUUID();
    const r1 = await checkout(owner, { planId: plan.id, clubId: club.id, provider: 'sandbox' }, key).expect(202);
    const r2 = await checkout(owner, { planId: plan.id, clubId: club.id, provider: 'sandbox' }, key).expect(202);
    expect(r2.body.data.paymentId).toBe(r1.body.data.paymentId);
    expect(r1.body.data.status).toBe('PENDING');
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(false);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: r1.body.data.paymentId } });
    // Forged webhook is rejected.
    await api().post('/api/v1/payments/webhooks/sandbox').set('X-Sandbox-Signature', 'forged').send({ eventId: 'x', providerRef: payment.providerRef, outcome: 'SUCCEEDED' }).expect(401);
    expect((await api().get(`/api/v1/payments/${payment.id}`).set(bearer(owner)).expect(200)).body.data.status).toBe('PENDING');

    const evt = randomUUID();
    await sandboxWebhook(payment.providerRef!, 'SUCCEEDED', evt).expect(200);
    await sandboxWebhook(payment.providerRef!, 'SUCCEEDED', evt).expect(200); // duplicate delivery
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { invoice: true } });
    expect(after.status).toBe('SUCCEEDED');
    expect(after.invoice?.number).toMatch(/^WT-\d{4}-\d{6}$/);
    expect((await resolveEntitlements({ clubId: club.id })).values['club.exports']).toBe(true);
    expect(await prisma.subscription.count({ where: { clubId: club.id } })).toBe(1);
    const html = await api().get(`/api/v1/payments/invoices/${after.invoice!.id}/html`).set(bearer(owner)).expect(200);
    expect(html.text).toContain(after.invoice!.number);
    // Club subscription does not make members premium.
    const member = await registerUser();
    await addMember(club.id, member.id);
    expect((await resolveEntitlements({ userId: member.id })).values['user.advanced_analytics']).toBe(false);
  });

  it('only billing managers can buy club plans; free/unpriced plans are not purchasable', async () => {
    const owner = await registerUser();
    const admin = await registerUser();
    const club = await createClub(owner);
    await addMember(club.id, admin.id, 'ADMIN'); // ADMIN lacks billing.manage
    const plan = await paidPlan('CLUB', {});
    await checkout(admin, { planId: plan.id, clubId: club.id, provider: 'sandbox' }).expect(403);
    const unpriced = await paidPlan('CLUB', {}, 0);
    await prisma.subscriptionPlan.update({ where: { id: unpriced.id }, data: { amountMinor: 0 } });
    expect((await checkout(owner, { planId: unpriced.id, clubId: club.id, provider: 'sandbox' }).expect(409)).body.error.code).toBe('PLAN_NOT_PURCHASABLE');
    await checkout(owner, { planId: plan.id, clubId: club.id, provider: 'mpesa' }).expect(503);
  });

  it('failed payments do not activate and notify the payer', async () => {
    const u = await registerUser();
    const plan = await paidPlan('INDIVIDUAL', { 'user.advanced_analytics': true });
    const r = await checkout(u, { planId: plan.id, provider: 'sandbox' }).expect(202);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.body.data.paymentId } });
    await sandboxWebhook(p.providerRef!, 'FAILED').expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('FAILED');
    expect((await resolveEntitlements({ userId: u.id })).values['user.advanced_analytics']).toBe(false);
    const n = (await api().get('/api/v1/notifications').set(bearer(u))).body.data[0];
    expect(n.title).toBe('Payment not completed');
  });

  it('promotions discount or fully cover a plan', async () => {
    const admin = await createAdmin('FINANCE');
    const u = await registerUser();
    const plan = await paidPlan('INDIVIDUAL', { 'user.advanced_analytics': true }, 100000);
    const half = `HALF${uid().toUpperCase()}`;
    const free = `PILOT${uid().toUpperCase()}`;
    const A = { Authorization: `Bearer ${admin.accessToken}` };
    await api().put(`/api/v1/platform-admin/promotions/${half}`).set(A).send({ percentOff: 50 }).expect(200);
    await api().put(`/api/v1/platform-admin/promotions/${free}`).set(A).send({ percentOff: 100, maxRedemptions: 1 }).expect(200);
    const r = await checkout(u, { planId: plan.id, provider: 'sandbox', promotionCode: half }).expect(202);
    expect(r.body.data.amountMinor).toBe(50000);
    const r2 = await checkout(u, { planId: plan.id, provider: 'sandbox', promotionCode: free }).expect(202);
    expect(r2.body.data.status).toBe('SUCCEEDED');
    expect((await resolveEntitlements({ userId: u.id })).values['user.advanced_analytics']).toBe(true);
    await checkout(await registerUser(), { planId: plan.id, provider: 'sandbox', promotionCode: free }).expect(400); // exhausted
  });

  it('admins can refund; revenue analytics reflect verified payments', async () => {
    const admin = await createAdmin();
    const u = await registerUser();
    const plan = await paidPlan('INDIVIDUAL', {}, 80000);
    const r = await checkout(u, { planId: plan.id, provider: 'sandbox' }).expect(202);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.body.data.paymentId } });
    await sandboxWebhook(p.providerRef!, 'SUCCEEDED').expect(200);
    const A = { Authorization: `Bearer ${admin.accessToken}` };
    const rev = (await api().get('/api/v1/platform-admin/revenue').set(A).expect(200)).body.data;
    expect(rev.mrr.KES).toBeGreaterThanOrEqual(80000);
    await api().post(`/api/v1/platform-admin/payments/${p.id}/refund`).set(A).send({ amountMinor: 90000, reason: 'Too much' }).expect(400);
    await api().post(`/api/v1/platform-admin/payments/${p.id}/refund`).set(A).send({ amountMinor: 80000, reason: 'Customer request' }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REFUNDED');
  });
});

describe('Stripe webhook signatures', () => {
  it('verifies HMAC signatures with timestamp tolerance', () => {
    const secret = 'whsec_test';
    const body = Buffer.from('{"id":"evt_1"}');
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body.toString()}`).digest('hex');
    expect(StripeProvider.verifySignature(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(StripeProvider.verifySignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret)).toBe(false);
    expect(StripeProvider.verifySignature(body, `t=${t - 3600},v1=${sig}`, secret)).toBe(false);
    expect(StripeProvider.verifySignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, secret)).toBe(false);
  });
});

describe('sponsorships', () => {
  it('sponsor → campaign → paid + approved → labelled sponsored challenge with consent → report → rewards', async () => {
    const admin = await createAdmin();
    const A = { Authorization: `Bearer ${admin.accessToken}` };
    const brand = await registerUser();
    const sponsor = await api().post('/api/v1/sponsors').set(bearer(brand)).send({ name: 'Safari Water', slug: `safari-${uid()}`, contactEmail: 'brand@example.com' }).expect(201);
    const campaignBody = {
      name: 'Safari Water 100K',
      type: 'CHALLENGE',
      budgetMinor: 5_000_000,
      currency: 'KES',
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      terms: 'Open to registered users aged 18+. Only verified GPS activities count. Daily distance capped at 20 km. Prizes are non-transferable.',
      prizeDescription: 'Hydration packs for the top 3',
      challengeConfig: { title: 'Safari Water 100K', metric: 'DISTANCE_M', activityTypes: ['WALK', 'RUN'], target: 100000, maxDailyDistanceM: 20000 },
    };
    await api().post(`/api/v1/sponsors/${sponsor.body.data.id}/campaigns`).set(bearer(brand)).send(campaignBody).expect(403); // sponsor not yet approved
    await api().post(`/api/v1/platform-admin/sponsors/${sponsor.body.data.id}/status`).set(A).send({ status: 'ACTIVE' }).expect(200);
    const camp = await api().post(`/api/v1/sponsors/${sponsor.body.data.id}/campaigns`).set(bearer(brand)).send(campaignBody).expect(201);
    const cid = camp.body.data.id;
    await api().post(`/api/v1/campaigns/${cid}/submit`).set(bearer(brand)).expect(200);
    const pay = await api().post(`/api/v1/payments/campaigns/${cid}/checkout`).set(bearer(brand)).set('Idempotency-Key', randomUUID()).send({ provider: 'sandbox' }).expect(202);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.body.data.paymentId } });
    await sandboxWebhook(p.providerRef!, 'SUCCEEDED').expect(200);
    expect((await prisma.sponsoredCampaign.findUniqueOrThrow({ where: { id: cid } })).status).toBe('PENDING_REVIEW'); // paid but not yet approved
    await api().post(`/api/v1/platform-admin/campaigns/${cid}/review`).set(A).send({ decision: 'APPROVE', note: 'Terms are clear' }).expect(204);
    const c = await prisma.sponsoredCampaign.findUniqueOrThrow({ where: { id: cid } });
    expect(c.status).toBe('ACTIVE');
    const ch = await api().get(`/api/v1/challenges/${c.challengeId}`).expect(200);
    expect(ch.body.data).toMatchObject({ isSponsored: true, sponsorName: 'Safari Water' });
    const sponsored = (await api().get('/api/v1/sponsored').expect(200)).body.data;
    expect(sponsored.find((s: { id: string }) => s.id === cid).label).toBe('Sponsored');

    const walker = await registerUser();
    await api().post(`/api/v1/challenges/${c.challengeId}/join`).set(bearer(walker)).send({}).expect(400); // consent required
    await api().post(`/api/v1/challenges/${c.challengeId}/join`).set(bearer(walker)).send({ acceptTerms: true }).expect(200);
    // A verified, completed walk inside the window (server-computed stats are trusted here).
    await prisma.activity.create({ data: { userId: walker.id, clientId: randomUUID(), type: 'WALK', status: 'COMPLETED', startedAt: new Date(Date.now() - 1800_000), endedAt: new Date(), distanceM: 12000, movingSeconds: 7200 } });
    await api().post(`/api/v1/challenges/${c.challengeId}/join`).set(bearer(walker)).send({ acceptTerms: true }).expect(200); // recompute
    const report = (await api().get(`/api/v1/campaigns/${cid}/report`).set(bearer(brand)).expect(200)).body.data;
    expect(report.challenge.participants).toBe(1);
    expect(JSON.stringify(report)).not.toContain(walker.username); // aggregated only
    await api().get(`/api/v1/campaigns/${cid}/report`).set(bearer(walker)).expect(404);

    await prisma.challenge.update({ where: { id: c.challengeId! }, data: { endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 86_400_000) } });
    await finalizeEndedChallenges();
    const rewards = await api().post(`/api/v1/platform-admin/campaigns/${cid}/rewards`).set(A).send({ topN: 3, description: 'Hydration pack' }).expect(200);
    expect(rewards.body.data).toHaveLength(1);
  });

  it('event sponsorship needs the club’s acceptance before it is shown', async () => {
    const admin = await createAdmin();
    const A = { Authorization: `Bearer ${admin.accessToken}` };
    const owner = await registerUser();
    const club = await createClub(owner);
    const ev = await api()
      .post(`/api/v1/clubs/${club.id}/events`)
      .set(bearer(owner))
      .send({ title: 'Charity walk', type: 'CHARITY_WALK', visibility: 'PUBLIC', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), endsAt: new Date(Date.now() + 5 * 86_400_000 + 7200_000).toISOString(), meetingPoint: 'Uhuru Park' })
      .expect(201);
    const brand = await registerUser();
    const sp = await api().post('/api/v1/sponsors').set(bearer(brand)).send({ name: 'Jua Bank', slug: `jua-${uid()}`, contactEmail: 'csr@example.com' }).expect(201);
    await api().post(`/api/v1/platform-admin/sponsors/${sp.body.data.id}/status`).set(A).send({ status: 'ACTIVE' }).expect(200);
    const camp = await api()
      .post(`/api/v1/sponsors/${sp.body.data.id}/campaigns`)
      .set(bearer(brand))
      .send({ name: 'Jua charity walk', type: 'EVENT', budgetMinor: 1_000_000, currency: 'KES', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), terms: 'Jua Bank sponsors refreshments. No participant data is shared with the sponsor; reports are aggregated.', eventIds: [ev.body.data.id] })
      .expect(201);
    await api().post(`/api/v1/campaigns/${camp.body.data.id}/submit`).set(bearer(brand)).expect(200);
    const pay = await api().post(`/api/v1/payments/campaigns/${camp.body.data.id}/checkout`).set(bearer(brand)).set('Idempotency-Key', randomUUID()).send({ provider: 'sandbox' }).expect(202);
    await sandboxWebhook((await prisma.payment.findUniqueOrThrow({ where: { id: pay.body.data.paymentId } })).providerRef!, 'SUCCEEDED').expect(200);
    await api().post(`/api/v1/platform-admin/campaigns/${camp.body.data.id}/review`).set(A).send({ decision: 'APPROVE', note: 'ok go' }).expect(204);
    expect((await api().get(`/api/v1/events/${ev.body.data.id}`).expect(200)).body.data.sponsor).toBeNull();
    const offers = await api().get(`/api/v1/clubs/${club.id}/sponsorship-offers`).set(bearer(owner)).expect(200);
    expect(offers.body.data[0].campaign.sponsor.name).toBe('Jua Bank');
    await api().post(`/api/v1/clubs/${club.id}/sponsorship-offers/${ev.body.data.id}`).set(bearer(owner)).send({ accept: true }).expect(204);
    expect((await api().get(`/api/v1/events/${ev.body.data.id}`).expect(200)).body.data.sponsor).toMatchObject({ label: 'Sponsored', name: 'Jua Bank' });
  });
});
