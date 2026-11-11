import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, buttonVariants, Card, CardContent, EmptyState } from '@walktogether/ui';
import { PageHeader } from '@/components/page-header';
import { fetchEvents } from '@/lib/api';
import { EVENT_TYPE_OPTIONS, eventTypeLabel, formatEventDate, formatKm } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Upcoming group walks, runs & hikes',
  description: 'Find public group walks, runs and hikes hosted by WalkTogether clubs and join one this week.',
  alternates: { canonical: '/events' },
};

type SearchParams = Promise<{ type?: string; cursor?: string }>;

export default async function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const type = EVENT_TYPE_OPTIONS.includes(sp.type ?? '') ? sp.type : undefined;
  let result: Awaited<ReturnType<typeof fetchEvents>> | null = null;
  let failed = false;
  try {
    result = await fetchEvents({ type, cursor: sp.cursor });
  } catch {
    failed = true;
  }

  return (
    <>
      <PageHeader eyebrow="Events" title="Walk with a group this week" description="Public events hosted by clubs on WalkTogether. Download the app to RSVP and check in." />
      <div className="container py-10">
        <form className="flex flex-col gap-3 sm:flex-row" action="/events">
          <label htmlFor="type" className="sr-only">
            Event type
          </label>
          <select id="type" name="type" defaultValue={type ?? ''} className="h-11 rounded-md border border-input bg-background px-3">
            <option value="">All event types</option>
            {EVENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {eventTypeLabel(t)}
              </option>
            ))}
          </select>
          <button className={buttonVariants({ size: 'lg' })}>Filter</button>
        </form>

        <div className="mt-8">
          {failed ? (
            <EmptyState title="We couldn’t load events right now" description="Please try again in a moment." />
          ) : !result?.items.length ? (
            <EmptyState title="No upcoming public events" description="Clubs publish new walks every week — check back soon, or browse clubs near you." />
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {result.items.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="block h-full">
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex h-full flex-col gap-2 p-5">
                        <p className="text-sm font-semibold text-primary">{formatEventDate(e.startsAt, e.timezone)}</p>
                        <p className="font-bold">{e.title}</p>
                        <p className="text-sm text-muted-foreground">{e.club.name}</p>
                        {e.meetingPoint && <p className="line-clamp-2 text-sm text-muted-foreground">Meet: {e.meetingPoint}</p>}
                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                          <Badge variant="secondary">{eventTypeLabel(e.type)}</Badge>
                          {e.distanceM ? <Badge variant="outline">{formatKm(e.distanceM)} km</Badge> : null}
                          <span className="ml-auto text-sm text-muted-foreground">{e.goingCount} going</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result?.nextCursor && (
            <div className="mt-8 text-center">
              <Link className={buttonVariants({ variant: 'outline' })} href={`/events?${new URLSearchParams({ ...(type ? { type } : {}), cursor: result.nextCursor }).toString()}`}>
                Load more events
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
