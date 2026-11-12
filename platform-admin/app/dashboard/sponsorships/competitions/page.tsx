'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { Button, DataTable, Section, StatusBadge, useAction } from '@/features/ui';

export default function ChallengesAdmin() {
  const list = useQuery({ queryKey: ['admin-challenges'], queryFn: () => adminApi.challenges.list() });
  const achievements = useQuery({ queryKey: ['admin-achievements'], queryFn: () => adminApi.achievements.list() });
  const { run, busy, ErrorBox } = useAction();
  const [f, setF] = useState({
    scope: 'PLATFORM',
    title: '',
    targetKm: '50',
    start: new Date().toISOString().slice(0, 10),
    end: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    clubIds: '',
    premium: false,
    capKm: '42',
    rules: '',
  });
  const [ach, setAch] = useState({ code: '', name: '', description: '', icon: '🏅', rule: '{"type":"total_distance","minM":250000}' });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Competitions & achievements</h1>
      <p className="text-sm text-muted-foreground">Platform-wide and club-vs-club challenges, plus the achievement badges awarded automatically by the server.</p>
      <ErrorBox />
      <Section title="Create platform challenge">
        <div className="grid gap-3 md:grid-cols-3">
          <Field id="ch-scope" label="Type">
            <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="PLATFORM">Platform-wide</option>
              <option value="CLUB_VS_CLUB">Club vs club</option>
            </Select>
          </Field>
          <Field id="ch-title" label="Title">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field id="ch-target" label="Distance goal (km, empty = ranking only)">
            <Input type="number" value={f.targetKm} onChange={(e) => setF({ ...f, targetKm: e.target.value })} />
          </Field>
          <Field id="ch-start" label="Starts">
            <Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </Field>
          <Field id="ch-end" label="Ends">
            <Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          </Field>
          <Field id="ch-cap" label="Daily cap (km)">
            <Input type="number" value={f.capKm} onChange={(e) => setF({ ...f, capKm: e.target.value })} />
          </Field>
          {f.scope === 'CLUB_VS_CLUB' && (
            <div className="md:col-span-3">
              <Field id="ch-clubs" label="Competing club IDs (comma separated)">
                <Input value={f.clubIds} onChange={(e) => setF({ ...f, clubIds: e.target.value })} />
              </Field>
            </div>
          )}
          <div className="md:col-span-3">
            <Field id="ch-rules" label="Rules">
              <Textarea rows={3} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.premium} onChange={(e) => setF({ ...f, premium: e.target.checked })} /> Premium members only
          </label>
        </div>
        <Button
          loading={busy}
          onClick={() =>
            run(async () => {
              await adminApi.challenges.create({
                scope: f.scope,
                title: f.title,
                metric: 'DISTANCE_M',
                activityTypes: ['WALK', 'RUN'],
                target: f.targetKm ? Math.round(Number(f.targetKm) * 1000) : null,
                startsAt: new Date(f.start).toISOString(),
                endsAt: new Date(`${f.end}T23:59:59`).toISOString(),
                maxDailyDistanceM: Math.round(Number(f.capKm) * 1000),
                rules: f.rules || null,
                isPremium: f.premium,
                ...(f.scope === 'CLUB_VS_CLUB'
                  ? {
                      clubIds: f.clubIds
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }
                  : {}),
              });
              void list.refetch();
            })
          }
        >
          Launch challenge
        </Button>
      </Section>
      <Section title="All challenges">
        <DataTable
          rows={list.data}
          columns={[
            { label: 'Title', render: (c) => String(c.title) },
            { label: 'Scope', render: (c) => String(c.scope).toLowerCase() },
            { label: 'Club', render: (c) => (c.club as { name: string } | null)?.name ?? '—' },
            { label: 'Participants', render: (c) => (c._count as { participants: number }).participants },
            { label: 'Status', render: (c) => <StatusBadge value={String(c.status)} /> },
            {
              label: '',
              render: (c) =>
                c.status === 'ACTIVE' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.confirm('Cancel this challenge?') &&
                      run(async () => {
                        await adminApi.challenges.cancel(String(c.id));
                        void list.refetch();
                      })
                    }
                  >
                    Cancel
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      <Section title="Achievements">
        <DataTable
          rows={achievements.data}
          columns={[
            { label: '', render: (a) => String(a.icon) },
            { label: 'Name', render: (a) => String(a.name) },
            { label: 'Rule', render: (a) => <code className="text-xs">{JSON.stringify(a.rule)}</code> },
            { label: 'Awarded', render: (a) => (a._count as { awards: number }).awards },
            { label: 'Active', render: (a) => (a.active ? 'yes' : 'no') },
          ]}
        />
        <div className="grid gap-3 md:grid-cols-5">
          <Field id="a-code" label="Code">
            <Input value={ach.code} onChange={(e) => setAch({ ...ach, code: e.target.value })} />
          </Field>
          <Field id="a-name" label="Name">
            <Input value={ach.name} onChange={(e) => setAch({ ...ach, name: e.target.value })} />
          </Field>
          <Field id="a-desc" label="Description">
            <Input value={ach.description} onChange={(e) => setAch({ ...ach, description: e.target.value })} />
          </Field>
          <Field id="a-icon" label="Icon">
            <Input value={ach.icon} onChange={(e) => setAch({ ...ach, icon: e.target.value })} />
          </Field>
          <Field
            id="a-rule"
            label="Rule (JSON)"
            hint="types: first_activity, single_distance, total_distance, activity_count, streak_days, challenges_completed, challenge_winner, events_attended, posts"
          >
            <Input value={ach.rule} onChange={(e) => setAch({ ...ach, rule: e.target.value })} />
          </Field>
        </div>
        <Button
          onClick={() =>
            run(async () => {
              await adminApi.achievements.save(ach.code, { name: ach.name, description: ach.description, icon: ach.icon, rule: JSON.parse(ach.rule) });
              void achievements.refetch();
            })
          }
        >
          Save achievement
        </Button>
      </Section>
    </div>
  );
}
