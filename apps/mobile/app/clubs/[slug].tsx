import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Badge, Button, Card, ErrorState, Loading, TextField } from '@/components/ui';
import { Screen } from '@/components/screen';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';
import { categoryLabel, initials } from '@/utils/format';
import { EventCard } from '@/components/event-card';

export default function ClubDetail() {
  const { slug, invite } = useLocalSearchParams<{ slug: string; invite?: string }>();
  const qc = useQueryClient();
  const [code, setCode] = useState(invite ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const club = useQuery({ queryKey: ['club', slug], queryFn: () => api.clubs.get(slug) });
  const events = useQuery({ queryKey: ['club-events', club.data?.id], queryFn: () => api.events.ofClub(club.data!.id, { limit: 5 }), enabled: !!club.data });

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['club', slug] }), qc.invalidateQueries({ queryKey: ['my-clubs'] })]);
  const join = useMutation({
    mutationFn: () => api.clubs.join(club.data!.id, code.trim() ? { invitationCode: code.trim() } : {}),
    onSuccess: (res) => {
      setMessage(res.status === 'ACTIVE' ? 'Welcome to the club! 🎉' : 'Request sent. A club admin will review it soon.');
      void refresh();
    },
    onError: (e) => setMessage(errorMessage(e)),
  });
  const leave = useMutation({
    mutationFn: () => api.clubs.leave(club.data!.id),
    onSuccess: () => {
      setMessage(null);
      void refresh();
    },
    onError: (e) => setMessage(errorMessage(e)),
  });

  if (club.isLoading) return <Loading />;
  if (club.error || !club.data)
    return (
      <Screen edges={[]}>
        <ErrorState message={errorMessage(club.error, 'Club not found')} onRetry={() => void club.refetch()} />
      </Screen>
    );

  const c = club.data;
  const status = c.viewer.membershipStatus;
  const isOwner = c.viewer.permissions.includes('club.delete');
  const needsInvite = c.visibility === 'INVITE_ONLY';

  return (
    <Screen edges={[]} refreshing={club.isRefetching} onRefresh={() => void club.refetch()}>
      <Stack.Screen options={{ title: c.name }} />
      <View className="items-center">
        <Avatar label={initials(c.name)} size={88} />
        <Text accessibilityRole="header" className="mt-3 text-center text-2xl font-extrabold text-ink">
          {c.name}
        </Text>
        <Text className="text-ink-muted">{[c.city, c.countryCode].filter(Boolean).join(', ')}</Text>
        <View className="mt-3 flex-row gap-2">
          <Badge label={categoryLabel(c.category)} tone="primary" />
          <Badge label={`${c.memberCount} member${c.memberCount === 1 ? '' : 's'}`} />
          {c.visibility !== 'PUBLIC' && <Badge label={c.visibility === 'PRIVATE' ? 'Private' : 'Invite only'} />}
        </View>
      </View>

      {message && (
        <Card className="mt-5 bg-primary-soft">
          <Text accessibilityLiveRegion="polite" className="text-ink">
            {message}
          </Text>
        </Card>
      )}

      <View className="mt-5">
        {status === 'ACTIVE' ? (
          <View className="gap-2">
            <Badge label={`You’re a member · ${c.viewer.role}`} tone="primary" />
            {!isOwner && (
              <Button
                title="Leave club"
                variant="outline"
                loading={leave.isPending}
                onPress={() =>
                  Alert.alert(`Leave ${c.name}?`, 'Your personal activity history stays with you.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Leave', style: 'destructive', onPress: () => leave.mutate() },
                  ])
                }
              />
            )}
          </View>
        ) : status === 'PENDING' ? (
          <View className="gap-2">
            <Badge label="Request pending review" tone="warning" />
            <Button title="Cancel request" variant="outline" loading={leave.isPending} onPress={() => leave.mutate()} />
          </View>
        ) : status === 'BANNED' || status === 'SUSPENDED' ? (
          <Text className="text-ink-muted">You can’t join this club.</Text>
        ) : (
          <View>
            {(needsInvite || c.visibility === 'PRIVATE') && (
              <TextField label={needsInvite ? 'Invitation code' : 'Invitation code (optional)'} autoCapitalize="none" value={code} onChangeText={setCode} hint={needsInvite ? 'Ask a club admin for an invitation' : 'With a code you skip the approval queue'} />
            )}
            <Button
              title={code.trim() || (c.visibility === 'PUBLIC' && !c.requiresApproval) ? 'Join club' : 'Request to join'}
              disabled={needsInvite && !code.trim()}
              loading={join.isPending}
              onPress={() => join.mutate()}
            />
          </View>
        )}
      </View>

      {!!events.data?.items.length && (
        <View className="mt-5">
          <Text accessibilityRole="header" className="mb-3 text-lg font-bold text-ink">
            Upcoming events
          </Text>
          {events.data.items.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </View>
      )}
      <Card className="mt-5">
        <Text className="font-bold text-ink">About</Text>
        <Text className="mt-2 text-ink-muted">{c.description ?? 'This club hasn’t added a description yet.'}</Text>
      </Card>
      {(c.websiteUrl || c.contactEmail) && (
        <Card className="mt-4">
          <Text className="font-bold text-ink">Contact</Text>
          {c.websiteUrl && (
            <Text accessibilityRole="link" className="mt-2 text-primary" onPress={() => void Linking.openURL(c.websiteUrl!)}>
              {c.websiteUrl}
            </Text>
          )}
          {c.contactEmail && <Text className="mt-1 text-ink-muted">{c.contactEmail}</Text>}
        </Card>
      )}
    </Screen>
  );
}
