'use client';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui';
import { CampaignsPanel } from '@/features/sponsorships/campaigns-panel';
import { SponsorsPanel } from '@/features/sponsorships/sponsors-panel';

export default function SponsorshipsAdmin() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sponsorships</h1>
          <p className="text-sm text-muted-foreground">
            Approve sponsors, review and award campaigns. Campaigns go live only once paid and approved; sponsored content is always labelled.
          </p>
        </div>
        <Link href="/dashboard/sponsorships/competitions" className={buttonVariants({ variant: 'outline' })}>
          Competitions & badges
        </Link>
      </div>
      <h2 className="text-lg font-semibold">Sponsors</h2>
      <SponsorsPanel />
      <h2 className="text-lg font-semibold">Campaigns</h2>
      <CampaignsPanel />
    </div>
  );
}
