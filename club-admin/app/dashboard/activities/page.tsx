'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { activityTypeLabel, formatDuration, formatKm, formatPace } from '@walktogether/shared-utils';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Spinner, Stat, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

export default function ActivitiesPage() {
  const { clubId, can } = useClub();
  const q = useInfiniteQuery({
    queryKey: ['club-activities', clubId],
    queryFn: ({ pageParam }) => api.reports.activities(clubId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled: can('members.view'),
  });
  if (!can('members.view')) return <Alert variant="destructive">You don’t have permission to view club activities.</Alert>;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const week = q.data?.pages[0]?.meta.lastSevenDays;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activities</h1>
        <p className="text-sm text-muted-foreground">Walks and runs members chose to share with the club. Routes stay private to each member.</p>
      </div>
      {week && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Activities (7 days)" value={String(week.activities)} />
          <Stat label="Distance (7 days)" value={`${formatKm(week.distanceM)} km`} />
          <Stat label="Moving time (7 days)" value={formatDuration(week.movingSeconds)} />
        </div>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Alert variant="destructive">{errorMessage(q.error)}</Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No shared activities yet" description="When members finish a walk or run they can share it with the club from the app." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Activity</Th>
                  <Th>Date</Th>
                  <Th>Distance</Th>
                  <Th>Time</Th>
                  <Th>Pace</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <span className="font-medium">{a.athlete.displayName}</span>
                      <span className="block text-xs text-muted-foreground">@{a.athlete.username}</span>
                    </Td>
                    <Td>
                      {a.title ?? activityTypeLabel(a.type)}{' '}
                      {a.flagged && (
                        <Badge variant="warning" title="GPS validation flagged this activity; it does not count toward challenges">
                          Flagged
                        </Badge>
                      )}
                    </Td>
                    <Td>{new Date(a.startedAt).toLocaleDateString()}</Td>
                    <Td>{formatKm(a.distanceM)} km</Td>
                    <Td>{formatDuration(a.movingSeconds)}</Td>
                    <Td>{formatPace(a.avgPaceSecPerKm)} /km</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
