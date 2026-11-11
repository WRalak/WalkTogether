'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Spinner, Textarea } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

export default function AnnouncementsPage() {
  const { clubId, can } = useClub();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['announcements', clubId], queryFn: () => api.clubs.announcements(clubId, { limit: 50 }) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements', clubId] });
  const create = useMutation({
    mutationFn: () => api.clubs.createAnnouncement(clubId, { title, body, pinned, notify }),
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
  const pin = useMutation({ mutationFn: (a: { id: string; pinned: boolean }) => api.clubs.updateAnnouncement(clubId, a.id, { pinned: !a.pinned }), onSuccess: refresh });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Announcements</h1>
      {error && <Alert variant="destructive">{error}</Alert>}
      {can('announcements.manage') && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <Field id="a-title" label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
            </Field>
            <Field id="a-body" label="Message">
              <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
            </Field>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify members (respects their preferences)
              </label>
            </div>
            <Button disabled={title.trim().length < 2 || !body.trim()} loading={create.isPending} onClick={() => create.mutate()}>
              Publish
            </Button>
          </CardContent>
        </Card>
      )}
      {list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <Alert variant="destructive">{errorMessage(list.error)}</Alert>
      ) : !list.data?.items.length ? (
        <EmptyState title="No announcements yet" />
      ) : (
        <div className="space-y-3">
          {list.data.items.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-2 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{a.title}</p>
                  {a.pinned && <Badge>Pinned</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.author.profile?.displayName ?? a.author.username} · {new Date(a.publishedAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                {can('announcements.manage') && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => pin.mutate(a)}>
                      {a.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => window.confirm('Delete this announcement?') && del.mutate(a.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
