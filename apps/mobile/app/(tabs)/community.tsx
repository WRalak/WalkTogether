import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { PostCard, timeAgo } from '@/components/post-card';
import { Avatar, Button, EmptyState, ErrorState, Loading } from '@/components/ui';
import { useLike } from '@/hooks/use-like';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { initials } from '@/utils/format';

function Feed() {
  const like = useLike();
  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => api.social.feed({ cursor: pageParam, limit: 15 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerClassName="px-5 pb-24"
      renderItem={({ item }) => <PostCard post={item} onLike={like} />}
      refreshing={feed.isRefetching}
      onRefresh={() => void feed.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
      ListEmptyComponent={
        feed.isLoading ? (
          <Loading />
        ) : feed.error ? (
          <ErrorState message={errorMessage(feed.error)} onRetry={() => void feed.refetch()} />
        ) : (
          <EmptyState title="Your feed is quiet" body="Follow people, join clubs, or share your first walk." />
        )
      }
    />
  );
}

function Messages() {
  const me = useAuthStore((s) => s.user);
  const q = useQuery({ queryKey: ['conversations'], queryFn: () => api.messaging.list(), refetchInterval: 30_000 });
  return (
    <FlatList
      data={q.data ?? []}
      keyExtractor={(c) => c.id}
      contentContainerClassName="px-5 pb-24"
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      renderItem={({ item: c }) => {
        const other = c.members.find((m) => m.id !== me?.id);
        const title = c.kind === 'DIRECT' ? (other?.profile?.displayName ?? other?.username ?? 'Conversation') : (c.title ?? 'Group');
        return (
          <Link href={{ pathname: '/messages/[id]', params: { id: c.id } }} asChild>
            <Pressable accessibilityRole="link" className="mb-2 flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-3 active:opacity-80">
              <Avatar label={initials(title)} size={44} />
              <View className="flex-1">
                <Text className={`text-ink ${c.unread ? 'font-extrabold' : 'font-semibold'}`}>{title}</Text>
                <Text numberOfLines={1} className="text-sm text-ink-muted">
                  {c.lastMessage?.body ?? 'No messages yet'}
                </Text>
              </View>
              {c.lastMessageAt && <Text className="text-xs text-ink-muted">{timeAgo(c.lastMessageAt)}</Text>}
              {c.unread && <View className="h-2.5 w-2.5 rounded-full bg-accent" accessibilityLabel="Unread" />}
            </Pressable>
          </Link>
        );
      }}
      ListEmptyComponent={q.isLoading ? <Loading /> : <EmptyState title="No conversations yet" body="Message someone from their profile, or open your club’s group chat." />}
    />
  );
}

export default function Community() {
  const [tab, setTab] = useState<'feed' | 'messages'>('feed');
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-surface-muted">
      <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
        <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
          Community
        </Text>
        <Link href="/posts/new" asChild>
          <Button title="Post" className="min-h-[40px] px-4" />
        </Link>
      </View>
      <View className="mx-5 mb-3 flex-row rounded-2xl bg-surface p-1" accessibilityRole="tablist">
        {(['feed', 'messages'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} className={`flex-1 items-center rounded-xl py-2.5 ${tab === t ? 'bg-primary' : ''}`}>
            <Text className={`font-semibold ${tab === t ? 'text-white' : 'text-ink-muted'}`}>{t === 'feed' ? 'Feed' : 'Messages'}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'feed' ? <Feed /> : <Messages />}
    </SafeAreaView>
  );
}
