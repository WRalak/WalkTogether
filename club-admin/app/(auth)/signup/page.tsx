import { AuthShell } from '@/components/auth-shell';
import { SignupForm } from '@/features/auth/signup-form';

export const metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" subtitle="Then set up your club in under two minutes.">
      <SignupForm />
    </AuthShell>
  );
}
