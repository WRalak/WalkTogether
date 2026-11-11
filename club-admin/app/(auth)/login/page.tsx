import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/features/auth/login-form';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" subtitle="Manage your club’s members, invitations and settings.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
