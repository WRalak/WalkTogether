import Link from 'next/link';
import { buttonVariants } from '@walktogether/ui';
import { siteConfig } from '@/lib/config';

const nav = [
  { href: '/features', label: 'Features' },
  { href: '/clubs', label: 'Discover clubs' },
  { href: '/for-clubs', label: 'For clubs' },
  { href: '/for-organizations', label: 'For organizations' },
  { href: '/pricing', label: 'Pricing' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-primary text-sm text-primary-foreground">WT</span>
          WalkTogether
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium md:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-muted-foreground transition-colors hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <a href={`${siteConfig.clubAdminUrl}/signup`} className={buttonVariants({ size: 'sm' })}>
          Create a club
        </a>
      </div>
      <nav aria-label="Main mobile" className="container flex gap-4 overflow-x-auto pb-3 text-sm md:hidden">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="whitespace-nowrap text-muted-foreground hover:text-foreground">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
