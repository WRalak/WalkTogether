import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, Text, View } from 'react-native';
import { connectHealth, healthStatus, syncSteps, type HealthStatus } from '@/services/health';
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
  const [health, setHealth] = useState<HealthStatus>('unavailable');
  useEffect(() => {
    void healthStatus().then((h) => {
      setHealth(h);
      if (h === 'granted')
        void syncSteps()
          .then(() => stats.refetch())
          .catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const achievements = useQuery({ queryKey: ['achievements'], queryFn: () => api.achievements.mine() });
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
          {user.profile?.avatarUrl ? (
            <Image source={{ uri: user.profile.avatarUrl }} className="h-[84px] w-[84px] rounded-full" accessibilityIgnoresInvertColors />
          ) : (
            <Avatar label={initials(name)} size={84} />
          )}
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

      {!!achievements.data?.some((a) => a.earnedAt) && (
        <>
          <SectionTitle>Achievements</SectionTitle>
          <View className="flex-row flex-wrap gap-2">
            {achievements.data
              .filter((a) => a.earnedAt)
              .map((a) => (
                <View key={a.id} accessible accessibilityLabel={`${a.name}: ${a.description}`} className="items-center rounded-2xl border border-line bg-surface px-3 py-2">
                  <Text className="text-2xl">{a.icon}</Text>
                  <Text className="text-xs font-semibold text-ink">{a.name}</Text>
                </View>
              ))}
          </View>
        </>
      )}
      <Card className="mt-4">
        <Text className="font-semibold text-ink">Steps</Text>
        {stats.data?.steps ? (
          <Text className="mt-1 text-ink">
            {stats.data.steps.today.toLocaleString()} today · {stats.data.steps.thisWeek.toLocaleString()} this week
          </Text>
        ) : (
          <Text className="mt-1 text-sm text-ink-muted">
            Connect {Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'} to see your step count. We never estimate steps from GPS.
          </Text>
        )}
        {health !== 'granted' && health !== 'unavailable' && (
          <Button
            title={`Connect ${Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect'}`}
            variant="outline"
            className="mt-3"
            onPress={() =>
              void connectHealth().then(() => {
                setHealth('granted');
                void stats.refetch();
              })
            }
          />
        )}
        {health === 'unavailable' && !stats.data?.steps && <Text className="mt-2 text-xs text-ink-muted">Not available on this device or build.</Text>}
      </Card>
      <SectionTitle>Settings</SectionTitle>
      <Card className="py-0">
        <Row href="/settings/privacy" label="Privacy" detail={user.privacy?.profileVisibility.toLowerCase()} />
        <Row href="/settings/security" label="Security & devices" />
        <Row href="/settings/subscription" label="Subscription" />
        <Row href="/admin" label="Manage clubs" />
        <Row href="/sponsor" label="Sponsor portal" />
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
