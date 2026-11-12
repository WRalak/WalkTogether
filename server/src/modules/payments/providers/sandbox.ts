import { createHmac } from 'node:crypto';
import { env } from '../../../config/env';
import { safeEqual } from '../../../shared/crypto';
import type { InitiateInput, PaymentProvider } from './types';
import { WebhookAuthError } from './types';

/**
 * Development/test provider. Behaves like a real asynchronous provider: initiation is PENDING
 * and success arrives only through a SIGNED webhook (sandbox:confirm). It is refused in
 * staging/production by configuration validation, so it can never mark real payments as paid.
 */
const outcomes = new Map<string, 'SUCCEEDED' | 'FAILED' | 'PENDING'>();

export function sandboxSignature(body: string) {
  return createHmac('sha256', env.TOKEN_HASH_SECRET).update(`sandbox:${body}`).digest('hex');
}

export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox';
  readonly currencies = ['KES', 'USD', 'UGX', 'TZS', 'RWF'];

  async initiate(input: InitiateInput) {
    const ref = `sbx_${input.paymentId}`;
    outcomes.set(ref, 'PENDING');
    return {
      providerRef: ref,
      status: 'PENDING' as const,
      clientAction: { type: 'stk_push' as const, message: 'Sandbox payment created. Confirm it via the sandbox webhook.' },
      raw: { ref },
    };
  }

  async parseWebhook(req: import('express').Request) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    if (!safeEqual(String(req.header('x-sandbox-signature') ?? ''), sandboxSignature(raw))) throw new WebhookAuthError();
    const body = JSON.parse(raw) as { eventId: string; providerRef: string; outcome: 'SUCCEEDED' | 'FAILED' };
    outcomes.set(body.providerRef, body.outcome);
    return { eventId: body.eventId, providerRef: body.providerRef, outcome: body.outcome, raw: body };
  }

  async queryStatus(providerRef: string) {
    return { outcome: outcomes.get(providerRef) ?? ('PENDING' as const), raw: {} };
  }

  async refund(payment: { providerRef: string }) {
    return { refundRef: `sbx_refund_${payment.providerRef}`, status: 'SUCCEEDED' as const };
  }
}
