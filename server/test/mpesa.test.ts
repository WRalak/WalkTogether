/**
 * Daraja integration tests against a mocked Safaricom API: verifies the exact request shapes we
 * send and how callbacks are authenticated and interpreted. Live sandbox runs need real credentials.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SECRET = 'cb-secret-0123456789abcdefghijkl';
let MpesaProvider: typeof import('../src/modules/payments/providers/mpesa').MpesaProvider;
const calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] = [];

beforeAll(async () => {
  Object.assign(process.env, {
    MPESA_CONSUMER_KEY: 'ck',
    MPESA_CONSUMER_SECRET: 'cs',
    MPESA_SHORTCODE: '174379',
    MPESA_PASSKEY: 'pk',
    MPESA_CALLBACK_SECRET: SECRET,
    MPESA_INITIATOR_NAME: 'apiop',
    MPESA_SECURITY_CREDENTIAL: 'enc-cred',
    API_PUBLIC_URL: 'https://api.example.test',
  });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes('/oauth/v1/generate')) return json({ access_token: 'tok', expires_in: '3599' });
    if (url.includes('/stkpush/v1/processrequest')) return json({ CheckoutRequestID: 'ws_CO_1', ResponseCode: '0', CustomerMessage: 'Success. Request accepted for processing' });
    if (url.includes('/stkpushquery/v1/query')) return json({ ResultCode: '0', ResultDesc: 'The service request is processed successfully.' });
    if (url.includes('/reversal/v1/request')) return json({ ConversationID: 'AG_2026_REV', ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' });
    return new Response('{}', { status: 404 });
  });
  ({ MpesaProvider } = await import('../src/modules/payments/providers/mpesa'));
});
afterAll(() => vi.unstubAllGlobals());

const req = (body: unknown, secret = SECRET) => ({ body, query: { secret } }) as unknown as import('express').Request;

describe('M-Pesa Daraja provider', () => {
  it('sends a correctly signed STK push with the callback secret and whole-shilling amount', async () => {
    const p = new MpesaProvider();
    const r = await p.initiate({
      paymentId: '11111111-2222-3333-4444-555555555555',
      amountMinor: 150050,
      currency: 'KES',
      description: 'Club Pro monthly',
      idempotencyKey: 'k',
      phone: '+254712345678',
    });
    expect(r).toMatchObject({ providerRef: 'ws_CO_1', clientAction: { type: 'stk_push' } });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('ck:cs').toString('base64')}`);
    const stk = calls.find((c) => c.url.includes('processrequest'))!;
    expect(stk.headers.Authorization).toBe('Bearer tok');
    expect(stk.body).toMatchObject({ BusinessShortCode: '174379', TransactionType: 'CustomerPayBillOnline', Amount: 1501, PartyA: '254712345678', PhoneNumber: '254712345678' });
    const ts = String(stk.body!.Timestamp);
    expect(ts).toMatch(/^\d{14}$/);
    expect(stk.body!.Password).toBe(Buffer.from(`174379pk${ts}`).toString('base64'));
    expect(String(stk.body!.CallBackURL)).toBe(`https://api.example.test/api/v1/payments/webhooks/mpesa?secret=${SECRET}`);
    await expect(p.initiate({ paymentId: 'x', amountMinor: 100, currency: 'USD', description: 'd', idempotencyKey: 'k', phone: '+254712345678' })).rejects.toThrow(/KES/);
  });

  it('authenticates callbacks by secret and captures the receipt number', async () => {
    const p = new MpesaProvider();
    const body = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'm',
          CheckoutRequestID: 'ws_CO_1',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1501 },
              { Name: 'MpesaReceiptNumber', Value: 'TKA1B2C3D4' },
            ],
          },
        },
      },
    };
    await expect(p.parseWebhook(req(body, 'wrong'))).rejects.toThrow();
    const evt = await p.parseWebhook(req(body));
    expect(evt).toMatchObject({ providerRef: 'ws_CO_1', outcome: 'SUCCEEDED', receipt: 'TKA1B2C3D4' });
    const failed = await p.parseWebhook(req({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } }));
    expect(failed).toMatchObject({ outcome: 'FAILED', failureReason: 'Request cancelled by user' });
    expect((await p.queryStatus('ws_CO_1')).outcome).toBe('SUCCEEDED');
  });

  it('requests full-amount reversals and parses the asynchronous result', async () => {
    const p = new MpesaProvider();
    await expect(p.refund({ providerReceipt: null, amountMinor: 1000 }, 1000)).rejects.toThrow(/receipt/);
    await expect(p.refund({ providerReceipt: 'TKA1', amountMinor: 1000 }, 500)).rejects.toThrow(/full amount/);
    const r = await p.refund({ providerReceipt: 'TKA1B2C3D4', amountMinor: 150050 }, 150050);
    expect(r).toEqual({ refundRef: 'AG_2026_REV', status: 'PENDING' });
    const rev = calls.find((c) => c.url.includes('reversal'))!;
    expect(rev.body).toMatchObject({
      CommandID: 'TransactionReversal',
      TransactionID: 'TKA1B2C3D4',
      Initiator: 'apiop',
      SecurityCredential: 'enc-cred',
      Amount: 1501,
      RecieverIdentifierType: '11',
    });
    expect(() => p.parseReversalResult(req({ Result: { ResultCode: 0, ConversationID: 'AG_2026_REV' } }, 'bad'))).toThrow();
    expect(p.parseReversalResult(req({ Result: { ResultCode: 0, ResultDesc: 'ok', ConversationID: 'AG_2026_REV' } }))).toEqual({
      refundRef: 'AG_2026_REV',
      succeeded: true,
      description: 'ok',
    });
  });
});
