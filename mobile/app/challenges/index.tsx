import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, Loading } from '@/components/ui';
import { api } from '@/services/api';
import { metricValue } from '@/utils/challenge';
import { km } from '@/utils/units';

export default function ChallengesHub() {
  const [tab, setTab] = useState<'discover' | 'mine' | 'boards'>('discover');
  const [period, setPeriod] = useState<'WEEK' | 'MONTH'>('WEEK');
  const list = useQuery({ queryKey: ['challenges', tab], queryFn: () => api.challenges.list({ mine: tab === 'mine' }), enabled: tab !== 'boards' });
  const global = useQuery({ queryKey: ['lb-global', period], queryFn: () => api.leaderboards.get({ period }), enabled: tab === 'boards' });
  const following = useQuery({ queryKey: ['lb-following', period], queryFn: () => api.leaderboards.following(period), enabled: tab === 'boards' });
  return (
    <View className="flex-1 bg-surface-muted">
      <View className="mx-5 my-3 flex-row rounded-2xl bg-surface p-1" accessibilityRole="tablist">
        {(['discover', 'mine', 'boards'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => setTab(t)}
            className={`flex-1 items-center rounded-xl py-2.5 ${tab === t ? 'bg-primary' : ''}`}
          >
            <Text className={`font-semibold ${tab === t ? 'text-white' : 'text-ink-muted'}`}>{t === 'discover' ? 'Discover' : t === 'mine' ? 'Joined' : 'Leaderboards'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'boards' ? (
        <FlatList
          data={[
            { key: 'following', title: 'You & people you follow', q: following },
            { key: 'global', title: 'Everyone (public profiles)', q: global },
          ]}
          keyExtractor={(x) => x.key}
          contentContainerClassName="px-5 pb-10"
          ListHeaderComponent={
            <View className="mb-3 flex-row gap-2">
              {(['WEEK', 'MONTH'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: period === p }}
                  className={`rounded-full border px-4 py-1.5 ${period === p ? 'border-primary bg-primary-soft' : 'border-line'}`}
                >
                  <Text className={period === p ? 'font-semibold text-primary' : 'text-ink-muted'}>This {p.toLowerCase()}</Text>
                </Pressable>
              ))}
            </View>
          }
          renderItem={({ item }) => (
            <View className="mb-4 rounded-3xl border border-line bg-surface p-4">
              <Text className="mb-2 font-bold text-ink">{item.title}</Text>
              {item.q.isLoading ? (
                <Loading />
              ) : !item.q.data?.entries.length ? (
                <Text className="text-ink-muted">No distance logged yet this {period.toLowerCase()}.</Text>
              ) : (
                item.q.data.entries.slice(0, 20).map((e) => (
                  <View key={`${e.rank}-${e.user?.id}`} className={`flex-row items-center py-1.5 ${e.isMe ? 'rounded-lg bg-primary-soft px-2' : ''}`}>
                    <Text className="w-8 font-bold text-ink-muted">{e.rank}</Text>
                    <Text className="flex-1 text-ink">{e.user?.displayName ?? 'Private participant'}</Text>
                    <Text className="font-semibold text-ink">{km(e.valueM)} km</Text>
                  </View>
                ))
              )}
            </View>
          )}
          ListFooterComponent={
            <Text className="text-center text-xs text-ink-muted">Daily distance is capped and unusual activities are excluded, so leaderboards reward consistency, not risk.</Text>
          }
        />
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(c) => c.id}
          contentContainerClassName="px-5 pb-10"
          renderItem={({ item: c }) => (
            <Link href={{ pathname: '/challenges/[id]', params: { id: c.id } }} asChild>
              <Pressable accessibilityRole="link" className="mb-3 rounded-3xl border border-line bg-surface p-4 active:opacity-80">
                <View className="flex-row flex-wrap gap-2">
                  {c.isSponsored && <Badge label={`Sponsored · ${c.sponsorName ?? ''}`} tone="warning" />}
                  {c.isPremium && <Badge label="Premium" tone="primary" />}
                  {c.club && <Badge label={c.club.name} />}
                  {c.scope === 'CLUB_VS_CLUB' && <Badge label="Club vs club" />}
                </View>
                <Text className="mt-2 text-lg font-bold text-ink">{c.title}</Text>
                <Text className="text-sm text-ink-muted">
                  {c.target ? `Goal: ${metricValue(c.metric, c.target)} · ` : ''}ends {new Date(c.endsAt).toLocaleDateString()} · {c._count?.participants ?? 0} joined
                </Text>
              </Pressable>
            </Link>
          )}
          ListEmptyComponent={list.isLoading ? <Loading /> : <EmptyState title={tab === 'mine' ? 'You haven’t joined a challenge yet' : 'No open challenges right now'} />}
        />
      )}
    </View>
  );
}
