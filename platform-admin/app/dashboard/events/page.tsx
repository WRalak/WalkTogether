'use client';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { SearchBar } from '@/features/search-list';
import { StatusAction } from '@/features/status-action';
import { DataTable, Section, StatusBadge, useAction } from '@/features/ui';

type When = '' | 'upcoming' | 'past';

/** Every event on the platform, across clubs. Moderators can cancel an event; registrants are notified and the action is audited. */
export default function EventsAdmin() {
  const { can } = useAdminAuth();
  const [filters, setFilters] = useState<{ q: string; status: string; when: When }>({ q: '', status: '', when: 'upcoming' });
  const { run, ErrorBox } = useAction();
  const events = useInfiniteQuery({
    queryKey: ['admin-events', filters],
    queryFn: ({ pageParam }) =>
      adminApi.events.list({ cursor: pageParam, q: filters.q || undefined, status: (filters.status || undefined) as 'SCHEDULED' | 'CANCELLED' | undefined, when: filters.when || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const rows = events.data?.pages.flatMap((p) => p.items);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="text-sm text-muted-foreground">Group walks, runs and sponsored events across all clubs.</p>
      </div>
      <ErrorBox />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar statuses={['SCHEDULED', 'CANCELLED']} onSearch={(q, status) => setFilters((f) => ({ ...f, q, status }))} />
        <div className="flex gap-2" role="group" aria-label="When">
          {(['upcoming', 'past', ''] as When[]).map((w) => (
            <Button key={w || 'all'} size="sm" variant={filters.when === w ? 'default' : 'outline'} onClick={() => setFilters((f) => ({ ...f, when: w }))}>
              {w || 'all'}
            </Button>
          ))}
        </div>
      </div>
      <Section title="Events">
        <DataTable
          rows={rows}
          empty="No events match these filters"
          columns={[
            { label: 'Event', render: (e) => <span className="font-medium">{e.title}</span> },
            { label: 'Club', render: (e) => <a className="text-primary hover:underline" href={`/dashboard/clubs/${e.club.id}`}>{e.club.name}</a> },
            { label: 'Starts', render: (e) => new Date(e.startsAt).toLocaleString() },
            { label: 'Type', render: (e) => `${e.type.replace('_', ' ').toLowerCase()} · ${e.visibility.toLowerCase()}` },
            { label: 'Going / attended', render: (e) => `${e.goingCount}${e.maxParticipants ? `/${e.maxParticipants}` : ''} · ${e.attended}` },
            { label: 'Sponsor', render: (e) => e.sponsor ?? '—' },
            { label: 'Status', render: (e) => <span title={e.cancelReason ?? undefined}><StatusBadge value={e.status} /></span> },
            {
              label: '',
              render: (e) =>
                e.status === 'SCHEDULED' && can('moderation.manage') ? (
                  <StatusAction label="Cancel" variant="destructive" onConfirm={(reason) => run(async () => { await adminApi.events.cancel(e.id, reason); void events.refetch(); })} />
                ) : null,
            },
          ]}
        />
        {events.hasNextPage && (
          <Button variant="outline" onClick={() => void events.fetchNextPage()} disabled={events.isFetchingNextPage}>
            {events.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </Section>
    </div>
  );
}
