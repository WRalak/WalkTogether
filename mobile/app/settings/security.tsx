import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Loading, SectionTitle, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';
import { MfaSettings } from '@/features/security/mfa-settings';

export default function SecuritySettings() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.auth.sessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  const confirmLogoutAll = () =>
    Alert.alert('Sign out everywhere?', 'This signs you out on all devices, including this one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out all', style: 'destructive', onPress: () => void api.auth.logoutAll().catch((e) => setError(errorMessage(e))) },
    ]);

  const confirmDelete = () =>
    Alert.alert('Delete your account?', 'You will be signed out everywhere. Your account is permanently deleted after 30 days unless you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.users.deleteAccount({ confirm: 'DELETE', password: deletePassword || undefined });
            await useAuthStore.getState().signOut();
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);

  return (
    <Screen edges={[]}>
      {error && <ErrorState message={error} />}
      <SectionTitle>Sign-in protection</SectionTitle>
      <MfaSettings />
      <SectionTitle>Signed-in devices</SectionTitle>
      {sessions.isLoading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
      ) : (
        sessions.data?.map((s) => (
          <Card key={s.id} className="mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-semibold text-ink">{s.deviceName ?? s.platform ?? 'Unknown device'}</Text>
                <Text className="text-xs text-ink-muted">Last active {new Date(s.lastUsedAt).toLocaleString()}</Text>
              </View>
              {s.current ? <Badge label="This device" tone="primary" /> : <Button title="Sign out" variant="outline" className="min-h-[40px]" onPress={() => revoke.mutate(s.id)} />}
            </View>
          </Card>
        ))
      )}
      <Button title="Sign out of all devices" variant="outline" className="mt-2" onPress={confirmLogoutAll} />

      <SectionTitle>Delete account</SectionTitle>
      <Card>
        <Text className="mb-3 text-sm text-ink-muted">Deleting your account removes your profile and personal data after a 30-day grace period. Club owners must transfer ownership first.</Text>
        {user?.email ? <TextField label="Confirm with your password" secureTextEntry value={deletePassword} onChangeText={setDeletePassword} /> : null}
        <Button title="Delete my account" variant="danger" onPress={confirmDelete} />
      </Card>
    </Screen>
  );
}
