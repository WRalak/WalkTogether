import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Loading } from '@/components/ui';
import { NoPermission, Notice } from '@/components/admin';
import { Screen } from '@/components/screen';
import { useAdminClub } from '@/features/admin/use-admin-club';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export default function SponsorshipOffers() {
  const { clubId, club, can } = useAdminClub();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offers = useQuery({ queryKey: ['offers', clubId], queryFn: () => api.sponsorships.clubOffers(clubId), enabled: !!club && can('events.manage') });
  const respond = useMutation({
    mutationFn: (v: { eventId: string; accept: boolean }) => api.sponsorships.respondOffer(clubId, v.eventId, v.accept),
    onMutate: () => setError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });
  if (!club) return <Loading />;
  if (!can('events.manage'))
    return (
      <Screen edges={[]}>
        <NoPermission what="manage events" />
      </Screen>
    );

  return (
    <Screen edges={[]} refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()}>
      <Stack.Screen options={{ title: 'Sponsorship offers' }} />
      <Text className="mb-3 text-sm text-ink-muted">
        Sponsors only appear on your events after you accept. Sponsored events are always labelled, and no member data is shared with sponsors.
      </Text>
      {error ? <Notice>{error}</Notice> : null}
      {offers.isLoading ? (
        <Loading />
      ) : !offers.data?.length ? (
        <EmptyState title="No sponsorship offers" />
      ) : (
        <View className="gap-3">
          {offers.data.map((o) => (
            <Card key={o.eventId}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-semibold text-ink">{o.campaign.sponsor.name}</Text>
                {o.acceptedAt ? <Badge tone="primary" label="Accepted" /> : null}
              </View>
              <Text className="text-sm text-ink-muted">
                For {o.event.title} · {new Date(o.event.startsAt).toLocaleDateString()}
              </Text>
              {o.campaign.prizeDescription ? <Text className="mt-2 text-sm text-ink">{o.campaign.prizeDescription}</Text> : null}
              <Pressable accessibilityRole="button" onPress={() => setOpen(open === o.eventId ? null : o.eventId)}>
                <Text className="mt-2 font-semibold text-primary">{open === o.eventId ? 'Hide terms' : 'Read terms'}</Text>
              </Pressable>
              {open === o.eventId && <Text className="mt-2 text-sm text-ink-muted">{o.campaign.terms}</Text>}
              {!o.acceptedAt && (
                <View className="mt-3 flex-row gap-2">
                  <Button title="Accept" className="min-h-[40px] flex-1" onPress={() => respond.mutate({ eventId: o.eventId, accept: true })} />
                  <Button title="Decline" variant="outline" className="min-h-[40px] flex-1" onPress={() => respond.mutate({ eventId: o.eventId, accept: false })} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
