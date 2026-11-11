import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { ClubForm } from '@/features/admin/club-form';
import { api } from '@/services/api';

export default function NewClub() {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Create a club' }} />
      <Notice tone="info">You’ll be the club owner. New clubs may need a quick review by the WalkTogether team before they appear in search.</Notice>
      <ClubForm
        mode="create"
        submitLabel="Create club"
        onSubmit={async (payload) => {
          const club = await api.clubs.create(payload as Parameters<typeof api.clubs.create>[0]);
          await qc.invalidateQueries({ queryKey: ['my-clubs'] });
          router.replace({ pathname: '/admin/[clubId]', params: { clubId: club.id } });
        }}
      />
    </Screen>
  );
}
