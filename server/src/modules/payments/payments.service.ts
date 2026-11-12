import type { Payment, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, type Tx } from '../../database/prisma';
import { enqueue } from '../../queues';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../shared/errors';
import { logger } from '../../shared/logger';
import { paymentCounter, recordSecurityEvent } from '../../shared/metrics';
import { audit, type AuditContext } from '../audit/audit.service';
import { requireClubPermission } from '../clubs/club-access';
import { notify } from '../notifications/notifications.service';
import { activateSubscription } from '../subscriptions/subscriptions.service';
import { getProvider } from './providers';
import { WebhookAuthError } from './providers/types';

const log = (tx: Tx, paymentId: string, kind: string, status: string, payload: unknown) =>
  tx.paymentTransaction.create({ data: { paymentId, kind, status, payload: JSON.parse(JSON.stringify(payload ?? {})) as Prisma.InputJsonValue } });

async function applyPromotion(code: string | undefined, planCode: string, amount: number) {
  if (!code) return { amount, discount: 0, promo: null };
  const promo = await prisma.promotion.findUnique({ where: { code: code.toUpperCase() } });
  if (!promo || !promo.active || (promo.expiresAt && promo.expiresAt < new Date()) || (promo.maxRedemptions != null && promo.redeemed >= promo.maxRedemptions) || (promo.planCodes.length && !promo.planCodes.includes(planCode))) {
    throw badRequest('This promotion code is not valid for this plan');
  }
  const discount = promo.percentOff ? Math.round((amount * promo.percentOff) / 100) : Math.min(amount, promo.amountOffMinor ?? 0);
  return { amount: amount - discount, discount, promo };
}

export interface CheckoutInput {
  planId: string;
  clubId?: string;
  provider: string;
  phone?: string;
  promotionCode?: string;
}

/**
 * Starts a subscription payment. Idempotent per (payer, Idempotency-Key). The subscription is
 * NOT activated here — only after the provider confirms payment (webhook + status query).
 */
export async function checkout(payerId: string, idempotencyKey: string, input: CheckoutInput, ctx: AuditContext) {
  const existing = await prisma.payment.findUnique({ where: { payerUserId_idempotencyKey: { payerUserId: payerId, idempotencyKey } } });
  if (existing) return paymentView(existing);

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: input.planId } });
  if (!plan || !plan.isActive || plan.isDefault) throw notFound('Plan not found');
  if (plan.audience === 'CLUB') {
    if (!input.clubId) throw badRequest('clubId is required for club plans');
    await requireClubPermission(input.clubId, payerId, 'billing.manage', { allowInactiveClub: true });
  } else if (input.clubId) throw badRequest('Individual plans cannot be bought for a club');
  if (plan.amountMinor <= 0) throw conflict('This plan has no price configured yet', 'PLAN_NOT_PURCHASABLE');

  const provider = getProvider(input.provider);
  if (!provider.currencies.includes(plan.currency)) throw badRequest(`${provider.id} does not support ${plan.currency}`);
  const { amount, discount, promo } = await applyPromotion(input.promotionCode, plan.code, plan.amountMinor);
  const subject = plan.audience === 'CLUB' ? { subjectClubId: input.clubId! } : { subjectUserId: payerId };

  if (amount === 0) {
    // 100% promotion: nothing to collect; activation is audited as a promotional grant.
    await prisma.$transaction(async (tx) => {
      await activateSubscription(plan.audience === 'CLUB' ? { clubId: input.clubId! } : { userId: payerId }, plan.id, tx);
      await tx.promotion.update({ where: { id: promo!.id }, data: { redeemed: { increment: 1 } } });
      await audit({ actorType: 'USER', actorId: payerId, action: 'subscription.activated_by_promotion', targetType: 'plan', targetId: plan.id, clubId: input.clubId ?? null, metadata: { promotion: promo!.code } }, ctx, tx);
    });
    return { paymentId: null, status: 'SUCCEEDED', amountMinor: 0, currency: plan.currency, discountMinor: discount, clientAction: null };
  }

  const payer = await prisma.user.findUniqueOrThrow({ where: { id: payerId }, select: { email: true, phone: true } });
  const payment = await prisma.payment.create({
    data: { purpose: 'SUBSCRIPTION', payerUserId: payerId, planId: plan.id, ...subject, amountMinor: amount, currency: plan.currency, provider: provider.id, idempotencyKey, phone: input.phone ?? payer.phone, promotionCode: promo?.code ?? null },
  });
  return initiate(payment, `${plan.name} (${plan.interval.toLowerCase()})`, payer.email, discount);
}

async function initiate(payment: Payment, description: string, email: string | null, discount = 0) {
  const provider = getProvider(payment.provider);
  try {
    const r = await provider.initiate({ paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, description, idempotencyKey: payment.id, phone: payment.phone, email });
    const updated = await prisma.$transaction(async (tx) => {
      await log(tx, payment.id, 'initiate', 'PENDING', r.raw);
      return tx.payment.update({ where: { id: payment.id }, data: { providerRef: r.providerRef } });
    });
    return { ...paymentView(updated), discountMinor: discount, clientAction: r.clientAction };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Provider error';
    await prisma.$transaction(async (tx) => {
      await log(tx, payment.id, 'initiate', 'ERROR', (err as { raw?: unknown }).raw ?? reason);
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } });
    });
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', `Could not start the payment: ${reason}`);
  }
}

function paymentView(p: Payment) {
  return { paymentId: p.id, status: p.status, amountMinor: p.amountMinor, currency: p.currency, provider: p.provider, failureReason: p.failureReason, confirmedAt: p.confirmedAt };
}

async function nextInvoiceNumber(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) + 1 AS n FROM invoices WHERE number LIKE ${`WT-${year}-%`}`;
  return `WT-${year}-${String(row!.n).padStart(6, '0')}`;
}

/**
 * The single place where money becomes entitlement. Called only after the provider confirmed the
 * payment server-to-server. Idempotent: confirming twice has no further effect.
 */
export async function confirmPayment(paymentId: string, source: string, raw: unknown, receipt?: string) {
  const done = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    if (!locked || locked.status !== 'PENDING') return null;
    const p = await tx.payment.update({ where: { id: paymentId }, data: { status: 'SUCCEEDED', confirmedAt: new Date(), ...(receipt ? { providerReceipt: receipt } : {}) } });
    await log(tx, p.id, source, 'SUCCEEDED', raw);
    let lines: { description: string; amountMinor: number }[] = [];
    let billedTo: Record<string, unknown> = {};
    if (p.purpose === 'SUBSCRIPTION') {
      const plan = await tx.subscriptionPlan.findUniqueOrThrow({ where: { id: p.planId! } });
      await activateSubscription(p.subjectClubId ? { clubId: p.subjectClubId } : { userId: p.subjectUserId! }, plan.id, tx);
      if (p.promotionCode) await tx.promotion.update({ where: { code: p.promotionCode }, data: { redeemed: { increment: 1 } } });
      lines = [{ description: `${plan.name} — 1 ${plan.interval.toLowerCase()}`, amountMinor: plan.amountMinor }];
      if (p.subjectClubId) {
        const club = await tx.club.findUniqueOrThrow({ where: { id: p.subjectClubId }, select: { name: true, contactEmail: true } });
        billedTo = { type: 'club', name: club.name, email: club.contactEmail };
      }
    } else {
      const c = await tx.sponsoredCampaign.update({ where: { id: p.campaignId! }, data: { paidAt: new Date() }, include: { sponsor: true } });
      lines = [{ description: `Sponsored campaign: ${c.name}`, amountMinor: p.amountMinor }];
      billedTo = { type: 'sponsor', name: c.sponsor.name, email: c.sponsor.contactEmail };
    }
    const payer = await tx.user.findUniqueOrThrow({ where: { id: p.payerUserId }, select: { email: true, profile: { select: { displayName: true } } } });
    const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0);
    await tx.invoice.create({
      data: { number: await nextInvoiceNumber(tx), paymentId: p.id, billedTo: { ...billedTo, payer: payer.profile?.displayName, payerEmail: payer.email } as Prisma.InputJsonValue, lines, subtotal, discount: subtotal - p.amountMinor, total: p.amountMinor, currency: p.currency },
    });
    await audit({ actorType: 'SYSTEM', action: 'payment.succeeded', targetType: 'payment', targetId: p.id, clubId: p.subjectClubId, metadata: { amountMinor: p.amountMinor, currency: p.currency, provider: p.provider } }, {}, tx);
    return p;
  });
  if (done) {
    paymentCounter.inc({ provider: done.provider, outcome: 'succeeded' });
    await notify({ userIds: [done.payerUserId], type: 'subscription.payment', title: 'Payment received', body: `${(done.amountMinor / 100).toFixed(2)} ${done.currency} — thank you!`, data: { paymentId: done.id } });
    if (done.purpose === 'SPONSORSHIP') await enqueue('campaigns.activate', { campaignId: done.campaignId! }).catch(() => undefined);
  }
  return done;
}

async function failPayment(paymentId: string, reason: string, raw: unknown) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } });
    if (res.count) await log(tx, paymentId, 'failure', 'FAILED', raw);
  });
}

/**
 * Webhook handling: authenticate → dedupe (webhook_events) → confirm with the provider's status
 * API → apply. Client-side "success" screens never reach this code path.
 */
export async function handleWebhook(providerId: string, req: Request) {
  const provider = getProvider(providerId);
  let evt;
  try {
    evt = await provider.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookAuthError) {
      logger.warn({ provider: providerId }, 'rejected unauthenticated payment webhook');
      recordSecurityEvent('payment_anomaly', `invalid_signature_${providerId}`);
      throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    }
    throw err;
  }
  const inserted = await prisma.webhookEvent.createMany({ data: [{ provider: providerId, eventId: evt.eventId, signatureValid: true, payload: JSON.parse(JSON.stringify(evt.raw)) }], skipDuplicates: true });
  if (!inserted.count) return { duplicate: true, ack: provider.webhookAck?.() };
  try {
    if (evt.providerRef) {
      const payment = await prisma.payment.findUnique({ where: { provider_providerRef: { provider: providerId, providerRef: evt.providerRef } } });
      if (payment && payment.status === 'PENDING') {
        if (evt.outcome === 'SUCCEEDED') {
          const check = await provider.queryStatus(evt.providerRef);
          if (check.outcome === 'SUCCEEDED') await confirmPayment(payment.id, 'webhook', { webhook: evt.raw, query: check.raw }, evt.receipt);
          else logger.warn({ paymentId: payment.id, check: check.outcome }, 'webhook claimed success but provider status disagrees');
        } else if (evt.outcome === 'FAILED') {
          await failPayment(payment.id, evt.failureReason ?? 'Payment failed', evt.raw);
          await notify({ userIds: [payment.payerUserId], type: 'subscription.payment', title: 'Payment not completed', body: evt.failureReason ?? 'Your payment did not go through. Please try again.', data: { paymentId: payment.id } });
        }
      }
    }
    await prisma.webhookEvent.update({ where: { provider_eventId: { provider: providerId, eventId: evt.eventId } }, data: { processedAt: new Date() } });
  } catch (err) {
    await prisma.webhookEvent.update({ where: { provider_eventId: { provider: providerId, eventId: evt.eventId } }, data: { error: String(err).slice(0, 300) } });
    throw err;
  }
  return { duplicate: false, ack: provider.webhookAck?.() };
}

/** Status for the payer (or club billing viewers); pending payments are reconciled on read (throttled). */
export async function getPayment(paymentId: string, userId: string) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment not found');
  if (p.payerUserId !== userId) {
    if (!p.subjectClubId) throw notFound('Payment not found');
    await requireClubPermission(p.subjectClubId, userId, 'billing.view', { allowInactiveClub: true });
  }
  if (p.status === 'PENDING' && p.providerRef && (!p.lastCheckedAt || Date.now() - p.lastCheckedAt.getTime() > 15_000)) {
    await reconcile(p);
    return paymentView(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
  }
  return paymentView(p);
}

async function reconcile(p: Payment) {
  await prisma.payment.update({ where: { id: p.id }, data: { lastCheckedAt: new Date() } });
  try {
    const r = await getProvider(p.provider).queryStatus(p.providerRef!);
    if (r.outcome === 'SUCCEEDED') await confirmPayment(p.id, 'reconcile', r.raw);
    else if (r.outcome === 'FAILED') await failPayment(p.id, r.failureReason ?? 'Payment failed', r.raw);
  } catch (err) {
    logger.warn({ err, paymentId: p.id }, 'payment reconciliation failed');
  }
}

/** Job: reconcile pending payments (missed callbacks); expire stale ones. */
export async function reconcilePendingPayments() {
  const pending = await prisma.payment.findMany({ where: { status: 'PENDING', providerRef: { not: null }, createdAt: { lt: new Date(Date.now() - 2 * 60_000) } }, take: 100 });
  for (const p of pending) {
    if (p.createdAt < new Date(Date.now() - 24 * 3600_000)) await failPayment(p.id, 'Expired without confirmation', {});
    else await reconcile(p);
  }
  return { checked: pending.length };
}

export async function listPayments(where: Prisma.PaymentWhereInput) {
  return prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { invoice: { select: { id: true, number: true, total: true, currency: true, issuedAt: true } } } });
}

export async function myPayments(userId: string) {
  return listPayments({ payerUserId: userId });
}

export async function clubPayments(clubId: string, userId: string) {
  await requireClubPermission(clubId, userId, 'billing.view', { allowInactiveClub: true });
  return listPayments({ subjectClubId: clubId });
}

export async function getInvoice(invoiceId: string, userId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payment: true } });
  if (!inv) throw notFound('Invoice not found');
  if (inv.payment.payerUserId !== userId) {
    if (!inv.payment.subjectClubId) throw notFound('Invoice not found');
    await requireClubPermission(inv.payment.subjectClubId, userId, 'billing.view', { allowInactiveClub: true });
  }
  return inv;
}

export function renderInvoiceHtml(inv: Awaited<ReturnType<typeof getInvoice>>) {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (m: number) => `${(m / 100).toFixed(2)} ${esc(inv.currency)}`;
  const billed = inv.billedTo as Record<string, string>;
  const lines = (inv.lines as { description: string; amountMinor: number }[]).map((l) => `<tr><td>${esc(l.description)}</td><td style="text-align:right">${money(l.amountMinor)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.number)}</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;color:#14211c}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #dbe5e0}</style></head><body>
<h1>WalkTogether</h1><p>Invoice <strong>${esc(inv.number)}</strong><br>Issued ${esc(inv.issuedAt.toISOString().slice(0, 10))}</p>
<p>Billed to: ${esc(billed.name ?? billed.payer)}<br>${esc(billed.email ?? billed.payerEmail)}</p>
<table><thead><tr><th style="text-align:left">Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${lines}
<tr><td>Discount</td><td style="text-align:right">-${money(inv.discount)}</td></tr><tr><td>Tax</td><td style="text-align:right">${money(inv.tax)}</td></tr>
<tr><th style="text-align:left">Total paid</th><th style="text-align:right">${money(inv.total)}</th></tr></tbody></table>
<p>Paid via ${esc(inv.payment.provider)} · Reference ${esc(inv.payment.providerRef)}</p></body></html>`;
}

/** Admin refunds through the provider (Stripe refund, M-Pesa reversal). Asynchronous refunds complete via callback. */
export async function refundPayment(adminId: string, paymentId: string, amountMinor: number, reason: string, ctx: AuditContext) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound('Payment not found');
  if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw conflict('Only successful payments can be refunded', 'NOT_REFUNDABLE');
  if (amountMinor <= 0 || p.refundedMinor + amountMinor > p.amountMinor) throw badRequest('Refund amount exceeds what was paid');
  if (await prisma.refund.count({ where: { paymentId, status: 'PENDING' } })) throw conflict('A refund for this payment is already in progress', 'REFUND_IN_PROGRESS');
  const provider = getProvider(p.provider);
  if (!provider.refund) throw new AppError(501, 'REFUND_UNSUPPORTED', `${p.provider} does not support refunds`);
  let r;
  try {
    r = await provider.refund({ providerRef: p.providerRef!, providerReceipt: p.providerReceipt, amountMinor: p.amountMinor, currency: p.currency }, amountMinor);
  } catch (err) {
    throw new AppError(502, 'REFUND_FAILED', `Refund could not be started: ${(err as Error).message}`);
  }
  const status = r.status;
  const providerRef = r.refundRef;
  await prisma.$transaction(async (tx) => {
    await tx.refund.create({ data: { paymentId, amountMinor, reason, status, providerRef, adminId } });
    if (status === 'SUCCEEDED') {
      const refunded = p.refundedMinor + amountMinor;
      await tx.payment.update({ where: { id: paymentId }, data: { refundedMinor: refunded, status: refunded === p.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    }
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'admin.payment_refund', targetType: 'payment', targetId: paymentId, metadata: { amountMinor, reason, status } }, ctx, tx);
  });
  return { status };
}

export async function assertPayerOwnsCampaign(userId: string, campaignId: string) {
  const c = await prisma.sponsoredCampaign.findUnique({ where: { id: campaignId }, include: { sponsor: true } });
  if (!c || c.sponsor.ownerUserId !== userId) throw forbidden();
  return c;
}

export async function campaignCheckout(payerId: string, idempotencyKey: string, campaignId: string, input: { provider: string; phone?: string }) {
  const existing = await prisma.payment.findUnique({ where: { payerUserId_idempotencyKey: { payerUserId: payerId, idempotencyKey } } });
  if (existing) return paymentView(existing);
  const c = await assertPayerOwnsCampaign(payerId, campaignId);
  if (c.paidAt) throw conflict('This campaign is already paid', 'ALREADY_PAID');
  if (!['PENDING_REVIEW', 'APPROVED'].includes(c.status)) throw conflict('Submit the campaign for review first', 'NOT_SUBMITTED');
  const provider = getProvider(input.provider);
  if (!provider.currencies.includes(c.currency)) throw badRequest(`${provider.id} does not support ${c.currency}`);
  const payer = await prisma.user.findUniqueOrThrow({ where: { id: payerId }, select: { email: true, phone: true } });
  const payment = await prisma.payment.create({
    data: { purpose: 'SPONSORSHIP', payerUserId: payerId, campaignId, amountMinor: c.budgetMinor, currency: c.currency, provider: provider.id, idempotencyKey, phone: input.phone ?? payer.phone },
  });
  return initiate(payment, `Sponsorship: ${c.name}`, payer.email);
}

/** Applies an asynchronous refund result (M-Pesa reversal callback). Idempotent. */
export async function completeRefund(refundRef: string, succeeded: boolean, raw: unknown) {
  const refund = await prisma.refund.findFirst({ where: { providerRef: refundRef, status: 'PENDING' }, include: { payment: true } });
  if (!refund) return;
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refund.id }, data: { status: succeeded ? 'SUCCEEDED' : 'FAILED' } });
    await log(tx, refund.paymentId, 'refund_result', succeeded ? 'SUCCEEDED' : 'FAILED', raw);
    if (succeeded) {
      const refunded = refund.payment.refundedMinor + refund.amountMinor;
      await tx.payment.update({ where: { id: refund.paymentId }, data: { refundedMinor: refunded, status: refunded >= refund.payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    }
    await audit({ actorType: 'SYSTEM', action: succeeded ? 'payment.refund_succeeded' : 'payment.refund_failed', targetType: 'payment', targetId: refund.paymentId }, {}, tx);
  });
}
