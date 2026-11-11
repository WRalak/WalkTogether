'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITLEMENTS, type EntitlementKey } from '@walktogether/shared-types';
import { Alert, Badge, Button, Card, CardContent, Input, Spinner, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { money, PayFlow } from '@/features/billing/pay';
import { useClub } from '@/features/clubs/use-club';

export default function BillingPage() {
  const { clubId, can } = useClub();
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: ['billing', clubId], queryFn: () => api.clubs.billing(clubId), enabled: can('billing.view') });
  const plans = useQuery({ queryKey: ['plans', 'CLUB'], queryFn: () => api.subscriptions.plans('CLUB') });
  const payments = useQuery({ queryKey: ['club-payments', clubId], queryFn: () => api.billing.clubPayments(clubId), enabled: can('billing.view') });
  const [buying, setBuying] = useState<string | null>(null);
  const [promo, setPromo] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!can('billing.view')) return <Alert variant="destructive">You don’t have permission to view billing.</Alert>;
  if (billing.isLoading) return <Spinner />;
  const b = billing.data!;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['billing', clubId] });
    void qc.invalidateQueries({ queryKey: ['club-payments', clubId] });
    void qc.invalidateQueries({ queryKey: ['club', clubId] });
  };
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Subscription & billing</h1>
      {error && <Alert variant="destructive">{error}</Alert>}
      <Card>
        <CardContent className="space-y-2 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{b.entitlements.planName ?? 'Free Club'}</p>
            <Badge variant={b.entitlements.status === 'ACTIVE' ? 'success' : b.entitlements.status === 'GRACE' ? 'warning' : 'secondary'}>{b.entitlements.status.toLowerCase()}</Badge>
          </div>
          {b.subscription && (
            <p className="text-sm text-muted-foreground">
              {b.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(b.subscription.currentPeriodEnd).toLocaleDateString()}
              {b.subscription.status === 'GRACE' && b.subscription.graceUntil ? ` · grace period until ${new Date(b.subscription.graceUntil).toLocaleDateString()}` : ''}
            </p>
          )}
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(b.entitlements.values).map(([k, v]) => (
              <li key={k}>
                {typeof v === 'boolean' ? (v ? '✓' : '—') : v} {ENTITLEMENTS[k as EntitlementKey]?.label}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Members’ personal tracking and history never depend on the club’s plan. If a plan lapses, nothing is deleted.</p>
          {b.subscription && !b.subscription.cancelAtPeriodEnd && can('billing.manage') && (
            <Button size="sm" variant="outline" onClick={() => window.confirm('Cancel at the end of the current period?') && api.clubs.cancelSubscription(clubId).then(refresh).catch((e) => setError(errorMessage(e)))}>
              Cancel at period end
            </Button>
          )}
        </CardContent>
      </Card>
      {can('billing.manage') && (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.data
            ?.filter((p) => !p.isDefault && p.amountMinor > 0)
            .map((p) => (
              <Card key={p.id}>
                <CardContent className="space-y-3 p-6">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-2xl font-bold">
                    {money(p.amountMinor, p.currency)} <span className="text-sm font-normal text-muted-foreground">/ {p.interval.toLowerCase()}</span>
                  </p>
                  {buying === p.id ? (
                    <>
                      <Input aria-label="Promotion code" placeholder="Promotion code (optional)" value={promo} onChange={(e) => setPromo(e.target.value)} />
                      <PayFlow start={(provider, phone, key) => api.billing.checkout({ planId: p.id, clubId, provider, phone, promotionCode: promo || undefined }, key)} onDone={refresh} />
                    </>
                  ) : (
                    <Button onClick={() => setBuying(p.id)}>{b.entitlements.planCode === p.code ? 'Renew' : 'Upgrade'}</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          {!plans.data?.some((p) => !p.isDefault && p.amountMinor > 0) && <Alert>Paid plans aren’t available yet. Contact WalkTogether for Club Pro or Enterprise.</Alert>}
        </div>
      )}
      {!!payments.data?.length && (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Invoice</Th>
            </tr>
          </thead>
          <tbody>
            {payments.data.map((p) => (
              <tr key={p.id}>
                <Td>{new Date(p.createdAt).toLocaleDateString()}</Td>
                <Td>{money(p.amountMinor, p.currency)}</Td>
                <Td>{p.status.toLowerCase()}</Td>
                <Td>
                  {p.invoice && (
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() =>
                        api.billing.invoiceHtml(p.invoice!.id).then((html) => {
                          const w = window.open('', '_blank', 'noopener');
                          w?.document.write(html);
                        })
                      }
                    >
                      {p.invoice.number}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
