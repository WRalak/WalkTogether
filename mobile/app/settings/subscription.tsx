import { useEffect, useState } from 'react';
import { formatMoney } from '@walktogether/shared-utils';
import { Linking, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITLEMENTS, type EntitlementKey } from '@walktogether/shared-types';
import { Badge, Button, Card, ErrorState, Loading, SectionTitle, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { normaliseKenyanPhone } from '@/features/auth-schemas';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

const money = (m: number, c: string) => formatMoney(m, c);

export default function Subscription() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const mine = useQuery({ queryKey: ['my-subscription'], queryFn: () => api.subscriptions.me() });
  const plans = useQuery({ queryKey: ['plans', 'INDIVIDUAL'], queryFn: () => api.subscriptions.plans('INDIVIDUAL') });
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.billing.providers() });
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [waiting, setWaiting] = useState<{ paymentId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const p = await api.billing.payment(waiting.paymentId).catch(() => null);
      if (p?.status === 'SUCCEEDED') {
        setWaiting(null);
        void qc.invalidateQueries({ queryKey: ['my-subscription'] });
      } else if (p?.status === 'FAILED') {
        setWaiting(null);
        setError(p.failureReason ?? 'Payment failed');
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, qc]);

  if (mine.isLoading) return <Loading />;
  const sub = mine.data;
  const buy = async (planId: string, provider: string) => {
    setError(null);
    try {
      const r = await api.billing.checkout({ planId, provider, phone: provider === 'mpesa' ? normaliseKenyanPhone(phone) : undefined }, Crypto.randomUUID());
      if (r.status === 'SUCCEEDED') return void qc.invalidateQueries({ queryKey: ['my-subscription'] });
      if (r.clientAction?.type === 'redirect') await Linking.openURL(r.clientAction.url);
      setWaiting({ paymentId: r.paymentId!, message: r.clientAction?.type === 'stk_push' ? r.clientAction.message : 'Complete the payment in your browser.' });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const providerIds = providers.data?.map((p) => p.id) ?? [];
  return (
    <Screen edges={[]}>
      <Card>
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-bold text-ink">{sub?.entitlements.planName ?? 'WalkTogether Free'}</Text>
          <Badge label={sub?.entitlements.status.toLowerCase() ?? 'free'} tone="primary" />
        </View>
        {sub?.subscription && <Text className="mt-1 text-ink-muted">{sub.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(sub.subscription.currentPeriodEnd).toLocaleDateString()}</Text>}
        <Text className="mt-2 text-sm text-ink-muted">GPS tracking, history and clubs are free forever. Premium adds deeper insights. A club’s plan never changes your personal features.</Text>
        {sub?.subscription && !sub.subscription.cancelAtPeriodEnd && <Button title="Cancel at period end" variant="ghost" onPress={() => void api.subscriptions.cancelMine().then(() => mine.refetch())} />}
      </Card>
      {error && (
        <View className="mt-4">
          <ErrorState message={error} />
        </View>
      )}
      {waiting && (
        <Card className="mt-4 bg-primary-soft">
          <Text className="text-ink">{waiting.message}</Text>
          <Text className="mt-1 text-xs text-ink-muted">We’ll unlock Premium as soon as the payment is confirmed.</Text>
        </Card>
      )}
      <SectionTitle>Premium plans</SectionTitle>
      {plans.data?.filter((p) => !p.isDefault && p.amountMinor > 0).length ? (
        plans.data
          .filter((p) => !p.isDefault && p.amountMinor > 0)
          .map((p) => (
            <Card key={p.id} className="mb-3">
              <Text className="text-lg font-bold text-ink">{p.name}</Text>
              <Text className="text-2xl font-extrabold text-ink">
                {money(p.amountMinor, p.currency)} <Text className="text-sm font-normal text-ink-muted">/ {p.interval.toLowerCase()}</Text>
              </Text>
              {p.entitlements.map((e) => (
                <Text key={e.key} className="text-ink-muted">
                  ✓ {ENTITLEMENTS[e.key as EntitlementKey]?.label ?? e.key}
                </Text>
              ))}
              {providerIds.includes('mpesa') && (
                <>
                  <View className="mt-3">
                    <TextField label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="0712 345 678" />
                  </View>
                  <Button title="Pay with M-Pesa" disabled={!!waiting} onPress={() => void buy(p.id, 'mpesa')} />
                </>
              )}
              {providerIds.includes('stripe') && <Button title="Pay with card" variant="outline" className="mt-2" disabled={!!waiting} onPress={() => void buy(p.id, 'stripe')} />}
              {!providerIds.length && <Text className="mt-2 text-ink-muted">Payments are not available yet.</Text>}
            </Card>
          ))
      ) : (
        <Text className="text-ink-muted">Premium isn’t available in your region yet.</Text>
      )}
    </Screen>
  );
}
