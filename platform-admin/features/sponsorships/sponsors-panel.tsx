'use client';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Button, DataTable, Section, StatusBadge, useAction } from '@/features/ui';

export function SponsorsPanel() {
  const sponsors = useQuery({ queryKey: ['admin-sponsors'], queryFn: () => adminApi.sponsors.list() });
  const { run, ErrorBox } = useAction();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Organisations must be approved before their campaigns can be reviewed.</p>
      <ErrorBox />
      <Section title="Sponsors">
        <DataTable
          rows={sponsors.data}
          columns={[
            { label: 'Sponsor', render: (s) => String(s.name) },
            { label: 'Owner', render: (s) => `@${(s.owner as { username: string }).username}` },
            { label: 'Contact', render: (s) => String(s.contactEmail) },
            { label: 'Status', render: (s) => <StatusBadge value={String(s.status)} /> },
            {
              label: '',
              render: (s) =>
                s.status === 'ACTIVE' ? (
                  <Button size="sm" variant="outline" onClick={() => run(async () => { await adminApi.sponsors.setStatus(String(s.id), 'SUSPENDED'); void sponsors.refetch(); })}>Suspend</Button>
                ) : (
                  <Button size="sm" onClick={() => run(async () => { await adminApi.sponsors.setStatus(String(s.id), 'ACTIVE'); void sponsors.refetch(); })}>Approve</Button>
                ),
            },
          ]}
        />
      </Section>
    </div>
  );
}
