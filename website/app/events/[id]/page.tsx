import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, buttonVariants, Card, CardContent } from '@walktogether/ui';
import { fetchEvent } from '@/lib/api';
import { siteConfig } from '@/lib/config';
import { eventTypeLabel, formatEventDate, formatKm } from '@/lib/format';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const event = await fetchEvent(id).catch(() => null);
  if (!event) return { title: 'Event not found', robots: { index: false } };
  const description = event.description?.slice(0, 160) ?? `${eventTypeLabel(event.type)} hosted by ${event.club.name} on WalkTogether.`;
  return {
    title: event.title,
    description,
    alternates: { canonical: `/events/${event.id}` },
    openGraph: { title: event.title, description, type: 'website', url: `/events/${event.id}`, images: event.coverUrl ? [event.coverUrl] : [] },
  };
}

const DIFFICULTY: Record<string, string> = { EASY: 'Easy', MODERATE: 'Moderate', HARD: 'Hard' };

export default async function EventPage({ params }: { params: Params }) {
  const { id } = await params;
  const event = await fetchEvent(id);
  if (!event) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.title,
    description: event.description ?? undefined,
    startDate: event.startsAt,
    endDate: event.endsAt ?? undefined,
    eventStatus: event.status === 'CANCELLED' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: event.meetingPoint
      ? { '@type': 'Place', name: event.meetingPoint, geo: event.meetingLat != null ? { '@type': 'GeoCoordinates', latitude: event.meetingLat, longitude: event.meetingLng } : undefined }
      : undefined,
    organizer: { '@type': 'SportsOrganization', name: event.club.name, url: `${siteConfig.url}/clubs/${event.club.slug}` },
    url: `${siteConfig.url}/events/${event.id}`,
  };

  return (
    <div className="container max-w-3xl py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {event.coverUrl && <img src={event.coverUrl} alt="" className="mb-6 aspect-[2/1] w-full rounded-xl object-cover" />}
      <p className="text-sm font-semibold text-primary">{formatEventDate(event.startsAt, event.timezone)}</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{event.title}</h1>
      <p className="mt-2 text-muted-foreground">
        Hosted by{' '}
        <Link href={`/clubs/${event.club.slug}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
          {event.club.name}
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="secondary">{eventTypeLabel(event.type)}</Badge>
        <Badge variant="outline">{DIFFICULTY[event.difficulty] ?? event.difficulty}</Badge>
        {event.distanceM ? <Badge variant="outline">{formatKm(event.distanceM)} km</Badge> : null}
        {event.status === 'CANCELLED' && <Badge variant="destructive">Cancelled</Badge>}
        {event.sponsor && <Badge variant="outline">{event.sponsor.label} · {event.sponsor.name}</Badge>}
      </div>

      <Card className="mt-6">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Meeting point</p>
            <p className="font-medium">{event.meetingPoint ?? 'Shared with participants'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Going</p>
            <p className="font-medium">
              {event.goingCount}
              {event.maxParticipants ? ` of ${event.maxParticipants}` : ''}
            </p>
          </div>
          {event.routeDescription && (
            <div className="sm:col-span-2">
              <p className="text-sm text-muted-foreground">Route</p>
              <p className="whitespace-pre-line">{event.routeDescription}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {event.description && <p className="mt-6 whitespace-pre-line leading-relaxed">{event.description}</p>}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={`/clubs/${event.club.slug}`} className={buttonVariants({ size: 'lg' })}>
          View the club
        </Link>
        <Link href="/events" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          More events
        </Link>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">RSVP and check in from the WalkTogether app. Joining a walk is free.</p>
    </div>
  );
}
