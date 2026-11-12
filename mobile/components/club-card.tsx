import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { ClubSummary } from '@walktogether/shared-types';
import { categoryLabel, initials } from '@/utils/format';
import { Avatar, Badge } from './ui';

export function ClubCard({ club }: { club: ClubSummary }) {
  const place = [club.city, club.countryCode].filter(Boolean).join(', ');
  return (
    <Link href={{ pathname: '/clubs/[slug]', params: { slug: club.slug } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${club.name}, ${club.memberCount} members`}
        className="mb-3 rounded-3xl border border-line bg-surface p-4 active:opacity-80"
      >
        <View className="flex-row items-center gap-3">
          <Avatar label={initials(club.name)} />
          <View className="flex-1">
            <Text numberOfLines={1} className="text-base font-bold text-ink">
              {club.name}
            </Text>
            <Text className="text-sm text-ink-muted">
              {[place, `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}`, club.distanceKm !== undefined ? `${club.distanceKm} km away` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
        {club.description ? (
          <Text numberOfLines={2} className="mt-3 text-sm text-ink-muted">
            {club.description}
          </Text>
        ) : null}
        <View className="mt-3 flex-row gap-2">
          <Badge label={categoryLabel(club.category)} tone="primary" />
          {club.visibility === 'PRIVATE' && <Badge label="Request to join" />}
        </View>
      </Pressable>
    </Link>
  );
}
