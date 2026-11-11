'use client';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';

/** Inline "action with mandatory reason" control. Reasons are recorded in the audit log. */
export function StatusAction({ label, variant = 'outline', onConfirm }: { label: string; variant?: 'outline' | 'destructive' | 'default'; onConfirm: (reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onConfirm(reason.trim());
          setOpen(false);
          setReason('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input aria-label="Reason" placeholder="Reason (required)" className="h-9 w-48" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required autoFocus />
      <Button size="sm" variant={variant} loading={busy} disabled={reason.trim().length < 3}>
        Confirm
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
