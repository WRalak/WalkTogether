import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@walktogether/api-client';
import { Button, Card, Loading, SectionTitle } from '@/components/ui';
import { NoPermission, Notice, StatTile } from '@/components/admin';
import { Bars } from '@/components/bars';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { shareCsv } from '@/services/files';
import { errorMessage } from '@/utils/errors';

export default function Analytics() {
  const { clubId, club, can } = useAdminClub();
  const [error, setError] = useState<string | null>(null);
  const overview = useQuery({ queryKey: ['club-overview', clubId], queryFn: () => api.reports.overview(clubId), enabled: !!club && can('analytics.view') });
  const growth = useQuery({ queryKey: ['club-growth', clubId], queryFn: () => api.reports.growth(clubId), enabled: !!club && can('analytics.view'), retry: false });
  const exportCsv = useMutation({
    mutationFn: async () => shareCsv(`${club?.slug ?? 'club'}-members.csv`, await api.reports.membersCsv(clubId)),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('analytics.view'))
    return (
      <Screen edges={[]}>
        <NoPermission what="view analytics" />
      </Screen>
    );
  const o = overview.data;
  const upgrade = growth.error instanceof ApiError && growth.error.status === 402;

  return (
    <Screen edges={[]} refreshing={overview.isRefetching} onRefresh={() => void Promise.all([overview.refetch(), growth.refetch()])}>
      <Stack.Screen options={{ title: 'Analytics' }} />
      {error ? <Notice>{error}</Notice> : null}
      {!o ? (
        overview.error ? (
          <Notice>{errorMessage(overview.error)}</Notice>
        ) : (
          <Loading />
        )
      ) : (
        <View className="flex-row flex-wrap gap-3">
          <StatTile label="Active members" value={o.members.active} hint={`${o.members.new30d} new in 30 days`} />
          <StatTile label="Engaged (30d)" value={`${o.members.engagementRate}%`} hint={`${o.members.engaged30d} members`} />
          <StatTile label="Events held (30d)" value={o.events.held30d} hint={`${o.events.upcoming30d} upcoming`} />
          <StatTile label="Attendance rate" value={o.events.attendanceRate != null ? `${o.events.attendanceRate}%` : '—'} hint={`${o.events.attendance30d} check-ins`} />
          <StatTile label="Shared activities" value={o.activities.shared30d} hint="last 30 days" />
          <StatTile label="Challenge entrants" value={o.challenges.participants30d} hint="last 30 days" />
          <StatTile label="Join requests" value={o.members.pending} />
          <StatTile label="Plan" value={o.plan.name ?? 'Free'} hint={o.plan.status.toLowerCase()} />
        </View>
      )}
      <SectionTitle>Trends</SectionTitle>
      <Card>
        {upgrade ? (
          <Text className="text-sm text-ink-muted">Growth trends and top attendees are part of Club Pro. Upgrade from Subscription.</Text>
        ) : growth.data ? (
          <>
            <Bars data={growth.data.newMembers} label="New members per month" />
            <Bars data={growth.data.attendance} label="Check-ins per month" />
            {growth.data.topAttendees.length > 0 && (
              <>
                <Text className="mb-2 text-sm font-semibold text-ink">Most regular attendees</Text>
                {growth.data.topAttendees.map((t) => (
                  <View key={t.userId} className="flex-row justify-between border-b border-line py-2">
                    <Text className="text-ink">{t.displayName ?? t.username ?? 'Member'}</Text>
                    <Text className="text-ink-muted">{t.events} events</Text>
                  </View>
                ))}
              </>
            )}
          </>
        ) : growth.error ? (
          <Notice>{errorMessage(growth.error)}</Notice>
        ) : (
          <Loading />
        )}
      </Card>
      {can('reports.export') && <Button title="Export members (CSV)" variant="outline" className="mt-6" loading={exportCsv.isPending} onPress={() => exportCsv.mutate()} />}
    </Screen>
  );
}
