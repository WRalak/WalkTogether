import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Badge, Card, ErrorState } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { errorMessage } from '@/utils/errors';

const VIS = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'] as const;

export default function PrivacySettings() {
  const user = useAuthStore((s) => s.user);
  const loadUser = useAuthStore((s) => s.loadUser);
  const [error, setError] = useState<string | null>(null);
  if (!user?.privacy) return null;
  const p = user.privacy;

  const update = async (patch: Parameters<typeof api.users.updatePrivacy>[0]) => {
    setError(null);
    try {
      await api.users.updatePrivacy(patch);
      await loadUser();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggle = (label: string, value: boolean, key: 'showClubs' | 'showStats' | 'allowFollowRequests' | 'hideStartEndPoints', help: string) => (
    <View className="flex-row items-center justify-between border-b border-line py-4">
      <View className="flex-1 pr-4">
        <Text className="text-base text-ink">{label}</Text>
        <Text className="text-xs text-ink-muted">{help}</Text>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={(v) => void update({ [key]: v })} trackColor={{ true: '#127a50' }} />
    </View>
  );

  return (
    <Screen edges={[]}>
      {error && <ErrorState message={error} />}
      <Card>
        <Text className="font-semibold text-ink">Who can see your profile</Text>
        <View className="mt-3 flex-row gap-2">
          {VIS.map((v) => (
            <Text
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: p.profileVisibility === v }}
              onPress={() => void update({ profileVisibility: v })}
              className={`flex-1 overflow-hidden rounded-xl border px-2 py-3 text-center text-sm font-semibold ${p.profileVisibility === v ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-muted'}`}
            >
              {v === 'FOLLOWERS' ? 'Followers' : v[0] + v.slice(1).toLowerCase()}
            </Text>
          ))}
        </View>
        <View className="mt-3">
          <Badge label="Your activity history always belongs to you, not your clubs" />
        </View>
      </Card>
      <Card className="mt-4 py-0">
        {toggle('Hide route start & end', p.hideStartEndPoints, 'hideStartEndPoints', 'Protects your home and workplace on shared maps')}
        {toggle('Show my clubs', p.showClubs, 'showClubs', 'Only public clubs are ever shown to others')}
        {toggle('Show my statistics', p.showStats, 'showStats', 'Totals and personal records on your profile')}
        {toggle('Allow follow requests', p.allowFollowRequests, 'allowFollowRequests', 'People can ask to follow you')}
      </Card>
    </Screen>
  );
}
