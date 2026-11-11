import { useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { PostCard, timeAgo } from '@/components/post-card';
import { Button, ErrorState, Loading } from '@/components/ui';
import { useLike } from '@/hooks/use-like';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const like = useLike();
  const post = useQuery({ queryKey: ['post', id], queryFn: () => api.social.post(id) });
  const comments = useInfiniteQuery({
    queryKey: ['comments', id],
    queryFn: ({ pageParam }) => api.social.comments(id, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.meta.nextCursor ?? undefined,
  });
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [sending, setSending] = useState(false);
  if (post.isLoading) return <Loading />;
  if (!post.data) return <ErrorState message={errorMessage(post.error, 'Post not found')} />;
  const items = comments.data?.pages.flatMap((p) => p.items) ?? [];
  const report = () =>
    Alert.alert('Report this post?', 'Our moderators will review it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Spam', onPress: () => void api.social.report({ targetType: 'POST', targetId: id, reason: 'SPAM' }).catch(() => undefined) },
      { text: 'Harassment or abuse', onPress: () => void api.social.report({ targetType: 'POST', targetId: id, reason: 'HARASSMENT' }).catch(() => undefined) },
    ]);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-surface-muted" keyboardVerticalOffset={90}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerClassName="px-5 pb-6 pt-4"
        ListHeaderComponent={
          <View>
            <PostCard post={post.data} onLike={like} />
            <Pressable onPress={report} accessibilityRole="button" className="mb-3 self-end">
              <Text className="text-xs text-ink-muted">Report</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item: c }) => (
          <View className={`mb-2 rounded-2xl bg-surface p-3 ${c.parentId ? 'ml-8' : ''}`}>
            <Text className="font-semibold text-ink">
              {c.author.profile?.displayName ?? c.author.username} <Text className="text-xs font-normal text-ink-muted">· {timeAgo(c.createdAt)}</Text>
            </Text>
            <Text className="mt-1 text-ink">{c.body}</Text>
            <Pressable accessibilityRole="button" onPress={() => setReplyTo({ id: c.id, username: c.author.username })}>
              <Text className="mt-1 text-xs font-semibold text-primary">Reply</Text>
            </Pressable>
          </View>
        )}
        onEndReached={() => comments.hasNextPage && void comments.fetchNextPage()}
      />
      <View className="flex-row items-end gap-2 border-t border-line bg-surface px-4 py-3">
        <TextInput
          accessibilityLabel="Write a comment"
          placeholder={replyTo ? `Reply to @${replyTo.username}` : 'Add a comment…'}
          placeholderTextColor="#8a9a93"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={2000}
          className="max-h-28 flex-1 rounded-2xl border border-line px-3 py-2 text-ink"
        />
        <Button
          title="Send"
          className="min-h-[44px] px-4"
          disabled={!text.trim()}
          loading={sending}
          onPress={async () => {
            setSending(true);
            try {
              await api.social.comment(id, text.trim(), replyTo?.id);
              setText('');
              setReplyTo(null);
              void comments.refetch();
              void qc.invalidateQueries({ queryKey: ['post', id] });
            } catch (e) {
              Alert.alert('Could not comment', errorMessage(e));
            } finally {
              setSending(false);
            }
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
