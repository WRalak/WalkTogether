'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardContent, Field, Input, Select, Spinner, Textarea } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { money, PayFlow } from '@/features/billing/pay';

function NewCampaign({ sponsorId, onCreated }: { sponsorId: string; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', budget: '50000', currency: 'KES', start: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), terms: '', prize: '', targetKm: '100', capKm: '20' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardContent className="grid gap-4 p-6 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">New sponsored challenge</h2>
        {error && <Alert variant="destructive" className="md:col-span-2">{error}</Alert>}
        <Field id="cp-name" label="Campaign / challenge name">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field id="cp-budget" label="Budget">
          <div className="flex gap-2">
            <Select aria-label="Currency" value={f.currency} onChange={set('currency')} className="w-24">
              <option>KES</option>
              <option>USD</option>
            </Select>
            <Input type="number" min={1} value={f.budget} onChange={set('budget')} />
          </div>
        </Field>
        <Field id="cp-start" label="Starts">
          <Input type="date" value={f.start} onChange={set('start')} />
        </Field>
        <Field id="cp-end" label="Ends">
          <Input type="date" value={f.end} onChange={set('end')} />
        </Field>
        <Field id="cp-target" label="Distance goal (km)">
          <Input type="number" min={1} value={f.targetKm} onChange={set('targetKm')} />
        </Field>
        <Field id="cp-cap" label="Daily distance cap (km)" hint="Keeps the competition safe and fair">
          <Input type="number" min={1} max={100} value={f.capKm} onChange={set('capKm')} />
        </Field>
        <div className="md:col-span-2">
          <Field id="cp-prize" label="Prizes">
            <Input value={f.prize} onChange={set('prize')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field id="cp-terms" label="Competition terms, eligibility & data use" hint="Shown to every participant, who must accept them to join.">
            <Textarea rows={5} value={f.terms} onChange={set('terms')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={async () => {
              setError(null);
              try {
                await api.sponsorships.createCampaign(sponsorId, {
                  name: f.name,
                  type: 'CHALLENGE',
                  budgetMinor: Math.round(Number(f.budget) * 100),
                  currency: f.currency,
                  startsAt: new Date(f.start).toISOString(),
                  endsAt: new Date(`${f.end}T23:59:59`).toISOString(),
                  terms: f.terms,
                  prizeDescription: f.prize || null,
                  challengeConfig: { title: f.name, metric: 'DISTANCE_M', activityTypes: ['WALK', 'RUN'], target: Math.round(Number(f.targetKm) * 1000), maxDailyDistanceM: Math.round(Number(f.capKm) * 1000) },
                });
                onCreated();
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Create draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SponsorPortal() {
  const mine = useQuery({ queryKey: ['my-sponsors'], queryFn: () => api.sponsorships.mine() });
  const [apply, setApply] = useState({ name: '', slug: '', contactEmail: '', websiteUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  if (mine.isLoading) return <Spinner />;
  const sponsor = mine.data?.[0];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sponsor portal</h1>
      <p className="text-sm text-muted-foreground">Sponsor challenges and community events. All sponsored content is clearly labelled and reviewed by WalkTogether before it goes live.</p>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!sponsor ? (
        <Card>
          <CardContent className="grid gap-4 p-6 md:grid-cols-2">
            <Field id="sp-name" label="Organisation name">
              <Input value={apply.name} onChange={(e) => setApply({ ...apply, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} />
            </Field>
            <Field id="sp-email" label="Contact email">
              <Input type="email" value={apply.contactEmail} onChange={(e) => setApply({ ...apply, contactEmail: e.target.value })} />
            </Field>
            <Field id="sp-web" label="Website">
              <Input type="url" value={apply.websiteUrl} onChange={(e) => setApply({ ...apply, websiteUrl: e.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <Button onClick={() => api.sponsorships.apply({ ...apply, websiteUrl: apply.websiteUrl || null }).then(() => mine.refetch()).catch((e) => setError(errorMessage(e)))}>Apply as a sponsor</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <p className="font-semibold">{sponsor.name}</p>
              <Badge variant={sponsor.status === 'ACTIVE' ? 'success' : 'warning'}>{sponsor.status.replace('_', ' ').toLowerCase()}</Badge>
            </CardContent>
          </Card>
          {sponsor.status === 'ACTIVE' && <NewCampaign sponsorId={sponsor.id} onCreated={() => void mine.refetch()} />}
          {sponsor.campaigns.map((c) => (
            <Card key={c.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{c.name}</p>
                  <Badge variant="secondary">{c.status.replace('_', ' ').toLowerCase()}</Badge>
                  {c.paidAt ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Unpaid</Badge>}
                  <span className="ml-auto text-sm">{money(c.budgetMinor, c.currency)}</span>
                </div>
                {c.reviewNote && <p className="text-sm text-muted-foreground">Review note: {c.reviewNote}</p>}
                <div className="flex flex-wrap gap-2">
                  {(c.status === 'DRAFT' || c.status === 'REJECTED') && (
                    <Button size="sm" onClick={() => api.sponsorships.submit(c.id).then(() => mine.refetch()).catch((e) => setError(errorMessage(e)))}>
                      Submit for review
                    </Button>
                  )}
                  {!c.paidAt && ['PENDING_REVIEW', 'APPROVED'].includes(c.status) && (
                    <Button size="sm" variant="outline" onClick={() => setPaying(c.id)}>
                      Pay budget
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => api.sponsorships.report(c.id).then(setReport).catch((e) => setError(errorMessage(e)))}>
                    View report
                  </Button>
                </div>
                {paying === c.id && <PayFlow start={(provider, phone, key) => api.sponsorships.checkout(c.id, { provider, phone }, key)} onDone={() => void mine.refetch()} />}
              </CardContent>
            </Card>
          ))}
          {report && (
            <Card>
              <CardContent className="p-5">
                <h2 className="mb-2 font-semibold">Campaign report (aggregated)</h2>
                <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(report, null, 2)}</pre>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
