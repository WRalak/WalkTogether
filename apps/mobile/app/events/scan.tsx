import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Card } from '@/components/ui';
import { Screen } from '@/components/screen';

/** Parses walktogether://events/<uuid>/check-in?code=<code> */
export function parseCheckInQr(data: string): { id: string; code: string } | null {
  const m = data.match(/^walktogether:\/\/events\/([0-9a-f-]{36})\/check-in\?code=([^&\s]+)$/i);
  return m ? { id: m[1]!, code: decodeURIComponent(m[2]!) } : null;
}

export default function Scan() {
  const router = useRouter();
  const [permission, request] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  if (!permission) return null;
  if (!permission.granted)
    return (
      <Screen edges={[]}>
        <Card>
          <Text className="text-ink">Allow camera access to scan the organizer’s check-in QR code.</Text>
          <Button title="Allow camera" className="mt-3" onPress={() => void request()} />
        </Card>
      </Screen>
    );
  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const parsed = parseCheckInQr(data);
          if (!parsed) return setError('That isn’t a WalkTogether check-in code.');
          handled.current = true;
          router.replace({ pathname: '/events/[id]/check-in', params: parsed });
        }}
      />
      <View className="absolute bottom-10 left-5 right-5 rounded-2xl bg-black/70 p-4">
        <Text className="text-center text-white">{error ?? 'Point your camera at the organizer’s QR code'}</Text>
      </View>
    </View>
  );
}
