'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { Alert, Badge, cn, Spinner } from '@walktogether/ui';
import { errorMessage } from '@/lib/errors';
import { dashboardHref, useClub } from '@/features/clubs/use-club';

// Navigation only lists sections the viewer is permitted to use.
// The server enforces every permission independently; hiding links is a UX convenience only.
const NAV: { href: string; label: string; permission?: ClubPermissionKey }[] = [
  { href: '/overview', label: 'Overview' },
  { href: '/members', label: 'Members', permission: 'members.view' },
  { href: '/events', label: 'Events', permission: 'club.view_private' },
  { href: '/activities', label: 'Activities', permission: 'members.view' },
  { href: '/challenges', label: 'Challenges', permission: 'club.view_private' },
  { href: '/attendance', label: 'Attendance', permission: 'analytics.view' },
  { href: '/announcements', label: 'Announcements', permission: 'club.view_private' },
  { href: '/analytics', label: 'Analytics', permission: 'analytics.view' },
  { href: '/moderation', label: 'Moderation', permission: 'community.moderate' },
  { href: '/sponsorships', label: 'Sponsorship offers', permission: 'events.manage' },
  { href: '/subscription', label: 'Subscription', permission: 'billing.view' },
  { href: '/settings', label: 'Settings', permission: 'club.settings.update' },
];

export function ClubShell({ children }: { children: React.ReactNode }) {
  const { clubId, data: club, isLoading, error, can } = useClub();
  const pathname = usePathname();
  const router = useRouter();

  // A section without a selected club can't be shown: send the user to the club picker.
  useEffect(() => {
    if (!clubId) router.replace('/dashboard');
  }, [clubId, router]);

  if (!clubId || isLoading)
    return (
      <div className="p-10">
        <Spinner />
      </div>
    );
  if (error || !club)
    return (
      <div className="mx-auto max-w-xl p-10">
        <Alert variant="destructive">{errorMessage(error, 'Club not found')}</Alert>
      </div>
    );

  return (
    <div className="md:flex">
      <aside className="border-b bg-background md:min-h-[calc(100vh-3.5rem)] md:w-60 md:border-b-0 md:border-r">
        <div className="p-4">
          <p className="truncate font-bold">{club.name}</p>
          <p className="text-xs text-muted-foreground">{club.viewer.role}</p>
          {club.status !== 'ACTIVE' && (
            <Badge variant="warning" className="mt-2">
              {club.status.replace('_', ' ').toLowerCase()}
            </Badge>
          )}
          <Link href="/dashboard" className="mt-2 block text-xs font-medium text-primary hover:underline">
            Switch club
          </Link>
        </div>
        <nav aria-label="Club" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col">
          {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => {
            const active = pathname.startsWith(`/dashboard${n.href}`);
            return (
              <Link
                key={n.href}
                href={dashboardHref(clubId, n.href)}
                aria-current={active ? 'page' : undefined}
                className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary')}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
