import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/page-header';

export const metadata: Metadata = { title: 'Terms of service', alternates: { canonical: '/terms' } };

/** Summary terms. Must be finalised by counsel before public launch. */
export default function TermsPage() {
  return (
    <>
      <PageHeader title="Terms of service" description="Draft for legal review." />
      <Prose>
        <h2>Using WalkTogether</h2>
        <p>You must provide accurate information, keep your credentials safe and follow club rules and our community guidelines. Don’t harass others, spoof activity data or misuse the platform.</p>
        <h2>Health & safety</h2>
        <p>WalkTogether is not a medical service. Calorie and fitness estimates are approximations. Listen to your body, follow local laws and stay safe, especially on roads and at night.</p>
        <h2>Clubs</h2>
        <p>Club owners are responsible for their club’s content, events and conduct. Clubs may only use member information to operate the club.</p>
        <h2>Paid plans</h2>
        <p>Club and individual subscriptions are separate. Paid features end when a subscription expires; your personal data and basic tracking remain available.</p>
        <h2>Sponsored content</h2>
        <p>Sponsored challenges and events are clearly labelled and have their own published rules and eligibility criteria.</p>
      </Prose>
    </>
  );
}
