'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, buttonVariants, Card, CardContent, EmptyState, Spinner } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function ClubPickerPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['my-clubs'], queryFn: () => api.users.myClubs() });
  // Only clubs where the user holds at least one administrative permission are manageable here.
  const manageable = (data ?? []).filter((c) => c.membershipStatus === 'ACTIVE' && c.permissions.some((p) => p !== 'club.view_private' && p !== 'members.view'));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Your clubs</h1>
          <p className="text-sm text-muted-foreground">Clubs you own or help manage.</p>
        </div>
        <Link href="/clubs/new" className={buttonVariants()}>
          Create a club
        </Link>
      </div>
      <div className="mt-6">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <Alert variant="destructive">{errorMessage(error)}</Alert>
        ) : manageable.length === 0 ? (
          <EmptyState title="No clubs to manage yet" description="Create your club, or ask a club owner to give you an admin role." action={<Link href="/clubs/new" className={buttonVariants()}>Create a club</Link>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {manageable.map((c) => (
              <li key={c.id}>
                <Link href={`/clubs/${c.id}`}>
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center gap-4 p-5">
                      <div aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">
                        {c.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {c.role} · {c.memberCount} members
                        </p>
                      </div>
                      {c.status !== 'ACTIVE' && <Badge variant="warning">{c.status.replace('_', ' ').toLowerCase()}</Badge>}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
