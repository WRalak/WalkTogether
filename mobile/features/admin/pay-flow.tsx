import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useQuery } from '@tanstack/react-query';
import type { CheckoutResultDto } from '@walktogether/api-client';
import { Button, Card, TextField } from '@/components/ui';
import { Notice } from '@/components/admin';
import { normaliseKenyanPhone } from '@/features/auth-schemas';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

type State = { kind: 'idle' } | { kind: 'waiting'; paymentId: string; message: string } | { kind: 'done' } | { kind: 'error'; message: string };

/**
 * M-Pesa sends an STK push to the phone; card payments open Stripe's hosted checkout. The app only
 * polls — access is granted once the SERVER has verified the payment with the provider.
 */
export function PayFlow({ start, onDone }: { start: (provider: string, phone: string | undefined, idempotencyKey: string) => Promise<CheckoutResultDto>; onDone: () => void }) {
  const me = useAuthStore((s) => s.user);
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.billing.providers() });
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [state, setState] = useState<State>({ kind: 'idle' });
  // One idempotency key per attempt: a double tap can never create two charges.
  const [key, setKey] = useState(() => Crypto.randomUUID());

  useEffect(() => {
    if (state.kind !== 'waiting') return;
    const t = setInterval(async () => {
      const p = await api.billing.payment(state.paymentId).catch(() => null);
      if (p?.status === 'SUCCEEDED') {
        setState({ kind: 'done' });
        onDone();
      } else if (p?.status === 'FAILED' || p?.status === 'CANCELLED') {
        setState({ kind: 'error', message: p.failureReason ?? 'The payment was not completed.' });
        setKey(Crypto.randomUUID());
      }
    }, 3000);
    return () => clearInterval(t);
  }, [state, onDone]);

  const pay = async (provider: string) => {
    try {
      const r = await start(provider, provider === 'mpesa' ? normaliseKenyanPhone(phone) : undefined, key);
      if (r.status === 'SUCCEEDED') {
        setState({ kind: 'done' });
        return onDone();
      }
      if (r.clientAction?.type === 'redirect') await Linking.openURL(r.clientAction.url);
      setState({ kind: 'waiting', paymentId: r.paymentId!, message: r.clientAction?.type === 'stk_push' ? r.clientAction.message : 'Complete the payment in your browser.' });
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) });
      setKey(Crypto.randomUUID());
    }
  };

  const ids = providers.data?.map((p) => p.id) ?? [];
  if (providers.isLoading) return null;
  if (!ids.length) return <Notice tone="info">Online payments aren’t enabled yet. Contact WalkTogether to upgrade.</Notice>;
  if (state.kind === 'done') return <Notice tone="success">Payment confirmed. Your plan is active.</Notice>;
  if (state.kind === 'waiting')
    return (
      <Card className="bg-primary-soft">
        <Text className="text-ink">{state.message}</Text>
        <Text className="mt-1 text-xs text-ink-muted">Waiting for confirmation from the payment provider…</Text>
      </Card>
    );
  return (
    <View>
      {state.kind === 'error' ? <Notice>{state.message}</Notice> : null}
      {ids.includes('mpesa') && (
        <>
          <TextField label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="0712 345 678" />
          <Button title="Pay with M-Pesa" disabled={!phone.trim()} onPress={() => void pay('mpesa')} />
        </>
      )}
      {ids.includes('stripe') && <Button title="Pay with card" variant="outline" className="mt-2" onPress={() => void pay('stripe')} />}
      {ids.includes('sandbox') && <Button title="Pay (sandbox)" variant="outline" className="mt-2" onPress={() => void pay('sandbox')} />}
    </View>
  );
}
