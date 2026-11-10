import { Alert, Image, Pressable, Text, View } from 'react-native';
import { pickAndUploadImage } from '@/services/upload';
import { errorMessage } from '@/utils/errors';
import { Link, type Href } from 'expo-router';
import { Avatar, Button, Card, SectionTitle } from '@/components/ui';
import { Screen } from '@/components/screen';
import { useAuthStore } from '@/store/auth';
import { initials } from '@/utils/format';
import { km } from '@/utils/units';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

function Row({ href, label, detail }: { href: Href; label: string; detail?: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" className="flex-row items-center justify-between border-b border-line py-4 active:opacity-70">
        <Text className="text-base text-ink">{label}</Text>
        <Text className="text-sm text-ink-muted">{detail ?? '›'}</Text>
      </Pressable>
    </Link>
  );
}

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const setUser = useAuthStore((s) => s.setUser);
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.activities.stats() });
  if (!user) return null;
  const name = user.profile?.displayName ?? user.username;

  return (
    <Screen>
      <View className="items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          onPress={async () => {
            try {
              const m = await pickAndUploadImage('AVATAR');
              if (m) setUser(await api.media.setAvatar(m.id));
            } catch (e) {
              Alert.alert('Could not update photo', errorMessage(e));
            }
          }}
        >
          {user.profile?.avatarUrl ? <Image source={{ uri: user.profile.avatarUrl }} className="h-[84px] w-[84px] rounded-full" accessibilityIgnoresInvertColors /> : <Avatar label={initials(name)} size={84} />}
        </Pressable>
        <Text accessibilityRole="header" className="mt-3 text-2xl font-extrabold text-ink">
          {name}
        </Text>
        <Text className="text-ink-muted">@{user.username}</Text>
        {user.profile?.bio ? <Text className="mt-2 text-center text-ink-muted">{user.profile.bio}</Text> : null}
      </View>

      <Card className="mt-6 flex-row justify-around">
        {[
          ['Activities', stats.data ? String(stats.data.allTime.activities) : '—'],
          ['Walked km', stats.data ? km(stats.data.allTime.byType.WALK?.distanceM ?? 0) : '—'],
          ['Ran km', stats.data ? km(stats.data.allTime.byType.RUN?.distanceM ?? 0) : '—'],
        ].map(([k, v]) => (
          <View key={k} className="items-center">
            <Text className="text-xl font-bold text-ink">{v}</Text>
            <Text className="text-xs text-ink-muted">{k}</Text>
          </View>
        ))}
      </Card>
      <Card className="mt-4 py-0">
        <Row href="/activities" label="Activity history" detail={stats.data ? `${stats.data.allTime.activities}` : undefined} />
        <Row href={{ pathname: '/users/[username]', params: { username: user.username } }} label="My public profile" />
      </Card>

      <SectionTitle>Settings</SectionTitle>
      <Card className="py-0">
        <Row href="/settings/privacy" label="Privacy" detail={user.privacy?.profileVisibility.toLowerCase()} />
        <Row href="/settings/security" label="Security & devices" />
      </Card>

      <Button
        title="Sign out"
        variant="outline"
        className="mt-6"
        onPress={() =>
          Alert.alert('Sign out?', 'You can sign back in at any time.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
          ])
        }
      />
    </Screen>
  );
}
