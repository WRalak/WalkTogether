import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ClubCard } from '@/components/club-card';
import { EmptyState, ErrorState, Loading, TextField } from '@/components/ui';
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
