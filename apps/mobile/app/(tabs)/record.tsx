import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Button, Card } from '@/components/ui';
import { Screen } from '@/components/screen';

type Perm = 'unknown' | 'granted' | 'denied' | 'blocked';

/**
 * GPS recording is delivered in Phase 3 (see DEVELOPMENT_STATUS.md). This screen already performs the
 * real location-permission flow so users understand why access is needed before their first recording.
 */
export default function Record() {
  const [perm, setPerm] = useState<Perm>('unknown');

  const check = useCallback(async () => {
    const res = await Location.getForegroundPermissionsAsync();
    setPerm(res.granted ? 'granted' : res.canAskAgain ? 'unknown' : 'blocked');
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  const request = async () => {
    const res = await Location.requestForegroundPermissionsAsync();
    setPerm(res.granted ? 'granted' : res.canAskAgain ? 'denied' : 'blocked');
  };

  return (
    <Screen>
      <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
        Record
      </Text>
      <Card className="mt-5">
        <Text className="text-lg font-bold text-ink">GPS walk & run recording is coming next</Text>
        <Text className="mt-2 text-ink-muted">You’ll be able to record walks and runs with live distance, time and pace, even without a connection. The start and end of your routes are hidden by default.</Text>
      </Card>
      <Card className="mt-4">
        <Text className="font-semibold text-ink">Location access</Text>
        {perm === 'granted' ? (
          <Text className="mt-1 text-success">Location access is allowed. You’re ready for recording.</Text>
        ) : perm === 'blocked' ? (
          <View>
            <Text className="mt-1 text-ink-muted">Location access is turned off for WalkTogether. Enable it in your phone’s settings to record activities.</Text>
            <Button title="Open settings" variant="outline" className="mt-3" onPress={() => void Linking.openSettings()} />
          </View>
        ) : (
          <View>
            <Text className="mt-1 text-ink-muted">WalkTogether only uses your location while you record an activity, to measure distance, pace and route.</Text>
            {perm === 'denied' && <Text className="mt-2 text-danger">Permission was not granted.</Text>}
            <Button title="Allow location access" className="mt-3" onPress={() => void request()} />
          </View>
        )}
      </Card>
    </Screen>
  );
}
