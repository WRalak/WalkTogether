import Link from 'next/link';
import { buttonVariants } from '@walktogether/ui';

export default function ClubNotFound() {
  return (
    <div className="container py-24 text-center">
      <h1 className="text-3xl font-extrabold">Club not found</h1>
      <p className="mt-3 text-muted-foreground">This club doesn’t exist, or it’s an invite-only club.</p>
      <Link href="/clubs" className={buttonVariants({ className: 'mt-6' })}>
        Discover clubs
      </Link>
    </div>
  );
}
