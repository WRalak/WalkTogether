import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { NoPermission, StatTile } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';

/** Activities members chose to share with the club. Summary only — routes stay private to each member. */
export default function SharedActivities() {
  const { clubId, club, can } = useAdminClub();
  const q = useInfiniteQuery({
    queryKey: ['club-activities', clubId],
    queryFn: ({ pageParam }) => api.reports.activities(clubId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: !!club && can('members.view'),
  });
  if (!club) return <Loading />;
  if (!can('members.view'))
    return (
      <Screen edges={[]}>
        <NoPermission what="view shared activities" />
      </Screen>
    );
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const week = q.data?.pages[0]?.meta.lastSevenDays;

  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: 'Shared activities' }} />
      {week && (
        <View className="flex-row flex-wrap gap-3">
          <StatTile label="Activities (7d)" value={week.activities} />
          <StatTile label="Distance (7d)" value={`${km(week.distanceM)} km`} />
          <StatTile label="Moving time (7d)" value={formatDuration(week.movingSeconds)} />
        </View>
      )}
      <SectionTitle>Recent</SectionTitle>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !items.length ? (
        <EmptyState title="No shared activities yet" body="When members finish a walk or run they can share it with the club." />
      ) : (
        <View className="gap-2">
          {items.map((a) => (
            <Card key={a.id} className="p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-semibold text-ink">{a.athlete.displayName}</Text>
                {a.flagged ? <Badge tone="warning" label="Flagged" /> : null}
              </View>
              <Text className="text-sm text-ink">
                {a.title ?? typeLabel(a.type)} · {km(a.distanceM)} km · {formatDuration(a.movingSeconds)} · {formatPace(a.avgPaceSecPerKm)} /km
              </Text>
              <Text className="text-xs text-ink-muted">{new Date(a.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
            </Card>
          ))}
        </View>
      )}
      {q.hasNextPage && <Button title="Load more" variant="outline" className="mt-4" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} />}
    </Screen>
  );
}
