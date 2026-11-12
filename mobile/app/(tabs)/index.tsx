import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { greeting, initials } from '@/utils/format';
import { formatDuration, km } from '@/utils/units';

export default function Home() {
  const user = useAuthStore((s) => s.user);
  const clubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.activities.stats() });
  const myChallenges = useQuery({ queryKey: ['challenges', 'mine'], queryFn: () => api.challenges.list({ mine: true }) });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications.list({ limit: 1 }), refetchInterval: 60_000 });
  const unread = (notes.data?.meta as { unread?: number } | undefined)?.unread ?? 0;
  const name = user?.profile?.displayName?.split(' ')[0] ?? user?.username;

  return (
    <Screen refreshing={clubs.isRefetching} onRefresh={() => void Promise.all([clubs.refetch(), stats.refetch()])}>
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-sm text-ink-muted">{greeting()},</Text>
          <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
            {name}
          </Text>
        </View>
        <Link href="/notifications" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
            className="mt-2 h-11 w-11 items-center justify-center rounded-full bg-surface"
          >
            <Text className="text-lg">🔔</Text>
            {unread > 0 && (
              <View className="absolute -right-0.5 -top-0.5 min-w-[18px] items-center rounded-full bg-accent px-1">
                <Text className="text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </Pressable>
        </Link>
      </View>

      {user && !user.emailVerified && !user.phoneVerified && (
        <Card className="mt-5 border-orange-200 bg-orange-50">
          <Text className="font-semibold text-ink">Verify your email</Text>
          <Text className="mt-1 text-sm text-ink-muted">Check your inbox for a link from WalkTogether. Verification is needed to create a club.</Text>
          <Button title="Resend email" variant="outline" className="mt-3" onPress={() => void api.auth.resendVerification().catch(() => undefined)} />
        </Card>
      )}

      <Link href="/activities" asChild>
        <Pressable accessibilityRole="button" className="mt-5 rounded-3xl bg-primary p-5 active:opacity-90">
          <Text className="text-sm font-semibold uppercase tracking-wider text-white/70">This week</Text>
          {stats.data ? (
            <View className="mt-2 flex-row justify-between">
              <View>
                <Text className="text-3xl font-extrabold text-white">{km(stats.data.thisWeek.distanceM)}</Text>
                <Text className="text-xs text-white/70">km</Text>
              </View>
              <View>
                <Text className="text-3xl font-extrabold text-white">{stats.data.thisWeek.activities}</Text>
                <Text className="text-xs text-white/70">activities</Text>
              </View>
              <View>
                <Text className="text-3xl font-extrabold text-white">{formatDuration(stats.data.thisWeek.movingSeconds)}</Text>
                <Text className="text-xs text-white/70">moving</Text>
              </View>
            </View>
          ) : (
            <Text className="mt-1 text-white">{stats.isLoading ? 'Loading…' : 'Record a walk or run to see your week.'}</Text>
          )}
          {stats.data?.goals[0] && (
            <View className="mt-4">
              <View className="h-2 overflow-hidden rounded-full bg-white/25">
                <View className="h-2 rounded-full bg-accent" style={{ width: `${Math.round((stats.data.goals[0].progress ?? 0) * 100)}%` }} />
              </View>
              <Text className="mt-1 text-xs text-white/80">
                {Math.round((stats.data.goals[0].progress ?? 0) * 100)}% of your {stats.data.goals[0].period.toLowerCase()}ly goal
              </Text>
            </View>
          )}
        </Pressable>
      </Link>

      <Link href="/challenges" asChild>
        <Pressable accessibilityRole="button" className="mt-4 flex-row items-center justify-between rounded-3xl border border-line bg-surface p-4 active:opacity-80">
          <View>
            <Text className="font-bold text-ink">Challenges & leaderboards</Text>
            <Text className="text-sm text-ink-muted">{myChallenges.data?.items.length ? `${myChallenges.data.items.length} in progress` : 'Find a challenge to join'}</Text>
          </View>
          <Text className="text-xl">🏆</Text>
        </Pressable>
      </Link>

      <SectionTitle
        action={
          <Link href="/(tabs)/clubs" className="text-sm font-semibold text-primary">
            Discover
          </Link>
        }
      >
        Your clubs
      </SectionTitle>
      {clubs.isLoading ? (
        <Loading />
      ) : clubs.error ? (
        <ErrorState message={errorMessage(clubs.error)} onRetry={() => void clubs.refetch()} />
      ) : !clubs.data?.length ? (
        <EmptyState
          title="You haven’t joined a club yet"
          body="Clubs organise group walks and runs near you."
          action={
            <Link href="/(tabs)/clubs" asChild>
              <Button title="Find a club" />
            </Link>
          }
        />
      ) : (
        clubs.data.map((c) => (
          <Link key={c.id} href={{ pathname: '/clubs/[slug]', params: { slug: c.slug } }} className="mb-3">
            <View className="w-full flex-row items-center gap-3 rounded-3xl border border-line bg-surface p-4">
              <Avatar label={initials(c.name)} />
              <View className="flex-1">
                <Text numberOfLines={1} className="font-bold text-ink">
                  {c.name}
                </Text>
                <Text className="text-sm text-ink-muted">
                  {c.role} · {c.memberCount} members
                </Text>
              </View>
              {c.membershipStatus === 'PENDING' && <Badge label="Pending" tone="warning" />}
            </View>
          </Link>
        ))
      )}
    </Screen>
  );
}
