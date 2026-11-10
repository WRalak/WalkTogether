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
  const name = user?.profile?.displayName?.split(' ')[0] ?? user?.username;

  return (
    <Screen refreshing={clubs.isRefetching} onRefresh={() => void Promise.all([clubs.refetch(), stats.refetch()])}>
      <Text className="text-sm text-ink-muted">{greeting()},</Text>
      <Text accessibilityRole="header" className="text-3xl font-extrabold text-ink">
        {name}
      </Text>

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
              <Text className="mt-1 text-xs text-white/80">{Math.round((stats.data.goals[0].progress ?? 0) * 100)}% of your {stats.data.goals[0].period.toLowerCase()}ly goal</Text>
            </View>
          )}
        </Pressable>
      </Link>

      <SectionTitle
        action={
          <Link href="/(tabs)/explore" className="text-sm font-semibold text-primary">
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
            <Link href="/(tabs)/explore" asChild>
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
