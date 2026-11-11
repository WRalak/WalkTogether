'use client';
import { formatMoney } from '@walktogether/shared-utils';
import { useEffect, useState } from 'react';
import type { CheckoutResultDto } from '@walktogether/api-client';
import { Alert, Button, Field, Input, Select } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export const money = (minor: number, currency: string) => formatMoney(minor, currency, { decimals: true });

/**
 * Payment UX: M-Pesa sends an STK push to the phone; Stripe redirects to hosted checkout.
 * The UI only polls the server; access is granted once the server has verified the payment.
 */
export function PayFlow({ start, onDone }: { start: (provider: string, phone: string | undefined, key: string) => Promise<CheckoutResultDto>; onDone: () => void }) {
  const [providers, setProviders] = useState<{ id: string }[]>([]);
  const [provider, setProvider] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'waiting'; paymentId: string; message: string } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const [key] = useState(() => crypto.randomUUID());

  useEffect(() => {
    api.billing.providers().then((p) => {
      setProviders(p);
      setProvider(p[0]?.id ?? '');
    });
  }, []);
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    const t = setInterval(async () => {
      try {
        const p = await api.billing.payment(state.paymentId);
        if (p.status === 'SUCCEEDED') {
          setState({ kind: 'done' });
          onDone();
        } else if (p.status === 'FAILED') setState({ kind: 'error', message: p.failureReason ?? 'Payment failed' });
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [state, onDone]);

  if (!providers.length) return <Alert>Online payments are not enabled on this server yet. Contact WalkTogether to upgrade.</Alert>;
  if (state.kind === 'done') return <Alert variant="success">Payment confirmed. Your plan is active.</Alert>;
  if (state.kind === 'waiting') return <Alert>{state.message} Waiting for confirmation from the payment provider…</Alert>;
  return (
    <div className="space-y-3">
      {state.kind === 'error' && <Alert variant="destructive">{state.message}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <Field id="pay-provider" label="Pay with">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'mpesa' ? 'M-Pesa' : p.id === 'stripe' ? 'Card (Stripe)' : p.id}
              </option>
            ))}
          </Select>
        </Field>
        {provider === 'mpesa' && (
          <Field id="pay-phone" label="M-Pesa phone" hint="+2547XXXXXXXX">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254712345678" />
          </Field>
        )}
      </div>
      <Button
        onClick={async () => {
          try {
            const r = await start(provider, provider === 'mpesa' ? phone : undefined, key);
            if (r.status === 'SUCCEEDED') {
              setState({ kind: 'done' });
              return onDone();
            }
            if (r.clientAction?.type === 'redirect') window.location.assign(r.clientAction.url);
            setState({ kind: 'waiting', paymentId: r.paymentId!, message: r.clientAction?.type === 'stk_push' ? r.clientAction.message : 'Complete the payment.' });
          } catch (e) {
            setState({ kind: 'error', message: errorMessage(e) });
          }
        }}
      >
        Pay now
      </Button>
    </div>
  );
}
