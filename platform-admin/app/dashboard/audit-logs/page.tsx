'use client';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Button, EmptyState, Input, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [filters, setFilters] = useState({ action: '', actorType: '' });
  const logs = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => adminApi.auditLogs({ action: filters.action || undefined, actorType: filters.actorType || undefined, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const rows = logs.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Append-only record of sensitive actions. Entries cannot be edited or deleted.</p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ action: action.trim(), actorType });
        }}
      >
        <Input aria-label="Action prefix" placeholder="Action prefix, e.g. admin. or membership." value={action} onChange={(e) => setAction(e.target.value)} className="sm:max-w-sm" />
        <Select aria-label="Actor type" value={actorType} onChange={(e) => setActorType(e.target.value)} className="sm:w-40">
          <option value="">All actors</option>
          <option value="ADMIN">Admin</option>
          <option value="USER">User</option>
          <option value="SYSTEM">System</option>
        </Select>
        <Button variant="outline" type="submit">
          Filter
        </Button>
      </form>
      {logs.isLoading ? (
        <Spinner />
      ) : logs.error ? (
        <Alert variant="destructive">{errorMessage(logs.error)}</Alert>
      ) : !rows.length ? (
        <EmptyState title="No audit entries" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">{new Date(l.createdAt).toLocaleString()}</Td>
                <Td className="text-xs">
                  {l.actorType}
                  <br />
                  <span className="font-mono text-muted-foreground">{l.actorId?.slice(0, 8) ?? '—'}</span>
                </Td>
                <Td className="font-mono text-xs">{l.action}</Td>
                <Td className="text-xs">
                  {l.targetType} <span className="font-mono text-muted-foreground">{l.targetId?.slice(0, 8)}</span>
                </Td>
                <Td className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(l.metadata)}>
                  {JSON.stringify(l.metadata)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {logs.hasNextPage && (
        <Button variant="outline" onClick={() => logs.fetchNextPage()} loading={logs.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
