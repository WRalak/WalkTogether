import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Loading } from '@/components/ui';
import { confirm, NoPermission, Notice, Tabs } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

type Status = 'OPEN' | 'ACTIONED' | 'DISMISSED';

export default function Moderation() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('OPEN');
  const [error, setError] = useState<string | null>(null);
  const reports = useQuery({ queryKey: ['club-reports', clubId, status], queryFn: () => api.moderation.clubReports(clubId, status), enabled: !!club && can('community.moderate') });
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: 'DISMISS' | 'HIDE' }) => api.moderation.resolveClubReport(clubId, v.id, v.action),
    onMutate: () => setError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club-reports', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  if (!club) return <Loading />;
  if (!can('community.moderate')) return <Screen edges={[]}><NoPermission what="moderate the community" /></Screen>;

  return (
    <Screen edges={[]} refreshing={reports.isRefetching} onRefresh={() => void reports.refetch()}>
      <Stack.Screen options={{ title: 'Moderation' }} />
      <Text className="mb-3 text-sm text-ink-muted">Reports about posts, comments and messages in your club. Serious issues are also visible to the WalkTogether trust & safety team.</Text>
      <Tabs value={status} options={[{ key: 'OPEN', label: 'Open' }, { key: 'ACTIONED', label: 'Hidden' }, { key: 'DISMISSED', label: 'Dismissed' }]} onChange={setStatus} />
      {error ? <Notice>{error}</Notice> : null}
      {reports.isLoading ? (
        <Loading />
      ) : !reports.data?.items.length ? (
        <EmptyState title="Nothing to review" />
      ) : (
        <View className="gap-3">
          {reports.data.items.map((r) => (
            <Card key={r.id}>
              <View className="flex-row flex-wrap gap-2">
                <Badge tone="warning" label={r.reason.toLowerCase()} />
                <Badge label={r.targetType.toLowerCase()} />
              </View>
              {r.preview ? <Text className="mt-2 rounded-xl bg-surface-muted p-3 text-sm text-ink">{r.preview}</Text> : null}
              {r.details ? <Text className="mt-2 text-sm italic text-ink-muted">“{r.details}”</Text> : null}
              <Text className="mt-2 text-xs text-ink-muted">
                Reported by @{r.reporter.username} · {new Date(r.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </Text>
              {status === 'OPEN' && (
                <View className="mt-3 flex-row gap-2">
                  <Button title="Hide content" variant="danger" className="min-h-[40px] flex-1" onPress={() => confirm('Hide content', 'Members will no longer see it.', () => resolve.mutate({ id: r.id, action: 'HIDE' }), 'Hide')} />
                  <Button title="Dismiss" variant="outline" className="min-h-[40px] flex-1" onPress={() => resolve.mutate({ id: r.id, action: 'DISMISS' })} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
