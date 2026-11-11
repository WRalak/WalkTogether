import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Loading, SectionTitle, TextField } from '@/components/ui';
import { Chips, confirm, NoPermission, Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function Invitations() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const [created, setCreated] = useState<{ code: string; link?: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [days, setDays] = useState('14');
  const [roleId, setRoleId] = useState('');
  const invitations = useQuery({ queryKey: ['invitations', clubId], queryFn: () => api.clubs.invitations(clubId), enabled: !!club && can('members.invite') });
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId), enabled: !!club && can('members.roles.assign') });

  const create = useMutation({
    mutationFn: () => {
      const uses = Number(maxUses);
      const exp = Number(days);
      if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw new Error('Max uses must be between 1 and 1000.');
      if (!Number.isInteger(exp) || exp < 1 || exp > 90) throw new Error('Expiry must be between 1 and 90 days.');
      return api.clubs.createInvitation(clubId, { email: email.trim() || undefined, maxUses: uses, expiresInDays: exp, roleId: roleId || undefined });
    },
    onMutate: () => setError(null),
    onSuccess: (inv) => {
      setCreated(inv as typeof inv & { link?: string });
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['invitations', clubId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.clubs.revokeInvitation(clubId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!club) return <Loading />;
  if (!can('members.invite')) return <Screen edges={[]}><NoPermission what="manage invitations" /></Screen>;

  const share = (inv: { code: string; link?: string }) =>
    void Share.share({ message: `Join ${club.name} on WalkTogether: ${inv.link ?? ''}\nInvitation code: ${inv.code}` });

  return (
    <Screen edges={[]} refreshing={invitations.isRefetching} onRefresh={() => void invitations.refetch()}>
      <Stack.Screen options={{ title: 'Invitations' }} />
      <Card>
        <Text className="mb-3 text-base font-bold text-ink">New invitation</Text>
        <TextField label="Restrict to email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" hint="Only this verified email can use it" />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <TextField label="Max uses" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" />
          </View>
          <View className="flex-1">
            <TextField label="Expires in (days)" value={days} onChangeText={setDays} keyboardType="number-pad" />
          </View>
        </View>
        {can('members.roles.assign') && roles.data && (
          <Chips
            label="Role on joining"
            value={roleId}
            options={[{ key: '', label: 'Member' }, ...roles.data.filter((r) => !r.isOwner && r.systemKey !== 'MEMBER').map((r) => ({ key: r.id, label: r.name }))]}
            onChange={setRoleId}
          />
        )}
        <Button title="Create invitation" loading={create.isPending} onPress={() => create.mutate()} />
      </Card>
      {error ? <View className="mt-4"><Notice>{error}</Notice></View> : null}
      {created && (
        <Card className="mt-4 border-primary">
          <Text className="font-semibold text-ink">Invitation created — share it now. The code won’t be shown again.</Text>
          <Text selectable className="mt-3 font-mono text-2xl font-bold tracking-widest text-primary">
            {created.code}
          </Text>
          <View className="mt-3 flex-row gap-2">
            <Button title="Share" className="flex-1" onPress={() => share(created)} />
            <Button title="Copy code" variant="outline" className="flex-1" onPress={() => void Clipboard.setStringAsync(created.code)} />
          </View>
        </Card>
      )}
      <SectionTitle>Invitations</SectionTitle>
      {invitations.isLoading ? (
        <Loading />
      ) : !invitations.data?.length ? (
        <EmptyState title="No invitations yet" />
      ) : (
        <View className="gap-3">
          {invitations.data.map((i) => {
            const expired = new Date(i.expiresAt) < new Date();
            const active = !i.revokedAt && !expired && i.useCount < i.maxUses;
            const label = i.revokedAt ? 'Revoked' : expired ? 'Expired' : i.useCount >= i.maxUses ? 'Used' : 'Active';
            return (
              <Card key={i.id}>
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono text-base text-ink">{i.codeHint}…</Text>
                  <Badge label={label} tone={active ? 'primary' : 'neutral'} />
                </View>
                <Text className="mt-1 text-sm text-ink-muted">{i.email ?? i.phone ?? 'Anyone with the code'}</Text>
                <Text className="text-xs text-ink-muted">
                  Used {i.useCount}/{i.maxUses} · expires {new Date(i.expiresAt).toLocaleDateString()}
                </Text>
                {active && <Button title="Revoke" variant="outline" className="mt-3 min-h-[40px]" onPress={() => confirm('Revoke invitation', 'People who haven’t used it yet won’t be able to join with it.', () => revoke.mutate(i.id), 'Revoke')} />}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
