'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Card, CardContent, EmptyState, Select, Spinner } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { StatusAction } from '@/features/status-action';

export default function ModerationQueue() {
  const { can } = useAdminAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-reports', status], queryFn: () => adminApi.reports.list({ status, limit: 50 }), enabled: can('moderation.manage') });
  if (!can('moderation.manage')) return <Alert variant="destructive">You don’t have moderation permissions.</Alert>;
  const act = async (id: string, action: 'DISMISS' | 'HIDE_CONTENT' | 'SUSPEND_USER', note: string) => {
    setError(null);
    try {
      await adminApi.reports.resolve(id, action, note);
      await qc.invalidateQueries({ queryKey: ['admin-reports'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Moderation queue</h1>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="OPEN">Open</option>
          <option value="ACTIONED">Actioned</option>
          <option value="DISMISSED">Dismissed</option>
        </Select>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <EmptyState title="No reports" />
      ) : (
        q.data.items.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">{r.reason}</Badge>
                <Badge variant="secondary">{r.targetType}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{r.targetId}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  @{r.reporter.username} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.preview && <blockquote className="rounded-md bg-muted p-3 text-sm">{r.preview}</blockquote>}
              {r.details && <p className="text-sm text-muted-foreground">“{r.details}”</p>}
              {status === 'OPEN' && (
                <div className="flex flex-wrap gap-2">
                  <StatusAction label="Hide content" variant="destructive" onConfirm={(n) => act(r.id, 'HIDE_CONTENT', n)} />
                  <StatusAction label="Suspend author" variant="destructive" onConfirm={(n) => act(r.id, 'SUSPEND_USER', n)} />
                  <StatusAction label="Dismiss" onConfirm={(n) => act(r.id, 'DISMISS', n)} />
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
