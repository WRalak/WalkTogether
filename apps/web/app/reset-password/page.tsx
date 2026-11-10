import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <div className="container max-w-md py-20">
      <h1 className="text-3xl font-extrabold">Choose a new password</h1>
      <p className="mt-2 text-muted-foreground">You’ll be signed out of all devices after resetting.</p>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
