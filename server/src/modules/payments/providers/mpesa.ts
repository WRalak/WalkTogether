import { env } from '../../../config/env';
import { safeEqual } from '../../../shared/crypto';
import type { InitiateInput, PaymentProvider } from './types';
import { WebhookAuthError } from './types';

/**
 * Safaricom Daraja — Lipa Na M-Pesa Online (STK Push).
 * Callbacks are not signed by Safaricom, so authenticity relies on (1) a secret in the callback
 * URL, (2) an IP allow-list at the ingress, and (3) a mandatory STK Push Query confirmation before
 * any payment is marked successful.
 */
export class MpesaProvider implements PaymentProvider {
  readonly id = 'mpesa';
  readonly currencies = ['KES'];
  private token: { value: string; exp: number } | null = null;
  private base = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.value;
    const basic = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`M-Pesa auth failed (HTTP ${res.status})`);
    const json = (await res.json()) as { access_token: string; expires_in: string };
    this.token = { value: json.access_token, exp: Date.now() + Number(json.expires_in) * 1000 };
    return this.token.value;
  }

  private password() {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return { timestamp, password: Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString('base64') };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw Object.assign(new Error(`M-Pesa request failed (HTTP ${res.status})`), { raw: json });
    return json;
  }

  async initiate(input: InitiateInput) {
    if (input.currency !== 'KES') throw new Error('M-Pesa only supports KES');
    if (!input.phone) throw new Error('A Safaricom phone number is required for M-Pesa');
    const msisdn = input.phone.replace(/^\+/, '');
    const { timestamp, password } = this.password();
    const raw = await this.post<{ CheckoutRequestID: string; ResponseCode: string; CustomerMessage: string }>('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(input.amountMinor / 100), // KES whole shillings
      PartyA: msisdn,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: msisdn,
      CallBackURL: `${env.API_PUBLIC_URL}/api/v1/payments/webhooks/mpesa?secret=${encodeURIComponent(env.MPESA_CALLBACK_SECRET ?? '')}`,
      AccountReference: `WT-${input.paymentId.slice(0, 8)}`,
      TransactionDesc: input.description.slice(0, 13),
    });
    if (raw.ResponseCode !== '0') throw Object.assign(new Error('M-Pesa rejected the request'), { raw });
    return { providerRef: raw.CheckoutRequestID, status: 'PENDING' as const, clientAction: { type: 'stk_push' as const, message: raw.CustomerMessage || 'Check your phone and enter your M-Pesa PIN.' }, raw };
  }

  async parseWebhook(req: import('express').Request) {
    const secret = String(req.query.secret ?? '');
    if (!env.MPESA_CALLBACK_SECRET || !safeEqual(secret, env.MPESA_CALLBACK_SECRET)) throw new WebhookAuthError();
    const cb = (req.body as { Body?: { stkCallback?: { CheckoutRequestID: string; ResultCode: number; ResultDesc: string; MerchantRequestID: string } } })?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) throw new WebhookAuthError('Malformed M-Pesa callback');
    return {
      eventId: `${cb.CheckoutRequestID}:${cb.ResultCode}`,
      providerRef: cb.CheckoutRequestID,
      outcome: cb.ResultCode === 0 ? ('SUCCEEDED' as const) : ('FAILED' as const),
      failureReason: cb.ResultCode === 0 ? undefined : cb.ResultDesc,
      raw: req.body,
    };
  }

  async queryStatus(providerRef: string) {
    const { timestamp, password } = this.password();
    try {
      const raw = await this.post<{ ResultCode?: string; ResultDesc?: string; errorCode?: string }>('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: providerRef,
      });
      if (raw.ResultCode === '0') return { outcome: 'SUCCEEDED' as const, raw };
      if (raw.ResultCode !== undefined) return { outcome: 'FAILED' as const, failureReason: raw.ResultDesc, raw };
      return { outcome: 'PENDING' as const, raw };
    } catch (err) {
      // "The transaction is being processed" is returned as an error while pending.
      return { outcome: 'PENDING' as const, raw: (err as { raw?: unknown }).raw ?? String(err) };
    }
  }

  webhookAck() {
    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }
}
