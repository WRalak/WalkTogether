import type { Metadata } from 'next';
import { buttonVariants, Card, CardContent } from '@walktogether/ui';
import { PageHeader } from '@/components/page-header';
import { siteConfig } from '@/lib/config';
import { fetchPlans } from '@/lib/api';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Pricing', description: 'Free for members and clubs to start. Club Pro, Enterprise and individual Premium plans.', alternates: { canonical: '/pricing' } };

/**
 * Plan names and feature lists only. Prices, limits and trials are configured by platform admins
 * and served by the subscription plans API (Phase 2/7); they are intentionally not hardcoded here.
 */
const clubPlans = [
  { name: 'Free Club', tagline: 'Everything to get started', features: ['Club profile & discovery page', 'Member management', 'Invitations & approvals', 'Basic announcements', 'Limited events'] },
  { name: 'Club Pro', tagline: 'For growing clubs', features: ['More admins and organizers', 'Recurring events', 'Advanced attendance reports', 'Club challenges', 'Analytics & exports', 'Custom branding'], highlight: true },
  { name: 'Club Enterprise', tagline: 'For organizations', features: ['Multiple branches', 'Advanced permissions', 'Organisation-wide reporting', 'Corporate wellness tools', 'Priority support'] },
];

export default async function PricingPage() {
  const plans = await fetchPlans();
  const priceFor = (name: string) => plans.find((p) => p.name === name && p.amountMinor > 0);
  return (
    <>
      <PageHeader eyebrow="Pricing" title="Free to start. Upgrade when you’re ready." description="Personal GPS tracking stays free for everyone, and never depends on a club’s plan." />
      <div className="container grid gap-6 py-12 md:grid-cols-3">
        {clubPlans.map((p) => (
          <Card key={p.name} className={p.highlight ? 'border-primary ring-2 ring-primary' : ''}>
            <CardContent className="flex h-full flex-col p-6">
              <h2 className="text-xl font-bold">{p.name}</h2>
              <p className="text-sm text-muted-foreground">{p.tagline}</p>
              {priceFor(p.name) ? (
                <p className="mt-3 text-3xl font-extrabold">
                  {priceFor(p.name)!.currency} {(priceFor(p.name)!.amountMinor / 100).toLocaleString()}
                  <span className="text-sm font-normal text-muted-foreground"> / {priceFor(p.name)!.interval.toLowerCase()}</span>
                </p>
              ) : (
                <p className="mt-3 text-3xl font-extrabold">{p.name === 'Free Club' ? 'Free' : '—'}</p>
              )}
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="text-primary">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a href={p.name === 'Free Club' || priceFor(p.name) ? `${siteConfig.clubAdminUrl}/signup` : `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(p.name)}`} className={buttonVariants({ className: 'mt-6', variant: p.highlight ? 'default' : 'outline' })}>
                {p.name === 'Free Club' ? 'Create a free club' : priceFor(p.name) ? 'Get started' : 'Contact us for pricing'}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="container">
        <Card>
          <CardContent className="p-6">
            <h2 className="text-xl font-bold">WalkTogether Premium (individuals)</h2>
            <p className="mt-2 text-muted-foreground">Advanced analytics, pace trends, route analysis, goals and training insights. Independent of any club subscription. Pay with M-Pesa or card.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
