import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import QRCode from 'react-native-qrcode-svg';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Loading, SectionTitle, TextField } from '@/components/ui';
import { confirm, Notice, StatTile } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { shareCsv } from '@/services/files';
import { errorMessage } from '@/utils/errors';

/** Full-screen-friendly rotating check-in QR. Codes are short-lived, so screenshots can't be reused later. */
function CheckInQr({ eventId }: { eventId: string }) {
  useKeepAwake();
  const code = useQuery({ queryKey: ['checkin-code', eventId], queryFn: () => api.events.checkInCode(eventId), refetchInterval: 30_000 });
  if (code.error) return <Notice>{errorMessage(code.error)}</Notice>;
  if (!code.data) return <Loading />;
  return (
    <View className="items-center">
      <View className="rounded-3xl bg-white p-5">
        <QRCode value={`${code.data.deepLink}${encodeURIComponent(code.data.code)}`} size={240} />
      </View>
      <Text className="mt-2 text-center text-xs text-ink-muted">Members scan this in WalkTogether. It refreshes automatically; keep this screen open.</Text>
    </View>
  );
}

export default function ManageEvent() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { clubId, club, can } = useAdminClub();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [reason, setReason] = useState('');
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api.events.get(eventId) });
  const people = useQuery({
    queryKey: ['participants', eventId],
    queryFn: () => api.events.participants(eventId),
    enabled: !!club && can('attendance.manage'),
    refetchInterval: showQr ? 10_000 : false,
  });

  const mark = useMutation({
    mutationFn: (v: { userId: string; present: boolean }) => api.events.markAttendance(eventId, v.userId, v.present),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participants', eventId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (series: boolean) => api.events.cancel(eventId, reason.trim(), series),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-events', clubId] });
      router.back();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const exportCsv = useMutation({
    mutationFn: async () => shareCsv(`attendance-${eventId}.csv`, await api.events.attendanceCsv(eventId)),
    onError: (e) => setError(errorMessage(e)),
  });

  if (event.isLoading || !club) return <Loading />;
  if (!event.data)
    return (
      <Screen edges={[]}>
        <ErrorState message={errorMessage(event.error, 'Event not found')} />
      </Screen>
    );
  const e = event.data;

  return (
    <Screen edges={[]} refreshing={people.isRefetching} onRefresh={() => void Promise.all([event.refetch(), people.refetch()])}>
      <Stack.Screen options={{ title: e.title }} />
      <Text className="text-sm text-ink-muted">
        {new Date(e.startsAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })} · {e.meetingPoint}
      </Text>
      {e.status === 'CANCELLED' && (
        <View className="mt-2">
          <Badge tone="warning" label={`Cancelled: ${e.cancelReason ?? ''}`} />
        </View>
      )}
      {error ? (
        <View className="mt-3">
          <Notice>{error}</Notice>
        </View>
      ) : null}
      {people.data && (
        <View className="mt-4 flex-row flex-wrap gap-3">
          <StatTile label="Going" value={people.data.going} hint={e.maxParticipants ? `Capacity ${e.maxParticipants}` : undefined} />
          <StatTile label="Waitlist" value={people.data.waitlisted} />
          <StatTile label="Checked in" value={people.data.attended} />
        </View>
      )}
      {can('attendance.manage') && e.status === 'SCHEDULED' && (
        <Card className="mt-4">
          <View className="flex-row gap-2">
            <Button title={showQr ? 'Hide QR' : 'Show check-in QR'} className="flex-1" onPress={() => setShowQr((s) => !s)} />
            <Button title="Export CSV" variant="outline" className="flex-1" loading={exportCsv.isPending} onPress={() => exportCsv.mutate()} />
          </View>
          {showQr && (
            <View className="mt-4">
              <CheckInQr eventId={eventId} />
            </View>
          )}
        </Card>
      )}
      {people.data && (
        <>
          <SectionTitle>Participants</SectionTitle>
          <View className="gap-2">
            {people.data.rows.map((r) => (
              <Card key={r.user.id} className="p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text className="font-semibold text-ink">{r.user.displayName}</Text>
                    <Text className="text-xs text-ink-muted">
                      {r.registration ? r.registration.toLowerCase() : 'no RSVP'} ·{' '}
                      {r.attendance
                        ? `${r.attendance.method === 'QR' ? 'QR' : 'organiser'} ${new Date(r.attendance.checkedInAt).toLocaleTimeString([], { timeStyle: 'short' })}${r.attendance.distanceFromMeetingM != null ? ` · ${r.attendance.distanceFromMeetingM} m away` : ''}`
                        : 'not checked in'}
                    </Text>
                  </View>
                  <Button
                    title={r.attendance ? 'Undo' : 'Present'}
                    variant={r.attendance ? 'outline' : 'primary'}
                    className="min-h-[40px] px-4"
                    onPress={() => mark.mutate({ userId: r.user.id, present: !r.attendance })}
                  />
                </View>
              </Card>
            ))}
            {people.data.rows.length === 0 && <Text className="text-sm text-ink-muted">No RSVPs yet.</Text>}
          </View>
        </>
      )}
      {can('events.manage') && e.status === 'SCHEDULED' && (
        <Card className="mt-6 border-danger">
          <Text className="mb-2 text-base font-bold text-ink">Cancel event</Text>
          <TextField label="Reason (sent to participants)" value={reason} onChangeText={setReason} />
          <Button
            title="Cancel this event"
            variant="danger"
            disabled={reason.trim().length < 3}
            onPress={() => confirm('Cancel event', 'Everyone who RSVP’d will be notified.', () => cancel.mutate(false), 'Cancel event')}
          />
          {e.seriesId && (
            <Button
              title="Cancel this and future occurrences"
              variant="outline"
              className="mt-2"
              disabled={reason.trim().length < 3}
              onPress={() => confirm('Cancel series', 'This and all future occurrences will be cancelled.', () => cancel.mutate(true), 'Cancel series')}
            />
          )}
        </Card>
      )}
    </Screen>
  );
}
