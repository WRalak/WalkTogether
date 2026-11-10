'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Spinner } from '@walktogether/ui';
import { publicApi } from '@/lib/public-api';

export function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(token ? 'loading' : 'error');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // tokens are single-use; never submit twice (e.g. React strict mode)
    publicApi.auth
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [token]);

  if (state === 'loading') return <Spinner label="Verifying your email" />;
  if (state === 'ok')
    return (
      <Alert variant="success">
        <p className="font-semibold">Email verified 🎉</p>
        <p>You can return to the WalkTogether app.</p>
      </Alert>
    );
  return (
    <Alert variant="destructive">
      <p className="font-semibold">This link is invalid or has expired.</p>
      <p>Request a new verification email from the app (Settings → Account).</p>
    </Alert>
  );
}
