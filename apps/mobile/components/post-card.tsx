import { Image, Linking, Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { PostDto } from '@walktogether/api-client';
import { initials } from '@/utils/format';
import { formatDuration, formatPace, km, typeLabel } from '@/utils/units';
import { Avatar } from './ui';

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString();
}

export function PostCard({ post, onLike }: { post: PostDto; onLike: (p: PostDto) => void }) {
  const img = post.media.find((m) => m.kind === 'IMAGE');
  const video = post.media.find((m) => m.kind === 'VIDEO' && m.urls.poster && m.urls.video);
  return (
    <View className="mb-3 rounded-3xl border border-line bg-surface p-4">
      <Link href={{ pathname: '/users/[username]', params: { username: post.author.username } }} asChild>
        <Pressable accessibilityRole="link" className="flex-row items-center gap-3">
          {post.author.avatarUrl ? <Image source={{ uri: post.author.avatarUrl }} className="h-10 w-10 rounded-full" accessibilityIgnoresInvertColors /> : <Avatar label={initials(post.author.displayName)} size={40} />}
          <View className="flex-1">
            <Text className="font-bold text-ink">{post.author.displayName}</Text>
            <Text className="text-xs text-ink-muted">
              {timeAgo(post.createdAt)}
              {post.club ? ` · ${post.club.name}` : ''}
            </Text>
          </View>
        </Pressable>
      </Link>
      <Link href={{ pathname: '/posts/[id]', params: { id: post.id } }} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel="Open post">
          {post.activity && (
            <View className="mt-3 rounded-2xl bg-primary-soft p-3">
              <Text className="font-semibold text-primary">{post.activity.title ?? typeLabel(post.activity.type)}</Text>
              <Text className="mt-1 text-ink">
                {km(post.activity.distanceM)} km · {formatDuration(post.activity.movingSeconds)} · {formatPace(post.activity.avgPaceSecPerKm)} /km
              </Text>
            </View>
          )}
          {post.body ? <Text className="mt-3 text-base text-ink">{post.body}</Text> : null}
          {!img && video && (
            <Pressable
              onPress={() => void Linking.openURL(video.urls.video!)}
              accessibilityRole="button"
              accessibilityLabel="Play video"
              className="mt-3 w-full overflow-hidden rounded-2xl"
            >
              <Image source={{ uri: video.urls.poster }} className="w-full" style={{ aspectRatio: video.width && video.height ? video.width / video.height : 16 / 9 }} accessibilityIgnoresInvertColors />
              <View className="absolute inset-0 items-center justify-center">
                <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
                  <Text className="text-2xl text-white">▶</Text>
                </View>
              </View>
            </Pressable>
          )}
          {img?.urls.medium && <Image source={{ uri: img.urls.medium }} className="mt-3 w-full rounded-2xl" style={{ aspectRatio: img.width && img.height ? img.width / img.height : 4 / 3 }} accessibilityLabel="Post photo" />}
        </Pressable>
      </Link>
      <View className="mt-3 flex-row gap-6">
        <Pressable accessibilityRole="button" accessibilityLabel={post.likedByMe ? 'Unlike' : 'Like'} accessibilityState={{ selected: post.likedByMe }} onPress={() => onLike(post)} hitSlop={10}>
          <Text className={`font-semibold ${post.likedByMe ? 'text-accent' : 'text-ink-muted'}`}>
            {post.likedByMe ? '♥' : '♡'} {post.likeCount}
          </Text>
        </Pressable>
        <Link href={{ pathname: '/posts/[id]', params: { id: post.id } }} className="font-semibold text-ink-muted">
          💬 {post.commentCount}
        </Link>
      </View>
    </View>
  );
}
