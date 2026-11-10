import Link from 'next/link';

const columns = [
  { title: 'Product', links: [['/features', 'Features'], ['/clubs', 'Discover clubs'], ['/pricing', 'Pricing']] },
  { title: 'Solutions', links: [['/for-clubs', 'For clubs'], ['/for-organizations', 'For organizations'], ['/sponsors', 'Sponsors']] },
  { title: 'Company', links: [['/about', 'About'], ['/contact', 'Contact'], ['/privacy', 'Privacy policy'], ['/terms', 'Terms of service']] },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t bg-muted/50">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <p className="text-lg font-extrabold">WalkTogether</p>
          <p className="mt-2 text-sm text-muted-foreground">Move together. Grow together. Made in Kenya for walking and running communities everywhere.</p>
        </div>
        {columns.map((c) => (
          <div key={c.title}>
            <p className="text-sm font-semibold">{c.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {c.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href!} className="text-muted-foreground hover:text-foreground">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="container border-t py-6 text-xs text-muted-foreground">© {new Date().getFullYear()} WalkTogether. All rights reserved.</div>
    </footer>
  );
}
