'use client';
import { useQuery } from '@tanstack/react-query';
import { Spinner, Stat } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { DataTable, fmtMoneyMap, money, Section } from '@/features/ui';

type Rev = { mrr: Record<string, number>; arr: Record<string, number>; paidSubscriptions: { clubPaid: number; individualPaid: number }; last30d: { purpose: string; currency: string; payments: number; grossMinor: number; refundedMinor: number }[]; cancellations30d: number; failedPayments30d: number; monthly: { month: string; purpose: string; currency: string; netMinor: number }[] };

export default function AnalyticsPage() {
  const q = useQuery({ queryKey: ['revenue'], queryFn: () => adminApi.revenue() as Promise<Rev> });
  if (!q.data) return <Spinner />;
  const r = q.data;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="text-sm text-muted-foreground">Revenue figures come from verified payments only.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="MRR" value={<span className="text-xl">{fmtMoneyMap(r.mrr)}</span>} />
        <Stat label="ARR" value={<span className="text-xl">{fmtMoneyMap(r.arr)}</span>} />
        <Stat label="Paid subscriptions" value={r.paidSubscriptions.clubPaid + r.paidSubscriptions.individualPaid} hint={`${r.paidSubscriptions.clubPaid} clubs · ${r.paidSubscriptions.individualPaid} individuals`} />
        <Stat label="Cancellations (30d)" value={r.cancellations30d} hint={`${r.failedPayments30d} failed payments`} />
      </div>
      <Section title="Last 30 days">
        <DataTable rows={r.last30d} columns={[{ label: 'Stream', render: (x) => x.purpose.toLowerCase() }, { label: 'Payments', render: (x) => x.payments }, { label: 'Gross', render: (x) => money(x.grossMinor, x.currency) }, { label: 'Refunded', render: (x) => money(x.refundedMinor, x.currency) }]} />
      </Section>
      <Section title="Monthly net revenue (12 months)">
        <DataTable rows={r.monthly} columns={[{ label: 'Month', render: (x) => x.month }, { label: 'Stream', render: (x) => x.purpose.toLowerCase() }, { label: 'Net', render: (x) => money(x.netMinor, x.currency) }]} />
      </Section>
    </div>
  );
}
