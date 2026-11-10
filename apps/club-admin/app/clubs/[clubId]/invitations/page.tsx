'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, Input, Select, Spinner, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useClub } from '@/features/clubs/use-club';

export default function InvitationsPage() {
  const { clubId, data: club, can } = useClub();
  const qc = useQueryClient();
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [days, setDays] = useState(14);
  const [roleId, setRoleId] = useState('');

  const invitations = useQuery({ queryKey: ['invitations', clubId], queryFn: () => api.clubs.invitations(clubId), enabled: can('members.invite') });
  const roles = useQuery({ queryKey: ['roles', clubId], queryFn: () => api.clubs.roles(clubId), enabled: can('members.roles.assign') });

  const create = useMutation({
    mutationFn: () => api.clubs.createInvitation(clubId, { email: email.trim() || undefined, maxUses, expiresInDays: days, roleId: roleId || undefined }),
    onMutate: () => setError(null),
    onSuccess: (inv) => {
      setCreated(inv);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['invitations', clubId] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.clubs.revokeInvitation(clubId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', clubId] }),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!can('members.invite')) return <Alert variant="destructive">You don’t have permission to manage invitations.</Alert>;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Invitations</h1>
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="font-semibold">Create an invitation</h2>
          <form
            className="grid gap-4 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field id="inv-email" label="Restrict to email (optional)" hint="Only this verified email can use it">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="inv-uses" label="Max uses">
              <Input type="number" min={1} max={1000} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
            </Field>
            <Field id="inv-days" label="Expires in (days)">
              <Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </Field>
            {can('members.roles.assign') && roles.data ? (
              <Field id="inv-role" label="Role on joining">
                <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">Member</option>
                  {roles.data
                    .filter((r) => !r.isOwner && r.systemKey !== 'MEMBER')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : (
              <div />
            )}
            <div className="md:col-span-4">
              <Button type="submit" loading={create.isPending}>
                Create invitation
              </Button>
            </div>
          </form>
          {error && <Alert variant="destructive">{error}</Alert>}
          {created && (
            <Alert variant="success">
              <p className="font-semibold">Invitation created. Copy it now; the code won’t be shown again.</p>
              <p className="mt-2 break-all font-mono text-base text-foreground">{created.code}</p>
              <p className="mt-1 break-all text-xs">
                Link: {siteUrl}/clubs/{club?.slug}?invite={created.code}
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void navigator.clipboard?.writeText(created.code)}>
                Copy code
              </Button>
            </Alert>
          )}
        </CardContent>
      </Card>

      {invitations.isLoading ? (
        <Spinner />
      ) : !invitations.data?.length ? (
        <EmptyState title="No invitations yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Recipient</Th>
              <Th>Uses</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {invitations.data.map((i) => {
              const expired = new Date(i.expiresAt) < new Date();
              const active = !i.revokedAt && !expired && i.useCount < i.maxUses;
              return (
                <tr key={i.id}>
                  <Td className="font-mono">{i.codeHint}…</Td>
                  <Td>{i.email ?? i.phone ?? 'Anyone with the code'}</Td>
                  <Td>
                    {i.useCount} / {i.maxUses}
                  </Td>
                  <Td>{new Date(i.expiresAt).toLocaleDateString()}</Td>
                  <Td>{i.revokedAt ? <Badge variant="destructive">Revoked</Badge> : expired ? <Badge variant="secondary">Expired</Badge> : i.useCount >= i.maxUses ? <Badge variant="secondary">Used</Badge> : <Badge variant="success">Active</Badge>}</Td>
                  <Td className="text-right">
                    {active && (
                      <Button size="sm" variant="outline" onClick={() => revoke.mutate(i.id)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
