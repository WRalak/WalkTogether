'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@walktogether/api-client';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, Spinner, Textarea } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

const METRICS = { DISTANCE_M: 'Distance (km)', ACTIVITIES: 'Number of activities', MOVING_SECONDS: 'Moving time (hours)', ACTIVE_DAYS: 'Active days (consistency)' } as const;

export default function ClubChallengesPage() {
  const { clubId, can } = useClub();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['club-challenges', clubId], queryFn: () => api.challenges.list({}) });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ title: '', description: '', metric: 'DISTANCE_M' as keyof typeof METRICS, target: '50', start: today, end: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), walk: true, run: true, hike: false, visibility: 'MEMBERS', reward: '', capKm: '42' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const toTarget = () => {
    const n = Number(f.target);
    if (!n) return null;
    return f.metric === 'DISTANCE_M' ? Math.round(n * 1000) : f.metric === 'MOVING_SECONDS' ? Math.round(n * 3600) : Math.round(n);
  };
  const create = useMutation({
    mutationFn: () =>
      api.challenges.createForClub(clubId, {
        title: f.title,
        description: f.description || null,
        metric: f.metric,
        target: toTarget(),
        activityTypes: [f.walk && 'WALK', f.run && 'RUN', f.hike && 'HIKE'].filter(Boolean) as ('WALK' | 'RUN' | 'HIKE')[],
        startsAt: new Date(f.start).toISOString(),
        endsAt: new Date(`${f.end}T23:59:59`).toISOString(),
        visibility: f.visibility as 'MEMBERS',
        rewardDescription: f.reward || null,
        maxDailyDistanceM: Math.round(Number(f.capKm) * 1000),
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['club-challenges', clubId] });
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 402 ? 'Club challenges are part of Club Pro. Upgrade from the Billing page.' : errorMessage(e)),
  });
  const items = list.data?.items.filter((c) => c.clubId === clubId) ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Challenges</h1>
        {can('challenges.manage') && <Button onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'New challenge'}</Button>}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {open && (
        <Card>
          <CardContent className="grid gap-4 p-6 md:grid-cols-2">
            <Field id="c-title" label="Title">
              <Input value={f.title} onChange={set('title')} />
            </Field>
            <Field id="c-metric" label="Measure">
              <Select value={f.metric} onChange={set('metric')}>
                {Object.entries(METRICS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="c-target" label="Goal (leave empty for a ranking-only competition)">
              <Input type="number" min={1} value={f.target} onChange={set('target')} />
            </Field>
            <Field id="c-cap" label="Daily distance cap (km)" hint="Safety: distance above this per day is not counted">
              <Input type="number" min={1} max={100} value={f.capKm} onChange={set('capKm')} />
            </Field>
            <Field id="c-start" label="Starts">
              <Input type="date" value={f.start} onChange={set('start')} />
            </Field>
            <Field id="c-end" label="Ends">
              <Input type="date" value={f.end} onChange={set('end')} />
            </Field>
            <fieldset className="flex gap-4 text-sm">
              <legend className="mb-1 text-sm font-medium">Counts</legend>
              {(['walk', 'run', 'hike'] as const).map((k) => (
                <label key={k} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" checked={f[k]} onChange={set(k)} /> {k}
                </label>
              ))}
            </fieldset>
            <Field id="c-vis" label="Visibility">
              <Select value={f.visibility} onChange={set('visibility')}>
                <option value="MEMBERS">Members only</option>
                <option value="PUBLIC">Public</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field id="c-reward" label="Reward (optional)">
                <Input value={f.reward} onChange={set('reward')} placeholder="Certificate and shout-out at the next walk" />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field id="c-desc" label="Description & rules">
                <Textarea rows={3} value={f.description} onChange={set('description')} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Button loading={create.isPending} disabled={f.title.length < 3} onClick={() => create.mutate()}>
                Launch challenge
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {list.isLoading ? (
        <Spinner />
      ) : !items.length ? (
        <EmptyState title="No active challenges" description="Challenges keep members motivated between group walks." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-1 p-5">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{c.title}</p>
                  <Badge variant="secondary">{c._count?.participants ?? 0} joined</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {METRICS[c.metric]} · ends {new Date(c.endsAt).toLocaleDateString()}
                </p>
                {can('challenges.manage') && (
                  <Button size="sm" variant="outline" onClick={() => window.confirm('Cancel this challenge?') && api.challenges.cancel(c.id).then(() => list.refetch())}>
                    Cancel
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
