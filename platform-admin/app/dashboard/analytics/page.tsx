'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner, Stat } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { DataTable, fmtMoneyMap, money, Section } from '@/features/ui';

type Rev = { mrr: Record<string, number>; arr: Record<string, number>; paidSubscriptions: { clubPaid: number; individualPaid: number }; last30d: { purpose: string; currency: string; payments: number; grossMinor: number; refundedMinor: number }[]; cancellations30d: number; failedPayments30d: number; monthly: { month: string; purpose: string; currency: string; netMinor: number }[] };

function ActivitySection() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['platform-activity', days], queryFn: () => adminApi.analytics.activity(days) });
  if (q.error) return <Alert variant="destructive">{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Spinner />;
  const a = q.data;
  const max = Math.max(1, ...a.daily.map((d) => d.activities));
  const totals = a.daily.reduce((t, d) => ({ activities: t.activities + d.activities, distanceM: t.distanceM + d.distanceM, flagged: t.flagged + d.flagged }), { activities: 0, distanceM: 0, flagged: 0 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Platform activity</h2>
        <div className="flex gap-2" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>
              {d} days
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Activities" value={totals.activities} hint="validated walks, runs and hikes" />
        <Stat label="Distance" value={`${Math.round(totals.distanceM / 1000).toLocaleString()} km`} />
        <Stat label="Active members" value={a.activeUsers} hint={`${a.clubShares} shared with clubs`} />
        <Stat label="Flagged by GPS validation" value={totals.flagged} hint="excluded from totals and challenges" />
      </div>
      <Section title="Activities per day">
        <div className="flex h-40 items-end gap-0.5" role="img" aria-label={a.daily.map((d) => `${d.day}: ${d.activities}`).join(', ')}>
          {a.daily.map((d) => (
            <div key={d.day} className="flex-1 rounded-t bg-primary" style={{ height: `${(d.activities / max) * 100}%`, minHeight: d.activities ? 3 : 0 }} title={`${d.day}: ${d.activities} activities, ${(d.distanceM / 1000).toFixed(1)} km, ${d.flagged} flagged`} />
          ))}
        </div>
        {!a.daily.length && <p className="text-sm text-muted-foreground">No activities in this period.</p>}
      </Section>
      <Section title="By type">
        <DataTable rows={a.byType} columns={[{ label: 'Type', render: (t) => t.type.toLowerCase() }, { label: 'Activities', render: (t) => t.activities }, { label: 'Distance', render: (t) => `${Math.round(t.distanceM / 1000).toLocaleString()} km` }]} />
      </Section>
    </div>
  );
}

function RevenueSection() {
  const q = useQuery({ queryKey: ['revenue'], queryFn: () => adminApi.revenue() as Promise<Rev> });
  if (!q.data) return <Spinner />;
  const r = q.data;
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Revenue</h2>
      <p className="text-sm text-muted-foreground">Figures come from verified payments only.</p>
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

export default function AnalyticsPage() {
  const { can } = useAdminAuth();
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <ActivitySection />
      {can('billing.view') && <RevenueSection />}
    </div>
  );
}
