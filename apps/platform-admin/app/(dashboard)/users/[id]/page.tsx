'use client';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { DataTable, JsonBlock, Section, StatusBadge } from '@/features/ui';

type U = Record<string, unknown> & { username: string; status: string; email: string | null; history: Record<string, unknown>[]; loginEvents: Record<string, unknown>[]; memberships: Record<string, unknown>[] };

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['admin-user', id], queryFn: () => adminApi.users.get(id) as Promise<U> });
  if (!q.data) return <Spinner />;
  const u = q.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">@{u.username}</h1>
        <StatusBadge value={u.status} />
      </div>
      <Section title="Account">
        <JsonBlock value={{ id: u.id, email: u.email, phone: u.phone, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, suspensionReason: u.suspensionReason, subscriptions: u.subscriptions, counts: u._count, reportsAgainst: u.reportsAgainst }} />
      </Section>
      <Section title="Club memberships">
        <DataTable rows={u.memberships} columns={[{ label: 'Club', render: (m) => (m.club as { name: string }).name }, { label: 'Role', render: (m) => (m.role as { name: string }).name }, { label: 'Status', render: (m) => <StatusBadge value={String(m.status)} /> }]} />
      </Section>
      <Section title="Account history (audit)">
        <DataTable rows={u.history} columns={[{ label: 'Time', render: (h) => new Date(String(h.createdAt)).toLocaleString() }, { label: 'Action', render: (h) => <code className="text-xs">{String(h.action)}</code> }, { label: 'Actor', render: (h) => String(h.actorType) }]} />
      </Section>
      <Section title="Recent sign-ins">
        <DataTable rows={u.loginEvents} columns={[{ label: 'Time', render: (e) => new Date(String(e.createdAt)).toLocaleString() }, { label: 'Method', render: (e) => String(e.method) }, { label: 'Result', render: (e) => (e.success ? 'success' : `failed (${e.failureReason})`) }, { label: 'Suspicious', render: (e) => (e.suspicious ? 'yes' : '') }, { label: 'IP', render: (e) => String(e.ipAddress ?? '') }]} />
      </Section>
    </div>
  );
}
