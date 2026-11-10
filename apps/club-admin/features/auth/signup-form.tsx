'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, passwordSchema, usernameSchema } from '@walktogether/validation';
import { Alert, Button, Field, Input } from '@walktogether/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

const schema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(60),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'You must accept the terms' }),
});

export function SignupForm() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.auth.register({ ...values, device: { platform: 'web', deviceName: 'Club dashboard' } });
      await refreshUser();
      router.replace('/clubs/new');
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <Field id="displayName" label="Your name" error={formState.errors.displayName?.message}>
        <Input autoComplete="name" {...register('displayName')} />
      </Field>
      <Field id="username" label="Username" error={formState.errors.username?.message}>
        <Input autoComplete="username" {...register('username')} />
      </Field>
      <Field id="email" label="Email" error={formState.errors.email?.message}>
        <Input type="email" autoComplete="email" {...register('email')} />
      </Field>
      <Field id="password" label="Password" error={formState.errors.password?.message} hint="At least 10 characters with letters and numbers">
        <Input type="password" autoComplete="new-password" {...register('password')} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" {...register('acceptTerms')} />
        <span>
          I agree to the{' '}
          <a href={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/terms`} className="text-primary underline" target="_blank" rel="noreferrer">
            terms
          </a>{' '}
          and{' '}
          <a href={`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/privacy`} className="text-primary underline" target="_blank" rel="noreferrer">
            privacy policy
          </a>
          .
        </span>
      </label>
      {formState.errors.acceptTerms && <p className="text-sm text-destructive">{formState.errors.acceptTerms.message}</p>}
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
    </form>
  );
}
