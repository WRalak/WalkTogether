'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Alert, Badge, Button, Card, CardContent, Input, Spinner, Stat, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { downloadText } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { dashboardHref, useClub } from '@/features/clubs/use-club';

function CheckInQr({ eventId }: { eventId: string }) {
  // Rotates every minute; the code is short-lived so screenshots can't be reused later.
  const code = useQuery({ queryKey: ['checkin-code', eventId], queryFn: () => api.events.checkInCode(eventId), refetchInterval: 30_000 });
  if (code.error) return <Alert variant="destructive">{errorMessage(code.error)}</Alert>;
  if (!code.data) return <Spinner />;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg bg-white p-4">
        <QRCodeSVG value={`${code.data.deepLink}${encodeURIComponent(code.data.code)}`} size={240} />
      </div>
      <p className="text-xs text-muted-foreground">Members scan this in the WalkTogether app. It refreshes automatically.</p>
    </div>
  );
}

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { clubId, can } = useClub();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [reason, setReason] = useState('');
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api.events.get(eventId) });
  const people = useQuery({ queryKey: ['participants', eventId], queryFn: () => api.events.participants(eventId), enabled: can('attendance.manage'), refetchInterval: showQr ? 10_000 : false });
  useEffect(() => setError(null), [eventId]);

  const mark = useMutation({
    mutationFn: (v: { userId: string; present: boolean }) => api.events.markAttendance(eventId, v.userId, v.present),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants', eventId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (series: boolean) => api.events.cancel(eventId, reason, series),
    onSuccess: () => router.push(dashboardHref(clubId, '/events')),
    onError: (e) => setError(errorMessage(e)),
  });

  if (event.isLoading) return <Spinner />;
  if (!event.data) return <Alert variant="destructive">{errorMessage(event.error, 'Event not found')}</Alert>;
  const e = event.data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{e.title}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date(e.startsAt).toLocaleString()} – {new Date(e.endsAt).toLocaleTimeString()} · {e.meetingPoint}
        </p>
        {e.status === 'CANCELLED' && <Badge variant="destructive">Cancelled: {e.cancelReason}</Badge>}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {people.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Going" value={people.data.going} hint={e.maxParticipants ? `Capacity ${e.maxParticipants}` : undefined} />
          <Stat label="Waitlisted" value={people.data.waitlisted} />
          <Stat label="Checked in" value={people.data.attended} />
        </div>
      )}
      {can('attendance.manage') && e.status === 'SCHEDULED' && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowQr((s) => !s)}>{showQr ? 'Hide check-in QR' : 'Show check-in QR'}</Button>
              <Button
                variant="outline"
                onClick={() =>
                  api.events
                    .attendanceCsv(eventId)
                    .then((t) => downloadText(`attendance-${eventId}.csv`, t))
                    .catch((err) => setError(errorMessage(err)))
                }
              >
                Export CSV
              </Button>
            </div>
            {showQr && <CheckInQr eventId={eventId} />}
          </CardContent>
        </Card>
      )}
      {people.data && (
        <Table>
          <thead>
            <tr>
              <Th>Participant</Th>
              <Th>RSVP</Th>
              <Th>Attendance</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {people.data.rows.map((r) => (
              <tr key={r.user.id}>
                <Td>
                  {r.user.displayName} <span className="text-xs text-muted-foreground">@{r.user.username}</span>
                </Td>
                <Td>{r.registration ? <Badge variant={r.registration === 'GOING' ? 'success' : 'secondary'}>{r.registration.toLowerCase()}</Badge> : '—'}</Td>
                <Td className="text-sm">
                  {r.attendance ? `${r.attendance.method === 'QR' ? 'QR' : 'Organizer'} · ${new Date(r.attendance.checkedInAt).toLocaleTimeString()}${r.attendance.distanceFromMeetingM != null ? ` · ${r.attendance.distanceFromMeetingM} m from meeting point` : ''}` : 'Not checked in'}
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant={r.attendance ? 'outline' : 'default'} onClick={() => mark.mutate({ userId: r.user.id, present: !r.attendance })}>
                    {r.attendance ? 'Undo' : 'Mark present'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {can('events.manage') && e.status === 'SCHEDULED' && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-wrap items-center gap-2 p-6">
            <Input aria-label="Cancellation reason" placeholder="Reason (sent to participants)" value={reason} onChange={(ev) => setReason(ev.target.value)} className="max-w-sm" />
            <Button variant="destructive" disabled={reason.trim().length < 3} onClick={() => cancel.mutate(false)}>
              Cancel event
            </Button>
            {e.seriesId && (
              <Button variant="outline" disabled={reason.trim().length < 3} onClick={() => cancel.mutate(true)}>
                Cancel this and future occurrences
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
