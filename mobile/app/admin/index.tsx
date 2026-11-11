import { Pressable, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Loading } from '@/components/ui';
import { NavRow } from '@/components/admin';
import { Screen } from '@/components/screen';
import { canAdminister } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { initials } from '@/utils/format';

/** Clubs the signed-in user owns or helps run. Members without admin permissions see only "create a club". */
export default function ClubAdminHome() {
  const router = useRouter();
  const clubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const manageable = (clubs.data ?? []).filter((c) => c.membershipStatus === 'ACTIVE' && canAdminister(c.permissions));

  return (
    <Screen edges={[]} refreshing={clubs.isRefetching} onRefresh={() => void clubs.refetch()}>
      <Stack.Screen options={{ title: 'Manage clubs' }} />
      {clubs.isLoading ? (
        <Loading />
      ) : clubs.error ? (
        <ErrorState message={errorMessage(clubs.error)} onRetry={() => void clubs.refetch()} />
      ) : manageable.length === 0 ? (
        <EmptyState title="No clubs to manage yet" body="Create your own club, or ask a club owner to give you an admin, organiser or moderator role." />
      ) : (
        <View className="gap-3">
          {manageable.map((c) => (
            <Link key={c.id} href={{ pathname: '/admin/[clubId]', params: { clubId: c.id } }} asChild>
              <Pressable accessibilityRole="button" className="active:opacity-80">
                <Card className="flex-row items-center gap-4">
                  <Avatar label={initials(c.name)} />
                  <View className="flex-1">
                    <Text className="text-base font-bold text-ink">{c.name}</Text>
                    <Text className="text-sm text-ink-muted">
                      {c.role} · {c.memberCount} members
                    </Text>
                  </View>
                  {c.status !== 'ACTIVE' && <Badge tone="warning" label={c.status.replace('_', ' ').toLowerCase()} />}
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      )}
      <Button title="Create a club" className="mt-6" onPress={() => router.push('/admin/new')} />
      <View className="mt-6">
        <NavRow href="/sponsor" label="Sponsor portal" detail="Organisations: sponsor challenges and events" />
      </View>
    </Screen>
  );
}
