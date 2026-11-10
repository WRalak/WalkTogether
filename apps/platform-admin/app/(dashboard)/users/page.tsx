'use client';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, EmptyState, Spinner, Table, Td, Th } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { SearchBar } from '@/features/search-list';
import { StatusAction } from '@/features/status-action';

export default function UsersPage() {
  const { can } = useAdminAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ q: '', status: '' });
  const [error, setError] = useState<string | null>(null);
  const users = useInfiniteQuery({
    queryKey: ['admin-users', filters],
    queryFn: ({ pageParam }) => adminApi.users.list({ q: filters.q || undefined, status: filters.status || undefined, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];
  const change = async (id: string, action: 'SUSPEND' | 'REACTIVATE', reason: string) => {
    setError(null);
    try {
      await adminApi.users.setStatus(id, action, reason);
      await qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Users</h1>
      <SearchBar statuses={['ACTIVE', 'SUSPENDED', 'PENDING_DELETION', 'DELETED']} onSearch={(q, status) => setFilters({ q, status })} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {users.isLoading ? (
        <Spinner />
      ) : users.error ? (
        <Alert variant="destructive">{errorMessage(users.error)}</Alert>
      ) : !rows.length ? (
        <EmptyState title="No users found" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Contact</Th>
              <Th>Clubs</Th>
              <Th>Joined</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="font-medium">{u.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                </Td>
                <Td className="text-xs">
                  <p>
                    {u.email ?? '—'} {u.email && (u.emailVerified ? <Badge variant="success">verified</Badge> : <Badge variant="secondary">unverified</Badge>)}
                  </p>
                  <p>{u.phone ?? ''}</p>
                </Td>
                <Td>{u.clubCount}</Td>
                <Td className="whitespace-nowrap">{new Date(u.createdAt).toLocaleDateString()}</Td>
                <Td>
                  <Badge variant={u.status === 'ACTIVE' ? 'success' : u.status === 'SUSPENDED' ? 'destructive' : 'secondary'}>{u.status.replace('_', ' ').toLowerCase()}</Badge>
                </Td>
                <Td className="text-right">
                  {can('users.suspend') && u.status === 'ACTIVE' && <StatusAction label="Suspend" variant="destructive" onConfirm={(r) => change(u.id, 'SUSPEND', r)} />}
                  {can('users.suspend') && u.status === 'SUSPENDED' && <StatusAction label="Reactivate" onConfirm={(r) => change(u.id, 'REACTIVATE', r)} />}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {users.hasNextPage && (
        <Button variant="outline" onClick={() => users.fetchNextPage()} loading={users.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
