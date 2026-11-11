import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { EventCard } from '@/components/event-card';
import { ClubCard } from '@/components/club-card';
import { Badge, EmptyState, ErrorState, Loading, TextField } from '@/components/ui';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function Explore() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const clubs = useInfiniteQuery({
    queryKey: ['clubs', search],
    queryFn: ({ pageParam }) => api.clubs.list({ q: search || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  const items = clubs.data?.pages.flatMap((p) => p.items) ?? [];
  const events = useQuery({ queryKey: ['public-events'], queryFn: () => api.events.discover({ limit: 5 }) });
  const sponsored = useQuery({ queryKey: ['sponsored'], queryFn: () => api.sponsorships.active() });

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-surface-muted">
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerClassName="px-5 pb-10 pt-4"
        renderItem={({ item }) => <ClubCard club={item} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => clubs.hasNextPage && !clubs.isFetchingNextPage && void clubs.fetchNextPage()}
        refreshing={clubs.isRefetching}
        onRefresh={() => void clubs.refetch()}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text accessibilityRole="header" className="mb-4 text-3xl font-extrabold text-ink">
              Explore clubs
            </Text>
            {!!sponsored.data?.length && (
              <View className="mb-4">
                {sponsored.data.map((sp) => (
                  <Link key={sp.id} href={sp.challenge ? { pathname: '/challenges/[id]', params: { id: sp.challenge.id } } : sp.events[0] ? { pathname: '/events/[id]', params: { id: sp.events[0].id } } : '/challenges'} asChild>
                    <Pressable accessibilityRole="link" className="mb-2 rounded-3xl border border-orange-200 bg-orange-50 p-4">
                      <Badge label={`${sp.label} · ${sp.sponsor.name}`} tone="warning" />
                      <Text className="mt-2 font-bold text-ink">{sp.challenge?.title ?? sp.name}</Text>
                      {sp.prizeDescription ? <Text className="text-sm text-ink-muted">🎁 {sp.prizeDescription}</Text> : null}
                    </Pressable>
                  </Link>
                ))}
              </View>
            )}
            {!!events.data?.items.length && (
              <View className="mb-4">
                <Text accessibilityRole="header" className="mb-3 text-lg font-bold text-ink">
                  Upcoming public events
                </Text>
                {events.data.items.map((e) => (
                  <EventCard key={e.id} e={e} showClub />
                ))}
              </View>
            )}
            <TextField label="Search clubs" placeholder="Club name" returnKeyType="search" value={q} onChangeText={setQ} onSubmitEditing={() => setSearch(q.trim())} />
          </View>
        }
        ListEmptyComponent={
          clubs.isLoading ? <Loading /> : clubs.error ? <ErrorState message={errorMessage(clubs.error)} onRetry={() => void clubs.refetch()} /> : <EmptyState title="No clubs found" body="Try another search, or start a club for your area." />
        }
        ListFooterComponent={clubs.isFetchingNextPage ? <Loading label="Loading more clubs" /> : null}
      />
    </SafeAreaView>
  );
}
