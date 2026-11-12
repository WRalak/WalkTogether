'use client';
import { useQuery } from '@tanstack/react-query';
import { Spinner, Stat } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { Button, DataTable, Section, useAction } from '@/features/ui';

type Sec = {
  failedLogins: number;
  lockedUsers: number;
  suspiciousLogins: Record<string, unknown>[];
  tokenReuse: Record<string, unknown>[];
  adminAuthFailures: Record<string, unknown>[];
  topFailingIps: { ip: string | null; failures: number }[];
  activeAdminSessions: { id: string; admin: string; ipAddress: string | null; lastUsedAt: string; expiresAt: string }[];
};

export default function SecurityPage() {
  const q = useQuery({ queryKey: ['security'], queryFn: () => adminApi.security() as Promise<Sec>, refetchInterval: 60_000 });
  const { run, ErrorBox } = useAction();
  if (!q.data) return <Spinner />;
  const s = q.data;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Security monitoring (7 days)</h1>
      <ErrorBox />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Failed sign-ins" value={s.failedLogins} />
        <Stat label="Locked accounts" value={s.lockedUsers} />
        <Stat label="Suspicious sign-ins" value={s.suspiciousLogins.length} />
        <Stat label="Token reuse detections" value={s.tokenReuse.length} />
      </div>
      <Section title="Top failing IPs">
        <DataTable
          rows={s.topFailingIps as unknown as Record<string, unknown>[]}
          columns={[
            { label: 'IP', render: (r) => String(r.ip ?? 'unknown') },
            { label: 'Failures', render: (r) => String(r.failures) },
          ]}
        />
      </Section>
      <Section title="Suspicious sign-ins">
        <DataTable
          rows={s.suspiciousLogins}
          columns={[
            { label: 'Time', render: (r) => new Date(String(r.createdAt)).toLocaleString() },
            { label: 'User', render: (r) => `@${(r.user as { username: string } | null)?.username ?? '?'}` },
            { label: 'IP', render: (r) => String(r.ipAddress ?? '') },
            { label: 'Method', render: (r) => String(r.method) },
          ]}
        />
      </Section>
      <Section title="Admin authentication failures">
        <DataTable
          rows={s.adminAuthFailures}
          columns={[
            { label: 'Time', render: (r) => new Date(String(r.createdAt)).toLocaleString() },
            { label: 'Action', render: (r) => String(r.action) },
            { label: 'IP', render: (r) => String(r.ipAddress ?? '') },
          ]}
        />
      </Section>
      <Section title="Active admin sessions">
        <DataTable
          rows={s.activeAdminSessions as unknown as Record<string, unknown>[]}
          columns={[
            { label: 'Admin', render: (r) => String(r.admin) },
            { label: 'IP', render: (r) => String(r.ipAddress ?? '') },
            { label: 'Last used', render: (r) => new Date(String(r.lastUsedAt)).toLocaleString() },
            {
              label: '',
              render: (r) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await adminApi.revokeAdminSession(String(r.id));
                      void q.refetch();
                    })
                  }
                >
                  Revoke
                </Button>
              ),
            },
          ]}
        />
      </Section>
    </div>
  );
}
