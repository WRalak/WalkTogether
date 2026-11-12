'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { StatusAction } from '@/features/status-action';
import { Button, DataTable, JsonBlock, money, Section, StatusBadge, useAction } from '@/features/ui';

export function CampaignsPanel() {
  const campaigns = useQuery({ queryKey: ['admin-campaigns'], queryFn: () => adminApi.campaigns.list() });
  const [report, setReport] = useState<unknown>(null);
  const { run, ErrorBox } = useAction();
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A campaign goes live only after it is paid and approved. Sponsored content is always labelled and participation needs consent.
      </p>
      <ErrorBox />
      <Section title="Campaigns">
        <DataTable
          rows={campaigns.data}
          columns={[
            { label: 'Campaign', render: (c) => `${c.name} (${String(c.type).toLowerCase()})` },
            { label: 'Sponsor', render: (c) => (c.sponsor as { name: string }).name },
            { label: 'Budget', render: (c) => money(Number(c.budgetMinor), String(c.currency)) },
            { label: 'Paid', render: (c) => (c.paidAt ? 'yes' : 'no') },
            { label: 'Status', render: (c) => <StatusBadge value={String(c.status)} /> },
            {
              label: '',
              render: (c) => (
                <div className="flex flex-wrap gap-2">
                  {c.status === 'PENDING_REVIEW' && (
                    <>
                      <StatusAction
                        label="Approve"
                        onConfirm={(note) =>
                          run(async () => {
                            await adminApi.campaigns.review(String(c.id), 'APPROVE', note);
                            void campaigns.refetch();
                          })
                        }
                      />
                      <StatusAction
                        label="Reject"
                        variant="destructive"
                        onConfirm={(note) =>
                          run(async () => {
                            await adminApi.campaigns.review(String(c.id), 'REJECT', note);
                            void campaigns.refetch();
                          })
                        }
                      />
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => run(async () => setReport(await adminApi.campaigns.report(String(c.id))))}>
                    Report
                  </Button>
                  {c.type === 'CHALLENGE' && ['ACTIVE', 'ENDED'].includes(String(c.status)) && (
                    <StatusAction label="Award top 3" onConfirm={(desc) => run(async () => setReport(await adminApi.campaigns.award(String(c.id), 3, desc)))} />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Section>
      {report !== null && (
        <Section title="Result">
          <JsonBlock value={report} />
        </Section>
      )}
    </div>
  );
}
