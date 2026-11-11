import { Alert, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decodePolyline } from '@walktogether/gps';
import { RouteMap } from '@/components/map/route-map';
import { Button, Card, ErrorState, Loading } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';

export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['activity', id], queryFn: () => api.activities.get(id) });
  const del = useMutation({
    mutationFn: () => api.activities.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activities'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      router.back();
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return (
      <Screen edges={[]}>
        <ErrorState message={errorMessage(q.error, 'Activity not found')} />
      </Screen>
    );
  const a = q.data;
  const stats: [string, string][] = [
    ['Distance', `${km(a.distanceM)} km`],
    ['Moving time', formatDuration(a.movingSeconds)],
    ['Avg pace', `${formatPace(a.avgPaceSecPerKm)} /km`],
    ['Avg speed', a.avgSpeedMps ? `${(a.avgSpeedMps * 3.6).toFixed(1)} km/h` : '—'],
    ['Max speed', a.maxSpeedMps ? `${(a.maxSpeedMps * 3.6).toFixed(1)} km/h` : '—'],
    ['Elevation gain', a.elevationGainM != null ? `${a.elevationGainM} m` : 'Not available'],
  ];
  if (a.caloriesEstimate != null) stats.push(['Calories (estimate)', `${a.caloriesEstimate}`]);
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: a.title ?? typeLabel(a.type) }} />
      <Text className="text-sm text-ink-muted">{new Date(a.startedAt).toLocaleString()}</Text>
      <View className="mt-3">{a.routePolyline ? <RouteMap points={decodePolyline(a.routePolyline)} /> : <Card><Text className="text-ink-muted">No route to show.</Text></Card>}</View>
      <Card className="mt-4">
        {stats.map(([k, v]) => (
          <View key={k} className="flex-row justify-between border-b border-line py-2.5 last:border-b-0">
            <Text className="text-ink-muted">{k}</Text>
            <Text className="font-semibold text-ink">{v}</Text>
          </View>
        ))}
      </Card>
      {a.flagged ? <Text className="mt-3 text-sm text-accent">This activity looked unusual (e.g. GPS jumps) and won’t count toward leaderboards. It stays in your history.</Text> : null}
      {me?.id === a.userId && (
        <Button
          title="Delete activity"
          variant="ghost"
          textClassName="text-danger"
          className="mt-4"
          loading={del.isPending}
          onPress={() => Alert.alert('Delete activity?', 'This permanently deletes the activity and its route.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => del.mutate() }])}
        />
      )}
    </Screen>
  );
}
