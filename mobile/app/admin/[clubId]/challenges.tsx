import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@walktogether/api-client';
import { Badge, Button, Card, EmptyState, Loading, SectionTitle, TextField } from '@/components/ui';
import { Chips, confirm, DateTimeField, NoPermission, Notice, Toggle } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const METRICS = { DISTANCE_M: 'Distance (km)', ACTIVITIES: 'Activities', MOVING_SECONDS: 'Moving time (h)', ACTIVE_DAYS: 'Active days' } as const;
type Metric = keyof typeof METRICS;

export default function AdminChallenges() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['club-challenges', clubId], queryFn: () => api.challenges.list({}), enabled: !!club });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: '',
    description: '',
    metric: 'DISTANCE_M' as Metric,
    target: '50',
    start: new Date(),
    end: new Date(Date.now() + 30 * 86_400_000),
    walk: true,
    run: true,
    hike: false,
    visibility: 'MEMBERS' as 'MEMBERS' | 'PUBLIC',
    reward: '',
    capKm: '42',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const toTarget = () => {
    const n = Number(f.target);
    if (!n) return null;
    return f.metric === 'DISTANCE_M' ? Math.round(n * 1000) : f.metric === 'MOVING_SECONDS' ? Math.round(n * 3600) : Math.round(n);
  };

  const create = useMutation({
    mutationFn: () =>
      api.challenges.createForClub(clubId, {
        title: f.title.trim(),
        description: f.description.trim() || null,
        metric: f.metric,
        target: toTarget(),
        activityTypes: [f.walk && 'WALK', f.run && 'RUN', f.hike && 'HIKE'].filter(Boolean) as ('WALK' | 'RUN' | 'HIKE')[],
        startsAt: f.start.toISOString(),
        endsAt: f.end.toISOString(),
        visibility: f.visibility,
        rewardDescription: f.reward.trim() || null,
        maxDailyDistanceM: Math.round(Number(f.capKm) * 1000),
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['club-challenges', clubId] });
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 402 ? 'Club challenges are part of Club Pro. Upgrade from Subscription.' : errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.challenges.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club-challenges', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('club.view_private')) return <Screen edges={[]}><NoPermission what="view challenges" /></Screen>;
  const items = list.data?.items.filter((c) => c.clubId === clubId) ?? [];

  return (
    <Screen edges={[]} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: 'Challenges' }} />
      {error ? <Notice>{error}</Notice> : null}
      {can('challenges.manage') && !open && <Button title="New challenge" onPress={() => setOpen(true)} />}
      {open && (
        <Card>
          <TextField label="Title" value={f.title} onChangeText={(t) => set('title', t)} placeholder="100 km in November" />
          <Chips label="Measure" value={f.metric} options={(Object.keys(METRICS) as Metric[]).map((k) => ({ key: k, label: METRICS[k] }))} onChange={(m) => set('metric', m)} />
          <TextField label="Goal (empty = ranking only)" value={f.target} keyboardType="decimal-pad" onChangeText={(t) => set('target', t)} />
          <TextField label="Daily distance cap (km)" value={f.capKm} keyboardType="decimal-pad" hint="Safety: distance above this per day doesn’t count" onChangeText={(t) => set('capKm', t)} />
          <DateTimeField label="Starts" value={f.start} onChange={(d) => set('start', d)} />
          <DateTimeField label="Ends" value={f.end} minimumDate={f.start} onChange={(d) => set('end', d)} />
          <Text className="mb-1.5 text-sm font-medium text-ink">Counts</Text>
          <Toggle label="Walks" value={f.walk} onChange={(b) => set('walk', b)} />
          <Toggle label="Runs" value={f.run} onChange={(b) => set('run', b)} />
          <Toggle label="Hikes" value={f.hike} onChange={(b) => set('hike', b)} />
          <Chips label="Who can join" value={f.visibility} options={[{ key: 'MEMBERS', label: 'Members only' }, { key: 'PUBLIC', label: 'Public' }]} onChange={(v) => set('visibility', v)} />
          <TextField label="Reward (optional)" value={f.reward} onChangeText={(t) => set('reward', t)} placeholder="Certificate and a shout-out" />
          <TextField label="Description & rules" value={f.description} multiline onChangeText={(t) => set('description', t)} style={{ minHeight: 90, textAlignVertical: 'top' }} />
          <View className="flex-row gap-2">
            <Button title="Launch" className="flex-1" loading={create.isPending} disabled={f.title.trim().length < 3 || !(f.walk || f.run || f.hike)} onPress={() => create.mutate()} />
            <Button title="Close" variant="ghost" className="flex-1" onPress={() => setOpen(false)} />
          </View>
        </Card>
      )}
      <SectionTitle>Club challenges</SectionTitle>
      {list.isLoading ? (
        <Loading />
      ) : !items.length ? (
        <EmptyState title="No active challenges" body="Challenges keep members motivated between group walks." />
      ) : (
        <View className="gap-3">
          {items.map((c) => (
            <Card key={c.id}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-semibold text-ink">{c.title}</Text>
                <Badge label={`${c._count?.participants ?? 0} joined`} />
              </View>
              <Text className="mt-1 text-sm text-ink-muted">
                {METRICS[c.metric as Metric] ?? c.metric} · ends {new Date(c.endsAt).toLocaleDateString()}
              </Text>
              {can('challenges.manage') && <Button title="Cancel challenge" variant="outline" className="mt-3 min-h-[40px]" onPress={() => confirm('Cancel challenge', `Cancel “${c.title}”? Participants keep their activities.`, () => cancel.mutate(c.id), 'Cancel challenge')} />}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
