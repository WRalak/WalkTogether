'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Alert, Button, Field, Input } from '@walktogether/ui';
import { adminApi } from '@/lib/api';
import { useAdminAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

type Step = { kind: 'password' } | { kind: 'mfa'; mfaToken: string; setup?: { secret: string; otpauthUrl: string } };

export function AdminLogin() {
  const router = useRouter();
  const { reload } = useAdminAuth();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
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

  if (step.kind === 'password') {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const res = await adminApi.auth.login(email.trim().toLowerCase(), password);
            setPassword('');
            const setup = res.mfaSetupRequired ? await adminApi.auth.setupMfa(res.mfaToken) : undefined;
            setStep({ kind: 'mfa', mfaToken: res.mfaToken, setup });
          });
        }}
      >
        {error && <Alert variant="destructive">{error}</Alert>}
        <Field id="email" label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="password" label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Continue
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await adminApi.auth.verifyMfa(step.mfaToken, code.trim());
          await reload();
          router.replace('/');
        });
      }}
    >
      {error && <Alert variant="destructive">{error}</Alert>}
      {step.setup ? (
        <div className="space-y-3">
          <p className="text-sm">
            Two-factor authentication is required. Scan this code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code.
          </p>
          <div className="flex justify-center rounded-lg bg-white p-4">
            <QRCodeSVG value={step.setup.otpauthUrl} size={180} />
          </div>
          <p className="break-all text-center font-mono text-xs text-muted-foreground">{step.setup.secret}</p>
        </div>
      ) : (
        <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
      )}
      <Field id="code" label="Verification code">
        <Input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
      </Field>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
        Verify and sign in
      </Button>
      <p className="text-xs text-muted-foreground">The sign-in step expires after 5 minutes.</p>
    </form>
  );
}
