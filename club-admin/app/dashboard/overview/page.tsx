'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, buttonVariants, Card, CardContent, Stat } from '@walktogether/ui';
import { api } from '@/lib/api';
import { dashboardHref, useClub } from '@/features/clubs/use-club';

export default function ClubOverviewPage() {
  const { clubId, data: club, can } = useClub();
  const pending = useQuery({
    queryKey: ['members', clubId, 'PENDING', ''],
    queryFn: () => api.clubs.members(clubId, { status: 'PENDING', limit: 100 }),
    enabled: can('members.approve'),
  });
  if (!club) return null;
  const pendingCount = pending.data?.items.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/clubs/{club.slug}
        </p>
      </div>
      {club.status === 'PENDING_APPROVAL' && <Alert>This club is awaiting approval by the WalkTogether team. You can prepare everything in the meantime.</Alert>}
      {club.status === 'SUSPENDED' && <Alert variant="destructive">This club has been suspended by the platform. Contact support for details.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Active members" value={club.memberCount} />
        {can('members.approve') && <Stat label="Pending requests" value={pending.isLoading ? '…' : pendingCount} hint={pendingCount >= 100 ? 'Showing first 100' : undefined} />}
        <Stat label="Visibility" value={<span className="text-xl">{club.visibility.replace('_', ' ').toLowerCase()}</span>} />
      </div>
      {can('members.approve') && pendingCount > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p>
              <span className="font-semibold">{pendingCount}</span> {pendingCount === 1 ? 'person is' : 'people are'} waiting to join.
            </p>
            <Link href={dashboardHref(clubId, '/members', { status: 'PENDING' })} className={buttonVariants({ size: 'sm' })}>
              Review requests
            </Link>
          </CardContent>
        </Card>
      )}
      <p className="text-sm text-muted-foreground">Events, attendance, challenges, analytics and billing will appear in this dashboard as they launch.</p>
    </div>
  );
}
