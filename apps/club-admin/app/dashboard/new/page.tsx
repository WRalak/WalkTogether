'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent } from '@walktogether/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { ClubForm, toClubPayload } from '@/features/clubs/club-form';

export default function NewClubPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const verified = !!(user?.emailVerified || user?.phoneVerified);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Create a club</h1>
      <p className="text-sm text-muted-foreground">You’ll be the club owner. You can invite administrators afterwards.</p>
      {!verified && (
        <Alert className="mt-6">
          <p className="font-semibold">Verify your email to create a club</p>
          <p className="mt-1">We sent a verification link to {user?.email}. After verifying, reload this page.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={resent} onClick={() => api.auth.resendVerification().then(() => setResent(true)).catch((e) => setError(errorMessage(e)))}>
              {resent ? 'Email sent' : 'Resend email'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
              I’ve verified
            </Button>
          </div>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mt-6">
          {error}
        </Alert>
      )}
      <Card className="mt-6">
        <CardContent className="p-6">
          <ClubForm
            submitLabel="Create club"
            onSubmit={async (v) => {
              setError(null);
              try {
                const club = await api.clubs.create({ ...toClubPayload(v), slug: v.slug });
                await qc.invalidateQueries({ queryKey: ['my-clubs'] });
                router.push(`/dashboard/overview?club=${club.id}`);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
