'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Card, CardContent } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ClubForm, toClubPayload } from '@/features/clubs/club-form';
import { useClub } from '@/features/clubs/use-club';
import { BrandingUpload } from '@/features/clubs/branding-upload';

export default function ClubSettingsPage() {
  const { clubId, data: club, can } = useClub();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!club) return null;
  if (!can('club.settings.update')) return <Alert variant="destructive">You don’t have permission to edit club settings.</Alert>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && <Alert variant={msg.ok ? 'success' : 'destructive'}>{msg.text}</Alert>}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {club.logoUrl && <img src={club.logoUrl} alt="Club logo" className="h-16 w-16 rounded-full object-cover" />}
          <BrandingUpload clubId={clubId} kind="logo" onDone={() => void qc.invalidateQueries({ queryKey: ['club', clubId] })} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {club.coverUrl && <img src={club.coverUrl} alt="Club cover" className="h-16 w-32 rounded-md object-cover" />}
          <BrandingUpload clubId={clubId} kind="cover" onDone={() => void qc.invalidateQueries({ queryKey: ['club', clubId] })} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6">
          <ClubForm
            slugLocked
            submitLabel="Save changes"
            defaultValues={{
              name: club.name,
              slug: club.slug,
              description: club.description ?? '',
              category: club.category as never,
              visibility: club.visibility as never,
              requiresApproval: club.requiresApproval,
              city: club.city ?? '',
              countryCode: club.countryCode ?? '',
              websiteUrl: club.websiteUrl ?? '',
              contactEmail: club.contactEmail ?? '',
              logoUrl: club.logoUrl ?? '',
              coverUrl: club.coverUrl ?? '',
            }}
            onSubmit={async (v) => {
              setMsg(null);
              try {
                const updated = await api.clubs.update(clubId, toClubPayload(v));
                qc.setQueryData(['club', clubId], updated);
                setMsg({ ok: true, text: 'Club updated.' });
              } catch (e) {
                setMsg({ ok: false, text: errorMessage(e) });
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
