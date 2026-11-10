'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLUB_PERMISSIONS, type ClubPermissionKey } from '@walktogether/shared-types';
import { Alert, Badge, Button, Card, CardContent, Field, Input, Select, Spinner } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

const LABELS: Record<ClubPermissionKey, string> = {
  'club.view_private': 'See members-only content',
  'club.settings.update': 'Edit club profile & settings',
  'club.delete': 'Archive the club',
  'members.view': 'See member list',
  'members.approve': 'Approve join requests',
  'members.invite': 'Invite people',
  'members.remove': 'Remove / ban members',
  'members.suspend': 'Suspend members',
  'members.roles.assign': 'Assign roles',
  'roles.manage': 'Manage roles',
  'events.manage': 'Manage events',
  'attendance.manage': 'Manage attendance',
  'announcements.manage': 'Publish announcements',
  'challenges.manage': 'Manage challenges',
  'community.moderate': 'Moderate community',
  'analytics.view': 'View analytics',
  'reports.export': 'Export reports',
  'billing.view': 'View billing',
  'billing.manage': 'Manage billing',
};

function PermissionPicker({ value, onChange, allowed }: { value: string[]; onChange: (v: string[]) => void; allowed: Set<string> }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">Permissions</legend>
      {CLUB_PERMISSIONS.map((p) => (
        <label key={p} className={`flex items-center gap-2 text-sm ${allowed.has(p) ? '' : 'opacity-40'}`}>
          <input type="checkbox" className="h-4 w-4" disabled={!allowed.has(p)} checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
          {LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

export default function RolesPage() {
  const { clubId, data: club, can } = useClub();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId) });
  const members = useQuery({ queryKey: ['members', clubId, 'ACTIVE', 'owner-transfer'], queryFn: () => api.clubs.members(clubId, { limit: 100 }), enabled: club?.viewer.permissions.includes('club.delete') });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; permissions: string[] } | null>(null);
  const [heir, setHeir] = useState('');
  const [password, setPassword] = useState('');
  const isOwner = club?.viewer.role === 'Club Owner';
  const allowed = new Set(isOwner ? CLUB_PERMISSIONS : (club?.viewer.permissions ?? []));
  const refresh = () => qc.invalidateQueries({ queryKey: ['roles', clubId] });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const body = { name: editing.name, permissions: editing.permissions as ClubPermissionKey[] };
      return editing.id ? api.clubs.updateRole(clubId, editing.id, roles.data?.find((r) => r.id === editing.id)?.systemKey ? { permissions: body.permissions } : body) : api.clubs.createRole(clubId, body);
    },
    onMutate: () => setError(null),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.clubs.deleteRole(clubId, id), onSuccess: refresh, onError: (e) => setError(errorMessage(e)) });
  const transfer = useMutation({
    mutationFn: () => api.clubs.transferOwnership(clubId, heir, password || undefined),
    onSuccess: () => window.location.assign(`/clubs/${clubId}`),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!can('roles.manage')) return <Alert variant="destructive">You don’t have permission to manage roles.</Alert>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Roles & permissions</h1>
        <Button onClick={() => setEditing({ id: null, name: '', permissions: ['club.view_private', 'members.view'] })}>New role</Button>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {editing && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="font-semibold">{editing.id ? 'Edit role' : 'New role'}</h2>
            {!roles.data?.find((r) => r.id === editing.id)?.systemKey && (
              <Field id="role-name" label="Role name">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
            )}
            <PermissionPicker value={editing.permissions} allowed={allowed} onChange={(permissions) => setEditing({ ...editing, permissions })} />
            <div className="flex gap-2">
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {roles.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.data?.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{r.name}</p>
                  <Badge variant="secondary">{r.memberCount} members</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{r.isOwner ? 'All permissions' : r.permissions.map((p) => LABELS[p as ClubPermissionKey] ?? p).join(' · ')}</p>
                {!r.isOwner && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, name: r.name, permissions: r.permissions })}>
                      Edit
                    </Button>
                    {!r.systemKey && (
                      <Button size="sm" variant="destructive" onClick={() => window.confirm(`Delete role ${r.name}?`) && remove.mutate(r.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {isOwner && (
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-6">
            <h2 className="font-semibold">Transfer ownership</h2>
            <p className="text-sm text-muted-foreground">The new owner gets full control, including billing. You become a Club Administrator.</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Select aria-label="New owner" value={heir} onChange={(e) => setHeir(e.target.value)}>
                <option value="">Choose a member…</option>
                {members.data?.items
                  .filter((m) => m.role.systemKey !== 'OWNER')
                  .map((m) => (
                    <option key={m.membershipId} value={m.membershipId}>
                      {m.user.displayName} (@{m.user.username})
                    </option>
                  ))}
              </Select>
              <Input type="password" aria-label="Your password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button variant="destructive" disabled={!heir} loading={transfer.isPending} onClick={() => window.confirm('Transfer ownership? This cannot be undone by you.') && transfer.mutate()}>
                Transfer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
