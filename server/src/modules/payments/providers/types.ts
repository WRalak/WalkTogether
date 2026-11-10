import type { Request } from 'express';

export type ProviderOutcome = 'SUCCEEDED' | 'FAILED' | 'PENDING';

export interface InitiateInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  idempotencyKey: string;
  phone?: string | null;
  email?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}

export interface InitiateResult {
  providerRef: string;
  status: 'PENDING';
  clientAction: { type: 'stk_push'; message: string } | { type: 'redirect'; url: string };
  raw: unknown;
}

export interface WebhookResult {
  eventId: string;
  providerRef: string | null;
  outcome: ProviderOutcome;
  failureReason?: string;
  raw: unknown;
}

/**
 * Payment provider abstraction. Implementations must never report SUCCEEDED from data the
 * client controls: webhooks are verified (signature / secret) and confirmed with queryStatus.
 */
export interface PaymentProvider {
  readonly id: string;
  readonly currencies: string[];
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Throws if the request is not authentic. */
  parseWebhook(req: Request): Promise<WebhookResult>;
  queryStatus(providerRef: string): Promise<{ outcome: ProviderOutcome; failureReason?: string; raw: unknown }>;
  refund?(providerRef: string, amountMinor: number): Promise<{ refundRef: string }>;
  /** Body to acknowledge a webhook (some providers require a specific reply). */
  webhookAck?(): unknown;
}

export class WebhookAuthError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookAuthError';
  }
}
