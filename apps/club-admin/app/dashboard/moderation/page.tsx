'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Spinner } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

export default function ModerationPage() {
  const { clubId, can } = useClub();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'ACTIONED' | 'DISMISSED'>('OPEN');
  const [error, setError] = useState<string | null>(null);
  const reports = useQuery({ queryKey: ['club-reports', clubId, status], queryFn: () => api.moderation.clubReports(clubId, status), enabled: can('community.moderate') });
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: 'DISMISS' | 'HIDE' }) => api.moderation.resolveClubReport(clubId, v.id, v.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['club-reports', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  if (!can('community.moderate')) return <Alert variant="destructive">You don’t have permission to moderate this community.</Alert>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Community moderation</h1>
      <p className="text-sm text-muted-foreground">Reports about posts, comments and messages in your club. Serious issues are also visible to the WalkTogether trust & safety team.</p>
      <div className="flex gap-2">
        {(['OPEN', 'ACTIONED', 'DISMISSED'] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>
            {s.toLowerCase()}
          </Button>
        ))}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {reports.isLoading ? (
        <Spinner />
      ) : !reports.data?.items.length ? (
        <EmptyState title="Nothing to review" />
      ) : (
        reports.data.items.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">{r.reason.toLowerCase()}</Badge>
                <Badge variant="secondary">{r.targetType.toLowerCase()}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  reported by @{r.reporter.username} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.preview && <blockquote className="rounded-md bg-muted p-3 text-sm">{r.preview}</blockquote>}
              {r.details && <p className="text-sm text-muted-foreground">“{r.details}”</p>}
              {status === 'OPEN' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => resolve.mutate({ id: r.id, action: 'HIDE' })}>
                    Hide content
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: r.id, action: 'DISMISS' })}>
                    Dismiss
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
