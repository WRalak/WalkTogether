import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { campaignSchema, sponsorSchema } from '@walktogether/validation';
import { formatMoney } from '@walktogether/shared-utils';
import { Badge, Button, Card, Loading, SectionTitle, TextField } from '@/components/ui';
import { Chips, DateTimeField, Notice, StatTile } from '@/components/admin';
import { Screen } from '@/components/screen';
import { PayFlow } from '@/features/admin/pay-flow';
import { api } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? null : r.error!.issues.map((i) => i.message).join('\n'));

function NewCampaign({ sponsorId, onCreated }: { sponsorId: string; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', budget: '50000', currency: 'KES' as 'KES' | 'USD', start: new Date(), end: new Date(Date.now() + 30 * 86_400_000), terms: '', prize: '', targetKm: '100', capKm: '20' });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const create = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        type: 'CHALLENGE' as const,
        budgetMinor: Math.round(Number(f.budget) * 100),
        currency: f.currency,
        startsAt: f.start.toISOString(),
        endsAt: f.end.toISOString(),
        terms: f.terms.trim(),
        prizeDescription: f.prize.trim() || null,
        challengeConfig: { title: f.name.trim(), metric: 'DISTANCE_M' as const, activityTypes: ['WALK', 'RUN'] as ('WALK' | 'RUN')[], target: Math.round(Number(f.targetKm) * 1000), maxDailyDistanceM: Math.round(Number(f.capKm) * 1000) },
      };
      const problem = issues(campaignSchema.safeParse(body));
      if (problem) throw new Error(problem);
      return api.sponsorships.createCampaign(sponsorId, body);
    },
    onMutate: () => setError(null),
    onSuccess: onCreated,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Card>
      <Text className="mb-3 text-base font-bold text-ink">New sponsored challenge</Text>
      {error ? <Notice>{error}</Notice> : null}
      <TextField label="Challenge name" value={f.name} onChangeText={(t) => set('name', t)} />
      <Chips label="Currency" value={f.currency} options={[{ key: 'KES', label: 'KES' }, { key: 'USD', label: 'USD' }]} onChange={(c) => set('currency', c)} />
      <TextField label="Budget" value={f.budget} keyboardType="decimal-pad" onChangeText={(t) => set('budget', t)} />
      <DateTimeField label="Starts" value={f.start} onChange={(d) => set('start', d)} />
      <DateTimeField label="Ends" value={f.end} minimumDate={f.start} onChange={(d) => set('end', d)} />
      <TextField label="Distance goal (km)" value={f.targetKm} keyboardType="decimal-pad" onChangeText={(t) => set('targetKm', t)} />
      <TextField label="Daily distance cap (km)" value={f.capKm} keyboardType="decimal-pad" hint="Keeps the competition safe and fair" onChangeText={(t) => set('capKm', t)} />
      <TextField label="Prizes" value={f.prize} onChangeText={(t) => set('prize', t)} />
      <TextField label="Terms, eligibility & data use" value={f.terms} multiline hint="Shown to every participant, who must accept them to join (at least 50 characters)." onChangeText={(t) => set('terms', t)} style={{ minHeight: 120, textAlignVertical: 'top' }} />
      <Button title="Create draft" loading={create.isPending} onPress={() => create.mutate()} />
    </Card>
  );
}

function Report({ data }: { data: Record<string, unknown> }) {
  const ch = data.challenge as { participants: number; completed: number; completionRate: number; totalProgress: number } | undefined;
  const ev = data.events as { offered: number; accepted: number; going: number; attended: number } | undefined;
  return (
    <View className="mt-3 flex-row flex-wrap gap-3">
      {ch && (
        <>
          <StatTile label="Participants" value={ch.participants} />
          <StatTile label="Completed" value={ch.completed} hint={`${ch.completionRate}%`} />
          <StatTile label="Total distance" value={`${Math.round(ch.totalProgress / 1000)} km`} />
        </>
      )}
      {ev && (
        <>
          <StatTile label="Events accepted" value={`${ev.accepted}/${ev.offered}`} />
          <StatTile label="Attended" value={ev.attended} hint={`${ev.going} going`} />
        </>
      )}
      {!ch && !ev && <Text className="text-sm text-ink-muted">No activity yet.</Text>}
    </View>
  );
}

/** Organisations sponsor challenges and events. Everything is labelled and reviewed by WalkTogether before going live. */
export default function SponsorPortal() {
  const mine = useQuery({ queryKey: ['my-sponsors'], queryFn: () => api.sponsorships.mine() });
  const [apply, setApply] = useState({ name: '', contactEmail: '', websiteUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, Record<string, unknown>>>({});
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onMutate: () => setError(null), onSuccess: () => void mine.refetch(), onError: (e) => setError(errorMessage(e)) });

  if (mine.isLoading) return <Loading />;
  const sponsor = mine.data?.[0];

  return (
    <Screen edges={[]} refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()}>
      <Stack.Screen options={{ title: 'Sponsor portal' }} />
      <Text className="mb-3 text-sm text-ink-muted">Sponsor challenges and community events. Sponsored content is always labelled and reviewed by WalkTogether before it goes live. Sponsors only ever receive aggregated reports.</Text>
      {error ? <Notice>{error}</Notice> : null}
      {!sponsor ? (
        <Card>
          <TextField label="Organisation name" value={apply.name} onChangeText={(name) => setApply({ ...apply, name })} />
          <TextField label="Contact email" value={apply.contactEmail} keyboardType="email-address" autoCapitalize="none" onChangeText={(contactEmail) => setApply({ ...apply, contactEmail })} />
          <TextField label="Website (optional)" value={apply.websiteUrl} keyboardType="url" autoCapitalize="none" onChangeText={(websiteUrl) => setApply({ ...apply, websiteUrl })} />
          <Button
            title="Apply as a sponsor"
            loading={act.isPending}
            onPress={() =>
              act.mutate(() => {
                const body = { name: apply.name.trim(), slug: slugify(apply.name), contactEmail: apply.contactEmail.trim(), websiteUrl: apply.websiteUrl.trim() || null };
                const problem = issues(sponsorSchema.safeParse(body));
                if (problem) throw new Error(problem);
                return api.sponsorships.apply(body);
              })
            }
          />
        </Card>
      ) : (
        <>
          <Card className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink">{sponsor.name}</Text>
            <Badge tone={sponsor.status === 'ACTIVE' ? 'primary' : 'warning'} label={sponsor.status.replace('_', ' ').toLowerCase()} />
          </Card>
          {sponsor.status !== 'ACTIVE' && <View className="mt-3"><Notice tone="info">WalkTogether reviews new sponsors before they can create campaigns.</Notice></View>}
          {sponsor.status === 'ACTIVE' && (
            <View className="mt-4">
              <NewCampaign sponsorId={sponsor.id} onCreated={() => void mine.refetch()} />
            </View>
          )}
          <SectionTitle>Campaigns</SectionTitle>
          <View className="gap-3">
            {sponsor.campaigns.map((c) => (
              <Card key={c.id}>
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="flex-1 text-base font-semibold text-ink">{c.name}</Text>
                  <Badge label={c.status.replace('_', ' ').toLowerCase()} />
                  <Badge tone={c.paidAt ? 'primary' : 'warning'} label={c.paidAt ? 'Paid' : 'Unpaid'} />
                </View>
                <Text className="mt-1 text-sm text-ink-muted">Budget {formatMoney(c.budgetMinor, c.currency)}</Text>
                {c.reviewNote ? <Text className="mt-1 text-sm text-ink-muted">Review note: {c.reviewNote}</Text> : null}
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {(c.status === 'DRAFT' || c.status === 'REJECTED') && <Button title="Submit for review" className="min-h-[40px]" onPress={() => act.mutate(() => api.sponsorships.submit(c.id))} />}
                  {!c.paidAt && ['PENDING_REVIEW', 'APPROVED'].includes(c.status) && <Button title="Pay budget" variant="outline" className="min-h-[40px]" onPress={() => setPaying(c.id)} />}
                  <Button
                    title="Report"
                    variant="outline"
                    className="min-h-[40px]"
                    onPress={() => act.mutate(() => api.sponsorships.report(c.id).then((rep) => setReports((r) => ({ ...r, [c.id]: rep }))))}
                  />
                </View>
                {paying === c.id && (
                  <View className="mt-3">
                    <PayFlow start={(provider, phone, key) => api.sponsorships.checkout(c.id, { provider, phone }, key)} onDone={() => void mine.refetch()} />
                  </View>
                )}
                {reports[c.id] && <Report data={reports[c.id]!} />}
              </Card>
            ))}
            {!sponsor.campaigns.length && <Text className="text-sm text-ink-muted">No campaigns yet.</Text>}
          </View>
        </>
      )}
    </Screen>
  );
}
