'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Spinner, Stat } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

export default function OverviewPage() {
  const { can } = useAdminAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['overview'], queryFn: () => adminApi.overview(), enabled: can('platform.overview.view') });
  if (!can('platform.overview.view')) return <p className="text-muted-foreground">Select a section from the menu.</p>;
  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert variant="destructive">{errorMessage(error)}</Alert>;
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Platform overview</h1>
      <section>
        <h2 className="mb-3 font-semibold">Users</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total users" value={data.users.total.toLocaleString()} />
          <Stat label="Active (30 days)" value={data.users.active30d.toLocaleString()} hint="Signed in during the last 30 days" />
          <Stat label="New (7 days)" value={data.users.new7d.toLocaleString()} />
          <Stat label="Suspended" value={data.users.suspended.toLocaleString()} />
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Clubs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total clubs" value={data.clubs.total.toLocaleString()} />
          <Stat label="Active" value={data.clubs.active.toLocaleString()} />
          <Stat label="Awaiting approval" value={data.clubs.pendingApproval.toLocaleString()} />
          <Stat label="Active memberships" value={data.memberships.active.toLocaleString()} />
        </div>
      </section>
      <p className="text-sm text-muted-foreground">Revenue, subscription, activity and challenge metrics are added as those modules launch.</p>
    </div>
  );
}
