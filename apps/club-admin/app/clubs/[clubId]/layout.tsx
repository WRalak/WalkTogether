'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ClubPermissionKey } from '@walktogether/shared-types';
import { Alert, Badge, cn, Spinner } from '@walktogether/ui';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

// Navigation only lists sections that exist today and that the viewer is permitted to use.
// The server enforces every permission independently; hiding links is a UX convenience only.
const NAV: { href: string; label: string; permission?: ClubPermissionKey }[] = [
  { href: '', label: 'Overview' },
  { href: '/members', label: 'Members', permission: 'members.view' },
  { href: '/events', label: 'Events & attendance', permission: 'club.view_private' },
  { href: '/challenges', label: 'Challenges', permission: 'club.view_private' },
  { href: '/analytics', label: 'Analytics & reports', permission: 'analytics.view' },
  { href: '/invitations', label: 'Invitations', permission: 'members.invite' },
  { href: '/roles', label: 'Roles', permission: 'roles.manage' },
  { href: '/announcements', label: 'Announcements', permission: 'club.view_private' },
  { href: '/moderation', label: 'Community moderation', permission: 'community.moderate' },
  { href: '/sponsorships', label: 'Sponsorship offers', permission: 'events.manage' },
  { href: '/billing', label: 'Subscription & billing', permission: 'billing.view' },
  { href: '/settings', label: 'Settings', permission: 'club.settings.update' },
];

export default function ClubLayout({ children }: { children: React.ReactNode }) {
  const { clubId, data: club, isLoading, error, can } = useClub();
  const pathname = usePathname();
  const base = `/clubs/${clubId}`;

  if (isLoading)
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
        </div>
        <nav aria-label="Club" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col">
          {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => {
            const href = `${base}${n.href}`;
            const active = n.href === '' ? pathname === base : pathname.startsWith(href);
            return (
              <Link key={n.href} href={href} aria-current={active ? 'page' : undefined} className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary')}>
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
