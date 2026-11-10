'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button, cn, Spinner } from '@walktogether/ui';
import { useAdminAuth } from '@/lib/auth';

const NAV = [
  { href: '/dashboard/overview', label: 'Overview', permission: 'platform.overview.view' },
  { href: '/dashboard/users', label: 'Users', permission: 'users.view' },
  { href: '/dashboard/clubs', label: 'Clubs', permission: 'clubs.view' },
  { href: '/dashboard/subscriptions', label: 'Subscriptions', permission: 'plans.manage' },
  { href: '/dashboard/payments', label: 'Payments', permission: 'billing.view' },
  { href: '/dashboard/sponsors', label: 'Sponsors', permission: 'sponsorships.manage' },
  { href: '/dashboard/campaigns', label: 'Campaigns', permission: 'sponsorships.manage' },
  { href: '/dashboard/challenges', label: 'Challenges & badges', permission: 'sponsorships.manage' },
  { href: '/dashboard/moderation', label: 'Moderation', permission: 'moderation.manage' },
  { href: '/dashboard/analytics', label: 'Analytics', permission: 'billing.view' },
  { href: '/dashboard/audit-logs', label: 'Audit logs', permission: 'audit_logs.view' },
  { href: '/dashboard/security', label: 'Security', permission: 'audit_logs.view' },
  { href: '/dashboard/system', label: 'System health', permission: 'platform.overview.view' },
  { href: '/dashboard/settings', label: 'Settings & flags', permission: 'settings.manage' },
  { href: '/dashboard/admins', label: 'Administrators', permission: 'admins.manage' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status, me, can, signOut } = useAdminAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !me)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-foreground text-background md:min-h-screen md:w-60">
        <div className="p-5">
          <p className="font-extrabold">WalkTogether</p>
          <p className="text-xs uppercase tracking-wider text-background/60">Platform admin</p>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col">
          {NAV.filter((n) => can(n.permission)).map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm', active ? 'bg-background/15 font-semibold' : 'text-background/70 hover:bg-background/10')}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden p-5 text-xs text-background/60 md:block">
          <p>{me.displayName}</p>
          <p>{me.role.name}</p>
          <Button size="sm" variant="outline" className="mt-3 border-background/30 bg-transparent text-background hover:bg-background/10" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
