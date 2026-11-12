import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClubMember } from '@walktogether/api-client';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, TextField } from '@/components/ui';
import { Chips, confirm, NoPermission, Notice, Tabs } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { shareCsv } from '@/services/files';
import { errorMessage } from '@/utils/errors';

type Status = 'ACTIVE' | 'PENDING' | 'SUSPENDED';

export default function Members() {
  const { clubId, club, can } = useAdminClub();
  const params = useLocalSearchParams<{ status?: Status }>();
  const qc = useQueryClient();
  const tabs = (
    [
      { key: 'ACTIVE', label: 'Active', allowed: can('members.view') },
      { key: 'PENDING', label: 'Requests', allowed: can('members.approve') },
      { key: 'SUSPENDED', label: 'Suspended', allowed: can('members.suspend') },
    ] as const
  ).filter((t) => t.allowed);
  const [status, setStatus] = useState<Status>(params.status ?? 'ACTIVE');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);

  const members = useInfiniteQuery({
    queryKey: ['members', clubId, status, search],
    queryFn: ({ pageParam }) => api.clubs.members(clubId, { status, q: search || undefined, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: !!club && can('members.view'),
  });
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId), enabled: !!club && can('members.roles.assign') });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditingRole(null);
      void qc.invalidateQueries({ queryKey: ['members', clubId] });
      void qc.invalidateQueries({ queryKey: ['admin-club', clubId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const exportCsv = useMutation({
    mutationFn: async () => shareCsv(`${club?.slug ?? 'club'}-members.csv`, await api.reports.membersCsv(clubId)),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('members.view'))
    return (
      <Screen edges={[]}>
        <NoPermission what="view members" />
      </Screen>
    );
  const rows = members.data?.pages.flatMap((p) => p.items) ?? [];

  const actions = (m: ClubMember) => {
    if (m.role.systemKey === 'OWNER') return null;
    const name = m.user.displayName;
    return (
      <View className="mt-3 flex-row flex-wrap gap-2">
        {m.status === 'PENDING' && can('members.approve') && (
          <>
            <Button title="Approve" className="min-h-[40px] flex-1" onPress={() => act.mutate(() => api.clubs.review(clubId, m.membershipId, { decision: 'APPROVE' }))} />
            <Button
              title="Reject"
              variant="outline"
              className="min-h-[40px] flex-1"
              onPress={() =>
                confirm('Reject request', `Reject ${name}'s request to join?`, () => act.mutate(() => api.clubs.review(clubId, m.membershipId, { decision: 'REJECT' })), 'Reject')
              }
            />
          </>
        )}
        {m.status === 'ACTIVE' && can('members.roles.assign') && roles.data && (
          <Button title="Change role" variant="secondary" className="min-h-[40px]" onPress={() => setEditingRole(editingRole === m.membershipId ? null : m.membershipId)} />
        )}
        {m.status === 'ACTIVE' && can('members.suspend') && (
          <Button
            title="Suspend"
            variant="outline"
            className="min-h-[40px]"
            onPress={() =>
              confirm(
                'Suspend member',
                `Suspend ${name}? They lose access to members-only content.`,
                () => act.mutate(() => api.clubs.moderate(clubId, m.membershipId, { action: 'SUSPEND' })),
                'Suspend',
              )
            }
          />
        )}
        {m.status === 'SUSPENDED' && can('members.suspend') && (
          <Button
            title="Reinstate"
            variant="outline"
            className="min-h-[40px]"
            onPress={() => act.mutate(() => api.clubs.moderate(clubId, m.membershipId, { action: 'REINSTATE' }))}
          />
        )}
        {m.status !== 'PENDING' && can('members.remove') && (
          <Button
            title="Remove"
            variant="danger"
            className="min-h-[40px]"
            onPress={() =>
              confirm(
                'Remove member',
                `Remove ${name} from ${club.name}? Their personal activities are not affected.`,
                () => act.mutate(() => api.clubs.moderate(clubId, m.membershipId, { action: 'REMOVE' })),
                'Remove',
              )
            }
          />
        )}
      </View>
    );
  };

  return (
    <Screen edges={[]} refreshing={members.isRefetching} onRefresh={() => void members.refetch()}>
      <Stack.Screen options={{ title: 'Members' }} />
      {tabs.length > 1 && <Tabs value={status} options={tabs.map((t) => ({ key: t.key, label: t.label }))} onChange={setStatus} />}
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          <TextField label="Search" value={q} onChangeText={setQ} placeholder="Name or username" returnKeyType="search" onSubmitEditing={() => setSearch(q.trim())} />
        </View>
      </View>
      {can('analytics.view') && <Button title="Export members (CSV)" variant="outline" className="mb-4" loading={exportCsv.isPending} onPress={() => exportCsv.mutate()} />}
      {error ? <Notice>{error}</Notice> : null}
      {members.isLoading ? (
        <Loading />
      ) : members.error ? (
        <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={status === 'PENDING' ? 'No pending requests' : search ? 'No members match your search' : 'No members here yet'} />
      ) : (
        <View className="gap-3">
          {rows.map((m) => (
            <Card key={m.membershipId}>
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-ink">{m.user.displayName}</Text>
                  <Text className="text-sm text-ink-muted">@{m.user.username}</Text>
                  {m.requestMessage ? <Text className="mt-1 text-sm italic text-ink-muted">“{m.requestMessage}”</Text> : null}
                  <Text className="mt-1 text-xs text-ink-muted">
                    {status === 'PENDING' ? 'Requested' : 'Joined'} {new Date(status === 'PENDING' ? m.requestedAt : (m.joinedAt ?? m.requestedAt)).toLocaleDateString()}
                  </Text>
                </View>
                <Badge label={m.role.name} tone={m.role.systemKey === 'OWNER' ? 'primary' : 'neutral'} />
              </View>
              {editingRole === m.membershipId && roles.data && (
                <View className="mt-3">
                  <Chips
                    label="Role"
                    value={m.role.id}
                    options={roles.data.filter((r) => !r.isOwner).map((r) => ({ key: r.id, label: r.name }))}
                    onChange={(roleId) => act.mutate(() => api.clubs.assignRole(clubId, m.membershipId, roleId))}
                  />
                </View>
              )}
              {actions(m)}
            </Card>
          ))}
        </View>
      )}
      {members.hasNextPage && <Button title="Load more" variant="outline" className="mt-4" loading={members.isFetchingNextPage} onPress={() => void members.fetchNextPage()} />}
    </Screen>
  );
}
