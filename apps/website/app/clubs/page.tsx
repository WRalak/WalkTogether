import type { Metadata } from 'next';
import Link from 'next/link';
import { CLUB_CATEGORIES } from '@walktogether/shared-types';
import { Badge, buttonVariants, Card, CardContent, EmptyState } from '@walktogether/ui';
import { PageHeader } from '@/components/page-header';
import { fetchClubs } from '@/lib/api';
import { categoryLabel, initials } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Discover walking & running clubs',
  description: 'Find public walking, running and hiking clubs near you and join their next group walk.',
  alternates: { canonical: '/clubs' },
};

type SearchParams = Promise<{ q?: string; category?: string; cursor?: string }>;

export default async function ClubsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = CLUB_CATEGORIES.includes(sp.category as never) ? sp.category : undefined;
  let result: Awaited<ReturnType<typeof fetchClubs>> | null = null;
  let failed = false;
  try {
    result = await fetchClubs({ q: sp.q?.slice(0, 80), category, cursor: sp.cursor });
  } catch {
    failed = true;
  }

  return (
    <>
      <PageHeader eyebrow="Discover" title="Find your people" description="Browse clubs that welcome new members. Private clubs review requests before you join." />
      <div className="container py-10">
        <form className="flex flex-col gap-3 sm:flex-row" role="search" action="/clubs">
          <label htmlFor="q" className="sr-only">
            Search clubs
          </label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Search by club name" className="h-11 flex-1 rounded-md border border-input bg-background px-3" />
          <label htmlFor="category" className="sr-only">
            Category
          </label>
          <select id="category" name="category" defaultValue={category ?? ''} className="h-11 rounded-md border border-input bg-background px-3">
            <option value="">All categories</option>
            {CLUB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <button className={buttonVariants({ size: 'lg' })}>Search</button>
        </form>

        <div className="mt-8">
          {failed ? (
            <EmptyState title="We couldn’t load clubs right now" description="Please try again in a moment." />
          ) : !result?.items.length ? (
            <EmptyState title="No clubs found" description="Try a different search, or be the first to start a club in your area." />
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {result.items.map((club) => (
                <li key={club.id}>
                  <Link href={`/clubs/${club.slug}`} className="block h-full">
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex h-full flex-col gap-3 p-5">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {club.logoUrl ? <img src={club.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials(club.name)}</div>}
                          <div className="min-w-0">
                            <p className="truncate font-bold">{club.name}</p>
                            <p className="text-sm text-muted-foreground">{[club.city, club.countryCode].filter(Boolean).join(', ') || 'Location not set'}</p>
                          </div>
                        </div>
                        {club.description && <p className="line-clamp-3 text-sm text-muted-foreground">{club.description}</p>}
                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                          <Badge variant="secondary">{categoryLabel(club.category)}</Badge>
                          {club.visibility === 'PRIVATE' && <Badge variant="outline">Request to join</Badge>}
                          <span className="ml-auto text-sm text-muted-foreground">
                            {club.memberCount} member{club.memberCount === 1 ? '' : 's'}
                          </span>
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
              <Link
                className={buttonVariants({ variant: 'outline' })}
                href={`/clubs?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(category ? { category } : {}), cursor: result.nextCursor }).toString()}`}
              >
                Load more clubs
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
