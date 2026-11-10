'use client';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardContent, Spinner, Table, Td, Th } from '@walktogether/ui';
import { errorMessage } from '@/lib/errors';

export { formatMoney as money, formatMoneyMap as fmtMoneyMap } from '@walktogether/shared-utils';

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function DataTable<T extends Record<string, unknown>>({ rows, columns, empty = 'Nothing here yet' }: { rows: T[] | undefined; columns: { label: string; render: (r: T) => React.ReactNode }[]; empty?: string }) {
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <thead>
        <tr>
          {columns.map((c) => (
            <Th key={c.label}>{c.label}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={(r.id as string) ?? i}>
            {columns.map((c) => (
              <Td key={c.label}>{c.render(r)}</Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const v = value.toUpperCase();
  const variant = ['ACTIVE', 'SUCCEEDED', 'APPROVED', 'FULFILLED', 'OK'].includes(v) ? 'success' : ['FAILED', 'SUSPENDED', 'REJECTED', 'CANCELLED', 'REFUNDED'].includes(v) ? 'destructive' : 'warning';
  return <Badge variant={variant}>{value.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

/** Runs an async admin action with inline error reporting. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const ErrorBox = () => (error ? <Alert variant="destructive">{error}</Alert> : null);
  return { run, busy, ErrorBox };
}

export function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export { Button };
