import type { Metadata } from 'next';
import { buttonVariants } from '@walktogether/ui';
import { FeatureGrid } from '@/components/feature-grid';
import { PageHeader } from '@/components/page-header';
import { siteConfig } from '@/lib/config';

export const metadata: Metadata = { title: 'For organizations', description: 'Corporate wellness and community fitness programmes on WalkTogether.', alternates: { canonical: '/for-organizations' } };

export default function ForOrganizationsPage() {
  return (
    <>
      <PageHeader eyebrow="For organizations" title="Wellness programmes people actually join" description="Corporate wellness, schools, churches, SACCOs and NGOs: bring your people together around movement." />
      <FeatureGrid
        items={[
          { title: 'Branches & chapters', body: 'Club Enterprise supports multiple branches with organisation-wide reporting.' },
          { title: 'Privacy-first wellness', body: 'Aggregate participation reports without exposing individuals’ routes or health data.' },
          { title: 'Team challenges', body: 'Department-vs-department challenges with fair, inclusive rules that reward consistency, not risk-taking.' },
        ]}
      />
      <div className="container text-center">
        <a href={`mailto:${siteConfig.contactEmail}?subject=WalkTogether%20for%20organizations`} className={buttonVariants({ size: 'lg' })}>
          Talk to us
        </a>
      </div>
    </>
  );
}
