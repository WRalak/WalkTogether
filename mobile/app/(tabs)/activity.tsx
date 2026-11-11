import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { ActivityKind } from '@walktogether/gps';
import { RouteMap } from '@/components/map/route-map';
import { Button, Card } from '@/components/ui';
import { Screen } from '@/components/screen';
import { useTracking } from '@/hooks/use-tracking';
import { trackingSession } from '@/services/tracking';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';

const KINDS: ActivityKind[] = ['WALK', 'RUN', 'HIKE'];

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View className="flex-1 items-center" accessible accessibilityLabel={`${label} ${value}`}>
      <Text className={`font-extrabold tabular-nums text-ink ${big ? 'text-6xl' : 'text-3xl'}`}>{value}</Text>
      <Text className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</Text>
    </View>
  );
}

export default function Record() {
  const router = useRouter();
  const { activity, snapshot, recent, backgroundCapable } = useTracking();
  const [kind, setKind] = useState<ActivityKind>('WALK');
  const [busy, setBusy] = useState(false);
  const [permBlocked, setPermBlocked] = useState(false);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((p) => setPermBlocked(!p.granted && !p.canAskAgain));
  }, []);
  useEffect(() => {
    if (activity?.status === 'recording') void activateKeepAwakeAsync('recording');
    else deactivateKeepAwake('recording');
  }, [activity?.status]);

  const start = async () => {
    setBusy(true);
    try {
      await trackingSession.start(kind);
    } catch (e) {
      if (e instanceof Error && e.message === 'LOCATION_PERMISSION_DENIED') {
        Alert.alert('Location needed', 'WalkTogether needs your location to record distance, pace and your route.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void Linking.openSettings() },
        ]);
      } else Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!activity) {
    return (
      <Screen>
        <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
          Record
        </Text>
        <Text className="mt-1 text-ink-muted">Choose an activity and start when you’re ready.</Text>
        <View className="mt-6 flex-row gap-2" accessibilityRole="radiogroup">
          {KINDS.map((k) => (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ selected: kind === k }}
              onPress={() => setKind(k)}
              className={`flex-1 items-center rounded-2xl border py-4 ${kind === k ? 'border-primary bg-primary-soft' : 'border-line bg-surface'}`}
            >
              <Text className={`text-base font-bold ${kind === k ? 'text-primary' : 'text-ink'}`}>{typeLabel(k)}</Text>
            </Pressable>
          ))}
        </View>
        {permBlocked && (
          <Card className="mt-4 bg-red-50">
            <Text className="text-danger">Location access is off for WalkTogether. Turn it on in Settings to record.</Text>
            <Button title="Open settings" variant="outline" className="mt-3" onPress={() => void Linking.openSettings()} />
          </Card>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start ${typeLabel(kind).toLowerCase()}`}
          disabled={busy}
          onPress={() => void start()}
          className="mt-10 h-44 w-44 items-center justify-center self-center rounded-full bg-primary shadow-lg active:opacity-80"
        >
          <Text className="text-2xl font-extrabold text-white">{busy ? '…' : 'START'}</Text>
        </Pressable>
        <Text className="mt-6 text-center text-xs text-ink-muted">Recording works offline. Your route’s start and end are hidden from others by default.</Text>
      </Screen>
    );
  }

  const s = snapshot!;
  const recording = activity.status === 'recording';
  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-ink">{typeLabel(activity.type)}</Text>
        <Text className={`text-sm font-semibold ${recording ? 'text-success' : 'text-accent'}`}>{recording ? '● Recording' : '❚❚ Paused'}</Text>
      </View>
      <View className="mt-4">
        <RouteMap points={recent} follow={recording} height={220} />
      </View>
      {!backgroundCapable && recording && <Text className="mt-2 text-xs text-ink-muted">Keep the app open: screen-off recording needs background location permission.</Text>}
      <View className="mt-6">
        <Stat label="Kilometres" value={km(s.distanceM)} big />
      </View>
      <View className="mt-6 flex-row">
        <Stat label="Time" value={formatDuration(Math.floor(s.elapsedMs / 1000))} />
        <Stat label="Pace /km" value={recording ? formatPace(s.currentPaceSecPerKm) : '--:--'} />
        <Stat label="Avg pace" value={formatPace(s.distanceM > 50 ? (s.movingMs / 1000) / (s.distanceM / 1000) : null)} />
      </View>
      <View className="mt-8 flex-row gap-3">
        {recording ? (
          <Button title="Pause" variant="secondary" className="flex-1" onPress={() => void trackingSession.pause()} />
        ) : (
          <Button title="Resume" className="flex-1" onPress={() => void trackingSession.resume()} />
        )}
        <Button
          title="Finish"
          variant="outline"
          className="flex-1"
          onPress={async () => {
            await trackingSession.stop();
            router.push('/activities/summary');
          }}
        />
      </View>
    </Screen>
  );
}
