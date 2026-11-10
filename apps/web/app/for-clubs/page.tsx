import type { Metadata } from 'next';
import { buttonVariants } from '@walktogether/ui';
import { FeatureGrid } from '@/components/feature-grid';
import { PageHeader } from '@/components/page-header';
import { siteConfig } from '@/lib/config';

export const metadata: Metadata = { title: 'For clubs', description: 'Run your walking or running club on WalkTogether.', alternates: { canonical: '/for-clubs' } };

export default function ForClubsPage() {
  return (
    <>
      <PageHeader eyebrow="For clubs" title="Spend less time on admin, more time walking" description="Your own club space, your own rules, with tools that grow with you." />
      <FeatureGrid
        items={[
          { title: 'Your club, your space', body: 'Choose a unique club URL, logo, cover image and description. Public, private or invite-only: you decide.' },
          { title: 'Membership on autopilot', body: 'Approve requests, send invitation links or codes, and suspend or remove members when needed.' },
          { title: 'Roles that make sense', body: 'Owner, administrators, event organizers and moderators, each with exactly the permissions they need, and nothing more.' },
          { title: 'Strict data separation', body: 'Your club’s members and data are visible only to your club. Members’ personal fitness records stay theirs.' },
          { title: 'Events, attendance & reports', body: 'Scheduling and recurring events, RSVPs with waitlists, QR check-in, reminders and attendance reports.' },
          { title: 'Free to start', body: 'Create your club for free. Club Pro and Enterprise add advanced analytics, recurring events, branding and more.' },
        ]}
      />
      <div className="container text-center">
        <a href={`${siteConfig.clubAdminUrl}/signup`} className={buttonVariants({ size: 'lg' })}>
          Create your club
        </a>
      </div>
    </>
  );
}
