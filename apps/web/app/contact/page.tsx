import type { Metadata } from 'next';
import { PageHeader, Prose } from '@/components/page-header';
import { siteConfig } from '@/lib/config';

export const metadata: Metadata = { title: 'Contact', alternates: { canonical: '/contact' } };

export default function ContactPage() {
  return (
    <>
      <PageHeader eyebrow="Contact" title="Talk to us" description="Questions, partnerships, sponsorships or support: we’d love to hear from you." />
      <Prose>
        <p>
          Email{' '}
          <a className="font-semibold text-primary underline-offset-4 hover:underline" href={`mailto:${siteConfig.contactEmail}`}>
            {siteConfig.contactEmail}
          </a>{' '}
          and we’ll get back to you within two working days.
        </p>
        <p>For privacy or data-protection requests (access, correction, export or deletion), please include “Data request” in the subject line. You can also export or delete your data directly from the app under Settings.</p>
      </Prose>
    </>
  );
}
