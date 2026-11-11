'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Spinner } from '@walktogether/ui';
import { api } from '@/lib/api';
import { useClub } from '@/features/clubs/use-club';

export default function SponsorshipOffersPage() {
  const { clubId, can } = useClub();
  const offers = useQuery({ queryKey: ['offers', clubId], queryFn: () => api.sponsorships.clubOffers(clubId), enabled: can('events.manage') });
  if (!can('events.manage')) return <Alert variant="destructive">You don’t have permission to manage events.</Alert>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Sponsorship offers</h1>
      <p className="text-sm text-muted-foreground">Sponsors only appear on your events after you accept. Sponsored events are always labelled, and no member data is shared with sponsors.</p>
      {offers.isLoading ? (
        <Spinner />
      ) : !offers.data?.length ? (
        <EmptyState title="No sponsorship offers" />
      ) : (
        offers.data.map((o) => (
          <Card key={o.eventId}>
            <CardContent className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{o.campaign.sponsor.name}</p>
                <span className="text-sm text-muted-foreground">→ {o.event.title} ({new Date(o.event.startsAt).toLocaleDateString()})</span>
                {o.acceptedAt && <Badge variant="success">Accepted</Badge>}
              </div>
              {o.campaign.prizeDescription && <p className="text-sm">{o.campaign.prizeDescription}</p>}
              <details className="text-sm text-muted-foreground">
                <summary>Terms</summary>
                <p className="mt-2 whitespace-pre-line">{o.campaign.terms}</p>
              </details>
              {!o.acceptedAt && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => api.sponsorships.respondOffer(clubId, o.eventId, true).then(() => offers.refetch())}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => api.sponsorships.respondOffer(clubId, o.eventId, false).then(() => offers.refetch())}>
                    Decline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
