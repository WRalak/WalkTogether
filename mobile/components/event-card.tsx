import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { EventDto } from '@walktogether/api-client';
import { Badge } from './ui';

export function EventCard({ e, showClub }: { e: EventDto; showClub?: boolean }) {
  const d = new Date(e.startsAt);
  return (
    <Link href={{ pathname: '/events/[id]', params: { id: e.id } }} asChild>
      <Pressable accessibilityRole="link" className="mb-3 flex-row gap-3 rounded-3xl border border-line bg-surface p-4 active:opacity-80">
        <View className="w-14 items-center rounded-2xl bg-primary-soft py-2">
          <Text className="text-xs font-semibold uppercase text-primary">{d.toLocaleDateString(undefined, { month: 'short' })}</Text>
          <Text className="text-xl font-extrabold text-primary">{d.getDate()}</Text>
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="font-bold text-ink">
            {e.title}
          </Text>
          <Text className="text-sm text-ink-muted">
            {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {e.meetingPoint}
          </Text>
          {showClub && <Text className="text-xs text-ink-muted">{e.club.name}</Text>}
          <View className="mt-2 flex-row gap-2">
            {e.status === 'CANCELLED' ? <Badge label="Cancelled" tone="warning" /> : <Badge label={`${e.goingCount} going`} tone="primary" />}
            {e.viewer?.registration === 'GOING' && <Badge label="You’re going" />}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
