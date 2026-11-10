'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '@walktogether/api-client';
import { passwordSchema } from '@walktogether/validation';
import { Alert, Button, Field, Input } from '@walktogether/ui';
import { publicApi } from '@/lib/public-api';

export const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof resetFormSchema>>({ resolver: zodResolver(resetFormSchema) });

  if (!token) return <Alert variant="destructive" className="mt-6">This reset link is missing its token. Request a new one from the app.</Alert>;
  if (done)
    return (
      <Alert variant="success" className="mt-6">
        Password updated. Sign in again in the app with your new password.
      </Alert>
    );

  const onSubmit = handleSubmit(async ({ password }) => {
    setServerError(null);
    try {
      await publicApi.auth.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      {serverError && <Alert variant="destructive">{serverError}</Alert>}
      <Field id="password" label="New password" error={formState.errors.password?.message} hint="At least 10 characters with letters and numbers">
        <Input type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      <Field id="confirm" label="Confirm password" error={formState.errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...register('confirm')} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
