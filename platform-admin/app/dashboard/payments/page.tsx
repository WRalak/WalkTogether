'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, Select } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { Button, DataTable, money, Section, StatusBadge, useAction } from '@/features/ui';

const STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

export default function PaymentsAdmin() {
  const [status, setStatus] = useState('');
  const payments = useQuery({ queryKey: ['admin-payments', status], queryFn: () => adminApi.payments.list(status || undefined) });
  const { run, ErrorBox } = useAction();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments</h1>
      <p className="text-sm text-muted-foreground">
        Payments are confirmed only by verified provider callbacks. M-Pesa refunds are reversals and complete asynchronously.
      </p>
      <ErrorBox />
      <Field id="pay-status" label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
          <option value="">All</option>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {st.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>
      <Section title="Payments">
        <DataTable
          rows={payments.data}
          columns={[
            { label: 'Date', render: (p) => new Date(String(p.createdAt)).toLocaleString() },
            { label: 'Payer', render: (p) => `@${(p.payer as { username: string }).username}` },
            { label: 'Purpose', render: (p) => String(p.purpose).toLowerCase() },
            { label: 'Amount', render: (p) => money(Number(p.amountMinor), String(p.currency)) },
            { label: 'Provider', render: (p) => String(p.provider) },
            { label: 'Status', render: (p) => <StatusBadge value={String(p.status)} /> },
            {
              label: '',
              render: (p) =>
                p.status === 'SUCCEEDED' ? (
                  <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt('Refund reason'); if (reason) void run(async () => { await adminApi.payments.refund(String(p.id), Number(p.amountMinor), reason); void payments.refetch(); }); }}>
                    Refund
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
    </div>
  );
}
