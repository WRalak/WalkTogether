import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { RouteMap } from '@/components/map/route-map';
import { Button, Card, SectionTitle, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { useTracking } from '@/hooks/use-tracking';
import { api } from '@/services/api';
import { syncNow, trackingSession } from '@/services/tracking';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';

const VIS = [
  { key: 'PUBLIC', label: 'Everyone' },
  { key: 'FOLLOWERS', label: 'Followers' },
  { key: 'PRIVATE', label: 'Only me' },
] as const;

export default function Summary() {
  const router = useRouter();
  const { activity, snapshot, recent } = useTracking();
  const clubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'FOLLOWERS' | 'PRIVATE'>('FOLLOWERS');
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  if (!activity || !snapshot)
    return (
      <Screen edges={[]}>
        <Text className="text-ink-muted">No activity to save.</Text>
      </Screen>
    );

  const save = async () => {
    setSaving(true);
    await trackingSession.save({ title: title.trim() || null, visibility, clubIds });
    void syncNow().catch(() => undefined); // uploads now, or later when back online
    router.replace('/activities');
  };

  return (
    <Screen edges={[]}>
      <Text accessibilityRole="header" className="text-2xl font-extrabold text-ink">
        Nice {typeLabel(activity.type).toLowerCase()}!
      </Text>
      <View className="mt-4">
        <RouteMap points={recent} />
      </View>
      <Card className="mt-4 flex-row justify-between">
        <View>
          <Text className="text-2xl font-bold text-ink">{km(snapshot.distanceM)} km</Text>
          <Text className="text-xs text-ink-muted">Distance</Text>
        </View>
        <View>
          <Text className="text-2xl font-bold text-ink">{formatDuration(Math.floor(snapshot.elapsedMs / 1000))}</Text>
          <Text className="text-xs text-ink-muted">Time</Text>
        </View>
        <View>
          <Text className="text-2xl font-bold text-ink">{formatPace(snapshot.distanceM > 50 ? snapshot.movingMs / 1000 / (snapshot.distanceM / 1000) : null)}</Text>
          <Text className="text-xs text-ink-muted">Avg pace</Text>
        </View>
      </Card>
      <Text className="mt-2 text-xs text-ink-muted">Final statistics are verified by WalkTogether after upload.</Text>

      <View className="mt-4">
        <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Saturday sunrise walk" maxLength={120} />
      </View>
      <SectionTitle>Who can see this?</SectionTitle>
      <View className="flex-row gap-2">
        {VIS.map((v) => (
          <Pressable
            key={v.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: visibility === v.key }}
            onPress={() => setVisibility(v.key)}
            className={`flex-1 items-center rounded-xl border py-3 ${visibility === v.key ? 'border-primary bg-primary-soft' : 'border-line bg-surface'}`}
          >
            <Text className={`font-semibold ${visibility === v.key ? 'text-primary' : 'text-ink-muted'}`}>{v.label}</Text>
          </Pressable>
        ))}
      </View>
      {!!clubs.data?.filter((c) => c.membershipStatus === 'ACTIVE').length && (
        <>
          <SectionTitle>Share with clubs</SectionTitle>
          {clubs.data
            .filter((c) => c.membershipStatus === 'ACTIVE')
            .map((c) => {
              const on = clubIds.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setClubIds(on ? clubIds.filter((x) => x !== c.id) : [...clubIds, c.id])}
                  className="mb-2 flex-row items-center gap-3 rounded-xl border border-line bg-surface p-3"
                >
                  <View className={`h-6 w-6 items-center justify-center rounded-md border-2 ${on ? 'border-primary bg-primary' : 'border-line'}`}>
                    {on && <Text className="font-bold text-white">✓</Text>}
                  </View>
                  <Text className="text-ink">{c.name}</Text>
                </Pressable>
              );
            })}
        </>
      )}
      <Button title="Save activity" className="mt-6" loading={saving} onPress={() => void save()} />
      <Button title="Resume recording" variant="ghost" className="mt-2" onPress={() => void trackingSession.resume().then(() => router.back())} />
      <Button
        title="Discard"
        variant="ghost"
        textClassName="text-danger"
        onPress={() =>
          Alert.alert('Discard this activity?', 'It will be deleted from this phone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: () => void trackingSession.discard().then(() => router.replace('/(tabs)/activity')) },
          ])
        }
      />
    </Screen>
  );
}
