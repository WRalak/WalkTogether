import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Button, Card, ErrorState, Loading } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

/** Deep-link target of the organizer's QR code: walktogether://events/:id/check-in?code=… */
export default function CheckIn() {
  const { id, code } = useLocalSearchParams<{ id: string; code: string }>();
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done'; at: string } | { kind: 'error'; message: string }>({ kind: 'working' });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        // Location is an optional supporting signal; check-in works without it.
        let coords: { lat: number; lng: number } | undefined;
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
          if (pos) coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
        const res = await api.events.checkIn(id, { code: String(code ?? ''), ...coords });
        setState({ kind: 'done', at: res.checkedInAt });
      } catch (e) {
        setState({ kind: 'error', message: errorMessage(e) });
      }
    })();
  }, [id, code]);
  return (
    <Screen edges={[]}>
      {state.kind === 'working' && <Loading label="Checking you in" />}
      {state.kind === 'done' && (
        <Card>
          <Text className="text-2xl font-extrabold text-success">You’re checked in ✓</Text>
          <Text className="mt-1 text-ink-muted">{new Date(state.at).toLocaleTimeString()}. Enjoy the walk!</Text>
          <Button title="Back to event" className="mt-4" onPress={() => router.replace({ pathname: '/events/[id]', params: { id } })} />
        </Card>
      )}
      {state.kind === 'error' && <ErrorState message={state.message} onRetry={() => router.replace('/events/scan')} />}
    </Screen>
  );
}
