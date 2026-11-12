import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLUB_PERMISSIONS, type ClubPermissionKey } from '@walktogether/shared-types';
import { Badge, Button, Card, Loading, SectionTitle, TextField } from '@/components/ui';
import { Chips, confirm, NoPermission, Notice, Toggle } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { PERMISSION_LABELS } from '@/features/admin/permissions';

export default function Roles() {
  const { clubId, club, can } = useAdminClub();
  const router = useRouter();
  const qc = useQueryClient();
  const isOwner = can('club.delete');
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId), enabled: !!club && can('roles.manage') });
  const members = useQuery({ queryKey: ['members', clubId, 'ACTIVE', 'owner-transfer'], queryFn: () => api.clubs.members(clubId, { limit: 100 }), enabled: !!club && isOwner });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; permissions: string[] } | null>(null);
  const [heir, setHeir] = useState('');
  const [password, setPassword] = useState('');
  // Non-owners can only grant permissions they hold themselves (enforced server-side too).
  const allowed = new Set<string>(isOwner ? CLUB_PERMISSIONS : (club?.viewer.permissions ?? []));
  const refresh = () => qc.invalidateQueries({ queryKey: ['roles', clubId] });

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const body = { name: editing.name.trim(), permissions: editing.permissions as ClubPermissionKey[] };
      const system = roles.data?.find((r) => r.id === editing.id)?.systemKey;
      return editing.id ? api.clubs.updateRole(clubId, editing.id, system ? { permissions: body.permissions } : body) : api.clubs.createRole(clubId, body);
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
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-club', clubId] });
      router.back();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('roles.manage'))
    return (
      <Screen edges={[]}>
        <NoPermission what="manage roles" />
      </Screen>
    );
  const editingSystem = !!roles.data?.find((r) => r.id === editing?.id)?.systemKey;

  return (
    <Screen edges={[]} refreshing={roles.isRefetching} onRefresh={() => void roles.refetch()}>
      <Stack.Screen options={{ title: 'Roles & ownership' }} />
      {error ? <Notice>{error}</Notice> : null}
      {editing ? (
        <Card>
          <Text className="mb-3 text-base font-bold text-ink">{editing.id ? 'Edit role' : 'New role'}</Text>
          {!editingSystem && <TextField label="Role name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} />}
          {CLUB_PERMISSIONS.filter((p) => allowed.has(p)).map((p) => (
            <Toggle
              key={p}
              label={PERMISSION_LABELS[p]}
              value={editing.permissions.includes(p)}
              onChange={(on) => setEditing({ ...editing, permissions: on ? [...editing.permissions, p] : editing.permissions.filter((x) => x !== p) })}
            />
          ))}
          <View className="flex-row gap-2">
            <Button title="Save" className="flex-1" loading={save.isPending} onPress={() => save.mutate()} />
            <Button title="Cancel" variant="ghost" className="flex-1" onPress={() => setEditing(null)} />
          </View>
        </Card>
      ) : (
        <Button title="New role" onPress={() => setEditing({ id: null, name: '', permissions: ['club.view_private', 'members.view'] })} />
      )}
      <SectionTitle>Roles</SectionTitle>
      {roles.isLoading ? (
        <Loading />
      ) : (
        <View className="gap-3">
          {roles.data?.map((r) => (
            <Card key={r.id}>
              <View className="flex-row items-center justify-between">
                <Text className="text-base font-semibold text-ink">{r.name}</Text>
                <Badge label={`${r.memberCount} members`} />
              </View>
              <Text className="mt-2 text-xs text-ink-muted">
                {r.isOwner ? 'All permissions' : r.permissions.map((p) => PERMISSION_LABELS[p as ClubPermissionKey] ?? p).join(' · ')}
              </Text>
              {!r.isOwner && (
                <View className="mt-3 flex-row gap-2">
                  <Button title="Edit" variant="outline" className="min-h-[40px] flex-1" onPress={() => setEditing({ id: r.id, name: r.name, permissions: r.permissions })} />
                  {!r.systemKey && (
                    <Button
                      title="Delete"
                      variant="danger"
                      className="min-h-[40px] flex-1"
                      onPress={() => confirm('Delete role', `Delete ${r.name}? Members with it become regular members.`, () => remove.mutate(r.id), 'Delete')}
                    />
                  )}
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
      {isOwner && (
        <Card className="mt-6 border-danger">
          <Text className="text-base font-bold text-ink">Transfer ownership</Text>
          <Text className="mb-3 mt-1 text-sm text-ink-muted">The new owner gets full control, including billing. You become a club administrator.</Text>
          {members.data && (
            <Chips
              label="New owner"
              value={heir}
              options={members.data.items.filter((m) => m.role.systemKey !== 'OWNER').map((m) => ({ key: m.membershipId, label: m.user.displayName }))}
              onChange={setHeir}
            />
          )}
          <TextField label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          <Button
            title="Transfer ownership"
            variant="danger"
            disabled={!heir}
            loading={transfer.isPending}
            onPress={() => confirm('Transfer ownership', 'You can’t undo this yourself. Continue?', () => transfer.mutate(), 'Transfer')}
          />
        </Card>
      )}
    </Screen>
  );
}
