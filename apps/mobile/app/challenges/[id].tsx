import { useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { metricValue } from '@/utils/challenge';
import { errorMessage } from '@/utils/errors';

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['challenge', id], queryFn: () => api.challenges.get(id) });
  const lb = useQuery({ queryKey: ['challenge-lb', id], queryFn: () => api.challenges.leaderboard(id) });
  const myClubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const [hidden, setHidden] = useState(false);
  const [team, setTeam] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['challenge', id] }), qc.invalidateQueries({ queryKey: ['challenge-lb', id] })]);
  const join = useMutation({ mutationFn: () => api.challenges.join(id, { hideFromLeaderboard: hidden, teamClubId: team ?? undefined, acceptTerms: consent || undefined }), onSuccess: refresh, onError: (e) => Alert.alert('Could not join', errorMessage(e)) });
  const leave = useMutation({ mutationFn: () => api.challenges.leave(id), onSuccess: refresh, onError: (e) => Alert.alert('Could not leave', errorMessage(e)) });
  if (c.isLoading) return <Loading />;
  if (!c.data) return <ErrorState message={errorMessage(c.error, 'Challenge not found')} />;
  const ch = c.data;
  const myTeams = (ch.teams ?? []).filter((t) => myClubs.data?.some((m) => m.id === t.clubId && m.membershipStatus === 'ACTIVE'));
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: ch.title }} />
      <View className="flex-row flex-wrap gap-2">
        {ch.isSponsored && <Badge label={`Sponsored by ${ch.sponsorName}`} tone="warning" />}
        {ch.isPremium && <Badge label="Premium" tone="primary" />}
      </View>
      <Text accessibilityRole="header" className="mt-2 text-2xl font-extrabold text-ink">
        {ch.title}
      </Text>
      <Text className="text-ink-muted">
        {new Date(ch.startsAt).toLocaleDateString()} – {new Date(ch.endsAt).toLocaleDateString()} · {ch.participants} joined
      </Text>
      {ch.description ? <Text className="mt-3 text-ink">{ch.description}</Text> : null}
      {ch.me ? (
        <Card className="mt-4">
          <Text className="font-semibold text-ink">Your progress</Text>
          <Text className="mt-1 text-3xl font-extrabold text-ink">{metricValue(ch.metric, ch.me.progressValue)}</Text>
          {ch.target != null && (
            <View className="mt-3 h-3 overflow-hidden rounded-full bg-primary-soft" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((ch.me.progress ?? 0) * 100) }}>
              <View className="h-3 rounded-full bg-primary" style={{ width: `${Math.round((ch.me.progress ?? 0) * 100)}%` }} />
            </View>
          )}
          {ch.me.completedAt && <Text className="mt-2 font-semibold text-success">Completed 🎉</Text>}
          {!ch.me.completedAt && ch.status === 'ACTIVE' && <Button title="Leave challenge" variant="ghost" onPress={() => leave.mutate()} />}
        </Card>
      ) : ch.status === 'ACTIVE' ? (
        <Card className="mt-4">
          {ch.scope === 'CLUB_VS_CLUB' && (
            <View className="mb-3">
              <Text className="mb-2 font-semibold text-ink">Represent your club</Text>
              {myTeams.length ? (
                myTeams.map((t) => (
                  <Pressable key={t.clubId} accessibilityRole="radio" accessibilityState={{ selected: team === t.clubId }} onPress={() => setTeam(t.clubId)} className={`mb-2 rounded-xl border p-3 ${team === t.clubId ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                    <Text className="text-ink">{t.club.name}</Text>
                  </Pressable>
                ))
              ) : (
                <Text className="text-ink-muted">Join one of the competing clubs to take part.</Text>
              )}
            </View>
          )}
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="flex-1 text-ink">Hide my name on the leaderboard</Text>
            <Switch accessibilityLabel="Hide my name on the leaderboard" value={hidden} onValueChange={setHidden} trackColor={{ true: '#127a50' }} />
          </View>
          {ch.isSponsored && (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => setConsent((v) => !v)} className="mb-3 flex-row items-start gap-3">
              <View className={`mt-0.5 h-6 w-6 items-center justify-center rounded-md border-2 ${consent ? 'border-primary bg-primary' : 'border-line'}`}>{consent && <Text className="font-bold text-white">✓</Text>}</View>
              <Text className="flex-1 text-sm text-ink-muted">I accept {ch.sponsorName}’s competition terms below. My personal data is not shared with the sponsor.</Text>
            </Pressable>
          )}
          <Button title="Join challenge" loading={join.isPending} disabled={(ch.scope === 'CLUB_VS_CLUB' && !team) || (ch.isSponsored && !consent)} onPress={() => join.mutate()} />
        </Card>
      ) : null}
      {(ch.rules || ch.rewardDescription) && (
        <Card className="mt-4">
          {ch.rewardDescription ? <Text className="text-ink">🎁 {ch.rewardDescription}</Text> : null}
          {ch.rules ? <Text className="mt-2 text-sm text-ink-muted">{ch.rules}</Text> : null}
          <Text className="mt-2 text-xs text-ink-muted">Distance counted per day is capped at {(ch.maxDailyDistanceM / 1000).toFixed(1)} km. Unusual GPS tracks don’t count.</Text>
        </Card>
      )}
      {!!lb.data?.teams.length && (
        <>
          <SectionTitle>Clubs</SectionTitle>
          <Card>
            {lb.data.teams.map((t) => (
              <View key={t.clubId} className="flex-row py-1.5">
                <Text className="w-8 font-bold text-ink-muted">{t.rank}</Text>
                <Text className="flex-1 text-ink">{t.name}</Text>
                <Text className="text-ink-muted">avg {metricValue(ch.metric, t.average)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>Leaderboard</SectionTitle>
      <Card>
        {lb.data?.entries.length ? (
          lb.data.entries.map((e) => (
            <View key={e.rank} className={`flex-row items-center py-1.5 ${e.isMe ? 'rounded-lg bg-primary-soft px-2' : ''}`}>
              <Text className="w-8 font-bold text-ink-muted">{e.rank}</Text>
              <Text className="flex-1 text-ink">{e.user?.displayName ?? 'Private participant'}</Text>
              <Text className="font-semibold text-ink">{metricValue(ch.metric, e.value)}</Text>
            </View>
          ))
        ) : (
          <Text className="text-ink-muted">Be the first to log progress.</Text>
        )}
      </Card>
    </Screen>
  );
}
