import Link from 'next/link';
import { buttonVariants, Card, CardContent } from '@walktogether/ui';
import { siteConfig } from '@/lib/config';

const pillars = [
  { title: 'Track every walk and run', body: 'Reliable GPS recording that works offline, with distance, pace and route maps. Your basic tracking is free, forever.' },
  { title: 'Run your club like a pro', body: 'Members, roles, approvals, invitations, events and attendance in one place, with a dashboard built for club organisers.' },
  { title: 'Grow a real community', body: 'Share activities, cheer each other on, join challenges and climb leaderboards, with privacy controls you actually understand.' },
];

const audiences = [
  { title: 'Members', body: 'Join one club or many. Keep your personal fitness history even if you change clubs.', href: '/features' },
  { title: 'Clubs', body: 'Create a club in minutes. Free to start, with Pro and Enterprise tools when you grow.', href: '/for-clubs' },
  { title: 'Organizations & sponsors', body: 'Corporate wellness and sponsored challenges with transparent rules and reporting.', href: '/for-organizations' },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-emerald-900 text-primary-foreground">
        <div className="container grid gap-10 py-20 md:grid-cols-2 md:py-28">
          <div>
            <p className="inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-medium">Built in Kenya · for every community</p>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">Every step is better together.</h1>
            <p className="mt-5 max-w-xl text-lg text-primary-foreground/85">{siteConfig.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`${siteConfig.clubAdminUrl}/signup`} className={buttonVariants({ variant: 'accent', size: 'lg' })}>
                Create your club, free
              </a>
              <Link href="/clubs" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'border-white/40 bg-transparent text-white hover:bg-white/10' })}>
                Find a club near you
              </Link>
            </div>
          </div>
          <div aria-hidden className="hidden items-center justify-center md:flex">
            <div className="grid w-full max-w-sm gap-3 rounded-2xl bg-white/10 p-5 shadow-2xl ring-1 ring-white/20">
              <p className="text-sm font-semibold uppercase tracking-wider text-white/70">Saturday sunrise walk</p>
              <p className="text-5xl font-extrabold tabular-nums">7.4 km</p>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                {[['Time', '1:12:08'], ['Pace', '9:45 /km'], ['Walkers', '38']].map(([k, val]) => (
                  <div key={k} className="rounded-lg bg-white/10 p-2">
                    <p className="text-white/70">{k}</p>
                    <p className="font-bold tabular-nums">{val}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/60">Illustrative example</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-20">
        <h2 className="text-3xl font-extrabold tracking-tight">One platform for walkers, runners and the clubs that bring them together</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {pillars.map((p) => (
            <Card key={p.title}>
              <CardContent className="p-6">
                <h3 className="text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-muted-foreground">{p.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-secondary">
        <div className="container py-20">
          <h2 className="text-3xl font-extrabold tracking-tight">Who it’s for</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {audiences.map((a) => (
              <Link key={a.title} href={a.href} className="group rounded-lg border bg-card p-6 transition-shadow hover:shadow-md">
                <h3 className="text-lg font-bold group-hover:text-primary">{a.title} →</h3>
                <p className="mt-2 text-muted-foreground">{a.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container py-20 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight">Your privacy, by default</h2>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          The start and end of your routes are hidden by default, your activity history belongs to you (not your club), and you can export or delete your data at any time, in line
          with the Kenya Data Protection Act.
        </p>
        <Link href="/privacy" className={buttonVariants({ variant: 'link', className: 'mt-4' })}>
          Read our privacy policy
        </Link>
      </section>
    </>
  );
}
