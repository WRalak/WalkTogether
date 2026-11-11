import { useEffect } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppNotification } from '@walktogether/api-client';
import { timeAgo } from '@/components/post-card';
import { Button, EmptyState, Loading } from '@/components/ui';
import { api } from '@/services/api';

function target(n: AppNotification): { pathname: string; params: Record<string, string> } | null {
  const d = n.data as Record<string, string>;
  if (d.postId) return { pathname: '/posts/[id]', params: { id: d.postId } };
  if (d.eventId) return { pathname: '/events/[id]', params: { id: d.eventId } };
  if (d.slug) return { pathname: '/clubs/[slug]', params: { slug: d.slug } };
  if (d.username) return { pathname: '/users/[username]', params: { username: d.username } };
  if (d.challengeId) return { pathname: '/challenges/[id]', params: { id: d.challengeId } };
  return null;
}

export default function Notifications() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications.list({ limit: 50 }) });
  const readAll = useMutation({ mutationFn: () => api.notifications.readAll(), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const requests = useQuery({ queryKey: ['follow-requests'], queryFn: () => api.social.followRequests() });
  useEffect(() => () => void qc.invalidateQueries({ queryKey: ['notifications'] }), [qc]);
  if (q.isLoading) return <Loading />;
  return (
    <FlatList
      className="bg-surface-muted"
      contentContainerClassName="px-5 py-4"
      data={q.data?.data ?? []}
      keyExtractor={(n) => n.id}
      ListHeaderComponent={
        <View>
          {!!requests.data?.length && (
            <View className="mb-4 rounded-3xl border border-line bg-surface p-4">
              <Text className="mb-2 font-bold text-ink">Follow requests</Text>
              {requests.data.map((r) => (
                <View key={r.id} className="mb-2 flex-row items-center gap-2">
                  <Text className="flex-1 text-ink">{r.profile?.displayName ?? r.username}</Text>
                  <Button title="Accept" className="min-h-[36px] px-3" onPress={() => void api.social.respond(r.id, true).then(() => requests.refetch())} />
                  <Button title="Decline" variant="outline" className="min-h-[36px] px-3" onPress={() => void api.social.respond(r.id, false).then(() => requests.refetch())} />
                </View>
              ))}
            </View>
          )}
          <Button title="Mark all as read" variant="ghost" onPress={() => readAll.mutate()} />
        </View>
      }
      renderItem={({ item: n }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void api.notifications.read(n.id).catch(() => undefined);
            const t = target(n);
            if (t) router.push(t as never);
          }}
          className={`mb-2 rounded-2xl p-4 ${n.readAt ? 'bg-surface' : 'border border-primary/30 bg-primary-soft'}`}
        >
          <Text className="font-semibold text-ink">{n.title}</Text>
          <Text className="mt-0.5 text-ink-muted">{n.body}</Text>
          <Text className="mt-1 text-xs text-ink-muted">{timeAgo(n.createdAt)}</Text>
        </Pressable>
      )}
      ListEmptyComponent={<EmptyState title="You’re all caught up" />}
    />
  );
}
