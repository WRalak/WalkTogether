'use client';
import Link from 'next/link';
import { Button } from '@walktogether/ui';
import { useAuth } from '@/lib/auth';

export function TopBar() {
  const { user, signOut } = useAuth();
  return (
    <header className="border-b bg-background">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <Link href="/clubs" className="flex items-center gap-2 font-extrabold">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">WT</span>
          Clubs
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{user?.profile?.displayName ?? user?.username}</span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
