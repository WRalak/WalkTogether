import { createHmac } from 'node:crypto';
import { env } from '../../../config/env';
import { safeEqual } from '../../../shared/crypto';
import type { InitiateInput, PaymentProvider } from './types';
import { WebhookAuthError } from './types';

const API = 'https://api.stripe.com/v1';
const TOLERANCE_S = 300;

function form(obj: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) p.set(k, String(v));
  return p;
}

/** Stripe Checkout (cards, international). Webhooks are verified with the endpoint signing secret. */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';
  readonly currencies = ['USD', 'EUR', 'GBP', 'KES'];

  private async call<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw Object.assign(new Error(json.error?.message ?? `Stripe HTTP ${res.status}`), { raw: json });
    return json;
  }

  async initiate(input: InitiateInput) {
    const session = await this.call<{ id: string; url: string }>(
      'POST',
      '/checkout/sessions',
      form({
        mode: 'payment',
        'line_items[0][price_data][currency]': input.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': input.amountMinor,
        'line_items[0][price_data][product_data][name]': input.description,
        'line_items[0][quantity]': 1,
        client_reference_id: input.paymentId,
        'metadata[paymentId]': input.paymentId,
        customer_email: input.email ?? undefined,
        success_url: input.successUrl ?? `${env.API_PUBLIC_URL}/links/payment?result=success`,
        cancel_url: input.cancelUrl ?? `${env.API_PUBLIC_URL}/links/payment?result=cancelled`,
      }),
      input.idempotencyKey,
    );
    return { providerRef: session.id, status: 'PENDING' as const, clientAction: { type: 'redirect' as const, url: session.url }, raw: session };
  }

  /** Verifies the Stripe-Signature header over the raw request body. */
  static verifySignature(rawBody: Buffer, header: string | undefined, secret: string, now = Date.now()) {
    if (!header) return false;
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || Math.abs(now / 1000 - t) > TOLERANCE_S) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    return header
      .split(',')
      .filter((kv) => kv.startsWith('v1='))
      .some((kv) => safeEqual(kv.slice(3), expected));
  }

  async parseWebhook(req: import('express').Request) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw || !env.STRIPE_WEBHOOK_SECRET || !StripeProvider.verifySignature(raw, req.header('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) throw new WebhookAuthError();
    const event = JSON.parse(raw.toString('utf8')) as { id: string; type: string; data: { object: { id: string; payment_status?: string } } };
    const obj = event.data.object;
    const outcome = event.type === 'checkout.session.completed' && obj.payment_status === 'paid' ? 'SUCCEEDED' : event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed' ? 'FAILED' : 'PENDING';
    return { eventId: event.id, providerRef: obj.id, outcome: outcome as 'SUCCEEDED' | 'FAILED' | 'PENDING', raw: event };
  }

  async queryStatus(providerRef: string) {
    const s = await this.call<{ status: string; payment_status: string }>('GET', `/checkout/sessions/${encodeURIComponent(providerRef)}`);
    if (s.payment_status === 'paid') return { outcome: 'SUCCEEDED' as const, raw: s };
    if (s.status === 'expired') return { outcome: 'FAILED' as const, failureReason: 'Checkout expired', raw: s };
    return { outcome: 'PENDING' as const, raw: s };
  }

  async refund(payment: { providerRef: string }, amountMinor: number) {
    const s = await this.call<{ payment_intent: string }>('GET', `/checkout/sessions/${encodeURIComponent(payment.providerRef)}`);
    const r = await this.call<{ id: string; status: string }>('POST', '/refunds', form({ payment_intent: s.payment_intent, amount: amountMinor }));
    return { refundRef: r.id, status: r.status === 'succeeded' ? ('SUCCEEDED' as const) : ('PENDING' as const) };
  }
}
