'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, Spinner, Textarea } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { dashboardHref, useClub } from '@/features/clubs/use-club';

const TYPES = ['WALK', 'RUN', 'HIKE', 'CHARITY_WALK', 'FITNESS', 'SOCIAL'];

function localInput(d: Date) {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function EventsPage() {
  const { clubId, can } = useClub();
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['events', clubId], queryFn: () => api.events.ofClub(clubId, { limit: 100, includeCancelled: true }) });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(6, 30, 0, 0);
  const [f, setF] = useState({ title: '', description: '', type: 'WALK', visibility: 'MEMBERS', start: localInput(tomorrow), durationMin: 90, meetingPoint: '', lat: '', lng: '', distanceKm: '', difficulty: 'EASY', max: '', repeat: 'NONE', count: 4 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const create = useMutation({
    mutationFn: () => {
      const startsAt = new Date(f.start);
      return api.events.create(clubId, {
        title: f.title,
        description: f.description || null,
        type: f.type as 'WALK',
        visibility: f.visibility as 'MEMBERS',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + Number(f.durationMin) * 60_000).toISOString(),
        meetingPoint: f.meetingPoint,
        meetingLat: f.lat ? Number(f.lat) : null,
        meetingLng: f.lng ? Number(f.lng) : null,
        distanceM: f.distanceKm ? Math.round(Number(f.distanceKm) * 1000) : null,
        difficulty: f.difficulty as 'EASY',
        maxParticipants: f.max ? Number(f.max) : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(f.repeat !== 'NONE' ? { recurrence: { frequency: f.repeat as 'WEEKLY', interval: 1, count: Number(f.count) } } : {}),
      });
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['events', clubId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Events</h1>
        {can('events.manage') && <Button onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Schedule event'}</Button>}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {open && (
        <Card>
          <CardContent className="grid gap-4 p-6 md:grid-cols-2">
            <Field id="e-title" label="Title">
              <Input value={f.title} onChange={set('title')} />
            </Field>
            <Field id="e-type" label="Type">
              <Select value={f.type} onChange={set('type')}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="e-start" label="Starts">
              <Input type="datetime-local" value={f.start} onChange={set('start')} />
            </Field>
            <Field id="e-dur" label="Duration (minutes)">
              <Input type="number" min={10} value={f.durationMin} onChange={set('durationMin')} />
            </Field>
            <Field id="e-meet" label="Meeting point">
              <Input value={f.meetingPoint} onChange={set('meetingPoint')} placeholder="Karura Forest, Gate A" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id="e-lat" label="Latitude (optional)" hint="Enables nearby discovery & proximity signal">
                <Input value={f.lat} onChange={set('lat')} />
              </Field>
              <Field id="e-lng" label="Longitude">
                <Input value={f.lng} onChange={set('lng')} />
              </Field>
            </div>
            <Field id="e-dist" label="Distance (km, optional)">
              <Input type="number" step="0.1" value={f.distanceKm} onChange={set('distanceKm')} />
            </Field>
            <Field id="e-max" label="Max participants (optional)">
              <Input type="number" min={1} value={f.max} onChange={set('max')} />
            </Field>
            <Field id="e-diff" label="Difficulty">
              <Select value={f.difficulty} onChange={set('difficulty')}>
                <option value="EASY">Easy</option>
                <option value="MODERATE">Moderate</option>
                <option value="HARD">Hard</option>
              </Select>
            </Field>
            <Field id="e-vis" label="Visibility">
              <Select value={f.visibility} onChange={set('visibility')}>
                <option value="MEMBERS">Members only</option>
                <option value="PUBLIC">Public (listed on WalkTogether)</option>
              </Select>
            </Field>
            <Field id="e-rep" label="Repeat">
              <Select value={f.repeat} onChange={set('repeat')}>
                <option value="NONE">Does not repeat</option>
                <option value="WEEKLY">Weekly (Club Pro)</option>
                <option value="DAILY">Daily (Club Pro)</option>
                <option value="MONTHLY">Monthly (Club Pro)</option>
              </Select>
            </Field>
            {f.repeat !== 'NONE' && (
              <Field id="e-count" label="Number of occurrences">
                <Input type="number" min={2} max={52} value={f.count} onChange={set('count')} />
              </Field>
            )}
            <div className="md:col-span-2">
              <Field id="e-desc" label="Description">
                <Textarea rows={3} value={f.description} onChange={set('description')} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Button loading={create.isPending} disabled={f.title.length < 3 || f.meetingPoint.length < 2} onClick={() => create.mutate()}>
                Create event
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {events.isLoading ? (
        <Spinner />
      ) : events.error ? (
        <Alert variant="destructive">{errorMessage(events.error)}</Alert>
      ) : !events.data?.items.length ? (
        <EmptyState title="No upcoming events" description="Schedule a walk or run for your members." />
      ) : (
        <div className="space-y-3">
          {events.data.items.map((e) => (
            <Link key={e.id} href={dashboardHref(clubId, `/events/${e.id}`)}>
              <Card className="mb-3 transition-shadow hover:shadow-md">
                <CardContent className="flex flex-wrap items-center gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(e.startsAt).toLocaleString()} · {e.meetingPoint}
                    </p>
                  </div>
                  {e.seriesId && <Badge variant="secondary">Recurring</Badge>}
                  {e.status === 'CANCELLED' ? <Badge variant="destructive">Cancelled</Badge> : <Badge>{e.goingCount}{e.maxParticipants ? `/${e.maxParticipants}` : ''} going</Badge>}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
