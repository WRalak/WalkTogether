import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { greeting, initials } from '@/utils/format';

export default function Home() {
  const user = useAuthStore((s) => s.user);
  const clubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const name = user?.profile?.displayName?.split(' ')[0] ?? user?.username;

  return (
    <Screen refreshing={clubs.isRefetching} onRefresh={() => void clubs.refetch()}>
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

      <Card className="mt-5 bg-primary">
        <Text className="text-sm font-semibold uppercase tracking-wider text-white/70">This week</Text>
        <Text className="mt-1 text-white">Your weekly distance, time and streaks will appear here once GPS recording launches.</Text>
      </Card>

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
