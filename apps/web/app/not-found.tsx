import Link from 'next/link';
import { buttonVariants } from '@walktogether/ui';

export default function NotFound() {
  return (
    <div className="container py-24 text-center">
      <h1 className="text-4xl font-extrabold">Page not found</h1>
      <p className="mt-3 text-muted-foreground">The page you’re looking for doesn’t exist.</p>
      <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
        Go home
      </Link>
    </div>
  );
}
