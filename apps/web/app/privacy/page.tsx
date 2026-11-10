import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/page-header';
import { siteConfig } from '@/lib/config';

export const metadata: Metadata = { title: 'Privacy policy', alternates: { canonical: '/privacy' } };

/** Plain-language summary. Must be reviewed by counsel against the Kenya Data Protection Act, 2019 before launch. */
export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy policy" description="Draft for legal review. Plain-language summary of how WalkTogether handles your data." />
      <Prose>
        <h2>What we collect</h2>
        <ul>
          <li>Account details: email and/or phone number, username, display name, password (stored only as an Argon2id hash).</li>
          <li>Profile details you choose to add: photo, bio, location, fitness interests.</li>
          <li>Activity data when you record walks or runs: GPS points, times, distance and pace.</li>
          <li>Security data: sign-in history, device information and IP addresses, used to protect your account.</li>
        </ul>
        <h2>How we use it</h2>
        <p>To provide the service, keep your account secure, show your activities to the audiences you choose, and operate clubs you join. We do not sell personal data.</p>
        <h2>Your controls</h2>
        <ul>
          <li>Profile visibility: public, followers only or private. Route start and end points are hidden by default.</li>
          <li>Your personal activities belong to you, not to any club. Leaving a club never deletes your history.</li>
          <li>Export your data or delete your account at any time from Settings. Deletion completes after a 30-day grace period.</li>
        </ul>
        <h2>Your rights</h2>
        <p>Under the Kenya Data Protection Act, 2019 you may access, correct, port and request deletion of your personal data, and object to certain processing. Contact {siteConfig.contactEmail}.</p>
      </Prose>
    </>
  );
}
