import { useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RouteMap } from '@/components/map/route-map';
import { Badge, Button, Card, ErrorState, Loading } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api.events.get(id) });
  const rsvp = useMutation({
    mutationFn: (going: boolean) => api.events.rsvp(id, going),
    onSuccess: (r) => {
      setMsg(
        r.status === 'GOING' ? 'You’re going! We’ll remind you before it starts.' : r.status === 'WAITLISTED' ? 'The event is full: you’re on the waitlist.' : 'RSVP cancelled.',
      );
      void qc.invalidateQueries({ queryKey: ['event', id] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data)
    return (
      <Screen edges={[]}>
        <ErrorState message={errorMessage(q.error, 'Event not found')} />
      </Screen>
    );
  const e = q.data;
  const reg = e.viewer?.registration;
  const start = new Date(e.startsAt);
  const directions = () => {
    if (e.meetingLat == null) return;
    const url =
      Platform.OS === 'ios'
        ? `maps://?daddr=${e.meetingLat},${e.meetingLng}`
        : `geo:${e.meetingLat},${e.meetingLng}?q=${e.meetingLat},${e.meetingLng}(${encodeURIComponent(e.meetingPoint)})`;
    void Linking.openURL(url);
  };
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: e.club.name }} />
      <Text accessibilityRole="header" className="text-2xl font-extrabold text-ink">
        {e.title}
      </Text>
      <Text className="mt-1 text-ink-muted">
        {start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </Text>
      {e.sponsor && (
        <View className="mt-2">
          <Badge label={`Sponsored by ${e.sponsor.name}`} tone="warning" />
        </View>
      )}
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Badge label={e.difficulty.toLowerCase()} tone="primary" />
        {e.distanceM ? <Badge label={`${(e.distanceM / 1000).toFixed(1)} km`} /> : null}
        <Badge label={`${e.goingCount}${e.maxParticipants ? `/${e.maxParticipants}` : ''} going`} />
      </View>
      {e.status === 'CANCELLED' && (
        <Card className="mt-4 bg-red-50">
          <Text className="font-semibold text-danger">Cancelled</Text>
          <Text className="text-ink-muted">{e.cancelReason}</Text>
        </Card>
      )}
      {msg && (
        <Card className="mt-4 bg-primary-soft">
          <Text accessibilityLiveRegion="polite">{msg}</Text>
        </Card>
      )}
      {e.status === 'SCHEDULED' && (
        <View className="mt-4 gap-2">
          {reg === 'GOING' || reg === 'WAITLISTED' ? (
            <>
              <Badge label={reg === 'GOING' ? 'You’re going' : 'On the waitlist'} tone="primary" />
              {!e.viewer?.checkedInAt && <Button title="Check in (scan QR)" onPress={() => router.push('/events/scan')} />}
              {e.viewer?.checkedInAt && <Text className="text-success">Checked in at {new Date(e.viewer.checkedInAt).toLocaleTimeString()}</Text>}
              <Button title="Can’t make it" variant="outline" loading={rsvp.isPending} onPress={() => rsvp.mutate(false)} />
            </>
          ) : (
            <Button title="I’m going" loading={rsvp.isPending} onPress={() => rsvp.mutate(true)} />
          )}
        </View>
      )}
      <Card className="mt-4">
        <Text className="font-bold text-ink">Meeting point</Text>
        <Text className="mt-1 text-ink-muted">{e.meetingPoint}</Text>
        {e.meetingLat != null && e.meetingLng != null && (
          <>
            <View className="mt-3">
              <RouteMap points={[{ lat: e.meetingLat, lng: e.meetingLng }]} height={180} />
            </View>
            <Button title="Directions" variant="outline" className="mt-3" onPress={directions} />
          </>
        )}
      </Card>
      {(e.description || e.routeDescription) && (
        <Card className="mt-4">
          {e.description ? <Text className="text-ink">{e.description}</Text> : null}
          {e.routeDescription ? <Text className="mt-2 text-ink-muted">Route: {e.routeDescription}</Text> : null}
        </Card>
      )}
    </Screen>
  );
}
