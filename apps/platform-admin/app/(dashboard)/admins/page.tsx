'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Field, Input, Select } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { Button, DataTable, Section, StatusBadge, useAction } from '@/features/ui';

export default function AdminsPage() {
  const q = useQuery({ queryKey: ['admins'], queryFn: () => adminApi.admins.list() });
  const { run, busy, ErrorBox } = useAction();
  const [f, setF] = useState({ email: '', displayName: '', roleKey: 'SUPPORT', password: '' });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Administrators</h1>
      <ErrorBox />
      <Section title="Add administrator">
        <p className="text-sm text-muted-foreground">Share the initial password out-of-band. Two-factor authentication is enforced at first sign-in.</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Field id="ad-email" label="Email">
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field id="ad-name" label="Name">
            <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </Field>
          <Field id="ad-role" label="Role">
            <Select value={f.roleKey} onChange={(e) => setF({ ...f, roleKey: e.target.value })}>
              <option value="SUPPORT">Support</option>
              <option value="MODERATOR">Moderator</option>
              <option value="FINANCE">Finance</option>
              <option value="SUPER_ADMIN">Super admin</option>
            </Select>
          </Field>
          <Field id="ad-pw" label="Initial password (14+ chars)">
            <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        </div>
        <Button loading={busy} onClick={() => run(async () => { await adminApi.admins.create(f); setF({ email: '', displayName: '', roleKey: 'SUPPORT', password: '' }); void q.refetch(); })}>Create</Button>
      </Section>
      <Section title="Team">
        <DataTable
          rows={q.data}
          columns={[
            { label: 'Admin', render: (a) => `${a.displayName} <${a.email}>` },
            { label: 'Role', render: (a) => (a.role as { name: string }).name },
            { label: 'MFA', render: (a) => (a.mfaEnabledAt ? 'enrolled' : 'pending') },
            { label: 'Last sign-in', render: (a) => (a.lastLoginAt ? new Date(String(a.lastLoginAt)).toLocaleString() : '—') },
            { label: 'Status', render: (a) => <StatusBadge value={String(a.status)} /> },
            {
              label: '',
              render: (a) => (
                <Button size="sm" variant="outline" onClick={() => run(async () => { await adminApi.admins.setStatus(String(a.id), a.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'); void q.refetch(); })}>
                  {a.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                </Button>
              ),
            },
          ]}
        />
      </Section>
    </div>
  );
}
