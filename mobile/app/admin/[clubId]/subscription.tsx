import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITLEMENTS, type EntitlementKey } from '@walktogether/shared-types';
import { formatMoney } from '@walktogether/shared-utils';
import { Badge, Button, Card, Loading, SectionTitle, TextField } from '@/components/ui';
import { confirm, NoPermission, Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { PayFlow } from '@/features/admin/pay-flow';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { shareHtml } from '@/services/files';
import { errorMessage } from '@/utils/errors';

export default function ClubSubscription() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['billing', clubId], queryFn: () => api.clubs.billing(clubId), enabled: !!club && can('billing.view') });
  const plans = useQuery({ queryKey: ['plans', 'CLUB'], queryFn: () => api.subscriptions.plans('CLUB') });
  const payments = useQuery({ queryKey: ['club-payments', clubId], queryFn: () => api.billing.clubPayments(clubId), enabled: !!club && can('billing.view') });
  const [buying, setBuying] = useState<string | null>(null);
  const [promo, setPromo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['billing', clubId] });
    void qc.invalidateQueries({ queryKey: ['club-payments', clubId] });
    void qc.invalidateQueries({ queryKey: ['admin-club', clubId] });
  };
  const cancel = useMutation({ mutationFn: () => api.clubs.cancelSubscription(clubId), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const invoice = useMutation({
    mutationFn: async (inv: { id: string; number: string }) => shareHtml(`invoice-${inv.number}.html`, await api.billing.invoiceHtml(inv.id)),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('billing.view'))
    return (
      <Screen edges={[]}>
        <NoPermission what="view billing" />
      </Screen>
    );
  if (billing.isLoading || !billing.data)
    return billing.error ? (
      <Screen edges={[]}>
        <Notice>{errorMessage(billing.error)}</Notice>
      </Screen>
    ) : (
      <Loading />
    );
  const b = billing.data;
  const paid = plans.data?.filter((p) => !p.isDefault && p.amountMinor > 0) ?? [];

  return (
    <Screen edges={[]} refreshing={billing.isRefetching} onRefresh={refresh}>
      <Stack.Screen options={{ title: 'Subscription' }} />
      {error ? <Notice>{error}</Notice> : null}
      <Card>
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-bold text-ink">{b.entitlements.planName ?? 'Free Club'}</Text>
          <Badge label={b.entitlements.status.toLowerCase()} tone={b.entitlements.status === 'ACTIVE' ? 'primary' : b.entitlements.status === 'GRACE' ? 'warning' : 'neutral'} />
        </View>
        {b.subscription && (
          <Text className="mt-1 text-sm text-ink-muted">
            {b.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(b.subscription.currentPeriodEnd).toLocaleDateString()}
            {b.subscription.status === 'GRACE' && b.subscription.graceUntil ? ` · grace period until ${new Date(b.subscription.graceUntil).toLocaleDateString()}` : ''}
          </Text>
        )}
        <View className="mt-3">
          {Object.entries(b.entitlements.values).map(([k, v]) => (
            <Text key={k} className="text-sm text-ink">
              {typeof v === 'boolean' ? (v ? '✓' : '—') : v} {ENTITLEMENTS[k as EntitlementKey]?.label ?? k}
            </Text>
          ))}
        </View>
        <Text className="mt-3 text-xs text-ink-muted">Members’ personal tracking and history never depend on the club’s plan. If a plan lapses, nothing is deleted.</Text>
        {b.subscription && !b.subscription.cancelAtPeriodEnd && can('billing.manage') && (
          <Button
            title="Cancel at period end"
            variant="ghost"
            className="mt-2"
            onPress={() => confirm('Cancel subscription', 'The plan stays active until the end of the current period.', () => cancel.mutate(), 'Cancel plan')}
          />
        )}
      </Card>

      {can('billing.manage') && (
        <>
          <SectionTitle>Plans</SectionTitle>
          {!paid.length ? (
            <Notice tone="info">Paid plans aren’t available yet. Contact WalkTogether for Club Pro or Enterprise.</Notice>
          ) : (
            paid.map((p) => (
              <Card key={p.id} className="mb-3">
                <Text className="text-lg font-bold text-ink">{p.name}</Text>
                <Text className="text-2xl font-extrabold text-ink">
                  {formatMoney(p.amountMinor, p.currency)} <Text className="text-sm font-normal text-ink-muted">/ {p.interval.toLowerCase()}</Text>
                </Text>
                {p.entitlements.map((e) => (
                  <Text key={e.key} className="text-sm text-ink-muted">
                    ✓ {ENTITLEMENTS[e.key as EntitlementKey]?.label ?? e.key}
                  </Text>
                ))}
                <View className="mt-3">
                  {buying === p.id ? (
                    <>
                      <TextField label="Promotion code (optional)" value={promo} autoCapitalize="characters" onChangeText={setPromo} />
                      <PayFlow
                        start={(provider, phone, key) => api.billing.checkout({ planId: p.id, clubId, provider, phone, promotionCode: promo.trim() || undefined }, key)}
                        onDone={refresh}
                      />
                    </>
                  ) : (
                    <Button title={b.entitlements.planCode === p.code ? 'Renew' : 'Upgrade'} onPress={() => setBuying(p.id)} />
                  )}
                </View>
              </Card>
            ))
          )}
        </>
      )}

      {!!payments.data?.length && (
        <>
          <SectionTitle>Payments</SectionTitle>
          {payments.data.map((p) => (
            <View key={p.id} className="flex-row items-center justify-between border-b border-line py-3">
              <View>
                <Text className="text-ink">{formatMoney(p.amountMinor, p.currency, { decimals: true })}</Text>
                <Text className="text-xs text-ink-muted">
                  {new Date(p.createdAt).toLocaleDateString()} · {p.status.toLowerCase()}
                </Text>
              </View>
              {p.invoice && (
                <Pressable accessibilityRole="button" onPress={() => invoice.mutate(p.invoice!)}>
                  <Text className="font-semibold text-primary">Invoice {p.invoice.number}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
