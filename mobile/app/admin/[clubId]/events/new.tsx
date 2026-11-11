import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createEventSchema } from '@walktogether/validation';
import { Button, Loading, TextField } from '@/components/ui';
import { Chips, DateTimeField, NoPermission, Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const TYPES = [
  { key: 'WALK', label: 'Walk' },
  { key: 'RUN', label: 'Run' },
  { key: 'HIKE', label: 'Hike' },
  { key: 'CHARITY_WALK', label: 'Charity walk' },
  { key: 'FITNESS', label: 'Fitness' },
  { key: 'SOCIAL', label: 'Social' },
] as const;
type EventType = (typeof TYPES)[number]['key'];

export default function NewEvent() {
  const { clubId, club, can } = useAdminClub();
  const router = useRouter();
  const qc = useQueryClient();
  const start = new Date(Date.now() + 86_400_000);
  start.setHours(6, 30, 0, 0);
  const [f, setF] = useState({
    title: '',
    description: '',
    type: 'WALK' as EventType,
    visibility: 'MEMBERS' as 'MEMBERS' | 'PUBLIC',
    startsAt: start,
    durationMin: '90',
    meetingPoint: '',
    lat: null as number | null,
    lng: null as number | null,
    distanceKm: '',
    difficulty: 'EASY' as 'EASY' | 'MODERATE' | 'HARD',
    max: '',
    repeat: 'NONE' as 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY',
    count: '4',
  });
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const useHere = async () => {
    setLocating(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location permission is needed to pin the meeting point.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setF((p) => ({ ...p, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLocating(false);
    }
  };

  const create = useMutation({
    mutationFn: () => {
      const endsAt = new Date(f.startsAt.getTime() + Number(f.durationMin) * 60_000);
      const body = {
        title: f.title.trim(),
        description: f.description.trim() || null,
        type: f.type,
        visibility: f.visibility,
        startsAt: f.startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        meetingPoint: f.meetingPoint.trim(),
        meetingLat: f.lat,
        meetingLng: f.lng,
        distanceM: f.distanceKm ? Math.round(Number(f.distanceKm) * 1000) : null,
        difficulty: f.difficulty,
        maxParticipants: f.max ? Number(f.max) : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(f.repeat !== 'NONE' ? { recurrence: { frequency: f.repeat, interval: 1, count: Number(f.count) } } : {}),
      };
      const parsed = createEventSchema.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('\n'));
      return api.events.create(clubId, body);
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-events', clubId] });
      router.back();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('events.manage')) return <Screen edges={[]}><NoPermission what="create events" /></Screen>;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Schedule event' }} />
      {error ? <Notice>{error}</Notice> : null}
      <TextField label="Title" value={f.title} onChangeText={(t) => set('title', t)} placeholder="Saturday sunrise walk" />
      <Chips label="Type" value={f.type} options={[...TYPES]} onChange={(t) => set('type', t)} />
      <DateTimeField label="Starts" value={f.startsAt} minimumDate={new Date()} onChange={(d) => set('startsAt', d)} />
      <TextField label="Duration (minutes)" value={f.durationMin} keyboardType="number-pad" onChangeText={(t) => set('durationMin', t)} />
      <TextField label="Meeting point" value={f.meetingPoint} onChangeText={(t) => set('meetingPoint', t)} placeholder="Karura Forest, Gate A" />
      <View className="mb-4">
        <Button
          title={f.lat != null ? `Pinned at ${f.lat}, ${f.lng} — update` : 'Pin meeting point to my location'}
          variant="secondary"
          loading={locating}
          onPress={() => void useHere()}
        />
        {f.lat != null && <Button title="Remove pin" variant="ghost" onPress={() => setF((p) => ({ ...p, lat: null, lng: null }))} />}
      </View>
      <TextField label="Distance (km, optional)" value={f.distanceKm} keyboardType="decimal-pad" onChangeText={(t) => set('distanceKm', t)} />
      <TextField label="Max participants (optional)" value={f.max} keyboardType="number-pad" onChangeText={(t) => set('max', t)} />
      <Chips label="Difficulty" value={f.difficulty} options={[{ key: 'EASY', label: 'Easy' }, { key: 'MODERATE', label: 'Moderate' }, { key: 'HARD', label: 'Hard' }]} onChange={(d) => set('difficulty', d)} />
      <Chips label="Who can see it" value={f.visibility} options={[{ key: 'MEMBERS', label: 'Members only' }, { key: 'PUBLIC', label: 'Public' }]} onChange={(v) => set('visibility', v)} />
      <Chips
        label="Repeat (Club Pro)"
        value={f.repeat}
        options={[{ key: 'NONE', label: 'Once' }, { key: 'WEEKLY', label: 'Weekly' }, { key: 'DAILY', label: 'Daily' }, { key: 'MONTHLY', label: 'Monthly' }]}
        onChange={(r) => set('repeat', r)}
      />
      {f.repeat !== 'NONE' && <TextField label="Number of occurrences" value={f.count} keyboardType="number-pad" onChangeText={(t) => set('count', t)} />}
      <TextField label="Description" value={f.description} multiline onChangeText={(t) => set('description', t)} style={{ minHeight: 90, textAlignVertical: 'top' }} />
      <Button title="Create event" loading={create.isPending} disabled={f.title.trim().length < 3 || f.meetingPoint.trim().length < 2} onPress={() => create.mutate()} />
    </Screen>
  );
}
