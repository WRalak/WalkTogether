'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClubMember } from '@walktogether/api-client';
import { Alert, Badge, Button, cn, EmptyState, Input, Select, Spinner, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from './use-club';

type Status = 'ACTIVE' | 'PENDING' | 'SUSPENDED';

export function MembersView() {
  const { clubId, can } = useClub();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const tabs: { key: Status; label: string; allowed: boolean }[] = [
    { key: 'ACTIVE', label: 'Active', allowed: can('members.view') },
    { key: 'PENDING', label: 'Requests', allowed: can('members.approve') },
    { key: 'SUSPENDED', label: 'Suspended', allowed: can('members.suspend') },
  ];
  const requested = params.get('status') as Status | null;
  const status: Status = tabs.find((t) => t.key === requested && t.allowed)?.key ?? 'ACTIVE';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const members = useInfiniteQuery({
    queryKey: ['members', clubId, status, search],
    queryFn: ({ pageParam }) => api.clubs.members(clubId, { status, q: search || undefined, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId), enabled: can('members.roles.assign') });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['members', clubId] });
    void qc.invalidateQueries({ queryKey: ['club', clubId] });
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setActionError(null),
    onSuccess: refresh,
    onError: (e) => setActionError(errorMessage(e)),
  });

  const rows = members.data?.pages.flatMap((p) => p.items) ?? [];

  const actions = (m: ClubMember) => {
    const isOwner = m.role.systemKey === 'OWNER';
    if (isOwner) return <span className="text-xs text-muted-foreground">Owner</span>;
    const run = (fn: () => Promise<unknown>, confirmText?: string) => {
      if (confirmText && !window.confirm(confirmText)) return;
      act.mutate(fn);
    };
    const name = m.user.displayName;
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {m.status === 'PENDING' && (
          <>
            <Button size="sm" onClick={() => run(() => api.clubs.review(clubId, m.membershipId, { decision: 'APPROVE' }))}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => run(() => api.clubs.review(clubId, m.membershipId, { decision: 'REJECT' }), `Reject ${name}'s request?`)}>
              Reject
            </Button>
          </>
        )}
        {m.status === 'ACTIVE' && can('members.suspend') && (
          <Button size="sm" variant="outline" onClick={() => run(() => api.clubs.moderate(clubId, m.membershipId, { action: 'SUSPEND' }), `Suspend ${name}? They will lose access to members-only content.`)}>
            Suspend
          </Button>
        )}
        {m.status === 'SUSPENDED' && can('members.suspend') && (
          <Button size="sm" variant="outline" onClick={() => run(() => api.clubs.moderate(clubId, m.membershipId, { action: 'REINSTATE' }))}>
            Reinstate
          </Button>
        )}
        {m.status !== 'PENDING' && can('members.remove') && (
          <Button size="sm" variant="destructive" onClick={() => run(() => api.clubs.moderate(clubId, m.membershipId, { action: 'REMOVE' }), `Remove ${name} from the club?`)}>
            Remove
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Members</h1>
      <div role="tablist" aria-label="Member status" className="flex gap-2 border-b">
        {tabs
          .filter((t) => t.allowed)
          .map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={status === t.key}
              onClick={() => router.replace(`/clubs/${clubId}/members?status=${t.key}`)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', status === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t.label}
            </button>
          ))}
      </div>
      <form
        role="search"
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <label htmlFor="member-search" className="sr-only">
          Search members
        </label>
        <Input id="member-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or username" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {actionError && <Alert variant="destructive">{actionError}</Alert>}
      {members.isLoading ? (
        <Spinner />
      ) : members.error ? (
        <Alert variant="destructive">{errorMessage(members.error)}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={status === 'PENDING' ? 'No pending requests' : search ? 'No members match your search' : 'No members here yet'} description={status === 'ACTIVE' ? 'Invite people from the Invitations page.' : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>{status === 'PENDING' ? 'Requested' : 'Joined'}</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.membershipId}>
                <Td>
                  <p className="font-medium">{m.user.displayName}</p>
                  <p className="text-xs text-muted-foreground">@{m.user.username}</p>
                  {m.requestMessage && <p className="mt-1 max-w-xs text-xs italic text-muted-foreground">“{m.requestMessage}”</p>}
                </Td>
                <Td>
                  {m.status === 'ACTIVE' && can('members.roles.assign') && m.role.systemKey !== 'OWNER' && roles.data ? (
                    <Select
                      aria-label={`Role for ${m.user.displayName}`}
                      className="h-9 w-48"
                      value={m.role.id}
                      onChange={(e) => act.mutate(() => api.clubs.assignRole(clubId, m.membershipId, e.target.value))}
                    >
                      {roles.data
                        .filter((r) => !r.isOwner)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </Select>
                  ) : (
                    <Badge variant={m.role.systemKey === 'OWNER' ? 'default' : 'secondary'}>{m.role.name}</Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{new Date(m.status === 'PENDING' ? m.requestedAt : (m.joinedAt ?? m.requestedAt)).toLocaleDateString()}</Td>
                <Td>{actions(m)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {members.hasNextPage && (
        <Button variant="outline" onClick={() => members.fetchNextPage()} loading={members.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
