'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, CardContent, EmptyState, Spinner, Stat, Table, Td, Th } from '@walktogether/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { dashboardHref, useClub } from '@/features/clubs/use-club';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function AttendancePage() {
  const { clubId, can } = useClub();
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(() => iso(new Date()));
  const q = useQuery({
    queryKey: ['attendance-report', clubId, from, to],
    queryFn: () => api.reports.attendance(clubId, { from, to: `${to}T23:59:59.999Z` }),
    enabled: can('analytics.view') && !!from && !!to,
  });
  if (!can('analytics.view')) return <Alert variant="destructive">You don’t have permission to view attendance reports.</Alert>;

  const rows = q.data ?? [];
  const totals = rows.reduce((acc, r) => ({ going: acc.going + r.going, attended: acc.attended + r.attended }), { going: 0, attended: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
          <p className="text-sm text-muted-foreground">Check-ins per event. Open an event to mark attendance or export its register as CSV.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">To</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3" />
          </label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Events" value={String(rows.length)} />
        <Stat label="Check-ins" value={String(totals.attended)} />
        <Stat label="Attendance rate" value={totals.going ? `${Math.round((totals.attended / totals.going) * 100)}%` : '—'} hint="Checked in ÷ RSVP’d going" />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Alert variant="destructive">{errorMessage(q.error)}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title="No events in this period" description="Choose a different date range, or create an event." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>Going</Th>
                  <Th>Attended</Th>
                  <Th>Rate</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={dashboardHref(clubId, `/events/${r.id}`)} className="font-medium text-primary hover:underline">
                        {r.title}
                      </Link>
                    </Td>
                    <Td>{new Date(r.startsAt).toLocaleDateString()}</Td>
                    <Td>{r.status.toLowerCase()}</Td>
                    <Td>
                      {r.going}
                      {r.capacity ? ` / ${r.capacity}` : ''}
                    </Td>
                    <Td>{r.attended}</Td>
                    <Td>{r.rate != null ? `${r.rate}%` : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
