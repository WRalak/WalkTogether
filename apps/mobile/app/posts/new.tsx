import { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaDto } from '@walktogether/api-client';
import { Button, ErrorState } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { pickAndUploadImage } from '@/services/upload';
import { errorMessage } from '@/utils/errors';

export default function NewPost() {
  const router = useRouter();
  const qc = useQueryClient();
  const clubs = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<string>('FOLLOWERS'); // PUBLIC | FOLLOWERS | club id
  const [photo, setPhoto] = useState<MediaDto | null>(null);
  const [busy, setBusy] = useState<'upload' | 'post' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isClub = audience !== 'PUBLIC' && audience !== 'FOLLOWERS';
  const options = [
    { key: 'PUBLIC', label: 'Everyone' },
    { key: 'FOLLOWERS', label: 'Followers' },
    ...(clubs.data ?? []).filter((c) => c.membershipStatus === 'ACTIVE').map((c) => ({ key: c.id, label: c.name })),
  ];
  return (
    <Screen edges={[]}>
      {error && <ErrorState message={error} />}
      <TextInput
        accessibilityLabel="What’s happening"
        multiline
        maxLength={5000}
        placeholder="Share a walk, a photo or an invite…"
        placeholderTextColor="#8a9a93"
        value={body}
        onChangeText={setBody}
        className="min-h-[140px] rounded-2xl border border-line bg-surface p-4 text-base text-ink"
        textAlignVertical="top"
      />
      {photo?.urls.medium && <Image source={{ uri: photo.urls.medium }} className="mt-3 h-56 w-full rounded-2xl" accessibilityLabel="Selected photo" />}
      <Button
        title={photo ? 'Change photo' : 'Add photo'}
        variant="outline"
        className="mt-3"
        loading={busy === 'upload'}
        onPress={async () => {
          setBusy('upload');
          setError(null);
          try {
            const m = await pickAndUploadImage('POST');
            if (m) setPhoto(m);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(null);
          }
        }}
      />
      <Text className="mb-2 mt-5 font-semibold text-ink">Share with</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: audience === o.key }} onPress={() => setAudience(o.key)} className={`rounded-full border px-4 py-2 ${audience === o.key ? 'border-primary bg-primary-soft' : 'border-line bg-surface'}`}>
            <Text className={audience === o.key ? 'font-semibold text-primary' : 'text-ink-muted'}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <Button
        title="Post"
        className="mt-6"
        disabled={!body.trim() && !photo}
        loading={busy === 'post'}
        onPress={async () => {
          setBusy('post');
          setError(null);
          try {
            await api.social.createPost({ body: body.trim() || null, visibility: isClub ? 'FOLLOWERS' : (audience as 'PUBLIC'), clubId: isClub ? audience : null, mediaIds: photo ? [photo.id] : [] });
            void qc.invalidateQueries({ queryKey: ['feed'] });
            router.back();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(null);
          }
        }}
      />
    </Screen>
  );
}
