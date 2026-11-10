'use client';
import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { Spinner } from '@walktogether/ui';
import { RequireAuth } from '@/components/require-auth';
import { TopBar } from '@/components/top-bar';
import { ClubShell } from './club-shell';

/** `/dashboard` (club picker) and `/dashboard/new` are club-independent; every other section is scoped to one club. */
function Content({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/dashboard' || pathname === '/dashboard/new') return <>{children}</>;
  return <ClubShell>{children}</ClubShell>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <TopBar />
      <Suspense
        fallback={
          <div className="p-10">
            <Spinner />
          </div>
        }
      >
        <Content>{children}</Content>
      </Suspense>
    </RequireAuth>
  );
}
