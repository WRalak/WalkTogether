import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Loading, SectionTitle } from '@/components/ui';
import { NoPermission, Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { ClubForm } from '@/features/admin/club-form';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { pickAndUploadImage } from '@/services/upload';
import { errorMessage } from '@/utils/errors';

export default function ClubSettings() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-club', clubId] }), qc.invalidateQueries({ queryKey: ['my-clubs'] })]);

  // Images are re-encoded and malware-scanned server-side before they can be attached.
  const brand = useMutation({
    mutationFn: async (kind: 'logo' | 'cover') => {
      const media = await pickAndUploadImage(kind === 'logo' ? 'CLUB_LOGO' : 'CLUB_COVER');
      if (!media) return false;
      await api.media.setClubBranding(clubId, kind === 'logo' ? { logoMediaId: media.id } : { coverMediaId: media.id });
      return true;
    },
    onSuccess: async (changed) => {
      if (!changed) return;
      await refresh();
      setMsg({ ok: true, text: 'Image updated.' });
    },
    onError: (e) => setMsg({ ok: false, text: errorMessage(e) }),
  });

  if (!club) return <Loading />;
  if (!can('club.settings.update'))
    return (
      <Screen edges={[]}>
        <NoPermission what="edit club settings" />
      </Screen>
    );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Club settings' }} />
      {msg ? <Notice tone={msg.ok ? 'success' : 'error'}>{msg.text}</Notice> : null}
      <Card>
        <Text className="mb-3 text-base font-bold text-ink">Logo & cover</Text>
        <View className="mb-3 flex-row items-center gap-4">
          {club.logoUrl ? <Image source={{ uri: club.logoUrl }} accessibilityLabel="Club logo" className="h-16 w-16 rounded-full" /> : null}
          {club.coverUrl ? <Image source={{ uri: club.coverUrl }} accessibilityLabel="Club cover" className="h-16 w-32 rounded-xl" /> : null}
        </View>
        <View className="flex-row gap-2">
          <Button title="Change logo" variant="outline" className="flex-1" loading={brand.isPending && brand.variables === 'logo'} onPress={() => brand.mutate('logo')} />
          <Button title="Change cover" variant="outline" className="flex-1" loading={brand.isPending && brand.variables === 'cover'} onPress={() => brand.mutate('cover')} />
        </View>
      </Card>
      <SectionTitle>Profile</SectionTitle>
      <ClubForm
        mode="update"
        submitLabel="Save changes"
        initial={{
          name: club.name,
          slug: club.slug,
          description: club.description ?? '',
          category: club.category as never,
          visibility: club.visibility as never,
          requiresApproval: club.requiresApproval,
          city: club.city ?? '',
          countryCode: club.countryCode ?? '',
          websiteUrl: club.websiteUrl ?? '',
          contactEmail: club.contactEmail ?? '',
        }}
        onSubmit={async (payload) => {
          setMsg(null);
          await api.clubs.update(clubId, payload as Parameters<typeof api.clubs.update>[1]);
          await refresh();
          setMsg({ ok: true, text: 'Club updated.' });
        }}
      />
    </Screen>
  );
}
