import { Image, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PostCard } from '@/components/post-card';
import { Avatar, Badge, Button, Card, ErrorState, Loading } from '@/components/ui';
import { Screen } from '@/components/screen';
import { useLike } from '@/hooks/use-like';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { initials } from '@/utils/format';
import { km } from '@/utils/units';

interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  location?: string | null;
  isPrivate: boolean;
  followers: number;
  following: number;
  viewerFollows: string | null;
  stats?: { totalActivities: number; walkingDistanceM: number; runningDistanceM: number } | null;
  clubs?: { id: string; name: string; slug: string }[];
}

export default function UserProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const me = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const like = useLike();
  const q = useQuery({ queryKey: ['profile', username], queryFn: () => api.users.profile(username) as Promise<unknown> as Promise<Profile> });
  const posts = useQuery({ queryKey: ['user-posts', q.data?.id], queryFn: () => api.social.userPosts(q.data!.id), enabled: !!q.data && (!q.data.isPrivate || q.data.id === me?.id) });
  const follow = useMutation({
    mutationFn: async () => (q.data!.viewerFollows ? api.social.unfollow(q.data!.id) : api.social.follow(q.data!.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', username] }),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorState message={errorMessage(q.error, 'User not found')} />;
  const p = q.data;
  const isMe = p.id === me?.id;
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: `@${p.username}` }} />
      <View className="items-center">
        {p.avatarUrl ? <Image source={{ uri: p.avatarUrl }} className="h-20 w-20 rounded-full" accessibilityIgnoresInvertColors /> : <Avatar label={initials(p.displayName)} size={80} />}
        <Text accessibilityRole="header" className="mt-3 text-2xl font-extrabold text-ink">
          {p.displayName}
        </Text>
        <Text className="text-ink-muted">
          {p.followers} followers · {p.following} following
        </Text>
        {p.bio ? <Text className="mt-2 text-center text-ink-muted">{p.bio}</Text> : null}
      </View>
      {!isMe && (
        <View className="mt-4 flex-row gap-2">
          <Button
            className="flex-1"
            title={p.viewerFollows === 'ACCEPTED' ? 'Following' : p.viewerFollows === 'PENDING' ? 'Requested' : 'Follow'}
            variant={p.viewerFollows ? 'outline' : 'primary'}
            loading={follow.isPending}
            onPress={() => follow.mutate()}
          />
          <Button
            className="flex-1"
            title="Message"
            variant="secondary"
            onPress={async () => {
              const c = await api.messaging.direct(p.id);
              router.push({ pathname: '/messages/[id]', params: { id: c.id } });
            }}
          />
        </View>
      )}
      {p.isPrivate && !isMe ? (
        <Card className="mt-6">
          <Text className="text-center text-ink-muted">This account is private. Follow to see their activities and posts.</Text>
        </Card>
      ) : (
        <>
          {p.stats && (
            <Card className="mt-6 flex-row justify-around">
              <View className="items-center">
                <Text className="text-xl font-bold text-ink">{p.stats.totalActivities}</Text>
                <Text className="text-xs text-ink-muted">Activities</Text>
              </View>
              <View className="items-center">
                <Text className="text-xl font-bold text-ink">{km(p.stats.walkingDistanceM)}</Text>
                <Text className="text-xs text-ink-muted">Walked km</Text>
              </View>
              <View className="items-center">
                <Text className="text-xl font-bold text-ink">{km(p.stats.runningDistanceM)}</Text>
                <Text className="text-xs text-ink-muted">Ran km</Text>
              </View>
            </Card>
          )}
          {!!p.clubs?.length && (
            <View className="mt-4 flex-row flex-wrap gap-2">
              {p.clubs.map((c) => (
                <Badge key={c.id} label={c.name} tone="primary" />
              ))}
            </View>
          )}
          <View className="mt-5">{posts.data?.items.map((post) => <PostCard key={post.id} post={post} onLike={like} />)}</View>
        </>
      )}
    </Screen>
  );
}
