'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { JsonBlock, Section, StatusBadge } from '@/features/ui';

export default function ClubDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['admin-club', id], queryFn: () => adminApi.clubs.get(id) });
  const audit = useQuery({ queryKey: ['admin-club-audit', id], queryFn: () => adminApi.auditLogs({ targetId: id, limit: 50 }) });
  if (!q.data) return <Spinner />;
  const c = q.data as Record<string, unknown> & { name: string; status: string };
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <StatusBadge value={c.status} />
      </div>
      <Section title="Club">
        <JsonBlock value={{ slug: c.slug, owner: c.owner, visibility: c.visibility, memberCount: c.memberCount, membershipBreakdown: c.membershipBreakdown, createdAt: c.createdAt, suspensionReason: c.suspensionReason }} />
      </Section>
      <Section title="Audit trail">
        <JsonBlock value={audit.data?.items.map((a) => ({ at: a.createdAt, action: a.action, actor: `${a.actorType}:${a.actorId ?? ''}` }))} />
      </Section>
    </div>
  );
}
