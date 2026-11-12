import { Pressable, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, Loading } from '@/components/ui';
import { NoPermission } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function AdminEvents() {
  const { clubId, club, can } = useAdminClub();
  const router = useRouter();
  const events = useQuery({ queryKey: ['admin-events', clubId], queryFn: () => api.events.ofClub(clubId, { limit: 100, includeCancelled: true }), enabled: !!club });
  if (!club) return <Loading />;
  if (!can('club.view_private'))
    return (
      <Screen edges={[]}>
        <NoPermission what="view events" />
      </Screen>
    );

  return (
    <Screen edges={[]} refreshing={events.isRefetching} onRefresh={() => void events.refetch()}>
      <Stack.Screen options={{ title: 'Events' }} />
      {can('events.manage') && <Button title="Schedule an event" className="mb-4" onPress={() => router.push({ pathname: '/admin/[clubId]/events/new', params: { clubId } })} />}
      {events.isLoading ? (
        <Loading />
      ) : events.error ? (
        <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
      ) : !events.data?.items.length ? (
        <EmptyState title="No upcoming events" body="Schedule a walk or run for your members." />
      ) : (
        <View className="gap-3">
          {events.data.items.map((e) => (
            <Link key={e.id} href={{ pathname: '/admin/[clubId]/events/[eventId]', params: { clubId, eventId: e.id } }} asChild>
              <Pressable accessibilityRole="button" className="active:opacity-80">
                <Card>
                  <Text className="text-base font-semibold text-ink">{e.title}</Text>
                  <Text className="text-sm text-ink-muted">
                    {new Date(e.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {e.meetingPoint}
                  </Text>
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {e.status === 'CANCELLED' ? (
                      <Badge label="Cancelled" tone="warning" />
                    ) : (
                      <Badge tone="primary" label={`${e.goingCount}${e.maxParticipants ? `/${e.maxParticipants}` : ''} going`} />
                    )}
                    {e.seriesId ? <Badge label="Recurring" /> : null}
                    <Badge label={e.visibility === 'PUBLIC' ? 'Public' : 'Members only'} />
                  </View>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      )}
    </Screen>
  );
}
