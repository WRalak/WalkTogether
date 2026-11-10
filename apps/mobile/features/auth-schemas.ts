import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema, usernameSchema } from '@walktogether/validation';

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });

export const registerFormSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(60),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/** Accepts local Kenyan formats (07…, 01…, 7…) and normalises to E.164 (+254…). */
export function normaliseKenyanPhone(input: string) {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('254')) return `+${digits}`;
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `+254${digits}`;
  return digits;
}

export const phoneFormSchema = z.object({ phone: z.string().transform(normaliseKenyanPhone).pipe(phoneSchema) });
