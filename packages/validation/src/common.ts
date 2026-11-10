import { z } from 'zod';

/** E.164 phone numbers, e.g. +254712345678 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone number must be in international format, e.g. +254712345678');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9](?:[a-z0-9_.]*[a-z0-9])?$/, 'Use letters, numbers, dots and underscores; no leading/trailing symbols');

/** Passwords: length is the dominant factor; we also block trivially weak choices. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), 'Password must contain letters and numbers');

export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits');

export const cursorPaginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const countryCodeSchema = z.string().trim().toUpperCase().length(2);

export const urlSchema = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');

export const latitudeSchema = z.coerce.number().min(-90).max(90);
export const longitudeSchema = z.coerce.number().min(-180).max(180);
