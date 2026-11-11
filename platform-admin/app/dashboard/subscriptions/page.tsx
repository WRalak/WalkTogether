'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ENTITLEMENTS, type EntitlementKey } from '@walktogether/shared-types';
import { Field, Input, Select } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { Button, DataTable, money, Section, StatusBadge, useAction } from '@/features/ui';

type Plan = { id: string; code: string; audience: string; name: string; currency: string; amountMinor: number; interval: string; trialDays: number; graceDays: number; isActive: boolean; isDefault: boolean; entitlements: { key: string; intLimit: number | null; boolValue: boolean | null }[]; _count: { subscriptions: number } };

function PlanEditor({ plan, onSaved }: { plan?: Plan; onSaved: () => void }) {
  const { run, busy, ErrorBox } = useAction();
  const [f, setF] = useState({
    code: plan?.code ?? '',
    audience: plan?.audience ?? 'CLUB',
    name: plan?.name ?? '',
    currency: plan?.currency ?? 'KES',
    amount: plan ? String(plan.amountMinor / 100) : '',
    interval: plan?.interval ?? 'MONTH',
    trialDays: String(plan?.trialDays ?? 0),
    graceDays: String(plan?.graceDays ?? 7),
    isActive: plan?.isActive ?? false,
    ent: Object.fromEntries((plan?.entitlements ?? []).map((e) => [e.key, e.intLimit ?? e.boolValue])) as Record<string, number | boolean | null>,
  });
  const keys = (Object.keys(ENTITLEMENTS) as EntitlementKey[]).filter((k) => (ENTITLEMENTS[k].audience === 'CLUB') === (f.audience === 'CLUB'));
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <ErrorBox />
      <div className="grid gap-3 md:grid-cols-4">
        {!plan && (
          <Field id="pl-code" label="Code">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="club_pro_ke" />
          </Field>
        )}
        {!plan && (
          <Field id="pl-aud" label="Audience">
            <Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
              <option value="CLUB">Club</option>
              <option value="INDIVIDUAL">Individual</option>
            </Select>
          </Field>
        )}
        <Field id="pl-name" label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field id="pl-cur" label="Currency">
          <Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </Field>
        <Field id="pl-amt" label="Price">
          <Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field id="pl-int" label="Billing period">
          <Select value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value })}>
            <option value="MONTH">Monthly</option>
            <option value="YEAR">Yearly</option>
          </Select>
        </Field>
        <Field id="pl-trial" label="Trial days">
          <Input type="number" min={0} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} />
        </Field>
        <Field id="pl-grace" label="Grace days">
          <Input type="number" min={0} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} />
        </Field>
      </div>
      <fieldset className="grid gap-2 md:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Entitlements</legend>
        {keys.map((k) =>
          ENTITLEMENTS[k].kind === 'limit' ? (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Input type="number" min={0} className="h-8 w-24" value={String(f.ent[k] ?? '')} onChange={(e) => setF({ ...f, ent: { ...f.ent, [k]: e.target.value === '' ? null : Number(e.target.value) } })} />
              {ENTITLEMENTS[k].label}
            </label>
          ) : (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.ent[k] === true} onChange={(e) => setF({ ...f, ent: { ...f.ent, [k]: e.target.checked } })} />
              {ENTITLEMENTS[k].label}
            </label>
          ),
        )}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active (visible and purchasable)
      </label>
      <Button
        loading={busy}
        onClick={() =>
          run(async () => {
            const body = {
              name: f.name,
              currency: f.currency,
              amountMinor: Math.round(Number(f.amount || 0) * 100),
              interval: f.interval,
              trialDays: Number(f.trialDays),
              graceDays: Number(f.graceDays),
              isActive: f.isActive,
              entitlements: Object.entries(f.ent)
                .filter(([k, v]) => v !== null && v !== undefined && keys.includes(k as EntitlementKey))
                .map(([key, v]) => (typeof v === 'number' ? { key, intLimit: v } : { key, boolValue: v })),
            };
            if (plan) await adminApi.plans.update(plan.id, body);
            else await adminApi.plans.create({ ...body, code: f.code, audience: f.audience });
            onSaved();
          })
        }
      >
        Save plan
      </Button>
    </div>
  );
}

export default function SubscriptionsAdmin() {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => adminApi.plans.list() as Promise<Plan[]> });
  const promos = useQuery({ queryKey: ['admin-promos'], queryFn: () => adminApi.promotions.list() });
  const [filter, setFilter] = useState({ status: '', audience: '' });
  const subscriptions = useQuery({
    queryKey: ['admin-subscriptions', filter],
    queryFn: () => adminApi.subscriptions.list({ status: filter.status || undefined, audience: (filter.audience || undefined) as 'CLUB' | 'INDIVIDUAL' | undefined }),
  });
  const [grant, setGrant] = useState({ planId: '', subjectId: '' });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [promo, setPromo] = useState({ code: '', percentOff: '', maxRedemptions: '' });
  const { run, ErrorBox } = useAction();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Subscriptions</h1>
      <p className="text-sm text-muted-foreground">Plans and prices are configured here — never hardcoded. Basic tracking is always free.</p>
      <ErrorBox />
      <Section title="Subscription plans" action={<Button size="sm" onClick={() => setEditing('new')}>New plan</Button>}>
        {editing === 'new' && <PlanEditor onSaved={() => { setEditing(null); void plans.refetch(); }} />}
        <DataTable
          rows={plans.data}
          columns={[
            { label: 'Plan', render: (p) => `${p.name} (${p.code})` },
            { label: 'Audience', render: (p) => p.audience.toLowerCase() },
            { label: 'Price', render: (p) => (p.amountMinor ? `${money(p.amountMinor, p.currency)} / ${p.interval.toLowerCase()}` : 'Free') },
            { label: 'Status', render: (p) => <StatusBadge value={p.isDefault ? 'default' : p.isActive ? 'ACTIVE' : 'inactive'} /> },
            { label: 'Live subs', render: (p) => p._count.subscriptions },
            { label: '', render: (p) => <Button size="sm" variant="outline" onClick={() => setEditing(editing === p.id ? null : p.id)}>Edit</Button> },
          ]}
        />
        {plans.data?.filter((p) => p.id === editing).map((p) => <PlanEditor key={p.id} plan={p} onSaved={() => { setEditing(null); void plans.refetch(); }} />)}
      </Section>
      <Section title="Promotions">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="pr-code" label="Code">
            <Input value={promo.code} onChange={(e) => setPromo({ ...promo, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field id="pr-pct" label="% off">
            <Input type="number" min={1} max={100} value={promo.percentOff} onChange={(e) => setPromo({ ...promo, percentOff: e.target.value })} />
          </Field>
          <Field id="pr-max" label="Max uses">
            <Input type="number" min={1} value={promo.maxRedemptions} onChange={(e) => setPromo({ ...promo, maxRedemptions: e.target.value })} />
          </Field>
          <Button onClick={() => run(async () => { await adminApi.promotions.save(promo.code, { percentOff: Number(promo.percentOff), maxRedemptions: promo.maxRedemptions ? Number(promo.maxRedemptions) : null }); void promos.refetch(); })}>Save</Button>
        </div>
        <DataTable rows={promos.data} columns={[{ label: 'Code', render: (p) => String(p.code) }, { label: 'Discount', render: (p) => (p.percentOff ? `${p.percentOff}%` : money(Number(p.amountOffMinor), 'KES')) }, { label: 'Used', render: (p) => `${p.redeemed}${p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}` }, { label: 'Active', render: (p) => (p.active ? 'yes' : 'no') }]} />
      </Section>
      <Section title="Subscriptions">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="sub-status" label="Status">
            <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All</option>
              {['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELED', 'EXPIRED'].map((st) => (
                <option key={st} value={st}>
                  {st.toLowerCase().replace('_', ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="sub-aud" label="Audience">
            <Select value={filter.audience} onChange={(e) => setFilter({ ...filter, audience: e.target.value })}>
              <option value="">All</option>
              <option value="CLUB">Clubs</option>
              <option value="INDIVIDUAL">Individuals</option>
            </Select>
          </Field>
        </div>
        <DataTable
          rows={subscriptions.data}
          columns={[
            { label: 'Subscriber', render: (x) => (x.club ? <a className="text-primary hover:underline" href={`/dashboard/clubs/${x.club.id}`}>{x.club.name}</a> : x.user ? <a className="text-primary hover:underline" href={`/dashboard/users/${x.user.id}`}>@{x.user.username}</a> : '—') },
            { label: 'Plan', render: (x) => `${x.plan.name} (${x.plan.audience.toLowerCase()})` },
            { label: 'Price', render: (x) => (x.plan.amountMinor ? `${money(x.plan.amountMinor, x.plan.currency)} / ${x.plan.interval.toLowerCase()}` : 'Free') },
            { label: 'Status', render: (x) => <StatusBadge value={x.status} /> },
            { label: 'Renews / ends', render: (x) => `${new Date(x.currentPeriodEnd).toLocaleDateString()}${x.cancelAtPeriodEnd ? ' (cancels)' : ''}` },
          ]}
        />
      </Section>
      <Section title="Grant a plan">
        <p className="text-sm text-muted-foreground">Gives a club or member a plan without payment (pilots, partners, support). Every grant is audit-logged.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field id="gr-plan" label="Plan">
            <Select value={grant.planId} onChange={(e) => setGrant({ ...grant, planId: e.target.value })}>
              <option value="">Choose…</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.audience.toLowerCase()})
                </option>
              ))}
            </Select>
          </Field>
          <Field id="gr-subject" label={plans.data?.find((p) => p.id === grant.planId)?.audience === 'INDIVIDUAL' ? 'User ID' : 'Club ID'}>
            <Input value={grant.subjectId} onChange={(e) => setGrant({ ...grant, subjectId: e.target.value.trim() })} placeholder="UUID" />
          </Field>
          <Button
            disabled={!grant.planId || !grant.subjectId}
            onClick={() =>
              run(async () => {
                const individual = plans.data?.find((p) => p.id === grant.planId)?.audience === 'INDIVIDUAL';
                await adminApi.plans.grant(individual ? { planId: grant.planId, userId: grant.subjectId } : { planId: grant.planId, clubId: grant.subjectId });
                setGrant({ planId: '', subjectId: '' });
                void subscriptions.refetch();
              })
            }
          >
            Grant
          </Button>
        </div>
      </Section>
    </div>
  );
}
