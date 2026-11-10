import type { Metadata } from 'next';
import { FeatureGrid } from '@/components/feature-grid';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Features', description: 'GPS tracking, clubs, events, challenges and community on WalkTogether.', alternates: { canonical: '/features' } };

// Status labels are honest about what is live versus on the roadmap (see DEVELOPMENT_STATUS.md).
const items = [
  { title: 'Accounts & privacy controls', body: 'Sign in with email, phone (SMS code), Google or Apple. Choose who sees your profile, hide your clubs, block people, export or delete your data.', status: 'Available' },
  { title: 'Clubs & memberships', body: 'Join public clubs instantly, request to join private ones, or use an invitation for invite-only clubs. Belong to as many clubs as you like.', status: 'Available' },
  { title: 'GPS walk & run tracking', body: 'Record walks and runs with live distance, time and pace, even offline. Start and end points hidden by default.', status: 'Available' },
  { title: 'Personal dashboard', body: 'Weekly and monthly totals, personal records and goals. Basic tracking stays free.', status: 'Available' },
  { title: 'Events & attendance', body: 'Group walks, runs and charity events with RSVPs, reminders and QR check-in.', status: 'Available' },
  { title: 'Challenges & leaderboards', body: 'Distance, consistency and club-vs-club challenges with fair, safety-conscious ranking rules.', status: 'Available' },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHeader eyebrow="Features" title="Everything your walking life needs" description="Personal fitness, club life and community, in one app." />
      <FeatureGrid items={items} />
    </>
  );
}
