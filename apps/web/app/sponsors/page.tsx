import type { Metadata } from 'next';
import { buttonVariants } from '@walktogether/ui';
import { FeatureGrid } from '@/components/feature-grid';
import { PageHeader } from '@/components/page-header';
import { siteConfig } from '@/lib/config';

export const metadata: Metadata = { title: 'Sponsors', description: 'Sponsor walking challenges, charity walks and community fitness events.', alternates: { canonical: '/sponsors' } };

export default function SponsorsPage() {
  return (
    <>
      <PageHeader eyebrow="Sponsors" title="Put your brand behind healthier communities" description="Sponsor challenges, charity walks and community events, transparently." />
      <FeatureGrid
        items={[
          { title: 'Clearly labelled', body: 'Sponsored content is always marked as sponsored. Trust is the product.' },
          { title: 'Fair competitions', body: 'Published eligibility rules, competition terms and participant consent for every sponsored challenge.' },
          { title: 'Campaign reporting', body: 'Participation, engagement and reach reporting, aggregated and privacy-preserving.' },
        ]}
      />
      <div className="container text-center">
        <a href={`mailto:${siteConfig.contactEmail}?subject=Sponsorship%20enquiry`} className={buttonVariants({ size: 'lg' })}>
          Become a sponsor
        </a>
      </div>
    </>
  );
}
