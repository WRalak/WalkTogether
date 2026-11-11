'use client';
import { useQuery } from '@tanstack/react-query';
import { Spinner, Stat } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { JsonBlock, Section, StatusBadge } from '@/features/ui';

type Sys = { status: string; environment: string; uptimeSeconds: number; memoryMb: number; database: { ok: boolean; latencyMs?: number }; redis: { ok: boolean; latencyMs?: number }; queues: Record<string, unknown>; latestMigration: unknown; integrations: Record<string, unknown>; signals: { webhookErrors24h: number; pendingPayments: number; openReports: number } };

export default function SystemPage() {
  const q = useQuery({ queryKey: ['system'], queryFn: () => adminApi.system() as Promise<Sys>, refetchInterval: 30_000 });
  if (!q.data) return <Spinner />;
  const s = q.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">System health</h1>
        <StatusBadge value={s.status} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Database" value={s.database.ok ? `${s.database.latencyMs} ms` : 'DOWN'} />
        <Stat label="Redis" value={s.redis.ok ? `${s.redis.latencyMs} ms` : 'DOWN'} />
        <Stat label="Uptime" value={`${Math.round(s.uptimeSeconds / 3600)} h`} hint={`${s.environment} · ${s.memoryMb} MB RSS`} />
        <Stat label="Pending payments" value={s.signals.pendingPayments} hint={`${s.signals.webhookErrors24h} webhook errors (24h) · ${s.signals.openReports} open reports`} />
      </div>
      <Section title="Queues">
        <JsonBlock value={s.queues} />
      </Section>
      <Section title="Integrations">
        <JsonBlock value={s.integrations} />
      </Section>
      <Section title="Latest migration">
        <JsonBlock value={s.latestMigration} />
      </Section>
    </div>
  );
}
