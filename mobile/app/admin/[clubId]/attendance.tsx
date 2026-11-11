import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { Chips, NoPermission, StatTile } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const RANGES = { '30': 'Last 30 days', '90': 'Last 90 days', '365': 'Last year' } as const;
type Range = keyof typeof RANGES;

export default function Attendance() {
  const { clubId, club, can } = useAdminClub();
  const [range, setRange] = useState<Range>('90');
  const report = useQuery({
    queryKey: ['attendance-report', clubId, range],
    queryFn: () => api.reports.attendance(clubId, { from: new Date(Date.now() - Number(range) * 86_400_000).toISOString(), to: new Date().toISOString() }),
    enabled: !!club && can('analytics.view'),
  });
  if (!club) return <Loading />;
  if (!can('analytics.view')) return <Screen edges={[]}><NoPermission what="view attendance reports" /></Screen>;
  const rows = report.data ?? [];
  const totals = rows.reduce((a, r) => ({ going: a.going + r.going, attended: a.attended + r.attended }), { going: 0, attended: 0 });

  return (
    <Screen edges={[]} refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <Stack.Screen options={{ title: 'Attendance' }} />
      <Chips value={range} options={(Object.keys(RANGES) as Range[]).map((k) => ({ key: k, label: RANGES[k] }))} onChange={setRange} />
      <View className="flex-row flex-wrap gap-3">
        <StatTile label="Events" value={rows.length} />
        <StatTile label="Check-ins" value={totals.attended} />
        <StatTile label="Attendance rate" value={totals.going ? `${Math.round((totals.attended / totals.going) * 100)}%` : '—'} hint="checked in ÷ going" />
      </View>
      <SectionTitle>Per event</SectionTitle>
      {report.isLoading ? (
        <Loading />
      ) : report.error ? (
        <ErrorState message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
      ) : !rows.length ? (
        <EmptyState title="No events in this period" />
      ) : (
        <View className="gap-2">
          {rows.map((r) => (
            <Link key={r.id} href={{ pathname: '/admin/[clubId]/events/[eventId]', params: { clubId, eventId: r.id } }} asChild>
              <Pressable accessibilityRole="button" className="active:opacity-80">
                <Card className="p-4">
                  <Text className="font-semibold text-ink">{r.title}</Text>
                  <Text className="text-xs text-ink-muted">
                    {new Date(r.startsAt).toLocaleDateString()} · {r.status.toLowerCase()}
                  </Text>
                  <Text className="mt-1 text-sm text-ink">
                    {r.attended} checked in of {r.going} going{r.capacity ? ` (capacity ${r.capacity})` : ''} · {r.rate != null ? `${r.rate}%` : '—'}
                  </Text>
                </Card>
              </Pressable>
            </Link>
          ))}
        </View>
      )}
    </Screen>
  );
}
