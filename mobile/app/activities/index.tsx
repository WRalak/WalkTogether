import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityDto } from '@walktogether/api-client';
import { Badge, Button, EmptyState, ErrorState, Loading } from '@/components/ui';
import { api } from '@/services/api';
import { onSynced, sqliteRepository, syncNow } from '@/services/tracking';
import type { LocalActivity } from '@/services/tracking/types';
import { errorMessage } from '@/utils/errors';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';

function Row({ a }: { a: ActivityDto }) {
  return (
    <Link href={{ pathname: '/activities/[id]', params: { id: a.id } }} asChild>
      <Pressable accessibilityRole="link" className="mb-3 rounded-3xl border border-line bg-surface p-4 active:opacity-80">
        <View className="flex-row items-center justify-between">
          <Text className="font-bold text-ink">{a.title ?? `${typeLabel(a.type)}`}</Text>
          <Text className="text-xs text-ink-muted">{new Date(a.startedAt).toLocaleDateString()}</Text>
        </View>
        <Text className="mt-1 text-ink-muted">
          {km(a.distanceM)} km · {formatDuration(a.movingSeconds)} · {formatPace(a.avgPaceSecPerKm)} /km
        </Text>
        {a.flagged ? <Text className="mt-1 text-xs text-accent">Under review: excluded from leaderboards</Text> : null}
      </Pressable>
    </Link>
  );
}

export default function ActivitiesScreen() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<LocalActivity[]>([]);
  const loadPending = useCallback(() => void sqliteRepository.listLocal().then((l) => setPending(l.filter((a) => a.status === 'finished'))), []);
  useEffect(() => {
    loadPending();
    return onSynced(() => {
      loadPending();
      void qc.invalidateQueries({ queryKey: ['activities'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    });
  }, [loadPending, qc]);

  const q = useInfiniteQuery({
    queryKey: ['activities'],
    queryFn: ({ pageParam }) => api.activities.list({ cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <FlatList
      className="bg-surface-muted"
      contentContainerClassName="px-5 pb-10 pt-4"
      data={items}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => <Row a={item} />}
      refreshing={q.isRefetching}
      onRefresh={() => {
        void q.refetch();
        void syncNow().catch(() => undefined);
      }}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
      ListHeaderComponent={
        pending.length ? (
          <View className="mb-4 rounded-3xl border border-orange-200 bg-orange-50 p-4">
            <Text className="font-semibold text-ink">
              {pending.length} activit{pending.length === 1 ? 'y' : 'ies'} waiting to upload
            </Text>
            {pending.map((p) => (
              <View key={p.localId} className="mt-2 flex-row items-center justify-between">
                <Text className="text-sm text-ink-muted">
                  {typeLabel(p.type)} · {new Date(p.startedAt).toLocaleString()}
                </Text>
                {p.syncError ? <Badge label="Retrying" tone="warning" /> : <Badge label="Queued" />}
              </View>
            ))}
            <Button title="Upload now" variant="outline" className="mt-3" onPress={() => void syncNow().catch(() => undefined)} />
          </View>
        ) : null
      }
      ListEmptyComponent={q.isLoading ? <Loading /> : q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : <EmptyState title="No activities yet" body="Record your first walk or run from the Record tab." />}
    />
  );
}
