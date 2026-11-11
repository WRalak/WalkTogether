import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, SectionTitle, TextField } from '@/components/ui';
import { confirm, NoPermission, Notice, Toggle } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function Announcements() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['announcements', clubId], queryFn: () => api.clubs.announcements(clubId, { limit: 50 }), enabled: !!club });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements', clubId] });
  const create = useMutation({
    mutationFn: () => api.clubs.createAnnouncement(clubId, { title: title.trim(), body: body.trim(), pinned, notify }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setPinned(false);
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => api.clubs.deleteAnnouncement(clubId, id), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const pin = useMutation({ mutationFn: (a: { id: string; pinned: boolean }) => api.clubs.updateAnnouncement(clubId, a.id, { pinned: !a.pinned }), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });

  if (!club) return <Loading />;
  if (!can('club.view_private')) return <Screen edges={[]}><NoPermission what="view announcements" /></Screen>;
  const items = list.data?.items ?? [];

  return (
    <Screen edges={[]} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: 'Announcements' }} />
      {error ? <Notice>{error}</Notice> : null}
      {can('announcements.manage') && (
        <Card>
          <TextField label="Title" value={title} maxLength={140} onChangeText={setTitle} />
          <TextField label="Message" value={body} maxLength={5000} multiline onChangeText={setBody} style={{ minHeight: 110, textAlignVertical: 'top' }} />
          <Toggle label="Pin to top" value={pinned} onChange={setPinned} />
          <Toggle label="Notify members" hint="Respects each member’s notification preferences" value={notify} onChange={setNotify} />
          <Button title="Publish" loading={create.isPending} disabled={title.trim().length < 2 || !body.trim()} onPress={() => create.mutate()} />
        </Card>
      )}
      <SectionTitle>Published</SectionTitle>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : !items.length ? (
        <EmptyState title="No announcements yet" />
      ) : (
        <View className="gap-3">
          {items.map((a) => (
            <Card key={a.id}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-semibold text-ink">{a.title}</Text>
                {a.pinned ? <Badge tone="primary" label="Pinned" /> : null}
              </View>
              <Text className="mt-1 text-sm text-ink">{a.body}</Text>
              <Text className="mt-2 text-xs text-ink-muted">{a.author.profile?.displayName ?? a.author.username} · {new Date(a.publishedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</Text>
              {can('announcements.manage') && (
                <View className="mt-3 flex-row gap-2">
                  <Button title={a.pinned ? 'Unpin' : 'Pin'} variant="outline" className="min-h-[40px] flex-1" onPress={() => pin.mutate({ id: a.id, pinned: a.pinned })} />
                  <Button title="Delete" variant="danger" className="min-h-[40px] flex-1" onPress={() => confirm('Delete announcement', `Delete “${a.title}”?`, () => del.mutate(a.id), 'Delete')} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
