import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/page-header';

export const metadata: Metadata = { title: 'About', alternates: { canonical: '/about' } };

export default function AboutPage() {
  return (
    <>
      <PageHeader eyebrow="About" title="We started as a walking club." description="Now we’re building the home for every walking and running community." />
      <Prose>
        <p>WalkTogether began with a group of friends walking together on weekend mornings. Coordinating walks over chat groups, tracking who came, and celebrating milestones was harder than it should be.</p>
        <p>So we’re building the platform we wished we had: reliable tracking for individuals, real tools for club organisers, and a community that makes showing up feel good. Our own club is the first pilot community, and any club, anywhere, can create its own space.</p>
        <h2>What we believe</h2>
        <ul>
          <li>Your fitness data belongs to you, not to your club and not to advertisers.</li>
          <li>Movement should be inclusive: challenges reward consistency and community, never dangerous behaviour.</li>
          <li>Built for Kenya first, with M-Pesa, SMS sign-in and low-bandwidth design, then East Africa and beyond.</li>
        </ul>
      </Prose>
    </>
  );
}
