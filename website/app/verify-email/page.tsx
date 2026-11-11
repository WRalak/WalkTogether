import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from '@/features/auth/verify-email';

export const metadata: Metadata = { title: 'Verify email', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <div className="container max-w-md py-20">
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}
