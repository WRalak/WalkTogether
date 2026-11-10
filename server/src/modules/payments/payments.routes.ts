import { Router } from 'express';
import { z } from 'zod';
import { campaignCheckoutSchema, checkoutSchema } from '@walktogether/validation';
import { authUserId, requireAuth } from '../../middleware/authenticate';
import { auditCtx } from '../../middleware/request-context';
import { parse } from '../../middleware/validate';
import { badRequest, unauthorized } from '../../shared/errors';
import * as svc from './payments.service';
import { enabledProviders, getProvider } from './providers';
import type { MpesaProvider } from './providers/mpesa';

const idParam = z.object({ id: z.string().uuid() });
const idempotencyKey = (h: string | undefined) => {
  if (!h || !/^[A-Za-z0-9_-]{8,100}$/.test(h)) throw badRequest('An Idempotency-Key header (8–100 chars) is required');
  return h;
};

export const checkoutRouter = Router();
checkoutRouter.get('/providers', (_req, res) => {
  res.json({ data: enabledProviders() });
});
checkoutRouter.post('/checkout', requireAuth, async (req, res) => {
  res.status(202).json({ data: await svc.checkout(authUserId(req), idempotencyKey(req.header('idempotency-key')), parse(checkoutSchema, req.body), auditCtx(req)) });
});

export const paymentsRouter = Router();
/** M-Pesa reversal (refund) results — authenticated by the callback secret. */
paymentsRouter.post('/webhooks/mpesa/reversal-result', async (req, res) => {
  const provider = getProvider('mpesa') as MpesaProvider;
  let r;
  try {
    r = provider.parseReversalResult(req);
  } catch {
    throw unauthorized('Webhook verification failed', 'INVALID_SIGNATURE');
  }
  await svc.completeRefund(r.refundRef, r.succeeded, req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/** Provider callbacks: authenticated by signature/secret, never by user tokens. */
paymentsRouter.post('/webhooks/:provider', async (req, res) => {
  const { provider } = parse(z.object({ provider: z.string().regex(/^[a-z]{2,20}$/) }), req.params);
  const r = await svc.handleWebhook(provider, req);
  res.status(200).json(r.ack ?? { received: true });
});
paymentsRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await svc.myPayments(authUserId(req)) });
});
paymentsRouter.get('/clubs/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.clubPayments(parse(idParam, req.params).id, authUserId(req)) });
});
paymentsRouter.get('/invoices/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.getInvoice(parse(idParam, req.params).id, authUserId(req)) });
});
paymentsRouter.get('/invoices/:id/html', requireAuth, async (req, res) => {
  const inv = await svc.getInvoice(parse(idParam, req.params).id, authUserId(req));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(svc.renderInvoiceHtml(inv));
});
paymentsRouter.post('/campaigns/:id/checkout', requireAuth, async (req, res) => {
  res.status(202).json({ data: await svc.campaignCheckout(authUserId(req), idempotencyKey(req.header('idempotency-key')), parse(idParam, req.params).id, parse(campaignCheckoutSchema, req.body)) });
});
paymentsRouter.get('/:id', requireAuth, async (req, res) => {
  res.json({ data: await svc.getPayment(parse(idParam, req.params).id, authUserId(req)) });
});
