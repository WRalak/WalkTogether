import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Badge, buttonVariants, Card, CardContent } from '@walktogether/ui';
import { fetchClub } from '@/lib/api';
import { siteConfig } from '@/lib/config';
import { categoryLabel, initials } from '@/lib/format';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const club = await fetchClub(slug).catch(() => null);
  if (!club) return { title: 'Club not found', robots: { index: false } };
  const description = club.description?.slice(0, 160) ?? `${club.name} is a ${categoryLabel(club.category).toLowerCase()} club on WalkTogether.`;
  return {
    title: club.name,
    description,
    alternates: { canonical: `/clubs/${club.slug}` },
    // Only PUBLIC clubs are indexable; PRIVATE clubs show a minimal profile and are not indexed.
    robots: club.visibility === 'PUBLIC' ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: club.name, description, type: 'website', url: `/clubs/${club.slug}`, images: club.coverUrl ? [club.coverUrl] : club.logoUrl ? [club.logoUrl] : [] },
  };
}

export default async function ClubPage({ params }: { params: Params }) {
  const { slug } = await params;
  const club = await fetchClub(slug);
  if (!club) notFound();

  const jsonLd =
    club.visibility === 'PUBLIC'
      ? {
          '@context': 'https://schema.org',
          '@type': 'SportsOrganization',
          name: club.name,
          description: club.description ?? undefined,
          url: `${siteConfig.url}/clubs/${club.slug}`,
          logo: club.logoUrl ?? undefined,
          sport: categoryLabel(club.category),
          address: club.city ? { '@type': 'PostalAddress', addressLocality: club.city, addressCountry: club.countryCode ?? undefined } : undefined,
          sameAs: [club.websiteUrl, ...Object.values(club.socialLinks ?? {})].filter(Boolean),
        }
      : null;

  return (
    <>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />}
      <section className="relative h-48 bg-gradient-to-r from-primary to-emerald-800 md:h-64">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {club.coverUrl && <img src={club.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      </section>
      <div className="container relative z-10 -mt-12">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm md:flex-row md:items-end">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {club.logoUrl ? <img src={club.logoUrl} alt={`${club.name} logo`} className="h-20 w-20 rounded-full border-4 border-card object-cover" /> : <div aria-hidden className="grid h-20 w-20 place-items-center rounded-full bg-primary/10 text-2xl font-bold text-primary">{initials(club.name)}</div>}
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight">{club.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{categoryLabel(club.category)}</Badge>
              {club.visibility === 'PRIVATE' && <Badge variant="outline">Private club, requests reviewed</Badge>}
              <span>{[club.city, club.countryCode].filter(Boolean).join(', ')}</span>
              <span>·</span>
              <span>
                {club.memberCount} member{club.memberCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <a href={`walktogether://clubs/${club.slug}`} className={buttonVariants({ size: 'lg' })}>
            {club.visibility === 'PUBLIC' && !club.requiresApproval ? 'Join in the app' : 'Request to join in the app'}
          </a>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardContent className="p-6">
              <h2 className="text-xl font-bold">About</h2>
              <p className="mt-3 whitespace-pre-line text-muted-foreground">{club.description ?? 'This club hasn’t added a description yet.'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-xl font-bold">Contact</h2>
              {club.websiteUrl && (
                <p>
                  <a className="text-primary underline-offset-4 hover:underline" href={club.websiteUrl} rel="noopener noreferrer nofollow" target="_blank">
                    Website
                  </a>
                </p>
              )}
              {club.contactEmail && <p>{club.contactEmail}</p>}
              {Object.entries(club.socialLinks ?? {}).map(([k, url]) => (
                <p key={k}>
                  <a className="capitalize text-primary underline-offset-4 hover:underline" href={url} rel="noopener noreferrer nofollow" target="_blank">
                    {k}
                  </a>
                </p>
              ))}
              {!club.websiteUrl && !club.contactEmail && !Object.keys(club.socialLinks ?? {}).length && <p className="text-muted-foreground">Join the club to see contact details.</p>}
            </CardContent>
          </Card>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Upcoming events and challenges will appear here once the club schedules them.</p>
      </div>
    </>
  );
}
