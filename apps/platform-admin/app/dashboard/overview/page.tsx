'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner, Stat } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtMoneyMap, money } from '@/features/ui';

export default function OverviewPage() {
  const { can } = useAdminAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['overview'], queryFn: () => adminApi.overview(), enabled: can('platform.overview.view') });
  if (!can('platform.overview.view')) return <p className="text-muted-foreground">Select a section from the menu.</p>;
  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert variant="destructive">{errorMessage(error)}</Alert>;
  const sum = (rows: { currency: string; grossMinor: number }[]) => (rows.length ? rows.map((r) => money(r.grossMinor, r.currency)).join(' · ') : '—');
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Platform overview</h1>
      <section>
        <h2 className="mb-3 font-semibold">Revenue</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="MRR" value={<span className="text-xl">{fmtMoneyMap(data.revenue.mrr)}</span>} />
          <Stat label="ARR" value={<span className="text-xl">{fmtMoneyMap(data.revenue.arr)}</span>} />
          <Stat label="Sponsorship revenue (30d)" value={<span className="text-xl">{sum(data.revenue.sponsorship30d)}</span>} />
          <Stat label="Cancellations (30d)" value={data.revenue.cancellations30d} />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Users</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Total users" value={data.users.total.toLocaleString()} />
          <Stat label="Active (30 days)" value={data.users.active30d.toLocaleString()} />
          <Stat label="New (7 days)" value={data.users.new7d.toLocaleString()} />
          <Stat label="Premium subscribers" value={data.users.premium.toLocaleString()} />
          <Stat label="Suspended" value={data.users.suspended.toLocaleString()} />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Clubs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Total clubs" value={data.clubs.total.toLocaleString()} />
          <Stat label="Active" value={data.clubs.active.toLocaleString()} />
          <Stat label="Paid" value={data.clubs.paid.toLocaleString()} />
          <Stat label="Free" value={data.clubs.free.toLocaleString()} />
          <Stat label="Awaiting approval" value={data.clubs.pendingApproval.toLocaleString()} />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Activity & engagement</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Activities" value={data.activities.total.toLocaleString()} hint={`${data.activities.last30d.toLocaleString()} in 30 days`} />
          <Stat label="Distance tracked" value={`${Math.round(data.activities.totalDistanceM / 1000).toLocaleString()} km`} />
          <Stat label="Events organised" value={data.events.held.toLocaleString()} hint={`${data.events.upcoming} upcoming`} />
          <Stat label="Challenge participation" value={data.challenges.participants.toLocaleString()} hint={`${data.challenges.active} active challenges`} />
          <Stat label="Active memberships" value={data.memberships.active.toLocaleString()} />
        </div>
      </section>
    </div>
  );
}
