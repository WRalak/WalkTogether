'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@walktogether/api-client';
import { Alert, Button, Card, CardContent, Spinner, Stat } from '@walktogether/ui';
import { api } from '@/lib/api';
import { downloadText } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

function Bars({ data, label }: { data: { month: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold">{label}</figcaption>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={`${label}: ${data.map((d) => `${d.month} ${d.value}`).join(', ')}`}>
        {data.map((d) => (
          <div key={d.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t bg-primary" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 4 : 0 }} title={`${d.month}: ${d.value}`} />
            <span className="text-[10px] text-muted-foreground">{d.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function AnalyticsPage() {
  const { clubId, can } = useClub();
  const [error, setError] = useState<string | null>(null);
  const overview = useQuery({ queryKey: ['overview', clubId], queryFn: () => api.reports.overview(clubId), enabled: can('analytics.view') });
  const growth = useQuery({ queryKey: ['growth', clubId], queryFn: () => api.reports.growth(clubId), enabled: can('analytics.view'), retry: false });
  if (!can('analytics.view')) return <Alert variant="destructive">You don’t have permission to view analytics.</Alert>;
  const o = overview.data;
  const upgrade = growth.error instanceof ApiError && growth.error.status === 402;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Analytics & reports</h1>
        {can('reports.export') && (
          <Button variant="outline" onClick={() => api.reports.membersCsv(clubId).then((t) => downloadText('members.csv', t)).catch((e) => setError(errorMessage(e)))}>
            Export members CSV
          </Button>
        )}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!o ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active members" value={o.members.active} hint={`${o.members.new30d} new in 30 days`} />
          <Stat label="Engaged (30 days)" value={`${o.members.engagementRate}%`} hint={`${o.members.engaged30d} attended or shared an activity`} />
          <Stat label="Events held (30 days)" value={o.events.held30d} hint={`${o.events.upcoming30d} upcoming`} />
          <Stat label="Attendance rate" value={o.events.attendanceRate != null ? `${o.events.attendanceRate}%` : '—'} hint={`${o.events.attendance30d} check-ins`} />
          <Stat label="Shared activities (30 days)" value={o.activities.shared30d} />
          <Stat label="Challenge participants (30 days)" value={o.challenges.participants30d} />
          <Stat label="Plan" value={<span className="text-xl">{o.plan.name ?? 'Free'}</span>} hint={o.plan.status} />
          <Stat label="Pending requests" value={o.members.pending} />
        </div>
      )}
      <Card>
        <CardContent className="p-6">
          {upgrade ? (
            <p className="text-sm text-muted-foreground">Growth trends and top attendees are part of Club Pro. Upgrade from the Billing page.</p>
          ) : growth.data ? (
            <div className="grid gap-8 md:grid-cols-2">
              <Bars data={growth.data.newMembers} label="New members per month" />
              <Bars data={growth.data.attendance} label="Check-ins per month" />
            </div>
          ) : (
            <Spinner />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
