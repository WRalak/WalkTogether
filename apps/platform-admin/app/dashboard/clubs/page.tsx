'use client';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, EmptyState, Spinner, Table, Td, Th } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { SearchBar } from '@/features/search-list';
import { StatusAction } from '@/features/status-action';

export default function ClubsPage() {
  const { can } = useAdminAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [error, setError] = useState<string | null>(null);
  const clubs = useInfiniteQuery({
    queryKey: ['admin-clubs', filters],
    queryFn: ({ pageParam }) => adminApi.clubs.list({ q: filters.q || undefined, status: filters.status || undefined, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const rows = clubs.data?.pages.flatMap((p) => p.items) ?? [];
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['admin-clubs'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Clubs</h1>
      <SearchBar statuses={['ACTIVE', 'PENDING_APPROVAL', 'SUSPENDED', 'ARCHIVED']} onSearch={(q, status) => setFilters({ q, status })} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {clubs.isLoading ? (
        <Spinner />
      ) : clubs.error ? (
        <Alert variant="destructive">{errorMessage(clubs.error)}</Alert>
      ) : !rows.length ? (
        <EmptyState title="No clubs found" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Club</Th>
              <Th>Owner</Th>
              <Th>Members</Th>
              <Th>Visibility</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td>
                  <a className="font-medium text-primary hover:underline" href={`/dashboard/clubs/${c.id}`}>
                    {c.name}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    /{c.slug} · {[c.city, c.countryCode].filter(Boolean).join(', ')}
                  </p>
                </Td>
                <Td>@{c.owner.username}</Td>
                <Td>{c.memberCount}</Td>
                <Td className="lowercase">{c.visibility.replace('_', ' ')}</Td>
                <Td>
                  <Badge variant={c.status === 'ACTIVE' ? 'success' : c.status === 'SUSPENDED' ? 'destructive' : 'warning'}>{c.status.replace('_', ' ').toLowerCase()}</Badge>
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {can('clubs.approve') && c.status === 'PENDING_APPROVAL' && (
                      <Button size="sm" onClick={() => void run(() => adminApi.clubs.approve(c.id))}>
                        Approve
                      </Button>
                    )}
                    {can('clubs.suspend') && (c.status === 'ACTIVE' || c.status === 'PENDING_APPROVAL') && <StatusAction label="Suspend" variant="destructive" onConfirm={(r) => run(() => adminApi.clubs.setStatus(c.id, 'SUSPEND', r))} />}
                    {can('clubs.suspend') && c.status === 'SUSPENDED' && <StatusAction label="Reactivate" onConfirm={(r) => run(() => adminApi.clubs.setStatus(c.id, 'REACTIVATE', r))} />}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {clubs.hasNextPage && (
        <Button variant="outline" onClick={() => clubs.fetchNextPage()} loading={clubs.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
